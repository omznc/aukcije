import { fold } from '../lib/text.ts';

/**
 * Pull the "what is actually being sold" text out of a notice.
 *
 * Court notices name the goods in one of a few shapes:
 *   1. In the title, parenthesised — "… izvršenika (Kosačica za travu …)".
 *   2. One plain line per item after a colon — the most common shape.
 *   3. A bulleted or numbered list.
 *   4. An inventory table with a "Opis | Kom. | Vrijednost" header row.
 *
 * The failure mode worth guarding against is emitting procedural prose or a
 * bare table header instead of the goods: that is worse than emitting nothing,
 * because on the site it looks like a real description. Everything is therefore
 * validated by `isUsableDescription` before it is returned.
 */

/** Phrases that mean we have drifted out of the goods list into procedure. */
const PROCEDURAL = new RegExp(
  [
    'rociste', 'kancelarij', 'sudnic', 'prodaja ce se', 'prodaja ce', 'prikupljanj',
    'zainteres', 'kupac je duzan', 'napominj', 'videno', 'jemstv', 'osiguranj',
    'ponud', 'izvrsenik\\w* je', 'pravo prece', 'porez', 'troskov',
    'vrijednost navedenih', 'utvrdena je zapisnik', 'ovlascuje', 'objavit', 'objaviti',
    'zakljucak', 'zakon\\w* o izvrs', 'clan\\w*\\s+\\d', 'stav\\s+\\d', 'pravna pouka',
    'sudija', 'zalba', 'prigovor', 'oglasn\\w* (?:tabl|ploc)', 'ne mogu se prodati',
    'ne moze se prodati', 'stranke mogu', 'u roku od',
    // Boilerplate observed leaking into descriptions in practice:
    'konstatuje se', 'odreduje se', 'izvrsno odjeljenje', 'sa pocetkom',
    'na (?:prvom|drugom|trecem) rocist', 'u tacki', 'ovog zakljucka', 'rjesenjem o',
    'sredstva izvrsenja', 'promjeni predmeta', 'sudsk\\w* izvrsitelj',
    'javno nadmetanje', 'javnog nadmetanja', 'nadmetanje ce se', 'odrzat ce se',
    'odrzace se', 'slovima', 'izvrsni odjel', 'u prostorijama',
  ].join('|'),
);

/**
 * Column labels from inventory tables. These arrive glued to the front of an
 * extracted list ("Opis; Količina; Procijenjena vrijednost; Viljuškar …").
 */
const TABLE_HEADER =
  /^(?:\s*(?:red\.?\s*br\.?|r\.?\s*br\.?|opis(?:\s+popisan\w*(?:\s+stvari)?)?|naziv|koli[cč]ina|kom\.?|komada|j\.?\s?m\.?|jedinica mjere|procijenjena|procjenjena|utvr[dđ]ena|vrijednost|cijena|ukupno)\b[\s;,.:|-]*)+/i;

/** Strip leading table-column labels; returns null if nothing else remains. */
function stripTableHeader(s: string): string | null {
  const stripped = s.replace(TABLE_HEADER, '').trim();
  return stripped.length >= 6 ? stripped : null;
}

/** A leading date/time fragment is a line-wrap artefact, not a description. */
function startsWithDateFragment(s: string): boolean {
  const t = s.trim();
  return (
    /^\d{1,2}[./]\d{2,4}\.?\s*(?:godine|god\.?)?\b/.test(t) ||
    /^\d{1,2}[,:]\d{2}\b/.test(t) ||
    // "za dan UTORAK 18.11.2025. godine u 13:30 sati"
    /^za\s+dan\b/i.test(t) ||
    // A bare amount, e.g. "944,00 KM, (slovima: …)"
    /^[\d.,]+\s*KM\b/i.test(t)
  );
}

export function isUsableDescription(s: string | null): boolean {
  if (!s) return false;
  const trimmed = s.trim();
  if (trimmed.length < 8) return false;
  if (startsWithDateFragment(trimmed)) return false;
  // A single word is a truncation ("Određuje"), never a description.
  if (!/\s/.test(trimmed)) return false;
  // Nothing but table column labels ("Red. Br. Opis … Kom. Vrijednost").
  if (stripTableHeader(trimmed) === null) return false;

  const f = fold(trimmed);
  // Procedural wording near the start means we grabbed the wrong span.
  if (PROCEDURAL.test(f.slice(0, 90))) return false;
  // A short description that is mostly procedural is no better.
  if (PROCEDURAL.test(f) && f.length < 140) return false;
  // Must contain something that could be a noun.
  if (!/[a-zčćžšđ]{3,}/i.test(trimmed)) return false;
  return true;
}

/** Rejoin hard line breaks from PDF/Word extraction and trim list punctuation. */
export function tidy(s: string): string {
  return s
    .replace(/-\n(?=\p{Ll})/gu, '')
    .replace(/\s*\n\s*/g, ' ')
    .replace(/\.{3,}/g, ' — ')
    .replace(/\s{2,}/g, ' ')
    .replace(/;\s*;/g, ';')
    .replace(/^[\s\-–—•;,:]+|[\s;,]+$/g, '')
    .trim();
}

