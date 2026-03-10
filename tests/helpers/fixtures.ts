/**
 * Test fixtures and factories for mnehmos.ffmpeg-llm.mcp
 */

import type { Asset } from '@/schemas/asset';
import type { Clip, Track, Timeline } from '@/schemas/timeline';
import type { Project } from '@/schemas/project';

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------

function uid(): string {
  return crypto.randomUUID();
}

function now(): string {
  return new Date().toISOString();
}

// ---------------------------------------------------------------------------
// Asset factory
// ---------------------------------------------------------------------------

export function createTestAsset(overrides: Partial<Asset> = {}): Asset {
  return {
    id: uid(),
    type: 'video',
    path: '/tmp/test-assets/sample.mp4',
    originalName: 'sample.mp4',
    duration: 600, // 10 minutes
    width: 1920,
    height: 1080,
    fps: 30,
    codec: 'h264',
    audioCodec: 'aac',
    sampleRate: 48000,
    channels: 2,
    fileSize: 150_000_000,
    tags: [],
    importedAt: now(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Clip factory
// ---------------------------------------------------------------------------

export function createTestClip(overrides: Partial<Clip> = {}): Clip {
  return {
    id: uid(),
    assetId: uid(),
    sourceRange: { start: 0, end: 30 },
    timelineStart: 0,
    trackIndex: 0,
    filters: [],
    volume: 1.0,
    opacity: 1.0,
    speed: 1.0,
    metadata: {},
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Track factory
// ---------------------------------------------------------------------------

export function createTestTrack(overrides: Partial<Track> = {}): Track {
  return {
    id: uid(),
    name: 'Video 1',
    type: 'video',
    clips: [],
    muted: false,
    locked: false,
    visible: true,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Timeline factory
// ---------------------------------------------------------------------------

export function createTestTimeline(overrides: Partial<Timeline> = {}): Timeline {
  return {
    tracks: [
      createTestTrack({ name: 'Video 1', type: 'video' }),
      createTestTrack({ name: 'Audio 1', type: 'audio' }),
    ],
    duration: 0,
    chapters: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Project factory
// ---------------------------------------------------------------------------

export function createTestProject(overrides: Partial<Project> = {}): Project {
  const id = overrides.id ?? uid();
  return {
    id,
    name: 'Test Project',
    createdAt: now(),
    updatedAt: now(),
    workDir: `/tmp/ffmpeg-llm/projects/${id}`,
    timeline: createTestTimeline(),
    assets: [],
    exportPresets: [],
    settings: {
      defaultResolution: { w: 1920, h: 1080 },
      defaultFps: 30,
      defaultAudioSampleRate: 48000,
    },
    autopilot: {
      enabled: false,
      openrouterModel: 'google/gemini-2.0-flash-001',
      visionModel: 'google/gemini-2.0-flash-001',
      maxBudgetUsd: 1.0,
      spentUsd: 0,
    },
    history: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Sample ffprobe output (1080p 30fps ~10 min MP4)
// ---------------------------------------------------------------------------

export const SAMPLE_FFPROBE_OUTPUT = {
  streams: [
    {
      index: 0,
      codec_name: 'h264',
      codec_long_name: 'H.264 / AVC / MPEG-4 AVC / MPEG-4 part 10',
      profile: 'High',
      codec_type: 'video',
      codec_tag_string: 'avc1',
      codec_tag: '0x31637661',
      width: 1920,
      height: 1080,
      coded_width: 1920,
      coded_height: 1080,
      has_b_frames: 2,
      pix_fmt: 'yuv420p',
      level: 40,
      color_range: 'tv',
      color_space: 'bt709',
      r_frame_rate: '30/1',
      avg_frame_rate: '30/1',
      time_base: '1/15360',
      start_pts: 0,
      start_time: '0.000000',
      duration_ts: 9216000,
      duration: '600.000000',
      bit_rate: '2000000',
      nb_frames: '18000',
      disposition: {
        default: 1,
        dub: 0,
        original: 0,
        comment: 0,
        lyrics: 0,
        karaoke: 0,
        forced: 0,
        hearing_impaired: 0,
        visual_impaired: 0,
        clean_effects: 0,
        attached_pic: 0,
        timed_thumbnails: 0,
      },
      tags: {
        language: 'eng',
        handler_name: 'VideoHandler',
      },
    },
    {
      index: 1,
      codec_name: 'aac',
      codec_long_name: 'AAC (Advanced Audio Coding)',
      profile: 'LC',
      codec_type: 'audio',
      codec_tag_string: 'mp4a',
      codec_tag: '0x6134706d',
      sample_fmt: 'fltp',
      sample_rate: '48000',
      channels: 2,
      channel_layout: 'stereo',
      bits_per_sample: 0,
      r_frame_rate: '0/0',
      avg_frame_rate: '0/0',
      time_base: '1/48000',
      start_pts: 0,
      start_time: '0.000000',
      duration_ts: 28800000,
      duration: '600.000000',
      bit_rate: '128000',
      nb_frames: '28125',
      disposition: {
        default: 1,
        dub: 0,
        original: 0,
        comment: 0,
        lyrics: 0,
        karaoke: 0,
        forced: 0,
        hearing_impaired: 0,
        visual_impaired: 0,
        clean_effects: 0,
        attached_pic: 0,
        timed_thumbnails: 0,
      },
      tags: {
        language: 'eng',
        handler_name: 'SoundHandler',
      },
    },
  ],
  format: {
    filename: '/tmp/test-assets/sample.mp4',
    nb_streams: 2,
    nb_programs: 0,
    format_name: 'mov,mp4,m4a,3gp,3g2,mj2',
    format_long_name: 'QuickTime / MOV',
    start_time: '0.000000',
    duration: '600.000000',
    size: '150000000',
    bit_rate: '2000000',
    probe_score: 100,
    tags: {
      major_brand: 'isom',
      minor_version: '512',
      compatible_brands: 'isomiso2avc1mp41',
      encoder: 'Lavf58.45.100',
    },
  },
};

// ---------------------------------------------------------------------------
// Sample ffmpeg progress line (from stderr)
// ---------------------------------------------------------------------------

export const SAMPLE_PROGRESS_LINE =
  'frame= 5400 fps= 120 q=28.0 size=   51200kB time=00:03:00.00 bitrate=2330.7kbits/s speed=4.00x';
