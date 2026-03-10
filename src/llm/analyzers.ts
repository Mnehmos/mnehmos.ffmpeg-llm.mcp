/**
 * @module llm/analyzers
 * @description Analysis implementations that combine frame sampling, LLM calls,
 * and result parsing for each autopilot analysis type.
 */

import type { Project } from '../schemas/project.js';
import type { Asset } from '../schemas/asset.js';
import type { AnalysisResult } from '../schemas/autopilot.js';
import type { OpenRouterClient } from './openrouter-client.js';
import type { FrameSampler } from './frame-sampler.js';
import {
  SCENE_OVERVIEW_PROMPT,
  HIGHLIGHT_DETECTION_PROMPT,
  CHAPTER_SUGGESTION_PROMPT,
  THUMBNAIL_CANDIDATES_PROMPT,
  EDIT_REVIEW_PROMPT,
} from './prompts.js';

/**
 * Build a base analysis result with common fields.
 * @param type - Analysis type string
 * @param model - Model used
 * @param costUsd - Cost in USD
 * @param usage - Token usage
 * @param data - Parsed result data
 * @param summary - Human-readable summary
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
 * Analyze video content for a scene-by-scene overview.
 *
 * Samples frames at the project's configured interval, sends them to the LLM
 * with the scene overview prompt, and returns structured scene descriptions.
 *
 * @param project - The project context
 * @param asset - The video asset to analyze
 * @param client - OpenRouter client for LLM calls
 * @param sampler - Frame sampler for extracting frames
 * @returns Analysis result with scene data
 */
export async function analyzeSceneOverview(
  project: Project,
  asset: Asset,
  client: OpenRouterClient,
  sampler: FrameSampler,
): Promise<AnalysisResult> {
  // TODO: Implement scene overview analysis
  // 1. Sample frames
  // 2. Send frames + SCENE_OVERVIEW_PROMPT to LLM via chatWithVision
  // 3. Parse JSON response
  // 4. Track cost

  void sampler;
  void asset;

  const response = await client.chat(
    [SCENE_OVERVIEW_PROMPT, { role: 'user', content: 'Analyze the video frames provided.' }],
    { model: project.autopilot.openrouterModel, responseFormat: { type: 'json_object' } },
  );

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
 *
 * @param project - The project context
 * @param asset - The video asset to analyze
 * @param client - OpenRouter client
 * @param sampler - Frame sampler
 * @returns Analysis result with highlight data
 */
export async function detectHighlights(
  project: Project,
  asset: Asset,
  client: OpenRouterClient,
  sampler: FrameSampler,
): Promise<AnalysisResult> {
  // TODO: Implement highlight detection
  void sampler;
  void asset;

  const response = await client.chat(
    [
      HIGHLIGHT_DETECTION_PROMPT,
      { role: 'user', content: 'Identify highlights in the video frames.' },
    ],
    { model: project.autopilot.openrouterModel, responseFormat: { type: 'json_object' } },
  );

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
 *
 * @param project - The project context
 * @param asset - The video asset to analyze
 * @param client - OpenRouter client
 * @param sampler - Frame sampler
 * @returns Analysis result with chapter suggestions
 */
export async function suggestChapters(
  project: Project,
  asset: Asset,
  client: OpenRouterClient,
  sampler: FrameSampler,
): Promise<AnalysisResult> {
  // TODO: Implement chapter suggestion
  void sampler;
  void asset;

  const response = await client.chat(
    [
      CHAPTER_SUGGESTION_PROMPT,
      { role: 'user', content: 'Suggest chapter markers for this video.' },
    ],
    { model: project.autopilot.openrouterModel, responseFormat: { type: 'json_object' } },
  );

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
 *
 * @param project - The project context
 * @param asset - The video asset to analyze
 * @param client - OpenRouter client
 * @param sampler - Frame sampler
 * @returns Analysis result with thumbnail candidates
 */
export async function selectThumbnails(
  project: Project,
  asset: Asset,
  client: OpenRouterClient,
  sampler: FrameSampler,
): Promise<AnalysisResult> {
  // TODO: Implement thumbnail selection
  void sampler;
  void asset;

  const response = await client.chat(
    [
      THUMBNAIL_CANDIDATES_PROMPT,
      { role: 'user', content: 'Select the best thumbnail candidates.' },
    ],
    { model: project.autopilot.openrouterModel, responseFormat: { type: 'json_object' } },
  );

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
 *
 * Unlike other analyzers, this does not use frame sampling — it analyzes
 * the project's timeline structure directly.
 *
 * @param project - The project to review
 * @param client - OpenRouter client
 * @returns Analysis result with edit feedback
 */
export async function reviewEdits(
  project: Project,
  client: OpenRouterClient,
): Promise<AnalysisResult> {
  // TODO: Implement edit review
  // Send timeline structure (tracks, clips, chapters) as text to LLM

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
