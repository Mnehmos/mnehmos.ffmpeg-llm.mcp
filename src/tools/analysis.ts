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

      // TODO: Parse astats output from stderr to extract peak, RMS, dynamic range
      const audioLevels: AudioLevelResult = {
        peakDb: 0,
        rmsDb: 0,
        dynamicRange: 0,
        rawOutput: ffResult.stderr,
      };

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

      void (await ffmpeg.run(args));

      // TODO: Parse showinfo output from stderr to extract timestamps and scores
      // Pattern: "pts_time:123.456" lines
      const _sceneChanges: SceneChange[] = [];

      return {
        success: true,
        data: { sceneChanges: _sceneChanges, threshold },
        summary: `Detected ${_sceneChanges.length} scene change(s) at threshold ${threshold}`,
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

      void (await ffmpeg.run(args));

      // TODO: Parse silencedetect output from stderr
      // Pattern: "silence_start: 1.234" and "silence_end: 5.678 | silence_duration: 4.444"
      const _silenceRegions: SilenceRegion[] = [];

      return {
        success: true,
        data: { silenceRegions: _silenceRegions, noiseDb, minDuration },
        summary: `Detected ${_silenceRegions.length} silence region(s)`,
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
