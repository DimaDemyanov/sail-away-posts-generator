# Sail Away Posts Generator

TypeScript monorepo for Telegram content planning and drafting based on channel history JSON files.

## Apps
- `apps/api`: queue and draft API
- `apps/bot`: Telegram bot interface
- `packages/core`: RAG, history loading, planning/drafting logic

## History Source
Project reads JSON files from:
```text
history/
  own-channel/
    *.json
  similar/
    *.json
```

## Run
```bash
npm install
npm run dev:api:env
npm run dev:bot:env
```

## API (current)
- `GET /queue/next10` -> generate queue for next 10 weeks
- `GET /queue/latest` -> get latest saved queue
- `POST /queue/replace` -> replace all 10 topics
- `POST /queue/swap` -> swap two queue positions
- `POST /draft` -> generate draft by `queueItem` (1..10) or by `topic`

Backward-compatible aliases:
- `GET /plan/next10` -> alias to `/queue/next10`
- `GET /plan/latest` -> alias to `/queue/latest`

### Example requests
```bash
curl http://localhost:3000/queue/next10
curl http://localhost:3000/queue/latest
curl -X POST http://localhost:3000/queue/swap \
  -H "content-type: application/json" \
  -d '{"from":2,"to":5}'
curl -X POST http://localhost:3000/draft \
  -H "content-type: application/json" \
  -d '{"queueItem":1}'
```

## Bot Commands
- `/queue10` -> generate queue for 10 weeks
- `/queuelatest` -> show latest queue
- `/draft <1..10>` -> generate draft for queue item
- `/replaceposts` -> enter mode to send 10 topics (one message)
- `/swapposts <from> <to>` -> swap queue items

Aliases:
- `/plan10` -> `/queue10`
- `/planlatest` -> `/queuelatest`

## Weekly Auto-Publish
Bot auto-sends a new 10-week queue every Sunday.

Related env vars:
- `BOT_TIMEZONE` (default `Europe/Moscow`)
- `WEEKLY_POST_HOUR` (default `9`)
- `WEEKLY_POST_MINUTE` (default `0`)
- `TELEGRAM_TARGET_CHAT_ID` (optional; if empty, sends to admin IDs)

## Required env vars
- `OPENAI_API_KEY`
- `OPENAI_MODEL` (e.g. `gpt-5-mini`)
- `OPENAI_EMBEDDING_MODEL`
- `API_PORT`
- `TELEGRAM_BOT_TOKEN`
- `ADMIN_TELEGRAM_IDS`
- `API_BASE_URL`
