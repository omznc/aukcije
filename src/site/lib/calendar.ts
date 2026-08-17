import type { Listing } from '../../schema.ts';
import { SALE_TYPE_LABELS, ROUND_LABELS, METHOD_LABELS, formatMoney } from './data.ts';
import { headline } from './headline.ts';
import { icsCalendar, DEFAULT_HOUR, type IcsEvent, type CalendarOptions } from './ics.ts';

/**
 * Listings as calendar events.
 *
 * Split from ics.ts because this half imports the dataset: the browser builds a
 * calendar of saved notices from /sacuvano.json instead, using the same
 * generator with cards rather than listings.
 */

/** Enough to recognise the lot, short enough not to fill a phone's notification. */
const DESCRIPTION_LIMIT = 300;

const clip = (s: string | null, limit: number) =>
  !s ? null : s.length <= limit ? s : `${s.slice(0, limit - 1).trimEnd()}…`;

export function eventFor(l: Listing, base: string): IcsEvent {
  const page = `${base}/oglas/${l.id}/`;

  return {
    // The article id is the portal's own and stable across runs, so a client
    // that has seen this event before updates it rather than adding a second.
    uid: `oglas-${l.id}@sudskeprodaje.omarzunic.com`,
    date: l.saleDate,
    time: l.saleTime,
    stamp: l.publishedDate,
    title: `${headline(l)} - ${l.court}`,
    location: l.auctionLocation ?? l.court,
    url: page,
    categories: ['Sudska prodaja', SALE_TYPE_LABELS[l.saleType]],
    description: [
      clip(l.itemDescription, DESCRIPTION_LIMIT),
      '',
      l.startingPrice ? `Početna cijena: ${formatMoney(l.startingPrice)}` : null,
      l.appraisedValue ? `Procijenjena vrijednost: ${formatMoney(l.appraisedValue)}` : null,
      l.deposit
        ? `Kapara: ${formatMoney(l.deposit)} - uplaćuje se prije ročišta, na račun iz zaključka suda.`
        : 'Kapara: nije navedena u oglasu - provjerite u zaključku suda.',
      '',
      `${ROUND_LABELS[l.auctionRound]}${
        l.saleMethod === 'nepoznato' ? '' : `, ${METHOD_LABELS[l.saleMethod].toLowerCase()}`
      }`,
      l.caseNumber ? `Predmet: ${l.caseNumber}` : null,
      `Sud: ${l.court} (${l.entity})`,
      l.viewingInfo ? `Pregled: ${clip(l.viewingInfo, 160)}` : null,
      '',
      // Someone reading this in a calendar app a month from now has none of the
      // page's context, so the two caveats travel with the event.
      l.saleTime
        ? null
        : `Oglas ne navodi vrijeme ročišta; upisano je ${DEFAULT_HOUR} kao pretpostavka. Provjerite u zaključku.`,
      'Podaci su izvučeni automatski i mogu biti netačni. Mjerodavan je isključivo zaključak suda.',
      '',
      page,
      `Zaključak suda: ${l.sourceUrl}`,
    ],
  };
}

export function calendarFor(
  items: Listing[],
  base: string,
  options: CalendarOptions,
): string {
  return icsCalendar(
    items.map((l) => eventFor(l, base)),
    options,
  );
}

/** A calendar file's name, so a download lands as something recognisable. */
export const icsFilename = (slug: string) => `sudske-prodaje-${slug}.ics`;
