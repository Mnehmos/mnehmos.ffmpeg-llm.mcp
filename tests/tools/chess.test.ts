/**
 * Tests for chess tools — detectGameBoundaries helper and tool handlers.
 */

import { describe, it, expect } from 'vitest';
import { detectGameBoundaries } from '@/tools/chess';
import type { SceneChange, SilenceRegion } from '@/tools/analysis';

describe('detectGameBoundaries', () => {
  it('returns empty array when no silence regions', () => {
    const sceneChanges: SceneChange[] = [
      { timestamp: 10, score: 0.8 },
      { timestamp: 60, score: 0.9 },
    ];
    const result = detectGameBoundaries(sceneChanges, [], 300);
    expect(result).toEqual([]);
  });

  it('creates boundaries from silence + scene change correlation', () => {
    const sceneChanges: SceneChange[] = [
      { timestamp: 120, score: 0.8 },
      { timestamp: 240, score: 0.9 },
    ];
    const silenceRegions: SilenceRegion[] = [
      { start: 119, end: 122, duration: 3 },
      { start: 238, end: 242, duration: 4 },
    ];

    const result = detectGameBoundaries(sceneChanges, silenceRegions, 360);

    expect(result.length).toBeGreaterThanOrEqual(2);
    // First game: 0 to ~122
    expect(result[0].start).toBe(0);
    expect(result[0].index).toBe(1);
    // Should have higher confidence for scene+silence match
    expect(result[0].confidence).toBeGreaterThanOrEqual(0.7);
  });

  it('uses long silence alone as boundary indicator', () => {
    const sceneChanges: SceneChange[] = [];
    const silenceRegions: SilenceRegion[] = [
      { start: 150, end: 155, duration: 5 }, // >= 2s, no scene change needed
    ];

    const result = detectGameBoundaries(sceneChanges, silenceRegions, 300);

    expect(result.length).toBeGreaterThanOrEqual(1);
    // Should have game from 0 to 155
    const first = result[0];
    expect(first.start).toBe(0);
    expect(first.end).toBe(155);
  });

  it('skips segments shorter than 30 seconds', () => {
    const silenceRegions: SilenceRegion[] = [
      { start: 10, end: 15, duration: 5 }, // Would create 0-15 (15s < 30s threshold)
      { start: 150, end: 155, duration: 5 },
    ];

    const result = detectGameBoundaries([], silenceRegions, 300);

    // The 0-15 segment should be skipped
    expect(result[0].start).toBe(0);
    expect(result[0].end).toBe(155);
  });

  it('adds final segment from last boundary to end', () => {
    const silenceRegions: SilenceRegion[] = [{ start: 100, end: 105, duration: 5 }];

    const result = detectGameBoundaries([], silenceRegions, 300);

    const last = result[result.length - 1];
    expect(last.end).toBe(300);
  });

  it('does not add final segment if too short', () => {
    const silenceRegions: SilenceRegion[] = [{ start: 280, end: 285, duration: 5 }];

    // 285 to 300 is only 15 seconds
    const result = detectGameBoundaries([], silenceRegions, 300);

    const last = result[result.length - 1];
    expect(last.end).toBe(285);
  });

  it('boosts confidence for scene + silence co-occurrence', () => {
    const sceneChanges: SceneChange[] = [{ timestamp: 121, score: 0.9 }];
    const silenceRegions: SilenceRegion[] = [{ start: 119, end: 122, duration: 3 }];

    const result = detectGameBoundaries(sceneChanges, silenceRegions, 300);

    // The game starting at boundary 122 should have boosted confidence
    // The second game starts at ~122, check it
    const game = result.find((g) => Math.abs(g.start - 122) < 1);
    if (game) {
      expect(game.confidence).toBe(0.9);
    }
  });

  it('deduplicates boundaries at the same time', () => {
    // Two silence regions ending at the same point
    const silenceRegions: SilenceRegion[] = [
      { start: 99, end: 105, duration: 6 },
      { start: 100, end: 105, duration: 5 }, // Same end point
    ];

    const result = detectGameBoundaries([], silenceRegions, 300);

    // Should not create duplicate segments
    const starts = result.map((g) => g.start);
    const uniqueStarts = [...new Set(starts)];
    expect(starts).toEqual(uniqueStarts);
  });

  it('assigns sequential indices', () => {
    const silenceRegions: SilenceRegion[] = [
      { start: 100, end: 105, duration: 5 },
      { start: 200, end: 205, duration: 5 },
    ];

    const result = detectGameBoundaries([], silenceRegions, 350);

    expect(result.map((g) => g.index)).toEqual([1, 2, 3]);
  });

  it('calculates duration correctly', () => {
    const silenceRegions: SilenceRegion[] = [{ start: 100, end: 105, duration: 5 }];

    const result = detectGameBoundaries([], silenceRegions, 300);

    for (const game of result) {
      expect(game.duration).toBeCloseTo(game.end - game.start);
    }
  });
});
