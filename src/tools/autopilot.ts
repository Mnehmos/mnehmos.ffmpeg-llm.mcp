/**
 * @module tools/autopilot
 * @description Tool handlers for LLM-driven autopilot features:
 * analysis, edit suggestions, suggestion application, and configuration.
 */

import { z } from 'zod';
import {
  ToolAction,
  ToolCategory,
  registerTool,
  executeTool,
  type ToolResult,
} from './actionEnum.js';
import type { Storage } from '../storage/db.js';
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

// ── Registration ────────────────────────────────────────────────────────

/**
 * Register all autopilot tools (4 total).
 * @param _registry - Unused
 * @param db - Storage instance
 * @param llmClient - OpenRouter API client
 * @param sampler - Frame sampler for vision analysis
 * @param budget - Budget tracker for cost control
 */
export function registerAutopilotTools(
  _registry: unknown,
  db: Storage,
  llmClient: OpenRouterClient,
  sampler: FrameSampler,
  budget: BudgetTracker,
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
      const estimatedCost = 0.05; // TODO: Better cost estimation based on video length
      if (!budget.canAfford(estimatedCost)) {
        return {
          success: false,
          error: `Insufficient budget. Remaining: $${budget.remainingBudget().toFixed(4)}, estimated cost: $${estimatedCost.toFixed(4)}`,
        };
      }

      let analysisResult: AnalysisResult;

      // TODO: Implement actual LLM analysis calls
      switch (analysisType) {
        case 'scene_overview':
          analysisResult = await analyzeSceneOverview(project, asset, llmClient, sampler);
          break;
        case 'highlight_detection':
          analysisResult = await detectHighlights(project, asset, llmClient, sampler);
          break;
        case 'chapter_suggestion':
          analysisResult = await suggestChapters(project, asset, llmClient, sampler);
          break;
        case 'thumbnail_candidates':
          analysisResult = await selectThumbnails(project, asset, llmClient, sampler);
          break;
        case 'edit_review':
          analysisResult = await reviewEdits(project, llmClient);
          break;
      }

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

      // TODO: Send project state + context to LLM, receive EditSuggestion[]
      void context;
      const _suggestions: EditSuggestion[] = [];

      return {
        success: true,
        data: { suggestions: _suggestions },
        summary: `Generated ${_suggestions.length} edit suggestion(s) — TODO: implement`,
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

      // TODO: Look up stored suggestions, execute each via executeTool
      const results: Array<{ suggestionId: string; success: boolean; error?: string }> = [];

      for (const _id of suggestionIds) {
        // TODO: Retrieve suggestion, call executeTool with its action and params
        results.push({ suggestionId: _id, success: false, error: 'Not implemented' });
      }

      void executeTool; // Will be used when implemented

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
