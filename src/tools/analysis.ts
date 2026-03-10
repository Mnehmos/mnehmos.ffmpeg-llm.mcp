/**
 * @module tools/analysis
 * @description Tool handlers for media analysis using FFmpeg/FFprobe:
 * audio level analysis, scene change detection, silence detection, and duration info.
 */

import { z } from 'zod';
import { ToolAction, ToolCategory, registerTool, type ToolResult } from './actionEnum.js';
import type { Storage } from '../storage/db.js';
import { FFmpegRunner } from '../engine/ffmpeg.js';
import { FFprobeRunner } from '../engine/ffprobe.js';

// ── Schemas ─────────────────────────────────────────────────────────────

const AnalyzeAudioLevelsSchema = z.object({
  projectId: z.string().uuid(),
  assetId: z.string().uuid(),
});

const AnalyzeSceneChangesSchema = z.object({
  projectId: z.string().uuid(),
  assetId: z.string().uuid(),
  threshold: z.number().min(0).max(1).default(0.3).describe('Scene change sensitivity (0-1)'),
});

const AnalyzeSilenceSchema = z.object({
  projectId: z.string().uuid(),
  assetId: z.string().uuid(),
  noiseDb: z.number().default(-30).describe('Noise floor in dB (e.g., -30)'),
  minDuration: z.number().positive().default(0.5).describe('Minimum silence duration in seconds'),
});

const AnalyzeDurationSchema = z.object({
  projectId: z.string().uuid(),
  assetId: z.string().uuid(),
});

// ── Result Types ────────────────────────────────────────────────────────

/** Audio level statistics from astats analysis */
export interface AudioLevelResult {
  /** Peak level in dB */
  peakDb: number;
  /** RMS level in dB */
  rmsDb: number;
  /** Dynamic range in dB */
  dynamicRange: number;
  /** Raw FFmpeg output for further parsing */
  rawOutput: string;
}

/** A detected scene change point */
export interface SceneChange {
  /** Timestamp in seconds where the scene changes */
  timestamp: number;
  /** Scene change score (0-1) */
  score: number;
}

/** A detected silence region */
export interface SilenceRegion {
  /** Start of silence in seconds */
  start: number;
  /** End of silence in seconds */
  end: number;
  /** Duration of silence in seconds */
  duration: number;
}

// ── Registration ────────────────────────────────────────────────────────

/**
 * Register all analysis tools (4 total).
 * @param _registry - Unused
 * @param db - Storage instance
 * @param ffmpeg - FFmpeg runner for filter-based analysis
 * @param ffprobe - FFprobe runner for metadata queries
 */
// ── Parsing Helpers ─────────────────────────────────────────────────────

const PEAK_RE = /Peak level dB:\s*([-\d.]+)/;
const RMS_RE = /RMS level dB:\s*([-\d.]+)/;

/**
 * Parse FFmpeg astats filter output from stderr.
 * Extracts peak level, RMS level, and dynamic range.
 */
export function parseAudioLevels(stderr: string): AudioLevelResult {
  const peakMatch = PEAK_RE.exec(stderr);
  const rmsMatch = RMS_RE.exec(stderr);

  const peakDb = peakMatch ? parseFloat(peakMatch[1]) : 0;
  const rmsDb = rmsMatch ? parseFloat(rmsMatch[1]) : 0;
  const dynamicRange = Math.abs(peakDb - rmsDb);

  return { peakDb, rmsDb, dynamicRange, rawOutput: stderr };
}

const SCENE_PTS_RE = /pts_time:([\d.]+)/g;
const SCENE_SCORE_RE = /scene:([\d.]+)/g;

/**
 * Parse FFmpeg showinfo filter output for scene change timestamps.
 * Looks for "pts_time:X.XXX" and optionally "scene:X.XXX" patterns.
 */
export function parseSceneChanges(stderr: string): SceneChange[] {
  const changes: SceneChange[] = [];
  const lines = stderr.split('\n');

  for (const line of lines) {
    if (!line.includes('pts_time')) continue;

    const ptsMatch = /pts_time:([\d.]+)/.exec(line);
    if (!ptsMatch) continue;

    const scoreMatch = /scene:([\d.]+)/.exec(line);
    changes.push({
      timestamp: parseFloat(ptsMatch[1]),
      score: scoreMatch ? parseFloat(scoreMatch[1]) : 1.0,
    });
  }

  // Reset global regex state
  SCENE_PTS_RE.lastIndex = 0;
  SCENE_SCORE_RE.lastIndex = 0;

  return changes;
}

const SILENCE_START_RE = /silence_start:\s*([\d.]+)/g;
const SILENCE_END_RE = /silence_end:\s*([\d.]+)\s*\|\s*silence_duration:\s*([\d.]+)/g;

/**
 * Parse FFmpeg silencedetect output for silence regions.
 * Matches "silence_start: X.XXX" and "silence_end: X.XXX | silence_duration: X.XXX".
 */
export function parseSilenceRegions(stderr: string): SilenceRegion[] {
  const regions: SilenceRegion[] = [];
  const starts: number[] = [];

  // Collect all silence_start values
  let match: RegExpExecArray | null;
  SILENCE_START_RE.lastIndex = 0;
  while ((match = SILENCE_START_RE.exec(stderr)) !== null) {
    starts.push(parseFloat(match[1]));
  }

  // Collect all silence_end + duration values
  let idx = 0;
  SILENCE_END_RE.lastIndex = 0;
  while ((match = SILENCE_END_RE.exec(stderr)) !== null) {
    const end = parseFloat(match[1]);
    const duration = parseFloat(match[2]);
    const start = idx < starts.length ? starts[idx] : end - duration;
    regions.push({ start, end, duration });
    idx++;
  }

  return regions;
}

