/**
 * @module schemas/project
 * @description Zod schemas for the top-level project, including timeline,
 * settings, autopilot configuration, and edit history.
 */

import { z } from 'zod';
import { TrackSchema, ChapterSchema } from './timeline.js';
import { AssetSchema } from './asset.js';
import { ExportPresetSchema } from './export.js';

/** Project-level settings */
export const ProjectSettingsSchema = z.object({
  /** Default output resolution */
  defaultResolution: z
    .object({
      w: z.number().int().positive(),
      h: z.number().int().positive(),
    })
    .default({ w: 1920, h: 1080 }),
  /** Default output frame rate */
  defaultFps: z.number().positive().default(30),
  /** Default audio sample rate in Hz */
  defaultAudioSampleRate: z.number().int().positive().default(48000),
});

/** Configuration for the LLM autopilot subsystem */
export const AutopilotConfigSchema = z.object({
  /** Whether autopilot features are enabled */
  enabled: z.boolean().default(false),
  /** OpenRouter model for text/reasoning tasks */
  openrouterModel: z.string().default('google/gemini-2.0-flash-001'),
  /** OpenRouter model for vision tasks */
  visionModel: z.string().default('google/gemini-2.0-flash-001'),
  /** Maximum budget in USD for LLM calls */
  maxBudgetUsd: z.number().nonnegative().default(1.0),
  /** Amount spent so far in USD */
  spentUsd: z.number().nonnegative().default(0),
});

/** A single entry in the project's undo/redo history */
export const HistoryEntrySchema = z.object({
  /** The tool action that was performed */
  action: z.string(),
  /** ISO timestamp of when the action was performed */
  timestamp: z.string().datetime(),
  /** Snapshot of the affected data before the action */
  before: z.any().optional(),
  /** Snapshot of the affected data after the action */
  after: z.any().optional(),
});

/** Timeline structure containing tracks and chapters */
export const TimelineSchema = z.object({
  /** Ordered list of tracks */
  tracks: z.array(TrackSchema).default([]),
  /** Total timeline duration in seconds (auto-computed from clips) */
  duration: z.number().nonnegative().default(0),
  /** Chapter markers */
  chapters: z.array(ChapterSchema).default([]),
});

/** The top-level project schema */
export const ProjectSchema = z.object({
  /** Unique project identifier */
  id: z.string().min(1),
  /** Project display name */
  name: z.string().min(1),
  /** ISO timestamp of creation */
  createdAt: z.string().datetime(),
  /** ISO timestamp of last modification */
  updatedAt: z.string().datetime(),
  /** Working directory for project files */
  workDir: z.string().min(1),
  /** The project timeline */
  timeline: TimelineSchema,
  /** Imported media assets */
  assets: z.array(AssetSchema).default([]),
  /** Saved export presets */
  exportPresets: z.array(ExportPresetSchema).default([]),
  /** Project settings */
  settings: ProjectSettingsSchema.default({}),
  /** Autopilot configuration */
  autopilot: AutopilotConfigSchema.default({}),
  /** Edit history for undo/redo */
  history: z.array(HistoryEntrySchema).default([]),
});

// ── Inferred Types ──────────────────────────────────────────────────────

export type ProjectSettings = z.infer<typeof ProjectSettingsSchema>;
export type AutopilotConfig = z.infer<typeof AutopilotConfigSchema>;
export type HistoryEntry = z.infer<typeof HistoryEntrySchema>;
export type Timeline = z.infer<typeof TimelineSchema>;
export type Project = z.infer<typeof ProjectSchema>;

/** Lightweight project summary for list operations */
export interface ProjectSummary {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  assetCount: number;
  trackCount: number;
  duration: number;
}
