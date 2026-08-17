import type { APIRoute } from 'astro';
import { listings, generatedAt } from '../lib/data.ts';

/**
 * The whole dataset, exactly as the site renders it. The README promises a
 * plain JSON download and the footer links here, so this is that file - served
 * from the site rather than pointing people at a path inside the repository.
 */
export const GET: APIRoute = ({ site }) => {
  const body = JSON.stringify({
    generatedAt,
    count: listings.length,
    source: 'https://pravosudje.ba/vstvfo/B/10001/sudske-prodaje',
    site: site?.href ?? null,
    notice:
      'Nezvanični indeks. Podaci su izvučeni automatski i mogu sadržavati greške; mjerodavan je isključivo zaključak suda.',
    listings,
  });

  return new Response(body, {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
    },
  });
};
