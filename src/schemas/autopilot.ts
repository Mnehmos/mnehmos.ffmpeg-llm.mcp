/**
 * @module schemas/autopilot
 * @description Zod schemas for LLM-driven autopilot analysis and edit suggestions.
 */

import { z } from 'zod';

/** Types of analysis the autopilot can perform */
export const AnalysisTypeEnum = z.enum([
  'scene_overview',
  'highlight_detection',
  'chapter_suggestion',
  'thumbnail_candidates',
  'edit_review',
]);

/** Result from an autopilot analysis pass */
export const AnalysisResultSchema = z.object({
  /** Analysis type that produced this result */
  type: AnalysisTypeEnum,
  /** ISO timestamp of when the analysis was performed */
  timestamp: z.string().datetime(),
  /** LLM model used for the analysis */
  model: z.string(),
  /** Total cost in USD for this analysis */
  costUsd: z.number().nonnegative(),
  /** Token usage breakdown */
  usage: z.object({
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
  }),
  /** Structured analysis output (shape depends on analysis type) */
  data: z.unknown(),
  /** Human-readable summary of findings */
  summary: z.string(),
});

/** A specific edit suggestion from the autopilot */
export const EditSuggestionSchema = z.object({
  /** Unique suggestion identifier */
  id: z.string().uuid(),
  /** The tool action to invoke */
  toolAction: z.string(),
  /** Parameters to pass to the tool */
  params: z.record(z.string(), z.unknown()),
  /** Human-readable description of what this edit does */
  description: z.string(),
  /** Confidence score (0.0 - 1.0) */
  confidence: z.number().min(0).max(1),
  /** Whether this suggestion has been applied */
  applied: z.boolean().default(false),
  /** Reasoning behind the suggestion */
  reasoning: z.string().optional(),
});

/** Combined autopilot response with analysis and optional suggestions */
export const AutopilotResponseSchema = z.object({
  /** The analysis result */
  analysis: AnalysisResultSchema,
  /** Optional list of edit suggestions derived from the analysis */
  suggestions: z.array(EditSuggestionSchema).default([]),
});

// ── Inferred Types ──────────────────────────────────────────────────────

export type AnalysisType = z.infer<typeof AnalysisTypeEnum>;
export type AnalysisResult = z.infer<typeof AnalysisResultSchema>;
export type EditSuggestion = z.infer<typeof EditSuggestionSchema>;
export type AutopilotResponse = z.infer<typeof AutopilotResponseSchema>;
