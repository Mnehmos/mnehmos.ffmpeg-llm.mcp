# mnehmos.ffmpeg-llm.mcp — Design Document

## Vision

FFmpeg as a video editing engine with MCP tool exposure + internal LLM autopilot via OpenRouter. The GUI is for humans — this is built for agents.

## Technology Stack

| Component | Choice | Rationale |
|-----------|--------|-----------|
| **Language** | TypeScript | Matches all Mnehmos MCP servers; Zod validation |
| **Runtime** | Node.js >= 18 | Native `fetch` for OpenRouter; consistent with workspace |
| **Video Engine** | FFmpeg + ffprobe (CLI) | Only external dependency; spawned via `child_process` |
| **State Storage** | SQLite via `better-sqlite3` | Proven pattern; projects + timelines + assets |
| **Validation** | Zod | Workspace standard |
| **LLM Backend** | OpenRouter API (direct `fetch`) | Multi-model access |
| **MCP Transport** | StdioServerTransport | Standard across all Mnehmos MCPs |

**Why not Python/FastMCP:** Every MCP in this workspace is TypeScript. OpenRouter client code already exists. TypeScript is the clear choice.

**Why not MLT Framework:** MLT adds abstraction over FFmpeg that complicates debugging. Direct FFmpeg CLI spawning gives full control and transparency. Reconsider post-MVP.

---

## Architecture Layers

```
┌─────────────────────────────────────────────────────┐
│                   MCP Tool Surface                   │
│  project_* │ asset_* │ clip_* │ autopilot_* │ ...   │
├─────────────────────────────────────────────────────┤
│                   Timeline Engine                    │
│  JSON timeline (source of truth) + undo/redo        │
├──────────────────┬──────────────────────────────────┤
│  FFmpeg Engine   │      OpenRouter Autopilot         │
│  filter-graph    │  frame sampling + vision models   │
│  command-builder │  editorial suggestions            │
│  render-queue    │  budget control                   │
├──────────────────┴──────────────────────────────────┤
│                   SQLite Storage                     │
│  projects │ assets │ render_jobs │ audit_log         │
└─────────────────────────────────────────────────────┘
```

---

## Timeline Data Model (Layer 1)

The JSON timeline is the single source of truth. All editing tools mutate it. FFmpeg commands are generated at render time — never stored.

### Core Schemas

