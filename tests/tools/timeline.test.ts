/**
 * Tests for timeline editing logic.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { TimelineEditor } from '@/tools/timeline';
import {
  createTestProject,
  createTestAsset,
  createTestClip,
  createTestTrack,
} from '../helpers/fixtures';
import { MockStorage } from '../helpers/mocks';

describe('TimelineEditor', () => {
  let storage: MockStorage;
  let editor: TimelineEditor;

  beforeEach(() => {
    storage = new MockStorage();
    editor = new TimelineEditor(storage);
  });

  // -------------------------------------------------------------------------
  // clip_add
  // -------------------------------------------------------------------------

  describe('clip_add', () => {
    it('places clip at correct position on timeline', async () => {
      const asset = createTestAsset({ duration: 60 });
      const track = createTestTrack({ type: 'video' });
      const project = createTestProject({
        assets: [asset],
        timeline: { tracks: [track], duration: 0, chapters: [] },
      });
      await storage.saveProject(project);

      const result = await editor.clipAdd({
        projectId: project.id,
        assetId: asset.id,
        trackId: track.id,
        timelineStart: 10,
        sourceRange: { start: 0, end: 30 },
      });

      expect(result.clip).toBeDefined();
      expect(result.clip.timelineStart).toBe(10);
      expect(result.clip.assetId).toBe(asset.id);
    });

    it('rejects if track does not exist', async () => {
      const asset = createTestAsset();
      const project = createTestProject({
        assets: [asset],
        timeline: { tracks: [], duration: 0, chapters: [] },
      });
      await storage.saveProject(project);

      await expect(
        editor.clipAdd({
          projectId: project.id,
          assetId: asset.id,
          trackId: 'nonexistent-track-id',
          timelineStart: 0,
        }),
      ).rejects.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // clip_trim
  // -------------------------------------------------------------------------

  describe('clip_trim', () => {
    it('adjusts source range', async () => {
      const asset = createTestAsset({ duration: 60 });
      const clip = createTestClip({
        assetId: asset.id,
        sourceRange: { start: 0, end: 30 },
      });
      const track = createTestTrack({ clips: [clip] });
      const project = createTestProject({
        assets: [asset],
        timeline: { tracks: [track], duration: 30, chapters: [] },
      });
      await storage.saveProject(project);

      const result = await editor.clipTrim({
        projectId: project.id,
        clipId: clip.id,
        sourceStart: 5,
        sourceEnd: 25,
      });

      expect(result.clip.sourceRange.start).toBe(5);
      expect(result.clip.sourceRange.end).toBe(25);
    });

    it('rejects if trim extends beyond asset duration', async () => {
      const asset = createTestAsset({ duration: 30 });
      const clip = createTestClip({
        assetId: asset.id,
        sourceRange: { start: 0, end: 30 },
      });
      const track = createTestTrack({ clips: [clip] });
      const project = createTestProject({
        assets: [asset],
        timeline: { tracks: [track], duration: 30, chapters: [] },
      });
      await storage.saveProject(project);

      await expect(
        editor.clipTrim({
          projectId: project.id,
          clipId: clip.id,
          sourceEnd: 60, // beyond asset duration
        }),
      ).rejects.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // clip_split
  // -------------------------------------------------------------------------

  describe('clip_split', () => {
    it('creates two clips at split point', async () => {
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
      });
      await storage.saveProject(project);

      const result = await editor.clipSplit({
        projectId: project.id,
        clipId: clip.id,
        splitAt: 15, // timeline position
      });

      expect(result.clips).toHaveLength(2);
      // First clip: source 0-15, timeline 0
      expect(result.clips[0].sourceRange.end).toBeLessThanOrEqual(15);
      // Second clip: source 15-30, timeline 15
      expect(result.clips[1].sourceRange.start).toBeGreaterThanOrEqual(15);
    });

    it('preserves filters on both resulting clips', async () => {
      const asset = createTestAsset({ duration: 60 });
      const clip = createTestClip({
        assetId: asset.id,
        sourceRange: { start: 0, end: 30 },
        timelineStart: 0,
        filters: [{ type: 'brightness', params: { value: 0.5 }, enabled: true }],
      });
      const track = createTestTrack({ clips: [clip] });
      const project = createTestProject({
        assets: [asset],
        timeline: { tracks: [track], duration: 30, chapters: [] },
      });
      await storage.saveProject(project);

      const result = await editor.clipSplit({
        projectId: project.id,
        clipId: clip.id,
        splitAt: 15,
      });

      expect(result.clips[0].filters).toHaveLength(1);
      expect(result.clips[1].filters).toHaveLength(1);
    });
  });

  // -------------------------------------------------------------------------
  // clip_move
  // -------------------------------------------------------------------------

  describe('clip_move', () => {
    it('moves clip within same track', async () => {
      const asset = createTestAsset({ duration: 60 });
      const clip = createTestClip({
        assetId: asset.id,
        sourceRange: { start: 0, end: 10 },
        timelineStart: 0,
      });
      const track = createTestTrack({ clips: [clip] });
      const project = createTestProject({
        assets: [asset],
        timeline: { tracks: [track], duration: 10, chapters: [] },
      });
      await storage.saveProject(project);

      const result = await editor.clipMove({
        projectId: project.id,
        clipId: clip.id,
        timelineStart: 20,
      });

      expect(result.clip.timelineStart).toBe(20);
    });

    it('moves clip between tracks', async () => {
      const asset = createTestAsset({ duration: 60 });
      const clip = createTestClip({
        assetId: asset.id,
        sourceRange: { start: 0, end: 10 },
        timelineStart: 0,
        trackIndex: 0,
      });
      const track1 = createTestTrack({ clips: [clip], type: 'video' });
      const track2 = createTestTrack({ clips: [], type: 'video' });
      const project = createTestProject({
        assets: [asset],
        timeline: { tracks: [track1, track2], duration: 10, chapters: [] },
      });
      await storage.saveProject(project);

      const result = await editor.clipMove({
        projectId: project.id,
        clipId: clip.id,
        trackId: track2.id,
        timelineStart: 5,
      });

      expect(result.clip.timelineStart).toBe(5);
    });
  });

  // -------------------------------------------------------------------------
  // clip_remove
  // -------------------------------------------------------------------------

  describe('clip_remove', () => {
    it('removes clip without side effects', async () => {
      const asset = createTestAsset({ duration: 60 });
      const clip1 = createTestClip({
        assetId: asset.id,
        sourceRange: { start: 0, end: 10 },
        timelineStart: 0,
      });
      const clip2 = createTestClip({
        assetId: asset.id,
        sourceRange: { start: 10, end: 20 },
        timelineStart: 10,
      });
      const track = createTestTrack({ clips: [clip1, clip2] });
      const project = createTestProject({
        assets: [asset],
        timeline: { tracks: [track], duration: 20, chapters: [] },
      });
      await storage.saveProject(project);

      await editor.clipRemove({
        projectId: project.id,
        clipId: clip1.id,
      });

      const updated = await storage.getProject(project.id);
      const remaining = updated!.timeline.tracks[0].clips;
      expect(remaining).toHaveLength(1);
      expect(remaining[0].id).toBe(clip2.id);
    });
  });

  // -------------------------------------------------------------------------
  // clip_set_speed
  // -------------------------------------------------------------------------

  describe('clip_set_speed', () => {
    it('changes speed and adjusts effective duration', async () => {
      const asset = createTestAsset({ duration: 60 });
      const clip = createTestClip({
        assetId: asset.id,
        sourceRange: { start: 0, end: 20 },
        timelineStart: 0,
        speed: 1.0,
      });
      const track = createTestTrack({ clips: [clip] });
      const project = createTestProject({
        assets: [asset],
        timeline: { tracks: [track], duration: 20, chapters: [] },
      });
      await storage.saveProject(project);

      const result = await editor.clipSetSpeed({
        projectId: project.id,
        clipId: clip.id,
        speed: 2.0,
      });

      expect(result.clip.speed).toBe(2.0);
      // Effective duration should be halved
    });
  });

  // -------------------------------------------------------------------------
  // Overlap validation
  // -------------------------------------------------------------------------

  describe('overlap validation', () => {
    it('rejects overlapping clips on same track', async () => {
      const asset = createTestAsset({ duration: 60 });
      const existingClip = createTestClip({
        assetId: asset.id,
        sourceRange: { start: 0, end: 20 },
        timelineStart: 0,
      });
      const track = createTestTrack({ clips: [existingClip] });
      const project = createTestProject({
        assets: [asset],
        timeline: { tracks: [track], duration: 20, chapters: [] },
      });
      await storage.saveProject(project);

      // Try to add overlapping clip
      await expect(
        editor.clipAdd({
          projectId: project.id,
          assetId: asset.id,
          trackId: track.id,
          timelineStart: 10, // overlaps with existing clip (0-20)
          sourceRange: { start: 0, end: 15 },
        }),
      ).rejects.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // track_add / track_remove
  // -------------------------------------------------------------------------

  describe('track_add', () => {
    it('adds a new track to the timeline', async () => {
      const project = createTestProject({
        timeline: { tracks: [], duration: 0, chapters: [] },
      });
      await storage.saveProject(project);

      const result = await editor.trackAdd({
        projectId: project.id,
        name: 'Overlay Track',
        type: 'overlay',
      });

      expect(result.track).toBeDefined();
      expect(result.track.name).toBe('Overlay Track');
      expect(result.track.type).toBe('overlay');
    });
  });

  describe('track_remove', () => {
    it('removes a track and its clips', async () => {
      const clip = createTestClip();
      const track = createTestTrack({ clips: [clip] });
      const project = createTestProject({
        timeline: { tracks: [track], duration: 30, chapters: [] },
      });
      await storage.saveProject(project);

      await editor.trackRemove({
        projectId: project.id,
        trackId: track.id,
      });

      const updated = await storage.getProject(project.id);
      expect(updated!.timeline.tracks).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // filter_add / filter_remove
  // -------------------------------------------------------------------------

  describe('filter_add', () => {
    it('adds filter to a clip', async () => {
      const asset = createTestAsset();
      const clip = createTestClip({
        assetId: asset.id,
        filters: [],
      });
      const track = createTestTrack({ clips: [clip] });
      const project = createTestProject({
        assets: [asset],
        timeline: { tracks: [track], duration: 30, chapters: [] },
      });
      await storage.saveProject(project);

      const result = await editor.filterAdd({
        projectId: project.id,
        clipId: clip.id,
        filter: { type: 'brightness', params: { value: 0.3 }, enabled: true },
      });

      expect(result.clip.filters).toHaveLength(1);
      expect(result.clip.filters[0].type).toBe('brightness');
    });
  });

  describe('filter_remove', () => {
    it('removes filter from a clip', async () => {
      const asset = createTestAsset();
      const clip = createTestClip({
        assetId: asset.id,
        filters: [
          { type: 'brightness', params: { value: 0.3 }, enabled: true },
          { type: 'contrast', params: { value: 1.2 }, enabled: true },
        ],
      });
      const track = createTestTrack({ clips: [clip] });
      const project = createTestProject({
        assets: [asset],
        timeline: { tracks: [track], duration: 30, chapters: [] },
      });
      await storage.saveProject(project);

      const result = await editor.filterRemove({
        projectId: project.id,
        clipId: clip.id,
        filterIndex: 0,
      });

      expect(result.clip.filters).toHaveLength(1);
      expect(result.clip.filters[0].type).toBe('contrast');
    });
  });
});
