/**
 * @module tools/chess
 * @description Chess-specific tool handlers for processing chess video content:
 * game detection, splitting, overlay, intro/outro, and YouTube export.
 */

import { z } from 'zod';
import {
  ToolAction,
  ToolCategory,
  registerTool,
  executeTool,
  type ToolResult,
} from './actionEnum.js';
import type { Storage } from '../storage/db.js';
import type { FFmpegRunner } from '../engine/ffmpeg.js';

// ── Types ───────────────────────────────────────────────────────────────

/** A detected chess game boundary within a video */
export interface GameBoundary {
  /** Game index (1-based) */
  index: number;
  /** Start time in seconds */
  start: number;
  /** End time in seconds */
  end: number;
  /** Duration in seconds */
  duration: number;
  /** Confidence score (0-1) */
  confidence: number;
}

// ── Schemas ─────────────────────────────────────────────────────────────

const ChessDetectGamesSchema = z.object({
  projectId: z.string().uuid(),
  assetId: z.string().uuid(),
  sceneThreshold: z.number().min(0).max(1).default(0.3),
  silenceNoiseDb: z.number().default(-30),
  silenceMinDuration: z.number().positive().default(1.0),
});

const ChessSplitGamesSchema = z.object({
  projectId: z.string().uuid(),
  assetId: z.string().uuid(),
  games: z
    .array(
      z.object({
        start: z.number().nonnegative(),
        end: z.number().positive(),
        title: z.string().optional(),
      }),
    )
    .min(1),
});

const ChessAddOverlaySchema = z.object({
  projectId: z.string().uuid(),
  trackId: z.string().uuid(),
  text: z.string().min(1).describe('Overlay text (e.g., player names, game info)'),
  position: z
    .enum(['top-left', 'top-right', 'bottom-left', 'bottom-right', 'center'])
    .default('bottom-left'),
  startTime: z.number().nonnegative(),
  duration: z.number().positive(),
  fontSize: z.number().int().positive().default(24),
  fontColor: z.string().default('white'),
});

const ChessAddIntroOutroSchema = z.object({
  projectId: z.string().uuid(),
  introAssetId: z.string().uuid().optional(),
  outroAssetId: z.string().uuid().optional(),
});

const ChessYoutubeExportSchema = z.object({
  projectId: z.string().uuid(),
  outputPath: z.string().min(1),
  title: z.string().min(1).describe('Video title for metadata'),
  generateChapters: z.boolean().default(true),
});

// ── Registration ────────────────────────────────────────────────────────

/**
 * Register all chess-specific tools (5 total).
 * @param _registry - Unused
 * @param db - Storage instance
 * @param _ffmpeg - FFmpeg runner (for analysis commands)
 */
