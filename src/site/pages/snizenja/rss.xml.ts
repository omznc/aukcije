import type { APIRoute } from 'astro';
import { formatMoney, formatDate } from '../../lib/data.ts';
import { rssFeed } from '../../lib/feed.ts';
import { priceDrops, formatPercent } from '../../lib/stats.ts';

const byId = new Map(priceDrops.map((d) => [d.listing.id, d]));

/**
 * The feed that justifies subscribing to anything here.
 *
 * Ordered by how far the price has fallen rather than by publication date, and
 * the fall is stated in the first line of each item - a reader scanning titles
 * should not have to open a page to learn why the notice is in this feed.
 */
export const GET: APIRoute = ({ site }) =>
  rssFeed({
    base: site?.href.replace(/\/$/, '') ?? '',
    self: '/snizenja/rss.xml',
    link: '/snizenja/',
    title: 'Sudske prodaje u BiH - snižene cijene',
    description:
      'Otvorena ročišta čija je cijena pala: ponovljena ročišta istog predmeta i prodaje ispod procijenjene vrijednosti suda.',
    items: priceDrops.map((d) => d.listing),
    note: (l) => {
      const d = byId.get(l.id);
      if (!d) return null;
      return d.fromPrevious !== null && d.previous
        ? `Cijena pala ${formatPercent(d.fromPrevious)}: sa ${formatMoney(
            d.previous.startingPrice,
          )} (ročište ${formatDate(d.previous.saleDate)}) na ${formatMoney(l.startingPrice)}.`
        : `${formatPercent(d.best)} ispod procijenjene vrijednosti suda.`;
    },
  });