```typescript
const AssetSchema = z.object({
  id: z.string().uuid(),
  type: z.enum(['video', 'audio', 'image', 'subtitle', 'data']),
  path: z.string(),                     // Absolute path on disk
  originalName: z.string(),
  duration: z.number().optional(),       // Seconds, from ffprobe
  width: z.number().optional(),
  height: z.number().optional(),
  fps: z.number().optional(),
  codec: z.string().optional(),
  audioCodec: z.string().optional(),
  sampleRate: z.number().optional(),
  channels: z.number().optional(),
  fileSize: z.number(),
  probeData: z.record(z.any()).optional(),
  tags: z.array(z.string()).default([]),
  importedAt: z.string().datetime(),
});

const TimeRangeSchema = z.object({
  start: z.number(),    // Seconds (float)
  end: z.number(),
});

const FilterSchema = z.object({
  type: z.enum([
    'volume', 'normalize', 'fade_audio',
    'brightness', 'contrast', 'saturation',
    'scale', 'crop', 'pad',
    'fade_video', 'overlay', 'drawtext',
    'speed', 'reverse',
    'deinterlace', 'denoise',
    'custom'
  ]),
  params: z.record(z.any()),
  enabled: z.boolean().default(true),
});

const ClipSchema = z.object({
  id: z.string().uuid(),
  assetId: z.string().uuid(),
  sourceRange: TimeRangeSchema,         // In/out within source asset
  timelineStart: z.number(),            // Absolute position on timeline
  trackIndex: z.number().int(),
  filters: z.array(FilterSchema).default([]),
  volume: z.number().default(1.0),
  opacity: z.number().default(1.0),
  speed: z.number().default(1.0),
  label: z.string().optional(),
  metadata: z.record(z.any()).default({}),
});

const TrackSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  type: z.enum(['video', 'audio', 'overlay', 'subtitle']),
  clips: z.array(ClipSchema),
  muted: z.boolean().default(false),
  locked: z.boolean().default(false),
  visible: z.boolean().default(true),
});

const ChapterSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  timelineStart: z.number(),
  metadata: z.record(z.any()).default({}),
});

const ExportPresetSchema = z.object({
  name: z.string(),
  container: z.enum(['mp4', 'mkv', 'webm', 'mov']),
  videoCodec: z.enum(['libx264', 'libx265', 'libvpx-vp9', 'copy']),
  audioCodec: z.enum(['aac', 'libopus', 'libmp3lame', 'copy']),
  videoBitrate: z.string().optional(),
  audioBitrate: z.string().optional(),
  resolution: z.object({ w: z.number(), h: z.number() }).optional(),
  fps: z.number().optional(),
  twoPass: z.boolean().default(false),
  extraArgs: z.array(z.string()).default([]),
});

const ProjectSchema = z.object({
  id: z.string(),
  name: z.string(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  workDir: z.string(),
  timeline: z.object({
    tracks: z.array(TrackSchema),
    duration: z.number(),
    chapters: z.array(ChapterSchema).default([]),
  }),
  assets: z.array(AssetSchema).default([]),
  exportPresets: z.array(ExportPresetSchema).default([]),
  settings: z.object({
    defaultResolution: z.object({ w: z.number(), h: z.number() }).default({ w: 1920, h: 1080 }),
    defaultFps: z.number().default(30),
    defaultAudioSampleRate: z.number().default(48000),
  }),
  autopilot: z.object({
    enabled: z.boolean().default(false),
    openrouterModel: z.string().default('google/gemini-2.0-flash-001'),
    visionModel: z.string().default('google/gemini-2.0-flash-001'),
    maxBudgetUsd: z.number().default(1.0),
    spentUsd: z.number().default(0),
  }).default({}),
  history: z.array(z.object({
    action: z.string(),
    timestamp: z.string().datetime(),
    before: z.any().optional(),
    after: z.any().optional(),
  })).default([]),
});
```

### Key Design Decisions
- Times always in **seconds (float)**, never frames
- `sourceRange` = within the asset; `timelineStart` = absolute timeline position
- Filters are structured arrays, not raw FFmpeg strings
- History array enables undo/redo
- Autopilot config is per-project (different models/budgets per project)

---

## Tool Inventory (Layer 2) — 47 Tools

### Project Management (5)

| Tool | Description | Key Params |
|------|-------------|------------|
| `project_create` | Create new editing project | `name`, `workDir`, `settings?` |
| `project_open` | Open existing project | `projectId` |
| `project_list` | List all projects | `limit?`, `offset?` |
| `project_info` | Full project state + timeline summary | `projectId` |
| `project_delete` | Delete project | `projectId`, `deleteFiles?` |

### Asset Management (6)

| Tool | Description | Key Params |
|------|-------------|------------|
| `asset_import` | Import media file, run ffprobe | `projectId`, `filePath`, `tags?` |
| `asset_batch_import` | Import multiple files | `projectId`, `filePaths[]`, `tags?` |
| `asset_list` | List project assets | `projectId`, `type?`, `tags?` |
| `asset_info` | Detailed probe data | `assetId` |
| `asset_remove` | Remove asset (fails if referenced) | `assetId`, `force?` |
| `asset_generate_thumbnail` | Extract thumbnail at timestamp | `assetId`, `timestamp` |

### Timeline Editing (12)

