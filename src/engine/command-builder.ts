/**
 * @module engine/command-builder
 * @description Converts project timeline data into FFmpeg command-line arguments.
 * Resolves assets to -i inputs, builds filter graphs, and applies export presets.
 */

import type { Project } from '../schemas/project.js';
import type { ExportPreset } from '../schemas/export.js';
import { FilterGraphBuilder } from './filter-graph.js';

/**
 * Build a complete FFmpeg render command from a project and export preset.
 *
 * Resolves each asset referenced by clips to an -i input, constructs the
 * filter graph via FilterGraphBuilder, and appends encoding flags from the preset.
 *
 * @param project - The full project with timeline, assets, and settings
 * @param outputPath - Absolute path for the output file
 * @param preset - Optional export preset (uses project defaults if omitted)
 * @returns Array of FFmpeg command-line arguments (without the 'ffmpeg' binary)
 */
export function buildRenderCommand(
  project: Project,
  outputPath: string,
  preset?: ExportPreset,
): string[] {
  // TODO: Implement full render command construction
  // 1. Collect all unique asset IDs referenced by clips
  // 2. Map each asset to a -i input flag
  // 3. Build filter graph for each track (trim, concat, filters)
  // 4. Apply export preset encoding flags
  // 5. Add output path

  const fg = new FilterGraphBuilder();
  void fg; // TODO: Use fg to build the filter graph from timeline
  const args: string[] = [];

  // Input files
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

  // TODO: Build filter graph from timeline tracks and clips
  // TODO: Apply preset encoding settings

  // Output flags
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
 * Build a lower-quality preview command for a segment of the timeline.
 *
 * @param project - The full project
 * @param start - Preview start time in seconds
 * @param end - Preview end time in seconds
 * @param outputPath - Path for the preview output file
 * @returns Array of FFmpeg command-line arguments
 */
export function buildPreviewCommand(
  project: Project,
  start: number,
  end: number,
  outputPath: string,
): string[] {
  // TODO: Implement preview command with fast encode settings
  const args: string[] = [];

  // Collect inputs same as render
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
 *
 * @param assetPath - Path to the source media file
 * @param timestamp - Time in seconds at which to extract the frame
 * @param outputPath - Path for the output image (e.g., .png or .jpg)
 * @returns Array of FFmpeg command-line arguments
 */
export function buildFrameExtractCommand(
  assetPath: string,
  timestamp: number,
  outputPath: string,
): string[] {
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
