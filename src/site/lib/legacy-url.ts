/**
 * Where an old listing address now lives.
 *
 * `/oglas/42-165677/` is what the first builds published, and it is still what
 * search engines hold, what people shared, and what /sacuvano/ builds from the
 * ids in localStorage. The page itself moved to `/oglas/{slug}-{id}/`.
 *
 * This used to be answered with one meta-refresh stub per listing - a second,
 * `noindex` page for every real one. To a crawler that is half the site being
 * pages it is told to drop, and a refresh is a weaker signal than a redirect.
 * `functions/oglas/[[path]].ts` answers the old address with a 301 instead,
 * using this and the table from `/adrese.json`.
 *
 * Kept free of imports: it runs in a Pages Function, where pulling in the
 * dataset or zod would ship megabytes to decide one redirect.
 */

/** Listing id -> its current path. Only listings whose path is not the bare id. */
export type AddressTable = Record<string, string>;

const BARE_ID = /^\/oglas\/(\d+-\d+)\/?$/;

/** The path to 301 to, or null when this request is not an old address. */
export function legacyTarget(pathname: string, table: AddressTable): string | null {
  const id = pathname.match(BARE_ID)?.[1];
  if (!id) return null;
  const target = table[id];
  // A listing with no usable headline lives at its bare id, and is simply not
  // in the table - so this never answers a page with a redirect to itself.
  return target && target !== pathname ? target : null;
}
