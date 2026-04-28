#!/usr/bin/env python3
"""
Subject Line Scorer -- Floom demo app.

Input:  {"inputs": {"subject": "...", "context": "..."}}
Output: {"score": int, "verdict": str, "issues": [...], "rewrites": [...], "explanation": str,
         "dry_run": bool, "cache_hit": bool, "model": str}

Floom runner contract: stdout last line = __FLOOM_RESULT__{"ok": true, "outputs": {...}}

Single Gemini 2.5 Flash Lite call with response_json_schema. If GEMINI_API_KEY is unset,
returns a deterministic dry-run response so the demo still renders.
"""

from __future__ import annotations

import hashlib
import json
import os
import sys
import time
import traceback
from pathlib import Path
from typing import Any

DEFAULT_MODEL_ID = "gemini-2.5-flash-lite"
HTTP_TIMEOUT_MS = int(os.environ.get("FLOOM_APP_HTTP_TIMEOUT_MS", "10500"))
TOTAL_BUDGET_S = 6.0
MAX_SUBJECT_CHARS = 200
MAX_CONTEXT_CHARS = 500
SAMPLE_CACHE_PATH = Path(__file__).parent / "sample-cache.json"

SYSTEM_PROMPT = """You are an email deliverability and engagement expert who evaluates subject lines.

Be specific and direct. Score based on:
- Curiosity gap: does it make the reader want to know more?
- Clarity: is it instantly clear what the email is about?
- Relevance: does it speak to a real pain or goal?
- Spam signals: ALL CAPS, excessive punctuation, "urgent", "free", "act now"
- Length: 30-50 characters is optimal; flag if too long or too short

Do not praise bad subject lines. Do not be vague. Return only the JSON that matches the schema."""

RESPONSE_JSON_SCHEMA: dict[str, Any] = {
    "type": "object",
    "required": ["score", "verdict", "issues", "rewrites", "explanation"],
    "properties": {
        "score": {
            "type": "integer",
            "minimum": 1,
            "maximum": 10,
            "description": "Open-rate prediction: 1 = terrible, 10 = excellent"
        },
        "verdict": {
            "type": "string",
            "enum": ["weak", "average", "strong"],
            "description": "One-word quality verdict"
        },
        "issues": {
            "type": "array",
            "minItems": 1,
            "maxItems": 3,
            "items": {"type": "string"},
            "description": "Top problems with the subject line"
        },
        "rewrites": {
            "type": "array",
            "minItems": 3,
            "maxItems": 3,
            "items": {
                "type": "object",
                "required": ["angle", "subject"],
                "properties": {
                    "angle": {
                        "type": "string",
                        "enum": ["curiosity", "value", "directness"]
                    },
                    "subject": {"type": "string"}
                }
            },
            "description": "3 stronger rewrites with angle labels"
        },
        "explanation": {
            "type": "string",
            "description": "One sentence explaining the score"
        }
    }
}


def _input_hash(subject: str, context: str) -> str:
    return hashlib.sha256(f"{subject}|{context}".encode()).hexdigest()


def _load_sample_cache() -> dict:
    try:
        return json.loads(SAMPLE_CACHE_PATH.read_text())
    except Exception:
        return {}


def _build_genai():
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        return None
    try:
        from google import genai  # type: ignore
    except ImportError:
        return None
    return genai.Client(api_key=api_key)


def _score_with_gemini(subject: str, context: str, client: Any, model: str) -> dict[str, Any]:
    from google.genai.types import (  # type: ignore
        GenerateContentConfig,
        HttpOptions,
        HttpRetryOptions,
    )

    context_line = f"\nContext about this email: {context}" if context.strip() else ""
    prompt = (
        f"Subject line to evaluate:\n{subject}{context_line}\n\n"
        "Score it 1-10 on open-rate potential.\n"
        "List exactly the top 1-3 specific issues (not vague advice).\n"
        "Write exactly 3 stronger rewrites, one per angle: curiosity, value, directness.\n"
        "Each rewrite must be meaningfully different from the original and from each other."
    )

    config = GenerateContentConfig(
        system_instruction=SYSTEM_PROMPT,
        temperature=0.2,
        response_mime_type="application/json",
        response_json_schema=RESPONSE_JSON_SCHEMA,
        http_options=HttpOptions(
            timeout=HTTP_TIMEOUT_MS,
            retry_options=HttpRetryOptions(attempts=1),
        ),
    )
    response = client.models.generate_content(
        model=model,
        contents=prompt,
        config=config,
    )

    parsed = getattr(response, "parsed", None)
    if isinstance(parsed, dict):
        return parsed
    if hasattr(parsed, "model_dump"):
        return parsed.model_dump()

    text = (response.text or "").strip()
    if not text:
        raise RuntimeError("empty response from Gemini")
    return json.loads(text)


