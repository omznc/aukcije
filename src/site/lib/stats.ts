import type { Listing } from '../../schema.ts';
import {
  listings,
  upcoming,
  courts,
  isUpcoming,
  METHOD_LABELS,
  ROUND_LABELS,
  SALE_TYPE_LABELS,
  TAG_BY_ID,
  formatMoney,
} from './data.ts';
import { COURT_PLACE, canonicalPlace, placeOf, type LatLon } from './geo.ts';

// Dataset-free, so the saved-notices page can import them in the browser too.
export { urgency, daysLabel } from './dates.ts';
export type { Urgency } from './dates.ts';

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
 * Notices routinely list several surfaces at once - "stambeni objekat 115 m2,
 * pomoćni objekti 52 m2, dvorište 377 m2" - and taking the first would divide
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
 * Price per m² - the only number that makes two properties comparable, and the
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
 * Notices published per calendar year, including the years with none - the gap
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

/** Days from publication to hearing - how much notice a bidder actually gets. */
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
 * a listing - empty when this case only ever went to auction once.
 */
export function chainFor(l: Listing): Listing[] {
  const chain = l.caseNumber ? (byCase.get(l.caseNumber) ?? []) : [];
  return chain.length > 1 ? [...chain].sort((a, b) => a.saleDate.localeCompare(b.saleDate)) : [];
}

export const repeatCaseCount = [...byCase.values()].filter((c) => c.length > 1).length;

// ── Price drops ─────────────────────────────────────────────────────────────

/**
 * A lot on its way down.
 *
 * Two different measurements live here and they are not interchangeable.
 * `offAppraisal` is what the notice itself says - the starting price against the
 * court's own valuation - and exists for most listings. `fromPrevious` is the
 * fall from the *last hearing of the same case*, which only exists where that
 * hearing is also in the archive with a stated price. The second is the stronger
 * claim and the rarer one, so both are carried rather than folded together.
 */
export interface PriceDrop {
  listing: Listing;
  /** The hearing immediately before this one, when the archive holds it. */
  previous: Listing | null;
  /** Fall from the previous hearing's starting price, 0..1. */
  fromPrevious: number | null;
  /** Fall from the court's appraisal, 0..1. */
  offAppraisal: number | null;
  /** How far the lot has fallen on the best evidence available. */
  best: number;
  position: number;
  total: number;
}

/**
 * Comparing a starting price to a previous *appraisal* would invent a drop out
 * of the gap between the two kinds of number, which is exactly what this page
 * would be accused of. Both sides have to be starting prices or there is no
 * comparison to make.
 */
function fallBetween(previous: Listing, current: Listing): number | null {
  const before = previous.startingPrice?.amount;
  const after = current.startingPrice?.amount;
  if (!before || after == null || before <= 0) return null;
  const fall = 1 - after / before;
  // A rise is not a drop, and a 99% fall is a mis-parse rather than a bargain.
  return fall > 0.01 && fall < 0.95 ? fall : null;
}

function dropFor(l: Listing): PriceDrop | null {
  const chain = chainFor(l);
  const position = chain.length ? chain.findIndex((c) => c.id === l.id) + 1 : 1;
  const previous = position > 1 ? chain[position - 2] : null;
  const fromPrevious = previous ? fallBetween(previous, l) : null;
  const offAppraisal = discount(l);
  const best = fromPrevious ?? offAppraisal;
  if (best === null || best <= 0) return null;

  return {
    listing: l,
    previous,
    fromPrevious,
    offAppraisal,
    best,
    position,
    total: chain.length || 1,
  };
}

/**
 * Open hearings whose price has come down, steepest first.
 *
 * This is the archive's most actionable derivation and the site's reason to be
 * returned to: an unsold lot comes back cheaper, and nothing upstream announces
 * that it has.
 */
export const priceDrops: PriceDrop[] = upcoming
  .map(dropFor)
  .filter((d): d is PriceDrop => d !== null)
  .sort((a, b) => b.best - a.best || a.listing.saleDate.localeCompare(b.listing.saleDate));

/** Those where a previous hearing's own price is on record - the firm cases. */
export const repeatDrops = priceDrops.filter((d) => d.fromPrevious !== null);

