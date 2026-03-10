/**
 * @module tools/asset
 * @description Tool handlers for media asset management:
 * import, batch import, list, info, remove, and thumbnail generation.
 */

import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { ToolAction, ToolCategory, registerTool, type ToolResult } from './actionEnum.js';
import type { Storage } from '../storage/db.js';
import type { FFprobeRunner } from '../engine/ffprobe.js';
import type { FFmpegRunner } from '../engine/ffmpeg.js';
import type { Asset } from '../schemas/asset.js';

// ── Schemas ─────────────────────────────────────────────────────────────

const AssetImportSchema = z.object({
  projectId: z.string().min(1).describe('Project to import into'),
  filePath: z.string().min(1).describe('Absolute path to the media file'),
  tags: z.array(z.string()).default([]).describe('Optional tags for the asset'),
});

const AssetBatchImportSchema = z.object({
  projectId: z.string().min(1).describe('Project to import into'),
  filePaths: z.array(z.string().min(1)).min(1).describe('Array of file paths to import'),
  tags: z.array(z.string()).default([]).describe('Tags to apply to all imported assets'),
});

const AssetListSchema = z.object({
  projectId: z.string().min(1).describe('Project UUID'),
  type: z.string().optional().describe('Filter by asset type'),
  tags: z.array(z.string()).optional().describe('Filter by tags'),
});

const AssetInfoSchema = z.object({
  projectId: z.string().min(1).describe('Project UUID'),
  assetId: z.string().min(1).describe('Asset UUID'),
});

const AssetRemoveSchema = z.object({
  projectId: z.string().min(1).describe('Project UUID'),
  assetId: z.string().min(1).describe('Asset UUID to remove'),
  force: z.boolean().default(false).describe('Force removal even if clips reference this asset'),
});

const AssetGenerateThumbnailSchema = z.object({
  projectId: z.string().min(1).describe('Project UUID'),
  assetId: z.string().min(1).describe('Asset UUID'),
  timestamp: z.number().nonnegative().default(0).describe('Time in seconds for the thumbnail'),
});

// ── AssetTools Class ────────────────────────────────────────────────────

/**
 * Class-based tool handler for asset operations.
 */
export class AssetTools {
  private readonly storage: Storage;
  private readonly probeRunner: FFprobeRunner;

  constructor(storage: Storage, probeRunner: FFprobeRunner) {
    this.storage = storage;
    this.probeRunner = probeRunner;
  }

  async assetImport(params: {
    projectId: string;
    filePath: string;
    tags?: string[];
  }): Promise<{ asset: Asset }> {
    const { projectId, filePath, tags = [] } = params;

    const project = await this.storage.getProject(projectId);
    if (!project) throw new Error(`Project not found: ${projectId}`);

    const probeData = await this.probeRunner.probe(filePath);
    const videoStream = probeData.streams.find(
      (s: { codec_type: string }) => s.codec_type === 'video',
    );
    const audioStream = probeData.streams.find(
      (s: { codec_type: string }) => s.codec_type === 'audio',
    );

    const assetType = videoStream ? 'video' : audioStream ? 'audio' : 'data';

    const asset: Asset = {
      id: uuidv4(),
      type: assetType,
      path: filePath,
      originalName: filePath.split(/[/\\]/).pop() ?? filePath,
      duration: probeData.format.duration
        ? parseFloat(String(probeData.format.duration))
        : undefined,
      width: videoStream?.width,
      height: videoStream?.height,
      fps: videoStream?.r_frame_rate ? (eval(videoStream.r_frame_rate) as number) : undefined,
      codec: videoStream?.codec_name,
      audioCodec: audioStream?.codec_name,
      sampleRate: audioStream?.sample_rate
        ? parseInt(String(audioStream.sample_rate), 10)
        : undefined,
      channels: audioStream?.channels,
      fileSize: parseInt(String(probeData.format.size), 10),
      probeData,
      tags,
      importedAt: new Date().toISOString(),
    };

    project.assets.push(asset);
    project.updatedAt = new Date().toISOString();
    await this.storage.saveProject(project);

    return { asset };
  }

  async assetBatchImport(params: {
    projectId: string;
    filePaths: string[];
    tags?: string[];
  }): Promise<{
    summary: { total: number; successful: number; failed: number };
    assets: Asset[];
  }> {
    const { projectId, filePaths, tags } = params;
    const assets: Asset[] = [];
    let successful = 0;
    let failed = 0;

    for (const filePath of filePaths) {
      try {
        const result = await this.assetImport({ projectId, filePath, tags });
        assets.push(result.asset);
        successful++;
      } catch {
        failed++;
      }
    }

    return {
      summary: { total: filePaths.length, successful, failed },
      assets,
    };
  }

