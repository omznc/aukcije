import type { Listing } from '../../schema.ts';
import { TAG_BY_ID } from '../../extract/items.ts';

/**
 * A short, human headline for a listing.
 *
 * The extracted description is an inventory line, not a title: it carries
 * prices, quantities, registration plates and chassis numbers, and is often a
 * semicolon-joined list. Rendering it as a heading produces things like
 *
 *   "TMV marke „Iveco", tip Daily, reg.ozn. M09-J263,; plave boje, Broj šasije: ZCFC…"
 *
 * So we strip the bookkeeping, keep the first couple of item names, and fall
 * back to a category-and-place label when nothing legible survives.
 */

/** Trailing price/quantity bookkeeping attached to an inventory line. */
const PRICE_TAIL =
  /(?:[-–—,;]\s*)?(?:u\s+)?(?:po\s+)?(?:procij?enjen\w*|procjenjen\w*|utvr[dđ]en\w*|po[cč]etn\w*|najni[zž]\w*|tr[zž]i[sš]n\w*)?\s*(?:vrij?ednost\w*|cijen\w*|cjen\w*)?\s*(?:od\s*)?[\d][\d.,\s ]*\s*(?:KM|BAM)\b.*$/i;

/** Identifiers that mean nothing to a browsing human. */
const IDENTIFIERS =
  /\b(?:reg\.?\s*(?:ozn?\.?|oznake|tablice)|broj\s+[sš]asije|serijski\s+broj|br\.?\s*[sš]asije|ser\.?\s*br\.?|chassis|vin)\b\s*[:.]?\s*[\w-]*/gi;

const QUANTITY = /\b(?:\d+\s*)?(?:kom(?:ada|\.)?|kpl\.?|komplet|par[ai]?)\b\.?/gi;

const NOISE_PREFIX = /^(?:i\s+to|te\s+|a\s+|u\s+naravi)\b[\s,:-]*/i;

/** Leftover reference numbers inside an item name ("Kompresor … br: 6806"). */
const INLINE_REF = /\s*\bbr\.?\s*:?\s*\d[\w-]*/gi;

/** A parenthetical aside is detail, not a name ("( broj sjedišta 57)"). */
const PARENTHETICAL = /\s*\([^)]*\)/g;

/**
 * Land-registry prose. These descriptions are legally precise and completely
 * unreadable as a heading, so property listings get their own headline below.
 */
const CADASTRAL_PROSE =
  /^(?:zk|z\.k|nekretnin\w*\s+upisan|parcel|k\.?[cč]\.?\s*(?:br|\d)|katastarsk|zemlji[sš]noknji)/i;

/** What the property physically is, in the order we prefer to name it. */
const PROPERTY_KINDS: Array<[RegExp, string]> = [
  [/\bposlovn\w+\s+prostor/i, 'Poslovni prostor'],
  [/\bstambena\s+zgrada|\bstambeni\s+objek/i, 'Stambeni objekat'],
  [/\bku[cć]a\b|\bku[cć]e\b/i, 'Kuća'],
  [/\bstan\b|\bstana\b/i, 'Stan'],
  [/\bgara[zž]/i, 'Garaža'],
  [/\boranic/i, 'Oranica'],
  [/\bnjiv/i, 'Njiva'],
  [/\blivad/i, 'Livada'],
  [/\bpa[sš]njak/i, 'Pašnjak'],
  [/\bvo[cć]njak/i, 'Voćnjak'],
  [/\b[sš]uma\b|\b[sš]ume\b/i, 'Šuma'],
  [/\bdvori[sš]t/i, 'Dvorište'],
  [/\bgradili[sš]t/i, 'Građevinsko zemljište'],
  [/\bhala\b|\bmagacin|\bskladi[sš]t/i, 'Poslovni objekat'],
];

/** "Oranica 1.217 m², Hrasnica" beats a paragraph of land-registry references. */
function propertyHeadline(l: Listing): string | null {
  const text = [l.itemDescription, l.title].filter(Boolean).join(' ');
  if (!text) return null;

  const kind = PROPERTY_KINDS.find(([re]) => re.test(text))?.[1];
  if (!kind) return null;

  const area = text.match(/povr[sš]ine\s+(?:od\s+)?([\d][\d.,]*)\s*m\s*[²2]/i)?.[1];
  // The cadastral municipality is where the property actually is;
  // `location.municipality` only records the court's own seat.
  const place = l.cadastral?.ko?.[0]?.replace(/^SP[_\s]*/i, '') ?? l.location?.municipality ?? null;

  const parts = [kind];
  if (area) parts.push(`${area} m²`);
  const head = parts.join(' ');
  return place ? `${head} - ${placeCase(place)}` : head;
}

