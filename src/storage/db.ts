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

// ── Storage Class ───────────────────────────────────────────────────────

/**
 * SQLite storage layer for all persistent project data.
 *
 * Tables:
 * - `projects`: id TEXT PK, data JSON, created_at TEXT, updated_at TEXT
 * - `render_jobs`: id TEXT PK, project_id TEXT, status TEXT, progress REAL,
 *   output_path TEXT, preset_id TEXT, created_at TEXT, updated_at TEXT, error TEXT
 * - `audit_log`: id TEXT PK, project_id TEXT, tool TEXT, params_json TEXT,
 *   result_json TEXT, timestamp TEXT
 */
export class Storage {
  private db: Database.Database;

  /**
   * Opens or creates the SQLite database at the given path.
   * Creates tables if they do not exist.
   * @param dbPath - Path to the SQLite database file
   */
  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this._createTables();
  }

  /** Create tables if they don't already exist */
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

  /**
   * Save or update a project in the database.
   * @param project - Full project data
   */
  saveProject(project: Project): void {
    const now = new Date().toISOString();
    const stmt = this.db.prepare(`
      INSERT INTO projects (id, data, created_at, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at
    `);
    stmt.run(project.id, JSON.stringify(project), project.createdAt, now);
  }

  /**
   * Retrieve a project by ID.
   * @param id - Project UUID
   * @returns The project or null if not found
   */
  getProject(id: string): Project | null {
    const row = this.db.prepare('SELECT data FROM projects WHERE id = ?').get(id) as
      | { data: string }
      | undefined;
    if (!row) return null;
    // TODO: Validate with ProjectSchema.parse() for safety
    return JSON.parse(row.data) as Project;
  }

  /**
   * List all projects as lightweight summaries.
   * @returns Array of project summaries sorted by updated_at descending
   */
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

  /**
   * Delete a project by ID.
   * @param id - Project UUID
   */
  deleteProject(id: string): void {
    this.db.prepare('DELETE FROM projects WHERE id = ?').run(id);
  }

  /**
   * Save or update a render job.
   * @param job - Render job data
   */
  saveRenderJob(job: RenderJob): void {
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
      job.id,
      job.projectId,
      job.status,
      job.progress,
      job.outputPath,
      job.presetId ?? null,
      job.createdAt,
      job.updatedAt,
      job.error ?? null,
    );
  }

  /**
   * Retrieve a render job by ID.
   * @param id - Render job UUID
   * @returns The render job or null if not found
   */
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

  /**
   * Update the status and optional progress of a render job.
   * @param id - Render job UUID
   * @param status - New status
   * @param progress - Optional progress (0.0 - 1.0)
   */
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

  /**
   * Append an entry to the audit log.
   * @param entry - Audit log entry
   */
  appendAudit(entry: AuditEntry): void {
    const stmt = this.db.prepare(`
      INSERT INTO audit_log (id, project_id, tool, params_json, result_json, timestamp)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      entry.id,
      entry.projectId,
      entry.tool,
      entry.paramsJson,
      entry.resultJson,
      entry.timestamp,
    );
  }

  /** Close the database connection */
  close(): void {
    this.db.close();
  }
}
