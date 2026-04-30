import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const files = [
  'test/cloud/rls_isolation.sql',
  'test/cloud/bootstrap_journey.sql',
];

const env = {
  ...process.env,
  PGHOST: process.env.PGHOST || 'localhost',
  PGPORT: process.env.PGPORT || '54322',
  PGUSER: process.env.PGUSER || 'postgres',
  PGDATABASE: process.env.PGDATABASE || 'postgres',
  PGPASSWORD: process.env.PGPASSWORD || 'postgres',
};

let failed = false;

for (const file of files) {
  console.log(`\n# ${file}`);
  const result = spawnSync(
    'psql',
    ['-v', 'ON_ERROR_STOP=1', '-f', file],
    {
      cwd: root,
      env,
      encoding: 'utf8',
    },
  );

  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.status !== 0) failed = true;
}

if (failed) {
  process.exit(1);
}