/** Words that only ever appear mid-sentence, marking a wrapped fragment. */
const CONTINUATION =
  /^(?:klase|zvan[aeoi]|ozna[cč]en\w*|povr[sš]ine|upisan\w*|u\s+naravi|na\s+koj\w*|sa\s+|te\s+|koj\w*|dok\s|kao\s)\b/i;

function cleanFragment(raw: string): string | null {
  let s = raw
    .replace(PRICE_TAIL, '')
    .replace(IDENTIFIERS, '')
    .replace(PARENTHETICAL, '')
    .replace(INLINE_REF, '')
    .replace(QUANTITY, '')
    .replace(NOISE_PREFIX, '')
    .replace(/,?\s*\bgp\.?\s*\d{4}\.?(?:,\s*\w+)?\s*$/i, '')
    .replace(/[„“”"']/g, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s,;:.\-–—]+|[\s,;:.\-–—]+$/g, '')
    .trim();

  if (s.length < 3) return null;
  if (CONTINUATION.test(s)) return null;
  // A fragment that is only digits/units carries no meaning.
  if (!/[a-zčćžšđ]{3,}/i.test(s)) return null;
  // Drop leftover colour-only or condition-only fragments ("Plave boje").
  if (/^(?:[\wčćžšđ]+\s+)?boje$/i.test(s)) return null;
  if (/^(?:neispravan|ispravan|nov[aio]?|polovn\w*|rabljen\w*|gp\.?\s*\d{4}\.?)$/i.test(s)) return null;
  if (CADASTRAL_PROSE.test(s)) return null;
  return s;
}

/** Cadastral names are often SHOUTED in the source ("SP_ HRASNICA"). */
function placeCase(s: string): string {
  if (!/^[A-ZČĆŽŠĐ\s_-]+$/.test(s)) return s;
  return s
    .toLocaleLowerCase('bs')
    .replace(/(^|[\s-])(\p{L})/gu, (_, sep, ch) => sep + ch.toLocaleUpperCase('bs'));
}

/** Sentence-case a fragment without destroying acronyms like TV or PMV. */
function sentenceCase(s: string): string {
  if (/^[A-ZČĆŽŠĐ]{2,}\b/.test(s)) return s;
  return s.charAt(0).toLocaleUpperCase('bs') + s.slice(1);
}

/** Category-and-place label, used when the description yields nothing legible. */
function fallback(l: Listing): string {
  const tagLabel = l.itemTags.length ? TAG_BY_ID.get(l.itemTags[0])?.label : null;
  const base =
    tagLabel ??
    ({
      nekretnine: 'Nekretnina',
      vozila: 'Vozilo',
      tehnika: 'Tehnička oprema',
      namjestaj: 'Namještaj',
      ostalo: 'Pokretne stvari',
    }[l.saleType] ?? 'Sudska prodaja');

  const place = l.location?.municipality;
  return place ? `${base} - ${place}` : base;
}

export function headline(l: Listing): string {
  // A model-written headline reads far better than anything assembled from the
  // inventory line, so prefer it when the analysis produced one.
  if (l.headline && l.headline.trim().length >= 4) return l.headline.trim();

  // Property notices are land-registry prose; name the thing instead.
  if (l.saleType === 'nekretnine') {
    const property = propertyHeadline(l);
    if (property) return property;
  }

  const source = l.itemDescription;
  if (source) {
    const fragments = source
      .split(/;|(?<=\))\s*,|,\s*(?=[A-ZČĆŽŠĐ][a-zčćžšđ])/)
      .map(cleanFragment)
      .filter((f): f is string => f !== null);

    if (fragments.length) {
      let out = fragments.slice(0, 3).map(sentenceCase).join(', ');
      if (fragments.length > 3) out += ` i još ${fragments.length - 3}`;
      // Very long single fragments are usually cadastral prose; trim politely.
      if (out.length > 92) out = `${out.slice(0, 89).replace(/[\s,;.-]+$/, '')}…`;
      if (out.length >= 8) return out;
    }
  }
  return fallback(l);
}

/**
 * A one-line supporting detail for the card, kept separate from the headline so
 * the heading stays short while the useful specifics remain visible.
 */
export function subline(l: Listing): string | null {
  if (!l.itemDescription) return null;
  const h = headline(l);
  const d = l.itemDescription.replace(/\s{2,}/g, ' ').trim();
  // Only worth showing when it adds something beyond the headline.
  return d.length > h.length + 12 ? d : null;
}
