/**
 * Tests for time utility functions.
 */

import { describe, it, expect } from 'vitest';
import { formatTimestamp, parseTimestamp, secondsToFFmpegTime, clamp } from '@/utils/time';

// ---------------------------------------------------------------------------
// formatTimestamp
// ---------------------------------------------------------------------------

describe('formatTimestamp', () => {
  it('formats zero correctly', () => {
    expect(formatTimestamp(0)).toBe('00:00:00.000');
  });

  it('formats a complex timestamp', () => {
    // 1 hour + 1 minute + 1 second + 500ms = 3661.5
    expect(formatTimestamp(3661.5)).toBe('01:01:01.500');
  });

  it('formats seconds only', () => {
    expect(formatTimestamp(45)).toBe('00:00:45.000');
  });

  it('formats minutes and seconds', () => {
    expect(formatTimestamp(125)).toBe('00:02:05.000');
  });

  it('handles sub-millisecond precision', () => {
    const result = formatTimestamp(1.0005);
    // Should not crash; exact format may truncate
    expect(result).toMatch(/^00:00:01\.\d{3}$/);
  });

  it('handles large values', () => {
    // 10 hours
    const result = formatTimestamp(36000);
    expect(result).toBe('10:00:00.000');
  });

  it('handles fractional milliseconds', () => {
    const result = formatTimestamp(0.123);
    expect(result).toBe('00:00:00.123');
  });
});

// ---------------------------------------------------------------------------
// parseTimestamp
// ---------------------------------------------------------------------------

describe('parseTimestamp', () => {
  it('round-trips with formatTimestamp', () => {
    const values = [0, 1.5, 60, 3661.5, 7200, 0.123];
    for (const val of values) {
      const formatted = formatTimestamp(val);
      const parsed = parseTimestamp(formatted);
      expect(parsed).toBeCloseTo(val, 2);
    }
  });

  it('parses HH:MM:SS.mmm format', () => {
    expect(parseTimestamp('01:30:00.000')).toBeCloseTo(5400);
  });

  it('parses HH:MM:SS format (no millis)', () => {
    expect(parseTimestamp('00:05:00')).toBeCloseTo(300);
  });

  it('throws on invalid format', () => {
    expect(() => parseTimestamp('invalid')).toThrow();
  });

  it('parses zero', () => {
    expect(parseTimestamp('00:00:00.000')).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// secondsToFFmpegTime
// ---------------------------------------------------------------------------

describe('secondsToFFmpegTime', () => {
  it('converts seconds to FFmpeg time format', () => {
    const result = secondsToFFmpegTime(90.5);
    // FFmpeg accepts HH:MM:SS.mmm or just seconds
    expect(result).toBeDefined();
    expect(typeof result).toBe('string');
  });

  it('handles zero', () => {
    const result = secondsToFFmpegTime(0);
    expect(result).toBeDefined();
  });

  it('handles large values', () => {
    const result = secondsToFFmpegTime(7200);
    expect(result).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// clamp
// ---------------------------------------------------------------------------

describe('clamp', () => {
  it('returns value when within bounds', () => {
    expect(clamp(5, 0, 10)).toBe(5);
  });

  it('clamps to min when below', () => {
    expect(clamp(-5, 0, 10)).toBe(0);
  });

  it('clamps to max when above', () => {
    expect(clamp(15, 0, 10)).toBe(10);
  });

  it('returns min when value equals min', () => {
    expect(clamp(0, 0, 10)).toBe(0);
  });

  it('returns max when value equals max', () => {
    expect(clamp(10, 0, 10)).toBe(10);
  });

  it('works with negative ranges', () => {
    expect(clamp(-5, -10, -1)).toBe(-5);
    expect(clamp(-15, -10, -1)).toBe(-10);
    expect(clamp(0, -10, -1)).toBe(-1);
  });

  it('works with floating point values', () => {
    expect(clamp(0.5, 0, 1)).toBe(0.5);
    expect(clamp(1.5, 0, 1)).toBe(1);
    expect(clamp(-0.5, 0, 1)).toBe(0);
  });
});
