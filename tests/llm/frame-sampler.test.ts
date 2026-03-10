/**
 * Tests for the frame sampler.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { FrameSampler } from '@/llm/frame-sampler';
import { MockFFmpegRunner } from '../helpers/mocks';
import { join } from 'path';
import { mkdtemp, writeFile, rm } from 'fs/promises';
import { tmpdir } from 'os';

describe('FrameSampler', () => {
  let ffmpeg: MockFFmpegRunner;
  let tempDir: string;
  let sampler: FrameSampler;

  beforeEach(async () => {
    ffmpeg = new MockFFmpegRunner();
    tempDir = await mkdtemp(join(tmpdir(), 'ffmpeg-llm-test-'));
    sampler = new FrameSampler(tempDir);
  });

  // Cleanup
  afterEach(async () => {
    try {
      await rm(tempDir, { recursive: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  // -------------------------------------------------------------------------
  // sampleFrames (interval-based)
  // -------------------------------------------------------------------------

  describe('sampleFrames', () => {
    it('calls FFmpeg with fps filter and correct interval', async () => {
      ffmpeg.setResult({ exitCode: 0 });

      await sampler.sampleFrames('/tmp/video.mp4', 10, ffmpeg);

      expect(ffmpeg.calls).toHaveLength(1);
      const args = ffmpeg.calls[0].args[0] as string[];
      expect(args).toContain('-vf');
      expect(args.join(' ')).toContain('fps=1/10');
    });

    it('throws on FFmpeg failure', async () => {
      ffmpeg.setResult({ exitCode: 1, stderr: 'Invalid input' });

      await expect(sampler.sampleFrames('/tmp/bad.mp4', 5, ffmpeg)).rejects.toThrow(
        'Frame sampling failed',
      );
    });

    it('reads generated frame files into buffers', async () => {
      ffmpeg.setResult({ exitCode: 0 });

      // Simulate FFmpeg generating frame files
      const fakeJpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0]); // JPEG magic bytes
      await writeFile(join(tempDir, 'frame_0001.jpg'), fakeJpg);
      await writeFile(join(tempDir, 'frame_0002.jpg'), fakeJpg);
      await writeFile(join(tempDir, 'frame_0003.jpg'), fakeJpg);

      const frames = await sampler.sampleFrames('/tmp/video.mp4', 5, ffmpeg);

      expect(frames).toHaveLength(3);
      expect(frames[0].timestamp).toBe(0);
      expect(frames[1].timestamp).toBe(5);
      expect(frames[2].timestamp).toBe(10);
      expect(frames[0].imageBuffer).toBeInstanceOf(Buffer);
      expect(frames[0].imageBuffer.length).toBe(4);
    });

    it('returns empty array when no frames generated', async () => {
      ffmpeg.setResult({ exitCode: 0 });

      const frames = await sampler.sampleFrames('/tmp/video.mp4', 30, ffmpeg);
      expect(frames).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // sampleFramesAtTimestamps
  // -------------------------------------------------------------------------

  describe('sampleFramesAtTimestamps', () => {
    it('calls FFmpeg once per timestamp', async () => {
      ffmpeg.setResult({ exitCode: 0 });
      const timestamps = [1.0, 5.5, 10.0];

      // Pre-create output files that FFmpeg would generate
      for (const ts of timestamps) {
        const path = join(tempDir, `frame_${ts.toFixed(3).replace('.', '_')}.jpg`);
        await writeFile(path, Buffer.from([0xff, 0xd8]));
      }

      const frames = await sampler.sampleFramesAtTimestamps('/tmp/video.mp4', timestamps, ffmpeg);

      expect(ffmpeg.calls).toHaveLength(3);
      expect(frames).toHaveLength(3);
      expect(frames[0].timestamp).toBe(1.0);
      expect(frames[1].timestamp).toBe(5.5);
      expect(frames[2].timestamp).toBe(10.0);
    });

    it('skips frames that fail to extract', async () => {
      ffmpeg.setResult({ exitCode: 1, stderr: 'seek error' });

      const frames = await sampler.sampleFramesAtTimestamps('/tmp/video.mp4', [1.0, 5.0], ffmpeg);

      expect(frames).toEqual([]);
    });

    it('extracts frames at correct timestamps', async () => {
      ffmpeg.setResult({ exitCode: 0 });
      const ts = 42.5;
      const path = join(tempDir, `frame_${ts.toFixed(3).replace('.', '_')}.jpg`);
      await writeFile(path, Buffer.from([0xff]));

      const frames = await sampler.sampleFramesAtTimestamps('/tmp/video.mp4', [ts], ffmpeg);

      expect(frames).toHaveLength(1);
      const args = ffmpeg.calls[0].args[0] as string[];
      expect(args).toContain('-ss');
      expect(args).toContain('42.5');
    });
  });
});
