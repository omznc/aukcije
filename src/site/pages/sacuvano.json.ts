import type { APIRoute } from 'astro';
import { listings, generatedAt, formatMoney } from '../lib/data.ts';
import { headline } from '../lib/headline.ts';
import { metaLine, discount, formatPercent } from '../lib/stats.ts';

/**
 * One short card per notice, keyed by id - what /sacuvano/ renders its rows from.
 *
 * It carries the whole archive because which notices matter is only known in the
 * visitor's browser: the saved ids live in their localStorage and never reach the
 * build, so there is nothing to narrow this file down to. Keys are one letter and
 * the prices arrive pre-formatted, which keeps the payload an order of magnitude
 * under /podaci.json; the hearing date stays raw because "za 3 dana" has to be
 * computed against the day it is read, not the day it was built.
 */
export interface Card {
  /** headline */
  h: string;
  /** supporting meta line */
  m: string;
  /** court */
  c: string;
  /** entity */
  e: string;
  /** hearing date, ISO */
  d: string;
  /** sale type, for the row's icon */
  t: string;
  /** starting price, falling back to the appraisal */
  p: string | null;
  /** discount off the appraisal, already formatted */
  o: string | null;
}

export const GET: APIRoute = () => {
  const cards: Record<string, Card> = {};

  for (const l of listings) {
    const off = discount(l);
    cards[l.id] = {
      h: headline(l),
      m: metaLine(l),
      c: l.court,
      e: l.entity,
      d: l.saleDate,
      t: l.saleType,
      p: formatMoney(l.startingPrice ?? l.appraisedValue),
      o: off === null ? null : formatPercent(off),
    };
  }

  return new Response(JSON.stringify({ generatedAt, cards }), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
    },
  });
};
