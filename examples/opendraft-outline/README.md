# OpenDraft (Outline Preview)

A Floom preview wrapper for [federicodeponte/opendraft](https://github.com/federicodeponte/opendraft) — the open-source AI thesis writer.

**Full engine:** 19 specialized agents, verified citations from 250M+ academic papers (Crossref, OpenAlex, Semantic Scholar), 20,000-word draft in ~10 minutes.

**This Floom app:** one Gemini call, thesis outline + sample search terms in under 8 seconds.

## What it does

Takes a research question (and optional discipline + target length) and returns:

- `working_title` — a precise, specific academic title
- `thesis_statement` — one-sentence central argument
- `outline` — 5–9 sections, each with headings, 3–5 key points, and suggested citation count
- `sample_search_terms` — 3–5 Boolean/keyword phrases to paste into Crossref or OpenAlex
- `next_step_cta` — deep-link back to the full engine

## Setup

```bash
export GEMINI_API_KEY=your_key_here
node examples/opendraft-outline/server.mjs
# Listening on http://localhost:4240
```

## Example call

```bash
curl -s -X POST http://localhost:4240/opendraft-outline/run \
  -H 'Content-Type: application/json' \
  -d '{
    "research_question": "How does aerosol cloud seeding affect regional precipitation patterns?",
    "discipline": "atmospheric physics",
    "target_length": "medium"
  }' | tee examples/opendraft-outline/test-output.json
```

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Health check |
| `GET` | `/openapi.json` | OpenAPI 3.0 spec |
| `POST` | `/opendraft-outline/run` | Generate outline |

## Inputs

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `research_question` | string | yes | 10–300 chars |
| `discipline` | string | no | e.g. "behavioral economics" |
| `target_length` | `short`\|`medium`\|`long` | no | default `medium` |

## Links

- Full engine: https://github.com/federicodeponte/opendraft
- Live demo: https://opendraft.xyz

## Reverse-funnel strategy

This app is the wedge for the OpenDraft audience. The opendraft README will carry a "Run on Floom" badge pointing here. Users who run the outline preview see the full-engine CTA in every response body, closing the loop back to the open-source repo.

### Suggested badge for the OpenDraft README

```markdown
[![Run outline preview on Floom](https://img.shields.io/badge/Run%20on%20Floom-outline%20preview-22c55e?style=flat-square)](https://floom.dev/run/opendraft-outline)
```
