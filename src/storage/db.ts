/**
 * @module storage/db
 * @description SQLite-backed persistent storage for projects, render jobs,
 * and audit logs. Uses better-sqlite3 for synchronous access.
 */

import Database from 'better-sqlite3';
import type { Project, ProjectSummary } from '../schemas/project.js';

// ── Types ───────────────────────────────────────────────────────────────

/** Status of a background render job */
export type RenderJobStatus = 'queued' | 'running' | 'complete' | 'failed' | 'cancelled';

/** A render job record */
export interface RenderJob {
  id: string;
  projectId: string;
  status: RenderJobStatus;
  progress: number;
  outputPath: string;
  presetId?: string;
  createdAt: string;
  updatedAt: string;
  error?: string;
}

/** An audit log entry */
export interface AuditEntry {
  id: string;
  projectId: string;
  tool: string;
  paramsJson: string;
  resultJson: string;
  timestamp: string;
}

// ── Storage Interface ──────────────────────────────────────────────────

/**
 * Interface for storage implementations.
 * Both sync (SqliteStorage) and async (MockStorage) implementations are supported.
 * Callers should use await to handle both cases.
 */

export interface Storage {
  saveProject(project: Project): void;
  getProject(id: string): Project | null;
  listProjects(): Project[] | ProjectSummary[];
  deleteProject(id: string): void | boolean;
  saveRenderJob(job: RenderJob): void;
  getRenderJob(id: string): RenderJob | null;
  updateRenderStatus(id: string, status: RenderJobStatus, progress?: number): void;
  appendAudit(entry: unknown): void;
  getAuditLog?(): unknown[];
}

// ── Storage Class ───────────────────────────────────────────────────────

/**
 * SQLite storage layer for all persistent project data.
 */
export class SqliteStorage implements Storage {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this._createTables();
  }

  private _createTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        data JSON NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS render_jobs (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'queued',
        progress REAL NOT NULL DEFAULT 0,
        output_path TEXT NOT NULL,
        preset_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        error TEXT
      );

      CREATE TABLE IF NOT EXISTS audit_log (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        tool TEXT NOT NULL,
        params_json TEXT NOT NULL,
        result_json TEXT NOT NULL,
        timestamp TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_render_jobs_project ON render_jobs(project_id);
      CREATE INDEX IF NOT EXISTS idx_audit_log_project ON audit_log(project_id);
      CREATE INDEX IF NOT EXISTS idx_audit_log_timestamp ON audit_log(timestamp);
    `);
  }

  saveProject(project: Project): void {
    const now = new Date().toISOString();
    const stmt = this.db.prepare(`
      INSERT INTO projects (id, data, created_at, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at
    `);
    stmt.run(project.id, JSON.stringify(project), project.createdAt, now);
  }

  getProject(id: string): Project | null {
    const row = this.db.prepare('SELECT data FROM projects WHERE id = ?').get(id) as
      | { data: string }
      | undefined;
    if (!row) return null;
    return JSON.parse(row.data) as Project;
  }

  listProjects(): ProjectSummary[] {
    const rows = this.db.prepare('SELECT data FROM projects ORDER BY updated_at DESC').all() as {
      data: string;
    }[];
    return rows.map((row) => {
      const p = JSON.parse(row.data) as Project;
      return {
        id: p.id,
        name: p.name,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
        assetCount: p.assets.length,
        trackCount: p.timeline.tracks.length,
        duration: p.timeline.duration,
      };
    });
  }

  deleteProject(id: string): void {
    this.db.prepare('DELETE FROM projects WHERE id = ?').run(id);
  }

  saveRenderJob(job: unknown): void {
    const j = job as RenderJob;
    const stmt = this.db.prepare(`
      INSERT INTO render_jobs (id, project_id, status, progress, output_path, preset_id, created_at, updated_at, error)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        status = excluded.status,
        progress = excluded.progress,
        updated_at = excluded.updated_at,
        error = excluded.error
    `);
    stmt.run(
      j.id,
      j.projectId,
      j.status,
      j.progress,
      j.outputPath,
      j.presetId ?? null,
      j.createdAt,
      j.updatedAt,
      j.error ?? null,
    );
  }

  getRenderJob(id: string): RenderJob | null {
    const row = this.db.prepare('SELECT * FROM render_jobs WHERE id = ?').get(id) as
      | Record<string, unknown>
      | undefined;
    if (!row) return null;
    return {
      id: row.id as string,
      projectId: row.project_id as string,
      status: row.status as RenderJobStatus,
      progress: row.progress as number,
      outputPath: row.output_path as string,
      presetId: (row.preset_id as string) ?? undefined,
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
      error: (row.error as string) ?? undefined,
    };
  }

  updateRenderStatus(id: string, status: RenderJobStatus, progress?: number): void {
    const now = new Date().toISOString();
    if (progress !== undefined) {
      this.db
        .prepare('UPDATE render_jobs SET status = ?, progress = ?, updated_at = ? WHERE id = ?')
        .run(status, progress, now, id);
    } else {
      this.db
        .prepare('UPDATE render_jobs SET status = ?, updated_at = ? WHERE id = ?')
        .run(status, now, id);
    }
  }

  appendAudit(entry: unknown): void {
    const e = entry as AuditEntry;
    const stmt = this.db.prepare(`
      INSERT INTO audit_log (id, project_id, tool, params_json, result_json, timestamp)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    stmt.run(e.id, e.projectId, e.tool, e.paramsJson, e.resultJson, e.timestamp);
  }

  getAuditLog(): unknown[] {
    return this.db.prepare('SELECT * FROM audit_log ORDER BY timestamp DESC').all();
  }

  close(): void {
    this.db.close();
  }
}
