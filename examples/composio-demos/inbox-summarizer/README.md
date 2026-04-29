# Inbox Summarizer

Floom demo app: connects Gmail via Composio and returns an AI summary of recent unread emails.

## What it does

1. User connects Gmail via Floom's integration flow (one-time OAuth, no API keys to manage)
2. App fetches up to N recent unread emails via Composio's Gmail action
3. Gemini summarizes them into a markdown digest grouped by sender/thread

## Integration required

Manifest declares `integrations: [composio: gmail]`. Floom injects:
- `COMPOSIO_API_KEY` — Floom's Composio account key
- `GMAIL_OAUTH_TOKEN` — user's connected Gmail entity ID

## Local dev

```bash
# Requires COMPOSIO_API_KEY + GMAIL_OAUTH_TOKEN from a connected account
docker build -t inbox-summarizer .
docker run --rm \
  -e COMPOSIO_API_KEY=your_key \
  -e GMAIL_OAUTH_TOKEN=your_entity_id \
  -e GEMINI_API_KEY=your_gemini_key \
  inbox-summarizer \
  '{"action":"summarize","inputs":{"max_emails":5}}'
```
