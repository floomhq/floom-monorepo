# Pitch Coach

Paste one startup pitch, get back exactly three direct critiques, three sharper rewrites, and a one-line TL;DR of the biggest issue.

`main.py` follows the same self-contained Floom demo pattern as the existing Python examples in this repo: JSON in on `argv[1]`, `__FLOOM_RESULT__` JSON out on stdout, plus a baked `sample-cache.json` for instant sample renders.

## Inputs

- `pitch` — one text field, 20-500 characters, enforced server-side.

## Behavior

- One Gemini 3 Pro call only, no search tools, no external fetches.
- Structured JSON output enforced with a response schema.
- Hard request budget is kept under 10 seconds via a single call and an 8.5s HTTP timeout.
- If `GEMINI_API_KEY` is missing, the app returns a deterministic dry-run payload so the demo still renders end-to-end.

## Run locally

```bash
cd examples/pitch-coach
pip install -r requirements.txt

# Dry run
python3 main.py '{"action":"coach","inputs":{"pitch":"We are a platform for AI apps that helps teams ship faster"}}'

# Live run
GEMINI_API_KEY=your-key python3 main.py '{"action":"coach","inputs":{"pitch":"We are a platform for AI apps that helps teams ship faster"}}'
```
