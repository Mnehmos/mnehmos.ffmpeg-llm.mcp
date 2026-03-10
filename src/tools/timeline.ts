/**
 * @module tools/timeline
 * @description Tool handlers for timeline manipulation: tracks, clips, and filters.
 * Includes validation for overlapping clips, valid time ranges, and asset existence.
 */

import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { ToolAction, ToolCategory, registerTool, type ToolResult } from './actionEnum.js';
import type { Storage } from '../storage/db.js';
import { TrackTypeEnum, FilterTypeEnum } from '../schemas/timeline.js';
import type { Clip, Track, Filter } from '../schemas/timeline.js';
import type { Project } from '../schemas/project.js';

// ── Helpers ─────────────────────────────────────────────────────────────

/**
 * Compute the effective duration of a clip from its sourceRange and speed.
 */
function clipDuration(clip: Clip): number {
  return (clip.sourceRange.end - clip.sourceRange.start) / clip.speed;
}

/**
 * Recalculate the total timeline duration from all clips across all tracks.
 */
function recalcDuration(project: Project): void {
  let maxEnd = 0;
  for (const track of project.timeline.tracks) {
    for (const clip of track.clips) {
      const clipEnd = clip.timelineStart + clipDuration(clip);
      if (clipEnd > maxEnd) maxEnd = clipEnd;
    }
  }
  project.timeline.duration = maxEnd;
}

/**
 * Check if a new clip would overlap with existing clips on a track.
 */
function hasOverlap(
  track: Track,
  start: number,
  duration: number,
  excludeClipId?: string,
): boolean {
  const end = start + duration;
  return track.clips.some((c) => {
    if (c.id === excludeClipId) return false;
    const cEnd = c.timelineStart + clipDuration(c);
    return start < cEnd && end > c.timelineStart;
  });
}

/**
 * Find a clip across all tracks in a project.
 */
function findClipInProject(
  project: Project,
  clipId: string,
): { track: Track; clip: Clip; trackIndex: number } | null {
  for (let i = 0; i < project.timeline.tracks.length; i++) {
    const track = project.timeline.tracks[i];
    const clip = track.clips.find((c) => c.id === clipId);
    if (clip) return { track, clip, trackIndex: i };
  }
  return null;
}

// ── Schemas ─────────────────────────────────────────────────────────────

const TrackAddSchema = z.object({
  projectId: z.string().uuid(),
  name: z.string().min(1),
  type: TrackTypeEnum,
});

const TrackRemoveSchema = z.object({
  projectId: z.string().uuid(),
  trackId: z.string().uuid(),
});

const TrackReorderSchema = z.object({
  projectId: z.string().uuid(),
  trackId: z.string().uuid(),
  newOrder: z.number().int().nonnegative(),
});

const ClipAddSchema = z.object({
  projectId: z.string().uuid(),
  trackId: z.string().uuid(),
  assetId: z.string().uuid(),
  timelineStart: z.number().nonnegative(),
  sourceStart: z.number().nonnegative().default(0),
  duration: z.number().positive(),
});

const ClipTrimSchema = z.object({
  projectId: z.string().uuid(),
  trackId: z.string().uuid(),
  clipId: z.string().uuid(),
  newStart: z.number().nonnegative().optional(),
  newSourceEnd: z.number().positive().optional(),
  sourceStart: z.number().nonnegative().optional(),
});

const ClipMoveSchema = z.object({
  projectId: z.string().uuid(),
  trackId: z.string().uuid(),
  clipId: z.string().uuid(),
  newTimelineStart: z.number().nonnegative(),
  targetTrackId: z.string().uuid().optional(),
});

const ClipSplitSchema = z.object({
  projectId: z.string().uuid(),
  trackId: z.string().uuid(),
  clipId: z.string().uuid(),
  splitAt: z.number().positive().describe('Timeline timestamp to split at'),
});

const ClipRemoveSchema = z.object({
  projectId: z.string().uuid(),
  trackId: z.string().uuid(),
  clipId: z.string().uuid(),
});

