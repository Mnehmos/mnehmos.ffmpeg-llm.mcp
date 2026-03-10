/**
 * @module tools/asset
 * @description Tool handlers for media asset management:
 * import, batch import, list, info, remove, and thumbnail generation.
 */

import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { ToolAction, ToolCategory, registerTool, type ToolResult } from './actionEnum.js';
import type { Storage } from '../storage/db.js';
import { FFprobeRunner } from '../engine/ffprobe.js';
import { FFmpegRunner } from '../engine/ffmpeg.js';
import type { Asset } from '../schemas/asset.js';
import { buildFrameExtractCommand } from '../engine/command-builder.js';
import { getTempPath } from '../utils/paths.js';

// ── Schemas ─────────────────────────────────────────────────────────────

const AssetImportSchema = z.object({
  projectId: z.string().uuid().describe('Project to import into'),
  filePath: z.string().min(1).describe('Absolute path to the media file'),
  tags: z.array(z.string()).default([]).describe('Optional tags for the asset'),
});

const AssetBatchImportSchema = z.object({
  projectId: z.string().uuid().describe('Project to import into'),
  filePaths: z.array(z.string().min(1)).min(1).describe('Array of file paths to import'),
  tags: z.array(z.string()).default([]).describe('Tags to apply to all imported assets'),
});

const AssetListSchema = z.object({
  projectId: z.string().uuid().describe('Project UUID'),
});

const AssetInfoSchema = z.object({
  projectId: z.string().uuid().describe('Project UUID'),
  assetId: z.string().uuid().describe('Asset UUID'),
});

const AssetRemoveSchema = z.object({
  projectId: z.string().uuid().describe('Project UUID'),
  assetId: z.string().uuid().describe('Asset UUID to remove'),
  force: z.boolean().default(false).describe('Force removal even if clips reference this asset'),
});

const AssetGenerateThumbnailSchema = z.object({
  projectId: z.string().uuid().describe('Project UUID'),
  assetId: z.string().uuid().describe('Asset UUID'),
  timestamp: z.number().nonnegative().default(0).describe('Time in seconds for the thumbnail'),
});

// ── Registration ────────────────────────────────────────────────────────

/**
 * Register all asset-related tools in the global registry.
 * @param _registry - Unused (tools register themselves globally)
 * @param db - Storage instance
 * @param ffprobe - FFprobe runner for media inspection
 * @param ffmpeg - FFmpeg runner for thumbnail extraction
 */