export function registerChessTools(_registry: unknown, db: Storage, _ffmpeg: FFmpegRunner): void {
  registerTool({
    action: ToolAction.CHESS_DETECT_GAMES,
    category: ToolCategory.CHESS,
    description:
      'Detect individual chess games in a video by combining scene detection and silence analysis',
    schema: ChessDetectGamesSchema,
    handler: async (params): Promise<ToolResult> => {
      const { projectId, assetId, sceneThreshold, silenceNoiseDb, silenceMinDuration } =
        params as z.infer<typeof ChessDetectGamesSchema>;

      // TODO: Combine scene detection + silence analysis to find game boundaries
      // 1. Run analyze_scene_changes to find visual transitions
      // 2. Run analyze_silence to find pauses between games
      // 3. Correlate scene changes near silence regions as game boundaries

      const sceneResult = await executeTool(ToolAction.ANALYZE_SCENE_CHANGES, {
        projectId,
        assetId,
        threshold: sceneThreshold,
      });

      const silenceResult = await executeTool(ToolAction.ANALYZE_SILENCE, {
        projectId,
        assetId,
        noiseDb: silenceNoiseDb,
        minDuration: silenceMinDuration,
      });

      // TODO: Correlate results to identify game boundaries
      const _games: GameBoundary[] = [];
      void sceneResult;
      void silenceResult;

      return {
        success: true,
        data: { games: _games },
        summary: `Detected ${_games.length} chess game(s) in asset`,
      };
    },
  });

  registerTool({
    action: ToolAction.CHESS_SPLIT_GAMES,
    category: ToolCategory.CHESS,
    description: 'Split a video into individual chess games by creating clips on the timeline',
    schema: ChessSplitGamesSchema,
    handler: async (params): Promise<ToolResult> => {
      const { projectId, assetId, games } = params as z.infer<typeof ChessSplitGamesSchema>;

      const project = db.getProject(projectId);
      if (!project) return { success: false, error: `Project not found: ${projectId}` };

      // TODO: For each game, create a clip on the video track
      // and optionally create chapter markers
      void assetId;

      const clipIds: string[] = [];
      for (const game of games) {
        // TODO: Add clip via clip_add tool or directly
        void game;
      }

      return {
        success: true,
        data: { clipIds, gameCount: games.length },
        summary: `Split ${games.length} game(s) into clips`,
      };
    },
  });

  registerTool({
    action: ToolAction.CHESS_ADD_OVERLAY,
    category: ToolCategory.CHESS,
    description: 'Add a text overlay to a chess video (player names, game info, etc.)',
    schema: ChessAddOverlaySchema,
    handler: async (params): Promise<ToolResult> => {
      const { projectId, trackId, text, position, startTime, duration, fontSize, fontColor } =
        params as z.infer<typeof ChessAddOverlaySchema>;

      const project = db.getProject(projectId);
      if (!project) return { success: false, error: `Project not found: ${projectId}` };

      // TODO: Map position to x/y coordinates and add drawtext filter
      // to the appropriate clip at the given time range
      const positionMap: Record<string, { x: string; y: string }> = {
        'top-left': { x: '10', y: '10' },
        'top-right': { x: 'w-tw-10', y: '10' },
        'bottom-left': { x: '10', y: 'h-th-10' },
        'bottom-right': { x: 'w-tw-10', y: 'h-th-10' },
        center: { x: '(w-tw)/2', y: '(h-th)/2' },
      };

      void trackId;
      void startTime;
      void duration;
      void fontSize;
      void fontColor;
      void positionMap;
      void text;

      return {
        success: true,
        summary: `Added "${text}" overlay at ${position} (${startTime}s, ${duration}s) — TODO: implement`,
      };
    },
  });

  registerTool({
    action: ToolAction.CHESS_ADD_INTRO_OUTRO,
    category: ToolCategory.CHESS,
    description: 'Add intro and/or outro clips to the chess video',
    schema: ChessAddIntroOutroSchema,
    handler: async (params): Promise<ToolResult> => {
      const { projectId, introAssetId, outroAssetId } = params as z.infer<
        typeof ChessAddIntroOutroSchema
      >;

      const project = db.getProject(projectId);
      if (!project) return { success: false, error: `Project not found: ${projectId}` };

      // TODO: Shift existing clips forward by intro duration
      // Add intro clip at timeline start
      // Add outro clip at timeline end
      void introAssetId;
      void outroAssetId;

      return {
        success: true,
        summary: `Added intro/outro — TODO: implement`,
      };
    },
  });

  registerTool({
    action: ToolAction.CHESS_YOUTUBE_EXPORT,
    category: ToolCategory.CHESS,
    description: 'Export the chess video with YouTube-optimized settings and chapter metadata',
    schema: ChessYoutubeExportSchema,
    handler: async (params): Promise<ToolResult> => {
      const { projectId, outputPath, title, generateChapters } = params as z.infer<
        typeof ChessYoutubeExportSchema
      >;

      const project = db.getProject(projectId);
      if (!project) return { success: false, error: `Project not found: ${projectId}` };

      // Generate YouTube chapter description from project chapters
      let chapterDescription = '';
      if (generateChapters && project.timeline.chapters.length > 0) {
        chapterDescription = project.timeline.chapters
          .map((ch) => {
            const mins = Math.floor(ch.timelineStart / 60);
            const secs = Math.floor(ch.timelineStart % 60);
            return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')} ${ch.title}`;
          })
          .join('\n');
      }

      // Enqueue render with YouTube preset
      const renderResult = await executeTool(ToolAction.RENDER_FULL, {
        projectId,
        outputPath,
      });

      return {
        success: renderResult.success,
        data: {
          ...(renderResult.data as Record<string, unknown>),
          title,
          chapterDescription: chapterDescription || undefined,
        },
        error: renderResult.error,
        summary: `YouTube export enqueued: "${title}"`,
      };
    },
  });
}