const ClipSetSpeedSchema = z.object({
  projectId: z.string().uuid(),
  trackId: z.string().uuid(),
  clipId: z.string().uuid(),
  speed: z.number().positive(),
});

const ClipSetVolumeSchema = z.object({
  projectId: z.string().uuid(),
  trackId: z.string().uuid(),
  clipId: z.string().uuid(),
  volume: z.number().min(0).max(2),
});

const FilterAddSchema = z.object({
  projectId: z.string().uuid(),
  trackId: z.string().uuid(),
  clipId: z.string().uuid(),
  filterType: FilterTypeEnum,
  params: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).default({}),
});

const FilterRemoveSchema = z.object({
  projectId: z.string().uuid(),
  trackId: z.string().uuid(),
  clipId: z.string().uuid(),
  filterIndex: z.number().int().nonnegative(),
});

// ── TimelineEditor Class ────────────────────────────────────────────────

/**
 * Class-based tool handler for timeline editing operations.
 */
export class TimelineEditor {
  private readonly storage: Storage;

  constructor(storage: Storage) {
    this.storage = storage;
  }

  private async loadProject(projectId: string): Promise<Project> {
    const project = await this.storage.getProject(projectId);
    if (!project) throw new Error(`Project not found: ${projectId}`);
    return project;
  }

  private async saveProject(project: Project): Promise<void> {
    project.updatedAt = new Date().toISOString();
    await this.storage.saveProject(project);
  }

  async clipAdd(params: {
    projectId: string;
    assetId: string;
    trackId: string;
    timelineStart: number;
    sourceRange?: { start: number; end: number };
  }): Promise<{ clip: Clip }> {
    const { projectId, assetId, trackId, timelineStart, sourceRange } = params;

    const project = await this.loadProject(projectId);
    const track = project.timeline.tracks.find((t) => t.id === trackId);
    if (!track) throw new Error(`Track not found: ${trackId}`);

    const asset = project.assets.find((a) => a.id === assetId);
    if (!asset) throw new Error(`Asset not found: ${assetId}`);

    const range = sourceRange ?? { start: 0, end: asset.duration ?? 0 };
    const dur = range.end - range.start;

    // Check overlap
    if (hasOverlap(track, timelineStart, dur)) {
      throw new Error('Clip would overlap with existing clip on this track');
    }

    const trackIndex = project.timeline.tracks.indexOf(track);
    const clip: Clip = {
      id: uuidv4(),
      assetId,
      sourceRange: range,
      timelineStart,
      trackIndex,
      speed: 1.0,
      volume: 1.0,
      opacity: 1.0,
      filters: [],
      metadata: {},
    };

    track.clips.push(clip);
    recalcDuration(project);
    await this.saveProject(project);

    return { clip };
  }

  async clipTrim(params: {
    projectId: string;
    clipId: string;
    sourceStart?: number;
    sourceEnd?: number;
  }): Promise<{ clip: Clip }> {
    const { projectId, clipId, sourceStart, sourceEnd } = params;

    const project = await this.loadProject(projectId);
    const found = findClipInProject(project, clipId);
    if (!found) throw new Error(`Clip not found: ${clipId}`);

    const { clip } = found;
    const asset = project.assets.find((a) => a.id === clip.assetId);

    if (sourceStart !== undefined) {
      clip.sourceRange = { start: sourceStart, end: clip.sourceRange.end };
    }
    if (sourceEnd !== undefined) {
      // Validate against asset duration
      if (asset && asset.duration !== undefined && sourceEnd > asset.duration) {
        throw new Error(`Trim extends beyond asset duration (${asset.duration}s)`);
      }
      clip.sourceRange = { start: clip.sourceRange.start, end: sourceEnd };
    }

    recalcDuration(project);
    await this.saveProject(project);

    return { clip };
  }