  async assetRemove(params: {
    projectId: string;
    assetId: string;
    force?: boolean;
  }): Promise<{ removed: boolean }> {
    const { projectId, assetId, force = false } = params;

    const project = await this.storage.getProject(projectId);
    if (!project) throw new Error(`Project not found: ${projectId}`);

    const assetIndex = project.assets.findIndex((a) => a.id === assetId);
    if (assetIndex === -1) throw new Error(`Asset not found: ${assetId}`);

    // Check for referencing clips
    const referencingClips = project.timeline.tracks.flatMap((t) =>
      t.clips.filter((c) => c.assetId === assetId),
    );

    if (referencingClips.length > 0 && !force) {
      throw new Error(
        `Asset is referenced by ${referencingClips.length} clip(s). Use force=true to remove anyway.`,
      );
    }

    // If force, remove referencing clips from their tracks
    if (force && referencingClips.length > 0) {
      for (const track of project.timeline.tracks) {
        track.clips = track.clips.filter((c) => c.assetId !== assetId);
      }
    }

    project.assets.splice(assetIndex, 1);
    project.updatedAt = new Date().toISOString();
    await this.storage.saveProject(project);

    return { removed: true };
  }

  async assetList(params: {
    projectId: string;
    type?: string;
    tags?: string[];
  }): Promise<{ assets: Asset[] }> {
    const { projectId, type, tags } = params;

    const project = await this.storage.getProject(projectId);
    if (!project) throw new Error(`Project not found: ${projectId}`);

    let assets = project.assets;

    if (type) {
      assets = assets.filter((a) => a.type === type);
    }

    if (tags && tags.length > 0) {
      assets = assets.filter((a) => tags.some((tag) => a.tags.includes(tag)));
    }

    return { assets };
  }
}

// ── Registration ────────────────────────────────────────────────────────

/**
 * Register all asset-related tools in the global registry.
 * @param _registry - Unused (tools register themselves globally)
 * @param db - Storage instance
 * @param ffprobe - FFprobe runner for media inspection
 * @param _ffmpeg - FFmpeg runner for thumbnail extraction
 */
export function registerAssetTools(
  _registry: unknown,
  db: Storage,
  ffprobe: FFprobeRunner,
  _ffmpeg: FFmpegRunner,
): void {
  const tools = new AssetTools(db, ffprobe);

  registerTool({
    action: ToolAction.ASSET_IMPORT,
    category: ToolCategory.ASSET,
    description: 'Import a media file into the project, probing its metadata',
    schema: AssetImportSchema,
    handler: async (params): Promise<ToolResult> => {
      const p = params as z.infer<typeof AssetImportSchema>;
      try {
        const result = await tools.assetImport(p);
        return {
          success: true,
          data: result.asset,
          summary: `Imported ${result.asset.type} asset "${result.asset.originalName}"`,
        };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  });

  registerTool({
    action: ToolAction.ASSET_BATCH_IMPORT,
    category: ToolCategory.ASSET,
    description: 'Import multiple media files at once',
    schema: AssetBatchImportSchema,
    handler: async (params): Promise<ToolResult> => {
      const p = params as z.infer<typeof AssetBatchImportSchema>;
      const result = await tools.assetBatchImport(p);
      return {
        success: true,
        data: result,
        summary: `Batch import: ${result.summary.successful}/${result.summary.total} succeeded`,
      };
    },
  });

  registerTool({
    action: ToolAction.ASSET_LIST,
    category: ToolCategory.ASSET,
    description: 'List all assets in a project',
    schema: AssetListSchema,
    handler: async (params): Promise<ToolResult> => {
      const p = params as z.infer<typeof AssetListSchema>;
      try {
        const result = await tools.assetList(p);
        return {
          success: true,
          data: result.assets,
          summary: `${result.assets.length} asset(s)`,
        };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  });

  registerTool({
    action: ToolAction.ASSET_INFO,
    category: ToolCategory.ASSET,
    description: 'Get detailed metadata for a specific asset',
    schema: AssetInfoSchema,
    handler: async (params): Promise<ToolResult> => {
      const { projectId, assetId } = params as z.infer<typeof AssetInfoSchema>;
      const project = await db.getProject(projectId);
      if (!project) return { success: false, error: `Project not found: ${projectId}` };
      const asset = (project as { assets: Asset[] }).assets.find((a) => a.id === assetId);
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
      const p = params as z.infer<typeof AssetRemoveSchema>;
      try {
        const result = await tools.assetRemove(p);
        return { success: true, data: result, summary: 'Asset removed' };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
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
      void projectId;
      void assetId;
      void timestamp;
      return { success: false, error: 'Not implemented' };
    },
  });
}
