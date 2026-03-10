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
import type { SceneChange } from './analysis.js';
import type { SilenceRegion } from './analysis.js';

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

// ── Helpers ─────────────────────────────────────────────────────────────

/**
 * Correlate scene changes and silence regions to identify game boundaries.
 * A game boundary occurs when a scene change happens near a silence region.
 */
export function detectGameBoundaries(
  sceneChanges: SceneChange[],
  silenceRegions: SilenceRegion[],
  totalDuration: number,
  proximityWindow: number = 3.0,
): GameBoundary[] {
  if (silenceRegions.length === 0) return [];

  // Find scene changes that are near silence regions (within proximity window)
  const boundaries: number[] = [];

  for (const silence of silenceRegions) {
    const silenceMid = (silence.start + silence.end) / 2;

    // Check if any scene change is near this silence
    const nearbyScene = sceneChanges.find(
      (sc) => Math.abs(sc.timestamp - silenceMid) < proximityWindow,
    );

    if (nearbyScene) {
      // Use silence end as the boundary point (game starts after silence)
      boundaries.push(silence.end);
    } else if (silence.duration >= 2.0) {
      // Long silence alone is a good boundary indicator
      boundaries.push(silence.end);
    }
  }

  // Sort and deduplicate boundaries
  const uniqueBoundaries = [...new Set(boundaries)].sort((a, b) => a - b);

  // Convert boundaries to game segments
  const games: GameBoundary[] = [];
  let prevEnd = 0;

  for (let i = 0; i < uniqueBoundaries.length; i++) {
    const boundaryTime = uniqueBoundaries[i];

    // Don't create very short segments (< 30 seconds)
    if (boundaryTime - prevEnd < 30) {
      continue;
    }

    games.push({
      index: games.length + 1,
      start: prevEnd,
      end: boundaryTime,
      duration: boundaryTime - prevEnd,
      confidence: 0.7, // Default confidence
    });
    prevEnd = boundaryTime;
  }

  // Add final game segment (from last boundary to end)
  if (totalDuration - prevEnd > 30) {
    games.push({
      index: games.length + 1,
      start: prevEnd,
      end: totalDuration,
      duration: totalDuration - prevEnd,
      confidence: 0.7,
    });
  }

  // Boost confidence for boundaries with both scene change + silence
  for (const game of games) {
    const hasSceneAtStart = sceneChanges.some(
      (sc) => Math.abs(sc.timestamp - game.start) < proximityWindow,
    );
    const hasSilenceAtStart = silenceRegions.some(
      (sr) => Math.abs(sr.end - game.start) < proximityWindow,
    );
    if (hasSceneAtStart && hasSilenceAtStart) {
      game.confidence = 0.9;
    }
  }

  return games;
}