export function registerAssetTools(
  _registry: unknown,
  db: Storage,
  ffprobe: FFprobeRunner,
  ffmpeg: FFmpegRunner,
): void {
  registerTool({
    action: ToolAction.ASSET_IMPORT,
    category: ToolCategory.ASSET,
    description: 'Import a media file into the project, probing its metadata',
    schema: AssetImportSchema,
    handler: async (params): Promise<ToolResult> => {
      const { projectId, filePath, tags } = params as z.infer<typeof AssetImportSchema>;

      const project = db.getProject(projectId);
      if (!project) return { success: false, error: `Project not found: ${projectId}` };

      // TODO: Validate file exists on disk (fs.access)

      const probeData = await ffprobe.probe(filePath);
      const videoStream = probeData.streams.find((s) => s.codec_type === 'video');
      const audioStream = probeData.streams.find((s) => s.codec_type === 'audio');

      // TODO: Determine asset type from streams
      const assetType = videoStream ? 'video' : audioStream ? 'audio' : 'data';

      const asset: Asset = {
        id: uuidv4(),
        type: assetType,
        path: filePath,
        originalName: filePath.split(/[/\\]/).pop() ?? filePath,
        duration: probeData.format.duration ? parseFloat(probeData.format.duration) : undefined,
        width: videoStream?.width,
        height: videoStream?.height,
        fps: videoStream?.r_frame_rate ? (eval(videoStream.r_frame_rate) as number) : undefined,
        codec: videoStream?.codec_name,
        audioCodec: audioStream?.codec_name,
        sampleRate: audioStream?.sample_rate ? parseInt(audioStream.sample_rate, 10) : undefined,
        channels: audioStream?.channels,
        fileSize: parseInt(probeData.format.size, 10),
        probeData,
        tags,
        importedAt: new Date().toISOString(),
      };

      project.assets.push(asset);
      project.updatedAt = new Date().toISOString();
      db.saveProject(project);

      return {
        success: true,
        data: {
          id: asset.id,
          type: asset.type,
          duration: asset.duration,
          originalName: asset.originalName,
        },
        summary: `Imported ${asset.type} asset "${asset.originalName}" (${asset.id})`,
      };
    },
  });

  registerTool({
    action: ToolAction.ASSET_BATCH_IMPORT,
    category: ToolCategory.ASSET,
    description: 'Import multiple media files at once',
    schema: AssetBatchImportSchema,
    handler: async (params): Promise<ToolResult> => {
      const { projectId, filePaths, tags } = params as z.infer<typeof AssetBatchImportSchema>;

      // TODO: Iterate filePaths, call asset_import logic for each
      // Return batch summary: { total, successful, failed, results[] }
      void projectId;
      void tags;

      return {
        success: true,
        data: { total: filePaths.length, successful: 0, failed: 0, results: [] },
        summary: `Batch import of ${filePaths.length} files — TODO: implement`,
      };
    },
  });

  registerTool({
    action: ToolAction.ASSET_LIST,
    category: ToolCategory.ASSET,
    description: 'List all assets in a project',
    schema: AssetListSchema,
    handler: async (params): Promise<ToolResult> => {
      const { projectId } = params as z.infer<typeof AssetListSchema>;
      const project = db.getProject(projectId);
      if (!project) return { success: false, error: `Project not found: ${projectId}` };

      const assets = project.assets.map((a) => ({
        id: a.id,
        type: a.type,
        originalName: a.originalName,
        duration: a.duration,
        tags: a.tags,
      }));

      return {
        success: true,
        data: assets,
        summary: `${assets.length} asset(s) in project`,
      };
    },
  });

  registerTool({
    action: ToolAction.ASSET_INFO,
    category: ToolCategory.ASSET,
    description: 'Get detailed metadata for a specific asset',
    schema: AssetInfoSchema,
    handler: async (params): Promise<ToolResult> => {
      const { projectId, assetId } = params as z.infer<typeof AssetInfoSchema>;
      const project = db.getProject(projectId);
      if (!project) return { success: false, error: `Project not found: ${projectId}` };

      const asset = project.assets.find((a) => a.id === assetId);
      if (!asset) return { success: false, error: `Asset not found: ${assetId}` };

      return { success: true, data: asset, summary: `Asset "${asset.originalName}"` };
    },
  });

  registerTool({
    action: ToolAction.ASSET_REMOVE,
    category: ToolCategory.ASSET,
    description:
      'Remove an asset from the project. Use force=true to also remove referencing clips.',
    schema: AssetRemoveSchema,
    handler: async (params): Promise<ToolResult> => {
      const { projectId, assetId, force } = params as z.infer<typeof AssetRemoveSchema>;
      const project = db.getProject(projectId);
      if (!project) return { success: false, error: `Project not found: ${projectId}` };

      const assetIndex = project.assets.findIndex((a) => a.id === assetId);
      if (assetIndex === -1) return { success: false, error: `Asset not found: ${assetId}` };

      // Check for referencing clips
      const referencingClips = project.timeline.tracks.flatMap((t) =>
        t.clips.filter((c) => c.assetId === assetId),
      );

      if (referencingClips.length > 0 && !force) {
        return {
          success: false,
          error: `Asset is referenced by ${referencingClips.length} clip(s). Use force=true to remove anyway.`,
        };
      }

      // TODO: If force, remove referencing clips from their tracks
      if (force && referencingClips.length > 0) {
        for (const track of project.timeline.tracks) {
          track.clips = track.clips.filter((c) => c.assetId !== assetId);
        }
      }

      const removed = project.assets.splice(assetIndex, 1)[0];
      project.updatedAt = new Date().toISOString();
      db.saveProject(project);

      return {
        success: true,
        summary: `Removed asset "${removed.originalName}"${force && referencingClips.length > 0 ? ` and ${referencingClips.length} referencing clip(s)` : ''}`,
      };
    },
  });

  registerTool({
    action: ToolAction.ASSET_GENERATE_THUMBNAIL,
    category: ToolCategory.ASSET,
    description: 'Extract a thumbnail frame from a video/image asset',
    schema: AssetGenerateThumbnailSchema,
    handler: async (params): Promise<ToolResult> => {
      const { projectId, assetId, timestamp } = params as z.infer<
        typeof AssetGenerateThumbnailSchema
      >;
      const project = db.getProject(projectId);
      if (!project) return { success: false, error: `Project not found: ${projectId}` };

      const asset = project.assets.find((a) => a.id === assetId);
      if (!asset) return { success: false, error: `Asset not found: ${assetId}` };

      const outputPath = getTempPath(project.workDir, `thumb_${assetId}`);
      const thumbPath = outputPath + '.jpg';
      const args = buildFrameExtractCommand(asset.path, timestamp, thumbPath);
      const result = await ffmpeg.run(args);

      if (result.exitCode !== 0) {
        return { success: false, error: `FFmpeg failed: ${result.stderr.slice(0, 500)}` };
      }

      return {
        success: true,
        data: { path: thumbPath, timestamp },
        summary: `Generated thumbnail at ${timestamp}s`,
      };
    },
  });
}