  async clipSplit(params: {
    projectId: string;
    clipId: string;
    splitAt: number;
  }): Promise<{ clips: [Clip, Clip] }> {
    const { projectId, clipId, splitAt } = params;

    const project = await this.loadProject(projectId);
    const found = findClipInProject(project, clipId);
    if (!found) throw new Error(`Clip not found: ${clipId}`);

    const { track, clip } = found;
    const duration = clipDuration(clip);
    const clipEnd = clip.timelineStart + duration;

    if (splitAt <= clip.timelineStart || splitAt >= clipEnd) {
      throw new Error(
        `Split point ${splitAt}s is outside clip range [${clip.timelineStart}, ${clipEnd})`,
      );
    }

    // Calculate split point in source time
    const firstTimelineDuration = splitAt - clip.timelineStart;
    const firstSourceDuration = firstTimelineDuration * clip.speed;
    const splitSourceTime = clip.sourceRange.start + firstSourceDuration;

    // Modify original clip (becomes the first half)
    const originalEnd = clip.sourceRange.end;
    clip.sourceRange = { start: clip.sourceRange.start, end: splitSourceTime };

    // Create second clip
    const secondClip: Clip = {
      id: uuidv4(),
      assetId: clip.assetId,
      sourceRange: { start: splitSourceTime, end: originalEnd },
      timelineStart: splitAt,
      trackIndex: clip.trackIndex,
      speed: clip.speed,
      volume: clip.volume,
      opacity: clip.opacity,
      filters: clip.filters.map((f) => ({ ...f })),
      metadata: { ...clip.metadata },
    };

    track.clips.push(secondClip);
    await this.saveProject(project);

    return { clips: [clip, secondClip] };
  }

  async clipMove(params: {
    projectId: string;
    clipId: string;
    timelineStart?: number;
    trackId?: string;
  }): Promise<{ clip: Clip }> {
    const { projectId, clipId, timelineStart, trackId } = params;

    const project = await this.loadProject(projectId);
    const found = findClipInProject(project, clipId);
    if (!found) throw new Error(`Clip not found: ${clipId}`);

    const { track: sourceTrack, clip } = found;

    const destTrack = trackId ? project.timeline.tracks.find((t) => t.id === trackId) : sourceTrack;
    if (!destTrack) throw new Error(`Target track not found: ${trackId}`);

    const newStart = timelineStart ?? clip.timelineStart;

    // Check overlap on destination (exclude self)
    if (hasOverlap(destTrack, newStart, clipDuration(clip), clip.id)) {
      throw new Error('Clip would overlap at new position');
    }

    // Move between tracks if needed
    if (trackId && trackId !== sourceTrack.id) {
      sourceTrack.clips = sourceTrack.clips.filter((c) => c.id !== clipId);
      destTrack.clips.push(clip);
    }

    clip.timelineStart = newStart;
    recalcDuration(project);
    await this.saveProject(project);

    return { clip };
  }

  async clipRemove(params: { projectId: string; clipId: string }): Promise<void> {
    const { projectId, clipId } = params;

    const project = await this.loadProject(projectId);
    const found = findClipInProject(project, clipId);
    if (!found) throw new Error(`Clip not found: ${clipId}`);

    const { track } = found;
    track.clips = track.clips.filter((c) => c.id !== clipId);
    recalcDuration(project);
    await this.saveProject(project);
  }

  async clipSetSpeed(params: {
    projectId: string;
    clipId: string;
    speed: number;
  }): Promise<{ clip: Clip }> {
    const { projectId, clipId, speed } = params;

    const project = await this.loadProject(projectId);
    const found = findClipInProject(project, clipId);
    if (!found) throw new Error(`Clip not found: ${clipId}`);

    const { clip } = found;
    clip.speed = speed;
    recalcDuration(project);
    await this.saveProject(project);

    return { clip };
  }

