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

// ── FFprobe Runner ──────────────────────────────────────────────────────

/**
 * Wraps the ffprobe CLI for extracting media file metadata.
 */
export class FFprobeRunner {
  private readonly binaryPath: string;

  /**
   * @param ffprobePath - Path to the ffprobe binary. Defaults to 'ffprobe'.
   */
  constructor(ffprobePath?: string) {
    this.binaryPath = ffprobePath ?? 'ffprobe';
  }

  /**
   * Run a full probe on a media file, returning format and stream info.
   * Invokes: ffprobe -v quiet -print_format json -show_format -show_streams <file>
   * @param filePath - Absolute path to the media file
   * @returns Parsed probe result
   */
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
    // TODO: Add error handling for malformed JSON
    const parsed = JSON.parse(output) as ProbeResult;
    return parsed;
  }

  /**
   * Get only the stream information for a media file.
   * @param filePath - Absolute path to the media file
   * @returns Array of stream info objects
   */
  async getStreams(filePath: string): Promise<StreamInfo[]> {
    const result = await this.probe(filePath);
    return result.streams;
  }

  /**
   * Get the total duration of a media file in seconds.
   * @param filePath - Absolute path to the media file
   * @returns Duration in seconds
   */
  async getDuration(filePath: string): Promise<number> {
    const result = await this.probe(filePath);
    return parseFloat(result.format.duration);
  }

  /**
   * Spawn ffprobe and capture stdout.
   * @param args - Command-line arguments
   * @returns stdout as a string
   */
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
