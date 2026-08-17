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

const places = new Set<string>();
const courtPlace = new Map<number, string>();

for (const l of listings) {
  if (l.location?.municipality) places.add(l.location.municipality);
  const seat = seatOf(l.court);
  if (seat) {
    places.add(seat);
    courtPlace.set(l.courtId, seat);
  }
}

console.log(`${places.size} distinct places, ${courtPlace.size} courts`);

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

for (const name of [...places].sort()) {
  const url = new URL(NOMINATIM);
  url.searchParams.set('format', 'json');
  url.searchParams.set('countrycodes', 'ba');
  url.searchParams.set('limit', '1');
  // Settlements only: several municipality names also match a street or a
  // river, and a bare query happily returns those.
  url.searchParams.set('featureType', 'settlement');
  url.searchParams.set('q', name);

  const response = await fetch(url, { headers: { 'User-Agent': AGENT } });
  if (!response.ok) throw new Error(`nominatim ${response.status} for ${name}`);
  const [hit] = await response.json();

  if (hit) {
    const lat = Number(hit.lat);
    const lon = Number(hit.lon);
    // A hit outside the country's own bounding box is a wrong match, not a
    // border town; keeping it would drop a dot into the sea off the viewBox.
    if (
      lat >= bounds.minLat - 0.1 &&
      lat <= bounds.maxLat + 0.1 &&
      lon >= bounds.minLon - 0.1 &&
      lon <= bounds.maxLon + 0.1
    ) {
      coords.set(name, { lat: Math.round(lat * 1e4) / 1e4, lon: Math.round(lon * 1e4) / 1e4 });
    } else missing.push(`${name} (out of bounds: ${lat}, ${lon})`);
  } else missing.push(name);

  process.stdout.write(`\r  geocoded ${coords.size}/${places.size}`);
  await sleep(1100);
}
console.log();
if (missing.length) console.warn(`not found: ${missing.join(', ')}`);

// ── Emit ────────────────────────────────────────────────────────────────────

const entries = [...coords]
  .sort(([a], [b]) => a.localeCompare(b, 'bs'))
  .map(([name, c]) => `  ${JSON.stringify(name)}: [${c.lat}, ${c.lon}],`)
  .join('\n');

const courtEntries = [...courtPlace]
  .filter(([, seat]) => coords.has(seat))
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

export const placeOf = (name: string | null | undefined): LatLon | null =>
  (name ? PLACES[name] : undefined) ?? null;
`;

await writeFile('src/site/lib/geo.ts', file);
console.log(`wrote src/site/lib/geo.ts - ${coords.size} places, ${courtEntries.split('\n').length} courts`);