  async trackAdd(params: {
    projectId: string;
    name: string;
    type: string;
  }): Promise<{ track: Track }> {
    const { projectId, name, type } = params;

    const project = await this.loadProject(projectId);

    const track: Track = {
      id: uuidv4(),
      name,
      type: type as Track['type'],
      clips: [],
      muted: false,
      locked: false,
      visible: true,
    };

    project.timeline.tracks.push(track);
    await this.saveProject(project);

    return { track };
  }

  async trackRemove(params: { projectId: string; trackId: string }): Promise<void> {
    const { projectId, trackId } = params;

    const project = await this.loadProject(projectId);
    const idx = project.timeline.tracks.findIndex((t) => t.id === trackId);
    if (idx === -1) throw new Error(`Track not found: ${trackId}`);

    project.timeline.tracks.splice(idx, 1);
    recalcDuration(project);
    await this.saveProject(project);
  }

  async filterAdd(params: {
    projectId: string;
    clipId: string;
    filter: Filter;
  }): Promise<{ clip: Clip }> {
    const { projectId, clipId, filter } = params;

    const project = await this.loadProject(projectId);
    const found = findClipInProject(project, clipId);
    if (!found) throw new Error(`Clip not found: ${clipId}`);

    const { clip } = found;
    clip.filters.push(filter);
    await this.saveProject(project);

    return { clip };
  }

  async filterRemove(params: {
    projectId: string;
    clipId: string;
    filterIndex: number;
  }): Promise<{ clip: Clip }> {
    const { projectId, clipId, filterIndex } = params;

    const project = await this.loadProject(projectId);
    const found = findClipInProject(project, clipId);
    if (!found) throw new Error(`Clip not found: ${clipId}`);

    const { clip } = found;
    if (filterIndex < 0 || filterIndex >= clip.filters.length) {
      throw new Error(`Filter index ${filterIndex} out of range`);
    }

    clip.filters.splice(filterIndex, 1);
    await this.saveProject(project);

    return { clip };
  }
}

// ── Registration ────────────────────────────────────────────────────────

/**
 * Register all timeline-related tools (12 total).
 * @param _registry - Unused
 * @param db - Storage instance
 */
