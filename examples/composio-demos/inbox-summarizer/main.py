#!/usr/bin/env python3
"""
Inbox Summarizer — Floom Composio demo app.

Reads recent unread Gmail messages via Composio, summarizes them with Gemini,
and returns a markdown digest.

Protocol:
  argv[1] JSON: {"action": "summarize", "inputs": {"max_emails": 10}}
  Environment injected by Floom runner:
    COMPOSIO_API_KEY       — Floom's Composio account key
    GMAIL_OAUTH_TOKEN      — user's connected Gmail account ID (Composio entity ID)
    GEMINI_API_KEY         — for Gemini summarization
  stdout last line: __FLOOM_RESULT__{"ok": true, "outputs": {...}}
"""

from __future__ import annotations

import json
import os
import sys


def fetch_emails(entity_id: str, api_key: str, max_emails: int) -> list[dict]:
    """Fetch recent unread Gmail messages via Composio GMAIL_FETCH_EMAILS action."""
    from composio import ComposioToolSet, Action  # type: ignore

    toolset = ComposioToolSet(api_key=api_key, entity_id=entity_id)
    result = toolset.execute_action(
        action=Action.GMAIL_FETCH_EMAILS,
        params={
            "max_results": min(max_emails, 50),
            "query": "is:unread",
            "include_attachments": False,
        },
    )
    if not result.get("successful"):
        raise RuntimeError(f"Composio Gmail fetch failed: {result.get('error')}")

    emails = result.get("data", {}).get("messages", [])
    return emails or []


def summarize_emails(emails: list[dict], api_key: str) -> str:
    """Summarize a list of email dicts with Gemini."""
    if not emails:
        return "Your inbox is empty (no unread emails found)."

    from google import genai  # type: ignore
    from google.genai import types  # type: ignore

    # Build a compact text representation for the prompt.
    items = []
    for i, msg in enumerate(emails[:50], 1):
        subject = msg.get("subject") or "(no subject)"
        sender = msg.get("from") or "unknown"
        snippet = msg.get("snippet") or msg.get("body_plain", "")[:300]
        items.append(f"{i}. From: {sender}\n   Subject: {subject}\n   Preview: {snippet}")

    email_text = "\n\n".join(items)
    prompt = (
        "You are a helpful email assistant. Summarize the following unread emails "
        "into a concise markdown digest. Group related threads, highlight action items, "
        "and flag anything urgent. Be brief but complete.\n\n"
        f"EMAILS:\n{email_text}"
    )

    client = genai.Client(api_key=api_key)
    response = client.models.generate_content(
        model="gemini-2.5-flash-lite",
        contents=prompt,
        config=types.GenerateContentConfig(
            response_mime_type="text/plain",
            max_output_tokens=2048,
        ),
    )
    return response.text or "No summary generated."


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
    max_emails = int(inputs.get("max_emails") or 10)

    composio_api_key = os.environ.get("COMPOSIO_API_KEY", "")
    gmail_entity_id = os.environ.get("GMAIL_OAUTH_TOKEN", "")
    gemini_api_key = os.environ.get("GEMINI_API_KEY", "")

    if not composio_api_key:
        print("__FLOOM_RESULT__" + json.dumps({"ok": False, "error": "COMPOSIO_API_KEY not set"}))
        sys.exit(1)
    if not gmail_entity_id:
        print("__FLOOM_RESULT__" + json.dumps({
            "ok": False,
            "error": "Gmail not connected. Use 'floom integrations connect gmail' or connect via the dashboard.",
            "code": "integration_required",
            "integration": "gmail",
        }))
        sys.exit(1)

    try:
        emails = fetch_emails(gmail_entity_id, composio_api_key, max_emails)
        summary = summarize_emails(emails, gemini_api_key) if gemini_api_key else _plain_summary(emails)
        print("__FLOOM_RESULT__" + json.dumps({
            "ok": True,
            "outputs": {
                "summary": summary,
                "email_count": len(emails),
            },
        }))
    except Exception as exc:  # noqa: BLE001
        print("__FLOOM_RESULT__" + json.dumps({"ok": False, "error": str(exc)}))
        sys.exit(1)


def _plain_summary(emails: list[dict]) -> str:
    """Fallback summary without Gemini — plain text list."""
    if not emails:
        return "No unread emails found."
    lines = [f"**{len(emails)} unread email(s):**\n"]
    for msg in emails:
        subject = msg.get("subject") or "(no subject)"
        sender = msg.get("from") or "unknown"
        lines.append(f"- **{subject}** from {sender}")
    return "\n".join(lines)


if __name__ == "__main__":
    main()
