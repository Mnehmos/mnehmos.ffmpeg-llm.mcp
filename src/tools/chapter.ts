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
import type { Project } from '../schemas/project.js';

// ── Schemas ─────────────────────────────────────────────────────────────

const ChapterAddSchema = z.object({
  projectId: z.string().min(1),
  title: z.string().min(1).describe('Chapter title'),
  timelineStart: z.number().describe('Start time on the timeline in seconds'),
  metadata: z.record(z.any()).optional(),
});

const ChapterRemoveSchema = z.object({
  projectId: z.string().min(1),
  chapterId: z.string().min(1),
});

const ChapterListSchema = z.object({
  projectId: z.string().min(1),
});

// ── ChapterTools Class ──────────────────────────────────────────────────

/**
 * Class-based tool handler for chapter operations.
 */
export class ChapterTools {
  private readonly storage: Storage;

  constructor(storage: Storage) {
    this.storage = storage;
  }

  private async loadProject(projectId: string): Promise<Project> {
    const project = await this.storage.getProject(projectId);
    if (!project) throw new Error(`Project not found: ${projectId}`);
    return project;
  }

  async chapterAdd(params: {
    projectId: string;
    title: string;
    timelineStart: number;
    metadata?: Record<string, unknown>;
  }): Promise<{ chapter: Chapter }> {
    const { projectId, title, timelineStart, metadata } = params;

    const project = await this.loadProject(projectId);

    // Validate timestamp
    if (timelineStart < 0) {
      throw new Error(`Chapter start time ${timelineStart}s is negative`);
    }
    if (timelineStart > project.timeline.duration) {
      throw new Error(
        `Chapter start time ${timelineStart}s exceeds timeline duration ${project.timeline.duration}s`,
      );
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
    await this.storage.saveProject(project);

    return { chapter };
  }

  async chapterRemove(params: { projectId: string; chapterId: string }): Promise<void> {
    const { projectId, chapterId } = params;

    const project = await this.loadProject(projectId);
    const idx = project.timeline.chapters.findIndex((c) => c.id === chapterId);
    if (idx === -1) throw new Error(`Chapter not found: ${chapterId}`);

    project.timeline.chapters.splice(idx, 1);
    project.updatedAt = new Date().toISOString();
    await this.storage.saveProject(project);
  }

  async chapterList(params: { projectId: string }): Promise<{ chapters: Chapter[] }> {
    const { projectId } = params;

    const project = await this.loadProject(projectId);
    const sorted = [...project.timeline.chapters].sort((a, b) => a.timelineStart - b.timelineStart);

    return { chapters: sorted };
  }
}

// ── Registration ────────────────────────────────────────────────────────

/**
 * Register all chapter-related tools (3 total).
 * @param _registry - Unused
 * @param db - Storage instance
 */
export function registerChapterTools(_registry: unknown, db: Storage): void {
  const tools = new ChapterTools(db);

  registerTool({
    action: ToolAction.CHAPTER_ADD,
    category: ToolCategory.CHAPTER,
    description: 'Add a chapter marker to the timeline',
    schema: ChapterAddSchema,
    handler: async (params): Promise<ToolResult> => {
      const p = params as z.infer<typeof ChapterAddSchema>;
      try {
        const result = await tools.chapterAdd(p);
        return {
          success: true,
          data: { chapterId: result.chapter.id },
          summary: `Added chapter "${result.chapter.title}" at ${result.chapter.timelineStart}s`,
        };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  });

  registerTool({
    action: ToolAction.CHAPTER_REMOVE,
    category: ToolCategory.CHAPTER,
    description: 'Remove a chapter marker from the timeline',
    schema: ChapterRemoveSchema,
    handler: async (params): Promise<ToolResult> => {
      const p = params as z.infer<typeof ChapterRemoveSchema>;
      try {
        await tools.chapterRemove(p);
        return { success: true, summary: 'Removed chapter' };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  });

  registerTool({
    action: ToolAction.CHAPTER_LIST,
    category: ToolCategory.CHAPTER,
    description: 'List all chapter markers in the timeline',
    schema: ChapterListSchema,
    handler: async (params): Promise<ToolResult> => {
      const p = params as z.infer<typeof ChapterListSchema>;
      try {
        const result = await tools.chapterList(p);
        return {
          success: true,
          data: result.chapters,
          summary: `${result.chapters.length} chapter(s)`,
        };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  });
}