/** Map position enum to FFmpeg drawtext x/y expressions */
const POSITION_MAP: Record<string, { x: string; y: string }> = {
  'top-left': { x: '10', y: '10' },
  'top-right': { x: 'w-tw-10', y: '10' },
  'bottom-left': { x: '10', y: 'h-th-10' },
  'bottom-right': { x: 'w-tw-10', y: 'h-th-10' },
  center: { x: '(w-tw)/2', y: '(h-th)/2' },
};

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
  clipId: z.string().uuid(),
  text: z.string().min(1).describe('Overlay text (e.g., player names, game info)'),
  position: z
    .enum(['top-left', 'top-right', 'bottom-left', 'bottom-right', 'center'])
    .default('bottom-left'),
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

      const project = db.getProject(projectId);
      if (!project) return { success: false, error: `Project not found: ${projectId}` };

      const asset = project.assets.find((a) => a.id === assetId);
      if (!asset) return { success: false, error: `Asset not found: ${assetId}` };

      // Run scene detection and silence analysis
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

      // Extract data from tool results
      const sceneChanges: SceneChange[] =
        (sceneResult.data as { sceneChanges?: SceneChange[] })?.sceneChanges ?? [];
      const silenceRegions: SilenceRegion[] =
        (silenceResult.data as { silenceRegions?: SilenceRegion[] })?.silenceRegions ?? [];

      const totalDuration = asset.duration ?? 0;
      const games = detectGameBoundaries(sceneChanges, silenceRegions, totalDuration);

      return {
        success: true,
        data: { games, sceneChangeCount: sceneChanges.length, silenceCount: silenceRegions.length },
        summary: `Detected ${games.length} chess game(s) in "${asset.originalName}"`,
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

      const asset = project.assets.find((a) => a.id === assetId);
      if (!asset) return { success: false, error: `Asset not found: ${assetId}` };

      // Ensure a video track exists
      const videoTrack = project.timeline.tracks.find((t) => t.type === 'video');
      if (!videoTrack) {
        return { success: false, error: 'No video track found in timeline' };
      }

      const clipIds: string[] = [];
      let timelinePos = 0;

      for (const game of games) {
        // Add clip for each game segment
        const clipResult = await executeTool(ToolAction.CLIP_ADD, {
          projectId,
          assetId,
          trackIndex: project.timeline.tracks.indexOf(videoTrack),
          sourceStart: game.start,
          sourceEnd: game.end,
          timelineStart: timelinePos,
        });

        if (clipResult.success && clipResult.data) {
          const clipData = clipResult.data as { clipId?: string };
          if (clipData.clipId) clipIds.push(clipData.clipId);
        }

        // Add chapter marker if title provided
        if (game.title) {
          await executeTool(ToolAction.CHAPTER_ADD, {
            projectId,
            title: game.title,
            timelineStart: timelinePos,
          });
        }

        timelinePos += game.end - game.start;
      }

      return {
        success: true,
        data: { clipIds, gameCount: games.length },
        summary: `Split ${games.length} game(s) into ${clipIds.length} clip(s)`,
      };
    },
  });

  registerTool({
    action: ToolAction.CHESS_ADD_OVERLAY,
    category: ToolCategory.CHESS,
    description: 'Add a text overlay to a chess video clip (player names, game info, etc.)',
    schema: ChessAddOverlaySchema,
    handler: async (params): Promise<ToolResult> => {
      const { projectId, clipId, text, position, fontSize, fontColor } = params as z.infer<
        typeof ChessAddOverlaySchema
      >;

      const project = db.getProject(projectId);
      if (!project) return { success: false, error: `Project not found: ${projectId}` };

      // Find the clip
      let targetClip = null;
      for (const track of project.timeline.tracks) {
        targetClip = track.clips.find((c) => c.id === clipId);
        if (targetClip) break;
      }
      if (!targetClip) return { success: false, error: `Clip not found: ${clipId}` };

      // Map position to x/y coordinates
      const pos = POSITION_MAP[position] ?? POSITION_MAP['bottom-left'];

      // Add drawtext filter to the clip
      const filterResult = await executeTool(ToolAction.FILTER_ADD, {
        projectId,
        clipId,
        filterType: 'drawtext',
        params: {
          text,
          fontsize: fontSize,
          fontcolor: fontColor,
          x: pos.x,
          y: pos.y,
        },
      });

      return {
        success: filterResult.success,
        data: { clipId, position, text },
        error: filterResult.error,
        summary: `Added "${text}" overlay at ${position}`,
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

      if (!introAssetId && !outroAssetId) {
        return {
          success: false,
          error: 'At least one of introAssetId or outroAssetId is required',
        };
      }

      const videoTrack = project.timeline.tracks.find((t) => t.type === 'video');
      if (!videoTrack) return { success: false, error: 'No video track found' };

      const trackIndex = project.timeline.tracks.indexOf(videoTrack);
      let addedIntro = false;
      let addedOutro = false;

      // Add intro: shift all existing clips forward, then insert intro at start
      if (introAssetId) {
        const introAsset = project.assets.find((a) => a.id === introAssetId);
        if (!introAsset) return { success: false, error: `Intro asset not found: ${introAssetId}` };

        const introDuration = introAsset.duration ?? 0;

        // Shift existing clips forward by intro duration
        for (const clip of videoTrack.clips) {
          clip.timelineStart += introDuration;
        }

        // Also shift chapters forward
        for (const ch of project.timeline.chapters) {
          ch.timelineStart += introDuration;
        }

        // Add intro clip at start
        const introResult = await executeTool(ToolAction.CLIP_ADD, {
          projectId,
          assetId: introAssetId,
          trackIndex,
          sourceStart: 0,
          sourceEnd: introDuration,
          timelineStart: 0,
        });

        addedIntro = introResult.success;
      }

      // Add outro at end
      if (outroAssetId) {
        const outroAsset = project.assets.find((a) => a.id === outroAssetId);
        if (!outroAsset) return { success: false, error: `Outro asset not found: ${outroAssetId}` };

        // Re-fetch project to get updated state
        const updatedProject = db.getProject(projectId);
        const currentDuration = updatedProject?.timeline.duration ?? project.timeline.duration;

        const outroResult = await executeTool(ToolAction.CLIP_ADD, {
          projectId,
          assetId: outroAssetId,
          trackIndex,
          sourceStart: 0,
          sourceEnd: outroAsset.duration ?? 0,
          timelineStart: currentDuration,
        });

        addedOutro = outroResult.success;
      }

      return {
        success: true,
        data: { addedIntro, addedOutro },
        summary: `${addedIntro ? 'Added intro' : ''}${addedIntro && addedOutro ? ' and ' : ''}${addedOutro ? 'Added outro' : ''}`,
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
          .sort((a, b) => a.timelineStart - b.timelineStart)
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
