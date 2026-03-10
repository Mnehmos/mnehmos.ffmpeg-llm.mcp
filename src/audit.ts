/**
 * @module audit
 * @description Audit logging helper for tracking all tool invocations
 * with their parameters and results.
 */

import { v4 as uuidv4 } from 'uuid';
import type { Storage } from './storage/db.js';

/**
 * Log a tool invocation to the audit trail.
 *
 * Records the tool name, input parameters, and result for debugging,
 * compliance, and undo/redo support.
 *
 * @param db - Storage instance with appendAudit method
 * @param projectId - The project this tool call is associated with
 * @param tool - The tool action name (e.g., 'clip_add')
 * @param params - The input parameters passed to the tool
 * @param result - The result returned by the tool
 */
export function logToolCall(
  db: Storage,
  projectId: string,
  tool: string,
  params: unknown,
  result: unknown,
): void {
  db.appendAudit({
    id: uuidv4(),
    projectId,
    tool,
    paramsJson: JSON.stringify(params),
    resultJson: JSON.stringify(result),
    timestamp: new Date().toISOString(),
  });
}
