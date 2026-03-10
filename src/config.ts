/**
 * @module config
 * @description Configuration loading for the FFmpeg-LLM MCP server.
 * Reads from environment variables with fallback defaults.
 */

import { join } from 'path';
import { homedir } from 'os';

// ── Types ───────────────────────────────────────────────────────────────

/** Server configuration */
export interface Config {
  /** Path to the FFmpeg binary */
  ffmpegPath: string;
  /** Path to the FFprobe binary */
  ffprobePath: string;
  /** Path to the SQLite database file */
  dbPath: string;
  /** Default working directory for new projects */
  workDir: string;
  /** OpenRouter API key (optional — required for autopilot features) */
  openrouterApiKey?: string;
  /** Default LLM model for autopilot */
  defaultModel?: string;
}

// ── Defaults ────────────────────────────────────────────────────────────

/** Default configuration values */
export const DEFAULT_CONFIG: Config = {
  ffmpegPath: 'ffmpeg',
  ffprobePath: 'ffprobe',
  dbPath: join(homedir(), '.ffmpeg-llm', 'projects.db'),
  workDir: join(homedir(), '.ffmpeg-llm', 'projects'),
  defaultModel: 'google/gemini-2.0-flash-001',
};

// ── Loader ──────────────────────────────────────────────────────────────

/**
 * Load configuration from environment variables, falling back to defaults.
 *
 * Environment variables:
 * - `FFMPEG_PATH` — Path to ffmpeg binary
 * - `FFPROBE_PATH` — Path to ffprobe binary
 * - `FFMPEG_LLM_DB_PATH` — Path to SQLite database
 * - `FFMPEG_LLM_WORK_DIR` — Default working directory
 * - `OPENROUTER_API_KEY` — OpenRouter API key
 * - `FFMPEG_LLM_MODEL` — Default LLM model
 *
 * @returns Resolved configuration
 */
export function loadConfig(): Config {
  return {
    ffmpegPath: process.env['FFMPEG_PATH'] ?? DEFAULT_CONFIG.ffmpegPath,
    ffprobePath: process.env['FFPROBE_PATH'] ?? DEFAULT_CONFIG.ffprobePath,
    dbPath: process.env['FFMPEG_LLM_DB_PATH'] ?? DEFAULT_CONFIG.dbPath,
    workDir: process.env['FFMPEG_LLM_WORK_DIR'] ?? DEFAULT_CONFIG.workDir,
    openrouterApiKey: process.env['OPENROUTER_API_KEY'],
    defaultModel: process.env['FFMPEG_LLM_MODEL'] ?? DEFAULT_CONFIG.defaultModel,
  };
}
