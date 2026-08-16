import { existsSync } from 'node:fs';
import process from 'node:process';
import { run } from './pipeline.ts';

// Pick up a local .env so an API key can be dropped in a file rather than
// exported into the shell. CI supplies the same names as real env vars.
if (existsSync('.env')) {
  const { loadEnvFile } = await import('node:process');
  try {
    loadEnvFile('.env');
  } catch {
    // A malformed .env should not stop a scrape.
  }
}

const args = new Set(process.argv.slice(2));
const limitArg = process.argv.find((a) => a.startsWith('--limit='));

await run({
  /** Re-download and re-extract everything, ignoring cached results. */
  full: args.has('--full'),
  limit: limitArg ? Number(limitArg.split('=')[1]) : undefined,
});
