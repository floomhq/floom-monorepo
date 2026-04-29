# Examples

Real apps shipping on Floom today. Each one is a single manifest plus code — clone, read, or run.

Pick the shape closest to what you're building, copy its `floom.yaml`, swap the logic.

## Competitor lens

Paste two URLs (yours plus one competitor). Floom fetches both pages and one Gemini call returns a positioning, pricing, and angle diff.

- **Shape**: web-fetch + LLM, JSON in, JSON out.
- **Use for**: GTM research, positioning audits, sales battlecards.
- **Run it**: [`/p/competitor-lens`](/p/competitor-lens)
- **Source**: [`examples/competitor-lens/`](https://github.com/floomhq/floom/tree/main/examples/competitor-lens)

```bash
floom run competitor-lens '{"yours":"https://example.com","theirs":"https://stripe.com"}'
# or:
floom run competitor-lens --input yours=https://example.com --input theirs=https://stripe.com
```

## AI readiness audit

Paste one HTTPS URL. Floom fetches the landing page and a single Gemini call returns a readiness score 0-10, three risks, three opportunities, and one next action.

- **Shape**: single web fetch, LLM-scored JSON output.
- **Use for**: site audits, sales-ops scoring, inbound triage.
- **Run it**: [`/p/ai-readiness-audit`](/p/ai-readiness-audit)
- **Source**: [`examples/ai-readiness-audit/`](https://github.com/floomhq/floom/tree/main/examples/ai-readiness-audit)

```bash
floom run ai-readiness-audit --input url=https://stripe.com
```

## Pitch coach

Paste a 20-500 character startup pitch. A single Gemini call returns three direct critiques, three angle-specific rewrites, and a 1-line TL;DR of the biggest issue.

- **Shape**: text-in, structured-JSON-out, LLM-only.
- **Use for**: pitch reviews, copy critique, founder coaching.
- **Run it**: [`/p/pitch-coach`](/p/pitch-coach)
- **Source**: [`examples/pitch-coach/`](https://github.com/floomhq/floom/tree/main/examples/pitch-coach)

```bash
floom run pitch-coach '{"pitch":"We are building..."}'
```

## More examples

The `examples/` directory in the repo has more shapes to copy from:

- **JWT decode** — zero-auth utility app (no API key needed).
- **UUID generator** — simplest possible manifest, one action, no inputs.
- **JSON format** — fast utility, showcases `renderer: json`.
- **Password generator** — minimal manifest, anon-runnable.

See [github.com/floomhq/floom/tree/main/examples](https://github.com/floomhq/floom/tree/main/examples) for the full list.

## Next

- [Quickstart](/docs/quickstart) — write your own from scratch in 5 minutes.
- [Manifest reference](/docs/runtime-specs) — every field explained.
- [Install in Claude](/docs/mcp-install) — use these examples from your agent.
