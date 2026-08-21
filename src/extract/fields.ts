import type { Money, SaleType } from '../schema.ts';
import { fold, toLatin } from '../lib/text.ts';
import { toNominative } from './municipality.ts';
import { parseCadastral, type Cadastral } from './cadastral.ts';

/**
 * Rule-based extraction of the fields a bidder actually needs.
 *
 * BiH sale notices are formulaic enough that regexes carry most of the load:
 * they are generated from a small set of court templates and share stock
 * phrases ("utvrđena je vrijednost", "osiguranje u iznosu od", "ročište za
 * prvu prodaju"). Everything here works on Latin-transliterated text so a
 * single pattern set covers both scripts.
 */

export interface ExtractedFields {
  caseNumber: string | null;
  appraisedValue: Money | null;
  startingPrice: Money | null;
  deposit: Money | null;
  auctionRound: 'prvo' | 'drugo' | 'trece' | 'nepoznato';
  saleMethod:
    | 'usmeno-javno-nadmetanje'
    | 'neposredna-pogodba'
    | 'prikupljanje-ponuda'
    | 'nepoznato';
  saleTime: string | null;
  auctionLocation: string | null;
  viewingInfo: string | null;
  cadastral: Cadastral | null;
  municipality: string | null;
  itemDescription: string | null;
  /**
   * Sum of every plausible KM amount printed in the notice. An extracted value
   * cannot exceed this: whatever it is, it has to be composed of figures that
   * actually appear in the document.
   */
  amountsTotal: number;
}

/**
 * BiH case numbers look like "65 0 Ip 1177038 25 Ip" or "126 0 I 221246 23 I":
 * court code, a zero, a procedure marker, sequence, two-digit year, marker.
 */
// The trailing marker is drawn from a fixed set of procedure codes. Allowing
// any short word let a truncated place name in ("… 24 Bije" from "Bijeljina").
const MARKER = String.raw`(?:Ips|Ipl|Ip|I|Kom|Kmp|Mals|Mal|Ps|Pl|P|Su|Rev|Ri|Reg|Fi)`;
const CASE_RE = new RegExp(
  String.raw`\b(\d{2,3})\s+0\s+(${MARKER})\s+(\d{4,9})\s+(\d{2})\s+(${MARKER}(?:\s*\d)?)\b`,
  'i',
);

export function parseCaseNumber(text: string): string | null {
  const m = toLatin(text).match(CASE_RE);
  if (!m) return null;
  return `${m[1]} 0 ${m[2]} ${m[3]} ${m[4]} ${m[5]}`.replace(/\s+/g, ' ').trim();
}

/**
 * Parse a BiH-formatted amount. The convention is `1.234.567,89` (dot for
 * thousands, comma for decimals), but notices are inconsistent, so we decide
 * which separator is decimal by looking at the last one present.
 */
