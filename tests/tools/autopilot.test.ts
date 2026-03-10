/**
 * Tests for autopilot tools — budget tracking, analyzers, and configuration.
 */

import { describe, it, expect } from 'vitest';
import { BudgetTracker } from '@/llm/budget';

describe('BudgetTracker', () => {
  it('starts with zero spent', () => {
    const budget = new BudgetTracker(5.0);
    expect(budget.totalSpent()).toBe(0);
    expect(budget.remainingBudget()).toBe(5.0);
  });

  it('records costs and updates remaining', () => {
    const budget = new BudgetTracker(1.0);
    budget.recordCost('model-a', 0.25);
    budget.recordCost('model-b', 0.3);

    expect(budget.totalSpent()).toBeCloseTo(0.55);
    expect(budget.remainingBudget()).toBeCloseTo(0.45);
  });

  it('canAfford checks against remaining budget', () => {
    const budget = new BudgetTracker(1.0);
    budget.recordCost('model-a', 0.8);

    expect(budget.canAfford(0.2)).toBe(true);
    expect(budget.canAfford(0.21)).toBe(false);
  });

  it('tracks cost breakdown by model', () => {
    const budget = new BudgetTracker(5.0);
    budget.recordCost('model-a', 0.1);
    budget.recordCost('model-a', 0.15);
    budget.recordCost('model-b', 0.3);

    const breakdown = budget.getCostBreakdown();
    expect(breakdown['model-a']).toBeCloseTo(0.25);
    expect(breakdown['model-b']).toBeCloseTo(0.3);
  });

  it('reset clears all state', () => {
    const budget = new BudgetTracker(5.0);
    budget.recordCost('model-a', 1.0);
    budget.reset();

    expect(budget.totalSpent()).toBe(0);
    expect(budget.remainingBudget()).toBe(5.0);
    expect(budget.getCostBreakdown()).toEqual({});
  });

  it('remainingBudget never goes negative', () => {
    const budget = new BudgetTracker(1.0);
    budget.recordCost('model-a', 5.0);

    expect(budget.remainingBudget()).toBe(0);
  });

  it('accepts options object', () => {
    const budget = new BudgetTracker({ maxBudgetUsd: 10.0 });
    expect(budget.remainingBudget()).toBe(10.0);
  });
});

describe('Analyzer result structure', () => {
  it('AnalysisResult schema has correct shape', async () => {
    const { AnalysisResultSchema } = await import('@/schemas/autopilot');

    const valid = {
      type: 'scene_overview',
      timestamp: new Date().toISOString(),
      model: 'test-model',
      costUsd: 0.01,
      usage: { inputTokens: 100, outputTokens: 50 },
      data: { scenes: [] },
      summary: 'Test result',
    };

    const parsed = AnalysisResultSchema.parse(valid);
    expect(parsed.type).toBe('scene_overview');
    expect(parsed.costUsd).toBe(0.01);
  });

  it('EditSuggestion schema validates correctly', async () => {
    const { EditSuggestionSchema } = await import('@/schemas/autopilot');

    const valid = {
      id: crypto.randomUUID(),
      toolAction: 'clip_add',
      params: { trackIndex: 0 },
      description: 'Add a clip',
      confidence: 0.85,
      applied: false,
    };

    const parsed = EditSuggestionSchema.parse(valid);
    expect(parsed.confidence).toBe(0.85);
    expect(parsed.applied).toBe(false);
  });

  it('rejects invalid analysis types', async () => {
    const { AnalysisTypeEnum } = await import('@/schemas/autopilot');

    expect(() => AnalysisTypeEnum.parse('invalid_type')).toThrow();
  });

  it('accepts all valid analysis types', async () => {
    const { AnalysisTypeEnum } = await import('@/schemas/autopilot');
    const types = [
      'scene_overview',
      'highlight_detection',
      'chapter_suggestion',
      'thumbnail_candidates',
      'edit_review',
    ];

    for (const t of types) {
      expect(AnalysisTypeEnum.parse(t)).toBe(t);
    }
  });
});
