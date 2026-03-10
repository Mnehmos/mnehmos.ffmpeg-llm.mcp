/**
 * @module tools/autopilot
 * @description Tool handlers for LLM-driven autopilot features:
 * analysis, edit suggestions, suggestion application, and configuration.
 */

import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import {
  ToolAction,
  ToolCategory,
  registerTool,
  executeTool,
  type ToolResult,
} from './actionEnum.js';
import type { Storage } from '../storage/db.js';
import type { FFmpegRunner } from '../engine/ffmpeg.js';
import { AnalysisTypeEnum } from '../schemas/autopilot.js';
import type { AnalysisResult, EditSuggestion } from '../schemas/autopilot.js';
import type { OpenRouterClient } from '../llm/openrouter-client.js';
import type { FrameSampler } from '../llm/frame-sampler.js';
import type { BudgetTracker } from '../llm/budget.js';
import {
  analyzeSceneOverview,
  detectHighlights,
  suggestChapters,
  selectThumbnails,
  reviewEdits,
} from '../llm/analyzers.js';

// ── Schemas ─────────────────────────────────────────────────────────────

const AutopilotAnalyzeSchema = z.object({
  projectId: z.string().uuid(),
  assetId: z.string().uuid(),
  analysisType: AnalysisTypeEnum,
});

const AutopilotSuggestEditsSchema = z.object({
  projectId: z.string().uuid(),
  context: z.string().optional().describe('Additional context for edit suggestions'),
});

const AutopilotApplySuggestionsSchema = z.object({
  projectId: z.string().uuid(),
  suggestionIds: z.array(z.string().uuid()).min(1).describe('IDs of suggestions to apply'),
});

const AutopilotConfigureSchema = z.object({
  projectId: z.string().uuid(),
  enabled: z.boolean().optional(),
  openrouterModel: z.string().optional(),
  visionModel: z.string().optional(),
  maxBudgetUsd: z.number().nonnegative().optional(),
});

// ── In-memory suggestion store ──────────────────────────────────────────

const suggestionStore = new Map<string, EditSuggestion>();

// ── Registration ────────────────────────────────────────────────────────

/**
 * Register all autopilot tools (4 total).
 */
