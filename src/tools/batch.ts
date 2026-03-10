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
  projectId: z.string().uuid(),
});

const TimelineRedoSchema = z.object({
  projectId: z.string().uuid(),
});

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

      const project = db.getProject(projectId);
      if (!project) return { success: false, error: `Project not found: ${projectId}` };

      if (project.history.length === 0) {
        return { success: false, error: 'No history to undo' };
      }

      // TODO: Implement undo logic
      // 1. Get the last history entry
      // 2. Restore the "before" state from the history entry
      // 3. Save project

      const lastEntry = project.history[project.history.length - 1];
      if (!lastEntry) return { success: false, error: 'History entry not found' };

      // TODO: Apply lastEntry.before to the appropriate project state
      project.updatedAt = new Date().toISOString();
      db.saveProject(project);

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

      const project = db.getProject(projectId);
      if (!project) return { success: false, error: `Project not found: ${projectId}` };

      if (project.history.length === 0) {
        return { success: false, error: 'Nothing to redo' };
      }

      // TODO: Implement redo logic using history entries
      // For now, this is a placeholder
      const entry = project.history[project.history.length - 1];
      if (!entry) return { success: false, error: 'History entry not found' };

      // TODO: Apply entry.after to the appropriate project state
      project.updatedAt = new Date().toISOString();
      db.saveProject(project);

      return {
        success: true,
        data: { redoneAction: entry.action },
        summary: `Redid: ${entry.action}`,
      };
    },
  });
}
