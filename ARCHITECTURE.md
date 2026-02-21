# Sail Away Posts Generator Architecture

## Goal
Build a JavaScript/TypeScript application that:
- Uses Telegram channel history from JSON files stored in this repository.
- Uses own-channel and similar-channel history together.
- Produces a plan for the next 10 posts.
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

### 1) Next 10 Post Plan
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
- suggested schedule slot
- supporting source post IDs

### 2) On-Demand Draft + Image Options
Input:
- plan item index or ad-hoc topic
- optional constraints (length, platform, tone)

Output:
- final draft text
- 3 to 5 image options (prompt concepts and/or references)
- source citations from history

## Telegram Integration
Use bot commands as primary interface:
- `/plan10` -> generate or fetch latest plan
- `/draft <index|topic>` -> generate draft
- `/sources <draft_id>` -> show source history references
- `/reindex` -> trigger JSON reimport job

Bot should call API endpoints; keep LLM logic in backend services, not in bot handlers.

## Data Model (Initial)
- `channels`
  - `id`, `name`, `platform`, `kind` (`OWN` | `SIMILAR`)
- `posts`
  - `id`, `channel_id`, `external_post_id`, `published_at`, `text`, `media_json`, `metrics_json`
- `post_embeddings`
  - `post_id`, `embedding` (vector), `model`
- `plans`
  - `id`, `created_at`, `params_json`
- `plan_items`
  - `id`, `plan_id`, `rank`, `topic`, `objective`, `tone`, `cta`, `schedule_at`, `source_post_ids_json`
- `drafts`
  - `id`, `plan_item_id`, `text`, `image_options_json`, `source_post_ids_json`, `created_at`

## API Endpoints (MVP)
- `POST /reindex` -> import JSON history and update embeddings
- `GET /plan/next10` -> generate or return latest 10-post plan
- `POST /draft` -> generate draft by plan item or topic
- `GET /draft/:id/sources` -> citation links and references

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
4. Implement `GET /plan/next10`.
5. Implement `POST /draft` with image options.
6. Add Telegram bot commands wired to API.
