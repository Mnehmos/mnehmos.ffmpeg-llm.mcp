/**
 * @module tools/project
 * @description Tool handlers for project CRUD operations:
 * create, open, list, info, and delete.
 */

import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { ToolAction, ToolCategory, registerTool, type ToolResult } from './actionEnum.js';
import type { Storage } from '../storage/db.js';
import type { Project, ProjectSettings } from '../schemas/project.js';

// ── Schemas ─────────────────────────────────────────────────────────────

const ProjectCreateSchema = z.object({
  name: z.string().min(1).describe('Project display name'),
  workDir: z.string().min(1).describe('Working directory for project files'),
  settings: z
    .object({
      defaultResolution: z.object({ w: z.number(), h: z.number() }).optional(),
      defaultFps: z.number().positive().optional(),
      defaultAudioSampleRate: z.number().int().positive().optional(),
    })
    .optional(),
});

const ProjectOpenSchema = z.object({
  projectId: z.string().min(1).describe('Project UUID to open'),
});

const ProjectListSchema = z.object({}).strict();

const ProjectInfoSchema = z.object({
  projectId: z.string().min(1).describe('Project UUID'),
});

const ProjectDeleteSchema = z.object({
  projectId: z.string().min(1).describe('Project UUID to delete'),
});

// ── ProjectTools Class ──────────────────────────────────────────────────

/**
 * Class-based tool handler for project CRUD operations.
 */
export class ProjectTools {
  private readonly storage: Storage;

  constructor(storage: Storage) {
    this.storage = storage;
  }

  async projectCreate(params: {
    name: string;
    workDir: string;
    settings?: Partial<ProjectSettings>;
  }): Promise<{ project: Project }> {
    const { name, workDir, settings } = params;

    const defaultSettings: ProjectSettings = {
      defaultResolution: { w: 1920, h: 1080 },
      defaultFps: 30,
      defaultAudioSampleRate: 48000,
    };

    const mergedSettings: ProjectSettings = {
      ...defaultSettings,
      ...settings,
    };

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
      settings: mergedSettings,
      autopilot: {
        enabled: false,
        openrouterModel: 'google/gemini-2.0-flash-001',
        visionModel: 'google/gemini-2.0-flash-001',
        maxBudgetUsd: 1.0,
        spentUsd: 0,
      },
      history: [],
    };

    await this.storage.saveProject(project);

    return { project };
  }

  async projectList(): Promise<{ projects: Project[] }> {
    const projects = await this.storage.listProjects();
    return { projects: projects as Project[] };
  }

  async projectOpen(params: { projectId: string }): Promise<{ project: Project }> {
    const project = await this.storage.getProject(params.projectId);
    if (!project) {
      throw new Error(`Project not found: ${params.projectId}`);
    }
    return { project };
  }

  async projectDelete(params: { projectId: string }): Promise<void> {
    const project = await this.storage.getProject(params.projectId);
    if (!project) {
      throw new Error(`Project not found: ${params.projectId}`);
    }
    await this.storage.deleteProject(params.projectId);
  }

  async projectInfo(params: { projectId: string }): Promise<{ project: Project }> {
    const project = await this.storage.getProject(params.projectId);
    if (!project) {
      throw new Error(`Project not found: ${params.projectId}`);
    }
    return { project };
  }
}

// ── Registration ────────────────────────────────────────────────────────

/**
 * Register all project-related tools in the global registry.
 * @param _registry - Unused (tools register themselves globally)
 * @param db - Storage instance for persistence
 */
export function registerProjectTools(_registry: unknown, db: Storage): void {
  const tools = new ProjectTools(db);

  registerTool({
    action: ToolAction.PROJECT_CREATE,
    category: ToolCategory.PROJECT,
    description: 'Create a new video editing project with an empty timeline',
    schema: ProjectCreateSchema,
    handler: async (params): Promise<ToolResult> => {
      const { name, workDir } = params as z.infer<typeof ProjectCreateSchema>;
      const result = await tools.projectCreate({ name, workDir });
      return {
        success: true,
        data: { id: result.project.id, name: result.project.name, workDir },
        summary: `Created project "${name}" (${result.project.id})`,
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
      try {
        const result = await tools.projectOpen({ projectId });
        return {
          success: true,
          data: result.project,
          summary: `Opened project "${result.project.name}"`,
        };
      } catch {
        return { success: false, error: `Project not found: ${projectId}` };
      }
    },
  });

  registerTool({
    action: ToolAction.PROJECT_LIST,
    category: ToolCategory.PROJECT,
    description: 'List all projects with summary info',
    schema: ProjectListSchema,
    handler: async (): Promise<ToolResult> => {
      const result = await tools.projectList();
      return {
        success: true,
        data: result.projects,
        summary: `Found ${result.projects.length} project(s)`,
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
      try {
        const result = await tools.projectInfo({ projectId });
        return {
          success: true,
          data: result.project,
          summary: `Project "${result.project.name}"`,
        };
      } catch {
        return { success: false, error: `Project not found: ${projectId}` };
      }
    },
  });

  registerTool({
    action: ToolAction.PROJECT_DELETE,
    category: ToolCategory.PROJECT,
    description: 'Delete a project by ID',
    schema: ProjectDeleteSchema,
    handler: async (params): Promise<ToolResult> => {
      const { projectId } = params as z.infer<typeof ProjectDeleteSchema>;
      try {
        await tools.projectDelete({ projectId });
        return {
          success: true,
          summary: `Deleted project (${projectId})`,
        };
      } catch {
        return { success: false, error: `Project not found: ${projectId}` };
      }
    },
  });
}
