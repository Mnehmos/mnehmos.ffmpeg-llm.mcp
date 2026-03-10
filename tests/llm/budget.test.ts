/**
 * Tests for LLM budget tracking.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { BudgetTracker } from '@/llm/budget';

describe('BudgetTracker', () => {
  let tracker: BudgetTracker;

  beforeEach(() => {
    tracker = new BudgetTracker({ maxBudgetUsd: 5.0 });
  });

  // -------------------------------------------------------------------------
  // Cost recording
  // -------------------------------------------------------------------------

  describe('cost recording', () => {
    it('records costs per model', () => {
      tracker.recordCost('google/gemini-2.0-flash-001', 0.001);
      tracker.recordCost('google/gemini-2.0-flash-001', 0.002);
      tracker.recordCost('anthropic/claude-sonnet-4-20250514', 0.05);

      const breakdown = tracker.getCostBreakdown();

      expect(breakdown['google/gemini-2.0-flash-001']).toBeCloseTo(0.003);
      expect(breakdown['anthropic/claude-sonnet-4-20250514']).toBeCloseTo(0.05);
    });

    it('tracks total spent', () => {
      tracker.recordCost('google/gemini-2.0-flash-001', 0.01);
      tracker.recordCost('google/gemini-2.0-flash-001', 0.02);

      expect(tracker.totalSpent()).toBeCloseTo(0.03);
    });

    it('handles zero cost', () => {
      tracker.recordCost('test-model', 0);
      expect(tracker.totalSpent()).toBe(0);
    });

    it('accumulates many small costs accurately', () => {
      for (let i = 0; i < 100; i++) {
        tracker.recordCost('cheap-model', 0.001);
      }
      expect(tracker.totalSpent()).toBeCloseTo(0.1);
    });
  });

  // -------------------------------------------------------------------------
  // canAfford
  // -------------------------------------------------------------------------

  describe('canAfford', () => {
    it('returns true when under budget', () => {
      tracker.recordCost('model-a', 1.0);
      expect(tracker.canAfford(1.0)).toBe(true);
    });

    it('returns false when budget exhausted', () => {
      tracker.recordCost('model-a', 5.0);
      expect(tracker.canAfford(0.01)).toBe(false);
    });

    it('returns false when request would exceed budget', () => {
      tracker.recordCost('model-a', 4.5);
      expect(tracker.canAfford(1.0)).toBe(false);
    });

    it('returns true when exactly at remaining budget', () => {
      tracker.recordCost('model-a', 3.0);
      expect(tracker.canAfford(2.0)).toBe(true);
    });

    it('returns true with zero cost request', () => {
      tracker.recordCost('model-a', 4.99);
      expect(tracker.canAfford(0)).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Cost breakdown
  // -------------------------------------------------------------------------

  describe('getCostBreakdown', () => {
    it('returns breakdown by model', () => {
      tracker.recordCost('model-a', 1.0);
      tracker.recordCost('model-b', 2.0);
      tracker.recordCost('model-a', 0.5);

      const breakdown = tracker.getCostBreakdown();

      expect(Object.keys(breakdown)).toHaveLength(2);
      expect(breakdown['model-a']).toBeCloseTo(1.5);
      expect(breakdown['model-b']).toBeCloseTo(2.0);
    });

    it('returns empty object when no costs recorded', () => {
      const breakdown = tracker.getCostBreakdown();
      expect(breakdown).toEqual({});
    });
  });

  // -------------------------------------------------------------------------
  // Reset
  // -------------------------------------------------------------------------

  describe('reset', () => {
    it('clears all recorded costs', () => {
      tracker.recordCost('model-a', 1.0);
      tracker.recordCost('model-b', 2.0);

      tracker.reset();

      expect(tracker.totalSpent()).toBe(0);
      expect(tracker.getCostBreakdown()).toEqual({});
      expect(tracker.canAfford(5.0)).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Budget remaining
  // -------------------------------------------------------------------------

  describe('remaining budget', () => {
    it('reports correct remaining amount', () => {
      tracker.recordCost('model-a', 1.5);

      expect(tracker.remainingBudget()).toBeCloseTo(3.5);
    });

    it('returns zero when budget fully spent', () => {
      tracker.recordCost('model-a', 5.0);

      expect(tracker.remainingBudget()).toBe(0);
    });

    it('does not go negative', () => {
      tracker.recordCost('model-a', 6.0); // over budget

      expect(tracker.remainingBudget()).toBeLessThanOrEqual(0);
    });
  });
});
