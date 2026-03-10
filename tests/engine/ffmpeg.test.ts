/**
 * Tests for the FFmpeg wrapper (using mocks).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { FFmpegWrapper } from '@/engine/ffmpeg';
import { MockFFmpegRunner } from '../helpers/mocks';
import { SAMPLE_PROGRESS_LINE } from '../helpers/fixtures';

describe('FFmpegWrapper', () => {
  let mockRunner: MockFFmpegRunner;
  let wrapper: FFmpegWrapper;

  beforeEach(() => {
    mockRunner = new MockFFmpegRunner();
    wrapper = new FFmpegWrapper(mockRunner);
  });

  // -------------------------------------------------------------------------
  // Basic execution
  // -------------------------------------------------------------------------

  describe('run()', () => {
    it('spawns process with correct args', async () => {
      const args = ['-i', 'input.mp4', '-c:v', 'libx264', 'output.mp4'];
      await wrapper.run(args);

      expect(mockRunner.calls).toHaveLength(1);
      expect(mockRunner.calls[0].method).toBe('run');
      expect(mockRunner.calls[0].args[0]).toEqual(args);
    });

    it('captures stdout', async () => {
      mockRunner.setResult({ stdout: 'ffmpeg version 6.1' });

      const result = await wrapper.run(['-version']);

      expect(result.stdout).toContain('ffmpeg version');
    });

    it('captures stderr', async () => {
      mockRunner.setResult({
        stderr: SAMPLE_PROGRESS_LINE,
        exitCode: 0,
      });

      const result = await wrapper.run(['-i', 'input.mp4', 'output.mp4']);

      expect(result.stderr).toContain('frame=');
    });

    it('returns exit code', async () => {
      mockRunner.setResult({ exitCode: 0 });
      const successResult = await wrapper.run(['-i', 'input.mp4', 'output.mp4']);
      expect(successResult.exitCode).toBe(0);

      mockRunner.setResult({ exitCode: 1 });
      const failResult = await wrapper.run(['-i', 'bad.mp4', 'output.mp4']);
      expect(failResult.exitCode).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // Progress parsing
  // -------------------------------------------------------------------------

  describe('progress parsing', () => {
    it('parses frame count from stderr progress line', () => {
      const progress = wrapper.parseProgress(SAMPLE_PROGRESS_LINE);

      expect(progress).toBeDefined();
      expect(progress!.frame).toBe(5400);
    });

    it('parses fps from stderr progress line', () => {
      const progress = wrapper.parseProgress(SAMPLE_PROGRESS_LINE);

      expect(progress!.fps).toBe(120);
    });

    it('parses time from stderr progress line', () => {
      const progress = wrapper.parseProgress(SAMPLE_PROGRESS_LINE);

      expect(progress!.time).toBe('00:03:00.00');
    });

    it('parses speed from stderr progress line', () => {
      const progress = wrapper.parseProgress(SAMPLE_PROGRESS_LINE);

      expect(progress!.speed).toBe(4.0);
    });

    it('parses size from stderr progress line', () => {
      const progress = wrapper.parseProgress(SAMPLE_PROGRESS_LINE);

      expect(progress!.size).toBeDefined();
    });

    it('returns null for non-progress lines', () => {
      const progress = wrapper.parseProgress('Stream #0:0: Video: h264');
      expect(progress).toBeNull();
    });

    it('handles malformed progress lines gracefully', () => {
      const _progress = wrapper.parseProgress('frame= fps= q= size= time= bitrate= speed=');
      // Should not throw, may return null or partial data
      expect(() => wrapper.parseProgress('garbage data')).not.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // Timeout handling
  // -------------------------------------------------------------------------

  describe('timeout handling', () => {
    it('respects timeout configuration', async () => {
      // The wrapper should accept a timeout option
      const args = ['-i', 'input.mp4', 'output.mp4'];
      const options = { timeout: 5000 };

      // Should complete without error when mock returns immediately
      const result = await wrapper.run(args, options);
      expect(result.exitCode).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // Multiple sequential runs
  // -------------------------------------------------------------------------

  describe('multiple runs', () => {
    it('records all calls independently', async () => {
      await wrapper.run(['-i', 'a.mp4', 'out1.mp4']);
      await wrapper.run(['-i', 'b.mp4', 'out2.mp4']);
      await wrapper.run(['-i', 'c.mp4', 'out3.mp4']);

      expect(mockRunner.calls).toHaveLength(3);
      expect((mockRunner.calls[0].args[0] as string[])[1]).toBe('a.mp4');
      expect((mockRunner.calls[1].args[0] as string[])[1]).toBe('b.mp4');
      expect((mockRunner.calls[2].args[0] as string[])[1]).toBe('c.mp4');
    });
  });
});
