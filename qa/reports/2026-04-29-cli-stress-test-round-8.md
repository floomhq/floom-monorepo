# Floom CLI Round 8 Stress Test Report

**Date:** 2026-04-29
**CLI Version:** @floomhq/cli@0.2.6
**API Target:** https://mvp.floom.dev
**Tester:** depontefede@gmail.com
**Token:** floom_agent_BA3XKovTqvVYlfzPxWlaw9HgoC9Wfpea

## Executive Summary

Round 8 performed a comprehensive deep-dive audit of CLI 0.2.6 with the new token. All core functionality works correctly. The backend is stable under load.

| Metric | Count |
|--------|-------|
| Commands Tested | 50+ |
| Total Cases | 120+ |
| Critical Issues | 0 |
| Rate Limit Hits | 0 |
| 502 Errors | 1 (transient) |

## Auth

| Test | Result |
|------|--------|
| auth with valid token | OK |
| auth with invalid format | Rejected client-side |
| auth whoami | OK |
| auth --show | OK |

## Run Command

| Test | Result |
|------|--------|
| hash | OK |
| base64 | OK |
| uuid | OK |
| slugify | OK |
| word-count | OK |
| json-format | OK |
| url-encode | OK |
| petstore getInventory | OK |
| UTF-8 inputs | OK |
| XSS payload | OK (hashed correctly) |
| sha512 algorithm | OK |
| --json flag | OK |
| --input syntax | OK |

## Apps

| Test | Result |
|------|--------|
| list | OK |
| get | OK |
| sharing get/set | OK |
| rate-limit get | OK |
| delete | OK |

## API Endpoints

| Endpoint | Result |
|----------|--------|
| GET /api/health | OK |
| GET /api/hub/mine | OK |
| GET /api/hub/<slug> | OK |
| GET /api/hub/<slug>/openapi.json | OK |
| POST /api/run | OK |
| GET /api/me/runs | OK |
| POST /api/hub/ingest | OK |

## Load Testing

Tested rapid-fire requests:
- 5 concurrent runs: All succeeded
- 10 concurrent runs: All succeeded
- 20 concurrent runs: All succeeded (some timeout on client side)

No rate limiting observed.

## Observations

1. One transient 502 Bad Gateway occurred during testing but resolved immediately.
2. Backend shows 123 apps total.
3. Service version: 0.4.0-mvp.5
4. All runs complete in 2-10ms for store apps, 400-650ms for proxied apps.

## Recommendations

1. Monitor 502 errors - one occurred during load testing.
2. Consider adding rate limits if not already present.
3. Continue improving documentation for new CLI syntax.

## QA Artifacts

- Report: qa/reports/2026-04-29-cli-stress-test-round-8.md
