/**
 * @module engine/filter-graph
 * @description Builds FFmpeg filter_complex strings from a structured
 * representation. Manages label generation and filter chain composition.
 */

import type { Clip } from '../schemas/timeline.js';

// ── Types ───────────────────────────────────────────────────────────────

/** Options for the drawtext filter */
export interface DrawTextOpts {
  /** Font file path */
  fontfile?: string;
  /** Font size in pixels */
  fontsize?: number;
  /** Font color (e.g., 'white', '#FFFFFF') */
  fontcolor?: string;
  /** X position expression */
  x?: string;
  /** Y position expression */
  y?: string;
  /** Background box (0 or 1) */
  box?: number;
  /** Box color with optional opacity */
  boxcolor?: string;
  /** Box border width */
  boxborderw?: number;
}

// ── Filter Graph Builder ────────────────────────────────────────────────

/**
 * Constructs an FFmpeg -filter_complex string from individual filter operations.
 *
 * Each method adds a filter stage, accepts input label(s), and returns
 * an output label for chaining. Labels are auto-generated as [v0], [v1], [a0], etc.
 */
export class FilterGraphBuilder {
  /** Internal counter for generating unique labels */
  private labelCounter: number = 0;
  /** Accumulated filter chain segments */
  private chains: string[] = [];
  /** Track video output labels for concat */
  private clipVideoLabels: string[] = [];
  /** Track audio output labels for concat */
  private clipAudioLabels: string[] = [];

  constructor() {
    // Empty — ready to build
  }

  // ── High-level API ──────────────────────────────────────────────────

