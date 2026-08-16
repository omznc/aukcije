import type { APIRoute } from 'astro';
import { listings, SALE_TYPE_LABELS, formatDate, formatMoney } from '../lib/data.ts';
import { headline } from '../lib/headline.ts';

const escape = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * Newest notices by publication date — the natural feed for "what just got
 * listed", which is the question an RSS subscriber is actually asking.
 */
export const GET: APIRoute = ({ site }) => {
  const base = site?.href.replace(/\/$/, '') ?? '';
  const items = [...listings]
    .sort((a, b) => b.publishedDate.localeCompare(a.publishedDate))
    .slice(0, 100);

  const body = items
    .map((l) => {
      const price = formatMoney(l.startingPrice ?? l.appraisedValue);
      const description = [
        `${SALE_TYPE_LABELS[l.saleType]} — ${l.court}`,
        l.itemDescription,
        `Ročište: ${formatDate(l.saleDate)}${l.saleTime ? ` u ${l.saleTime}` : ''}`,
        price ? `Cijena: ${price}` : null,
        l.caseNumber ? `Predmet: ${l.caseNumber}` : null,
      ]
        .filter(Boolean)
        .join('\n');

      return `    <item>
      <title>${escape(headline(l))}</title>
      <link>${base}/oglas/${l.id}/</link>
      <guid isPermaLink="true">${base}/oglas/${l.id}/</guid>
      <pubDate>${new Date(`${l.publishedDate}T08:00:00Z`).toUTCString()}</pubDate>
      <category>${escape(SALE_TYPE_LABELS[l.saleType])}</category>
      <description>${escape(description)}</description>
    </item>`;
    })
    .join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Sudske prodaje u BiH</title>
    <link>${base}/</link>
    <description>Nove sudske prodaje (licitacije) objavljene na portalu pravosudje.ba</description>
    <language>bs</language>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
${body}
  </channel>
</rss>
`;

  return new Response(xml, {
    headers: { 'Content-Type': 'application/xml; charset=utf-8' },
  });
};
