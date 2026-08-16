import type { Listing } from '../../schema.ts';
import {
  listings,
  upcoming,
  METHOD_LABELS,
  ROUND_LABELS,
  SALE_TYPE_LABELS,
  formatMoney,
} from './data.ts';

/**
 * The figures the pages display but the dataset does not carry: weekly hearing
 * counts, discounts against the appraisal, price per m², repeat-hearing chains.
 *
 * All of it is derived at build time from `data/listings.json`, so nothing here
 * is a stored number that can drift out of step with the listings themselves.
 */

const DAY = 86_400_000;
const ms = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
const at = (t: number) => new Date(t).toISOString().slice(0, 10);

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** "1.217,5" is BiH notation: dot groups thousands, comma is the decimal mark. */
function parseLocalNumber(raw: string): number | null {
  const n = Number(raw.replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : null;
}

const AREA = /(\d[\d.,]*)\s*m\s*[²2]\b/gi;

/**
 * Floor area in m², when the notice states exactly one.
 *
 * Notices routinely list several surfaces at once — "stambeni objekat 115 m2,
 * pomoćni objekti 52 m2, dvorište 377 m2" — and taking the first would divide
 * the price for the whole lot by the area of one part. A single stated figure is
 * the only one that can be trusted to describe what is on sale.
 */
export function areaM2(l: Listing): number | null {
  const text = [l.itemDescription, l.headline, l.title].filter(Boolean).join(' ');
  const found = new Set<number>();
  for (const [, raw] of text.matchAll(AREA)) {
    const value = parseLocalNumber(raw);
    if (value !== null) found.add(value);
  }
  return found.size === 1 ? [...found][0] : null;
}

/**
 * Price per m² — the only number that makes two properties comparable, and the
 * reason the archive is worth keeping at all.
 */
export function pricePerM2(l: Listing): number | null {
  const price = (l.startingPrice ?? l.appraisedValue)?.amount;
  const area = areaM2(l);
  if (!price || !area || area < 1) return null;
  return price / area;
}

/** How far the starting price sits below the appraisal, as a fraction 0..1. */
export function discount(l: Listing): number | null {
  const appraised = l.appraisedValue?.amount;
  const starting = l.startingPrice?.amount;
  if (!appraised || starting == null) return null;
  return 1 - starting / appraised;
}

/** A typographic minus, as in the design, not a hyphen. */
export function formatPercent(fraction: number): string {
  const pct = Math.round(fraction * 100);
  return pct > 0 ? `−${pct}%` : `${pct}%`;
}

export function formatNumber(n: number): string {
  return Math.round(n).toLocaleString('bs-BA');
}

export const ROUND_SHORT: Record<string, string | null> = {
  prvo: '1. ročište',
  drugo: '2. ročište',
  trece: '3. ročište',
  nepoznato: null,
};

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

/**
 * The supporting line under a headline in the listing tables: what kind of sale
 * it is, which hearing, and the two or three specifics a bidder actually acts
 * on. Capped so the row stays one line on a laptop.
 */
export function metaLine(l: Listing): string {
  const perM2 = pricePerM2(l);
  return [
    SALE_TYPE_LABELS[l.saleType],
    ROUND_SHORT[l.auctionRound],
    perM2 ? `${formatNumber(perM2)} KM/m²` : null,
    l.deposit ? `kapara ${formatMoney(l.deposit)}` : null,
    l.saleMethod === 'nepoznato' ? null : METHOD_LABELS[l.saleMethod].toLowerCase(),
  ]
    .filter(Boolean)
    .slice(0, 4)
    .join(' · ');
}

// ── Weekly strip ────────────────────────────────────────────────────────────

export interface Week {
  from: string;
  to: string;
  label: string;
  count: number;
}

const MAX_WEEKS = 9;

function mondayOf(iso: string): string {
  const t = ms(iso);
  const dayOfWeek = (new Date(t).getUTCDay() + 6) % 7; // Monday = 0
  return at(t - dayOfWeek * DAY);
}

const dayMonth = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}`;

function weekLabel(from: string, to: string): string {
  return from.slice(5, 7) === to.slice(5, 7)
    ? `${from.slice(8, 10)}–${dayMonth(to)}`
    : `${dayMonth(from)}–${dayMonth(to)}`;
}

/**
 * Upcoming hearings bucketed by week. The strip is a fixed nine columns, so a
 * calendar that runs longer than that has its tail merged into the last bucket
 * rather than being silently cut off.
 */
export function weeksOf(list: Listing[]): Week[] {
  const dates = list.map((l) => l.saleDate).sort();
  if (!dates.length) return [];

  const last = dates[dates.length - 1];
  const weeks: Week[] = [];
  let from = mondayOf(dates[0]);

  while (from <= last && weeks.length < MAX_WEEKS) {
    const weekEnd = at(ms(from) + 6 * DAY);
    const to = weeks.length === MAX_WEEKS - 1 && weekEnd < last ? last : weekEnd;
    weeks.push({
      from,
      to,
      label: weekLabel(from, to),
      count: dates.filter((d) => d >= from && d <= to).length,
    });
    from = at(ms(to) + DAY);
  }
  return weeks;
}

export const weeks = weeksOf(upcoming);

// ── Distributions ───────────────────────────────────────────────────────────

export interface Slice {
  key: string;
  label: string;
  count: number;
}

function tally(items: Listing[], key: (l: Listing) => string | null): Map<string, number> {
  const counts = new Map<string, number>();
  for (const l of items) {
    const k = key(l);
    if (k !== null) counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return counts;
}

/** Sale types present in a set, most common first. */
export function typeSlices(items: Listing[]): Slice[] {
  return [...tally(items, (l) => l.saleType)]
    .map(([key, count]) => ({ key, label: SALE_TYPE_LABELS[key] ?? key, count }))
    .sort((a, b) => b.count - a.count);
}

export function courtSlices(items: Listing[]): Array<Slice & { id: number }> {
  const byCourt = new Map<number, { name: string; count: number }>();
  for (const l of items) {
    const seen = byCourt.get(l.courtId);
    if (seen) seen.count++;
    else byCourt.set(l.courtId, { name: l.court, count: 1 });
  }
  return [...byCourt]
    .map(([id, c]) => ({ id, key: String(id), label: c.name, count: c.count }))
    .sort((a, b) => b.count - a.count);
}

/** Sale methods over the whole archive, in a fixed order so the list is stable. */
export function methodSlices(items: Listing[] = listings): Slice[] {
  const counts = tally(items, (l) => l.saleMethod);
  return Object.keys(METHOD_LABELS)
    .map((key) => ({ key, label: METHOD_LABELS[key].toLowerCase(), count: counts.get(key) ?? 0 }))
    .filter((s) => s.count > 0);
}

export function roundSlices(items: Listing[] = listings): Slice[] {
  const counts = tally(items, (l) => l.auctionRound);
  return Object.keys(ROUND_LABELS)
    .map((key) => ({
      key,
      label: ROUND_SHORT[key] ?? 'nepoznato',
      count: counts.get(key) ?? 0,
    }))
    .filter((s) => s.count > 0);
}

export function entitySlices(items: Listing[] = listings): Slice[] {
  return [...tally(items, (l) => l.entity)]
    .map(([key, count]) => ({ key, label: key, count }))
    .sort((a, b) => b.count - a.count);
}

/**
 * Notices published per calendar year, including the years with none — the gap
 * between 2013 and 2021 is the single most important caveat about this archive,
 * so the chart has to show it rather than close it up.
 */
export function publishedByYear(items: Listing[] = listings): Array<{ year: number; count: number }> {
  const counts = tally(items, (l) => l.publishedDate.slice(0, 4));
  const years = [...counts.keys()].map(Number);
  const from = Math.min(...years);
  const to = Math.max(...years);
  return Array.from({ length: to - from + 1 }, (_, i) => ({
    year: from + i,
    count: counts.get(String(from + i)) ?? 0,
  }));
}

/** Calendar years a set of hearings falls in, newest first. */
export function hearingYears(items: Listing[]): Array<{ year: number; count: number }> {
  return [...tally(items, (l) => l.saleDate.slice(0, 4))]
    .map(([year, count]) => ({ year: Number(year), count }))
    .sort((a, b) => b.year - a.year);
}

// ── Whole-dataset headline figures ──────────────────────────────────────────

export const activeCourtCount = new Set(upcoming.map((l) => l.courtId)).size;

export const medianDiscount = median(
  listings.map(discount).filter((d): d is number => d !== null),
);

/** Days from publication to hearing — how much notice a bidder actually gets. */
export function medianLeadDays(items: Listing[] = listings): number | null {
  return median(
    items
      .map((l) => Math.round((ms(l.saleDate) - ms(l.publishedDate)) / DAY))
      .filter((d) => d >= 0),
  );
}

export const viewingShare = listings.filter((l) => l.viewingInfo).length / listings.length;

// ── Repeat hearings ─────────────────────────────────────────────────────────

const byCase = new Map<string, Listing[]>();
for (const l of listings) {
  if (!l.caseNumber) continue;
  const chain = byCase.get(l.caseNumber);
  if (chain) chain.push(l);
  else byCase.set(l.caseNumber, [l]);
}

/**
 * Every hearing held for the same case number, oldest first. An unsold lot comes
 * back cheaper, and that chain is the most useful thing the archive knows about
 * a listing — empty when this case only ever went to auction once.
 */
export function chainFor(l: Listing): Listing[] {
  const chain = l.caseNumber ? (byCase.get(l.caseNumber) ?? []) : [];
  return chain.length > 1 ? [...chain].sort((a, b) => a.saleDate.localeCompare(b.saleDate)) : [];
}

export const repeatCaseCount = [...byCase.values()].filter((c) => c.length > 1).length;

/**
 * Other sales of the same kind of thing, nearest first: same court beats same
 * municipality beats anywhere, and recent beats old.
 */
export function comparables(l: Listing, limit = 3): Listing[] {
  const tag = l.itemTags[0];
  if (!tag) return [];

  const distance = (o: Listing) => {
    if (o.courtId === l.courtId) return 0;
    const here = l.location?.municipality;
    return here && o.location?.municipality === here ? 1 : 2;
  };

  return listings
    .filter((o) => o.id !== l.id && o.itemTags.includes(tag) && (o.startingPrice ?? o.appraisedValue))
    .sort((a, b) => distance(a) - distance(b) || b.saleDate.localeCompare(a.saleDate))
    .slice(0, limit);
}

// ── Price-per-m² histogram ──────────────────────────────────────────────────

export interface Histogram {
  bins: number[];
  min: number;
  max: number;
  /** How many of the records could be measured at all. */
  sampled: number;
  total: number;
}

/**
 * Distribution of price per m² across a category. Trimmed at the 5th and 95th
 * percentile because a single mis-parsed area otherwise flattens the chart into
 * one bar; the outliers are folded into the end bins rather than dropped.
 */
export function pricePerM2Histogram(items: Listing[], bins = 7): Histogram | null {
  const values = items
    .map(pricePerM2)
    .filter((v): v is number => v !== null)
    .sort((a, b) => a - b);
  if (values.length < 8) return null;

  const round100 = (n: number) => Math.max(100, Math.round(n / 100) * 100);
  const min = round100(values[Math.floor(values.length * 0.05)]);
  const max = round100(values[Math.floor(values.length * 0.95)]);
  if (max <= min) return null;

  const width = (max - min) / bins;
  const counts = new Array(bins).fill(0);
  for (const v of values) {
    const i = Math.min(bins - 1, Math.max(0, Math.floor((v - min) / width)));
    counts[i]++;
  }
  return { bins: counts, min, max, sampled: values.length, total: items.length };
}
