import type { APIRoute, GetStaticPaths } from 'astro';
import { upcoming, courts } from '../../../lib/data.ts';
import { calendarFor } from '../../../lib/calendar.ts';
import { ICS_HEADERS } from '../../../lib/ics.ts';

export const getStaticPaths: GetStaticPaths = () =>
  courts.map((c) => ({ params: { courtId: String(c.id) }, props: { name: c.name } }));

/** Open hearings before one court - the subscription a local bidder wants. */
export const GET: APIRoute = ({ site, params, props }) => {
  const courtId = Number(params.courtId);
  const base = site?.href.replace(/\/$/, '') ?? '';

  return new Response(
    calendarFor(
      upcoming.filter((l) => l.courtId === courtId),
      base,
      { name: `Sudske prodaje - ${props.name}`, source: `${base}/sudovi/${courtId}/kalendar.ics` },
    ),
    { headers: ICS_HEADERS },
  );
};
