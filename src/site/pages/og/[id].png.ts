import type { APIRoute, GetStaticPaths } from 'astro';
import type { Listing } from '../../../schema.ts';
import { listings } from '../../lib/data.ts';
import { listingCard } from '../../lib/og.ts';

export const getStaticPaths: GetStaticPaths = () =>
  listings.map((l) => ({ params: { id: l.id }, props: { listing: l } }));

/** The share card for one listing. Rendered at build time; nothing runs per request. */
export const GET: APIRoute = async ({ props }) => {
  // `Buffer` is a Uint8Array, but its type does not overlap `BodyInit`; the
  // underlying bytes are what Response wants either way.
  const png = new Uint8Array(await listingCard(props.listing as Listing));
  return new Response(png, { headers: { 'Content-Type': 'image/png' } });
};
