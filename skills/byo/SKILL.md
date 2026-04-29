---
name: floomit-byo
description: Deploy a local Floom app through user-owned Supabase, Vercel, and E2B accounts. Use when the user says "/floomit deploy", "BYO deploy", "deploy with my own Supabase/Vercel/E2B", or asks to ship a repo with runtime.byo in floom.yaml.
---

# Floom BYO Deploy

This skill is a conversational wrapper over the Floom CLI `byo-deploy` command.
It leaves `skills/floom/SKILL.md` untouched because regular Floom Cloud deploys
and BYO deploys have different ownership and auth boundaries.

## When To Use

Use this for `/floomit deploy <path>` or any request to deploy a repo using the
user's own Supabase, Vercel, and E2B accounts.

Use the regular Floom skill for `floom deploy`, proxied OpenAPI apps, Floom
Cloud-owned runtime, or existing Hub/app management flows.

## Preconditions

1. Work from the target repo or pass its path explicitly.
2. Confirm the repo has `floom.yaml`.
3. Confirm `floom.yaml` includes:

```yaml
runtime:
  byo:
    database:
      provider: supabase
    hosting:
      provider: vercel
    sandbox:
      provider: e2b
```

4. Never ask for provider secrets in chat. The CLI uses API-token prompts in
v1 and stores tokens at `~/.floom/byo-tokens.json` mode `0600`. OAuth flow
ships in v1.1 once Floom registers OAuth apps with each vendor.

## Command

```bash
npx @floomhq/cli@^1 byo-deploy <repo-path>
```

For local development inside this monorepo:

```bash
node cli-npm/dist/index.js byo-deploy <repo-path>
```

## Flow

1. Tell the user the CLI will connect one provider at a time.
2. Run the command.
3. Let the user complete each API-key prompt locally.
4. Return only the verified output from the CLI:

```text
Web: https://...
MCP: https://.../mcp
REST: POST https://.../api/<action>
CLI: floom run <slug>
Stored: postgresql://...
```

## Troubleshooting

- `runtime.byo is missing`: use the regular Floom skill or add the BYO runtime block.
- `missing FLOOM_BYO_*_TOKEN` in non-interactive mode: rerun interactively or set provider tokens for replay/CI.
- Provider HTTP errors: quote the provider, HTTP status, and response body from the CLI output; do not invent a fix.
