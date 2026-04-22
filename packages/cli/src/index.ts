#!/usr/bin/env node
import { Command } from 'commander';
import { runInit, formatResult } from './init.js';

const program = new Command();
program
  .name('floom')
  .description('Production layer for AI apps that do real work')
  .version('0.1.0');

program
  .command('init')
  .description('Scaffold a floom.yaml manifest in the current directory')
  .option('--force', 'Overwrite an existing floom.yaml', false)
  .option('--cwd <path>', 'Directory to scaffold in (defaults to current directory)')
  .action((opts: { force?: boolean; cwd?: string }) => {
    const result = runInit({ force: opts.force, cwd: opts.cwd });
    console.log(formatResult(result));
    // Exit code semantics: 0 when we wrote or skipped cleanly, 1 when we
    // hit the `exists` case without --force (user still needs to act).
    if (result.action === 'exists') process.exit(1);
  });

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
