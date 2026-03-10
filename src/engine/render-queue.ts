/**
 * @module engine/render-queue
 * @description Background render job manager. Enqueues projects for rendering,
 * tracks progress, and supports cancellation.
 */

import type { ChildProcess } from 'node:child_process';
import { v4 as uuidv4 } from 'uuid';
import type { Project } from '../schemas/project.js';
import type { ExportPreset } from '../schemas/export.js';
import { FFmpegRunner } from './ffmpeg.js';
import type { Storage, RenderJobStatus } from '../storage/db.js';
import { buildRenderCommand } from './command-builder.js';

// ── Types ───────────────────────────────────────────────────────────────

/** Status information for a render job, returned to callers */
export interface RenderJobInfo {
  /** Job UUID */
  id: string;
  /** Associated project ID */
  projectId: string;
  /** Current status */
  status: RenderJobStatus;
  /** Progress from 0.0 to 1.0 */
  progress: number;
  /** Output file path */
  outputPath: string;
  /** Error message if failed */
  error?: string;
}

/** Internal tracking for an active render process */
interface ActiveJob {
  jobId: string;
  process: ChildProcess | null;
  cancelled: boolean;
}

// ── Render Queue ────────────────────────────────────────────────────────

/**
 * Manages background FFmpeg render jobs with progress tracking and cancellation.
 */
export class RenderQueue {
  private readonly ffmpeg: FFmpegRunner;
  private readonly db: Storage;
  /** Map of active render processes keyed by job ID */
  private readonly activeJobs: Map<string, ActiveJob> = new Map();

  /**
   * @param ffmpeg - FFmpegRunner instance for spawning encode processes
   * @param db - Storage instance for persisting job state
   */
  constructor(ffmpeg: FFmpegRunner, db: Storage) {
    this.ffmpeg = ffmpeg;
    this.db = db;
  }

  /**
   * Enqueue a project for background rendering.
   *
   * Creates a render job record, then starts the FFmpeg process asynchronously.
   * Progress is reported to the database as the render proceeds.
   *
   * @param project - The project to render
   * @param outputPath - Destination file path for the rendered output
   * @param preset - Optional export preset
   * @returns The job ID for tracking
   */
  enqueue(project: Project, outputPath: string, preset?: ExportPreset): string {
    const jobId = uuidv4();
    const now = new Date().toISOString();

    this.db.saveRenderJob({
      id: jobId,
      projectId: project.id,
      status: 'queued',
      progress: 0,
      outputPath,
      presetId: preset?.name,
      createdAt: now,
      updatedAt: now,
    });

    // TODO: Start the render process asynchronously
    // 1. Build command via buildRenderCommand
    // 2. Spawn FFmpeg with progress tracking
    // 3. Update job status on completion/failure

    this.activeJobs.set(jobId, { jobId, process: null, cancelled: false });

    // Fire-and-forget render execution
    this._executeRender(jobId, project, outputPath, preset).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      this.db.updateRenderStatus(jobId, 'failed');
      this.db.saveRenderJob({
        id: jobId,
        projectId: project.id,
        status: 'failed',
        progress: 0,
        outputPath,
        presetId: preset?.name,
        createdAt: now,
        updatedAt: new Date().toISOString(),
        error: message,
      });
    });

    return jobId;
  }

  /**
   * Get the current status of a render job.
   * @param jobId - The render job UUID
   * @returns Job status info or null if not found
   */
  getStatus(jobId: string): RenderJobInfo | null {
    const job = this.db.getRenderJob(jobId);
    if (!job) return null;
    return {
      id: job.id,
      projectId: job.projectId,
      status: job.status,
      progress: job.progress,
      outputPath: job.outputPath,
      error: job.error,
    };
  }

  /**
   * Cancel an active render job.
   * @param jobId - The render job UUID
   * @returns true if the job was cancelled, false if not found or already complete
   */
  cancel(jobId: string): boolean {
    const active = this.activeJobs.get(jobId);
    if (!active) return false;

    active.cancelled = true;
    if (active.process) {
      active.process.kill('SIGTERM');
    }
    this.db.updateRenderStatus(jobId, 'cancelled');
    this.activeJobs.delete(jobId);
    return true;
  }

  /**
   * Get all currently active (queued or running) render jobs.
   * @returns Array of active job status info
   */
  getActiveJobs(): RenderJobInfo[] {
    const results: RenderJobInfo[] = [];
    for (const [jobId] of this.activeJobs) {
      const status = this.getStatus(jobId);
      if (status) results.push(status);
    }
    return results;
  }

  /**
   * Execute a render job asynchronously.
   * @param jobId - The job ID
   * @param project - The project to render
   * @param outputPath - Output file path
   * @param preset - Optional export preset
   */
  private async _executeRender(
    jobId: string,
    project: Project,
    outputPath: string,
    preset?: ExportPreset,
  ): Promise<void> {
    const active = this.activeJobs.get(jobId);

    // Update status to running
    this.db.updateRenderStatus(jobId, 'running');

    // Build FFmpeg args
    const args = buildRenderCommand(project, outputPath, preset);

    // Check for early cancellation
    if (active?.cancelled) {
      this.db.updateRenderStatus(jobId, 'cancelled');
      this.activeJobs.delete(jobId);
      return;
    }

    // Execute the FFmpeg render
    const result = await this.ffmpeg.run(args);

    // Check for cancellation during render
    if (active?.cancelled) {
      this.db.updateRenderStatus(jobId, 'cancelled');
      this.activeJobs.delete(jobId);
      return;
    }

    if (result.exitCode !== 0) {
      this.db.updateRenderStatus(jobId, 'failed');
      this.activeJobs.delete(jobId);
      throw new Error(
        `FFmpeg render failed (exit ${result.exitCode}): ${result.stderr.slice(0, 500)}`,
      );
    }

    // Success
    this.db.updateRenderStatus(jobId, 'complete', 1.0);
    this.activeJobs.delete(jobId);
  }
}
