import type { APIRoute } from 'astro';
import { listings, upcoming, courts } from '../../lib/data.ts';
import { defaultCard } from '../../lib/og.ts';

/** The card every page that is not a single listing shares itself with. */
export const GET: APIRoute = async () => {
  const png = new Uint8Array(
    await defaultCard({
      listings: listings.length,
      courts: courts.length,
      upcoming: upcoming.length,
    }),
  );
  return new Response(png, { headers: { 'Content-Type': 'image/png' } });
};
