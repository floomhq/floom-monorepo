# Floom skill for Cursor

Deploy AI apps to Floom from Cursor using the `floom` CLI.

## Install

1. Install the CLI:

   ```bash
   git clone --depth 1 https://github.com/floomhq/floom.git ~/.floom/repo
   export PATH="$HOME/.floom/repo/cli/floom/bin:$PATH"
   ```

2. Copy `floom.mdc` into your project rules:

   ```bash
   cp skills/cursor/floom.mdc .cursor/rules/floom.mdc
   ```

   Or for a global user rule, copy it to `~/.cursor/rules/floom.mdc`.

## Auth

```bash
floom login
```

Mint an Agent token at https://floom.dev/me/agent-keys, then run the command printed by
`floom login`.

```bash
floom auth login --token=floom_agent_...
```

## Usage

Open Cursor chat and ask: "deploy this to Floom" or "run floom init". The rule tells
Cursor's agent to use the `floom` CLI directly.

## Layout

```
skills/cursor/
  floom.mdc    Cursor rules file
  README.md    this file
```