def _dry_run(subject: str) -> dict[str, Any]:
    """Deterministic fallback when GEMINI_API_KEY is missing."""
    word_count = len(subject.split())
    has_spam = any(w in subject.upper() for w in ["URGENT", "ACT NOW", "FREE", "LIMITED", "!!!"])
    is_re_fw = subject.lower().startswith(("re:", "fw:", "fwd:"))

    if has_spam:
        score, verdict = 2, "weak"
        issues = ["Spam trigger words detected", "ALL CAPS reduces deliverability", "No specific value proposition"]
    elif is_re_fw:
        score, verdict = 5, "average"
        issues = ["Re:/Fw: prefix can feel like a trick", "No clear hook for cold email"]
    elif word_count <= 3:
        score, verdict = 4, "weak"
        issues = ["Too short to convey value", "Missing context for the reader"]
    elif word_count >= 12:
        score, verdict = 4, "average"
        issues = ["Too long — likely gets cut off on mobile", "Dilutes the main message"]
    else:
        score, verdict = 6, "average"
        issues = ["Subject is okay but lacks a strong hook"]

    return {
        "score": score,
        "verdict": verdict,
        "issues": issues,
        "rewrites": [
            {"angle": "curiosity", "subject": f"Quick question about {subject[:30]}..."},
            {"angle": "value", "subject": f"How to improve your {subject[:20].lower()} results"},
            {"angle": "directness", "subject": f"{subject[:40]} — 5 min read"},
        ],
        "explanation": "DRY RUN (no GEMINI_API_KEY). Heuristic scoring only; not a real evaluation.",
        "dry_run": True,
        "cache_hit": False,
        "model": "dry-run",
    }


def score(subject: str, context: str = "") -> dict[str, Any]:
    """Score one email subject line."""
    subject = subject.strip()
    context = (context or "").strip()

    if not subject:
        raise ValueError("subject is required")
    if len(subject) > MAX_SUBJECT_CHARS:
        raise ValueError(f"subject too long (max {MAX_SUBJECT_CHARS} chars)")
    if len(context) > MAX_CONTEXT_CHARS:
        context = context[:MAX_CONTEXT_CHARS]

    cache = _load_sample_cache()
    input_hash = _input_hash(subject, context)
    if input_hash in cache:
        cached = dict(cache[input_hash])
        cached["cache_hit"] = True
        cached["dry_run"] = False
        cached.setdefault("model", "sample-fixture (cached)")
        return cached

    client = _build_genai()
    if client is None:
        return _dry_run(subject)

    model = (os.environ.get("GEMINI_MODEL") or DEFAULT_MODEL_ID).strip()
    if not model.startswith(("gemini-2.5", "gemini-3")):
        raise ValueError(f"GEMINI_MODEL must be gemini-2.5.x or gemini-3.x (got '{model}')")

    start = time.monotonic()
    result = _score_with_gemini(subject, context, client, model)
    elapsed = time.monotonic() - start

    if elapsed > TOTAL_BUDGET_S:
        raise RuntimeError(f"exceeded time budget ({elapsed:.1f}s > {TOTAL_BUDGET_S}s)")

    result["dry_run"] = False
    result["cache_hit"] = False
    result["model"] = model
    return result


def main() -> None:
    try:
        if len(sys.argv) < 2:
            raise ValueError("usage: main.py '<json>'")
        payload = json.loads(sys.argv[1])
        inputs = payload.get("inputs", payload)  # support both wrapped and unwrapped
        subject = inputs.get("subject", "")
        context = inputs.get("context", "")
        result = score(subject, context)
        output = {"ok": True, "outputs": result}
    except Exception:
        tb = traceback.format_exc()
        output = {"ok": False, "error": str(sys.exc_info()[1]), "traceback": tb}

    print(f"__FLOOM_RESULT__{json.dumps(output)}")


if __name__ == "__main__":
    main()
