/**
 * @module llm/analyzers
 * @description Analysis implementations that combine frame sampling, LLM calls,
 * and result parsing for each autopilot analysis type.
 */

import type { Project } from '../schemas/project.js';
import type { Asset } from '../schemas/asset.js';
import type { AnalysisResult } from '../schemas/autopilot.js';
import type { OpenRouterClient } from './openrouter-client.js';
import type { FrameSampler, SampledFrame } from './frame-sampler.js';
import type { FFmpegRunner } from '../engine/ffmpeg.js';
import {
  SCENE_OVERVIEW_PROMPT,
  HIGHLIGHT_DETECTION_PROMPT,
  CHAPTER_SUGGESTION_PROMPT,
  THUMBNAIL_CANDIDATES_PROMPT,
  EDIT_REVIEW_PROMPT,
} from './prompts.js';

/**
 * Build a base analysis result with common fields.
 */
function buildResult(
  type: AnalysisResult['type'],
  model: string,
  costUsd: number,
  usage: { inputTokens: number; outputTokens: number },
  data: unknown,
  summary: string,
): AnalysisResult {
  return {
    type,
    timestamp: new Date().toISOString(),
    model,
    costUsd,
    usage,
    data,
    summary,
  };
}

/**
 * Sample frames from an asset for vision analysis.
 * Returns empty array if sampling fails (graceful degradation).
 */
async function sampleForAnalysis(
  asset: Asset,
  sampler: FrameSampler,
  ffmpeg: FFmpegRunner,
  intervalSeconds: number = 30,
): Promise<SampledFrame[]> {
  try {
    return await sampler.sampleFrames(asset.path, intervalSeconds, ffmpeg);
  } catch {
    return [];
  }
}

/**
 * Call LLM with optional vision. Falls back to text-only if no frames.
 */
async function callLLM(
  client: OpenRouterClient,
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
  frames: SampledFrame[],
  project: Project,
): Promise<import('./openrouter-client.js').ChatResponse> {
  const imageBuffers = frames.map((f) => f.imageBuffer);

  if (imageBuffers.length > 0) {
    return client.chatWithVision(messages, imageBuffers, {
      model: project.autopilot.visionModel,
      responseFormat: { type: 'json_object' },
    });
  }

  return client.chat(messages, {
    model: project.autopilot.openrouterModel,
    responseFormat: { type: 'json_object' },
  });
}

/**
 * Analyze video content for a scene-by-scene overview.
 */
export async function analyzeSceneOverview(
  project: Project,
  asset: Asset,
  client: OpenRouterClient,
  sampler: FrameSampler,
  ffmpeg: FFmpegRunner,
): Promise<AnalysisResult> {
  const frames = await sampleForAnalysis(asset, sampler, ffmpeg, 30);

  const messages = [
    SCENE_OVERVIEW_PROMPT,
    {
      role: 'user' as const,
      content: `Analyze ${frames.length > 0 ? `these ${frames.length} frames from` : ''} "${asset.originalName}" (${asset.duration ?? 0}s).`,
    },
  ];

  const response = await callLLM(client, messages, frames, project);

  const costUsd = client.estimateCost(
    response.usage.prompt_tokens,
    response.usage.completion_tokens,
    response.model,
  );
  const data = JSON.parse(response.content);

  return buildResult(
    'scene_overview',
    response.model,
    costUsd,
    { inputTokens: response.usage.prompt_tokens, outputTokens: response.usage.completion_tokens },
    data,
    `Identified ${(data as { total_scenes?: number }).total_scenes ?? 0} scenes`,
  );
}

/**
 * Detect highlight moments in a video.
 */
export async function detectHighlights(
  project: Project,
  asset: Asset,
  client: OpenRouterClient,
  sampler: FrameSampler,
  ffmpeg: FFmpegRunner,
): Promise<AnalysisResult> {
  const frames = await sampleForAnalysis(asset, sampler, ffmpeg, 15);

  const messages = [
    HIGHLIGHT_DETECTION_PROMPT,
    {
      role: 'user' as const,
      content: `Identify highlights in "${asset.originalName}" (${asset.duration ?? 0}s). ${frames.length} frames sampled.`,
    },
  ];

  const response = await callLLM(client, messages, frames, project);

  const costUsd = client.estimateCost(
    response.usage.prompt_tokens,
    response.usage.completion_tokens,
    response.model,
  );
  const data = JSON.parse(response.content);

  return buildResult(
    'highlight_detection',
    response.model,
    costUsd,
    { inputTokens: response.usage.prompt_tokens, outputTokens: response.usage.completion_tokens },
    data,
    `Found ${(data as { highlights?: unknown[] }).highlights?.length ?? 0} highlights`,
  );
}

