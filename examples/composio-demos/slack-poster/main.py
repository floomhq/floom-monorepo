#!/usr/bin/env python3
"""
Slack Poster — Floom Composio demo app.

Posts a message to a Slack channel via Composio's Slack integration.

Protocol:
  argv[1] JSON: {"action": "post", "inputs": {"channel": "#general", "message": "Hello"}}
  Environment injected by Floom runner:
    COMPOSIO_API_KEY       — Floom's Composio account key
    SLACK_OAUTH_TOKEN      — user's connected Slack workspace entity ID
  stdout last line: __FLOOM_RESULT__{"ok": true, "outputs": {...}}
"""

from __future__ import annotations

import json
import os
import sys


def post_slack_message(entity_id: str, api_key: str, channel: str, message: str) -> dict:
    """Post a message to a Slack channel via Composio SLACK_SENDS_A_MESSAGE action."""
    from composio import ComposioToolSet, Action  # type: ignore

    toolset = ComposioToolSet(api_key=api_key, entity_id=entity_id)
    result = toolset.execute_action(
        action=Action.SLACK_SENDS_A_MESSAGE,
        params={
            "channel": channel.lstrip("#"),
            "text": message,
        },
    )
    if not result.get("successful"):
        raise RuntimeError(f"Composio Slack post failed: {result.get('error')}")

    data = result.get("data", {})
    return {
        "ok": str(data.get("ok", True)),
        "message_ts": str(data.get("ts", "")),
    }


def main() -> None:
    if len(sys.argv) < 2:
        print("__FLOOM_RESULT__" + json.dumps({"ok": False, "error": "missing config arg"}))
        sys.exit(1)

    try:
        config = json.loads(sys.argv[1])
    except json.JSONDecodeError as exc:
        print("__FLOOM_RESULT__" + json.dumps({"ok": False, "error": f"invalid JSON: {exc}"}))
        sys.exit(1)

    inputs = config.get("inputs", {})
    channel = str(inputs.get("channel") or "").strip()
    message = str(inputs.get("message") or "").strip()

    if not channel:
        print("__FLOOM_RESULT__" + json.dumps({"ok": False, "error": "channel is required"}))
        sys.exit(1)
    if not message:
        print("__FLOOM_RESULT__" + json.dumps({"ok": False, "error": "message is required"}))
        sys.exit(1)

    composio_api_key = os.environ.get("COMPOSIO_API_KEY", "")
    slack_entity_id = os.environ.get("SLACK_OAUTH_TOKEN", "")

    if not composio_api_key:
        print("__FLOOM_RESULT__" + json.dumps({"ok": False, "error": "COMPOSIO_API_KEY not set"}))
        sys.exit(1)
    if not slack_entity_id:
        print("__FLOOM_RESULT__" + json.dumps({
            "ok": False,
            "error": "Slack not connected. Use 'floom integrations connect slack' or connect via the dashboard.",
            "code": "integration_required",
            "integration": "slack",
        }))
        sys.exit(1)

    try:
        result = post_slack_message(slack_entity_id, composio_api_key, channel, message)
        print("__FLOOM_RESULT__" + json.dumps({
            "ok": True,
            "outputs": result,
        }))
    except Exception as exc:  # noqa: BLE001
        print("__FLOOM_RESULT__" + json.dumps({"ok": False, "error": str(exc)}))
        sys.exit(1)


if __name__ == "__main__":
    main()
