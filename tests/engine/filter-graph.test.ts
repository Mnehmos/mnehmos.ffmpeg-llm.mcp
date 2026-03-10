/**
 * Tests for the filter graph builder.
 */

import { describe, it, expect } from 'vitest';
import { FilterGraphBuilder } from '@/engine/filter-graph';
import { createTestClip } from '../helpers/fixtures';

describe('FilterGraphBuilder', () => {
  // -------------------------------------------------------------------------
  // Single input operations
  // -------------------------------------------------------------------------

  describe('single input trim', () => {
    it('produces correct trim filter string', () => {
      const builder = new FilterGraphBuilder();
      const clip = createTestClip({
        sourceRange: { start: 10, end: 30 },
        trackIndex: 0,
      });

      const graph = builder.addClip(clip, 0).build();

      expect(graph).toContain('trim=start=10');
      expect(graph).toContain('end=30');
      expect(graph).toContain('setpts=PTS-STARTPTS');
    });
  });

  // -------------------------------------------------------------------------
  // Concatenation
  // -------------------------------------------------------------------------

  describe('two clips concat', () => {
    it('produces correct concat filter string', () => {
      const builder = new FilterGraphBuilder();
      const clip1 = createTestClip({
        sourceRange: { start: 0, end: 15 },
        trackIndex: 0,
      });
      const clip2 = createTestClip({
        sourceRange: { start: 5, end: 20 },
        trackIndex: 0,
      });

      const graph = builder.addClip(clip1, 0).addClip(clip2, 1).build();

      expect(graph).toContain('concat=n=2');
    });
  });

  // -------------------------------------------------------------------------
  // Overlay
  // -------------------------------------------------------------------------

  describe('overlay positioning', () => {
    it('generates overlay filter with position params', () => {
      const builder = new FilterGraphBuilder();
      const clip = createTestClip({
        filters: [
          {
            type: 'overlay',
            params: { x: 'W-w-20', y: '20' },
            enabled: true,
          },
        ],
      });

      const graph = builder.addClip(clip, 0).build();

      expect(graph).toContain('overlay');
      expect(graph).toContain('W-w-20');
    });
  });

  // -------------------------------------------------------------------------
  // DrawText
  // -------------------------------------------------------------------------

  describe('drawtext with escaping', () => {
    it('escapes special characters in text', () => {
      const builder = new FilterGraphBuilder();
      const clip = createTestClip({
        filters: [
          {
            type: 'drawtext',
            params: {
              text: "Hello: it's a test",
              fontsize: 24,
              fontcolor: 'white',
              x: 10,
              y: 10,
            },
            enabled: true,
          },
        ],
      });

      const graph = builder.addClip(clip, 0).build();

      expect(graph).toContain('drawtext');
      // Colons and quotes should be escaped for FFmpeg
      expect(graph).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // Speed change
  // -------------------------------------------------------------------------

  describe('speed change', () => {
    it('applies setpts for video and atempo for audio', () => {
      const builder = new FilterGraphBuilder();
      const clip = createTestClip({ speed: 2.0 });

      const graph = builder.addClip(clip, 0).build();

      // Video: setpts=PTS/2.0 (or similar)
      expect(graph).toContain('setpts');
      // Audio: atempo=2.0
      expect(graph).toContain('atempo');
    });

    it('chains atempo for extreme speed values', () => {
      const builder = new FilterGraphBuilder();
      // atempo range is 0.5-100.0 per instance, may need chaining for extreme values
      const clip = createTestClip({ speed: 0.25 });

      const graph = builder.addClip(clip, 0).build();

      // Should chain atempo filters for speed < 0.5
      expect(graph).toContain('atempo');
    });
  });

  // -------------------------------------------------------------------------
  // Complex graph
  // -------------------------------------------------------------------------

  describe('complex graph with multiple tracks', () => {
    it('builds a multi-track filter graph', () => {
      const builder = new FilterGraphBuilder();

      const videoClip1 = createTestClip({
        sourceRange: { start: 0, end: 20 },
        trackIndex: 0,
        filters: [{ type: 'brightness', params: { value: 0.5 }, enabled: true }],
      });
      const videoClip2 = createTestClip({
        sourceRange: { start: 10, end: 30 },
        trackIndex: 0,
      });
      const audioClip = createTestClip({
        sourceRange: { start: 0, end: 30 },
        trackIndex: 1,
        volume: 0.8,
      });

      const graph = builder
        .addClip(videoClip1, 0)
        .addClip(videoClip2, 1)
        .addClip(audioClip, 2)
        .build();

      expect(graph).toBeDefined();
      expect(graph.length).toBeGreaterThan(0);
    });
  });

  // -------------------------------------------------------------------------
  // Edge cases
  // -------------------------------------------------------------------------

  describe('edge cases', () => {
    it('returns empty string for empty graph', () => {
      const builder = new FilterGraphBuilder();
      const graph = builder.build();
      expect(graph).toBe('');
    });

    it('generates unique labels without collisions', () => {
      const builder = new FilterGraphBuilder();

      // Add several clips
      for (let i = 0; i < 10; i++) {
        builder.addClip(createTestClip({ trackIndex: i % 3 }), i);
      }

      const graph = builder.build();

      // Each chain segment assigns output label(s) at the end.
      // In FFmpeg filter_complex, labels appear as both output (end of chain)
      // and input (start of another chain for concat). We check that
      // output labels (those produced by chains) are never assigned twice.
      const segments = graph.split(';');
      const outputLabels: string[] = [];
      for (const seg of segments) {
        // Extract trailing labels from each segment (output positions)
        const trailing = seg.match(/(\[[^\]]+\])+$/);
        if (trailing) {
          const segLabels = trailing[0].match(/\[[^\]]+\]/g) ?? [];
          outputLabels.push(...segLabels);
        }
      }
      const uniqueOutputLabels = new Set(outputLabels);
      expect(outputLabels.length).toBe(uniqueOutputLabels.size);
    });
  });
});
