# Sail Away Posts Generator Architecture

## Goal
Build a JavaScript/TypeScript application that:
- Uses Telegram channel history from JSON files stored in this repository.
- Uses own-channel and similar-channel history together.
- Produces a queue for the next 10 weeks.
- Generates on-demand post drafts with image options.
- Supports interaction through a Telegram bot.

## High-Level Design
- `apps/api`: HTTP API for planning and draft generation requests.
- `apps/worker`: background jobs for importing JSON history, embeddings, and planning.
- `apps/bot`: Telegram bot interface.
- `packages/core`: shared domain logic (planning, retrieval, prompt composition).
- `packages/db`: Prisma schema, migrations, and data access.

## Recommended Stack
- Runtime: Node.js + TypeScript
- API: Fastify or NestJS
- Jobs: BullMQ + Redis
- Database: PostgreSQL + pgvector
- ORM: Prisma
- Telegram: Telegraf
- LLM providers: Adapter pattern (OpenAI/Anthropic or others)

## Data Source and Ingestion
History is provided as JSON files in-repo.

### Suggested folder layout
```text
history/
  own-channel/
    own_channel.json
  similar/
    sailing_channel_a.json
    sailing_channel_b.json
```

### Minimal JSON shape
```json
{
  "channel": "sailing_channel_a",
  "platform": "telegram",
  "posts": [
    {
      "id": "12345",
      "published_at": "2025-06-12T10:30:00Z",
      "text": "Post content...",
      "media": ["https://example.com/image.jpg"],
      "metrics": { "views": 1200, "reactions": 87 }
    }
  ]
}
```

### Ingestion behavior
- Parse all JSON files under `history/`.
- Normalize fields into DB tables (`channels`, `posts`).
- Upsert by `(channel_id, external_post_id)`.
- Track import checksum/timestamp per file for incremental reindexing.

## RAG Pipeline
RAG = Retrieval-Augmented Generation.

For planning and drafting:
1. Retrieve relevant posts from all indexed channel history using vector search + filters.
2. Build structured context (themes, tone, performance patterns, recent gaps).
3. Generate output via LLM:
   - `plan_next_10`: list of 10 post ideas with rationale and schedule slot.
   - `draft_post`: full text + image options.
4. Store source post references for traceability.

## Core Features

### 1) Next 10 Weeks Queue
Input:
- Own-channel history
- Similar-channel history
- Optional strategy parameters (tone, campaign goal, cadence)

Output per item:
- rank (1..10)
- topic/theme
- objective
- tone/style
- suggested CTA
- week slot (`weekStart`, `weekEnd`)
- supporting source post IDs

### 2) On-Demand Draft + Image Options
Input:
- queue item index or ad-hoc topic
- optional constraints (length, platform, tone)

Output:
- final draft text
- 3 to 5 image options (prompt concepts and/or references)
- source citations from history

## Telegram Integration
Use bot commands as primary interface:
- `/queue10` -> generate queue for next 10 weeks
- `/queuelatest` -> fetch latest saved queue
- `/replaceposts` -> replace all queue topics with user topics
- `/swapposts <from> <to>` -> swap 2 queue positions
- `/draft <index>` -> generate draft for queue item

Bot should call API endpoints; keep LLM logic in backend services, not in bot handlers.

## Data Model (Initial)
- `channels`
  - `id`, `name`, `platform`, `kind` (`OWN` | `SIMILAR`)
- `posts`
  - `id`, `channel_id`, `external_post_id`, `published_at`, `text`, `media_json`, `metrics_json`
- `post_embeddings`
  - `post_id`, `embedding` (vector), `model`
- `queues`
  - `id`, `created_at`, `params_json`
- `queue_items`
  - `id`, `queue_id`, `rank`, `topic`, `objective`, `tone`, `cta`, `week_start`, `week_end`, `source_post_ids_json`
- `drafts`
  - `id`, `plan_item_id`, `text`, `image_options_json`, `source_post_ids_json`, `created_at`

## API Endpoints (MVP)
- `GET /queue/next10` -> generate and save 10-week queue
- `GET /queue/latest` -> return latest saved queue
- `POST /queue/replace` -> replace 10 queue topics
- `POST /queue/swap` -> swap two queue items by rank
- `POST /draft` -> generate draft by queue item or topic

## Worker Jobs (MVP)
- `reindex-history`
- `embed-posts`
- `generate-plan-next10`
- `generate-draft`

## Non-Functional Notes
- Determinism: keep prompt templates versioned.
- Observability: structured logs with job IDs and channel IDs.
- Cost control: cache retrieval context and deduplicate embeddings.
- Quality: save generated outputs for review and iterative prompt tuning.

## Implementation Milestones
1. Scaffold TS monorepo (`apps/*`, `packages/*`), Prisma schema, and DB migration.
2. Implement JSON importer + `reindex-history` job.
3. Add embeddings + retrieval service.
4. Implement queue API (`/queue/next10`, `/queue/latest`).
5. Implement queue mutations (`/queue/replace`, `/queue/swap`) and drafting.
6. Add Telegram bot commands and weekly Sunday auto-publish.

## Deployment

### Objective
Deploy with:
- Telegram bot interface
- JSON history from repository files
- OpenAI model `gpt-5-mini` as default generation model

### Environments
- `local`: development and manual testing.
- `prod`: always-on deployment for bot + API + worker.

### Production Topology
- `api`: HTTP endpoints for planning and draft generation.
- `worker`: background jobs (`reindex-history`, `embed-posts`, `generate-plan-next10`, `generate-draft`).
- `bot`: Telegram long-polling process.
- `postgres`: application data.
- `redis`: queue and job coordination.

### Deployment Steps
1. Provision PostgreSQL and Redis.
2. Configure environment variables.
3. Run DB migrations.
4. Start API, worker, and bot processes.
5. Trigger initial history reindex.
6. Validate bot commands (`/queue10`, `/queuelatest`, `/replaceposts`, `/swapposts`, `/draft`).

### Initial Data Bootstrap
- Import all `history/**/*.json` into DB.
- Generate embeddings for imported posts.
- Run one `queue_next_10_weeks` generation to validate end-to-end flow.

### Operations
- Reindex when JSON history changes (manual or scheduled).
- Monitor queue lag and job failures.
- Keep generated plans/drafts for quality review.

### Security
- Store secrets in environment variables or a secret manager.
- Never commit API keys or Telegram bot token.
- Restrict sensitive bot commands to approved Telegram user IDs.

### Cost Notes
- Main variable cost is LLM token usage.
- Defaulting to `gpt-5-mini` keeps generation cost lower than larger models.
- Control cost by limiting retrieved context and avoiding unnecessary regenerations.

### Minimal Launch Checklist
- [ ] `OPENAI_API_KEY` configured.
- [ ] `OPENAI_MODEL=gpt-5-mini` configured.
- [ ] `DATABASE_URL` and `REDIS_URL` configured.
- [ ] `TELEGRAM_BOT_TOKEN` configured.
- [ ] DB migrations applied.
- [ ] Initial reindex completed.
- [ ] Bot responds to `/queue10`.
