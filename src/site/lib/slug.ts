import { fold } from '../../lib/text.ts';
import type { Listing } from '../../schema.ts';
import { headline } from './headline.ts';

/**
 * Readable addresses for listings.
 *
 * `/oglas/42-165677/` says nothing. `/oglas/mala-masina-za-sivanje-42-165677/`
 * says what is being sold before the page has loaded - in a search result, in a
 * pasted link, in a browser history entry six weeks later.
 *
 * The id stays on the end and stays authoritative. It is what makes the slug
 * safe to change: a headline is model-written and gets better between runs, and
 * if the URL depended on the words alone, every improvement to a headline would
 * break a link. Instead the words are decoration on a stable key, and the route
 * resolves on the key.
 *
 * That is also why `/oglas/42-165677/` keeps working - see `oglas/[slug].astro`.
 * Around 2,700 of them are already indexed, and the saved-listings page builds
 * its links from ids held in localStorage, where no headline is guaranteed to
 * still be current.
 */

/** How much of a headline a URL is allowed to carry. */
const MAX = 60;

/**
 * Bosnian text as a URL path segment.
 *
 * `fold` already handles the part that is easy to get wrong - Cyrillic to
 * Latin, then diacritics off, so "Živinice" and "Живинице" arrive at the same
 * "zivinice". What is left is the punctuation of a sale notice, of which the
 * only piece that carries meaning is the m² that appears in most property
 * headlines; spelled "m2" it survives, and dropped it takes the number with it.
 */
export function slugify(text: string): string {
  const slug = fold(text)
    .replace(/²/g, '2')
    .replace(/³/g, '3')
    // A separator, not a deletion: "stan/garaza" is two words, not one.
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  if (slug.length <= MAX) return slug;
  // Cut at a word rather than mid-syllable; a slug ending "...jednosoban-st" is
  // worse than one word shorter.
  const cut = slug.slice(0, MAX);
  const lastDash = cut.lastIndexOf('-');
  return (lastDash > MAX / 2 ? cut.slice(0, lastDash) : cut).replace(/-+$/, '');
}

/** The id at the end of a listing path, which is the only part that resolves. */
export const idFromSlug = (slug: string): string => {
  const match = slug.match(/(\d+-\d+)$/);
  return match ? match[1] : slug;
};

/** The slug half of a listing's address, without the id. */
export const slugOf = (l: Listing): string => slugify(headline(l));

/** Where a listing lives. The one place a listing URL is spelled out. */
export function hrefOf(l: Listing): string {
  const slug = slugOf(l);
  return slug ? `/oglas/${slug}-${l.id}/` : `/oglas/${l.id}/`;
}

/** The same address, for the calendar file rather than the page. */
export function icsHrefOf(l: Listing): string {
  const slug = slugOf(l);
  return slug ? `/oglas/${slug}-${l.id}.ics` : `/oglas/${l.id}.ics`;
}