export function registerAutopilotTools(
  _registry: unknown,
  db: Storage,
  llmClient: OpenRouterClient,
  sampler: FrameSampler,
  budget: BudgetTracker,
  ffmpeg: FFmpegRunner,
): void {
  registerTool({
    action: ToolAction.AUTOPILOT_ANALYZE,
    category: ToolCategory.AUTOPILOT,
    description:
      'Run an LLM-powered analysis on a video asset (scene overview, highlights, chapters, thumbnails, or edit review)',
    schema: AutopilotAnalyzeSchema,
    handler: async (params): Promise<ToolResult> => {
      const { projectId, assetId, analysisType } = params as z.infer<typeof AutopilotAnalyzeSchema>;

      const project = db.getProject(projectId);
      if (!project) return { success: false, error: `Project not found: ${projectId}` };

      if (!project.autopilot.enabled) {
        return { success: false, error: 'Autopilot is not enabled for this project' };
      }

      const asset = project.assets.find((a) => a.id === assetId);
      if (!asset) return { success: false, error: `Asset not found: ${assetId}` };

      // Check budget before proceeding
      const estimatedCost = 0.05;
      if (!budget.canAfford(estimatedCost)) {
        return {
          success: false,
          error: `Insufficient budget. Remaining: $${budget.remainingBudget().toFixed(4)}, estimated cost: $${estimatedCost.toFixed(4)}`,
        };
      }

      let analysisResult: AnalysisResult;

      switch (analysisType) {
        case 'scene_overview':
          analysisResult = await analyzeSceneOverview(project, asset, llmClient, sampler, ffmpeg);
          break;
        case 'highlight_detection':
          analysisResult = await detectHighlights(project, asset, llmClient, sampler, ffmpeg);
          break;
        case 'chapter_suggestion':
          analysisResult = await suggestChapters(project, asset, llmClient, sampler, ffmpeg);
          break;
        case 'thumbnail_candidates':
          analysisResult = await selectThumbnails(project, asset, llmClient, sampler, ffmpeg);
          break;
        case 'edit_review':
          analysisResult = await reviewEdits(project, llmClient);
          break;
      }

      // Track cost
      budget.recordCost(analysisResult.model, analysisResult.costUsd);

      return {
        success: true,
        data: analysisResult,
        summary: `${analysisType} analysis complete (cost: $${analysisResult.costUsd.toFixed(4)})`,
      };
    },
  });

  registerTool({
    action: ToolAction.AUTOPILOT_SUGGEST_EDITS,
    category: ToolCategory.AUTOPILOT,
    description: 'Ask the LLM to suggest timeline edits based on the project state',
    schema: AutopilotSuggestEditsSchema,
    handler: async (params): Promise<ToolResult> => {
      const { projectId, context } = params as z.infer<typeof AutopilotSuggestEditsSchema>;

      const project = db.getProject(projectId);
      if (!project) return { success: false, error: `Project not found: ${projectId}` };

      if (!project.autopilot.enabled) {
        return { success: false, error: 'Autopilot is not enabled for this project' };
      }

      // Check budget
      const estimatedCost = 0.03;
      if (!budget.canAfford(estimatedCost)) {
        return {
          success: false,
          error: `Insufficient budget. Remaining: $${budget.remainingBudget().toFixed(4)}`,
        };
      }

      // Build project summary for LLM
      const projectSummary = JSON.stringify(
        {
          name: project.name,
          tracks: project.timeline.tracks.map((t) => ({
            name: t.name,
            type: t.type,
            clipCount: t.clips.length,
            clips: t.clips.map((c) => ({
              id: c.id,
              assetId: c.assetId,
              timelineStart: c.timelineStart,
              sourceRange: c.sourceRange,
              speed: c.speed,
              volume: c.volume,
              filters: c.filters,
            })),
          })),
          chapters: project.timeline.chapters,
          duration: project.timeline.duration,
          assetCount: project.assets.length,
        },
        null,
        2,
      );

      const prompt = `Given this video project timeline, suggest specific edits to improve it.
${context ? `Additional context: ${context}\n` : ''}
Project state:
${projectSummary}

Return JSON with this schema:
{
  "suggestions": [
    {
      "toolAction": string,
      "params": object,
      "description": string,
      "confidence": number,
      "reasoning": string
    }
  ]
}`;

      const response = await llmClient.chat(
        [
          {
            role: 'system',
            content:
              'You are a video editing assistant. Suggest specific tool actions to improve the project.',
          },
          { role: 'user', content: prompt },
        ],
        { model: project.autopilot.openrouterModel, responseFormat: { type: 'json_object' } },
      );

      const costUsd = llmClient.estimateCost(
        response.usage.prompt_tokens,
        response.usage.completion_tokens,
        response.model,
      );
      budget.recordCost(response.model, costUsd);

      const parsed = JSON.parse(response.content) as {
        suggestions?: Array<{
          toolAction: string;
          params: Record<string, unknown>;
          description: string;
          confidence: number;
          reasoning?: string;
        }>;
      };

      // Convert to EditSuggestion with IDs and store them
      const suggestions: EditSuggestion[] = (parsed.suggestions ?? []).map((s) => {
        const suggestion: EditSuggestion = {
          id: uuidv4(),
          toolAction: s.toolAction,
          params: s.params,
          description: s.description,
          confidence: Math.min(1, Math.max(0, s.confidence)),
          applied: false,
          reasoning: s.reasoning,
        };
        suggestionStore.set(suggestion.id, suggestion);
        return suggestion;
      });

      return {
        success: true,
        data: { suggestions, costUsd },
        summary: `Generated ${suggestions.length} edit suggestion(s) (cost: $${costUsd.toFixed(4)})`,
      };
    },
  });

  registerTool({
    action: ToolAction.AUTOPILOT_APPLY_SUGGESTIONS,
    category: ToolCategory.AUTOPILOT,
    description: 'Apply one or more LLM-generated edit suggestions',
    schema: AutopilotApplySuggestionsSchema,
    handler: async (params): Promise<ToolResult> => {
      const { projectId, suggestionIds } = params as z.infer<
        typeof AutopilotApplySuggestionsSchema
      >;

      const project = db.getProject(projectId);
      if (!project) return { success: false, error: `Project not found: ${projectId}` };

      const results: Array<{ suggestionId: string; success: boolean; error?: string }> = [];

      for (const id of suggestionIds) {
        const suggestion = suggestionStore.get(id);
        if (!suggestion) {
          results.push({ suggestionId: id, success: false, error: 'Suggestion not found' });
          continue;
        }

        if (suggestion.applied) {
          results.push({ suggestionId: id, success: false, error: 'Already applied' });
          continue;
        }

        // Map toolAction string to ToolAction enum
        const action = suggestion.toolAction as ToolAction;

        try {
          const toolResult = await executeTool(action, {
            projectId,
            ...suggestion.params,
          });

          if (toolResult.success) {
            suggestion.applied = true;
            suggestionStore.set(id, suggestion);
            results.push({ suggestionId: id, success: true });
          } else {
            results.push({ suggestionId: id, success: false, error: toolResult.error });
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          results.push({ suggestionId: id, success: false, error: message });
        }
      }

      const successCount = results.filter((r) => r.success).length;
      return {
        success: true,
        data: { results, applied: successCount, total: suggestionIds.length },
        summary: `Applied ${successCount}/${suggestionIds.length} suggestion(s)`,
      };
    },
  });

  registerTool({
    action: ToolAction.AUTOPILOT_CONFIGURE,
    category: ToolCategory.AUTOPILOT,
    description: 'Update autopilot configuration for a project',
    schema: AutopilotConfigureSchema,
    handler: async (params): Promise<ToolResult> => {
      const { projectId, ...updates } = params as z.infer<typeof AutopilotConfigureSchema>;

      const project = db.getProject(projectId);
      if (!project) return { success: false, error: `Project not found: ${projectId}` };

      // Apply updates
      if (updates.enabled !== undefined) project.autopilot.enabled = updates.enabled;
      if (updates.openrouterModel !== undefined)
        project.autopilot.openrouterModel = updates.openrouterModel;
      if (updates.visionModel !== undefined) project.autopilot.visionModel = updates.visionModel;
      if (updates.maxBudgetUsd !== undefined) project.autopilot.maxBudgetUsd = updates.maxBudgetUsd;

      project.updatedAt = new Date().toISOString();
      db.saveProject(project);

      return {
        success: true,
        data: project.autopilot,
        summary: `Updated autopilot config: ${JSON.stringify(updates)}`,
      };
    },
  });
}
