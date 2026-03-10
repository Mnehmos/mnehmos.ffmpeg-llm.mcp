/**
 * @module engine/command-builder
 * @description Converts project timeline data into FFmpeg command-line arguments.
 * Resolves assets to -i inputs, builds filter graphs, and applies export presets.
 */

import type { Project } from '../schemas/project.js';
import type { ExportPreset } from '../schemas/export.js';
import { FilterGraphBuilder } from './filter-graph.js';

// ── CommandBuilder ──────────────────────────────────────────────────────

/**
 * Builds FFmpeg command-line argument arrays from project state.
 */
export class CommandBuilder {
  /**
   * Build a full render command from a project timeline.
   * @param project - The project with timeline, assets, and settings
   * @param outputPath - Output file path
   * @param presetName - Optional preset name to look up from project.exportPresets
   * @returns FFmpeg argument array (without 'ffmpeg' binary)
   */
  buildRenderArgs(project: Project, outputPath: string, presetName?: string): string[] {
    const args: string[] = [];

    // Resolve assets → input indices
    const assetMap = new Map<string, number>();
    let inputIndex = 0;

    for (const track of project.timeline.tracks) {
      for (const clip of track.clips) {
        if (!assetMap.has(clip.assetId)) {
          const asset = project.assets.find((a) => a.id === clip.assetId);
          if (asset) {
            args.push('-i', asset.path);
            assetMap.set(clip.assetId, inputIndex++);
          }
        }
      }
    }

    // Collect all clips sorted by timeline position
    const allClips = project.timeline.tracks.flatMap((t) => t.clips);
    allClips.sort((a, b) => a.timelineStart - b.timelineStart);

    // Build filter graph if there are clips that need processing
    if (allClips.length > 0) {
      const fg = new FilterGraphBuilder();

      for (const clip of allClips) {
        const idx = assetMap.get(clip.assetId);
        if (idx !== undefined) {
          fg.addClip(clip, idx);
        }
      }

      const filterStr = fg.build();
      if (filterStr) {
        args.push('-filter_complex', filterStr);
      }
    }

    // Chapter metadata
    if (project.timeline.chapters.length > 0) {
      const metadataLines: string[] = [';FFMETADATA1'];
      for (const ch of project.timeline.chapters) {
        const startMs = Math.round(ch.timelineStart * 1000);
        metadataLines.push('[CHAPTER]');
        metadataLines.push('TIMEBASE=1/1000');
        metadataLines.push(`START=${startMs}`);
        metadataLines.push(`title=${ch.title}`);
      }
      // Pass chapter metadata via global metadata flag
      args.push('-metadata', `chapters=${metadataLines.join('\n')}`);
    }

    // Apply export preset
    const preset = presetName
      ? project.exportPresets.find((p) => p.name === presetName)
      : undefined;

    if (preset) {
      args.push('-c:v', preset.videoCodec);
      args.push('-c:a', preset.audioCodec);
      if (preset.videoBitrate) args.push('-b:v', preset.videoBitrate);
      if (preset.audioBitrate) args.push('-b:a', preset.audioBitrate);
      if (preset.resolution) args.push('-s', `${preset.resolution.w}x${preset.resolution.h}`);
      if (preset.fps) args.push('-r', String(preset.fps));
      args.push(...preset.extraArgs);
    }

    args.push('-y', outputPath);
    return args;
  }

  /**
   * Build a preview command with fast encode settings.
   */
  buildPreviewArgs(project: Project, start: number, end: number, outputPath: string): string[] {
    const args: string[] = [];

    // Add inputs
    for (const asset of project.assets) {
      args.push('-i', asset.path);
    }

    // Fast preview settings
    args.push(
      '-ss',
      String(start),
      '-t',
      String(end - start),
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      '-crf',
      '28',
      '-c:a',
      'aac',
      '-b:a',
      '128k',
      '-y',
      outputPath,
    );

    return args;
  }

  /**
   * Build a command to extract a single frame from a media file.
   */
  buildFrameExtractArgs(assetPath: string, timestamp: number, outputPath: string): string[] {
    return [
      '-ss',
      String(timestamp),
      '-i',
      assetPath,
      '-frames:v',
      '1',
      '-q:v',
      '2',
      '-y',
      outputPath,
    ];
  }

  /**
   * Build two-pass encoding commands. Returns an array of two argument arrays.
   */
  buildTwoPassArgs(project: Project, outputPath: string, presetName: string): string[][] {
    const preset = project.exportPresets.find((p) => p.name === presetName) as
      | ExportPreset
      | undefined;

    // Base args (inputs + filter graph)
    const baseArgs: string[] = [];
    const assetMap = new Map<string, number>();
    let inputIndex = 0;

    for (const track of project.timeline.tracks) {
      for (const clip of track.clips) {
        if (!assetMap.has(clip.assetId)) {
          const asset = project.assets.find((a) => a.id === clip.assetId);
          if (asset) {
            baseArgs.push('-i', asset.path);
            assetMap.set(clip.assetId, inputIndex++);
          }
        }
      }
    }

    const allClips = project.timeline.tracks.flatMap((t) => t.clips);
    allClips.sort((a, b) => a.timelineStart - b.timelineStart);

    if (allClips.length > 0) {
      const fg = new FilterGraphBuilder();
      for (const clip of allClips) {
        const idx = assetMap.get(clip.assetId);
        if (idx !== undefined) {
          fg.addClip(clip, idx);
        }
      }
      const filterStr = fg.build();
      if (filterStr) {
        baseArgs.push('-filter_complex', filterStr);
      }
    }

    // Codec args from preset
    const codecArgs: string[] = [];
    if (preset) {
      codecArgs.push('-c:v', preset.videoCodec);
      codecArgs.push('-c:a', preset.audioCodec);
      if (preset.videoBitrate) codecArgs.push('-b:v', preset.videoBitrate);
      if (preset.audioBitrate) codecArgs.push('-b:a', preset.audioBitrate);
      if (preset.resolution) codecArgs.push('-s', `${preset.resolution.w}x${preset.resolution.h}`);
      if (preset.fps) codecArgs.push('-r', String(preset.fps));
      codecArgs.push(...preset.extraArgs);
    }

    // Pass 1: analyze, output to /dev/null
    const pass1 = [
      ...baseArgs,
      ...codecArgs,
      '-pass',
      '1',
      '-an',
      '-f',
      'null',
      '-y',
      process.platform === 'win32' ? 'NUL' : '/dev/null',
    ];

    // Pass 2: encode to output file
    const pass2 = [...baseArgs, ...codecArgs, '-pass', '2', '-y', outputPath];

    return [pass1, pass2];
  }
}

// ── Legacy function exports (for backward compat) ───────────────────────

export function buildRenderCommand(
  project: Project,
  outputPath: string,
  preset?: ExportPreset,
): string[] {
  const builder = new CommandBuilder();
  // If preset provided directly, temporarily add to project
  if (preset) {
    const withPreset = {
      ...project,
      exportPresets: [...project.exportPresets, preset],
    };
    return builder.buildRenderArgs(withPreset, outputPath, preset.name);
  }
  return builder.buildRenderArgs(project, outputPath);
}

export function buildPreviewCommand(
  project: Project,
  start: number,
  end: number,
  outputPath: string,
): string[] {
  return new CommandBuilder().buildPreviewArgs(project, start, end, outputPath);
}

export function buildFrameExtractCommand(
  assetPath: string,
  timestamp: number,
  outputPath: string,
): string[] {
  return new CommandBuilder().buildFrameExtractArgs(assetPath, timestamp, outputPath);
}
