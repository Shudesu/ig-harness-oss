import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runMigrations } from './migration-runner.mjs';
const args = process.argv.slice(2);
if (args.length !== 1 || !['--local', '--remote'].includes(args[0])) {
  console.error('Usage: node scripts/apply-migrations.mjs --local|--remote');
  process.exit(1);
}
try {
  await runMigrations({
    repoDir: fileURLToPath(new URL('../', import.meta.url)), remote: args[0] === '--remote',
    runWrangler: (argv, options) => {
      try { return execFileSync('pnpm', ['exec', 'wrangler', ...argv], { ...options, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 16 * 1024 * 1024 }); }
      catch { throw new Error('Wrangler D1 execution failed. Check the selected account, D1 binding and local Wrangler logs; no success was recorded.'); }
    },
  });
} catch (error) {
  console.error(error.message);
  // Do not echo captured SQL/results: legacy staff credentials may be present.
  process.exitCode = 1;
}
