/**
 * @module engine/ffmpeg
 * @description FFmpeg CLI wrapper with progress parsing and process management.
 */

import { spawn } from 'child_process';
import type { SpawnOptions } from 'child_process';

// ── Types ───────────────────────────────────────────────────────────────

/** Result of an FFmpeg invocation */
export interface FFmpegResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/** Progress information parsed from FFmpeg stderr */
export interface Progress {
  frame: number;
  fps: number;
  time: string;
  speed: number;
  size: string;
}

/** Interface for FFmpeg execution (injectable for testing) */
export interface FFmpegRunner {
  run(args: string[]): Promise<FFmpegResult>;
}

// ── Progress Parsing ────────────────────────────────────────────────────

const PROGRESS_RE = {
  frame: /frame=\s*(\d+)/,
  fps: /fps=\s*([\d.]+)/,
  time: /time=\s*([\d:.]+)/,
  speed: /speed=\s*([\d.]+)x/,
  size: /size=\s*(\d+\s*kB)/,
} as const;

// ── FFmpegWrapper ───────────────────────────────────────────────────────

/**
 * Wrapper around an FFmpegRunner (real or mock) with progress parsing.
 */
export class FFmpegWrapper {
  private readonly runner: FFmpegRunner;

  constructor(runner: FFmpegRunner) {
    this.runner = runner;
  }

  async run(args: string[], _options?: { timeout?: number }): Promise<FFmpegResult> {
    return this.runner.run(args);
  }

  parseProgress(line: string): Progress | null {
    const frameMatch = PROGRESS_RE.frame.exec(line);
    if (!frameMatch) return null;

    const fpsMatch = PROGRESS_RE.fps.exec(line);
    const timeMatch = PROGRESS_RE.time.exec(line);
    const speedMatch = PROGRESS_RE.speed.exec(line);
    const sizeMatch = PROGRESS_RE.size.exec(line);

    return {
      frame: parseInt(frameMatch[1], 10),
      fps: fpsMatch ? parseFloat(fpsMatch[1]) : 0,
      time: timeMatch ? timeMatch[1] : '00:00:00.00',
      speed: speedMatch ? parseFloat(speedMatch[1]) : 0,
      size: sizeMatch ? sizeMatch[1].trim() : '0kB',
    };
  }
}

// ── Real FFmpeg Runner (for production) ─────────────────────────────────

export class RealFFmpegRunner implements FFmpegRunner {
  private readonly binaryPath: string;

  constructor(ffmpegPath?: string) {
    this.binaryPath = ffmpegPath ?? 'ffmpeg';
  }

  async run(args: string[], opts?: SpawnOptions): Promise<FFmpegResult> {
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
      proc.on('error', reject);
      proc.on('close', (code) => {
        resolve({ exitCode: code ?? 1, stdout, stderr });
      });
    });
  }
}

export { parseProgressLine };
function parseProgressLine(line: string): Progress | null {
  const w = new FFmpegWrapper({ run: async () => ({ exitCode: 0, stdout: '', stderr: '' }) });
  return w.parseProgress(line);
}
