import type { APIRoute, GetStaticPaths } from 'astro';
import { itemCategories, listingsForTag } from '../../../lib/data.ts';
import { rssFeed, byNewest } from '../../../lib/feed.ts';

export const getStaticPaths: GetStaticPaths = () =>
  itemCategories.map((t) => ({ params: { tag: t.id }, props: { label: t.label } }));

/**
 * One kind of thing, across every court. This is the feed the portal cannot
 * offer at all: its own categories stop at five.
 */
export const GET: APIRoute = ({ site, params, props }) =>
  rssFeed({
    base: site?.href.replace(/\/$/, '') ?? '',
    self: `/predmeti/${params.tag}/rss.xml`,
    link: `/predmeti/${params.tag}/`,
    title: `Sudske prodaje - ${props.label}`,
    description: `Nove sudske prodaje u kategoriji ${props.label.toLowerCase()}, iz svih sudova u BiH.`,
    items: byNewest(listingsForTag(params.tag!)),
  });
