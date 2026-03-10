/**
 * @module tools/chapter
 * @description Tool handlers for chapter marker management:
 * add, remove, and list chapters on the timeline.
 */

import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { ToolAction, ToolCategory, registerTool, type ToolResult } from './actionEnum.js';
import type { Storage } from '../storage/db.js';
import type { Chapter } from '../schemas/timeline.js';

// ── Schemas ─────────────────────────────────────────────────────────────

const ChapterAddSchema = z.object({
  projectId: z.string().uuid(),
  title: z.string().min(1).describe('Chapter title'),
  timelineStart: z.number().nonnegative().describe('Start time on the timeline in seconds'),
  metadata: z.record(z.any()).optional(),
});

const ChapterRemoveSchema = z.object({
  projectId: z.string().uuid(),
  chapterId: z.string().uuid(),
});

const ChapterListSchema = z.object({
  projectId: z.string().uuid(),
});

// ── Registration ────────────────────────────────────────────────────────

/**
 * Register all chapter-related tools (3 total).
 * @param _registry - Unused
 * @param db - Storage instance
 */
export function registerChapterTools(_registry: unknown, db: Storage): void {
  registerTool({
    action: ToolAction.CHAPTER_ADD,
    category: ToolCategory.CHAPTER,
    description: 'Add a chapter marker to the timeline',
    schema: ChapterAddSchema,
    handler: async (params): Promise<ToolResult> => {
      const { projectId, title, timelineStart, metadata } = params as z.infer<
        typeof ChapterAddSchema
      >;

      const project = db.getProject(projectId);
      if (!project) return { success: false, error: `Project not found: ${projectId}` };

      // Validate timestamp is within timeline duration (if timeline has content)
      if (project.timeline.duration > 0 && timelineStart > project.timeline.duration) {
        return {
          success: false,
          error: `Chapter start time ${timelineStart}s exceeds timeline duration ${project.timeline.duration}s`,
        };
      }

      const chapter: Chapter = {
        id: uuidv4(),
        title,
        timelineStart,
        metadata: metadata ?? {},
      };

      project.timeline.chapters.push(chapter);
      // Sort chapters by start time
      project.timeline.chapters.sort((a, b) => a.timelineStart - b.timelineStart);
      project.updatedAt = new Date().toISOString();
      db.saveProject(project);

      return {
        success: true,
        data: { chapterId: chapter.id },
        summary: `Added chapter "${title}" at ${timelineStart}s`,
      };
    },
  });

  registerTool({
    action: ToolAction.CHAPTER_REMOVE,
    category: ToolCategory.CHAPTER,
    description: 'Remove a chapter marker from the timeline',
    schema: ChapterRemoveSchema,
    handler: async (params): Promise<ToolResult> => {
      const { projectId, chapterId } = params as z.infer<typeof ChapterRemoveSchema>;

      const project = db.getProject(projectId);
      if (!project) return { success: false, error: `Project not found: ${projectId}` };

      const idx = project.timeline.chapters.findIndex((c) => c.id === chapterId);
      if (idx === -1) return { success: false, error: `Chapter not found: ${chapterId}` };

      const removed = project.timeline.chapters.splice(idx, 1)[0];
      project.updatedAt = new Date().toISOString();
      db.saveProject(project);

      return { success: true, summary: `Removed chapter "${removed.title}"` };
    },
  });

  registerTool({
    action: ToolAction.CHAPTER_LIST,
    category: ToolCategory.CHAPTER,
    description: 'List all chapter markers in the timeline',
    schema: ChapterListSchema,
    handler: async (params): Promise<ToolResult> => {
      const { projectId } = params as z.infer<typeof ChapterListSchema>;

      const project = db.getProject(projectId);
      if (!project) return { success: false, error: `Project not found: ${projectId}` };

      return {
        success: true,
        data: project.timeline.chapters,
        summary: `${project.timeline.chapters.length} chapter(s)`,
      };
    },
  });
}
