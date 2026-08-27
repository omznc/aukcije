import type { APIRoute } from 'astro';
import { hrefOf } from '../lib/slug.ts';
import { listings, courts, itemCategories, generatedAt } from '../lib/data.ts';

const escape = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * Every page the site generates, in one file.
 *
 * Hand-rolled for the same reason rss.xml.ts is: the route shapes are known
 * here, and an integration that crawls the output would also sweep in the JSON
 * and XML endpoints, which are not pages and should not be indexed as such.
 *
 * `changefreq` and `priority` are deliberately omitted - Google ignores both,
 * and they would be one more thing to keep honest. `lastmod` is not: it is what
 * tells a crawler which of ~3,000 URLs actually changed since the last visit.
 */
export const GET: APIRoute = ({ site }) => {
  const base = site?.href.replace(/\/$/, '') ?? '';
  const built = generatedAt.slice(0, 10);

  const urls: Array<{ path: string; lastmod: string }> = [
    // Index pages re-render on every scrape, so the build date is their truth.
    { path: '/', lastmod: built },
    { path: '/snizenja/', lastmod: built },
    { path: '/predmeti/', lastmod: built },
    { path: '/sudovi/', lastmod: built },
    { path: '/mapa/', lastmod: built },
    { path: '/arhiva/', lastmod: built },
    { path: '/cijene/', lastmod: built },
    { path: '/tempo/', lastmod: built },
    { path: '/pretraga/', lastmod: built },
    { path: '/sacuvano/', lastmod: built },
    { path: '/kako-se-nadmetati/', lastmod: built },
    { path: '/privatnost/', lastmod: built },
    ...courts.map((c) => ({ path: `/sudovi/${c.id}/`, lastmod: built })),
    ...itemCategories.map((t) => ({ path: `/predmeti/${t.id}/`, lastmod: built })),
    // A notice's own page is settled once published; using its publication date
    // stops a daily rebuild from claiming the whole archive just changed.
    ...listings.map((l) => ({ path: hrefOf(l), lastmod: l.publishedDate })),
  ];

  const body = urls
    .map(
      (u) => `  <url>
    <loc>${escape(base + u.path)}</loc>
    <lastmod>${u.lastmod}</lastmod>
  </url>`,
    )
    .join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${body}
</urlset>
`;

  return new Response(xml, {
    headers: { 'Content-Type': 'application/xml; charset=utf-8' },
  });
};