| Tool | Description | Key Params |
|------|-------------|------------|
| `track_add` | Add track | `projectId`, `name`, `type` |
| `track_remove` | Remove track + clips | `projectId`, `trackId` |
| `track_reorder` | Change track order | `projectId`, `trackId`, `newIndex` |
| `clip_add` | Place asset on timeline | `projectId`, `assetId`, `trackId`, `timelineStart`, `sourceRange?` |
| `clip_trim` | Adjust in/out points | `clipId`, `sourceStart?`, `sourceEnd?` |
| `clip_move` | Move clip position/track | `clipId`, `timelineStart?`, `trackId?` |
| `clip_split` | Split clip at timestamp | `clipId`, `splitAt` |
| `clip_remove` | Remove clip | `clipId` |
| `clip_set_speed` | Change playback speed | `clipId`, `speed` |
| `clip_set_volume` | Set audio volume | `clipId`, `volume` |
| `filter_add` | Add filter to clip | `clipId`, `filter` |
| `filter_remove` | Remove filter | `clipId`, `filterIndex` |

### Chapters & Markers (3)

| Tool | Description | Key Params |
|------|-------------|------------|
| `chapter_add` | Add chapter marker | `projectId`, `title`, `timelineStart` |
| `chapter_remove` | Remove chapter | `chapterId` |
| `chapter_list` | List all chapters | `projectId` |

### Preview & Render (5)

| Tool | Description | Key Params |
|------|-------------|------------|
| `preview_segment` | Render short segment | `projectId`, `start`, `end`, `quality?` |
| `preview_frame` | Extract single frame | `projectId`, `timestamp` |
| `render_full` | Full export with preset | `projectId`, `presetName?`, `outputPath` |
| `render_status` | Check render job status | `jobId` |
| `render_cancel` | Cancel active render | `jobId` |

### Analysis (4)

| Tool | Description | Key Params |
|------|-------------|------------|
| `analyze_audio_levels` | RMS/peak audio data over time | `assetId`, `segmentDuration?` |
| `analyze_scene_changes` | Detect scene changes | `assetId`, `threshold?` |
| `analyze_silence` | Detect silence regions | `assetId`, `threshold?`, `minDuration?` |
| `analyze_duration` | Precise duration + stream info | `assetId` |

### Chess Content Pipeline (5)

| Tool | Description | Key Params |
|------|-------------|------------|
| `chess_detect_games` | Find game boundaries in stream recording | `assetId`, `minGameDuration?` |
| `chess_split_games` | Split recording into game clips | `projectId`, `assetId`, `gameBoundaries[]` |
| `chess_add_overlay` | Eval graph / player stats overlay | `clipId`, `overlayType`, `data` |
| `chess_add_intro_outro` | Prepend intro, append outro | `projectId`, `introAssetId?`, `outroAssetId?` |
| `chess_youtube_export` | YouTube-optimized export + chapters | `projectId`, `outputPath` |

### Autopilot (4)

| Tool | Description | Key Params |
|------|-------------|------------|
| `autopilot_analyze` | LLM analysis on video content | `projectId`, `assetId`, `analysisType` |
| `autopilot_suggest_edits` | Get editorial suggestions | `projectId`, `prompt?` |
| `autopilot_apply_suggestions` | Apply suggestions to timeline | `projectId`, `suggestionIds[]` |
| `autopilot_configure` | Set model, budget, enable/disable | `projectId`, `config` |

### Batch & Utility (3)

| Tool | Description | Key Params |
|------|-------------|------------|
| `batch_tools` | Generic batch dispatcher | `operations[]` |
| `timeline_undo` | Undo last N ops | `projectId`, `steps?` |
| `timeline_redo` | Redo last N ops | `projectId`, `steps?` |

---

## FFmpeg Command Generation

### Translation Pipeline

```
Timeline JSON → TrackResolver → FilterGraphBuilder → CommandAssembler → child_process.spawn
```

### Key Translation Rules