/**
 * Every fall between consecutive hearings anywhere in the archive. This is the
 * sample behind "a second hearing typically opens a third lower", and it is
 * worth stating how large it is: most chains have a price for only one of their
 * hearings, so it is far smaller than the number of repeat cases.
 */
const historicalFalls: number[] = [...byCase.values()]
  .filter((chain) => chain.length > 1)
  .flatMap((chain) => {
    const sorted = [...chain].sort((a, b) => a.saleDate.localeCompare(b.saleDate));
    return sorted
      .slice(1)
      .map((l, i) => fallBetween(sorted[i], l))
      .filter((f): f is number => f !== null);
  });

export const chainFallMedian = median(historicalFalls);
export const chainFallSample = historicalFalls.length;

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

// ── Price reference ─────────────────────────────────────────────────────────

/**
 * A median with the sample it was taken from.
 *
 * The sample size is not decoration. Price per m² can only be measured where a
 * notice states exactly one surface, which is a minority of them, so a table of
 * bare medians would imply a confidence this data does not have. Every row
 * carries its `n` and the page prints it.
 */
export interface PriceRow {
  key: string;
  label: string;
  n: number;
  median: number;
}

function rows<T>(
  items: Listing[],
  group: (l: Listing) => { key: string; label: string } | null,
  value: (l: Listing) => number | null,
  min: number,
): PriceRow[] {
  const buckets = new Map<string, { label: string; values: number[] }>();
  for (const l of items) {
    const g = group(l);
    const v = value(l);
    if (!g || v === null) continue;
    const bucket = buckets.get(g.key) ?? { label: g.label, values: [] };
    bucket.values.push(v);
    buckets.set(g.key, bucket);
  }
  return [...buckets]
    .map(([key, b]) => ({ key, label: b.label, n: b.values.length, median: median(b.values)! }))
    .filter((r) => r.n >= min)
    .sort((a, b) => b.median - a.median);
}

/**
 * What a square metre goes for, by municipality.
 *
 * Thin on purpose: five measurable sales is already a low bar, and only a
 * handful of municipalities clear it. Publishing a median off two observations
 * would be the kind of number people quote back at each other.
 */
export function pricePerM2ByMunicipality(min = 5): PriceRow[] {
  return rows(
    listings,
    (l) => (l.location?.municipality ? { key: l.location.municipality, label: l.location.municipality } : null),
    pricePerM2,
    min,
  );
}

/** Median starting price by item category - the broadest coverage on the page. */
export function priceByTag(min = 8): PriceRow[] {
  const buckets = new Map<string, number[]>();
  for (const l of listings) {
    const price = l.startingPrice?.amount ?? null;
    if (price === null) continue;
    for (const tag of l.itemTags) {
      const values = buckets.get(tag) ?? [];
      values.push(price);
      buckets.set(tag, values);
    }
  }
  return [...buckets]
    .map(([key, values]) => ({
      key,
      label: TAG_BY_ID.get(key)?.label ?? key,
      n: values.length,
      median: median(values)!,
    }))
    .filter((r) => r.n >= min)
    .sort((a, b) => b.median - a.median);
}

export function priceBySaleType(min = 8): PriceRow[] {
  return rows(
    listings,
    (l) => ({ key: l.saleType, label: SALE_TYPE_LABELS[l.saleType] ?? l.saleType }),
    (l) => l.startingPrice?.amount ?? null,
    min,
  );
}

/**
 * How the archive moves year to year. Hearing year rather than publication year:
 * a price belongs to the hearing it was offered at.
 */
export function priceByYear(min = 5): Array<{
  year: number;
  n: number;
  medianStarting: number | null;
  medianOff: number | null;
}> {
  const years = new Map<number, Listing[]>();
  for (const l of listings) {
    const year = Number(l.saleDate.slice(0, 4));
    years.set(year, [...(years.get(year) ?? []), l]);
  }
  return [...years]
    .map(([year, items]) => ({
      year,
      n: items.length,
      medianStarting: median(
        items.map((l) => l.startingPrice?.amount).filter((n): n is number => n != null),
      ),
      medianOff: median(items.map(discount).filter((d): d is number => d !== null)),
    }))
    .filter((y) => y.n >= min)
    .sort((a, b) => a.year - b.year);
}

