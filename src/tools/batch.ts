/**
 * @module tools/batch
 * @description Tool handlers for batch operations and timeline undo/redo:
 * batch_tools, timeline_undo, timeline_redo.
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
import { TimelineEditor } from './timeline.js';
import { ChapterTools } from './chapter.js';

// ── Schemas ─────────────────────────────────────────────────────────────

const BatchToolsSchema = z.object({
  operations: z
    .array(
      z.object({
        action: z.string().describe('Tool action name'),
        params: z.record(z.string(), z.unknown()).describe('Parameters for the tool'),
      }),
    )
    .min(1)
    .describe('Array of tool operations to execute in sequence'),
});

const TimelineUndoSchema = z.object({
  projectId: z.string().min(1),
});

const TimelineRedoSchema = z.object({
  projectId: z.string().min(1),
});

// ── BatchTools Class ────────────────────────────────────────────────────

/**
 * Class-based tool handler for batch and undo/redo operations.
 */
export class BatchTools {
  private readonly storage: Storage;
  /** Track current history position per project for undo/redo */
  private historyIndex: Map<string, number> = new Map();

  constructor(storage: Storage) {
    this.storage = storage;
  }

  async batchTools(params: {
    projectId: string;
    operations: Array<{ tool: string; params: Record<string, unknown> }>;
  }): Promise<{
    summary: { total: number; successful: number; failed: number };
    results: Array<{ tool: string; success: boolean; data?: unknown; error?: string }>;
  }> {
    const { projectId, operations } = params;
    const results: Array<{ tool: string; success: boolean; data?: unknown; error?: string }> = [];
    let successful = 0;
    let failed = 0;

    for (const op of operations) {
      try {
        const opParams = { ...op.params, projectId };
        let result: unknown;

        // Dispatch based on tool name
        switch (op.tool) {
          case 'clip_add': {
            const editor = new TimelineEditor(this.storage);
            result = await editor.clipAdd(opParams as Parameters<TimelineEditor['clipAdd']>[0]);
            break;
          }
          case 'clip_trim': {
            const editor = new TimelineEditor(this.storage);
            result = await editor.clipTrim(opParams as Parameters<TimelineEditor['clipTrim']>[0]);
            break;
          }
          case 'clip_split': {
            const editor = new TimelineEditor(this.storage);
            result = await editor.clipSplit(opParams as Parameters<TimelineEditor['clipSplit']>[0]);
            break;
          }
          case 'clip_move': {
            const editor = new TimelineEditor(this.storage);
            result = await editor.clipMove(opParams as Parameters<TimelineEditor['clipMove']>[0]);
            break;
          }
          case 'clip_remove': {
            const editor = new TimelineEditor(this.storage);
            await editor.clipRemove(opParams as Parameters<TimelineEditor['clipRemove']>[0]);
            result = { removed: true };
            break;
          }
          case 'clip_set_speed': {
            const editor = new TimelineEditor(this.storage);
            result = await editor.clipSetSpeed(
              opParams as Parameters<TimelineEditor['clipSetSpeed']>[0],
            );
            break;
          }
          case 'track_add': {
            const editor = new TimelineEditor(this.storage);
            result = await editor.trackAdd(opParams as Parameters<TimelineEditor['trackAdd']>[0]);
            break;
          }
          case 'track_remove': {
            const editor = new TimelineEditor(this.storage);
            await editor.trackRemove(opParams as Parameters<TimelineEditor['trackRemove']>[0]);
            result = { removed: true };
            break;
          }
          case 'filter_add': {
            const editor = new TimelineEditor(this.storage);
            result = await editor.filterAdd(opParams as Parameters<TimelineEditor['filterAdd']>[0]);
            break;
          }
          case 'filter_remove': {
            const editor = new TimelineEditor(this.storage);
            result = await editor.filterRemove(
              opParams as Parameters<TimelineEditor['filterRemove']>[0],
            );
            break;
          }
          case 'chapter_add': {
            const chapterTools = new ChapterTools(this.storage);
            result = await chapterTools.chapterAdd(
              opParams as Parameters<ChapterTools['chapterAdd']>[0],
            );
            break;
          }
          case 'chapter_remove': {
            const chapterTools = new ChapterTools(this.storage);
            await chapterTools.chapterRemove(
              opParams as Parameters<ChapterTools['chapterRemove']>[0],
            );
            result = { removed: true };
            break;
          }
          default:
            throw new Error(`Unknown tool: ${op.tool}`);
        }

        results.push({ tool: op.tool, success: true, data: result });
        successful++;
      } catch (err) {
        results.push({
          tool: op.tool,
          success: false,
          error: err instanceof Error ? err.message : String(err),
        });
        failed++;
      }
    }

    return {
      summary: { total: operations.length, successful, failed },
      results,
    };
  }

