/**
 * @module engine/filter-graph
 * @description Builds FFmpeg filter_complex strings from a structured
 * representation. Manages label generation and filter chain composition.
 */

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
 *
 * @example
 * ```ts
 * const fg = new FilterGraphBuilder();
 * const input = fg.addInput(0, 'video');
 * const trimmed = fg.addTrim(input, 10.0, 25.0);
 * const scaled = fg.addFilter(trimmed, 'scale', { w: '1920', h: '1080' });
 * const filterStr = fg.build();
 * // => "[0:v]trim=start=10:end=25,setpts=PTS-STARTPTS[v0];[v0]scale=w=1920:h=1080[v1]"
 * ```
 */
export class FilterGraphBuilder {
  /** Internal counter for generating unique labels */
  private labelCounter: number = 0;
  /** Accumulated filter chain segments */
  private chains: string[] = [];

  constructor() {
    // Empty — ready to build
  }

  /**
   * Reference an input stream by file index and stream type.
   * @param inputIndex - Zero-based index of the -i input file
   * @param streamType - 'video' or 'audio'
   * @returns The input label (e.g., '[0:v]')
   */
  addInput(inputIndex: number, streamType: 'video' | 'audio'): string {
    const suffix = streamType === 'video' ? 'v' : 'a';
    return `[${inputIndex}:${suffix}]`;
  }

  /**
   * Add a trim filter to extract a time range from a stream.
   * Automatically applies setpts/asetpts to reset timestamps.
   * @param inputLabel - Input label to trim
   * @param start - Start time in seconds
   * @param end - End time in seconds
   * @returns Output label
   */
  addTrim(inputLabel: string, start: number, end: number): string {
    // TODO: Detect audio vs video from label suffix for trim vs atrim
    const outLabel = this._nextLabel('v');
    const chain = `${inputLabel}trim=start=${start}:end=${end},setpts=PTS-STARTPTS${outLabel}`;
    this.chains.push(chain);
    return outLabel;
  }

  /**
   * Concatenate multiple streams into one.
   * @param labels - Array of input labels to concatenate
   * @param videoStreams - Number of video streams per segment (usually 1 or 0)
   * @param audioStreams - Number of audio streams per segment (usually 1 or 0)
   * @returns Array of output labels [video_out, audio_out] as applicable
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
   * @param baseLabel - Background/base video label
   * @param overlayLabel - Foreground/overlay video label
   * @param x - X position expression
   * @param y - Y position expression
   * @returns Output label
   */
  addOverlay(baseLabel: string, overlayLabel: string, x: string, y: string): string {
    const outLabel = this._nextLabel('v');
    const chain = `${baseLabel}${overlayLabel}overlay=x=${x}:y=${y}${outLabel}`;
    this.chains.push(chain);
    return outLabel;
  }

  /**
   * Add a drawtext filter for text overlays.
   * @param inputLabel - Input video label
   * @param text - Text string to draw
   * @param opts - Drawtext positioning and styling options
   * @returns Output label
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
   * @param inputLabel - Input label
   * @param filterName - FFmpeg filter name (e.g., 'scale', 'eq', 'volume')
   * @param params - Filter parameters as key-value pairs
   * @returns Output label
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
   * @returns The assembled filter graph string ready for FFmpeg
   */
  build(): string {
    return this.chains.join(';');
  }

  /**
   * Reset the builder for reuse.
   */
  reset(): void {
    this.labelCounter = 0;
    this.chains = [];
  }

  /**
   * Generate the next unique label.
   * @param prefix - 'v' for video, 'a' for audio
   * @returns Label string like '[v0]', '[a1]'
   */
  private _nextLabel(prefix: string): string {
    const label = `[${prefix}${this.labelCounter}]`;
    this.labelCounter++;
    return label;
  }
}
