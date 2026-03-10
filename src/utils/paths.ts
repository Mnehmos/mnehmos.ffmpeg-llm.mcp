/**
 * @module utils/paths
 * @description Path utilities for directory management, temp file generation,
 * and asset path resolution.
 */

import { mkdir } from 'fs/promises';
import { join, isAbsolute, resolve } from 'path';
import { v4 as uuidv4 } from 'uuid';

/**
 * Ensure a directory exists, creating it recursively if necessary.
 * @param dirPath - Absolute path to the directory
 */
export async function ensureDir(dirPath: string): Promise<void> {
  await mkdir(dirPath, { recursive: true });
}

/**
 * Generate a unique temporary file path within a project's working directory.
 * @param projectWorkDir - The project's working directory
 * @param prefix - Filename prefix (e.g., 'preview', 'thumb')
 * @returns A unique file path (without extension — caller should append)
 */
export function getTempPath(projectWorkDir: string, prefix: string): string {
  const tempDir = join(projectWorkDir, 'tmp');
  const filename = `${prefix}_${uuidv4().slice(0, 8)}`;
  return join(tempDir, filename);
}

/**
 * Resolve an asset path relative to a project's working directory.
 * If the path is already absolute, returns it unchanged.
 * @param path - The asset path (may be relative or absolute)
 * @param projectWorkDir - The project's working directory for relative resolution
 * @returns Absolute path to the asset
 */
export function resolveAssetPath(path: string, projectWorkDir: string): string {
  if (isAbsolute(path)) {
    return path;
  }
  return resolve(projectWorkDir, path);
}
