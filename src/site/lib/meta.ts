import type { Listing } from '../../schema.ts';
import { formatDate, formatMoney, isUpcoming } from './data.ts';
import { headline } from './headline.ts';

/**
 * The title and description a search result shows for a listing.
 *
 * A search result is where most readers meet a notice, and it gets one line and
 * two short sentences. The title carries what is sold, where, and the words
 * people actually type ("sudska prodaja"); the description carries what decides
 * whether the result is worth opening - the price, the hearing, the court.
 * Google cuts a title at roughly 60 characters and a description at roughly
 * 155, so both are cut on a word before that rather than mid-word by Google.
 */

const TITLE_MAX = 65;
const DESCRIPTION_MAX = 158;

/** Cut at the last whole word that fits, and say that something was cut. */
export function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > max / 2 ? cut.slice(0, space) : cut).replace(/[\s,;.:-]+$/, '')}…`;
}

const ROUND_IN_SENTENCE: Record<string, string | null> = {
  prvo: 'prvo ročište',
  drugo: 'drugo ročište',
  trece: 'treće ročište',
  nepoznato: null,
};

export function listingTitle(l: Listing): string {
  const suffix = ' - sudska prodaja';
  return clip(headline(l), TITLE_MAX - suffix.length) + suffix;
}

export function listingDescription(l: Listing): string {
  const price = formatMoney(l.startingPrice);
  const appraised = formatMoney(l.appraisedValue);
  const round = ROUND_IN_SENTENCE[l.auctionRound];
  const when = `${formatDate(l.saleDate)}${l.saleTime ? ` u ${l.saleTime}` : ''}`;
  const deposit = formatMoney(l.deposit);

  const hearing = round ? capitalise(round) : 'Ročište';

  const parts = [
    headline(l).replace(/[.…]+$/, ''),
    price
      ? `Početna cijena ${price}${appraised && appraised !== price ? `, procjena ${appraised}` : ''}`
      : appraised
        ? `Procijenjena vrijednost ${appraised}`
        : null,
    isUpcoming(l)
      ? `${hearing} ${when}${deposit ? `, kapara ${deposit}` : ''}`
      : `${hearing} održano ${formatDate(l.saleDate)}`,
    l.court,
  ]
    .filter((p): p is string => Boolean(p))
    .map(sentence);

  return clip(parts.join(' '), DESCRIPTION_MAX);
}

const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** A full stop, unless the text already ends on one - as every date here does. */
const sentence = (s: string) => (s.endsWith('.') ? s : `${s}.`);
