// #317: keep in sync with DOCS_SEO + DOCS_HUB_DESCRIPTION in apps/server/src/index.ts

export const DOCS_HUB_DESCRIPTION =
  'Everything you need to run Floom: quickstart, MCP install, CLI, self-host, API reference, limits, and security — in one docs hub.';

export const DOCS_SEO: Record<string, { ogTitle: string; description: string }> = {
  quickstart: {
    ogTitle: 'Quickstart',
    description:
      'Your first app on Floom in a few minutes: from repo URL to a live tool with HTTP, CLI, and MCP in one pass.',
  },
  'mcp-install': {
    ogTitle: 'MCP install',
    description:
      'Add Floom to Claude Desktop, Cursor, or any MCP client. Copy the URL, drop it in, and your apps show up as tools.',
  },
  cli: {
    ogTitle: 'Floom CLI',
    description:
      'Install and use the floom CLI to publish, run locally, and wire apps into your workflow from the terminal.',
  },
  'runtime-specs': {
    ogTitle: 'Runtime specs',
    description:
      'What Floom runs, how long jobs can take, and how the runtime connects HTTP, containers, and MCP in one app.',
  },
  'self-host': {
    ogTitle: 'Self-host Floom',
    description:
      'Run Floom on your own machine or server: Docker, environment flags, and the same tool surface as the cloud.',
  },
  'api-reference': {
    ogTitle: 'API reference',
    description:
      'HTTP endpoints, auth, and run surfaces you can call from scripts, agents, and backends — next to the MCP tools.',
  },
  limits: {
    ogTitle: 'Runtime & limits',
    description:
      'Timeouts, payload limits, and how Floom throttles work so you can reason about production behavior.',
  },
  security: {
    ogTitle: 'Security',
    description:
      'How Floom isolates runs, stores secrets, and keeps agent-native surfaces from becoming foot-guns by default.',
  },
  observability: {
    ogTitle: 'Observability',
    description: 'Logging, metrics hooks, and how to see what your apps did in production or self-hosted installs.',
  },
  workflow: {
    ogTitle: 'Workflow',
    description:
      'From paste-to-publish to promoted releases: a practical flow for teams shipping AI tools on Floom.',
  },
  ownership: {
    ogTitle: 'Ownership',
    description:
      'Who owns an app, how workspaces and invites work, and what happens when people join or leave a team.',
  },
  reliability: {
    ogTitle: 'Reliability',
    description: 'What “stable” means on Floom: idempotency, retries, and what we promise for hosted runs.',
  },
  pricing: {
    ogTitle: 'Pricing (docs)',
    description:
      'How Floom thinks about free beta, self-host, and where paid plans will land for cloud — honest and current.',
  },
};
