import type { APIRoute, GetStaticPaths } from 'astro';
import { listings, courts } from '../../../lib/data.ts';
import { rssFeed, byNewest } from '../../../lib/feed.ts';

export const getStaticPaths: GetStaticPaths = () =>
  courts.map((c) => ({ params: { courtId: String(c.id) }, props: { name: c.name } }));

/** One court's notices. Most people care about exactly one. */
export const GET: APIRoute = ({ site, params, props }) => {
  const courtId = Number(params.courtId);
  return rssFeed({
    base: site?.href.replace(/\/$/, '') ?? '',
    self: `/sudovi/${courtId}/rss.xml`,
    link: `/sudovi/${courtId}/`,
    title: `Sudske prodaje - ${props.name}`,
    description: `Nove sudske prodaje koje objavljuje ${props.name}.`,
    items: byNewest(listings.filter((l) => l.courtId === courtId)),
  });
};
