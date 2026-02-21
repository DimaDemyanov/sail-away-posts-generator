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
1. `POST /reindex` to load JSON history from `./history`
2. `GET /plan/next10` to get the first 10-post plan

Example:
```bash
curl -X POST http://localhost:3000/reindex
curl http://localhost:3000/plan/next10
```

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