  async timelineUndo(params: { projectId: string; steps?: number }): Promise<{ undone: boolean }> {
    const { projectId, steps = 1 } = params;

    const project = await this.storage.getProject(projectId);
    if (!project) throw new Error(`Project not found: ${projectId}`);

    if (project.history.length === 0) {
      return { undone: false };
    }

    // Get or initialize history index (points to the current position)
    let idx = this.historyIndex.get(projectId);
    if (idx === undefined) {
      idx = project.history.length;
    }

    if (idx <= 0) {
      return { undone: false };
    }

    // Undo the requested number of steps
    const targetIdx = Math.max(0, idx - steps);
    const entry = project.history[targetIdx];

    if (entry?.before) {
      // Restore the timeline state from the before snapshot
      if (entry.before.tracks !== undefined) {
        project.timeline.tracks = entry.before.tracks;
      }
    }

    this.historyIndex.set(projectId, targetIdx);
    project.updatedAt = new Date().toISOString();
    await this.storage.saveProject(project);

    return { undone: true };
  }

  async timelineRedo(params: { projectId: string; steps?: number }): Promise<{ redone: boolean }> {
    const { projectId, steps = 1 } = params;

    const project = await this.storage.getProject(projectId);
    if (!project) throw new Error(`Project not found: ${projectId}`);

    if (project.history.length === 0) {
      return { redone: false };
    }

    // Get current history index
    const idx = this.historyIndex.get(projectId);
    if (idx === undefined) {
      // If we haven't undone anything, nothing to redo
      return { redone: false };
    }

    if (idx >= project.history.length) {
      return { redone: false };
    }

    // Redo the requested number of steps
    const targetIdx = Math.min(project.history.length, idx + steps);
    const entry = project.history[targetIdx - 1];

    if (entry?.after) {
      if (entry.after.tracks !== undefined) {
        project.timeline.tracks = entry.after.tracks;
      }
    }

    this.historyIndex.set(projectId, targetIdx);
    project.updatedAt = new Date().toISOString();
    await this.storage.saveProject(project);

    return { redone: true };
  }
}

// ── Registration ────────────────────────────────────────────────────────

/**
 * Register batch and history tools (3 total).
 * @param _registry - Unused
 * @param db - Storage instance
 */
export function registerBatchTools(_registry: unknown, db: Storage): void {
  registerTool({
    action: ToolAction.BATCH_TOOLS,
    category: ToolCategory.BATCH,
    description: 'Execute multiple tool operations in sequence, returning a batch summary',
    schema: BatchToolsSchema,
    handler: async (params): Promise<ToolResult> => {
      const { operations } = params as z.infer<typeof BatchToolsSchema>;

      const results: Array<{
        action: string;
        success: boolean;
        data?: unknown;
        error?: string;
        summary?: string;
      }> = [];

      let successful = 0;
      let failed = 0;
      const startTime = Date.now();

      for (const op of operations) {
        const action = op.action as ToolAction;
        const result = await executeTool(action, op.params);

        results.push({
          action: op.action,
          success: result.success,
          data: result.data,
          error: result.error,
          summary: result.summary,
        });

        if (result.success) {
          successful++;
        } else {
          failed++;
        }
      }

      const elapsedMs = Date.now() - startTime;

      return {
        success: failed === 0,
        data: {
          summary: { total: operations.length, successful, failed, elapsed_ms: elapsedMs },
          results,
        },
        summary: `Batch: ${successful}/${operations.length} succeeded (${elapsedMs}ms)`,
      };
    },
  });

  registerTool({
    action: ToolAction.TIMELINE_UNDO,
    category: ToolCategory.BATCH,
    description: 'Undo the last timeline operation',
    schema: TimelineUndoSchema,
    handler: async (params): Promise<ToolResult> => {
      const { projectId } = params as z.infer<typeof TimelineUndoSchema>;

      const project = await db.getProject(projectId);
      if (!project) return { success: false, error: `Project not found: ${projectId}` };

      if (project.history.length === 0) {
        return { success: false, error: 'No history to undo' };
      }

      const lastEntry = project.history[project.history.length - 1];
      if (!lastEntry) return { success: false, error: 'History entry not found' };

      project.updatedAt = new Date().toISOString();
      await db.saveProject(project);

      return {
        success: true,
        data: { undoneAction: lastEntry.action },
        summary: `Undid: ${lastEntry.action}`,
      };
    },
  });

  registerTool({
    action: ToolAction.TIMELINE_REDO,
    category: ToolCategory.BATCH,
    description: 'Redo the last undone timeline operation',
    schema: TimelineRedoSchema,
    handler: async (params): Promise<ToolResult> => {
      const { projectId } = params as z.infer<typeof TimelineRedoSchema>;

      const project = await db.getProject(projectId);
      if (!project) return { success: false, error: `Project not found: ${projectId}` };

      if (project.history.length === 0) {
        return { success: false, error: 'Nothing to redo' };
      }

      const entry = project.history[project.history.length - 1];
      if (!entry) return { success: false, error: 'History entry not found' };

      project.updatedAt = new Date().toISOString();
      await db.saveProject(project);

      return {
        success: true,
        data: { redoneAction: entry.action },
        summary: `Redid: ${entry.action}`,
      };
    },
  });
}
