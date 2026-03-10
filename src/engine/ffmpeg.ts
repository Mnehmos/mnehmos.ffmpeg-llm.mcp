/**
 * @module engine/ffmpeg
 * @description FFmpeg CLI wrapper with progress parsing and process management.
 */

import { spawn } from 'child_process';
import type { SpawnOptions } from 'child_process';

// ── Types ───────────────────────────────────────────────────────────────

/** Result of an FFmpeg invocation */
export interface FFmpegResult {
  /** Process exit code */
  exitCode: number;
  /** Captured stdout */
  stdout: string;
  /** Captured stderr */
  stderr: string;
  /** Wall-clock duration of the process in milliseconds */
  durationMs: number;
}

/** Progress information parsed from FFmpeg stderr */
export interface Progress {
  /** Current frame number */
  frame: number;
  /** Current processing speed in fps */
  fps: number;
  /** Current time position as seconds */
  time: number;
  /** Processing speed multiplier (e.g., 1.5x) */
  speed: number;
  /** Current output size in bytes */
  size: number;
}

// ── Progress Parsing ────────────────────────────────────────────────────

/** Regex patterns for extracting progress fields from FFmpeg stderr */
const PROGRESS_PATTERNS = {
  frame: /frame=\s*(\d+)/,
  fps: /fps=\s*([\d.]+)/,
  time: /time=\s*(\d{2}):(\d{2}):(\d{2})\.(\d{2,3})/,
  speed: /speed=\s*([\d.]+)x/,
  size: /size=\s*(\d+)kB/,
} as const;

/**
 * Parse a progress line from FFmpeg stderr output.
 * @param line - A single line of FFmpeg stderr output
 * @returns Parsed progress or null if the line is not a progress line
 */
export function parseProgressLine(line: string): Progress | null {
  const frameMatch = PROGRESS_PATTERNS.frame.exec(line);
  if (!frameMatch) return null;

  const fpsMatch = PROGRESS_PATTERNS.fps.exec(line);
  const timeMatch = PROGRESS_PATTERNS.time.exec(line);
  const speedMatch = PROGRESS_PATTERNS.speed.exec(line);
  const sizeMatch = PROGRESS_PATTERNS.size.exec(line);

  let timeSeconds = 0;
  if (timeMatch) {
    timeSeconds =
      parseInt(timeMatch[1], 10) * 3600 +
      parseInt(timeMatch[2], 10) * 60 +
      parseInt(timeMatch[3], 10) +
      parseInt(timeMatch[4], 10) / (timeMatch[4].length === 2 ? 100 : 1000);
  }

  return {
    frame: parseInt(frameMatch[1], 10),
    fps: fpsMatch ? parseFloat(fpsMatch[1]) : 0,
    time: timeSeconds,
    speed: speedMatch ? parseFloat(speedMatch[1]) : 0,
    size: sizeMatch ? parseInt(sizeMatch[1], 10) * 1024 : 0,
  };
}

// ── FFmpeg Runner ───────────────────────────────────────────────────────

/**
 * Wraps the FFmpeg CLI binary for spawning encode/filter operations.
 */
export class FFmpegRunner {
  private readonly binaryPath: string;

  /**
   * @param ffmpegPath - Path to the ffmpeg binary. Defaults to 'ffmpeg' (found via PATH).
   */
  constructor(ffmpegPath?: string) {
    this.binaryPath = ffmpegPath ?? FFmpegRunner.findBinary();
  }

  /**
   * Run FFmpeg with the given arguments and wait for completion.
   * @param args - FFmpeg command-line arguments (without the binary name)
   * @param opts - Optional spawn options
   * @returns The complete result including exit code, stdout, stderr, and duration
   */
  async run(args: string[], opts?: SpawnOptions): Promise<FFmpegResult> {
    // TODO: Implement process spawning with stdout/stderr capture
    const startTime = Date.now();
    return new Promise<FFmpegResult>((resolve, reject) => {
      const proc = spawn(this.binaryPath, args, {
        ...opts,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';

      proc.stdout?.on('data', (chunk: Buffer) => {
        stdout += chunk.toString();
      });

      proc.stderr?.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
      });

      proc.on('error', (err) => {
        reject(err);
      });

      proc.on('close', (code) => {
        resolve({
          exitCode: code ?? 1,
          stdout,
          stderr,
          durationMs: Date.now() - startTime,
        });
      });
    });
  }

  /**
   * Run FFmpeg with real-time progress callbacks.
   * @param args - FFmpeg command-line arguments
   * @param onProgress - Callback invoked with each parsed progress update
   * @returns The complete result
   */
  async runWithProgress(args: string[], onProgress: (p: Progress) => void): Promise<FFmpegResult> {
    // TODO: Implement with line-by-line stderr parsing calling onProgress
    const startTime = Date.now();
    return new Promise<FFmpegResult>((resolve, reject) => {
      const proc = spawn(this.binaryPath, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';
      let lineBuffer = '';

      proc.stdout?.on('data', (chunk: Buffer) => {
        stdout += chunk.toString();
      });

      proc.stderr?.on('data', (chunk: Buffer) => {
        const text = chunk.toString();
        stderr += text;

        // FFmpeg progress uses \r for in-place updates
        lineBuffer += text;
        const lines = lineBuffer.split(/\r|\n/);
        lineBuffer = lines.pop() ?? '';

        for (const line of lines) {
          const progress = parseProgressLine(line);
          if (progress) {
            onProgress(progress);
          }
        }
      });

      proc.on('error', (err) => {
        reject(err);
      });

      proc.on('close', (code) => {
        resolve({
          exitCode: code ?? 1,
          stdout,
          stderr,
          durationMs: Date.now() - startTime,
        });
      });
    });
  }

  /**
   * Attempt to locate the FFmpeg binary on the system.
   * Checks PATH, then common installation locations on Windows.
   * @returns Path to the ffmpeg binary
   */
  static findBinary(): string {
    // TODO: Implement platform-specific binary search
    // Check: PATH, C:\ffmpeg\bin\ffmpeg.exe, /usr/bin/ffmpeg, /usr/local/bin/ffmpeg
    return 'ffmpeg';
  }
}
