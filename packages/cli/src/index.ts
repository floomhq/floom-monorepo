#!/usr/bin/env node
import { Command } from 'commander';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { version } = require('../package.json') as { version: string };

const program = new Command();
program
  .name('floom')
  .description('Deprecated compatibility stub. Use the published @floomhq/cli package for the supported Floom CLI.')
  .version(version)
  .addHelpText(
    'after',
    '\nThis @floom/cli workspace package is deprecated and only kept so monorepo builds stay green. Install @floomhq/cli for the supported CLI.\n',
  );

program
  .command('deploy <repo>')
  .description('Deploy a public GitHub repo as a Floom app')
  .option('--branch <branch>', 'branch or tag', 'main')
  .action((repo: string, opts: { branch: string }) => {
    console.error(
      `floom deploy is not wired in the public beta yet. Use the web UI at `
        + `https://floom.dev/build to host a repo. The programmatic deploy API `
        + `is on the roadmap; we will update this command once it ships.\n`
        + `(repo=${repo} branch=${opts.branch})`,
    );
    process.exit(1);
  });

program
  .command('run <slug>')
  .description('Run a registered Floom app')
  .option('--input <key=value...>', 'inputs', [])
  .action((slug: string) => {
    console.error(
      `floom run is not wired in the public beta. Invoke the HTTP endpoint `
        + `at POST /api/${slug}/run or use the MCP server at /mcp/app/${slug}.`,
    );
    process.exit(1);
  });

program.parseAsync();
