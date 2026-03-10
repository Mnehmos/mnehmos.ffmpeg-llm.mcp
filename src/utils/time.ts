/**
 * @module utils/time
 * @description Time formatting and parsing utilities for converting between
 * seconds, FFmpeg timestamp strings, and display formats.
 */

/**
 * Format a timestamp in seconds to "HH:MM:SS.mmm" display format.
 * @param seconds - Time in seconds (float)
 * @returns Formatted string like "01:23:45.678"
 */
export function formatTimestamp(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.round((seconds % 1) * 1000);

  return (
    String(h).padStart(2, '0') +
    ':' +
    String(m).padStart(2, '0') +
    ':' +
    String(s).padStart(2, '0') +
    '.' +
    String(ms).padStart(3, '0')
  );
}

/**
 * Parse a timestamp string in "HH:MM:SS.mmm" or "MM:SS" format to seconds.
 * @param str - Timestamp string
 * @returns Time in seconds
 * @throws If the string format is invalid
 */
export function parseTimestamp(str: string): number {
  const parts = str.split(':');

  if (parts.length === 3) {
    // HH:MM:SS.mmm
    const hours = parseInt(parts[0], 10);
    const minutes = parseInt(parts[1], 10);
    const seconds = parseFloat(parts[2]);
    return hours * 3600 + minutes * 60 + seconds;
  } else if (parts.length === 2) {
    // MM:SS or MM:SS.mmm
    const minutes = parseInt(parts[0], 10);
    const seconds = parseFloat(parts[1]);
    return minutes * 60 + seconds;
  } else if (parts.length === 1) {
    const val = parseFloat(parts[0]);
    if (isNaN(val)) {
      throw new Error(
        `Invalid timestamp format: "${str}". Expected HH:MM:SS.mmm, MM:SS, or seconds.`,
      );
    }
    return val;
  }

  throw new Error(`Invalid timestamp format: "${str}". Expected HH:MM:SS.mmm, MM:SS, or seconds.`);
}

/**
 * Convert seconds to FFmpeg's time format string.
 * @param seconds - Time in seconds (float)
 * @returns FFmpeg-compatible time string (e.g., "01:23:45.678")
 */
export function secondsToFFmpegTime(seconds: number): string {
  return formatTimestamp(seconds);
}

/**
 * Clamp a value between a minimum and maximum.
 * @param value - The value to clamp
 * @param min - Minimum allowed value
 * @param max - Maximum allowed value
 * @returns The clamped value
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
