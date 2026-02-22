# Sail Away Posts Generator

## Repository Status
This repository is being migrated to a TypeScript monorepo architecture:
- `apps/api`
- `apps/worker`
- `apps/bot`
- `packages/core`

## API MVP
Run API locally:
```bash
npm run dev:api
```

Then:
1. History is indexed automatically on API startup from `./history`
2. `GET /plan/next10` to get the first 10-post plan
3. `GET /plan/latest` to get the last saved plan
4. `POST /draft` to generate post text + image options

`GET /plan/next10` works in two modes:
- `rag` (when `OPENAI_API_KEY` is set)
- `heuristic` (fallback when API key is not set)

Example:
```bash
curl http://localhost:3000/plan/next10
curl http://localhost:3000/plan/latest
curl -X POST http://localhost:3000/draft \
  -H "content-type: application/json" \
  -d '{"planItem":1,"planId":"<planId-from-plan-next10>"}'
```

## Telegram Bot MVP
Required env vars:
```bash
TELEGRAM_BOT_TOKEN=...
ADMIN_TELEGRAM_IDS=123456789,987654321
API_BASE_URL=http://localhost:3000
```

Run:
```bash
npm run dev:bot
```

Commands:
- `/plan10`
- `/draft <1..10>`

Lightweight project for generating "Sail Away" themed social media posts.

## Features
- Generate posts for `instagram`, `x`, `facebook`, and `linkedin`
- Choose tone: `inspiring`, `casual`, `luxury`, `adventure`
- Add optional CTA and hashtag controls
- Includes CLI + tests

## Quick Start
```bash
cd sail-away-posts-generator
python3 -m sail_away_posts.cli --platform instagram --tone inspiring --destination Santorini
```

## Install (optional editable mode)
```bash
pip install -e .
```

Then run:
```bash
sail-away-post --platform x --tone adventure --destination Bali --cta "Book your cabin now"
```

## CLI Options
```bash
python3 -m sail_away_posts.cli --help
```

Main flags:
- `--platform`: instagram|x|facebook|linkedin
- `--tone`: inspiring|casual|luxury|adventure
- `--destination`: destination or campaign focus
- `--cta`: optional call-to-action
- `--hashtags`: max hashtags (default: 4)

## Run Tests
```bash
python3 -m unittest discover -s tests -p "test_*.py"
```
