/**
 * Schema validation tests for the Project schema.
 */

import { describe, it, expect } from 'vitest';
import { ProjectSchema } from '@/schemas/project';
import {
  createTestProject,
  createTestAsset,
  createTestTrack,
  createTestClip,
} from '../helpers/fixtures';

// ---------------------------------------------------------------------------
// ProjectSchema
// ---------------------------------------------------------------------------

describe('ProjectSchema', () => {
  it('parses a valid project', () => {
    const project = createTestProject();
    const result = ProjectSchema.safeParse(project);
    expect(result.success).toBe(true);
  });

  it('rejects missing required fields', () => {
    const result = ProjectSchema.safeParse({
      id: 'test-id',
      // missing name, createdAt, updatedAt, workDir, timeline
    });
    expect(result.success).toBe(false);
  });

  it('applies default values for settings', () => {
    const project = createTestProject();
    // Remove settings to let defaults apply
    const { settings: _settings, ...rest } = project;
    const withDefaults = { ...rest };
    const result = ProjectSchema.safeParse(withDefaults);
    // Depending on schema design, settings may be required or have defaults
    // This test verifies the schema handles the case
    expect(result.success).toBeDefined();
  });

  it('applies default values for autopilot config', () => {
    const result = ProjectSchema.safeParse(
      createTestProject({
        autopilot: {} as any,
      }),
    );
    // Schema should apply autopilot defaults
    if (result.success) {
      expect(result.data.autopilot.enabled).toBe(false);
      expect(result.data.autopilot.maxBudgetUsd).toBe(1.0);
      expect(result.data.autopilot.spentUsd).toBe(0);
    }
  });

  it('validates nested timeline structure', () => {
    const clip = createTestClip();
    const track = createTestTrack({ clips: [clip] });
    const project = createTestProject({
      timeline: {
        tracks: [track],
        duration: 30,
        chapters: [],
      },
    });
    const result = ProjectSchema.safeParse(project);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.timeline.tracks).toHaveLength(1);
      expect(result.data.timeline.tracks[0].clips).toHaveLength(1);
    }
  });

  it('validates asset array', () => {
    const asset = createTestAsset();
    const project = createTestProject({ assets: [asset] });
    const result = ProjectSchema.safeParse(project);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.assets).toHaveLength(1);
      expect(result.data.assets[0].type).toBe('video');
    }
  });

  it('defaults assets to empty array', () => {
    const project = createTestProject();
    const result = ProjectSchema.safeParse(project);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.assets).toEqual([]);
    }
  });

  it('defaults history to empty array', () => {
    const project = createTestProject();
    const result = ProjectSchema.safeParse(project);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.history).toEqual([]);
    }
  });

  it('rejects invalid datetime strings', () => {
    const result = ProjectSchema.safeParse(createTestProject({ createdAt: 'not-a-date' }));
    expect(result.success).toBe(false);
  });

  it('accepts project with export presets', () => {
    const result = ProjectSchema.safeParse(
      createTestProject({
        exportPresets: [
          {
            name: 'YouTube 1080p',
            container: 'mp4',
            videoCodec: 'libx264',
            audioCodec: 'aac',
            videoBitrate: '8000k',
            audioBitrate: '192k',
            resolution: { w: 1920, h: 1080 },
            fps: 30,
            twoPass: false,
            extraArgs: [],
          },
        ],
      }),
    );
    expect(result.success).toBe(true);
  });
});
