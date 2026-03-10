/**
 * @module index
 * @description MCP server entry point for the FFmpeg-LLM video editing engine.
 * Initializes storage, FFmpeg runners, and registers all tools via the
 * centralized tool registry.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { zodToJsonSchema } from 'zod-to-json-schema';

import { loadConfig } from './config.js';
import { SqliteStorage } from './storage/db.js';
import { RealFFmpegRunner } from './engine/ffmpeg.js';
import { RealFFprobeRunner } from './engine/ffprobe.js';
import { RenderQueue } from './engine/render-queue.js';
import { OpenRouterClient } from './llm/openrouter-client.js';
import { FrameSampler } from './llm/frame-sampler.js';
import { BudgetTracker } from './llm/budget.js';
import { logToolCall } from './audit.js';
import { ensureDir } from './utils/paths.js';

import { toolRegistry, executeTool, getRegisteredTools, ToolAction } from './tools/actionEnum.js';
import { registerProjectTools } from './tools/project.js';
import { registerAssetTools } from './tools/asset.js';
import { registerTimelineTools } from './tools/timeline.js';
import { registerChapterTools } from './tools/chapter.js';
import { registerPreviewTools } from './tools/preview.js';
import { registerAnalysisTools } from './tools/analysis.js';
import { registerChessTools } from './tools/chess.js';
import { registerAutopilotTools } from './tools/autopilot.js';
import { registerBatchTools } from './tools/batch.js';

/**
 * Main entry point — initializes and starts the MCP server.
 */
async function main(): Promise<void> {
  // ── Configuration ───────────────────────────────────────────────────
  const config = loadConfig();
  await ensureDir(config.workDir);

  // ── Infrastructure ──────────────────────────────────────────────────
  const db = new SqliteStorage(config.dbPath);
  const ffmpeg = new RealFFmpegRunner(config.ffmpegPath);
  const ffprobe = new RealFFprobeRunner(config.ffprobePath);
  const renderQueue = new RenderQueue(ffmpeg, db);
  const sampler = new FrameSampler();
  const budget = new BudgetTracker({ maxBudgetUsd: 1.0 });

  // LLM client (optional — only if API key is configured)
  const llmClient = config.openrouterApiKey
    ? new OpenRouterClient(config.openrouterApiKey, config.defaultModel)
    : new OpenRouterClient('', config.defaultModel); // Will fail on actual calls

  // ── Tool Registration ───────────────────────────────────────────────
  registerProjectTools(toolRegistry, db);
  registerAssetTools(toolRegistry, db, ffprobe, ffmpeg);
  registerTimelineTools(toolRegistry, db);
  registerChapterTools(toolRegistry, db);
  registerPreviewTools(toolRegistry, db, ffmpeg, renderQueue);
  registerAnalysisTools(toolRegistry, db, ffmpeg, ffprobe);
  registerChessTools(toolRegistry, db, ffmpeg);
  registerAutopilotTools(toolRegistry, db, llmClient, sampler, budget, ffmpeg);
  registerBatchTools(toolRegistry, db);

  // ── MCP Server ──────────────────────────────────────────────────────
  const server = new Server(
    {
      name: 'mnehmos-ffmpeg-llm',
      version: '0.1.0',
    },
    {
      capabilities: {
        tools: {},
      },
    },
  );

  // List all registered tools
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const tools = getRegisteredTools();
    return {
      tools: tools.map((t) => ({
        name: t.action,
        description: t.description,
        inputSchema: zodToJsonSchema(t.schema, { target: 'openApi3' }),
      })),
    };
  });

  // Execute a tool by name
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const action = name as ToolAction;

    const result = await executeTool(action, args);

    // Audit logging — extract projectId if present
    const projectId = (args as Record<string, unknown> | undefined)?.projectId as
      | string
      | undefined;
    if (projectId) {
      logToolCall(db, projectId, name, args, result);
    }

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(result, null, 2),
        },
      ],
      isError: !result.success,
    };
  });

  // ── Start ───────────────────────────────────────────────────────────
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

// Launch
main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
