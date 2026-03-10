/**
 * Tests for chapter tool operations.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ChapterTools } from '@/tools/chapter';
import { createTestProject, createTestClip, createTestTrack } from '../helpers/fixtures';
import { MockStorage } from '../helpers/mocks';

describe('ChapterTools', () => {
  let storage: MockStorage;
  let tools: ChapterTools;

  beforeEach(() => {
    storage = new MockStorage();
    tools = new ChapterTools(storage);
  });

  // -------------------------------------------------------------------------
  // chapter_add
  // -------------------------------------------------------------------------

  describe('chapter_add', () => {
    it('adds chapter at valid timestamp', async () => {
      const clip = createTestClip({ sourceRange: { start: 0, end: 300 }, timelineStart: 0 });
      const track = createTestTrack({ clips: [clip] });
      const project = createTestProject({
        timeline: { tracks: [track], duration: 300, chapters: [] },
      });
      await storage.saveProject(project);

      const result = await tools.chapterAdd({
        projectId: project.id,
        title: 'Opening',
        timelineStart: 0,
      });

      expect(result.chapter).toBeDefined();
      expect(result.chapter.title).toBe('Opening');
      expect(result.chapter.timelineStart).toBe(0);
    });

    it('adds chapter at mid-point of timeline', async () => {
      const clip = createTestClip({ sourceRange: { start: 0, end: 300 }, timelineStart: 0 });
      const track = createTestTrack({ clips: [clip] });
      const project = createTestProject({
        timeline: { tracks: [track], duration: 300, chapters: [] },
      });
      await storage.saveProject(project);

      const result = await tools.chapterAdd({
        projectId: project.id,
        title: 'Midgame',
        timelineStart: 150,
      });

      expect(result.chapter.timelineStart).toBe(150);
    });

    it('rejects timestamp beyond timeline duration', async () => {
      const project = createTestProject({
        timeline: { tracks: [], duration: 100, chapters: [] },
      });
      await storage.saveProject(project);

      await expect(
        tools.chapterAdd({
          projectId: project.id,
          title: 'Beyond',
          timelineStart: 200,
        }),
      ).rejects.toThrow();
    });

    it('rejects negative timestamp', async () => {
      const project = createTestProject({
        timeline: { tracks: [], duration: 100, chapters: [] },
      });
      await storage.saveProject(project);

      await expect(
        tools.chapterAdd({
          projectId: project.id,
          title: 'Negative',
          timelineStart: -10,
        }),
      ).rejects.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // chapter_remove
  // -------------------------------------------------------------------------

  describe('chapter_remove', () => {
    it('removes existing chapter', async () => {
      const chapterId = crypto.randomUUID();
      const project = createTestProject({
        timeline: {
          tracks: [],
          duration: 300,
          chapters: [
            { id: chapterId, title: 'Intro', timelineStart: 0, metadata: {} },
            { id: crypto.randomUUID(), title: 'Main', timelineStart: 60, metadata: {} },
          ],
        },
      });
      await storage.saveProject(project);

      await tools.chapterRemove({
        projectId: project.id,
        chapterId,
      });

      const updated = await storage.getProject(project.id);
      expect(updated!.timeline.chapters).toHaveLength(1);
      expect(updated!.timeline.chapters[0].title).toBe('Main');
    });

    it('throws when chapter not found', async () => {
      const project = createTestProject({
        timeline: { tracks: [], duration: 100, chapters: [] },
      });
      await storage.saveProject(project);

      await expect(
        tools.chapterRemove({
          projectId: project.id,
          chapterId: 'nonexistent',
        }),
      ).rejects.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // chapter_list
  // -------------------------------------------------------------------------

  describe('chapter_list', () => {
    it('returns chapters sorted by timeline position', async () => {
      const project = createTestProject({
        timeline: {
          tracks: [],
          duration: 300,
          chapters: [
            { id: crypto.randomUUID(), title: 'End', timelineStart: 200, metadata: {} },
            { id: crypto.randomUUID(), title: 'Start', timelineStart: 0, metadata: {} },
            { id: crypto.randomUUID(), title: 'Middle', timelineStart: 100, metadata: {} },
          ],
        },
      });
      await storage.saveProject(project);

      const result = await tools.chapterList({ projectId: project.id });

      expect(result.chapters).toHaveLength(3);
      expect(result.chapters[0].title).toBe('Start');
      expect(result.chapters[1].title).toBe('Middle');
      expect(result.chapters[2].title).toBe('End');
    });

    it('returns empty array when no chapters', async () => {
      const project = createTestProject({
        timeline: { tracks: [], duration: 100, chapters: [] },
      });
      await storage.saveProject(project);

      const result = await tools.chapterList({ projectId: project.id });

      expect(result.chapters).toHaveLength(0);
    });
  });
});