1. **Clips → inputs:** Each unique asset = one `-i` input. Shared via input index.
2. **Source ranges → trim:** `sourceRange` → `trim=start=X:end=Y,setpts=PTS-STARTPTS`
3. **Track composition:** Same-track clips concatenated via `concat` filter. Multi-track via `overlay`/`amix`.
4. **Speed changes:** `setpts=PTS/speed` (video) + `atempo=speed` (audio, chained for extreme values).
5. **Filter ordering:** Clip-level → track-level → global.
6. **Chapters:** Written as FFmpeg metadata file for muxing.

### Example

```bash
# Timeline: 2 clips on track 0, logo overlay on track 1
ffmpeg \
  -i asset0.mp4 -i asset1.mp4 -i logo.png \
  -filter_complex "
    [0:v]trim=start=10:end=30,setpts=PTS-STARTPTS[v0];
    [0:a]atrim=start=10:end=30,asetpts=PTS-STARTPTS,volume=0.8[a0];
    [1:v]trim=start=0:end=15,setpts=PTS-STARTPTS[v1];
    [1:a]atrim=start=0:end=15,asetpts=PTS-STARTPTS[a1];
    [v0][a0][v1][a1]concat=n=2:v=1:a=1[mainv][maina];
    [2:v]scale=200:200[logo];
    [mainv][logo]overlay=x=W-w-20:y=20[outv]
  " \
  -map "[outv]" -map "[maina]" \
  -c:v libx264 -c:a aac output.mp4
```

---

## OpenRouter Integration (Autopilot)

### Flow

```
autopilot_analyze → FrameSampler (extract frames via ffmpeg) → OpenRouterClient → Zod-validated response → Store in project DB
```

### Model Selection

| Task | Model | Rationale |
|------|-------|-----------|
| Frame analysis | `google/gemini-2.0-flash-001` | Fast, cheap, good vision |
| Editorial decisions | `anthropic/claude-sonnet-4-20250514` | Best reasoning |
| Audio transcripts | `google/gemini-2.0-flash-001` | Fast text processing |
| Thumbnail selection | `google/gemini-2.0-flash-001` | Vision + aesthetics |

### Analysis Types

1. **`scene_overview`** — 1 frame/30s, describe content progression
2. **`highlight_detection`** — Dense sampling around scene changes, identify notable moments
3. **`chapter_suggestion`** — Scene overview → chapter boundaries with titles
4. **`thumbnail_candidates`** — Rank frames for thumbnail quality
5. **`edit_review`** — Given timeline state, suggest improvements

### Budget Control

Every OpenRouter call checks `spentUsd < maxBudgetUsd`. Cost estimated from token counts. Per-project, persisted.

---

## File Structure

```
mnehmos.ffmpeg-llm.mcp/
├── src/
│   ├── index.ts                    # Entry point, MCP server setup
│   ├── config.ts                   # Configuration loading
│   ├── audit.ts                    # Audit logging
│   ├── storage/
│   │   └── db.ts                   # SQLite (projects, assets, render jobs)
│   ├── tools/
│   │   ├── actionEnum.ts           # Centralized tool registry
│   │   ├── project.ts              # Project CRUD
│   │   ├── asset.ts                # Asset import/management
│   │   ├── timeline.ts             # Clip/track editing
│   │   ├── chapter.ts              # Chapter markers
│   │   ├── preview.ts              # Preview/render
│   │   ├── analysis.ts             # Audio/scene analysis
│   │   ├── chess.ts                # Chess content pipeline
│   │   ├── autopilot.ts            # LLM autopilot
│   │   └── batch.ts                # Batch dispatcher
│   ├── engine/
│   │   ├── ffmpeg.ts               # FFmpeg CLI wrapper
│   │   ├── ffprobe.ts              # ffprobe wrapper
│   │   ├── filter-graph.ts         # Filter graph builder
│   │   ├── command-builder.ts      # Timeline → FFmpeg args
│   │   └── render-queue.ts         # Background render jobs
│   ├── llm/
│   │   ├── openrouter-client.ts    # OpenRouter API client
│   │   ├── frame-sampler.ts        # Extract frames for vision
│   │   ├── prompts.ts              # System prompts per analysis type
│   │   ├── analyzers.ts            # Analysis implementations
│   │   └── budget.ts               # Cost tracking
│   ├── schemas/
│   │   ├── timeline.ts             # Timeline, Track, Clip, Filter
│   │   ├── asset.ts                # Asset schemas
│   │   ├── project.ts              # Project schema
│   │   ├── export.ts               # Export presets
│   │   └── autopilot.ts            # Autopilot config/responses
│   └── utils/
│       ├── time.ts                 # Time formatting
│       └── paths.ts                # Path resolution, temp dirs
├── tests/
│   ├── engine/
│   │   ├── filter-graph.test.ts
│   │   └── command-builder.test.ts
│   ├── tools/
│   │   └── timeline.test.ts
│   └── llm/
│       └── openrouter-client.test.ts
├── package.json
├── tsconfig.json
├── CLAUDE.md
├── PROJECT_KNOWLEDGE.md
└── README.md
```

