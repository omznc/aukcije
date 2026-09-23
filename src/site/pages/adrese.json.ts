import type { APIRoute } from 'astro';
import { listings } from '../lib/data.ts';
import { hrefOf } from '../lib/slug.ts';
import type { AddressTable } from '../lib/legacy-url.ts';

/**
 * Listing id -> current path, for every listing that has moved off its bare id.
 *
 * Read by `functions/oglas/[[path]].ts` to answer `/oglas/{id}/` with a 301.
 * Built from `hrefOf`, the same function every link on the site uses, so the
 * redirect and the page cannot disagree about where a listing lives.
 */
export const GET: APIRoute = () => {
  const table: AddressTable = {};
  for (const l of listings) {
    const href = hrefOf(l);
    if (href !== `/oglas/${l.id}/`) table[l.id] = href;
  }
  return new Response(JSON.stringify(table), {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
};
