#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"

export PROD_URL="${PROD_URL:-https://floom.dev}"
export RUN_TIMEOUT_S="${RUN_TIMEOUT_S:-60}"
export POLL_INTERVAL_S="${POLL_INTERVAL_S:-1}"
export REPO_ROOT

exec python3 - <<'PY'
import base64
import http.cookiejar
import json
import os
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

PROD_URL = os.environ["PROD_URL"].rstrip("/")
REPO_ROOT = Path(os.environ["REPO_ROOT"])
RUN_TIMEOUT_S = int(os.environ.get("RUN_TIMEOUT_S", "60"))
POLL_INTERVAL_S = float(os.environ.get("POLL_INTERVAL_S", "1"))
USER_AGENT = "floom-deploy-smoke/1"

cookie_jar = http.cookiejar.CookieJar()
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cookie_jar))


def file_envelope(path: Path, name: str, mime_type: str) -> dict[str, object]:
    raw = path.read_bytes()
    return {
        "__file": True,
        "name": name,
        "mime_type": mime_type,
        "size": len(raw),
        "content_b64": base64.b64encode(raw).decode("ascii"),
    }


def json_request(method: str, url: str, body: dict[str, object] | None = None) -> tuple[int, str, object | None]:
    headers = {
        "accept": "application/json",
        "content-type": "application/json",
        "user-agent": USER_AGENT,
    }
    data = None
    if body is not None:
        data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    raw = ""
    parsed = None
    try:
        with opener.open(req, timeout=30) as resp:
            status = resp.getcode()
            raw = resp.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as exc:
        status = exc.code
        raw = exc.read().decode("utf-8", "replace")
    except Exception as exc:  # noqa: BLE001
        return -1, str(exc), None
    parsed = None
    if raw:
        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError:
            parsed = None
    return status, raw, parsed


def contains_app_unavailable(value: object) -> bool:
    if value is None:
        return False
    return "app_unavailable" in json.dumps(value, sort_keys=True)


def cache_hit_for(slug: str, outputs: object) -> bool:
    if not isinstance(outputs, dict):
        return False
    if slug == "competitor-analyzer":
        meta = outputs.get("meta")
        return isinstance(meta, dict) and meta.get("cache_hit") is True
    return outputs.get("cache_hit") is True


def has_expected_shape(slug: str, outputs: object) -> bool:
    if not isinstance(outputs, dict):
        return False
    if slug == "lead-scorer":
        return isinstance(outputs.get("rows"), list) and isinstance(outputs.get("total"), int)
    if slug == "competitor-analyzer":
        return isinstance(outputs.get("competitors"), list) and isinstance(outputs.get("summary"), str)
    if slug == "resume-screener":
        return isinstance(outputs.get("ranked"), list) and isinstance(outputs.get("summary"), str)
    return False


def post_and_poll(slug: str, payload: dict[str, object]) -> tuple[bool, str]:
    start = time.time()
    run_url = f"{PROD_URL}/api/{slug}/run"
    status, raw, parsed = json_request("POST", run_url, payload)
    if status == -1:
        return False, f"POST transport_error={raw}"
    if status != 200:
        return False, f"POST {status}"
    if contains_app_unavailable(raw):
        return False, "POST payload contained app_unavailable"
    if not isinstance(parsed, dict):
        return False, "POST body was not valid JSON"
    run_id = parsed.get("run_id") or parsed.get("runId") or parsed.get("id")
    if not isinstance(run_id, str) or not run_id:
        return False, "POST body missing run_id"

    deadline = time.time() + RUN_TIMEOUT_S
    last_status = parsed.get("status")
    while time.time() < deadline:
        poll_status, poll_raw, poll_parsed = json_request("GET", f"{PROD_URL}/api/run/{run_id}")
        if poll_status == -1:
            return False, f"poll transport_error={poll_raw}"
        if poll_status != 200:
            return False, f"poll {poll_status}"
        if contains_app_unavailable(poll_raw):
            return False, "run payload contained app_unavailable"
        if not isinstance(poll_parsed, dict):
            return False, "poll body was not valid JSON"
        last_status = poll_parsed.get("status")
        if last_status == "success":
            outputs = poll_parsed.get("outputs")
            if not has_expected_shape(slug, outputs):
                return False, "unexpected output shape"
            if not cache_hit_for(slug, outputs):
                return False, "cache_hit=false"
            elapsed = int((time.time() - start) * 1000)
            return True, f"run={run_id} status=success cache_hit=true elapsed={elapsed}ms"
        if last_status in {"error", "cancelled"}:
            error_type = poll_parsed.get("error_type") or "unknown"
            error = poll_parsed.get("error") or "unknown"
            return False, f"run status={last_status} error_type={error_type} error={error}"
        time.sleep(POLL_INTERVAL_S)
    return False, f"timeout waiting for terminal run status (last_status={last_status})"


lead_csv = REPO_ROOT / "apps" / "web" / "public" / "examples" / "lead-scorer" / "sample-leads.csv"
resume_zip = REPO_ROOT / "apps" / "web" / "public" / "examples" / "resume-screener" / "sample-cvs.zip"

if not lead_csv.is_file():
    print(f"[FAIL] lead-scorer fixture missing: {lead_csv}", flush=True)
    print("Summary: pass=0 fail=1 skip=0", flush=True)
    sys.exit(1)

payloads: list[tuple[str, dict[str, object] | None]] = [
    (
        "lead-scorer",
        {
            "action": "score",
            "inputs": {
                "data": file_envelope(lead_csv, "sample-leads.csv", "text/csv"),
                "icp": (
                    "B2B SaaS CFOs at 100-500 employee fintechs in EU. "
                    "Looking for finance leaders at growth-stage companies "
                    "with recent funding or hiring signals."
                ),
            },
        },
    ),
    (
        "competitor-analyzer",
        {
            "action": "analyze",
            "inputs": {
                "urls": [
                    "https://linear.app",
                    "https://notion.so",
                    "https://asana.com",
                ],
                "your_product": (
                    "We sell B2B sales automation software to EU mid-market teams. "
                    "AI-native, usage-based pricing, integrates with Salesforce and HubSpot."
                ),
            },
        },
    ),
    (
        "resume-screener",
        None
        if not resume_zip.is_file()
        else {
            "action": "screen",
            "inputs": {
                "cvs_zip": file_envelope(resume_zip, "sample-cvs.zip", "application/zip"),
                "job_description": (
                    "Senior Backend Engineer (Remote EU). 5+ years building production Python services.\n"
                    "Responsibilities: own the ingestion pipeline, design the scoring model, mentor two\n"
                    "engineers. Stack: Python 3.12, FastAPI, Postgres, Redis, AWS. Nice-to-have: past\n"
                    "experience with LLM products or high-throughput ETL."
                ),
                "must_haves": (
                    "5+ years Python\n"
                    "Production Postgres experience\n"
                    "Remote-friendly timezone (UTC-3 to UTC+3)"
                ),
            },
        },
    ),
]

passed = 0
failed = 0
skipped = 0

for slug, payload in payloads:
    if payload is None:
        skipped += 1
        print(f"[SKIP] {slug} fixture unavailable in CI", flush=True)
        continue
    ok, detail = post_and_poll(slug, payload)
    if ok:
        passed += 1
        print(f"[PASS] {slug} {detail}", flush=True)
    else:
        failed += 1
        print(f"[FAIL] {slug} {detail}", flush=True)

print(f"Summary: pass={passed} fail={failed} skip={skipped}", flush=True)
sys.exit(0 if failed == 0 else 1)
PY
