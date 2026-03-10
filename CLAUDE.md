# mnehmos.ffmpeg-llm.mcp — Agent Instructions

## Identity

| Property | Value |
|----------|-------|
| **Project** | `mnehmos.ffmpeg-llm.mcp` |
| **Type** | MCP Server |
| **Language** | TypeScript (strict mode) |
| **Runtime** | Node.js >= 18 |
| **External Deps** | FFmpeg, ffprobe (system binaries) |

## Architecture

```
MCP Tool Surface (47 tools)
    ↓
Timeline Engine (JSON source of truth + undo/redo)
    ↓
┌──────────────┬─────────────────────┐
│ FFmpeg Engine │ OpenRouter Autopilot │
│ filter-graph  │ frame sampling       │
│ cmd-builder   │ vision models        │
│ render-queue  │ budget control       │
└──────────────┴─────────────────────┘
    ↓
SQLite Storage (projects, render_jobs, audit_log)
```

## Development Commands

```bash
npm run build          # TypeScript compilation
npm run dev            # Run with tsx (dev mode)
npm run test           # Vitest (run once)
npm run test:watch     # Vitest (watch mode)
npm run test:coverage  # With coverage report
npm run lint           # ESLint
npm run lint:fix       # ESLint + auto-fix
npm run format         # Prettier
npm run typecheck      # tsc --noEmit
npm run preflight      # typecheck + lint + test (run before commits)
```

## Key Patterns

### Tool Registration
All tools use the centralized registry in `src/tools/actionEnum.ts`. Pattern:
```typescript
registerTool({
  action: ToolAction.CLIP_ADD,
  category: ToolCategory.TIMELINE,
  description: 'Add a clip to the timeline',
  schema: ClipAddSchema,
  handler: async (params) => { /* ... */ },
});
```

### State Management
- Timeline is JSON in SQLite. Load → mutate → save on every tool call.
- Never hold state in memory across tool calls.
- Every mutation appends to project.history[] for undo/redo.

### FFmpeg Commands
- LLM never writes raw FFmpeg commands
- Tools validate inputs → FilterGraphBuilder constructs filter_complex → CommandAssembler produces args
- All rendering goes through RenderQueue for background execution

### Testing
- Unit tests mock FFmpeg/FFprobe (never call real binaries in unit tests)
- Integration tests (in tests/integration/) require FFmpeg installed
- Use fixtures from `tests/helpers/fixtures.ts`
- Use mocks from `tests/helpers/mocks.ts`

## Git Workflow (Gitflow)

```
main ← release/* ← develop ← feature/*, fix/*
                 ← hotfix/* → main + develop
```

- `main`: Production-ready releases only
- `develop`: Integration branch for next release
- `feature/*`: New features branch from develop
- `fix/*`: Bug fixes branch from develop
- `hotfix/*`: Emergency fixes branch from main
- `release/v*`: Release candidates from develop

**Commit convention:** `type(scope): message`
- Types: feat, fix, test, refactor, docs, chore
- Scopes: engine, tools, schemas, llm, storage, ci

## File Organization

| Directory | Purpose |
|-----------|---------|
| `src/schemas/` | Zod schemas and inferred types |
| `src/storage/` | SQLite persistence |
| `src/engine/` | FFmpeg/FFprobe wrappers, filter graph, command builder |
| `src/tools/` | MCP tool handlers (9 categories) |
| `src/llm/` | OpenRouter client, analyzers, prompts |
| `src/utils/` | Time formatting, path resolution |
| `tests/helpers/` | Fixtures, mocks, test setup |
| `tests/` | Mirrors src/ structure |

## Edge Cases to Handle

### FFmpeg
- Streams with no audio track (image sequences, some screen recordings)
- Variable frame rate (VFR) sources — normalize with fps filter
- Very long recordings (>4 hours) — chunked processing
- Codec compatibility (copy vs. re-encode decisions)
- Windows path escaping in filter_complex strings

### Timeline
- Zero-duration clips (rejected)
- Overlapping clips on same track (rejected)
- Gaps between clips (allowed — produces black/silence)
- Clips referencing deleted assets (cascade or reject)
- Speed changes that make clip shorter than 1 frame (rejected)

### Autopilot
- Budget exhausted mid-analysis (graceful stop, return partial results)
- OpenRouter rate limits (exponential backoff, max 3 retries)
- Vision model can't parse frame (skip, log, continue)
- Response doesn't match expected schema (retry once with clarified prompt)

## Dependencies

### Runtime
- `@modelcontextprotocol/sdk` — MCP server framework
- `better-sqlite3` — SQLite storage
- `zod` — Schema validation
- `uuid` — ID generation

### System (must be in PATH)
- `ffmpeg` >= 4.0
- `ffprobe` >= 4.0
