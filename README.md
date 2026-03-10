# mnehmos.ffmpeg-llm.mcp

FFmpeg-based video editing engine exposed as an MCP (Model Context Protocol) server with OpenRouter LLM autopilot.

> You don't need a video editor — you need a video editing engine with MCP tool exposure.

## What is this?

An MCP server that gives AI agents structured control over FFmpeg. Instead of writing raw FFmpeg commands, agents call tools like `clip_add`, `clip_trim`, `preview_segment`, and `render_full`. The server maintains a JSON timeline as the source of truth and generates optimized FFmpeg filter graphs at render time.

**47 tools** across 8 categories: Project Management, Asset Management, Timeline Editing, Chapters, Preview & Render, Analysis, Chess Content Pipeline, and LLM Autopilot.

## Features

- **Structured timeline editing** — Tracks, clips, filters, chapters as JSON
- **FFmpeg filter graph generation** — Timeline → optimized `-filter_complex` commands
- **Preview engine** — Quick low-res previews before committing to full renders
- **Audio/scene analysis** — Silence detection, scene changes, audio levels via FFmpeg
- **Chess content pipeline** — Game boundary detection, overlays, YouTube export
- **LLM autopilot** — OpenRouter vision models analyze video, suggest edits, identify highlights
- **Background rendering** — Long exports run async with progress tracking
- **Undo/redo** — Full operation history

## Prerequisites

- Node.js >= 18
- FFmpeg >= 4.0 (in PATH)
- ffprobe >= 4.0 (in PATH)

## Installation

```bash
git clone https://github.com/Mnehmos/mnehmos.ffmpeg-llm.mcp.git
cd mnehmos.ffmpeg-llm.mcp
npm install
npm run build
```

## Usage

### As MCP Server

Add to your MCP client configuration:

```json
{
  "mcpServers": {
    "ffmpeg-llm": {
      "command": "node",
      "args": ["path/to/mnehmos.ffmpeg-llm.mcp/dist/index.js"],
      "env": {
        "OPENROUTER_API_KEY": "your-key-here"
      }
    }
  }
}
```

### Quick Start

```
1. project_create({ name: "My Video", workDir: "/path/to/project" })
2. asset_import({ projectId: "...", filePath: "/path/to/recording.mp4" })
3. clip_add({ projectId: "...", assetId: "...", trackId: "...", timelineStart: 0 })
4. clip_trim({ clipId: "...", sourceStart: 30, sourceEnd: 120 })
5. preview_segment({ projectId: "...", start: 0, end: 10 })
6. render_full({ projectId: "...", outputPath: "/path/to/output.mp4" })
```

## Development

```bash
npm run dev            # Run with tsx
npm run test           # Run tests
npm run test:watch     # Watch mode
npm run test:coverage  # With coverage
npm run preflight      # typecheck + lint + test
```

## Architecture

See [DESIGN.md](DESIGN.md) for full architecture documentation.

## License

MIT
