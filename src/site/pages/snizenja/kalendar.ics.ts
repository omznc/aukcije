import type { APIRoute } from 'astro';
import { calendarFor } from '../../lib/calendar.ts';
import { ICS_HEADERS } from '../../lib/ics.ts';
import { priceDrops } from '../../lib/stats.ts';

/** Only the hearings that have come down in price - the shortest useful subscription. */
export const GET: APIRoute = ({ site }) => {
  const base = site?.href.replace(/\/$/, '') ?? '';
  return new Response(
    calendarFor(
      priceDrops.map((d) => d.listing),
      base,
      { name: 'Sudske prodaje - snižene cijene', source: `${base}/snizenja/kalendar.ics` },
    ),
    { headers: ICS_HEADERS },
  );
};
