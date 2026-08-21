import { writeFile } from 'node:fs/promises';
import { readFile } from 'node:fs/promises';
import { PATHS } from '../src/config.ts';
import { ListingFile } from '../src/schema.ts';

/**
 * Generate `src/site/lib/geo.ts`: the country outline and one coordinate per
 * place the dataset mentions.
 *
 * Run by hand (`npm run geo`), not by the build. The site draws a map without
 * tiles, without a map library and without a single third-party request, which
 * only works if the geometry is committed rather than fetched - and the build
 * runs in CI twice a day, where depending on two public APIs would be a way to
 * fail deploys for reasons that have nothing to do with the auctions.
 *
 * Sources, both re-usable with attribution:
 *   - country outline: georgique/world-geojson (ODbL, derived from OSM)
 *   - place coordinates: Nominatim (OpenStreetMap, ODbL)
 *
 * Nominatim's usage policy caps automated use at one request a second and asks
 * for an identifying User-Agent; both are honoured below. Places it cannot find
 * are written out as a comment rather than dropped silently, so a missing dot
 * on the map is traceable to a name rather than to a bug.
 */

const OUTLINE_URL =
  'https://raw.githubusercontent.com/georgique/world-geojson/develop/countries/bosnia_and_herzegovina.json';
const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
const AGENT = 'sudskeprodaje.omarzunic.com geo builder (contact@omarzunic.com)';

/** The map is drawn in this box; everything is projected into it up front. */
const WIDTH = 1000;
const PAD = 8;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ── Places the dataset actually mentions ────────────────────────────────────

const { listings } = ListingFile.parse(JSON.parse(await readFile(PATHS.listings, 'utf8')));

const { toNominative } = await import('../src/extract/municipality.ts');
const { settlementOf } = await import('../src/extract/cadastral.ts');
const { foldPlaceName } = await import('../src/site/lib/place-name.ts');

/**
 * The coordinates already committed, used as a cache rather than a fallback.
 *
 * Every one of them was a Nominatim call at one second apiece, and a name's
 * position does not change between runs. Reusing them turns a rebuild from
 * five minutes of rate-limited fetching into a lookup for everything already
 * known and a request only for what is new. A name that leaves the dataset
 * still leaves the table - this file stays a picture of the current data, not
 * an ever-growing pile - but it costs nothing if it comes back.
 */
const cached = new Map<string, { lat: number; lon: number }>();
try {
  const { PLACES } = await import('../src/site/lib/geo.ts');
  for (const [name, [lat, lon]] of Object.entries(PLACES)) {
    cached.set(foldPlaceName(name), { lat, lon });
  }
} catch {
  // First run, or a half-written file from an interrupted one. Either way the
  // gazetteer is the source of truth and the cache is only ever a shortcut.
}

/**
 * A court's seat, in the nominative. Court names embed it in the locative
 * ("Općinski sud u Bijeljini"), which no gazetteer will match, so the same
 * table the extractor uses for municipalities undoes it here too. Brčko is the
 * one court named after a district rather than a town, so it is named outright.
 */
function seatOf(court: string): string | null {
  if (/br[čc]ko/i.test(court)) return 'Brčko';
  const match = court.match(/\b(?:u|za)\s+(.+)$/i);
  return match ? toNominative(match[1].trim()) : null;
}

/**
 * One place, however many ways the archive spells it.
 *
 * Keyed by the folded name, so "SARAJEVO" and "Sarajevo" are one lookup and
 * one dot rather than two of each. `display` is whichever spelling the data
 * uses most - the table has to print something, and the majority spelling is
 * the least surprising thing to read in a warning or a diff. `within` is the
 * municipality the rows put this place in, kept because a hamlet is often
 * only findable with it (see variantsOf).
 */
interface Place {
  display: string;
  spellings: Map<string, number>;
  within: Map<string, number>;
}

const places = new Map<string, Place>();
const courtPlace = new Map<number, string>();

/** Count one sighting of `name`, optionally inside a municipality. */
function see(name: string, within?: string | null): string {
  const key = foldPlaceName(name);
  const place = places.get(key) ?? {
    display: name,
    spellings: new Map<string, number>(),
    within: new Map<string, number>(),
  };
  place.spellings.set(name, (place.spellings.get(name) ?? 0) + 1);
  if (within && foldPlaceName(within) !== key) {
    place.within.set(within, (place.within.get(within) ?? 0) + 1);
  }
  places.set(key, place);
  return key;
}

