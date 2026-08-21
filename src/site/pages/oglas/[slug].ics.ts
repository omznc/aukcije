import type { APIRoute, GetStaticPaths } from 'astro';
import type { Listing } from '../../../schema.ts';
import { listings } from '../../lib/data.ts';
import { calendarFor } from '../../lib/calendar.ts';
import { ICS_HEADERS } from '../../lib/ics.ts';
import { headline } from '../../lib/headline.ts';
import { icsHrefOf, slugOf } from '../../lib/slug.ts';

/**
 * Both addresses, unlike the page: this one has no meta refresh to fall back on
 * and the saved-listings page fetches `/oglas/{id}.ics` from an id it holds in
 * localStorage, so the bare form has to keep returning a real calendar.
 */
export const getStaticPaths: GetStaticPaths = () =>
  listings.flatMap((l) => {
    const slug = slugOf(l);
    const bare = { params: { slug: l.id }, props: { listing: l } };
    return slug ? [{ params: { slug: `${slug}-${l.id}` }, props: { listing: l } }, bare] : [bare];
  });

/** One hearing, for the "add to calendar" button on its page. */
export const GET: APIRoute = ({ site, props }) => {
  const l = props.listing as Listing;
  const base = site?.href.replace(/\/$/, '') ?? '';

  return new Response(
    calendarFor([l], base, {
      name: `${headline(l)} - ${l.court}`,
      source: `${base}${icsHrefOf(l)}`,
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
