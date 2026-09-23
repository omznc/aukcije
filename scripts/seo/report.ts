import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { SITE, WEBMASTERS, google, inspect, performance, type Row } from './google.ts';

/**
 * What search engines currently make of the site, in one run.
 *
 *   node scripts/seo/report.ts [days=90]
 *
 * Search Console: clicks and impressions by month, top queries and pages, the
 * sitemap, and the index state of a fixed set of pages that should always be
 * indexed. Bing: the same headline numbers from its Webmaster API.
 *
 * Neither engine gets anything from the site itself - there is no analytics on
 * it, by choice - so this is the whole of what is measured.
 */

const days = Number(process.argv[2] ?? 90);

const line = (r: Row) =>
  `${String(r.clicks).padStart(5)}  ${String(r.impressions).padStart(6)}  ${(r.ctr * 100)
    .toFixed(1)
    .padStart(5)}%  ${r.position.toFixed(1).padStart(5)}  ${r.keys?.join(' | ') ?? 'total'}`;
const table = (title: string, rows: Row[]) => {
  console.log(`\n${title}\nclicks  impr.    ctr    pos`);
  for (const r of rows) console.log(line(r));
};

console.log(`Search Console, last ${days} days - ${SITE}`);
table('Total', await performance([], days));

const byMonth = new Map<string, Row>();
for (const r of await performance(['date'], days, 1000)) {
  const month = r.keys![0].slice(0, 7);
  const m = byMonth.get(month) ?? { keys: [month], clicks: 0, impressions: 0, ctr: 0, position: 0 };
  m.clicks += r.clicks;
  m.impressions += r.impressions;
  m.ctr = m.impressions ? m.clicks / m.impressions : 0;
  byMonth.set(month, m);
}
console.log('\nBy month\nclicks  impr.');
for (const m of byMonth.values()) console.log(`${String(m.clicks).padStart(5)}  ${String(m.impressions).padStart(6)}  ${m.keys![0]}`);

table('Top queries', await performance(['query'], days, 40));
table('Top pages', await performance(['page'], days, 25));

const sitemaps = (await google(`${WEBMASTERS}/sitemaps`))?.sitemap ?? [];
console.log('\nSitemaps');
for (const s of sitemaps) {
  const web = s.contents?.find((c: { type: string }) => c.type === 'web');
  console.log(`  ${s.path}: ${web?.submitted ?? '?'} submitted, read ${s.lastDownloaded ?? 'never'}, ${s.errors} errors`);
}

// The pages that should be indexed whatever else is. A listing is not in this
// list: which listings Google keeps is its call, but losing a hub is a signal.
const HUBS = ['', 'snizenja/', 'predmeti/', 'sudovi/', 'arhiva/', 'cijene/', 'tempo/', 'mapa/', 'kako-se-nadmetati/'];
console.log('\nIndex state of the hub pages');
for (const path of HUBS) {
  const s = await inspect(SITE + path);
  console.log(`  /${path.padEnd(20)} ${s.coverageState}${s.lastCrawlTime ? ` (crawled ${s.lastCrawlTime.slice(0, 10)})` : ''}`);
}

const bingKey = await readFile(
  process.env.BING_KEY_FILE || `${homedir()}/.config/sudskeprodaje/bing.key`,
  'utf8',
).catch(() => null);
if (bingKey) {
  const bing = async (method: string) => {
    const r = await fetch(
      `https://ssl.bing.com/webmaster/api.svc/json/${method}?apikey=${bingKey.trim()}&siteUrl=${encodeURIComponent(SITE)}`,
    );
    return (await r.json()).d;
  };
  const traffic = ((await bing('GetRankAndTrafficStats')) ?? []) as Array<{ Clicks: number; Impressions: number }>;
  const crawl = ((await bing('GetCrawlStats')) ?? []) as Array<{ InIndex: number; CrawledPages: number }>;
  const clicks = traffic.reduce((n, d) => n + d.Clicks, 0);
  const impressions = traffic.reduce((n, d) => n + d.Impressions, 0);
  console.log(`\nBing: ${clicks} clicks, ${impressions} impressions over ${traffic.length} days`);
  const last = crawl.at(-1);
  if (last) console.log(`Bing: ${last.InIndex} pages in index, ${last.CrawledPages} crawled on the last day`);
} else {
  console.log('\nBing: no key found, skipped');
}
