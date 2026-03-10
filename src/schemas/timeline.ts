/**
 * @module schemas/timeline
 * @description Zod schemas for timeline-related structures: time ranges,
 * filters, clips, tracks, and chapters.
 */

import { z } from 'zod';

/** Time range in seconds (float precision) */
export const TimeRangeSchema = z
  .object({
    /** Start time in seconds */
    start: z.number().nonnegative().describe('Start time in seconds'),
    /** End time in seconds */
    end: z.number().nonnegative().describe('End time in seconds'),
  })
  .refine((data) => data.end > data.start, {
    message: 'End time must be greater than start time',
  });

/** Supported filter types for audio and video processing */
export const FilterTypeEnum = z.enum([
  'volume',
  'normalize',
  'fade_audio',
  'brightness',
  'contrast',
  'saturation',
  'scale',
  'crop',
  'pad',
  'fade_video',
  'overlay',
  'drawtext',
  'speed',
  'reverse',
  'deinterlace',
  'denoise',
  'custom',
]);

/** A filter applied to a clip */
export const FilterSchema = z.object({
  /** Filter type from the supported enum */
  type: FilterTypeEnum,
  /** Filter-specific parameters */
  params: z.record(z.any()),
  /** Whether the filter is currently active */
  enabled: z.boolean().default(true),
});

/** A clip placed on a timeline track */
export const ClipSchema = z.object({
  /** Unique clip identifier */
  id: z.string().uuid(),
  /** Reference to the source asset ID */
  assetId: z.string().uuid(),
  /** Source range within the asset */
  sourceRange: TimeRangeSchema,
  /** Position on the timeline in seconds */
  timelineStart: z.number().nonnegative(),
  /** Which track index this clip belongs to */
  trackIndex: z.number().int().nonnegative(),
  /** Filters applied to this clip */
  filters: z.array(FilterSchema).default([]),
  /** Volume multiplier (0.0 - 2.0) */
  volume: z.number().min(0).max(2).default(1.0),
  /** Opacity (0.0 - 1.0) */
  opacity: z.number().min(0).max(1).default(1.0),
  /** Playback speed multiplier (must be positive) */
  speed: z.number().positive().default(1.0),
  /** Human-readable label */
  label: z.string().optional(),
  /** Arbitrary metadata */
  metadata: z.record(z.any()).default({}),
});

/** Track type classification */
export const TrackTypeEnum = z.enum(['video', 'audio', 'overlay', 'subtitle']);

/** A track containing clips on the timeline */
export const TrackSchema = z.object({
  /** Unique track identifier */
  id: z.string().uuid(),
  /** Display name for the track */
  name: z.string(),
  /** Track type */
  type: TrackTypeEnum,
  /** Ordered list of clips on this track */
  clips: z.array(ClipSchema).default([]),
  /** Whether the track is muted */
  muted: z.boolean().default(false),
  /** Whether the track is locked from editing */
  locked: z.boolean().default(false),
  /** Whether the track is visible */
  visible: z.boolean().default(true),
});

/** A chapter marker in the timeline */
export const ChapterSchema = z.object({
  /** Unique chapter identifier */
  id: z.string().uuid(),
  /** Chapter title */
  title: z.string().min(1),
  /** Chapter start time on the timeline in seconds */
  timelineStart: z.number().nonnegative(),
  /** Arbitrary metadata */
  metadata: z.record(z.any()).default({}),
});

// ── Inferred Types ──────────────────────────────────────────────────────

export type TimeRange = z.infer<typeof TimeRangeSchema>;
export type FilterType = z.infer<typeof FilterTypeEnum>;
export type Filter = z.infer<typeof FilterSchema>;
export type Clip = z.infer<typeof ClipSchema>;
export type TrackType = z.infer<typeof TrackTypeEnum>;
export type Track = z.infer<typeof TrackSchema>;
export type Chapter = z.infer<typeof ChapterSchema>;
