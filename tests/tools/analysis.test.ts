/**
 * Tests for analysis tool parsing functions and tool handlers.
 */

import { describe, it, expect } from 'vitest';
import { parseAudioLevels, parseSceneChanges, parseSilenceRegions } from '@/tools/analysis';

// ---------------------------------------------------------------------------
// parseAudioLevels
// ---------------------------------------------------------------------------

describe('parseAudioLevels', () => {
  const SAMPLE_ASTATS = `
[Parsed_astats_0 @ 0x55a7e0] Peak level dB: -3.25
[Parsed_astats_0 @ 0x55a7e0] RMS level dB: -18.50
[Parsed_astats_0 @ 0x55a7e0] Flat factor: 0.000000
`;

  it('extracts peak level from astats output', () => {
    const result = parseAudioLevels(SAMPLE_ASTATS);
    expect(result.peakDb).toBeCloseTo(-3.25);
  });

  it('extracts RMS level from astats output', () => {
    const result = parseAudioLevels(SAMPLE_ASTATS);
    expect(result.rmsDb).toBeCloseTo(-18.5);
  });

  it('calculates dynamic range from peak and RMS', () => {
    const result = parseAudioLevels(SAMPLE_ASTATS);
    expect(result.dynamicRange).toBeCloseTo(15.25);
  });

  it('includes raw output', () => {
    const result = parseAudioLevels(SAMPLE_ASTATS);
    expect(result.rawOutput).toBe(SAMPLE_ASTATS);
  });

  it('returns zeros for empty stderr', () => {
    const result = parseAudioLevels('');
    expect(result.peakDb).toBe(0);
    expect(result.rmsDb).toBe(0);
    expect(result.dynamicRange).toBe(0);
  });

  it('handles partial output (peak only)', () => {
    const result = parseAudioLevels('Peak level dB: -6.0');
    expect(result.peakDb).toBeCloseTo(-6.0);
    expect(result.rmsDb).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// parseSceneChanges
// ---------------------------------------------------------------------------

describe('parseSceneChanges', () => {
  const SAMPLE_SHOWINFO = `
[Parsed_showinfo_1 @ 0x55a7e0] n:  15 pts:  15000 pts_time:0.500000 scene:0.45
[Parsed_showinfo_1 @ 0x55a7e0] n: 150 pts: 150000 pts_time:5.000000 scene:0.82
[Parsed_showinfo_1 @ 0x55a7e0] n: 600 pts: 600000 pts_time:20.000000 scene:0.67
`;

  it('extracts timestamps from showinfo output', () => {
    const changes = parseSceneChanges(SAMPLE_SHOWINFO);
    expect(changes).toHaveLength(3);
    expect(changes[0].timestamp).toBeCloseTo(0.5);
    expect(changes[1].timestamp).toBeCloseTo(5.0);
    expect(changes[2].timestamp).toBeCloseTo(20.0);
  });

  it('extracts scene scores', () => {
    const changes = parseSceneChanges(SAMPLE_SHOWINFO);
    expect(changes[0].score).toBeCloseTo(0.45);
    expect(changes[1].score).toBeCloseTo(0.82);
  });

  it('returns empty array for no scene changes', () => {
    const changes = parseSceneChanges('random ffmpeg output with no pts_time');
    expect(changes).toEqual([]);
  });

  it('defaults score to 1.0 when scene field missing', () => {
    const output = '[showinfo] n: 10 pts: 10000 pts_time:1.234\n';
    const changes = parseSceneChanges(output);
    expect(changes).toHaveLength(1);
    expect(changes[0].score).toBe(1.0);
  });

  it('handles empty string', () => {
    expect(parseSceneChanges('')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// parseSilenceRegions
// ---------------------------------------------------------------------------

describe('parseSilenceRegions', () => {
  const SAMPLE_SILENCEDETECT = `
[silencedetect @ 0x55a7e0] silence_start: 1.500
[silencedetect @ 0x55a7e0] silence_end: 4.200 | silence_duration: 2.700
[silencedetect @ 0x55a7e0] silence_start: 10.000
[silencedetect @ 0x55a7e0] silence_end: 12.500 | silence_duration: 2.500
`;

  it('parses silence start and end times', () => {
    const regions = parseSilenceRegions(SAMPLE_SILENCEDETECT);
    expect(regions).toHaveLength(2);
    expect(regions[0].start).toBeCloseTo(1.5);
    expect(regions[0].end).toBeCloseTo(4.2);
    expect(regions[1].start).toBeCloseTo(10.0);
    expect(regions[1].end).toBeCloseTo(12.5);
  });

  it('parses silence durations', () => {
    const regions = parseSilenceRegions(SAMPLE_SILENCEDETECT);
    expect(regions[0].duration).toBeCloseTo(2.7);
    expect(regions[1].duration).toBeCloseTo(2.5);
  });

  it('returns empty array for no silence', () => {
    const regions = parseSilenceRegions('no silence here');
    expect(regions).toEqual([]);
  });

  it('handles single silence region', () => {
    const output = `silence_start: 0.000\nsilence_end: 3.000 | silence_duration: 3.000\n`;
    const regions = parseSilenceRegions(output);
    expect(regions).toHaveLength(1);
    expect(regions[0].start).toBeCloseTo(0);
    expect(regions[0].end).toBeCloseTo(3);
  });

  it('handles empty string', () => {
    expect(parseSilenceRegions('')).toEqual([]);
  });
});
