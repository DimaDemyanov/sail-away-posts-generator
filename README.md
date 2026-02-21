# Sail Away Posts Generator

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
