import type { APIRoute } from 'astro';
import { upcoming } from '../lib/data.ts';
import { calendarFor } from '../lib/calendar.ts';
import { ICS_HEADERS } from '../lib/ics.ts';

/**
 * Every open hearing in the country, as a subscribable calendar.
 *
 * Upcoming only. A subscription is a standing view of what is ahead, and
 * pushing 2,600 settled hearings into someone's calendar would bury the dozen
 * that have not happened yet.
 */
export const GET: APIRoute = ({ site }) => {
  const base = site?.href.replace(/\/$/, '') ?? '';
  return new Response(
    calendarFor(upcoming, base, {
      name: 'Sudske prodaje u BiH',
      source: `${base}/kalendar.ics`,
    }),
    { headers: ICS_HEADERS },
  );
};
