/**
 * Hearing-date arithmetic, with no dependency on the dataset.
 *
 * These four functions are the only build-time helpers the saved-notices page
 * needs at runtime, and it renders in the browser. Importing them from data.ts
 * would drag `data/listings.json` - 4.6 MB of it - into the client bundle, so
 * they live apart from everything that touches the listings themselves, and
 * data.ts and stats.ts re-export them for the pages that render server-side.
 */

/** Today in Sarajevo terms; the build runs in UTC on CI. */
export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Days until the auction; negative once it has passed. */
export function daysUntil(iso: string): number {
  const then = Date.parse(`${iso}T00:00:00Z`);
  const now = Date.parse(`${today()}T00:00:00Z`);
  return Math.round((then - now) / 86_400_000);
}

export type Urgency = 'due' | 'soon' | 'later' | 'past';

/** Hearings inside three days read as red, inside a week as amber. */
export function urgency(days: number): Urgency {
  if (days < 0) return 'past';
  if (days <= 3) return 'due';
  if (days <= 7) return 'soon';
  return 'later';
}

export function daysLabel(days: number): string {
  if (days < 0) return 'prošlo';
  if (days === 0) return 'danas';
  if (days === 1) return 'sutra';
  return days % 10 === 1 && days % 100 !== 11 ? `${days} dan` : `${days} dana`;
}