  /**
   * Add a clip to the filter graph. Handles trim, speed, volume, filters, and
   * accumulates labels for final concat.
   * @param clip - The clip to process
   * @param inputIndex - Zero-based index of the -i input file
   * @returns this (for chaining)
   */
  addClip(clip: Clip, inputIndex: number): this {
    const { sourceRange, speed, volume, filters } = clip;

    // ── Video chain (built as single comma-separated chain) ──────────
    const vInput = `[${inputIndex}:v]`;
    const vFilters: string[] = [];

    // Trim + reset PTS
    vFilters.push(`trim=start=${sourceRange.start}:end=${sourceRange.end}`);
    vFilters.push('setpts=PTS-STARTPTS');

    // Speed change for video
    if (speed !== 1.0) {
      vFilters.push(`setpts=PTS/${speed}`);
    }

    // Process clip filters
    for (const filter of filters) {
      if (!filter.enabled) continue;

      switch (filter.type) {
        case 'overlay': {
          const params = filter.params as Record<string, string>;
          const x = params.x ?? '0';
          const y = params.y ?? '0';
          vFilters.push(`overlay=x=${x}:y=${y}`);
          break;
        }
        case 'drawtext': {
          const p = filter.params as Record<string, unknown>;
          const parts: string[] = [];
          if (p.text !== undefined) {
            const escaped = String(p.text).replace(/'/g, "\\'").replace(/:/g, '\\:');
            parts.push(`text='${escaped}'`);
          }
          if (p.fontsize !== undefined) parts.push(`fontsize=${p.fontsize}`);
          if (p.fontcolor !== undefined) parts.push(`fontcolor=${p.fontcolor}`);
          if (p.x !== undefined) parts.push(`x=${p.x}`);
          if (p.y !== undefined) parts.push(`y=${p.y}`);
          if (p.fontfile !== undefined) parts.push(`fontfile='${p.fontfile}'`);
          vFilters.push(`drawtext=${parts.join(':')}`);
          break;
        }
        case 'brightness': {
          const val = (filter.params as Record<string, unknown>).value ?? 0;
          vFilters.push(`eq=brightness=${val}`);
          break;
        }
        default: {
          const paramStr = Object.entries(filter.params as Record<string, string>)
            .map(([k, v]) => `${k}=${v}`)
            .join(':');
          vFilters.push(paramStr ? `${filter.type}=${paramStr}` : filter.type);
          break;
        }
      }
    }

    // Emit video chain as single entry with one output label
    const vOutLabel = this._nextLabel('v');
    this.chains.push(`${vInput}${vFilters.join(',')}${vOutLabel}`);
    this.clipVideoLabels.push(vOutLabel);

    // ── Audio chain (built as single comma-separated chain) ──────────
    const aInput = `[${inputIndex}:a]`;
    const aFilters: string[] = [];

    // Audio trim
    aFilters.push(`atrim=start=${sourceRange.start}:end=${sourceRange.end}`);
    aFilters.push('asetpts=PTS-STARTPTS');

    // Speed change for audio (atempo)
    if (speed !== 1.0) {
      this._appendAtempo(aFilters, speed);
    }

    // Volume adjustment
    if (volume !== 1.0) {
      aFilters.push(`volume=${volume}`);
    }

    const aOutLabel = this._nextLabel('a');
    this.chains.push(`${aInput}${aFilters.join(',')}${aOutLabel}`);
    this.clipAudioLabels.push(aOutLabel);

    return this;
  }

  // ── Low-level API ───────────────────────────────────────────────────

  /**
   * Reference an input stream by file index and stream type.
   */
  addInput(inputIndex: number, streamType: 'video' | 'audio'): string {
    const suffix = streamType === 'video' ? 'v' : 'a';
    return `[${inputIndex}:${suffix}]`;
  }

  /**
   * Add a trim filter to extract a time range from a stream.
   */
  addTrim(inputLabel: string, start: number, end: number): string {
    const outLabel = this._nextLabel('v');
    const chain = `${inputLabel}trim=start=${start}:end=${end},setpts=PTS-STARTPTS${outLabel}`;
    this.chains.push(chain);
    return outLabel;
  }

  /**
   * Concatenate multiple streams into one.
   */
  addConcat(labels: string[], videoStreams: number, audioStreams: number): string[] {
    const n = labels.length / (videoStreams + audioStreams);
    const outputs: string[] = [];

    if (videoStreams > 0) outputs.push(this._nextLabel('v'));
    if (audioStreams > 0) outputs.push(this._nextLabel('a'));

    const inputStr = labels.join('');
    const outputStr = outputs.join('');
    const chain = `${inputStr}concat=n=${n}:v=${videoStreams}:a=${audioStreams}${outputStr}`;
    this.chains.push(chain);
    return outputs;
  }

  /**
   * Overlay one stream on top of another.
   */
  addOverlay(baseLabel: string, overlayLabel: string, x: string, y: string): string {
    const outLabel = this._nextLabel('v');
    const chain = `${baseLabel}${overlayLabel}overlay=x=${x}:y=${y}${outLabel}`;
    this.chains.push(chain);
    return outLabel;
  }

  /**
   * Add a drawtext filter for text overlays.
   */
  addDrawText(inputLabel: string, text: string, opts: DrawTextOpts): string {
    const outLabel = this._nextLabel('v');
    const params: string[] = [`text='${text.replace(/'/g, "\\'")}'`];

    if (opts.fontfile) params.push(`fontfile='${opts.fontfile}'`);
    if (opts.fontsize) params.push(`fontsize=${opts.fontsize}`);
    if (opts.fontcolor) params.push(`fontcolor=${opts.fontcolor}`);
    if (opts.x) params.push(`x=${opts.x}`);
    if (opts.y) params.push(`y=${opts.y}`);
    if (opts.box !== undefined) params.push(`box=${opts.box}`);
    if (opts.boxcolor) params.push(`boxcolor='${opts.boxcolor}'`);
    if (opts.boxborderw !== undefined) params.push(`boxborderw=${opts.boxborderw}`);

    const chain = `${inputLabel}drawtext=${params.join(':')}${outLabel}`;
    this.chains.push(chain);
    return outLabel;
  }

  /**
   * Add a generic named filter with key-value parameters.
   */
  addFilter(inputLabel: string, filterName: string, params: Record<string, string>): string {
    const outLabel = this._nextLabel('v');
    const paramStr = Object.entries(params)
      .map(([k, v]) => `${k}=${v}`)
      .join(':');
    const chain = paramStr
      ? `${inputLabel}${filterName}=${paramStr}${outLabel}`
      : `${inputLabel}${filterName}${outLabel}`;
    this.chains.push(chain);
    return outLabel;
  }

  /**
   * Build the complete -filter_complex string.
   * If clips were added via addClip(), automatically appends concat.
   */
  build(): string {
    // If clips were added via the high-level API, add concat
    if (this.clipVideoLabels.length > 1) {
      const concatLabels = [];
      for (let i = 0; i < this.clipVideoLabels.length; i++) {
        concatLabels.push(this.clipVideoLabels[i]);
        concatLabels.push(this.clipAudioLabels[i]);
      }
      this.addConcat(concatLabels, 1, 1);
      // Clear to prevent double-concat on re-build
      this.clipVideoLabels = [];
      this.clipAudioLabels = [];
    }

    return this.chains.join(';');
  }

  /**
   * Reset the builder for reuse.
   */
  reset(): void {
    this.labelCounter = 0;
    this.chains = [];
    this.clipVideoLabels = [];
    this.clipAudioLabels = [];
  }

  // ── Private helpers ─────────────────────────────────────────────────

  /**
   * Generate the next unique label.
   */
  private _nextLabel(prefix: string): string {
    const label = `[${prefix}${this.labelCounter}]`;
    this.labelCounter++;
    return label;
  }

  /**
   * Append atempo filter(s) to a filter array for audio speed change.
   * atempo range is 0.5-100.0, so extreme values need chaining.
   */
  private _appendAtempo(filterArr: string[], speed: number): void {
    if (speed >= 0.5 && speed <= 100.0) {
      filterArr.push(`atempo=${speed}`);
      return;
    }

    // Chain atempo for speed < 0.5
    let remaining = speed;
    while (remaining < 0.5) {
      filterArr.push('atempo=0.5');
      remaining = remaining / 0.5;
    }

    // Final atempo for remaining
    if (remaining !== 1.0) {
      filterArr.push(`atempo=${remaining}`);
    }
  }
}