// ── Registration ────────────────────────────────────────────────────────

export function registerAnalysisTools(
  _registry: unknown,
  db: Storage,
  ffmpeg: FFmpegRunner,
  ffprobe: FFprobeRunner,
): void {
  registerTool({
    action: ToolAction.ANALYZE_AUDIO_LEVELS,
    category: ToolCategory.ANALYSIS,
    description: 'Analyze audio levels of an asset using FFmpeg astats filter',
    schema: AnalyzeAudioLevelsSchema,
    handler: async (params): Promise<ToolResult> => {
      const { projectId, assetId } = params as z.infer<typeof AnalyzeAudioLevelsSchema>;

      const project = db.getProject(projectId);
      if (!project) return { success: false, error: `Project not found: ${projectId}` };

      const asset = project.assets.find((a) => a.id === assetId);
      if (!asset) return { success: false, error: `Asset not found: ${assetId}` };

      // Run: ffmpeg -i <file> -af astats=metadata=1:reset=1 -f null /dev/null
      const args = [
        '-i',
        asset.path,
        '-af',
        'astats=metadata=1:reset=1',
        '-f',
        'null',
        process.platform === 'win32' ? 'NUL' : '/dev/null',
      ];

      const ffResult = await ffmpeg.run(args);

      const audioLevels = parseAudioLevels(ffResult.stderr);

      return {
        success: true,
        data: audioLevels,
        summary: `Audio analysis complete for "${asset.originalName}"`,
      };
    },
  });

  registerTool({
    action: ToolAction.ANALYZE_SCENE_CHANGES,
    category: ToolCategory.ANALYSIS,
    description: 'Detect scene changes in a video using frame difference analysis',
    schema: AnalyzeSceneChangesSchema,
    handler: async (params): Promise<ToolResult> => {
      const { projectId, assetId, threshold } = params as z.infer<typeof AnalyzeSceneChangesSchema>;

      const project = db.getProject(projectId);
      if (!project) return { success: false, error: `Project not found: ${projectId}` };

      const asset = project.assets.find((a) => a.id === assetId);
      if (!asset) return { success: false, error: `Asset not found: ${assetId}` };

      // Run: ffmpeg -i <file> -vf "select='gt(scene,threshold)',showinfo" -f null /dev/null
      const args = [
        '-i',
        asset.path,
        '-vf',
        `select='gt(scene,${threshold})',showinfo`,
        '-f',
        'null',
        process.platform === 'win32' ? 'NUL' : '/dev/null',
      ];

      const sceneResult = await ffmpeg.run(args);
      const sceneChanges = parseSceneChanges(sceneResult.stderr);

      return {
        success: true,
        data: { sceneChanges, threshold },
        summary: `Detected ${sceneChanges.length} scene change(s) at threshold ${threshold}`,
      };
    },
  });

  registerTool({
    action: ToolAction.ANALYZE_SILENCE,
    category: ToolCategory.ANALYSIS,
    description: 'Detect silent regions in audio using FFmpeg silencedetect',
    schema: AnalyzeSilenceSchema,
    handler: async (params): Promise<ToolResult> => {
      const { projectId, assetId, noiseDb, minDuration } = params as z.infer<
        typeof AnalyzeSilenceSchema
      >;

      const project = db.getProject(projectId);
      if (!project) return { success: false, error: `Project not found: ${projectId}` };

      const asset = project.assets.find((a) => a.id === assetId);
      if (!asset) return { success: false, error: `Asset not found: ${assetId}` };

      // Run: ffmpeg -i <file> -af silencedetect=noise=<db>dB:d=<duration> -f null /dev/null
      const args = [
        '-i',
        asset.path,
        '-af',
        `silencedetect=noise=${noiseDb}dB:d=${minDuration}`,
        '-f',
        'null',
        process.platform === 'win32' ? 'NUL' : '/dev/null',
      ];

      const silenceResult = await ffmpeg.run(args);
      const silenceRegions = parseSilenceRegions(silenceResult.stderr);

      return {
        success: true,
        data: { silenceRegions, noiseDb, minDuration },
        summary: `Detected ${silenceRegions.length} silence region(s)`,
      };
    },
  });

  registerTool({
    action: ToolAction.ANALYZE_DURATION,
    category: ToolCategory.ANALYSIS,
    description: 'Get the precise duration of a media asset using FFprobe',
    schema: AnalyzeDurationSchema,
    handler: async (params): Promise<ToolResult> => {
      const { projectId, assetId } = params as z.infer<typeof AnalyzeDurationSchema>;

      const project = db.getProject(projectId);
      if (!project) return { success: false, error: `Project not found: ${projectId}` };

      const asset = project.assets.find((a) => a.id === assetId);
      if (!asset) return { success: false, error: `Asset not found: ${assetId}` };

      const probeResult = await ffprobe.probe(asset.path);
      const duration = parseFloat(probeResult.format.duration);

      return {
        success: true,
        data: { duration, assetId, assetName: asset.originalName },
        summary: `Duration: ${duration.toFixed(3)}s`,
      };
    },
  });
}
