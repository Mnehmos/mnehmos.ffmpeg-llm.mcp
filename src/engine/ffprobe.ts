/**
 * @module engine/ffprobe
 * @description FFprobe wrapper for media file inspection. Extracts format
 * metadata, stream details, and duration information.
 */

import { spawn } from 'child_process';

// ── Types ───────────────────────────────────────────────────────────────

/** Information about a single stream in a media file */
export interface StreamInfo {
  /** Stream index within the file */
  index: number;
  /** Stream type: 'video', 'audio', 'subtitle', 'data' */
  codec_type: string;
  /** Codec name (e.g., 'h264', 'aac') */
  codec_name: string;
  /** Frame width in pixels (video only) */
  width?: number;
  /** Frame height in pixels (video only) */
  height?: number;
  /** Duration in seconds as string */
  duration?: string;
  /** Audio sample rate in Hz (audio only) */
  sample_rate?: string;
  /** Number of audio channels (audio only) */
  channels?: number;
  /** Bit rate in bits per second */
  bit_rate?: string;
  /** Frame rate as fraction string (video only, e.g., '30/1') */
  r_frame_rate?: string;
}

/** Format-level metadata from ffprobe */
export interface FormatInfo {
  /** File path */
  filename: string;
  /** Number of streams */
  nb_streams: number;
  /** Format name (e.g., 'mov,mp4,m4a,3gp,3g2,mj2') */
  format_name: string;
  /** Format long name */
  format_long_name: string;
  /** Duration in seconds as string */
  duration: string;
  /** File size in bytes as string */
  size: string;
  /** Overall bit rate as string */
  bit_rate: string;
  /** Format-level tags */
  tags?: Record<string, string>;
}

/** Complete probe result with format and streams */
export interface ProbeResult {
  /** Format-level metadata */
  format: FormatInfo;
  /** All streams in the file */
  streams: StreamInfo[];
}

// ── FFprobe Runner Interface ────────────────────────────────────────────

/** Interface for FFprobe execution (injectable for testing) */
export interface FFprobeRunner {
  probe(filePath: string): Promise<ProbeResult>;
}

// ── FFprobe Wrapper ─────────────────────────────────────────────────────

/**
 * Wrapper around an FFprobeRunner (real or mock) for media inspection.
 */
export class FFprobeWrapper {
  private readonly runner: FFprobeRunner;

  constructor(runner: FFprobeRunner) {
    this.runner = runner;
  }

  async probe(filePath: string): Promise<ProbeResult> {
    return this.runner.probe(filePath);
  }
}

// ── Real FFprobe Runner (for production) ────────────────────────────────

export class RealFFprobeRunner implements FFprobeRunner {
  private readonly binaryPath: string;

  constructor(ffprobePath?: string) {
    this.binaryPath = ffprobePath ?? 'ffprobe';
  }

  async probe(filePath: string): Promise<ProbeResult> {
    const args = [
      '-v',
      'quiet',
      '-print_format',
      'json',
      '-show_format',
      '-show_streams',
      filePath,
    ];

    const output = await this._run(args);
    const parsed = JSON.parse(output) as ProbeResult;
    return parsed;
  }

  private async _run(args: string[]): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const proc = spawn(this.binaryPath, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString();
      });

      proc.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
      });

      proc.on('error', (err) => {
        reject(new Error(`Failed to spawn ffprobe: ${err.message}`));
      });

      proc.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`ffprobe exited with code ${code}: ${stderr}`));
        } else {
          resolve(stdout);
        }
      });
    });
  }
}
