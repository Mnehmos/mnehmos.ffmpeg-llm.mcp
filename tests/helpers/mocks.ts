/**
 * Mock implementations for testing mnehmos.ffmpeg-llm.mcp
 */

import type { FFmpegRunner, FFmpegResult } from '@/engine/ffmpeg';
import type { FFprobeRunner, ProbeResult } from '@/engine/ffprobe';
import type { Storage, RenderJob, RenderJobStatus } from '@/storage/db';
import type { Project } from '@/schemas/project';
import { SAMPLE_FFPROBE_OUTPUT } from './fixtures';

// ---------------------------------------------------------------------------
// Call recording
// ---------------------------------------------------------------------------

export interface RecordedCall {
  method: string;
  args: unknown[];
  timestamp: number;
}

// ---------------------------------------------------------------------------
// MockFFmpegRunner
// ---------------------------------------------------------------------------

export class MockFFmpegRunner implements FFmpegRunner {
  calls: RecordedCall[] = [];
  exitCode = 0;
  stdout = '';
  stderr = '';

  private _result: FFmpegResult | null = null;

  /** Configure what run() returns. */
  setResult(result: Partial<FFmpegResult>): void {
    this._result = {
      exitCode: result.exitCode ?? this.exitCode,
      stdout: result.stdout ?? this.stdout,
      stderr: result.stderr ?? this.stderr,
    };
  }

  async run(args: string[]): Promise<FFmpegResult> {
    this.calls.push({ method: 'run', args: [args], timestamp: Date.now() });

    if (this._result) {
      return { ...this._result };
    }

    return {
      exitCode: this.exitCode,
      stdout: this.stdout,
      stderr: this.stderr,
    };
  }

  reset(): void {
    this.calls = [];
    this.exitCode = 0;
    this.stdout = '';
    this.stderr = '';
    this._result = null;
  }
}

// ---------------------------------------------------------------------------
// MockFFprobeRunner
// ---------------------------------------------------------------------------

export class MockFFprobeRunner implements FFprobeRunner {
  calls: RecordedCall[] = [];
  private _result: ProbeResult = SAMPLE_FFPROBE_OUTPUT as ProbeResult;
  private _error: Error | null = null;

  /** Configure what probe() returns. */
  setResult(result: ProbeResult): void {
    this._result = result;
    this._error = null;
  }

  /** Configure probe() to throw. */
  setError(err: Error): void {
    this._error = err;
  }

  async probe(filePath: string): Promise<ProbeResult> {
    this.calls.push({ method: 'probe', args: [filePath], timestamp: Date.now() });

    if (this._error) {
      throw this._error;
    }

    return structuredClone(this._result);
  }

  reset(): void {
    this.calls = [];
    this._result = SAMPLE_FFPROBE_OUTPUT as ProbeResult;
    this._error = null;
  }
}

// ---------------------------------------------------------------------------
// MockStorage
// ---------------------------------------------------------------------------

export class MockStorage implements Storage {
  calls: RecordedCall[] = [];

  private projects = new Map<string, Project>();
  private renderJobs = new Map<string, RenderJob>();
  private auditLog: unknown[] = [];

  // -- Project operations ---------------------------------------------------

  async saveProject(project: Project): Promise<void> {
    this.calls.push({ method: 'saveProject', args: [project], timestamp: Date.now() });
    this.projects.set(project.id, structuredClone(project));
  }

  async getProject(id: string): Promise<Project | null> {
    this.calls.push({ method: 'getProject', args: [id], timestamp: Date.now() });
    const p = this.projects.get(id);
    return p ? structuredClone(p) : null;
  }

  async listProjects(): Promise<Project[]> {
    this.calls.push({ method: 'listProjects', args: [], timestamp: Date.now() });
    return [...this.projects.values()].map((p) => structuredClone(p));
  }

  async deleteProject(id: string): Promise<boolean> {
    this.calls.push({ method: 'deleteProject', args: [id], timestamp: Date.now() });
    return this.projects.delete(id);
  }

  // -- Render job operations ------------------------------------------------

  saveRenderJob(job: RenderJob): void {
    this.calls.push({ method: 'saveRenderJob', args: [job], timestamp: Date.now() });
    this.renderJobs.set(job.id, structuredClone(job));
  }

  getRenderJob(id: string): RenderJob | null {
    this.calls.push({ method: 'getRenderJob', args: [id], timestamp: Date.now() });
    const j = this.renderJobs.get(id);
    return j ? structuredClone(j) : null;
  }

  updateRenderStatus(id: string, status: RenderJobStatus, progress?: number): void {
    this.calls.push({
      method: 'updateRenderStatus',
      args: [id, status, progress],
      timestamp: Date.now(),
    });
    const job = this.renderJobs.get(id);
    if (job) {
      job.status = status;
      if (progress !== undefined) job.progress = progress;
      job.updatedAt = new Date().toISOString();
    }
  }

  // -- Audit log ------------------------------------------------------------

  async appendAudit(entry: unknown): Promise<void> {
    this.calls.push({ method: 'appendAudit', args: [entry], timestamp: Date.now() });
    this.auditLog.push(structuredClone(entry));
  }

  async getAuditLog(): Promise<unknown[]> {
    this.calls.push({ method: 'getAuditLog', args: [], timestamp: Date.now() });
    return [...this.auditLog];
  }

  // -- Utilities ------------------------------------------------------------

  reset(): void {
    this.calls = [];
    this.projects.clear();
    this.renderJobs.clear();
    this.auditLog = [];
  }
}

// ---------------------------------------------------------------------------
// MockOpenRouterClient
// ---------------------------------------------------------------------------

export interface OpenRouterResponse {
  id: string;
  model: string;
  choices: Array<{
    message: { role: string; content: string };
    finish_reason: string;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export class MockOpenRouterClient {
  calls: RecordedCall[] = [];
  private _response: OpenRouterResponse = {
    id: 'mock-response-1',
    model: 'google/gemini-2.0-flash-001',
    choices: [
      {
        message: { role: 'assistant', content: 'Mock LLM response' },
        finish_reason: 'stop',
      },
    ],
    usage: {
      prompt_tokens: 100,
      completion_tokens: 50,
      total_tokens: 150,
    },
  };
  private _error: Error | null = null;

  /** Configure what chat() returns. */
  setResponse(response: Partial<OpenRouterResponse>): void {
    this._response = { ...this._response, ...response };
    this._error = null;
  }

  /** Configure chat() to throw. */
  setError(err: Error): void {
    this._error = err;
  }

  async chat(params: {
    model: string;
    messages: Array<{ role: string; content: unknown }>;
    temperature?: number;
    max_tokens?: number;
  }): Promise<OpenRouterResponse> {
    this.calls.push({ method: 'chat', args: [params], timestamp: Date.now() });

    if (this._error) {
      throw this._error;
    }

    return structuredClone(this._response);
  }

  async chatWithVision(params: {
    model: string;
    messages: Array<{ role: string; content: unknown }>;
    images: string[];
  }): Promise<OpenRouterResponse> {
    this.calls.push({ method: 'chatWithVision', args: [params], timestamp: Date.now() });

    if (this._error) {
      throw this._error;
    }

    return structuredClone(this._response);
  }

  reset(): void {
    this.calls = [];
    this._response = {
      id: 'mock-response-1',
      model: 'google/gemini-2.0-flash-001',
      choices: [
        {
          message: { role: 'assistant', content: 'Mock LLM response' },
          finish_reason: 'stop',
        },
      ],
      usage: {
        prompt_tokens: 100,
        completion_tokens: 50,
        total_tokens: 150,
      },
    };
    this._error = null;
  }
}
