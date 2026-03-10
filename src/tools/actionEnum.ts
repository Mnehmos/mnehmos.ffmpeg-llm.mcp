/**
 * @module tools/actionEnum
 * @description Centralized tool registry following the OODA MCP pattern.
 * Defines all tool categories, actions, and the dispatch mechanism
 * with Zod-based input validation.
 */

import { z, type ZodSchema } from 'zod';

// ── Enums ───────────────────────────────────────────────────────────────

/** Tool categories for grouping and discovery */
export enum ToolCategory {
  PROJECT = 'project',
  ASSET = 'asset',
  TIMELINE = 'timeline',
  CHAPTER = 'chapter',
  PREVIEW = 'preview',
  ANALYSIS = 'analysis',
  CHESS = 'chess',
  AUTOPILOT = 'autopilot',
  BATCH = 'batch',
}

/** All 47 tool actions in the MCP server */
export enum ToolAction {
  // Project (5)
  PROJECT_CREATE = 'project_create',
  PROJECT_OPEN = 'project_open',
  PROJECT_LIST = 'project_list',
  PROJECT_INFO = 'project_info',
  PROJECT_DELETE = 'project_delete',

  // Asset (6)
  ASSET_IMPORT = 'asset_import',
  ASSET_BATCH_IMPORT = 'asset_batch_import',
  ASSET_LIST = 'asset_list',
  ASSET_INFO = 'asset_info',
  ASSET_REMOVE = 'asset_remove',
  ASSET_GENERATE_THUMBNAIL = 'asset_generate_thumbnail',

  // Timeline (12)
  TRACK_ADD = 'track_add',
  TRACK_REMOVE = 'track_remove',
  TRACK_REORDER = 'track_reorder',
  CLIP_ADD = 'clip_add',
  CLIP_TRIM = 'clip_trim',
  CLIP_MOVE = 'clip_move',
  CLIP_SPLIT = 'clip_split',
  CLIP_REMOVE = 'clip_remove',
  CLIP_SET_SPEED = 'clip_set_speed',
  CLIP_SET_VOLUME = 'clip_set_volume',
  FILTER_ADD = 'filter_add',
  FILTER_REMOVE = 'filter_remove',

  // Chapter (3)
  CHAPTER_ADD = 'chapter_add',
  CHAPTER_REMOVE = 'chapter_remove',
  CHAPTER_LIST = 'chapter_list',

  // Preview & Render (5)
  PREVIEW_SEGMENT = 'preview_segment',
  PREVIEW_FRAME = 'preview_frame',
  RENDER_FULL = 'render_full',
  RENDER_STATUS = 'render_status',
  RENDER_CANCEL = 'render_cancel',

  // Analysis (4)
  ANALYZE_AUDIO_LEVELS = 'analyze_audio_levels',
  ANALYZE_SCENE_CHANGES = 'analyze_scene_changes',
  ANALYZE_SILENCE = 'analyze_silence',
  ANALYZE_DURATION = 'analyze_duration',

  // Chess (5)
  CHESS_DETECT_GAMES = 'chess_detect_games',
  CHESS_SPLIT_GAMES = 'chess_split_games',
  CHESS_ADD_OVERLAY = 'chess_add_overlay',
  CHESS_ADD_INTRO_OUTRO = 'chess_add_intro_outro',
  CHESS_YOUTUBE_EXPORT = 'chess_youtube_export',

  // Autopilot (4)
  AUTOPILOT_ANALYZE = 'autopilot_analyze',
  AUTOPILOT_SUGGEST_EDITS = 'autopilot_suggest_edits',
  AUTOPILOT_APPLY_SUGGESTIONS = 'autopilot_apply_suggestions',
  AUTOPILOT_CONFIGURE = 'autopilot_configure',

  // Batch & History (3)
  BATCH_TOOLS = 'batch_tools',
  TIMELINE_UNDO = 'timeline_undo',
  TIMELINE_REDO = 'timeline_redo',
}

// ── Types ───────────────────────────────────────────────────────────────

/** Standard result type returned by all tool handlers */
export interface ToolResult {
  /** Whether the operation succeeded */
  success: boolean;
  /** Result data (shape varies by tool) */
  data?: unknown;
  /** Error message if success is false */
  error?: string;
  /** Human-readable summary for chat display */
  summary?: string;
}

/** Handler function signature for a tool */
export type ToolHandler = (params: unknown) => Promise<ToolResult>;

/** Complete definition of a registered tool */
export interface ToolDefinition {
  /** The tool action identifier */
  action: ToolAction;
  /** Category for grouping */
  category: ToolCategory;
  /** Human-readable description for MCP discovery */
  description: string;
  /** Zod schema for input validation */
  schema: ZodSchema;
  /** The handler function */
  handler: ToolHandler;
}

// ── Registry ────────────────────────────────────────────────────────────

/** Global tool registry mapping actions to their definitions */
export const toolRegistry: Map<ToolAction, ToolDefinition> = new Map();

/**
 * Register a tool in the global registry.
 * @param definition - Complete tool definition including schema and handler
 * @throws If a tool with the same action is already registered
 */
export function registerTool(definition: ToolDefinition): void {
  if (toolRegistry.has(definition.action)) {
    throw new Error(`Tool '${definition.action}' is already registered`);
  }
  toolRegistry.set(definition.action, definition);
}

/**
 * Execute a tool by action name with Zod input validation.
 *
 * 1. Looks up the tool in the registry
 * 2. Validates input against the tool's Zod schema
 * 3. Calls the handler with validated params
 * 4. Returns the ToolResult
 *
 * @param action - The tool action to execute
 * @param params - Raw input parameters (will be validated)
 * @returns The tool's result
 */
export async function executeTool(action: ToolAction, params: unknown): Promise<ToolResult> {
  const definition = toolRegistry.get(action);
  if (!definition) {
    return {
      success: false,
      error: `Unknown tool action: ${action}`,
    };
  }

  // Validate input
  const parseResult = definition.schema.safeParse(params);
  if (!parseResult.success) {
    return {
      success: false,
      error: `Validation failed: ${parseResult.error.message}`,
    };
  }

  try {
    return await definition.handler(parseResult.data);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      error: `Tool execution failed: ${message}`,
    };
  }
}

/**
 * Get all registered tools as an array, optionally filtered by category.
 * @param category - Optional category filter
 * @returns Array of tool definitions
 */
export function getRegisteredTools(category?: ToolCategory): ToolDefinition[] {
  const all = Array.from(toolRegistry.values());
  if (category) {
    return all.filter((t) => t.category === category);
  }
  return all;
}

// Suppress unused import warning — z is used by consumers importing from this module
void z;
