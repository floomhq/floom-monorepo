#!/usr/bin/env python3
"""
TOS Red Flag Scanner -- Floom demo app.

Input:  {"inputs": {"text": "...", "source": "..."}}
Output: {"red_flags": [...], "risk_level": str, "plain_english_summary": str,
         "red_flag_count": int, "dry_run": bool, "cache_hit": bool, "model": str}

Floom runner contract: stdout last line = __FLOOM_RESULT__{"ok": true, "outputs": {...}}

Single Gemini 2.5 Flash Lite call with response_json_schema. Falls back to deterministic
dry-run if GEMINI_API_KEY is missing.
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
TOTAL_BUDGET_S = 10.0
MAX_TEXT_CHARS = 10_000
MAX_SOURCE_CHARS = 100
SAMPLE_CACHE_PATH = Path(__file__).parent / "sample-cache.json"

SYSTEM_PROMPT = """You are a privacy and contract law expert who finds problematic clauses in Terms of Service.

Focus on clauses that actually affect the user negatively:
- Data sharing with third parties without explicit consent
- Binding arbitration / class-action waivers
- Broad termination rights (any time, without notice)
- IP ownership grabs (especially user-generated content)
- Auto-renewal traps
- Liability limitations that expose the user
- AI training data clauses

Be specific — quote the actual clause. Explain it in plain English a non-lawyer can understand.
Do NOT flag standard boilerplate that is harmless (e.g. "we may update these terms with notice").
Return only the JSON that matches the provided schema."""

RESPONSE_JSON_SCHEMA: dict[str, Any] = {
    "type": "object",
    "required": ["red_flags", "risk_level", "plain_english_summary", "red_flag_count"],
    "properties": {
        "red_flags": {
            "type": "array",
            "items": {
                "type": "object",
                "required": ["clause", "risk_type", "plain_english", "severity"],
                "properties": {
                    "clause": {"type": "string"},
                    "risk_type": {
                        "type": "string",
                        "enum": ["data-sharing", "arbitration", "termination", "auto-renewal",
                                 "liability", "ip-ownership", "ai-training", "other"]
                    },
                    "plain_english": {"type": "string"},
                    "severity": {"type": "string", "enum": ["low", "medium", "high"]}
                }
            }
        },
        "risk_level": {
            "type": "string",
            "enum": ["low", "medium", "high"]
        },
        "plain_english_summary": {"type": "string"},
        "red_flag_count": {"type": "integer", "minimum": 0}
    }
}


def _input_hash(text: str, source: str) -> str:
    return hashlib.sha256(f"{text[:500]}|{source}".encode()).hexdigest()


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


def _scan_with_gemini(text: str, source: str, client: Any, model: str) -> dict[str, Any]:
    from google.genai.types import (  # type: ignore
        GenerateContentConfig,
        HttpOptions,
        HttpRetryOptions,
    )

    source_line = f"\nService name: {source}" if source.strip() else ""
    prompt = (
        f"Terms of Service to analyze:{source_line}\n\n{text}\n\n"
        "Find the 3-7 most concerning clauses for a typical user.\n"
        "Quote each clause exactly, classify the risk type, and explain in plain English.\n"
        "For the plain_english summary, lead with the single most important thing to know."
    )

    config = GenerateContentConfig(
        system_instruction=SYSTEM_PROMPT,
        temperature=0.1,
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

    text_response = (response.text or "").strip()
    if not text_response:
        raise RuntimeError("empty response from Gemini")
    return json.loads(text_response)


def _dry_run(text: str) -> dict[str, Any]:
    """Deterministic fallback when GEMINI_API_KEY is missing."""
    lower = text.lower()
    flags = []

    if "share" in lower and ("third part" in lower or "partner" in lower):
        flags.append({
            "clause": text[:100] + "...",
            "risk_type": "data-sharing",
            "plain_english": "Your data may be shared with other companies for commercial purposes.",
            "severity": "high"
        })
    if "arbitration" in lower or "waive" in lower:
        flags.append({
            "clause": text[:100] + "...",
            "risk_type": "arbitration",
            "plain_english": "You give up your right to sue in court or join a class action.",
            "severity": "high"
        })
    if "terminate" in lower or "any reason" in lower:
        flags.append({
            "clause": text[:100] + "...",
            "risk_type": "termination",
            "plain_english": "They can close your account at any time without warning.",
            "severity": "medium"
        })
    if "train" in lower and ("model" in lower or "ai" in lower):
        flags.append({
            "clause": text[:100] + "...",
            "risk_type": "ai-training",
            "plain_english": "Your content may be used to train AI systems.",
            "severity": "medium"
        })

    if not flags:
        flags.append({
            "clause": text[:80] + "...",
            "risk_type": "other",
            "plain_english": "DRY RUN (no GEMINI_API_KEY). This is a placeholder analysis.",
            "severity": "low"
        })

    risk_level = "high" if any(f["severity"] == "high" for f in flags) else "medium" if flags else "low"

    return {
        "red_flags": flags,
        "risk_level": risk_level,
        "plain_english_summary": "DRY RUN (no GEMINI_API_KEY). Heuristic scan only; not a real legal analysis.",
        "red_flag_count": len(flags),
        "dry_run": True,
        "cache_hit": False,
        "model": "dry-run",
    }


def scan(text: str, source: str = "") -> dict[str, Any]:
    """Scan TOS text for red flags."""
    text = text.strip()
    source = (source or "").strip()

    if not text:
        raise ValueError("text is required")
    if len(text) > MAX_TEXT_CHARS:
        raise ValueError(f"text too long (max {MAX_TEXT_CHARS} chars)")
    if len(source) > MAX_SOURCE_CHARS:
        source = source[:MAX_SOURCE_CHARS]

    cache = _load_sample_cache()
    input_hash = _input_hash(text, source)
    if input_hash in cache:
        cached = dict(cache[input_hash])
        cached["cache_hit"] = True
        cached["dry_run"] = False
        cached.setdefault("model", "sample-fixture (cached)")
        return cached

    client = _build_genai()
    if client is None:
        return _dry_run(text)

    model = (os.environ.get("GEMINI_MODEL") or DEFAULT_MODEL_ID).strip()
    if not model.startswith(("gemini-2.5", "gemini-3")):
        raise ValueError(f"GEMINI_MODEL must be gemini-2.5.x or gemini-3.x (got '{model}')")

    start = time.monotonic()
    result = _scan_with_gemini(text, source, client, model)
    elapsed = time.monotonic() - start

    if elapsed > TOTAL_BUDGET_S:
        raise RuntimeError(f"exceeded time budget ({elapsed:.1f}s > {TOTAL_BUDGET_S}s)")

    result["dry_run"] = False
    result["cache_hit"] = False
    result["model"] = model
    result.setdefault("red_flag_count", len(result.get("red_flags", [])))
    return result


def main() -> None:
    try:
        if len(sys.argv) < 2:
            raise ValueError("usage: main.py '<json>'")
        payload = json.loads(sys.argv[1])
        inputs = payload.get("inputs", payload)
        text = inputs.get("text", "")
        source = inputs.get("source", "")
        result = scan(text, source)
        output = {"ok": True, "outputs": result}
    except Exception:
        tb = traceback.format_exc()
        output = {"ok": False, "error": str(sys.exc_info()[1]), "traceback": tb}

    print(f"__FLOOM_RESULT__{json.dumps(output)}")


if __name__ == "__main__":
    main()