for (const l of listings) {
  const municipality = l.location?.municipality ?? null;
  if (municipality) see(municipality);
  // Read through to the cadastral record rather than trusting the stored
  // field, so this table can be refreshed before the next scrape rewrites the
  // archive - the settlement is derived, and deriving it here costs nothing.
  const settlement = l.location?.settlement ?? settlementOf(l.cadastral);
  if (settlement) see(settlement, municipality);
  const seat = seatOf(l.court);
  if (seat) {
    see(seat);
    courtPlace.set(l.courtId, seat);
  }
}

/** The winner of each spelling contest, settled once the counting is done. */
const commonest = (counts: Map<string, number>): string | null =>
  [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'bs'))[0]?.[0] ?? null;

for (const place of places.values()) place.display = commonest(place.spellings)!;

const spellings = [...places.values()].reduce((n, p) => n + p.spellings.size, 0);
console.log(
  `${places.size} distinct places (${spellings} spellings), ${courtPlace.size} courts`,
);

// ── Outline ─────────────────────────────────────────────────────────────────

const outline = await fetch(OUTLINE_URL, { headers: { 'User-Agent': AGENT } }).then((r) => {
  if (!r.ok) throw new Error(`outline: HTTP ${r.status}`);
  return r.json();
});

/** Every ring in the feature collection, as [lon, lat] pairs. */
const rings: Array<Array<[number, number]>> = [];
for (const feature of outline.features) {
  const { type, coordinates } = feature.geometry;
  const polygons = type === 'Polygon' ? [coordinates] : coordinates;
  for (const polygon of polygons) rings.push(polygon[0]);
}
// Only the mainland matters at this size; islands and enclave slivers would
// each cost a subpath to draw a dot-sized speck.
rings.sort((a, b) => b.length - a.length);
const mainland = rings.slice(0, 2).filter((r) => r.length > 40);

const lons = mainland.flat().map(([lon]) => lon);
const lats = mainland.flat().map(([, lat]) => lat);
const bounds = {
  minLon: Math.min(...lons),
  maxLon: Math.max(...lons),
  minLat: Math.min(...lats),
  maxLat: Math.max(...lats),
};

/**
 * Equirectangular, with longitude squeezed by the cosine of the mid latitude.
 * At the width of one country the distortion of anything fancier is invisible,
 * and this keeps the projection to four lines the browser can also run.
 */
const midLat = (bounds.minLat + bounds.maxLat) / 2;
const squeeze = Math.cos((midLat * Math.PI) / 180);
const spanX = (bounds.maxLon - bounds.minLon) * squeeze;
const spanY = bounds.maxLat - bounds.minLat;
const scale = (WIDTH - PAD * 2) / spanX;
const HEIGHT = Math.round(spanY * scale + PAD * 2);

const project = (lat: number, lon: number) => ({
  x: PAD + (lon - bounds.minLon) * squeeze * scale,
  y: PAD + (bounds.maxLat - lat) * scale,
});

/**
 * Ramer-Douglas-Peucker, in projected units. The raw border is ~5,000 points;
 * at 1000px wide, anything under half a pixel of deviation cannot be seen, and
 * dropping it takes the committed path from ~200 kB to a few kB.
 */
function simplify(points: Array<{ x: number; y: number }>, tolerance: number) {
  if (points.length < 3) return points;
  const first = points[0];
  const last = points[points.length - 1];
  const dx = last.x - first.x;
  const dy = last.y - first.y;
  const length = Math.hypot(dx, dy);

  let worst = 0;
  let index = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i];
    const distance = length
      ? Math.abs(dy * p.x - dx * p.y + last.x * first.y - last.y * first.x) / length
      : Math.hypot(p.x - first.x, p.y - first.y);
    if (distance > worst) {
      worst = distance;
      index = i;
    }
  }
  if (worst <= tolerance) return [first, last];
  return [
    ...simplify(points.slice(0, index + 1), tolerance).slice(0, -1),
    ...simplify(points.slice(index), tolerance),
  ];
}

const path = mainland
  .map((ring) => {
    const projected = simplify(
      ring.map(([lon, lat]) => project(lat, lon)),
      0.45,
    );
    const round = (n: number) => Math.round(n * 10) / 10;
    return (
      `M${round(projected[0].x)} ${round(projected[0].y)}` +
      projected
        .slice(1)
        .map((p) => `L${round(p.x)} ${round(p.y)}`)
        .join('') +
      'Z'
    );
  })
  .join('');

