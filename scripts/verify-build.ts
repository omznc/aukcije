import { readFile, stat } from 'node:fs/promises';
import { glob } from 'node:fs/promises';
import { PATHS } from '../src/config.ts';
import { ListingFile } from '../src/schema.ts';

/**
 * Assert the built site is actually complete.
 *
 * `astro build` can fail to generate dynamic routes - a `getStaticPaths` that
 * throws, say - while still exiting 0. That combination is the worst case for
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

// Calendars and share cards are per-listing endpoints, so a broken import takes
// out all of them at once while the HTML still builds and the job still passes.
const calendars = await count('dist/oglas/*.ics');
check(calendars === listings.length, `a calendar per listing (${calendars} of ${listings.length})`);

const cards = await count('dist/og/*.png');
check(
  cards >= listings.length,
  `a share card per listing (${cards} of ${listings.length}, plus the default)`,
);

const courtFeeds = await count('dist/sudovi/*/rss.xml');
check(courtFeeds >= courts, `an RSS feed per court (${courtFeeds} of ${courts})`);

const courtCalendars = await count('dist/sudovi/*/kalendar.ics');
check(courtCalendars >= courts, `a calendar per court (${courtCalendars} of ${courts})`);

const itemFeeds = await count('dist/predmeti/*/rss.xml');
check(itemFeeds === itemPages, `an RSS feed per category (${itemFeeds} of ${itemPages})`);

const itemCalendars = await count('dist/predmeti/*/kalendar.ics');
check(itemCalendars === itemPages, `a calendar per category (${itemCalendars} of ${itemPages})`);

for (const page of [
  'dist/index.html',
  'dist/rss.xml',
  'dist/pretraga/index.html',
  // The pages added alongside the feeds. Each is a whole section of the site
  // and each one is a single file that can vanish without failing the build.
  'dist/snizenja/index.html',
  'dist/snizenja/rss.xml',
  'dist/snizenja/kalendar.ics',
  'dist/mapa/index.html',
  'dist/cijene/index.html',
  'dist/kalendar.ics',
  'dist/og/default.png',
  // The saved-notices page is nothing without its card index, and the index is
  // an endpoint that a broken import would drop while the build still passes.
  'dist/sacuvano/index.html',
  'dist/sacuvano.json',
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

// Structured data is invisible on the page, so a serialisation that broke would
// only show up as a slow decline in search results months later.
check(home.includes('application/ld+json'), 'home page carries structured data');

const sampleListing = listings[0];
const listingHtml = await readFile(`dist/oglas/${sampleListing.id}/index.html`, 'utf8').catch(
  () => '',
);
check(listingHtml.includes('"@type":"SaleEvent"'), 'listing pages carry SaleEvent structured data');
check(
  listingHtml.includes(`/og/${sampleListing.id}.png`),
  'listing pages point at their own share card',
);

// A calendar the clients reject is worse than none: it fails silently on the
// subscriber's machine, where nothing here can see it.
const calendar = await readFile('dist/kalendar.ics', 'utf8').catch(() => '');
const opened = (calendar.match(/BEGIN:VEVENT/g) ?? []).length;
const closed = (calendar.match(/END:VEVENT/g) ?? []).length;
check(
  calendar.startsWith('BEGIN:VCALENDAR') && calendar.trimEnd().endsWith('END:VCALENDAR'),
  'calendar is a well-formed VCALENDAR',
);
check(opened > 0 && opened === closed, `calendar events are balanced (${opened} events)`);
check(
  !calendar.split('\r\n').some((line) => Buffer.byteLength(line, 'utf8') > 75),
  'calendar lines are folded to 75 octets',
);

console.log();
if (failures.length) {
  console.error(`${failures.length} check(s) failed - the build is incomplete, do not deploy.`);
  process.exit(1);
}
console.log(`Build looks complete: ${listingPages} listing pages, ${courtPages} court pages.`);
