# @floomhq/cli

One command to set up Floom: mints a token, configures MCP, and you're live.

## Quickstart

```bash
npx @floomhq/cli@latest setup
```

This opens https://floom.dev/me/agent-keys in your browser, asks you to paste an Agent token, verifies it against the API, saves it to `~/.floom/config.json`, and prints the MCP config snippet.

For the MVP cloud:

```bash
floom login --api-url https://mvp.floom.dev
```

This opens or prints https://mvp.floom.dev/me/agent-keys and then prints the
noninteractive save command:

```bash
floom auth login --token=<agent_token> --api-url=https://mvp.floom.dev
```

## Other commands

```bash
floom auth <agent-token>     # save token non-interactively
floom auth login --token=... # validate token, then save config non-interactively
floom auth whoami            # print identity for current token
floom run <slug> [json]      # run a Floom app by slug
floom apps list              # list workspace apps
floom deploy                 # validate + publish current floom.yaml
floom init                   # scaffold floom.yaml in current dir
floom status                 # list apps and recent runs
floom account                # manage workspace secrets and tokens
```

## Configuration

| Variable        | Default                         | Purpose                  |
|-----------------|---------------------------------|--------------------------|
| `FLOOM_API_URL` | `https://floom.dev`             | API host (use mvp.floom.dev for the MVP cloud) |
| `FLOOM_CONFIG`  | `~/.floom/config.json`          | Config file location     |
| `FLOOM_CLI_NO_BROWSER` | unset                    | Set to `1` to print login URLs without opening a browser |

## What this package is

A thin Node.js wrapper around the bundled bash CLI in `vendor/floom/` (mirrored from [`floomhq/floom` `cli/floom/`](https://github.com/floomhq/floom/tree/main/cli/floom)). The `setup` subcommand is implemented in pure Node so it works without bash. Other subcommands shell out to the bundled bash CLI.

## License

MIT.