console.log(`outline: ${path.length} chars, viewBox 0 0 ${WIDTH} ${HEIGHT}`);

// ── Coordinates ─────────────────────────────────────────────────────────────

const coords = new Map<string, { lat: number; lon: number }>();
const missing: string[] = [];

/**
 * What to ask the gazetteer for a given place, in descending fidelity.
 *
 * Municipality names are what a gazetteer is built out of and hit first try.
 * Cadastral municipalities are not: a hamlet like Donji Butmir shares a name
 * with hamlets in three other countries, or is too small to be indexed under
 * the bare string at all. So the second query says where to look - the
 * municipality the notices themselves put it in - which is the difference
 * between "Donji Butmir" and "Donji Butmir, Ilidža".
 *
 * Each variant costs another second under Nominatim's rate limit, so they run
 * only when the one before found nothing.
 */
function variantsOf(place: Place): string[] {
  const name = place.display;
  const within = commonest(place.within);
  const out = [name];
  if (within) out.push(`${name}, ${within}`);
  // "Grad"/"Selo" are stripped only as a *fallback*, never in the data: Novi
  // Grad, Stari Grad and Zlo Selo are whole names, and cutting them yields
  // "Novi", "Stari", "Zlo". Because the full string is queried first, those
  // three hit before this variant is ever reached - it only fires for the
  // register's qualifiers, "Ilijaš grad" and "Bijeljina selo", which miss.
  const withoutQualifier = name.replace(/\s+(?:selo|grad|naselje)$/i, '').trim();
  if (withoutQualifier !== name && withoutQualifier.length > 1) {
    out.push(withoutQualifier);
    if (within) out.push(`${withoutQualifier}, ${within}`);
  }
  return out;
}

/** One gazetteer lookup. Null means "no usable hit", not "failed". */
async function geocode(query: string): Promise<{ lat: number; lon: number } | null> {
  const url = new URL(NOMINATIM);
  url.searchParams.set('format', 'json');
  url.searchParams.set('countrycodes', 'ba');
  url.searchParams.set('limit', '1');
  // Settlements only: several municipality names also match a street or a
  // river, and a bare query happily returns those.
  url.searchParams.set('featureType', 'settlement');
  url.searchParams.set('q', query);

  const response = await fetch(url, { headers: { 'User-Agent': AGENT } });
  if (!response.ok) throw new Error(`nominatim ${response.status} for ${query}`);
  const [hit] = await response.json();
  return hit ? { lat: Number(hit.lat), lon: Number(hit.lon) } : null;
}

let fetched = 0;
for (const [key, place] of [...places].sort(([a], [b]) => a.localeCompare(b))) {
  const known = cached.get(key);
  if (known) {
    coords.set(place.display, known);
    process.stdout.write(`\r  placed ${coords.size}/${places.size} (${fetched} fetched)`);
    continue;
  }

  let hit: { lat: number; lon: number } | null = null;
  for (const query of variantsOf(place)) {
    fetched++;
    hit = await geocode(query);
    await sleep(1100);
    if (hit) break;
  }

  if (hit) {
    const { lat, lon } = hit;
    // A hit outside the country's own bounding box is a wrong match, not a
    // border town; keeping it would drop a dot into the sea off the viewBox.
    if (
      lat >= bounds.minLat - 0.1 &&
      lat <= bounds.maxLat + 0.1 &&
      lon >= bounds.minLon - 0.1 &&
      lon <= bounds.maxLon + 0.1
    ) {
      coords.set(place.display, {
        lat: Math.round(lat * 1e4) / 1e4,
        lon: Math.round(lon * 1e4) / 1e4,
      });
    } else missing.push(`${place.display} (out of bounds: ${lat}, ${lon})`);
  } else missing.push(place.display);

  process.stdout.write(`\r  placed ${coords.size}/${places.size} (${fetched} fetched)`);
}
console.log();
if (missing.length) console.warn(`not found: ${missing.join(', ')}`);

/** Coordinates are keyed by the display spelling; lookups fold, as the site does. */
const placed = new Map([...coords].map(([name, c]) => [foldPlaceName(name), { name, ...c }]));

// ── Emit ────────────────────────────────────────────────────────────────────

