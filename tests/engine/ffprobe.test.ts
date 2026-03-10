/**
 * Tests for the ffprobe wrapper (using mocks).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { FFprobeWrapper } from '@/engine/ffprobe';
import { MockFFprobeRunner } from '../helpers/mocks';
import { SAMPLE_FFPROBE_OUTPUT } from '../helpers/fixtures';

describe('FFprobeWrapper', () => {
  let mockRunner: MockFFprobeRunner;
  let wrapper: FFprobeWrapper;

  beforeEach(() => {
    mockRunner = new MockFFprobeRunner();
    wrapper = new FFprobeWrapper(mockRunner);
  });

  // -------------------------------------------------------------------------
  // Basic probe
  // -------------------------------------------------------------------------

  describe('probe()', () => {
    it('calls ffprobe with correct file path', async () => {
      await wrapper.probe('/tmp/test.mp4');

      expect(mockRunner.calls).toHaveLength(1);
      expect(mockRunner.calls[0].method).toBe('probe');
      expect(mockRunner.calls[0].args[0]).toBe('/tmp/test.mp4');
    });

    it('parses JSON output correctly', async () => {
      const result = await wrapper.probe('/tmp/test.mp4');

      expect(result).toBeDefined();
      expect(result.streams).toBeInstanceOf(Array);
      expect(result.format).toBeDefined();
    });

    it('returns duration from format', async () => {
      const result = await wrapper.probe('/tmp/test.mp4');

      expect(result.format.duration).toBe('600.000000');
    });

    it('returns video stream properties', async () => {
      const result = await wrapper.probe('/tmp/test.mp4');

      const videoStream = result.streams.find((s: any) => s.codec_type === 'video');
      expect(videoStream).toBeDefined();
      expect(videoStream!.width).toBe(1920);
      expect(videoStream!.height).toBe(1080);
      expect(videoStream!.codec_name).toBe('h264');
    });

    it('returns audio stream properties', async () => {
      const result = await wrapper.probe('/tmp/test.mp4');

      const audioStream = result.streams.find((s: any) => s.codec_type === 'audio');
      expect(audioStream).toBeDefined();
      expect(audioStream!.codec_name).toBe('aac');
      expect(audioStream!.channels).toBe(2);
    });
  });

  // -------------------------------------------------------------------------
  // Missing streams
  // -------------------------------------------------------------------------

  describe('missing streams handling', () => {
    it('handles file with no audio stream', async () => {
      mockRunner.setResult({
        streams: [SAMPLE_FFPROBE_OUTPUT.streams[0]], // video only
        format: SAMPLE_FFPROBE_OUTPUT.format,
      } as any);

      const result = await wrapper.probe('/tmp/video-only.mp4');

      const audioStream = result.streams.find((s: any) => s.codec_type === 'audio');
      expect(audioStream).toBeUndefined();
    });

    it('handles file with no video stream', async () => {
      mockRunner.setResult({
        streams: [SAMPLE_FFPROBE_OUTPUT.streams[1]], // audio only
        format: SAMPLE_FFPROBE_OUTPUT.format,
      } as any);

      const result = await wrapper.probe('/tmp/audio-only.mp3');

      const videoStream = result.streams.find((s: any) => s.codec_type === 'video');
      expect(videoStream).toBeUndefined();
    });

    it('handles file with empty streams array', async () => {
      mockRunner.setResult({
        streams: [],
        format: SAMPLE_FFPROBE_OUTPUT.format,
      } as any);

      const result = await wrapper.probe('/tmp/empty.mp4');
      expect(result.streams).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // Error handling
  // -------------------------------------------------------------------------

  describe('error handling', () => {
    it('throws on invalid file', async () => {
      mockRunner.setError(new Error('No such file or directory'));

      await expect(wrapper.probe('/tmp/nonexistent.mp4')).rejects.toThrow(
        'No such file or directory',
      );
    });

    it('throws on corrupted file', async () => {
      mockRunner.setError(new Error('Invalid data found when processing input'));

      await expect(wrapper.probe('/tmp/corrupted.mp4')).rejects.toThrow('Invalid data');
    });
  });
});
