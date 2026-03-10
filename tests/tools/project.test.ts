/**
 * Tests for project tool operations.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ProjectTools } from '@/tools/project';
import { createTestProject as _createTestProject } from '../helpers/fixtures';
import { MockStorage } from '../helpers/mocks';

describe('ProjectTools', () => {
  let storage: MockStorage;
  let tools: ProjectTools;

  beforeEach(() => {
    storage = new MockStorage();
    tools = new ProjectTools(storage);
  });

  // -------------------------------------------------------------------------
  // project_create
  // -------------------------------------------------------------------------

  describe('project_create', () => {
    it('creates project with default settings', async () => {
      const result = await tools.projectCreate({
        name: 'My Project',
        workDir: '/tmp/projects/my-project',
      });

      expect(result.project).toBeDefined();
      expect(result.project.name).toBe('My Project');
      expect(result.project.settings.defaultResolution).toEqual({ w: 1920, h: 1080 });
      expect(result.project.settings.defaultFps).toBe(30);
    });

    it('creates project with custom settings', async () => {
      const result = await tools.projectCreate({
        name: 'Custom Project',
        workDir: '/tmp/projects/custom',
        settings: {
          defaultResolution: { w: 3840, h: 2160 },
          defaultFps: 60,
          defaultAudioSampleRate: 96000,
        },
      });

      expect(result.project.settings.defaultResolution).toEqual({ w: 3840, h: 2160 });
      expect(result.project.settings.defaultFps).toBe(60);
    });

    it('persists project to storage', async () => {
      const result = await tools.projectCreate({
        name: 'Persisted Project',
        workDir: '/tmp/projects/persisted',
      });

      const saved = await storage.getProject(result.project.id);
      expect(saved).toBeDefined();
      expect(saved!.name).toBe('Persisted Project');
    });

    it('initializes empty timeline with default tracks', async () => {
      const result = await tools.projectCreate({
        name: 'Timeline Test',
        workDir: '/tmp/projects/timeline',
      });

      expect(result.project.timeline).toBeDefined();
      expect(result.project.timeline.tracks).toBeDefined();
      expect(result.project.timeline.duration).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // project_list
  // -------------------------------------------------------------------------

  describe('project_list', () => {
    it('returns project summaries', async () => {
      await tools.projectCreate({ name: 'Project A', workDir: '/tmp/a' });
      await tools.projectCreate({ name: 'Project B', workDir: '/tmp/b' });

      const result = await tools.projectList();

      expect(result.projects).toHaveLength(2);
      expect(result.projects.map((p: any) => p.name)).toContain('Project A');
      expect(result.projects.map((p: any) => p.name)).toContain('Project B');
    });

    it('returns empty list when no projects exist', async () => {
      const result = await tools.projectList();
      expect(result.projects).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // project_open
  // -------------------------------------------------------------------------

  describe('project_open', () => {
    it('loads project from storage', async () => {
      const { project } = await tools.projectCreate({
        name: 'Openable',
        workDir: '/tmp/open',
      });

      const result = await tools.projectOpen({ projectId: project.id });

      expect(result.project).toBeDefined();
      expect(result.project.id).toBe(project.id);
      expect(result.project.name).toBe('Openable');
    });

    it('throws when project not found', async () => {
      await expect(tools.projectOpen({ projectId: 'nonexistent-id' })).rejects.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // project_delete
  // -------------------------------------------------------------------------

  describe('project_delete', () => {
    it('removes project from storage', async () => {
      const { project } = await tools.projectCreate({
        name: 'Deletable',
        workDir: '/tmp/delete',
      });

      await tools.projectDelete({ projectId: project.id });

      const result = await storage.getProject(project.id);
      expect(result).toBeNull();
    });

    it('throws when deleting non-existent project', async () => {
      await expect(tools.projectDelete({ projectId: 'nonexistent-id' })).rejects.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // project_info
  // -------------------------------------------------------------------------

  describe('project_info', () => {
    it('returns full project state', async () => {
      const { project } = await tools.projectCreate({
        name: 'Info Test',
        workDir: '/tmp/info',
      });

      const result = await tools.projectInfo({ projectId: project.id });

      expect(result.project).toBeDefined();
      expect(result.project.name).toBe('Info Test');
      expect(result.project.timeline).toBeDefined();
      expect(result.project.settings).toBeDefined();
      expect(result.project.autopilot).toBeDefined();
    });

    it('throws for non-existent project', async () => {
      await expect(tools.projectInfo({ projectId: 'missing' })).rejects.toThrow();
    });
  });
});