const entries = [...coords]
  .sort(([a], [b]) => a.localeCompare(b, 'bs'))
  .map(([name, c]) => `  ${JSON.stringify(name)}: [${c.lat}, ${c.lon}],`)
  .join('\n');

const courtEntries = [...courtPlace]
  .map(([id, seat]) => [id, placed.get(foldPlaceName(seat))?.name] as const)
  .filter((entry): entry is readonly [number, string] => Boolean(entry[1]))
  .sort((a, b) => a[0] - b[0])
  .map(([id, seat]) => `  ${id}: ${JSON.stringify(seat)},`)
  .join('\n');

const file = `/**
 * Where the places in this dataset are, and the shape of the country they sit in.
 *
 * GENERATED by scripts/build-geo.ts - run \`npm run geo\` after new
 * municipalities appear in the data, and commit the result. It is checked in on
 * purpose: the map ships as one inline SVG with no tiles, no map library and no
 * third-party request, and the twice-daily CI build must not depend on two
 * public APIs being up.
 *
 * Outline: georgique/world-geojson, derived from OpenStreetMap (ODbL).
 * Coordinates: Nominatim / OpenStreetMap contributors (ODbL).
 *
 * Carries no dataset import, so the browser can use it for "courts near me"
 * without pulling in data/listings.json.
 */

import { foldPlaceName } from './place-name.ts';

/** Latitude, longitude - in that order, as they are spoken. */
export type LatLon = readonly [number, number];

export const VIEW = { width: ${WIDTH}, height: ${HEIGHT} } as const;

/** The projection's frame, in degrees. */
const BOUNDS = {
  minLon: ${bounds.minLon.toFixed(4)},
  maxLon: ${bounds.maxLon.toFixed(4)},
  minLat: ${bounds.minLat.toFixed(4)},
  maxLat: ${bounds.maxLat.toFixed(4)},
};
const SQUEEZE = ${squeeze.toFixed(6)};
const SCALE = ${scale.toFixed(4)};
const PAD = ${PAD};

/**
 * Equirectangular with longitude squeezed by the cosine of the mid latitude -
 * the same projection the outline below was baked with, so dots and border
 * agree. Anything more careful is invisible at the width of one country.
 */
export function project([lat, lon]: LatLon): { x: number; y: number } {
  return {
    x: PAD + (lon - BOUNDS.minLon) * SQUEEZE * SCALE,
    y: PAD + (BOUNDS.maxLat - lat) * SCALE,
  };
}

/** Great-circle distance in kilometres, for "which court is nearest". */
export function distanceKm([aLat, aLon]: LatLon, [bLat, bLon]: LatLon): number {
  const rad = Math.PI / 180;
  const dLat = (bLat - aLat) * rad;
  const dLon = (bLon - aLon) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

/** The national border, already projected into VIEW. */
export const OUTLINE =
  '${path}';

/** One point per place name that appears in the dataset. */
export const PLACES: Record<string, LatLon> = {
${entries}
};

/** Which place each court sits in, by court id. */
export const COURT_PLACE: Record<number, string> = {
${courtEntries}
};

/**
 * Every spelling above, folded, so a lookup does not have to guess which one
 * the table happens to hold. Built once at module load; the table is a few
 * hundred entries and the site asks it a question per listing.
 */
const FOLDED = new Map<string, readonly [string, LatLon]>(
  Object.entries(PLACES).map(([name, at]) => [foldPlaceName(name), [name, at]]),
);

/**
 * The table's own spelling of a name, or null if it does not know the place.
 *
 * Two rows that mean the same town have to land in the same bucket on the map,
 * or one town is drawn as two half-sized dots side by side. Callers that group
 * by place group by this.
 */
export const canonicalPlace = (name: string | null | undefined): string | null =>
  (name ? FOLDED.get(foldPlaceName(name))?.[0] : undefined) ?? null;

/** Where a place is, whatever case, hyphens or diacritics the name arrived in. */
export const placeOf = (name: string | null | undefined): LatLon | null =>
  (name ? FOLDED.get(foldPlaceName(name))?.[1] : undefined) ?? null;
`;

await writeFile('src/site/lib/geo.ts', file);
console.log(
  `wrote src/site/lib/geo.ts - ${coords.size} places (${fetched} geocoder requests), ` +
    `${courtEntries.split('\n').length} courts`,
);
