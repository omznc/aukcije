import type { APIRoute } from 'astro';

/**
 * Generated rather than dropped in `public/` because the `Sitemap:` line has to
 * be an absolute URL, and the site's own URL is only known at build time (see
 * SITE_URL in src/config.ts). A hardcoded one would point at the wrong host the
 * moment this is built anywhere but production.
 *
 * Crawling is allowed outright, including by AI crawlers: the whole point of
 * this index is that court sales become findable, and the dataset is already
 * offered as a plain download at /podaci.json.
 */
export const GET: APIRoute = ({ site }) => {
  const base = site?.href.replace(/\/$/, '') ?? '';

  const body = `User-agent: *
Allow: /

# Pagefind's index shards - machine-readable search fragments, not pages.
Disallow: /pagefind/

Sitemap: ${base}/sitemap.xml
`;

  return new Response(body, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
};
