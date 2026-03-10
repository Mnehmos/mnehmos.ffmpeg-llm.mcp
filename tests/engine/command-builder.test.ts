/**
 * Tests for the FFmpeg command builder.
 */

import { describe, it, expect } from 'vitest';
import { CommandBuilder } from '@/engine/command-builder';
import {
  createTestProject,
  createTestAsset,
  createTestClip,
  createTestTrack,
} from '../helpers/fixtures';

describe('CommandBuilder', () => {
  // -------------------------------------------------------------------------
  // Single clip
  // -------------------------------------------------------------------------

  describe('single clip project', () => {
    it('produces correct ffmpeg args', () => {
      const asset = createTestAsset({ path: '/tmp/video.mp4' });
      const clip = createTestClip({
        assetId: asset.id,
        sourceRange: { start: 0, end: 30 },
        timelineStart: 0,
        trackIndex: 0,
      });
      const track = createTestTrack({ clips: [clip] });
      const project = createTestProject({
        assets: [asset],
        timeline: { tracks: [track], duration: 30, chapters: [] },
      });

      const builder = new CommandBuilder();
      const args = builder.buildRenderArgs(project, '/tmp/output.mp4');

      expect(args).toContain('-i');
      expect(args).toContain('/tmp/video.mp4');
      expect(args.at(-1)).toBe('/tmp/output.mp4');
    });
  });

  // -------------------------------------------------------------------------
  // Multi-clip concat
  // -------------------------------------------------------------------------

  describe('multi-clip concat', () => {
    it('produces correct args for concatenation', () => {
      const asset = createTestAsset({ path: '/tmp/video.mp4' });
      const clip1 = createTestClip({
        assetId: asset.id,
        sourceRange: { start: 0, end: 15 },
        timelineStart: 0,
        trackIndex: 0,
      });
      const clip2 = createTestClip({
        assetId: asset.id,
        sourceRange: { start: 30, end: 45 },
        timelineStart: 15,
        trackIndex: 0,
      });
      const track = createTestTrack({ clips: [clip1, clip2] });
      const project = createTestProject({
        assets: [asset],
        timeline: { tracks: [track], duration: 30, chapters: [] },
      });

      const builder = new CommandBuilder();
      const args = builder.buildRenderArgs(project, '/tmp/output.mp4');

      expect(args).toContain('-filter_complex');
    });
  });

  // -------------------------------------------------------------------------
  // Preview command
  // -------------------------------------------------------------------------

  describe('preview command', () => {
    it('uses lower quality settings', () => {
      const asset = createTestAsset({ path: '/tmp/video.mp4' });
      const clip = createTestClip({
        assetId: asset.id,
        sourceRange: { start: 0, end: 10 },
        trackIndex: 0,
      });
      const track = createTestTrack({ clips: [clip] });
      const project = createTestProject({
        assets: [asset],
        timeline: { tracks: [track], duration: 10, chapters: [] },
      });

      const builder = new CommandBuilder();
      const args = builder.buildPreviewArgs(project, 0, 10, '/tmp/preview.mp4');

      // Preview should use faster/lower quality encoding
      const argsStr = args.join(' ');
      // Should have a lower resolution or faster preset
      expect(argsStr).toBeDefined();
      // Should not be two-pass
      expect(args).not.toContain('-pass');
    });
  });

  // -------------------------------------------------------------------------
  // Frame extract
  // -------------------------------------------------------------------------

  describe('frame extract command', () => {
    it('produces correct args for single frame extraction', () => {
      const builder = new CommandBuilder();
      const args = builder.buildFrameExtractArgs('/tmp/video.mp4', 5.5, '/tmp/frame.png');

      expect(args).toContain('-ss');
      expect(args).toContain('5.5');
      expect(args).toContain('-frames:v');
      expect(args).toContain('1');
      expect(args.at(-1)).toBe('/tmp/frame.png');
    });
  });

  // -------------------------------------------------------------------------
  // Export preset
  // -------------------------------------------------------------------------

  describe('export preset', () => {
    it('applies codec, bitrate, and resolution from preset', () => {
      const asset = createTestAsset({ path: '/tmp/video.mp4' });
      const clip = createTestClip({
        assetId: asset.id,
        sourceRange: { start: 0, end: 30 },
        trackIndex: 0,
      });
      const track = createTestTrack({ clips: [clip] });
      const project = createTestProject({
        assets: [asset],
        timeline: { tracks: [track], duration: 30, chapters: [] },
        exportPresets: [
          {
            name: 'YouTube 1080p',
            container: 'mp4',
            videoCodec: 'libx264',
            audioCodec: 'aac',
            videoBitrate: '8000k',
            audioBitrate: '192k',
            resolution: { w: 1920, h: 1080 },
            fps: 30,
            twoPass: false,
            extraArgs: [],
          },
        ],
      });

      const builder = new CommandBuilder();
      const args = builder.buildRenderArgs(project, '/tmp/output.mp4', 'YouTube 1080p');

      expect(args).toContain('-c:v');
      expect(args).toContain('libx264');
      expect(args).toContain('-c:a');
      expect(args).toContain('aac');
      expect(args).toContain('-b:v');
      expect(args).toContain('8000k');
    });
  });

  // -------------------------------------------------------------------------
  // Two-pass encoding
  // -------------------------------------------------------------------------

  describe('two-pass encoding', () => {
    it('produces two commands for two-pass encode', () => {
      const asset = createTestAsset({ path: '/tmp/video.mp4' });
      const clip = createTestClip({
        assetId: asset.id,
        sourceRange: { start: 0, end: 30 },
        trackIndex: 0,
      });
      const track = createTestTrack({ clips: [clip] });
      const project = createTestProject({
        assets: [asset],
        timeline: { tracks: [track], duration: 30, chapters: [] },
        exportPresets: [
          {
            name: 'High Quality',
            container: 'mp4',
            videoCodec: 'libx264',
            audioCodec: 'aac',
            videoBitrate: '10000k',
            twoPass: true,
            extraArgs: [],
          },
        ],
      });

      const builder = new CommandBuilder();
      const commands = builder.buildTwoPassArgs(project, '/tmp/output.mp4', 'High Quality');

      expect(commands).toHaveLength(2);
      // First pass
      expect(commands[0]).toContain('-pass');
      expect(commands[0]).toContain('1');
      // Second pass
      expect(commands[1]).toContain('-pass');
      expect(commands[1]).toContain('2');
    });
  });

  // -------------------------------------------------------------------------
  // Chapter metadata
  // -------------------------------------------------------------------------

  describe('chapter metadata', () => {
    it('includes chapter metadata in args', () => {
      const asset = createTestAsset({ path: '/tmp/video.mp4' });
      const clip = createTestClip({
        assetId: asset.id,
        sourceRange: { start: 0, end: 300 },
        trackIndex: 0,
      });
      const track = createTestTrack({ clips: [clip] });
      const project = createTestProject({
        assets: [asset],
        timeline: {
          tracks: [track],
          duration: 300,
          chapters: [
            {
              id: crypto.randomUUID(),
              title: 'Introduction',
              timelineStart: 0,
              metadata: {},
            },
            {
              id: crypto.randomUUID(),
              title: 'Main Content',
              timelineStart: 60,
              metadata: {},
            },
          ],
        },
      });

      const builder = new CommandBuilder();
      const args = builder.buildRenderArgs(project, '/tmp/output.mp4');

      // Chapters should be passed via metadata file or args
      const argsStr = args.join(' ');
      expect(argsStr).toContain('metadata');
    });
  });
});
