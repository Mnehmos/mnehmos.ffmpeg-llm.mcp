/**
 * @module tools/preview
 * @description Tool handlers for preview rendering and full export:
 * segment preview, frame extraction, full render, status, and cancellation.
 */

import { z } from 'zod';
import { ToolAction, ToolCategory, registerTool, type ToolResult } from './actionEnum.js';
import type { Storage } from '../storage/db.js';
import { FFmpegRunner } from '../engine/ffmpeg.js';
import { RenderQueue } from '../engine/render-queue.js';
import { buildPreviewCommand, buildFrameExtractCommand } from '../engine/command-builder.js';
import { getTempPath } from '../utils/paths.js';
import { YOUTUBE_PRESET } from '../schemas/export.js';

// ── Schemas ─────────────────────────────────────────────────────────────

const PreviewSegmentSchema = z.object({
  projectId: z.string().uuid(),
  start: z.number().nonnegative().describe('Start time in seconds'),
  end: z.number().positive().describe('End time in seconds'),
});

const PreviewFrameSchema = z.object({
  projectId: z.string().uuid(),
  assetId: z.string().uuid(),
  timestamp: z.number().nonnegative().describe('Time in seconds'),
});

const RenderFullSchema = z.object({
  projectId: z.string().uuid(),
  outputPath: z.string().min(1).describe('Output file path'),
  presetName: z.string().optional().describe('Export preset name (default: YouTube)'),
});

const RenderStatusSchema = z.object({
  jobId: z.string().uuid(),
});

const RenderCancelSchema = z.object({
  jobId: z.string().uuid(),
});

// ── Registration ────────────────────────────────────────────────────────

/**
 * Register all preview and render tools (5 total).
 * @param _registry - Unused
 * @param db - Storage instance
 * @param ffmpeg - FFmpeg runner
 * @param renderQueue - Background render queue
 */
export function registerPreviewTools(
  _registry: unknown,
  db: Storage,
  ffmpeg: FFmpegRunner,
  renderQueue: RenderQueue,
): void {
  registerTool({
    action: ToolAction.PREVIEW_SEGMENT,
    category: ToolCategory.PREVIEW,
    description: 'Render a low-quality preview of a timeline segment',
    schema: PreviewSegmentSchema,
    handler: async (params): Promise<ToolResult> => {
      const { projectId, start, end } = params as z.infer<typeof PreviewSegmentSchema>;

      const project = db.getProject(projectId);
      if (!project) return { success: false, error: `Project not found: ${projectId}` };

      if (end <= start) return { success: false, error: 'End must be after start' };

      const outputPath = getTempPath(project.workDir, 'preview') + '.mp4';
      const args = buildPreviewCommand(project, start, end, outputPath);
      const result = await ffmpeg.run(args);

      if (result.exitCode !== 0) {
        return { success: false, error: `Preview render failed: ${result.stderr.slice(0, 500)}` };
      }

      return {
        success: true,
        data: { outputPath },
        summary: `Preview rendered: ${start}s-${end}s`,
      };
    },
  });

  registerTool({
    action: ToolAction.PREVIEW_FRAME,
    category: ToolCategory.PREVIEW,
    description: 'Extract a single frame from an asset at a given timestamp',
    schema: PreviewFrameSchema,
    handler: async (params): Promise<ToolResult> => {
      const { projectId, assetId, timestamp } = params as z.infer<typeof PreviewFrameSchema>;

      const project = db.getProject(projectId);
      if (!project) return { success: false, error: `Project not found: ${projectId}` };

      const asset = project.assets.find((a) => a.id === assetId);
      if (!asset) return { success: false, error: `Asset not found: ${assetId}` };

      const outputPath = getTempPath(project.workDir, `frame_${timestamp}`) + '.jpg';
      const args = buildFrameExtractCommand(asset.path, timestamp, outputPath);
      const result = await ffmpeg.run(args);

      if (result.exitCode !== 0) {
        return { success: false, error: `Frame extraction failed: ${result.stderr.slice(0, 500)}` };
      }

      return {
        success: true,
        data: { outputPath, timestamp },
        summary: `Extracted frame at ${timestamp}s`,
      };
    },
  });

  registerTool({
    action: ToolAction.RENDER_FULL,
    category: ToolCategory.PREVIEW,
    description: 'Enqueue a full-quality render of the project timeline',
    schema: RenderFullSchema,
    handler: async (params): Promise<ToolResult> => {
      const { projectId, outputPath, presetName } = params as z.infer<typeof RenderFullSchema>;

      const project = db.getProject(projectId);
      if (!project) return { success: false, error: `Project not found: ${projectId}` };

      // Find preset by name or use default YouTube preset
      const preset = presetName
        ? project.exportPresets.find((p) => p.name === presetName)
        : YOUTUBE_PRESET;

      if (presetName && !preset) {
        return { success: false, error: `Export preset not found: ${presetName}` };
      }

      const jobId = renderQueue.enqueue(project, outputPath, preset);

      return {
        success: true,
        data: { jobId, outputPath },
        summary: `Render enqueued (job: ${jobId})`,
      };
    },
  });

  registerTool({
    action: ToolAction.RENDER_STATUS,
    category: ToolCategory.PREVIEW,
    description: 'Check the status of a render job',
    schema: RenderStatusSchema,
    handler: async (params): Promise<ToolResult> => {
      const { jobId } = params as z.infer<typeof RenderStatusSchema>;
      const status = renderQueue.getStatus(jobId);
      if (!status) return { success: false, error: `Render job not found: ${jobId}` };

      return {
        success: true,
        data: status,
        summary: `Job ${jobId}: ${status.status} (${Math.round(status.progress * 100)}%)`,
      };
    },
  });

  registerTool({
    action: ToolAction.RENDER_CANCEL,
    category: ToolCategory.PREVIEW,
    description: 'Cancel an active render job',
    schema: RenderCancelSchema,
    handler: async (params): Promise<ToolResult> => {
      const { jobId } = params as z.infer<typeof RenderCancelSchema>;
      const cancelled = renderQueue.cancel(jobId);
      if (!cancelled) {
        return {
          success: false,
          error: `Could not cancel job ${jobId} (not found or already complete)`,
        };
      }
      return { success: true, summary: `Cancelled render job ${jobId}` };
    },
  });
}