/** Is this line a plausible goods entry rather than prose or a header? */
function isItemLine(line: string): boolean {
  if (line.length < 4) return false;
  const f = fold(line);
  if (PROCEDURAL.test(f)) return false;
  if (startsWithDateFragment(line)) return false;
  if (TABLE_HEADER.test(line) && !stripTableHeader(line)) return false;
  return true;
}

function collectItems(lines: string[]): string[] {
  const items: string[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (PROCEDURAL.test(fold(line))) break;
    // A numbered clause after the list marks the return to procedure.
    if (/^\d{1,2}\.\s+[A-ZČĆŽŠĐ]/.test(line) && items.length) break;

    const body = line.replace(/^(?:[-–—•*]|\d{1,3}[.)])\s*/, '').trim();
    if (!isItemLine(body)) continue;
    items.push(stripTableHeader(body) ?? body);
    if (items.length >= 12) break;
  }
  return items;
}

/**
 * The most common shape: a clause ending in a colon, then one line per item.
 *
 *   ODREĐUJE SE prvo ročište … radi prodaje pokretnih stvari izvršenika:
 *   Ugaona garnitura vrijednost 1.200,00 KM
 *   LCD TV 500,00 KM
 */
function fromColonList(text: string): string | null {
  const lines = text.split('\n');
  const start = lines.findIndex(
    (l) => /prodaj\w*|\bi\s+to\b|popisan\w*/i.test(l) && /[:;]\s*$/.test(l.trim()),
  );
  if (start === -1) return null;
  const items = collectItems(lines.slice(start + 1));
  return items.length ? items.join('; ') : null;
}

/** Items from an explicit bullet or numbered list anywhere in the notice. */
function fromBulletList(text: string): string | null {
  const items: string[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    const bullet = line.match(/^(?:[-–—•*]|\d{1,3}[.)])\s*(.{4,200})$/);
    if (!bullet) {
      if (items.length && PROCEDURAL.test(fold(line))) break;
      continue;
    }
    const body = bullet[1].replace(/\.{3,}.*$/, '').trim();
    if (!isItemLine(body)) continue;
    items.push(body);
    if (items.length >= 12) break;
  }
  return items.length ? items.join('; ') : null;
}

/** Inventory tables: "Red. br. | Opis popisanih stvari | Kom. | Vrijednost". */
function fromInventoryTable(text: string): string | null {
  if (!/opis\s+popisan|red\.?\s*br\.?.{0,40}(?:opis|naziv)/i.test(fold(text))) return null;
  const after = text.split(/opis\s+popisan\w*\s+stvari|red\.?\s*br\.?/i).slice(1).join(' ');
  const parts = after
    .split(/\s(?=\d{1,3}\.\s+[A-ZČĆŽŠĐ])/)
    .map((p) => p.replace(/^\d{1,3}\.\s*/, '').trim())
    .map((p) => stripTableHeader(p) ?? p)
    .filter((p) => isItemLine(p))
    .slice(0, 10)
    // Drop trailing quantity/price columns.
    .map((p) => p.replace(/\s+\d[\d.,\s]*$/, '').replace(/\s+kom\.?\s*\d+.*$/i, '').trim())
    .filter((p) => p.length > 4);
  return parts.length ? parts.join('; ') : null;
}

/** Prose right after "i to:" / "sljedeće stvari:". */
function fromSaleClause(text: string): string | null {
  const m = text.match(
    /(?:prodaj[ua]\s+(?:se\s+)?(?:sljede[cć]\w+|slede[cć]\w+|popisan\w+)[^:]{0,60}:|(?:^|\s)i\s+to\s*:)/i,
  );
  if (!m || m.index === undefined) return null;
  const from = m.index + m[0].length;
  const tail = text.slice(from, from + 900);
  const stop = tail.search(
    /(?:Prikupljanje|Ro[cč]i[sš]te|Prodaja\s+se|Napominje|Kupac\s+je|Zainteres|Popisane|Izvr[sš]eniku\s+je|Konstatuje)/i,
  );
  const body = tidy(stop > 20 ? tail.slice(0, stop) : tail);
  return stripTableHeader(body) ?? body;
}

/**
 * Best available description, most trustworthy shape first. Returns null rather
 * than something misleading.
 */
export function describeItem(text: string, title: string): string | null {
  const paren = title.match(/\(([^)]{6,300})\)/);
  const candidates = [
    paren ? tidy(paren[1]) : null,
    fromColonList(text),
    fromBulletList(text),
    fromInventoryTable(text),
    fromSaleClause(text),
  ];

  for (const candidate of candidates) {
    if (!candidate) continue;
    const cleaned = tidy(stripTableHeader(candidate) ?? candidate).slice(0, 400);
    if (isUsableDescription(cleaned)) return cleaned;
  }
  return null;
}
