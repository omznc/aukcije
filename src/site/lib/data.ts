import listingsFile from '../../../data/listings.json' with { type: 'json' };
import type { Listing } from '../../schema.ts';
import { ITEM_TAGS, TAG_BY_ID } from '../../extract/items.ts';

export { ITEM_TAGS, TAG_BY_ID };

export const listings = (listingsFile.listings as Listing[]).slice();
export const generatedAt = listingsFile.generatedAt as string;

export const SALE_TYPE_LABELS: Record<string, string> = {
  nekretnine: 'Nekretnine',
  vozila: 'Vozila',
  tehnika: 'Tehnika',
  namjestaj: 'Namještaj',
  ostalo: 'Ostalo',
};

export const ROUND_LABELS: Record<string, string> = {
  prvo: 'Prvo ročište',
  drugo: 'Drugo ročište',
  trece: 'Treće ročište',
  nepoznato: 'Ročište nepoznato',
};

export const METHOD_LABELS: Record<string, string> = {
  'usmeno-javno-nadmetanje': 'Usmeno javno nadmetanje',
  'neposredna-pogodba': 'Neposredna pogodba',
  'prikupljanje-ponuda': 'Prikupljanje ponuda',
  nepoznato: 'Nepoznato',
};

/** Today in Sarajevo terms; the build runs in UTC on CI. */
export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function isUpcoming(l: Listing): boolean {
  return l.saleDate >= today();
}

export const upcoming = listings
  .filter(isUpcoming)
  .sort((a, b) => a.saleDate.localeCompare(b.saleDate));

export const past = listings
  .filter((l) => !isUpcoming(l))
  .sort((a, b) => b.saleDate.localeCompare(a.saleDate));

export function formatMoney(m: { amount: number; currency: string } | null): string | null {
  if (!m) return null;
  return `${m.amount.toLocaleString('bs-BA', {
    minimumFractionDigits: m.amount % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  })} KM`;
}

export function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}.`;
}

/** Days until the auction; negative once it has passed. */
export function daysUntil(iso: string): number {
  const then = Date.parse(`${iso}T00:00:00Z`);
  const now = Date.parse(`${today()}T00:00:00Z`);
  return Math.round((then - now) / 86_400_000);
}

export const courts = [...new Map(listings.map((l) => [l.courtId, l.court])).entries()]
  .map(([id, name]) => ({ id, name, count: listings.filter((l) => l.courtId === id).length }))
  .sort((a, b) => a.name.localeCompare(b.name, 'bs'));

/** Item categories that actually occur in the data, with counts. */
export const itemCategories = ITEM_TAGS.map((tag) => {
  const all = listings.filter((l) => l.itemTags.includes(tag.id));
  return {
    ...tag,
    count: all.length,
    upcoming: all.filter(isUpcoming).length,
  };
}).filter((t) => t.count > 0);

/** The same categories bucketed by their group, for the browse page. */
export const itemCategoryGroups = [...new Set(itemCategories.map((t) => t.group))].map((group) => ({
  group,
  tags: itemCategories
    .filter((t) => t.group === group)
    .sort((a, b) => b.upcoming - a.upcoming || b.count - a.count),
}));

export function listingsForTag(tagId: string): Listing[] {
  return listings.filter((l) => l.itemTags.includes(tagId));
}
