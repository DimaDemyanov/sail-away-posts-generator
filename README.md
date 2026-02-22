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
- `GET /queue/suggest10` -> suggest 10 new topics (without replacing saved queue)
- `GET /queue/next10` -> generate and save queue for next 10 weeks
- `GET /queue/latest` -> get latest saved queue
- `POST /queue/replace` -> replace all 10 topics
- `POST /queue/swap` -> swap two queue positions
- `POST /draft` -> generate draft by `queueItem` (1..10) or by `topic`

### Example requests
```bash
curl http://localhost:3000/queue/suggest10
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
- `/queuesuggest` -> suggest 10 new topics (queue is not replaced)
- `/queue` -> show current posts queue (without dates)
- `/schedule` -> show queue schedule with week dates
- `/draft <index>` -> generate draft for queue item
- `/replaceposts` -> update topics list with any number of topics
- `/addtopic <тема>` -> add one topic to the end of queue
- `/swapposts <from> <to>` -> swap queue items

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
