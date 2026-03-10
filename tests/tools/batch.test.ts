/**
 * Tests for batch and undo/redo operations.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { BatchTools } from '@/tools/batch';
import {
  createTestProject,
  createTestAsset,
  createTestClip,
  createTestTrack,
} from '../helpers/fixtures';
import { MockStorage } from '../helpers/mocks';

describe('BatchTools', () => {
  let storage: MockStorage;
  let tools: BatchTools;

  beforeEach(() => {
    storage = new MockStorage();
    tools = new BatchTools(storage);
  });

  // -------------------------------------------------------------------------
  // batch_tools
  // -------------------------------------------------------------------------

  describe('batch_tools', () => {
    it('executes multiple operations and returns summary', async () => {
      const asset = createTestAsset({ duration: 60 });
      const track = createTestTrack({ type: 'video' });
      const project = createTestProject({
        assets: [asset],
        timeline: { tracks: [track], duration: 0, chapters: [] },
      });
      await storage.saveProject(project);

      const result = await tools.batchTools({
        projectId: project.id,
        operations: [
          {
            tool: 'clip_add',
            params: {
              assetId: asset.id,
              trackId: track.id,
              timelineStart: 0,
              sourceRange: { start: 0, end: 10 },
            },
          },
          {
            tool: 'chapter_add',
            params: {
              title: 'Intro',
              timelineStart: 0,
            },
          },
        ],
      });

      expect(result.summary).toBeDefined();
      expect(result.summary.total).toBe(2);
      expect(result.summary.successful).toBeGreaterThanOrEqual(1);
    });

    it('handles partial failures', async () => {
      const project = createTestProject({
        timeline: { tracks: [], duration: 0, chapters: [] },
      });
      await storage.saveProject(project);

      const result = await tools.batchTools({
        projectId: project.id,
        operations: [
          {
            tool: 'chapter_add',
            params: {
              title: 'Valid Chapter',
              timelineStart: 0,
            },
          },
          {
            tool: 'clip_add',
            params: {
              assetId: 'nonexistent-asset',
              trackId: 'nonexistent-track',
              timelineStart: 0,
            },
          },
        ],
      });

      expect(result.summary.total).toBe(2);
      expect(result.summary.failed).toBeGreaterThanOrEqual(1);
      expect(result.results).toHaveLength(2);
    });
  });

  // -------------------------------------------------------------------------
  // timeline_undo
  // -------------------------------------------------------------------------

  describe('timeline_undo', () => {
    it('reverts the last operation', async () => {
      const asset = createTestAsset({ duration: 60 });
      const clip = createTestClip({
        assetId: asset.id,
        sourceRange: { start: 0, end: 30 },
        timelineStart: 0,
      });
      const track = createTestTrack({ clips: [clip] });
      const project = createTestProject({
        assets: [asset],
        timeline: { tracks: [track], duration: 30, chapters: [] },
        history: [
          {
            action: 'clip_add',
            timestamp: new Date().toISOString(),
            before: { tracks: [createTestTrack({ clips: [] })] },
            after: { tracks: [track] },
          },
        ],
      });
      await storage.saveProject(project);

      const result = await tools.timelineUndo({
        projectId: project.id,
        steps: 1,
      });

      expect(result.undone).toBe(true);
    });

    it('returns false when nothing to undo', async () => {
      const project = createTestProject({ history: [] });
      await storage.saveProject(project);

      const result = await tools.timelineUndo({
        projectId: project.id,
      });

      expect(result.undone).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // timeline_redo
  // -------------------------------------------------------------------------

  describe('timeline_redo', () => {
    it('re-applies undone operation', async () => {
      const project = createTestProject({
        history: [
          {
            action: 'clip_add',
            timestamp: new Date().toISOString(),
            before: { tracks: [] },
            after: { tracks: [createTestTrack()] },
          },
        ],
      });
      await storage.saveProject(project);

      // First undo
      await tools.timelineUndo({ projectId: project.id, steps: 1 });

      // Then redo
      const result = await tools.timelineRedo({
        projectId: project.id,
        steps: 1,
      });

      expect(result.redone).toBe(true);
    });

    it('returns false when nothing to redo', async () => {
      const project = createTestProject({ history: [] });
      await storage.saveProject(project);

      const result = await tools.timelineRedo({
        projectId: project.id,
      });

      expect(result.redone).toBe(false);
    });
  });
});
