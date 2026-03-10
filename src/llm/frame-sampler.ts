/**
 * @module llm/frame-sampler
 * @description Extracts frames from video at regular intervals or specific
 * timestamps for use in LLM vision analysis.
 */

import { readFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { FFmpegRunner } from '../engine/ffmpeg.js';

// ── Types ───────────────────────────────────────────────────────────────

/** A single sampled frame with its image data */
export interface SampledFrame {
  /** Timestamp in seconds where the frame was extracted */
  timestamp: number;
  /** Path to the extracted image file */
  imagePath: string;
  /** Raw image data as a Buffer */
  imageBuffer: Buffer;
}

// ── Frame Sampler ───────────────────────────────────────────────────────

/**
 * Extracts frames from video files for vision-based LLM analysis.
 */
export class FrameSampler {
  private readonly tempDir: string;

  /**
   * @param tempDir - Directory for temporary frame files. Defaults to OS temp dir.
   */
  constructor(tempDir?: string) {
    this.tempDir = tempDir ?? tmpdir();
  }

  /**
   * Sample frames at regular intervals throughout a video.
   *
   * @param assetPath - Absolute path to the video file
   * @param intervalSeconds - Interval between frames in seconds
   * @param ffmpeg - FFmpegRunner instance
   * @returns Array of sampled frames with image data
   */
  async sampleFrames(
    assetPath: string,
    intervalSeconds: number,
    ffmpeg: FFmpegRunner,
  ): Promise<SampledFrame[]> {
    // TODO: Implement interval-based frame sampling
    // 1. Get video duration via ffprobe
    // 2. Calculate timestamps at each interval
    // 3. Extract frames at each timestamp
    // 4. Read image files into buffers

    const outputPattern = join(this.tempDir, `frame_%04d.jpg`);

    // Use fps filter to extract at interval
    const args = [
      '-i',
      assetPath,
      '-vf',
      `fps=1/${intervalSeconds}`,
      '-q:v',
      '2',
      '-y',
      outputPattern,
    ];

    const result = await ffmpeg.run(args);
    if (result.exitCode !== 0) {
      throw new Error(`Frame sampling failed: ${result.stderr.slice(0, 500)}`);
    }

    // TODO: Read generated frame files and build SampledFrame array
    // Parse frame count from ffmpeg output
    const frames: SampledFrame[] = [];
    return frames;
  }

  /**
   * Sample frames at specific timestamps.
   *
   * @param assetPath - Absolute path to the video file
   * @param timestamps - Array of timestamps in seconds
   * @param ffmpeg - FFmpegRunner instance
   * @returns Array of sampled frames with image data
   */
  async sampleFramesAtTimestamps(
    assetPath: string,
    timestamps: number[],
    ffmpeg: FFmpegRunner,
  ): Promise<SampledFrame[]> {
    const frames: SampledFrame[] = [];

    for (const ts of timestamps) {
      const outputPath = join(this.tempDir, `frame_${ts.toFixed(3).replace('.', '_')}.jpg`);

      const args = [
        '-ss',
        String(ts),
        '-i',
        assetPath,
        '-frames:v',
        '1',
        '-q:v',
        '2',
        '-y',
        outputPath,
      ];

      const result = await ffmpeg.run(args);
      if (result.exitCode !== 0) {
        // Skip failed frames but continue
        continue;
      }

      try {
        const imageBuffer = await readFile(outputPath);
        frames.push({
          timestamp: ts,
          imagePath: outputPath,
          imageBuffer,
        });
      } catch {
        // Frame file not created — skip
      }
    }

    return frames;
  }
}
