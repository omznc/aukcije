import type { Listing } from '../../schema.ts';
import { hrefOf } from './slug.ts';
import { SALE_TYPE_LABELS, formatDate, formatMoney } from './data.ts';
import { headline } from './headline.ts';

/**
 * RSS 2.0, built once and pointed at different slices of the archive.
 *
 * The site started with a single feed of everything, which is the wrong grain:
 * nobody wants every court in the country. A feed per court and per item
 * category costs nothing to generate and is the difference between a site
 * someone checks and one they subscribe to.
 */

const escape = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export interface FeedOptions {
  /** Absolute site root, no trailing slash. */
  base: string;
  /** This feed's own path, for the atom:link rel="self" a reader uses to refresh. */
  self: string;
  /** The page this feed mirrors. */
  link: string;
  title: string;
  description: string;
  items: Listing[];
  limit?: number;
  /** Extra lines at the top of an item's description - the drops feed uses it. */
  note?: (l: Listing) => string | null;
}

/**
 * A notice has no publication *time*, only a date, and a reader that sees the
 * same instant for a hundred items orders them arbitrarily. Spreading them by a
 * minute inside the day keeps the intended order without inventing an hour.
 */
function pubDate(l: Listing, index: number): string {
  const day = Date.parse(`${l.publishedDate}T08:00:00Z`);
  return new Date(day - Math.min(index, 59) * 60_000).toUTCString();
}

function item(l: Listing, index: number, options: FeedOptions): string {
  const url = `${options.base}${hrefOf(l)}`;
  const price = formatMoney(l.startingPrice ?? l.appraisedValue);
  const description = [
    options.note?.(l),
    `${SALE_TYPE_LABELS[l.saleType]} - ${l.court}`,
    l.itemDescription,
    `Ročište: ${formatDate(l.saleDate)}${l.saleTime ? ` u ${l.saleTime}` : ''}`,
    price ? `Cijena: ${price}` : null,
    l.caseNumber ? `Predmet: ${l.caseNumber}` : null,
  ]
    .filter(Boolean)
    .join('\n');

  return `    <item>
      <title>${escape(headline(l))}</title>
      <link>${escape(url)}</link>
      <guid isPermaLink="true">${escape(url)}</guid>
      <pubDate>${pubDate(l, index)}</pubDate>
      <category>${escape(SALE_TYPE_LABELS[l.saleType])}</category>
      <description>${escape(description)}</description>
    </item>`;
}

export function rssFeed(options: FeedOptions): Response {
  const { base, self, link, title, description, items, limit = 100 } = options;
  const body = items
    .slice(0, limit)
    .map((l, i) => item(l, i, options))
    .join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escape(title)}</title>
    <link>${escape(base + link)}</link>
    <atom:link href="${escape(base + self)}" rel="self" type="application/rss+xml" />
    <description>${escape(description)}</description>
    <language>bs</language>
    <ttl>720</ttl>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
${body}
  </channel>
</rss>
`;

  return new Response(xml, {
    headers: { 'Content-Type': 'application/xml; charset=utf-8' },
  });
}

/** Newest first - "what just got listed" is the question a subscriber asks. */
export const byNewest = (items: Listing[]): Listing[] =>
  [...items].sort((a, b) => b.publishedDate.localeCompare(a.publishedDate));
