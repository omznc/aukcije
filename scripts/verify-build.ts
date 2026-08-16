import { readFile, stat } from 'node:fs/promises';
import { glob } from 'node:fs/promises';
import { PATHS } from '../src/config.ts';
import { ListingFile } from '../src/schema.ts';

/**
 * Assert the built site is actually complete.
 *
 * `astro build` can fail to generate dynamic routes — a `getStaticPaths` that
 * throws, say — while still exiting 0. That combination is the worst case for
 * automation: CI reports success and publishes an empty site. This turns it
 * into a non-zero exit.
 */
const failures: string[] = [];
const check = (ok: boolean, message: string) => {
  if (!ok) failures.push(message);
  console.log(`  ${ok ? '✓' : '✗'} ${message}`);
};

async function count(pattern: string): Promise<number> {
  let n = 0;
  for await (const _ of glob(pattern)) n++;
  return n;
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

const { listings } = ListingFile.parse(JSON.parse(await readFile(PATHS.listings, 'utf8')));
const courts = new Set(listings.map((l) => l.courtId)).size;

console.log('Verifying built site\n');

const listingPages = await count('dist/oglas/*/index.html');
check(
  listingPages === listings.length,
  `a page per listing (${listingPages} of ${listings.length})`,
);

const courtPages = await count('dist/sudovi/*/index.html');
check(courtPages >= courts, `a page per court (${courtPages} of ${courts})`);

const itemPages = await count('dist/predmeti/*/index.html');
check(itemPages > 1, `item category pages generated (${itemPages})`);

for (const page of [
  'dist/index.html',
  'dist/rss.xml',
  'dist/pretraga/index.html',
  // Discovery surface. These are generated endpoints, not files in public/, so
  // a broken import takes them out silently while the build still exits 0.
  'dist/robots.txt',
  'dist/sitemap.xml',
  'dist/llms.txt',
]) {
  check(await exists(page), `${page} exists`);
}

// A sitemap missing the archive is worse than none: crawlers treat it as the
// canonical inventory. Every listing page must appear.
const sitemap = await readFile('dist/sitemap.xml', 'utf8').catch(() => '');
const sitemapUrls = (sitemap.match(/<loc>/g) ?? []).length;
check(
  sitemapUrls >= listings.length,
  `sitemap covers every listing (${sitemapUrls} urls for ${listings.length} listings)`,
);

// The search index is produced after astro build; a missing one means the
// pagefind step silently did not run.
check(await exists('dist/pagefind/pagefind-ui.js'), 'search index built');

const home = await readFile('dist/index.html', 'utf8').catch(() => '');
check(home.length > 2000, `home page has content (${home.length} bytes)`);

console.log();
if (failures.length) {
  console.error(`${failures.length} check(s) failed — the build is incomplete, do not deploy.`);
  process.exit(1);
}
console.log(`Build looks complete: ${listingPages} listing pages, ${courtPages} court pages.`);
