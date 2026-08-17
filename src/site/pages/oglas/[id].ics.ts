import type { APIRoute, GetStaticPaths } from 'astro';
import type { Listing } from '../../../schema.ts';
import { listings } from '../../lib/data.ts';
import { calendarFor } from '../../lib/calendar.ts';
import { ICS_HEADERS } from '../../lib/ics.ts';
import { headline } from '../../lib/headline.ts';

export const getStaticPaths: GetStaticPaths = () =>
  listings.map((l) => ({ params: { id: l.id }, props: { listing: l } }));

/** One hearing, for the "add to calendar" button on its page. */
export const GET: APIRoute = ({ site, props }) => {
  const l = props.listing as Listing;
  const base = site?.href.replace(/\/$/, '') ?? '';

  return new Response(
    calendarFor([l], base, {
      name: `${headline(l)} - ${l.court}`,
      source: `${base}/oglas/${l.id}.ics`,
    }),
    {
      headers: {
        ...ICS_HEADERS,
        // A single hearing is downloaded, not subscribed to; naming the file
        // stops it landing in Downloads as a bare id.
        'Content-Disposition': `attachment; filename="rociste-${l.id}.ics"`,
      },
    },
  );
};
