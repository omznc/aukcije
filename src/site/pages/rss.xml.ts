import type { APIRoute } from 'astro';
import { listings } from '../lib/data.ts';
import { rssFeed, byNewest } from '../lib/feed.ts';

/**
 * Everything, newest first. The narrower feeds - one per court, one per item
 * category, one for price drops - are the ones worth subscribing to; this is
 * the firehose behind them.
 */
export const GET: APIRoute = ({ site }) =>
  rssFeed({
    base: site?.href.replace(/\/$/, '') ?? '',
    self: '/rss.xml',
    link: '/',
    title: 'Sudske prodaje u BiH',
    description: 'Nove sudske prodaje (licitacije) objavljene na portalu pravosudje.ba',
    items: byNewest(listings),
  });