/**
 * Suggest chapter markers for a video.
 */
export async function suggestChapters(
  project: Project,
  asset: Asset,
  client: OpenRouterClient,
  sampler: FrameSampler,
  ffmpeg: FFmpegRunner,
): Promise<AnalysisResult> {
  const frames = await sampleForAnalysis(asset, sampler, ffmpeg, 60);

  const messages = [
    CHAPTER_SUGGESTION_PROMPT,
    {
      role: 'user' as const,
      content: `Suggest chapters for "${asset.originalName}" (${asset.duration ?? 0}s). ${frames.length} frames sampled.`,
    },
  ];

  const response = await callLLM(client, messages, frames, project);

  const costUsd = client.estimateCost(
    response.usage.prompt_tokens,
    response.usage.completion_tokens,
    response.model,
  );
  const data = JSON.parse(response.content);

  return buildResult(
    'chapter_suggestion',
    response.model,
    costUsd,
    { inputTokens: response.usage.prompt_tokens, outputTokens: response.usage.completion_tokens },
    data,
    `Suggested ${(data as { total_chapters?: number }).total_chapters ?? 0} chapters`,
  );
}

/**
 * Select the best thumbnail candidates from a video.
 */
export async function selectThumbnails(
  project: Project,
  asset: Asset,
  client: OpenRouterClient,
  sampler: FrameSampler,
  ffmpeg: FFmpegRunner,
): Promise<AnalysisResult> {
  const frames = await sampleForAnalysis(asset, sampler, ffmpeg, 10);

  const messages = [
    THUMBNAIL_CANDIDATES_PROMPT,
    {
      role: 'user' as const,
      content: `Select thumbnail candidates from "${asset.originalName}" (${asset.duration ?? 0}s). ${frames.length} frames sampled.`,
    },
  ];

  const response = await callLLM(client, messages, frames, project);

  const costUsd = client.estimateCost(
    response.usage.prompt_tokens,
    response.usage.completion_tokens,
    response.model,
  );
  const data = JSON.parse(response.content);

  return buildResult(
    'thumbnail_candidates',
    response.model,
    costUsd,
    { inputTokens: response.usage.prompt_tokens, outputTokens: response.usage.completion_tokens },
    data,
    `Found ${(data as { candidates?: unknown[] }).candidates?.length ?? 0} thumbnail candidates`,
  );
}

/**
 * Review the current edit state of a project.
 * Does not use frame sampling — analyzes timeline structure directly.
 */
export async function reviewEdits(
  project: Project,
  client: OpenRouterClient,
): Promise<AnalysisResult> {
  const timelineSummary = JSON.stringify(
    {
      tracks: project.timeline.tracks.map((t) => ({
        name: t.name,
        type: t.type,
        clipCount: t.clips.length,
        clips: t.clips.map((c) => ({
          timelineStart: c.timelineStart,
          duration: (c.sourceRange.end - c.sourceRange.start) / c.speed,
          speed: c.speed,
          volume: c.volume,
          filterCount: c.filters.length,
        })),
      })),
      chapters: project.timeline.chapters,
      duration: project.timeline.duration,
    },
    null,
    2,
  );

  const response = await client.chat(
    [EDIT_REVIEW_PROMPT, { role: 'user', content: `Review this timeline:\n\n${timelineSummary}` }],
    { model: project.autopilot.openrouterModel, responseFormat: { type: 'json_object' } },
  );

  const costUsd = client.estimateCost(
    response.usage.prompt_tokens,
    response.usage.completion_tokens,
    response.model,
  );
  const data = JSON.parse(response.content);

  return buildResult(
    'edit_review',
    response.model,
    costUsd,
    { inputTokens: response.usage.prompt_tokens, outputTokens: response.usage.completion_tokens },
    data,
    `Edit review: rating ${(data as { overall_rating?: number }).overall_rating ?? '?'}/10`,
  );
}
