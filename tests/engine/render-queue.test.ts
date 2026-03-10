/**
 * Tests for the background render queue.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { RenderQueue } from '@/engine/render-queue';
import { MockFFmpegRunner } from '../helpers/mocks';
import { MockStorage } from '../helpers/mocks';
import {
  createTestProject,
  createTestAsset,
  createTestClip,
  createTestTrack,
} from '../helpers/fixtures';

describe('RenderQueue', () => {
  let ffmpeg: MockFFmpegRunner;
  let storage: MockStorage;
  let queue: RenderQueue;

  function makeRenderableProject() {
    const asset = createTestAsset({ path: '/tmp/video.mp4' });
    const clip = createTestClip({
      assetId: asset.id,
      sourceRange: { start: 0, end: 30 },
      trackIndex: 0,
    });
    const track = createTestTrack({ clips: [clip] });
    return createTestProject({
      assets: [asset],
      timeline: { tracks: [track], duration: 30, chapters: [] },
    });
  }

  beforeEach(() => {
    ffmpeg = new MockFFmpegRunner();
    storage = new MockStorage();
    queue = new RenderQueue(ffmpeg, storage);
  });

  // -------------------------------------------------------------------------
  // Enqueue
  // -------------------------------------------------------------------------

  describe('enqueue', () => {
    it('returns a job ID', () => {
      const project = makeRenderableProject();
      const jobId = queue.enqueue(project, '/tmp/output.mp4');

      expect(jobId).toBeDefined();
      expect(typeof jobId).toBe('string');
      expect(jobId.length).toBeGreaterThan(0);
    });

    it('persists job to storage', () => {
      const project = makeRenderableProject();
      const jobId = queue.enqueue(project, '/tmp/output.mp4');

      const savedCalls = storage.calls.filter((c) => c.method === 'saveRenderJob');
      expect(savedCalls.length).toBeGreaterThanOrEqual(1);
      const savedJob = savedCalls[0].args[0] as { id: string; status: string };
      expect(savedJob.id).toBe(jobId);
      expect(savedJob.status).toBe('queued');
    });

    it('starts render asynchronously', async () => {
      const project = makeRenderableProject();
      queue.enqueue(project, '/tmp/output.mp4');

      // Wait for the fire-and-forget render to complete
      await new Promise((resolve) => setTimeout(resolve, 50));

      // FFmpeg should have been called
      expect(ffmpeg.calls.length).toBeGreaterThanOrEqual(1);
    });
  });

  // -------------------------------------------------------------------------
  // Status
  // -------------------------------------------------------------------------

  describe('getStatus', () => {
    it('returns status for existing job', () => {
      const project = makeRenderableProject();
      const jobId = queue.enqueue(project, '/tmp/output.mp4');

      const status = queue.getStatus(jobId);
      expect(status).toBeDefined();
      expect(status!.id).toBe(jobId);
    });

    it('returns null for non-existent job', () => {
      const status = queue.getStatus('nonexistent-id');
      expect(status).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Cancel
  // -------------------------------------------------------------------------

  describe('cancel', () => {
    it('returns true when cancelling active job', () => {
      const project = makeRenderableProject();
      const jobId = queue.enqueue(project, '/tmp/output.mp4');

      const result = queue.cancel(jobId);
      expect(result).toBe(true);
    });

    it('returns false for non-existent job', () => {
      const result = queue.cancel('nonexistent-id');
      expect(result).toBe(false);
    });

    it('updates status to cancelled', () => {
      const project = makeRenderableProject();
      const jobId = queue.enqueue(project, '/tmp/output.mp4');

      queue.cancel(jobId);

      const statusCalls = storage.calls.filter(
        (c) => c.method === 'updateRenderStatus' && c.args[1] === 'cancelled',
      );
      expect(statusCalls.length).toBeGreaterThanOrEqual(1);
      expect(statusCalls[0].args[0]).toBe(jobId);
    });
  });

  // -------------------------------------------------------------------------
  // Active jobs
  // -------------------------------------------------------------------------

  describe('getActiveJobs', () => {
    it('returns all active jobs', () => {
      const project = makeRenderableProject();
      queue.enqueue(project, '/tmp/out1.mp4');
      queue.enqueue(project, '/tmp/out2.mp4');

      const active = queue.getActiveJobs();
      expect(active.length).toBeGreaterThanOrEqual(2);
    });

    it('returns empty when no active jobs', () => {
      const active = queue.getActiveJobs();
      expect(active).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // Render completion
  // -------------------------------------------------------------------------

  describe('render execution', () => {
    it('marks job as complete on success', async () => {
      ffmpeg.setResult({ exitCode: 0, stdout: '', stderr: '' });
      const project = makeRenderableProject();
      queue.enqueue(project, '/tmp/output.mp4');

      // Wait for async render
      await new Promise((resolve) => setTimeout(resolve, 50));

      const completeCalls = storage.calls.filter(
        (c) => c.method === 'updateRenderStatus' && c.args[1] === 'complete',
      );
      expect(completeCalls.length).toBeGreaterThanOrEqual(1);
    });

    it('marks job as failed on FFmpeg error', async () => {
      ffmpeg.setResult({ exitCode: 1, stdout: '', stderr: 'encoding error' });
      const project = makeRenderableProject();
      queue.enqueue(project, '/tmp/output.mp4');

      // Wait for async render
      await new Promise((resolve) => setTimeout(resolve, 50));

      const failCalls = storage.calls.filter(
        (c) => c.method === 'updateRenderStatus' && c.args[1] === 'failed',
      );
      expect(failCalls.length).toBeGreaterThanOrEqual(1);
    });
  });
});