---

## Build Phases

### Phase 1: Foundation (MVP)
**17 tools — Import, place clips, trim, preview, render**

1. Scaffold project, schemas
2. SQLite storage layer
3. ffprobe + ffmpeg wrappers
4. Project CRUD (5 tools)
5. Asset import + list (4 tools)
6. Core clip ops: add, trim, move, remove, track_add, track_remove (6 tools)
7. Basic filter graph: concat + trim
8. preview_segment, preview_frame (2 tools)

**Ship:** Can import OBS recordings → place on timeline → trim → preview → basic render.

### Phase 2: Full Editing
**+15 tools — Filters, analysis, chapters, background rendering**

1. clip_split, speed, volume, filter_add/remove
2. Filter graph enhancements: overlays, drawtext, fades, speed
3. Chapter markers (3 tools)
4. Analysis tools: audio levels, scene changes, silence (4 tools)
5. Background render queue with status/cancel
6. Export presets + two-pass encoding
7. Undo/redo + batch dispatcher

**Ship:** Full non-AI editing workflow.

### Phase 3: Chess Pipeline
**+5 tools — Domain-specific content automation**

1. chess_detect_games (scene + silence heuristics)
2. chess_split_games
3. chess_add_overlay (eval graphs, player names)
4. chess_add_intro_outro
5. chess_youtube_export (preset + chapters + thumbnails)

**Ship:** End-to-end chess stream → YouTube pipeline, manually driven.

### Phase 4: Autopilot
**+4 tools — LLM-driven automation**

1. OpenRouter client (adapt from Beyond16)
2. Frame sampler
3. Analysis types: scene_overview, highlights, chapters, thumbnails, edit_review
4. Budget tracking
5. autopilot_analyze, suggest_edits, apply_suggestions, configure

**Ship:** Full autopilot loop: import → analyze → suggest → review preview → export.

### Phase 5: Polish
- Error recovery, partial render resumption
- Hardware acceleration detection
- Comprehensive docs
- Integration tests with real video
- Performance optimization

---

## Key Architectural Decisions

| Decision | Choice | Why |
|----------|--------|-----|
| FFmpeg invocation | CLI spawning | Full control, debuggable, no native compilation issues |
| State storage | SQLite (JSON column) | Atomic writes, queryable, consistent with OODA/Synch |
| Autopilot placement | Internal module | Same tool handlers, same validation, same audit trail |
| Render model | Background jobs | Prevents MCP timeouts on long renders |
| Filter strategy | Single `-filter_complex` | No intermediate files, leverages FFmpeg optimization |

---

## Dependencies

### Runtime
- `@modelcontextprotocol/sdk`
- `zod`
- `zod-to-json-schema`
- `better-sqlite3`
- `uuid`

### Dev
- `typescript`, `@types/node`, `@types/uuid`, `tsx`

### External (system)
- `ffmpeg`, `ffprobe`

OpenRouter client uses native `fetch` (Node 18+). No additional HTTP library needed.