/** Median discount off the appraisal, by which hearing it is. */
export function discountByRound(): Array<Slice & { median: number | null }> {
  return Object.keys(ROUND_LABELS)
    .map((key) => {
      const items = listings.filter((l) => l.auctionRound === key);
      return {
        key,
        label: ROUND_SHORT[key] ?? 'nepoznato',
        count: items.length,
        median: median(items.map(discount).filter((d): d is number => d !== null)),
      };
    })
    .filter((r) => r.count > 0);
}

// ── Map ─────────────────────────────────────────────────────────────────────

export interface MapPlace {
  name: string;
  at: LatLon;
  upcoming: number;
  total: number;
  /** Placed at the court's seat because the notice named no municipality. */
  approximate: boolean;
}

export interface MapData {
  places: MapPlace[];
  /** Listings shown at their own municipality. */
  exact: number;
  /** Listings shown at their court's seat instead. */
  bySeat: number;
  /** Listings with no coordinate at all, so absent from the map entirely. */
  unplaced: number;
}

/**
 * Where the archive is, as points.
 *
 * A notice names a municipality only when the extractor could read one, which is
 * most of the time but not always. Rather than dropping the rest, they fall back
 * to the seat of the court that published them - a court's catchment is local,
 * so the seat is the right answer to within a district. The page prints how many
 * landed each way, because a dot placed by fallback is a weaker claim than a dot
 * placed by the document.
 */
export function mapData(items: Listing[] = listings): MapData {
  const buckets = new Map<string, { at: LatLon; upcoming: number; total: number; exact: boolean }>();
  let exact = 0;
  let bySeat = 0;
  let unplaced = 0;

  for (const l of items) {
    const own = l.location?.municipality ?? null;
    // The settlement is the finer locator, but this map's unit is the
    // municipality - resolving to it first would scatter one town across a
    // dozen hamlet dots. It earns its place one rung down instead: when the
    // notice's municipality is missing or unknown to the gazetteer, a village
    // still puts the sale in the right part of the country, which the court's
    // seat only does by luck.
    const settlement = l.location?.settlement ?? null;
    const seat = COURT_PLACE[l.courtId] ?? null;
    // Resolved to the table's own spelling rather than the notice's, so that
    // "SARAJEVO" and "Sarajevo" are one dot of the right size instead of two
    // half-sized ones drawn on top of each other.
    const name = canonicalPlace(own) ?? canonicalPlace(settlement) ?? canonicalPlace(seat);
    if (!name) {
      unplaced++;
      continue;
    }
    const isExact = canonicalPlace(own) !== null || canonicalPlace(settlement) !== null;
    isExact ? exact++ : bySeat++;

    const bucket = buckets.get(name) ?? { at: placeOf(name)!, upcoming: 0, total: 0, exact: false };
    bucket.total++;
    if (isUpcoming(l)) bucket.upcoming++;
    bucket.exact ||= isExact;
    buckets.set(name, bucket);
  }

  return {
    places: [...buckets]
      .map(([name, b]) => ({ name, at: b.at, upcoming: b.upcoming, total: b.total, approximate: !b.exact }))
      // Biggest first, so the small dots are painted over the large ones rather
      // than swallowed by them.
      .sort((a, b) => b.total - a.total),
    exact,
    bySeat,
    unplaced,
  };
}

/** Courts that have a coordinate, with their open-hearing counts. */
export function courtPoints(): Array<{
  id: number;
  name: string;
  place: string;
  at: LatLon;
  upcoming: number;
  total: number;
}> {
  return courts
    .filter((c) => placeOf(COURT_PLACE[c.id]))
    .map((c) => ({
      id: c.id,
      name: c.name,
      place: COURT_PLACE[c.id],
      at: placeOf(COURT_PLACE[c.id])!,
      upcoming: upcoming.filter((l) => l.courtId === c.id).length,
      total: c.count,
    }))
    .sort((a, b) => b.upcoming - a.upcoming || a.name.localeCompare(b.name, 'bs'));
}
