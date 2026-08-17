import type { APIRoute, GetStaticPaths } from 'astro';
import { itemCategories, listingsForTag, isUpcoming } from '../../../lib/data.ts';
import { calendarFor } from '../../../lib/calendar.ts';
import { ICS_HEADERS } from '../../../lib/ics.ts';

export const getStaticPaths: GetStaticPaths = () =>
  itemCategories.map((t) => ({ params: { tag: t.id }, props: { label: t.label } }));

/** Open hearings for one kind of thing, wherever in the country it is sold. */
export const GET: APIRoute = ({ site, params, props }) => {
  const base = site?.href.replace(/\/$/, '') ?? '';
  return new Response(
    calendarFor(listingsForTag(params.tag!).filter(isUpcoming), base, {
      name: `Sudske prodaje - ${props.label}`,
      source: `${base}/predmeti/${params.tag}/kalendar.ics`,
    }),
    { headers: ICS_HEADERS },
  );
};
