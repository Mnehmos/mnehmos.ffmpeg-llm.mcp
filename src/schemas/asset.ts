/**
 * @module schemas/asset
 * @description Zod schemas for media asset metadata and classification.
 */

import { z } from 'zod';

/** Supported asset types */
export const AssetTypeEnum = z.enum(['video', 'audio', 'image', 'subtitle', 'data']);

/** A media asset imported into the project */
export const AssetSchema = z.object({
  /** Unique asset identifier */
  id: z.string().uuid(),
  /** Asset type classification */
  type: AssetTypeEnum,
  /** Absolute path to the asset file */
  path: z.string().min(1),
  /** Original filename at import time */
  originalName: z.string().min(1),
  /** Duration in seconds (for video/audio) */
  duration: z.number().nonnegative().optional(),
  /** Frame width in pixels (for video/image) */
  width: z.number().int().positive().optional(),
  /** Frame height in pixels (for video/image) */
  height: z.number().int().positive().optional(),
  /** Frames per second (for video) */
  fps: z.number().positive().optional(),
  /** Video codec name */
  codec: z.string().optional(),
  /** Audio codec name */
  audioCodec: z.string().optional(),
  /** Audio sample rate in Hz */
  sampleRate: z.number().int().positive().optional(),
  /** Number of audio channels */
  channels: z.number().int().positive().optional(),
  /** File size in bytes */
  fileSize: z.number().int().nonnegative(),
  /** Raw ffprobe JSON data */
  probeData: z.unknown().optional(),
  /** User-assigned tags */
  tags: z.array(z.string()).default([]),
  /** ISO timestamp of when the asset was imported */
  importedAt: z.string().datetime(),
});

// ── Inferred Types ──────────────────────────────────────────────────────

export type AssetType = z.infer<typeof AssetTypeEnum>;
export type Asset = z.infer<typeof AssetSchema>;
