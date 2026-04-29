# Floom skill for Claude Code

Deploy, run, and manage Floom AI apps without leaving Claude Code.

## Install

```bash
mkdir -p ~/.claude/skills/floom && \
  curl -fsSL https://floom.dev/skill.md \
  -o ~/.claude/skills/floom/SKILL.md
```

## First run

```bash
npm i -g @floomhq/cli@latest
floom auth login --token=floom_agent_...
```

Get your token at https://floom.dev/me/agent-keys.

## Commands

| Command | What it does |
|---------|-------------|
| `/floom-new <slug>` | Scaffold a `floom.yaml` + handler in the current directory |
| `/floom-deploy` | Publish the current app to Floom |
| `/floom-run <slug> [--input k=v]` | Run an app and show the result |
| `/floom-list` | List apps in the Floom store |
| `/floom-share <state>` | Set sharing: `private`, `link`, or `public` |

## Layout

```
skills/floom/
  SKILL.md    Claude Code skill file — copy to ~/.claude/skills/floom/SKILL.md
  README.md   this file
```

## Docs

https://floom.dev/docs/skill