export function parseAmount(raw: string): number | null {
  let s = raw.replace(/\s| /g, '');
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');

  if (lastComma > -1 && lastDot > -1) {
    if (lastComma > lastDot) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(/,/g, '');
  } else if (lastComma > -1) {
    // A comma with exactly 3 digits after it is a thousands separator.
    s = /,\d{3}$/.test(s) ? s.replace(/,/g, '') : s.replace(',', '.');
  } else if (lastDot > -1) {
    // Some courts write "2.000.00", using the dot as both thousands and
    // decimal separator. A trailing group of 1–2 digits is the decimal part;
    // a trailing group of 3 means every dot was a thousands separator.
    const trailing = s.length - lastDot - 1;
    if (trailing === 3) s = s.replace(/\./g, '');
    else s = s.slice(0, lastDot).replace(/\./g, '') + '.' + s.slice(lastDot + 1);
  }
  const n = Number.parseFloat(s);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * Money extraction is context-classified rather than pattern-matched.
 *
 * Fixed patterns fail on this corpus because the amount usually *follows* a
 * description ("…nekretnine … iznose 47.425,06 KM") while the keyword that
 * identifies it ("utvrđene vrijednosti") appears in a different clause. Worse,
 * every notice opens with the debt being enforced ("radi naplate duga u iznosu
 * od 1.000,00 KM", "v.sp. 7.452,58 KM"), which naive patterns readily mistake
 * for a sale price.
 *
 * So: find every KM amount, inspect the words immediately before it, and
 * classify. Amounts we cannot classify are discarded rather than guessed at.
 */
// Only typographic spaces (nbsp / thin space) may appear inside a number. A
// plain space would let "1.500,00 2.067,00 KM" match as one 12-digit amount.
const AMOUNT_RE = /([\d][\d.,\u00a0\u2009\u202f]{0,18}\d|\d)\s*(?:KM|BAM|K\.M\.)\b/gi;

/**
 * Ceiling for a single amount. Set above the largest genuine sale seen (a
 * 74.5M KM stake in a coke plant) but far below the magnitudes a parse error
 * produces.
 */
const MAX_PLAUSIBLE = 150_000_000;

type AmountRole = 'debt' | 'deposit' | 'floor' | 'appraised' | 'item' | 'unknown';

interface ClassifiedAmount {
  amount: number;
  role: AmountRole;
  /** Denominator when the text expresses this as a fraction of the value. */
  fractionOfValue: number | null;
  /** For item prices: whether the wording called it a starting price. */
  startingPriceWording: boolean;
  /** The amount ends its own short line - the shape of a price-list row. */
  looksLikeListRow: boolean;
}

/** The ~130 characters before an amount decide what that amount is. */
function classify(ctx: string): { role: AmountRole; fractionOfValue: number | null } {
  const c = ctx.toLowerCase();

  // The claim being enforced - never a sale price.
  if (/v\.\s?sp\.|radi\s+naplate|nov[cč]anog\s+potra[zž]ivanja|duguje|glavnog\s+duga/.test(c)) {
    return { role: 'debt', fractionOfValue: null };
  }

  // A price attached to an enumerated item, e.g. a dotted leader
  // ("Kosačica … 30kg................500,00 KM") or a bulleted list entry
  // ("- umivaonik, po početnoj cijeni od 100,00 KM"). These are per-item and
  // must be summed, not maxed, to describe the lot.
  if (/\.{4,}\s*$/.test(ctx) || /(?:^|[-–•])\s*[^.;:]{3,80}(?:po\s+)?po[cč]etn\w*\s+cijen\w*\s+od\s*$/i.test(ctx)) {
    return { role: 'item', fractionOfValue: null };
  }

  // Security payable by bidders, frequently stated as a tenth of the value.
  if (/jemstv|u[cč]e[sš][cć]|osiguranj|kapar|depozit|predujam|garantni/.test(c)) {
    const frac = c.match(/1\s*\/\s*(\d{1,2})|(desetin|petin)/);
    let denom: number | null = null;
    if (frac) denom = frac[1] ? Number(frac[1]) : frac[2].startsWith('deset') ? 10 : 5;
    return { role: 'deposit', fractionOfValue: denom };
  }

  // A price floor for one of the hearings.
  if (/ispod|ne\s+mo[zž]e\s+.{0,30}prodati|manje\s+od|najni[zž]|po[cč]etn|polazn|ne\s+smije/.test(c)) {
    let denom: number | null = null;
    const pct = c.match(/(\d{2})\s*%/);
    if (pct) denom = 100 / Number(pct[1]);
    else if (/tre[cć]in|1\s*\/\s*3/.test(c)) denom = 3;
    else if (/polovin|1\s*\/\s*2/.test(c)) denom = 2;
    return { role: 'floor', fractionOfValue: denom };
  }

  // The established/appraised value itself.
  if (/utvr[dđ]en|procijenjen|procenjen|tr[zž]i[sš]n|vrijednost|vrednost|iznose|iznosi|vrijede/.test(c)) {
    return { role: 'appraised', fractionOfValue: null };
  }

  return { role: 'unknown', fractionOfValue: null };
}

/**
 * `text` must keep its newlines: line geometry is what distinguishes an
 * inventory row ("LCD TV 500,00 KM") from a value stated in prose.
 */
function classifyAmounts(text: string): ClassifiedAmount[] {
  const out: ClassifiedAmount[] = [];
  for (const m of text.matchAll(AMOUNT_RE)) {
    const amount = parseAmount(m[1]);
    if (amount === null || amount <= 0 || amount > MAX_PLAUSIBLE) continue;

    const at = m.index ?? 0;
    const ctx = text.slice(Math.max(0, at - 130), at).replace(/\n/g, ' ');
    const { role, fractionOfValue } = classify(ctx);

    const lineStart = text.lastIndexOf('\n', at) + 1;
    const lineEnd = text.indexOf('\n', at);
    const rest = text.slice(at + m[0].length, lineEnd === -1 ? undefined : lineEnd);
    out.push({
      amount,
      role,
      fractionOfValue,
      startingPriceWording: /po[cč]etn|najni[zž]|polazn/i.test(ctx),
      looksLikeListRow: rest.trim().length <= 2 && at - lineStart < 130,
    });
  }
  return out;
}

/** Statutory ceiling on a bidder's security under both entities' enforcement laws. */
const DEPOSIT_CAP = 10_000;

function pickMoney(amounts: ClassifiedAmount[]): {
  appraised: Money | null;
  floor: Money | null;
  deposit: Money | null;
} {
  const of = (role: AmountRole) => amounts.filter((a) => a.role === role);
  const money = (n: number): Money => ({ amount: Math.round(n * 100) / 100, currency: 'BAM' });

  // Several short lines that each end in an amount are an inventory list
  // ("Ugaona garnitura … 1.200,00 KM" / "LCD TV 500,00 KM"), even without
  // bullets or dotted leaders. One such line on its own is just a sentence,
  // so require at least two before treating them as a per-item breakdown.
  const listRows = amounts.filter(
    (a) => a.looksLikeListRow && a.role !== 'debt' && a.role !== 'deposit' && a.role !== 'floor',
  );
  if (listRows.length >= 2) for (const row of listRows) row.role = 'item';

  // Per-item prices describe one lot, so their sum is the figure that matters.
  const items = of('item');
  const itemTotal = items.reduce((sum, a) => sum + a.amount, 0);
  const itemsAreStartingPrices = items.some((a) => a.startingPriceWording);

  const deposits = of('deposit');
  // Prefer a deposit at or under the statutory cap; a larger figure in a
  // deposit sentence is usually the value it is derived from.
  const depositPick = deposits.find((d) => d.amount <= DEPOSIT_CAP) ?? null;

  // Notices list per-parcel values then a total, so the largest wins.
  const explicit = of('appraised');
  let appraised = explicit.length ? Math.max(...explicit.map((a) => a.amount)) : null;

  const floors = of('floor');
  let floorPick = floors.length ? Math.max(...floors.map((f) => f.amount)) : null;

  // Movable-property sales often state only a per-item starting price and no
  // appraisal at all; fold those totals into whichever field they describe.
  if (itemTotal > 0 && itemTotal <= MAX_PLAUSIBLE) {
    if (itemsAreStartingPrices) floorPick ??= itemTotal;
    else appraised ??= itemTotal;
  }

  // With no explicit value, reconstruct it from a stated fraction, e.g.
  // "ispod polovine (1/2) utvrđene vrijednosti, tj. 23.712,53 KM" ⇒ value = 2×.
  if (appraised === null) {
    const derivable = floors.find((f) => f.fractionOfValue) ?? deposits.find((d) => d.fractionOfValue);
    if (derivable?.fractionOfValue) appraised = derivable.amount * derivable.fractionOfValue;
  }

  // A floor above the appraised value means something was mis-classified.
  const floorOk = floorPick !== null && (appraised === null || floorPick <= appraised * 1.01);

  return {
    appraised: appraised !== null ? money(appraised) : null,
    floor: floorOk && floorPick !== null ? money(floorPick) : null,
    deposit: depositPick ? money(depositPick.amount) : null,
  };
}

export function extractFields(text: string, title = ''): ExtractedFields {
  const t = toLatin(`${title}\n${text}`);
  const flat = t.replace(/\n+/g, ' ');

  const amounts = classifyAmounts(t);
  const { appraised, floor, deposit } = pickMoney(amounts);

  return {
    amountsTotal: amounts.reduce((sum, a) => sum + a.amount, 0),
    caseNumber: parseCaseNumber(t),
    appraisedValue: appraised,
    startingPrice: floor,
    deposit,
    auctionRound: parseRound(flat),
    saleMethod: parseMethod(flat),
    saleTime: parseTime(flat),
    auctionLocation: parseAuctionLocation(flat),
    viewingInfo: parseViewing(flat),
    cadastral: parseCadastral(t),
    municipality: parseMunicipality(flat),
    itemDescription: null,
  };
}

function parseRound(raw: string): ExtractedFields['auctionRound'] {
  // Match on folded text: notices mix "ročište"/"rociste"/"рочиште" freely.
  const t = fold(raw);
  const noun = String.raw`(?:\w+\s+){0,2}(?:rociste|rocistu|rocista|prodaj\w*|nadmetanj\w*)`;
  if (new RegExp(String.raw`\b(?:prv[aeoiu]m?)\s+${noun}`).test(t)) return 'prvo';
  if (new RegExp(String.raw`\brociste\s+za\s+prvu\s+prodaju`).test(t)) return 'prvo';
  if (new RegExp(String.raw`\b(?:drug[aeoiu]m?)\s+${noun}`).test(t)) return 'drugo';
  if (new RegExp(String.raw`\brociste\s+za\s+drugu\s+prodaju`).test(t)) return 'drugo';
  if (new RegExp(String.raw`\b(?:trec[aeoiu]m?g?)\s+${noun}`).test(t)) return 'trece';
  if (new RegExp(String.raw`\brociste\s+za\s+trecu\s+prodaju`).test(t)) return 'trece';
  return 'nepoznato';
}

function parseMethod(raw: string): ExtractedFields['saleMethod'] {
  const t = fold(raw);
  if (/neposredn\w+\s+pogodb\w+/.test(t)) return 'neposredna-pogodba';
  if (/prikupljanj\w+\s+(?:pismenih\s+)?ponud\w+/.test(t)) return 'prikupljanje-ponuda';
  if (/usmen\w*\s*(?:javn\w*\s*)?nadmetanj\w+|javn\w*\s+nadmetanj\w+/.test(t))
    return 'usmeno-javno-nadmetanje';
  return 'nepoznato';
}

/** Times appear as "9,00 sati", "09.00 časova", "10:30 sati". */
function parseTime(t: string): string | null {
  const m = t.match(/\b([0-2]?\d)[.,:]\s?([0-5]\d)\s*(?:sati|sat[i]?|casova|časova|h\b)/i);
  if (m) {
    const h = Number(m[1]);
    if (h <= 23) return `${String(h).padStart(2, '0')}:${m[2]}`;
  }
  const bare = t.match(/\bu\s+([0-2]?\d)\s*(?:sati|casova|časova)\b/i);
  if (bare) {
    const h = Number(bare[1]);
    if (h <= 23) return `${String(h).padStart(2, '0')}:00`;
  }
  return null;
}

/**
 * The room/building where bidding happens. This is a court address, not a
 * debtor address, so it is safe to publish.
 */
function parseAuctionLocation(t: string): string | null {
  const m = t.match(
    /\b(?:u\s+)?(?:zgradi\s+)?(?:prostorijama\s+)?(?:Opcinskog|Općinskog|Osnovnog|Kantonalnog|Okruznog|Okružnog|Privrednog|ovog)\s+sud[au][^.]{0,140}/i,
  );
  const raw = m?.[0] ?? t.match(/\b(?:soba|kancelarij[ai]|ured|sudnic[ai])\s*(?:br(?:oj)?\.?\s*)?[\dA-Za-z\/.-]{1,12}/i)?.[0];
  if (!raw) return null;

  // Court headers run the venue into the case number and into procedural
  // clauses; keep only the venue itself.
  const trimmed = raw
    .replace(/\s*\bbroj\s+\d{2,3}\s+0\s+.*$/i, '')
    .replace(/,?\s*\ba\s+prodaja\s+.*$/i, '')
    .replace(/,?\s*\bul\.?\s*$/i, '')
    .replace(/,?\s*\bod\s+\d+\s*$/i, '')
    .replace(/,?\s*\bdana\s+[\d.\s]*$/i, '')
    .replace(/,?\s*\bu\s*$/i, '');
  return tidy(trimmed);
}

function parseViewing(t: string): string | null {
  const m = t.match(/\b(?:razgledanj\w+|razgledati|pregled\w*)\b[^.]{0,180}/i);
  return m ? tidy(m[0]) : null;
}

/** Municipality from the court's own header line - a locality, not a street. */
function parseMunicipality(t: string): string | null {
  const m = t.match(
    /\b(?:Opcinski|Općinski|Osnovni|Kantonalni|Okruzni|Okružni)\s+(?:privredni\s+)?sud\s+u?\s*([A-ZČĆŽŠĐ][\wČĆŽŠĐčćžšđ]+(?:\s+[A-ZČĆŽŠĐ][\wČĆŽŠĐčćžšđ]+)?)/i,
  );
  if (!m) return null;
  // Headers run straight into the next field ("…U BIJELJINI Broj: 80 0 I …"),
  // so drop label words and re-case the SHOUTED court headers.
  const cleaned = m[1]
    .replace(/\s*\b(?:Broj|Br|Predmet|Posl|Dana|Datum|Sudija)\b.*$/i, '')
    .trim();
  if (!cleaned) return null;
  return toNominative(titleCase(cleaned));
}

function titleCase(s: string): string {
  return s
    .toLocaleLowerCase('bs')
    .split(/\s+/)
    .map((w) => w.charAt(0).toLocaleUpperCase('bs') + w.slice(1))
    .join(' ');
}

function tidy(s: string): string {
  return s.replace(/\s+/g, ' ').replace(/[,;:\s]+$/, '').trim().slice(0, 220);
}

/** Map the feed's category code to our slug, falling back to the label. */
export function normaliseSaleType(code: string | null, label: string | null): SaleType {
  const byCode: Record<string, SaleType> = {
    NEK: 'nekretnine', VOZ: 'vozila', TEH: 'tehnika', NAM: 'namjestaj', OST: 'ostalo',
  };
  if (code && byCode[code]) return byCode[code];
  const l = toLatin(label ?? '').toLowerCase();
  if (/nekretnin|nepokretn/.test(l)) return 'nekretnine';
  if (/vozil|automobil/.test(l)) return 'vozila';
  if (/tehnik|oprem|masin|mašin/.test(l)) return 'tehnika';
  if (/namjesta|namesta/.test(l)) return 'namjestaj';
  return 'ostalo';
}

/** Infer sale type from free text when the source gives no category at all. */
export function inferSaleType(text: string): SaleType {
  const t = toLatin(text).toLowerCase();
  if (/nekretnin|nepokretn|\bstan[auomi]?\b|\bkuc[aeiu]\b|parcel|zemlji[sš]t|poslovn\w+\s+prostor|apartman/.test(t))
    return 'nekretnine';
  if (/\bvozil|putni[cč]k|teretn\w* vozil|marke\s+\w+|registarsk/.test(t)) return 'vozila';
  if (/ma[sš]in|oprem|ure[dđ]aj|kompresor|agregat|tehnik/.test(t)) return 'tehnika';
  if (/namje[sš]taj|name[sš]taj|stolic|orman|krevet/.test(t)) return 'namjestaj';
  return 'ostalo';
}

/** Parse the portal's `dd.MM.yyyy` (sometimes trailing-dotted) into ISO `yyyy-MM-dd`. */
export function parseDate(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const m = raw.trim().match(/^(\d{1,2})\.\s?(\d{1,2})\.\s?(\d{4})\.?$/);
  if (!m) {
    const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
    return iso ? `${iso[1]}-${iso[2]}-${iso[3]}` : null;
  }
  const [, d, mo, y] = m;
  const day = Number(d);
  const month = Number(mo);
  if (day < 1 || day > 31 || month < 1 || month > 12) return null;
  return `${y}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * How far a hearing date may sit from the date the notice was published.
 *
 * A hearing is scheduled weeks to months after publication, never years. The
 * backward slack exists because a handful of archived notices were published
 * shortly after the hearing they announce; the forward bound is what rejects a
 * mistyped year. Both are deliberately loose - this is a typo filter, not a
 * business rule, and a rejected date only falls back to the publication date.
 */
const SALE_DATE_BOUNDS = { backDays: 400, forwardDays: 3 * 365 };

/**
 * The sale date if it can be one, else null.
 *
 * `parseDate` cannot catch this: a mistyped year like `18.07.2924` is perfectly
 * well-formed. Left in, such a date is permanently in the future, so the notice
 * pins itself to the top of the front page and never moves to the archive.
 *
 * Bounded against the publication date rather than against "today" so the
 * verdict does not drift as the archive ages: a notice from 2013 is judged by
 * what was plausible in 2013.
 */
export function plausibleSaleDate(
  date: string | null,
  publishedDate: string | null,
): string | null {
  if (!date) return null;
  if (!publishedDate) return date;

  const days = (Date.parse(date) - Date.parse(publishedDate)) / 86_400_000;
  if (Number.isNaN(days)) return null;
  return days >= -SALE_DATE_BOUNDS.backDays && days <= SALE_DATE_BOUNDS.forwardDays ? date : null;
}
