# Slack Poster

Floom demo app: connects Slack via Composio and posts messages to channels.

## What it does

1. User connects Slack via Floom's integration flow (one-time OAuth, no API keys to manage)
2. App posts a message to the specified channel via Composio's Slack action

## Integration required

Manifest declares `integrations: [composio: slack]`. Floom injects:
- `COMPOSIO_API_KEY` — Floom's Composio account key
- `SLACK_OAUTH_TOKEN` — user's connected Slack workspace entity ID

## Local dev

```bash
# Requires COMPOSIO_API_KEY + SLACK_OAUTH_TOKEN from a connected account
docker build -t slack-poster .
docker run --rm \
  -e COMPOSIO_API_KEY=your_key \
  -e SLACK_OAUTH_TOKEN=your_entity_id \
  slack-poster \
  '{"action":"post","inputs":{"channel":"#general","message":"Hello from Floom!"}}'
```
