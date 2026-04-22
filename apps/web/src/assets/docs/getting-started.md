# Getting started

Floom is a **protocol + runtime for agentic work**. You describe what a task needs - inputs, secrets, output shape - in one file, and Floom gives you a web form, an MCP tool for agents, and an HTTP endpoint. Same app, three surfaces.

This page gets you from zero to a running app in two steps: run one, then publish one.

## Run your first app (30 seconds)

Open [floom.dev/apps/lead-scorer](https://floom.dev/apps/lead-scorer). Fill in a CSV of leads and a one-line ICP description. Hit **Run**.

That's it. You just used a Floom hosted app - a Python script running in a sandboxed container, calling Gemini with web search, returning a ranked table. Five free runs per IP per 24 hours on Floom's key; after that you paste your own Gemini key. See [Limits](./limits).

Other launch apps you can try right now:

- [competitor-analyzer](https://floom.dev/apps/competitor-analyzer) - feature + pricing comparison across 3-10 competitors.
- [resume-screener](https://floom.dev/apps/resume-screener) - rank a zip of PDF CVs against a job description.
- [jwt-decode](https://floom.dev/apps/jwt-decode), [json-format](https://floom.dev/apps/json-format), [uuid](https://floom.dev/apps/uuid), [password](https://floom.dev/apps/password) - zero-click utilities, no keys needed.

Every app has a permalink (`floom.dev/p/<slug>`), an MCP server (`floom.dev/mcp/app/<slug>`), and an HTTP endpoint (`floom.dev/api/<slug>/run`). See [Protocol](./protocol).

## Publish your first app (5 minutes)

You have two starting points: a public API with an OpenAPI spec, or a GitHub repo with code + a `floom.yaml`.

### Option A. Wrap an existing API (proxied)

If the service you want to expose already publishes an OpenAPI spec, Floom wraps it. No code to write.

1. Go to [floom.dev/studio/build](https://floom.dev/studio/build).
2. Paste the spec URL, for example:
   ```
   https://raw.githubusercontent.com/resend/resend-openapi/main/resend.yaml
   ```
3. Hit **Detect**. Floom scans the spec, lists the operations, generates a form per operation.
4. Paste the service's API key into the **Secrets** tab. Floom encrypts it per-user and injects it at run time. You never ship keys to the browser.
5. Hit **Publish**. Done. You get a `floom.dev/p/<slug>` URL to share.

### Option B. Ship your own code (hosted)

Write a Python or Node script. Declare its inputs + outputs + secrets in a `floom.yaml`. Push to a public GitHub repo. Paste the repo URL into `/studio/build` and Floom does the rest - auto-detects the runtime, builds a container, smoke-tests the entrypoint, publishes.

Minimum repo layout:

```
my-app/
├── floom.yaml         # manifest: name, action, inputs, outputs, secrets
├── main.py            # your code
└── requirements.txt   # deps
```

Minimum `floom.yaml`:

```yaml
name: My App
slug: my-app
description: What it does, one sentence.
runtime: python
python_dependencies:
  - requests==2.32.0
secrets_needed:
  - MY_API_KEY
actions:
  run:
    label: Run
    inputs:
      - name: query
        type: textarea
        required: true
    outputs:
      - name: result
        type: markdown
manifest_version: "2.0"
```

Your script reads the run config from `argv[1]`, does its work, and prints one line starting with `__FLOOM_RESULT__`. That's the protocol. Full shape on the [Protocol](./protocol) page.

Working examples in the monorepo: [lead-scorer](https://github.com/floomhq/floom/tree/main/examples/lead-scorer), [competitor-analyzer](https://github.com/floomhq/floom/tree/main/examples/competitor-analyzer), [resume-screener](https://github.com/floomhq/floom/tree/main/examples/resume-screener).

## Share the result

Every run has a public permalink at `floom.dev/r/<run_id>`. Drop it in Slack, a PR comment, anywhere. The reader sees the same inputs and outputs you saw. No login needed for public apps.

## Where to go next

- **[Protocol](./protocol)** - what's in `floom.yaml`, the `__FLOOM_RESULT__` output contract, file uploads, HTTP/MCP surface.
- **[Deploy](./deploy)** - GitHub import vs proxied, publishing states, self-host via Docker.
- **[Limits](./limits)** - hard numbers for runtime, memory, file size, rate limits, BYOK.
