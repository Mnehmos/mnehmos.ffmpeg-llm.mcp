/**
 * @module tools/project
 * @description Tool handlers for project CRUD operations:
 * create, open, list, info, and delete.
 */

import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { ToolAction, ToolCategory, registerTool, type ToolResult } from './actionEnum.js';
import type { Storage } from '../storage/db.js';
import type { Project } from '../schemas/project.js';
import { ensureDir } from '../utils/paths.js';

// ── Schemas ─────────────────────────────────────────────────────────────

const ProjectCreateSchema = z.object({
  name: z.string().min(1).describe('Project display name'),
  workDir: z.string().min(1).describe('Working directory for project files'),
});

const ProjectOpenSchema = z.object({
  projectId: z.string().uuid().describe('Project UUID to open'),
});

const ProjectListSchema = z.object({}).strict();

const ProjectInfoSchema = z.object({
  projectId: z.string().uuid().describe('Project UUID'),
});

const ProjectDeleteSchema = z.object({
  projectId: z.string().uuid().describe('Project UUID to delete'),
});

// ── Registration ────────────────────────────────────────────────────────

/**
 * Register all project-related tools in the global registry.
 * @param _registry - Unused (tools register themselves globally)
 * @param db - Storage instance for persistence
 */
export function registerProjectTools(_registry: unknown, db: Storage): void {
  registerTool({
    action: ToolAction.PROJECT_CREATE,
    category: ToolCategory.PROJECT,
    description: 'Create a new video editing project with an empty timeline',
    schema: ProjectCreateSchema,
    handler: async (params): Promise<ToolResult> => {
      const { name, workDir } = params as z.infer<typeof ProjectCreateSchema>;

      // TODO: Ensure workDir exists on disk
      await ensureDir(workDir);

      const now = new Date().toISOString();
      const project: Project = {
        id: uuidv4(),
        name,
        createdAt: now,
        updatedAt: now,
        workDir,
        timeline: {
          tracks: [
            {
              id: uuidv4(),
              name: 'Video 1',
              type: 'video',
              clips: [],
              muted: false,
              locked: false,
              visible: true,
            },
            {
              id: uuidv4(),
              name: 'Audio 1',
              type: 'audio',
              clips: [],
              muted: false,
              locked: false,
              visible: true,
            },
          ],
          duration: 0,
          chapters: [],
        },
        assets: [],
        exportPresets: [],
        settings: {
          defaultResolution: { w: 1920, h: 1080 },
          defaultFps: 30,
          defaultAudioSampleRate: 48000,
        },
        autopilot: {
          enabled: false,
          openrouterModel: 'google/gemini-2.0-flash-001',
          visionModel: 'google/gemini-2.0-flash-001',
          maxBudgetUsd: 1.0,
          spentUsd: 0,
        },
        history: [],
      };

      db.saveProject(project);

      return {
        success: true,
        data: { id: project.id, name: project.name, workDir },
        summary: `Created project "${name}" (${project.id})`,
      };
    },
  });

  registerTool({
    action: ToolAction.PROJECT_OPEN,
    category: ToolCategory.PROJECT,
    description: 'Open an existing project by ID',
    schema: ProjectOpenSchema,
    handler: async (params): Promise<ToolResult> => {
      const { projectId } = params as z.infer<typeof ProjectOpenSchema>;
      const project = db.getProject(projectId);
      if (!project) {
        return { success: false, error: `Project not found: ${projectId}` };
      }
      return {
        success: true,
        data: project,
        summary: `Opened project "${project.name}"`,
      };
    },
  });

  registerTool({
    action: ToolAction.PROJECT_LIST,
    category: ToolCategory.PROJECT,
    description: 'List all projects with summary info',
    schema: ProjectListSchema,
    handler: async (): Promise<ToolResult> => {
      const projects = db.listProjects();
      return {
        success: true,
        data: projects,
        summary: `Found ${projects.length} project(s)`,
      };
    },
  });

  registerTool({
    action: ToolAction.PROJECT_INFO,
    category: ToolCategory.PROJECT,
    description: 'Get detailed information about a project',
    schema: ProjectInfoSchema,
    handler: async (params): Promise<ToolResult> => {
      const { projectId } = params as z.infer<typeof ProjectInfoSchema>;
      const project = db.getProject(projectId);
      if (!project) {
        return { success: false, error: `Project not found: ${projectId}` };
      }
      return {
        success: true,
        data: {
          id: project.id,
          name: project.name,
          createdAt: project.createdAt,
          updatedAt: project.updatedAt,
          workDir: project.workDir,
          assetCount: project.assets.length,
          trackCount: project.timeline.tracks.length,
          duration: project.timeline.duration,
          chapterCount: project.timeline.chapters.length,
          settings: project.settings,
          autopilot: project.autopilot,
        },
        summary: `Project "${project.name}": ${project.assets.length} assets, ${project.timeline.tracks.length} tracks, ${project.timeline.duration}s`,
      };
    },
  });

  registerTool({
    action: ToolAction.PROJECT_DELETE,
    category: ToolCategory.PROJECT,
    description: 'Delete a project by ID',
    schema: ProjectDeleteSchema,
    handler: async (params): Promise<ToolResult> => {
      const { projectId } = params as z.infer<typeof ProjectDeleteSchema>;
      const project = db.getProject(projectId);
      if (!project) {
        return { success: false, error: `Project not found: ${projectId}` };
      }
      db.deleteProject(projectId);
      return {
        success: true,
        summary: `Deleted project "${project.name}" (${projectId})`,
      };
    },
  });
}