export function registerTimelineTools(_registry: unknown, db: Storage): void {
  /** Helper to load project, find track, find clip */
  function getProjectTrackClip(
    projectId: string,
    trackId: string,
    clipId?: string,
  ): { project: Project; track: Track; clip?: Clip; error?: string } {
    const project = db.getProject(projectId) as Project | null;
    if (!project) return { project: null!, track: null!, error: `Project not found: ${projectId}` };
    const track = project.timeline.tracks.find((t) => t.id === trackId);
    if (!track) return { project, track: null!, error: `Track not found: ${trackId}` };
    if (clipId) {
      const clip = track.clips.find((c) => c.id === clipId);
      if (!clip) return { project, track, error: `Clip not found: ${clipId}` };
      return { project, track, clip };
    }
    return { project, track };
  }

  registerTool({
    action: ToolAction.TRACK_ADD,
    category: ToolCategory.TIMELINE,
    description: 'Add a new track to the timeline',
    schema: TrackAddSchema,
    handler: async (params): Promise<ToolResult> => {
      const { projectId, name, type } = params as z.infer<typeof TrackAddSchema>;
      const project = await db.getProject(projectId);
      if (!project) return { success: false, error: `Project not found: ${projectId}` };

      const track: Track = {
        id: uuidv4(),
        name,
        type,
        clips: [],
        muted: false,
        locked: false,
        visible: true,
      };
      project.timeline.tracks.push(track);
      project.updatedAt = new Date().toISOString();
      await db.saveProject(project);

      return {
        success: true,
        data: { trackId: track.id },
        summary: `Added ${type} track "${name}"`,
      };
    },
  });

  registerTool({
    action: ToolAction.TRACK_REMOVE,
    category: ToolCategory.TIMELINE,
    description: 'Remove a track and all its clips from the timeline',
    schema: TrackRemoveSchema,
    handler: async (params): Promise<ToolResult> => {
      const { projectId, trackId } = params as z.infer<typeof TrackRemoveSchema>;
      const project = await db.getProject(projectId);
      if (!project) return { success: false, error: `Project not found: ${projectId}` };

      const idx = project.timeline.tracks.findIndex((t) => t.id === trackId);
      if (idx === -1) return { success: false, error: `Track not found: ${trackId}` };

      const removed = project.timeline.tracks.splice(idx, 1)[0];
      recalcDuration(project);
      project.updatedAt = new Date().toISOString();
      await db.saveProject(project);

      return {
        success: true,
        summary: `Removed track "${removed.name}" with ${removed.clips.length} clip(s)`,
      };
    },
  });

  registerTool({
    action: ToolAction.TRACK_REORDER,
    category: ToolCategory.TIMELINE,
    description: 'Change the display order of a track by moving it to a new array position',
    schema: TrackReorderSchema,
    handler: async (params): Promise<ToolResult> => {
      const { projectId, trackId, newOrder } = params as z.infer<typeof TrackReorderSchema>;
      const project = await db.getProject(projectId);
      if (!project) return { success: false, error: `Project not found: ${projectId}` };

      const idx = project.timeline.tracks.findIndex((t) => t.id === trackId);
      if (idx === -1) return { success: false, error: `Track not found: ${trackId}` };

      const [track] = project.timeline.tracks.splice(idx, 1);
      const insertAt = Math.min(newOrder, project.timeline.tracks.length);
      project.timeline.tracks.splice(insertAt, 0, track);

      project.updatedAt = new Date().toISOString();
      await db.saveProject(project);

      return { success: true, summary: `Track "${track.name}" reordered to position ${newOrder}` };
    },
  });

  registerTool({
    action: ToolAction.CLIP_ADD,
    category: ToolCategory.TIMELINE,
    description: 'Add a clip from an asset onto a track at a given position',
    schema: ClipAddSchema,
    handler: async (params): Promise<ToolResult> => {
      const { projectId, trackId, assetId, timelineStart, sourceStart, duration } =
        params as z.infer<typeof ClipAddSchema>;

      const { project, track, error } = getProjectTrackClip(projectId, trackId);
      if (error) return { success: false, error };

      const asset = project.assets.find((a) => a.id === assetId);
      if (!asset) return { success: false, error: `Asset not found: ${assetId}` };

      if (hasOverlap(track, timelineStart, duration)) {
        return { success: false, error: 'Clip would overlap with existing clip on this track' };
      }

      const trackIndex = project.timeline.tracks.indexOf(track);
      const clip: Clip = {
        id: uuidv4(),
        assetId,
        sourceRange: { start: sourceStart, end: sourceStart + duration },
        timelineStart,
        trackIndex,
        speed: 1.0,
        volume: 1.0,
        opacity: 1.0,
        filters: [],
        metadata: {},
      };

      track.clips.push(clip);
      recalcDuration(project);
      project.updatedAt = new Date().toISOString();
      await db.saveProject(project);

      return {
        success: true,
        data: { clipId: clip.id },
        summary: `Added clip from "${asset.originalName}" at ${timelineStart}s (${duration}s)`,
      };
    },
  });

  registerTool({
    action: ToolAction.CLIP_TRIM,
    category: ToolCategory.TIMELINE,
    description: 'Adjust the start position, duration, or source range of a clip',
    schema: ClipTrimSchema,
    handler: async (params): Promise<ToolResult> => {
      const { projectId, trackId, clipId, newStart, newSourceEnd, sourceStart } = params as z.infer<
        typeof ClipTrimSchema
      >;

      const { project, clip, error } = getProjectTrackClip(projectId, trackId, clipId);
      if (error || !clip) return { success: false, error: error ?? 'Clip not found' };

      if (newStart !== undefined) clip.timelineStart = newStart;
      if (newSourceEnd !== undefined) {
        clip.sourceRange = { start: clip.sourceRange.start, end: newSourceEnd };
      }
      if (sourceStart !== undefined) {
        clip.sourceRange = { start: sourceStart, end: clip.sourceRange.end };
      }

      recalcDuration(project);
      project.updatedAt = new Date().toISOString();
      await db.saveProject(project);

      return { success: true, summary: `Trimmed clip ${clipId}` };
    },
  });

  registerTool({
    action: ToolAction.CLIP_MOVE,
    category: ToolCategory.TIMELINE,
    description: 'Move a clip to a new position, optionally to a different track',
    schema: ClipMoveSchema,
    handler: async (params): Promise<ToolResult> => {
      const { projectId, trackId, clipId, newTimelineStart, targetTrackId } = params as z.infer<
        typeof ClipMoveSchema
      >;

      const { project, track, clip, error } = getProjectTrackClip(projectId, trackId, clipId);
      if (error || !clip) return { success: false, error: error ?? 'Clip not found' };

      const destTrack = targetTrackId
        ? project.timeline.tracks.find((t) => t.id === targetTrackId)
        : track;
      if (!destTrack) return { success: false, error: `Target track not found: ${targetTrackId}` };

      if (hasOverlap(destTrack, newTimelineStart, clipDuration(clip), clip.id)) {
        return { success: false, error: 'Clip would overlap at new position' };
      }

      if (targetTrackId && targetTrackId !== trackId) {
        track.clips = track.clips.filter((c) => c.id !== clipId);
        destTrack.clips.push(clip);
      }

      clip.timelineStart = newTimelineStart;
      recalcDuration(project);
      project.updatedAt = new Date().toISOString();
      await db.saveProject(project);

      return { success: true, summary: `Moved clip to ${newTimelineStart}s` };
    },
  });

  registerTool({
    action: ToolAction.CLIP_SPLIT,
    category: ToolCategory.TIMELINE,
    description: 'Split a clip at a timeline timestamp, creating two clips from one',
    schema: ClipSplitSchema,
    handler: async (params): Promise<ToolResult> => {
      const { projectId, trackId, clipId, splitAt } = params as z.infer<typeof ClipSplitSchema>;

      const { project, track, clip, error } = getProjectTrackClip(projectId, trackId, clipId);
      if (error || !clip) return { success: false, error: error ?? 'Clip not found' };

      const duration = clipDuration(clip);
      const clipEnd = clip.timelineStart + duration;
      if (splitAt <= clip.timelineStart || splitAt >= clipEnd) {
        return {
          success: false,
          error: `Split point ${splitAt}s is outside clip range [${clip.timelineStart}, ${clipEnd})`,
        };
      }

      const firstTimelineDuration = splitAt - clip.timelineStart;
      const firstSourceDuration = firstTimelineDuration * clip.speed;
      const splitSourceTime = clip.sourceRange.start + firstSourceDuration;

      const originalEnd = clip.sourceRange.end;
      clip.sourceRange = { start: clip.sourceRange.start, end: splitSourceTime };

      const secondClip: Clip = {
        id: uuidv4(),
        assetId: clip.assetId,
        sourceRange: { start: splitSourceTime, end: originalEnd },
        timelineStart: splitAt,
        trackIndex: clip.trackIndex,
        speed: clip.speed,
        volume: clip.volume,
        opacity: clip.opacity,
        filters: clip.filters.map((f) => ({ ...f })),
        metadata: { ...clip.metadata },
      };

      track.clips.push(secondClip);
      project.updatedAt = new Date().toISOString();
      await db.saveProject(project);

      return {
        success: true,
        data: { firstClipId: clip.id, secondClipId: secondClip.id },
        summary: `Split clip at ${splitAt}s into two clips`,
      };
    },
  });

  registerTool({
    action: ToolAction.CLIP_REMOVE,
    category: ToolCategory.TIMELINE,
    description: 'Remove a clip from a track',
    schema: ClipRemoveSchema,
    handler: async (params): Promise<ToolResult> => {
      const { projectId, trackId, clipId } = params as z.infer<typeof ClipRemoveSchema>;
      const { project, track, error } = getProjectTrackClip(projectId, trackId);
      if (error) return { success: false, error };

      const idx = track.clips.findIndex((c) => c.id === clipId);
      if (idx === -1) return { success: false, error: `Clip not found: ${clipId}` };

      track.clips.splice(idx, 1);
      recalcDuration(project);
      project.updatedAt = new Date().toISOString();
      await db.saveProject(project);

      return { success: true, summary: `Removed clip ${clipId}` };
    },
  });

  registerTool({
    action: ToolAction.CLIP_SET_SPEED,
    category: ToolCategory.TIMELINE,
    description: 'Change the playback speed of a clip',
    schema: ClipSetSpeedSchema,
    handler: async (params): Promise<ToolResult> => {
      const { projectId, trackId, clipId, speed } = params as z.infer<typeof ClipSetSpeedSchema>;
      const ptcResult = getProjectTrackClip(projectId, trackId, clipId);
      if (ptcResult.error || !ptcResult.clip)
        return { success: false, error: ptcResult.error ?? 'Clip not found' };
      const { project, clip } = ptcResult;

      clip.speed = speed;
      recalcDuration(project);
      project.updatedAt = new Date().toISOString();
      await db.saveProject(project);

      return { success: true, summary: `Set clip speed to ${speed}x` };
    },
  });

  registerTool({
    action: ToolAction.CLIP_SET_VOLUME,
    category: ToolCategory.TIMELINE,
    description: 'Change the volume of a clip',
    schema: ClipSetVolumeSchema,
    handler: async (params): Promise<ToolResult> => {
      const { projectId, trackId, clipId, volume } = params as z.infer<typeof ClipSetVolumeSchema>;
      const { project, clip, error } = getProjectTrackClip(projectId, trackId, clipId);
      if (error || !clip) return { success: false, error: error ?? 'Clip not found' };

      clip.volume = volume;
      project.updatedAt = new Date().toISOString();
      await db.saveProject(project);

      return { success: true, summary: `Set clip volume to ${volume}` };
    },
  });

  registerTool({
    action: ToolAction.FILTER_ADD,
    category: ToolCategory.TIMELINE,
    description: 'Add a filter to a clip',
    schema: FilterAddSchema,
    handler: async (params): Promise<ToolResult> => {
      const {
        projectId,
        trackId,
        clipId,
        filterType,
        params: filterParams,
      } = params as z.infer<typeof FilterAddSchema>;

      const { project, clip, error } = getProjectTrackClip(projectId, trackId, clipId);
      if (error || !clip) return { success: false, error: error ?? 'Clip not found' };

      const filter = {
        type: filterType,
        params: filterParams,
        enabled: true,
      };

      clip.filters.push(filter);
      project.updatedAt = new Date().toISOString();
      await db.saveProject(project);

      return {
        success: true,
        data: { filterIndex: clip.filters.length - 1 },
        summary: `Added ${filterType} filter to clip`,
      };
    },
  });

  registerTool({
    action: ToolAction.FILTER_REMOVE,
    category: ToolCategory.TIMELINE,
    description: 'Remove a filter from a clip by index',
    schema: FilterRemoveSchema,
    handler: async (params): Promise<ToolResult> => {
      const { projectId, trackId, clipId, filterIndex } = params as z.infer<
        typeof FilterRemoveSchema
      >;

      const { project, clip, error } = getProjectTrackClip(projectId, trackId, clipId);
      if (error || !clip) return { success: false, error: error ?? 'Clip not found' };

      if (filterIndex < 0 || filterIndex >= clip.filters.length) {
        return {
          success: false,
          error: `Filter index ${filterIndex} out of range (0-${clip.filters.length - 1})`,
        };
      }

      clip.filters.splice(filterIndex, 1);
      project.updatedAt = new Date().toISOString();
      await db.saveProject(project);

      return { success: true, summary: `Removed filter at index ${filterIndex}` };
    },
  });
}
