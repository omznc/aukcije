import { readFile } from 'node:fs/promises';

/**
 * Tell Bing (and the other IndexNow engines) which pages a deploy changed.
 *
 * Without this a new notice waits for the next crawl, and a notice is worth
 * least after its hearing. IndexNow is one POST per deploy.
 *
 * What changed is read by comparing two address tables: the one the live site
 * served before this deploy (saved by deploy.yml to the path given as the first
 * argument) and the one just built. A new listing, or one whose headline and
 * so its address changed, differs between them. When the old table could not be
 * fetched, every listing counts as new - which is what the first deploy wants.
 *
 *   node scripts/seo/indexnow.ts previous-adrese.json [--dry-run]
 *
 * The key is public by design: IndexNow verifies it by fetching
 * /{key}.txt from the site, which is in public/.
 */

const KEY = '5c8240bf8524095924a1e789239e03e1';
const SITE = (process.env.SITE_URL || 'https://sudskeprodaje.omarzunic.com').replace(/\/$/, '');
/** The protocol's cap per request. */
const MAX_URLS = 10_000;

const [previousPath] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const dryRun = process.argv.includes('--dry-run');

const readTable = async (path: string | undefined): Promise<Record<string, string>> => {
  if (!path) return {};
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return {};
  }
};

const previous = await readTable(previousPath);
const current = await readTable('dist/adrese.json');
const { listings } = JSON.parse(await readFile('data/listings.json', 'utf8')) as {
  listings: Array<{ id: string; courtId: number; itemTags: string[] }>;
};

const changed = listings.filter((l) => current[l.id] && current[l.id] !== previous[l.id]);

const paths = new Set<string>();
for (const l of changed) {
  paths.add(current[l.id]);
  paths.add(`/sudovi/${l.courtId}/`);
  for (const t of l.itemTags) paths.add(`/predmeti/${t}/`);
}
// The pages that list new notices first.
if (changed.length) for (const p of ['/', '/snizenja/', '/arhiva/']) paths.add(p);

const urlList = [...paths].slice(0, MAX_URLS).map((p) => SITE + p);
console.log(`${changed.length} new or moved listings, ${urlList.length} urls to submit`);
if (!urlList.length || dryRun) {
  for (const u of urlList.slice(0, 20)) console.log(`  ${u}`);
  process.exit(0);
}

const response = await fetch('https://api.indexnow.org/indexnow', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json; charset=utf-8' },
  body: JSON.stringify({
    host: new URL(SITE).host,
    key: KEY,
    keyLocation: `${SITE}/${KEY}.txt`,
    urlList,
  }),
});
console.log(`IndexNow: ${response.status} ${await response.text()}`);
// 200 and 202 both mean accepted; anything else is logged, not fatal - a missed
// ping costs a day of crawl delay, not a broken site.
if (response.status >= 400) process.exitCode = 1;
