/**
 * @module schemas/export
 * @description Zod schemas for export presets, codecs, and container formats.
 */

import { z } from 'zod';

/** Supported container formats */
export const ContainerEnum = z.enum(['mp4', 'mkv', 'webm', 'mov']);

/** Supported video codecs */
export const VideoCodecEnum = z.enum(['libx264', 'libx265', 'libvpx-vp9', 'copy']);

/** Supported audio codecs */
export const AudioCodecEnum = z.enum(['aac', 'libopus', 'libmp3lame', 'copy']);

/** An export preset defining output encoding parameters */
export const ExportPresetSchema = z.object({
  /** Display name for the preset */
  name: z.string().min(1),
  /** Output container format */
  container: ContainerEnum,
  /** Video codec to use */
  videoCodec: VideoCodecEnum,
  /** Audio codec to use */
  audioCodec: AudioCodecEnum,
  /** Video bitrate (e.g., '8M', '4500k') */
  videoBitrate: z.string().optional(),
  /** Audio bitrate (e.g., '192k', '320k') */
  audioBitrate: z.string().optional(),
  /** Output resolution */
  resolution: z.object({ w: z.number(), h: z.number() }).optional(),
  /** Output frame rate */
  fps: z.number().positive().optional(),
  /** Whether to use two-pass encoding */
  twoPass: z.boolean().default(false),
  /** Additional FFmpeg output arguments */
  extraArgs: z.array(z.string()).default([]),
});

// ── Built-in Presets ────────────────────────────────────────────────────

/** YouTube-optimized export preset */
export const YOUTUBE_PRESET: ExportPreset = {
  name: 'YouTube 1080p',
  container: 'mp4',
  videoCodec: 'libx264',
  audioCodec: 'aac',
  videoBitrate: '8M',
  audioBitrate: '192k',
  resolution: { w: 1920, h: 1080 },
  fps: 30,
  twoPass: false,
  extraArgs: ['-movflags', '+faststart'],
};

// ── Inferred Types ──────────────────────────────────────────────────────

export type Container = z.infer<typeof ContainerEnum>;
export type VideoCodec = z.infer<typeof VideoCodecEnum>;
export type AudioCodec = z.infer<typeof AudioCodecEnum>;
export type ExportPreset = z.infer<typeof ExportPresetSchema>;
