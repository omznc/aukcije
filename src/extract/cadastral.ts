/**
 * Cadastral identifiers, and the place name they imply.
 *
 * Three things travel together in a real-estate notice: k.č. (the parcel),
 * z.k. uložak (the land-registry folio) and k.o. (katastarska općina, the
 * cadastral municipality). The first two are numbers; the third is a name, and
 * it is the finest location this dataset is allowed to carry.
 *
 * That matters more than it looks. Street addresses are removed on purpose
 * (see src/redact.ts), so without the k.o. every flat in Ilidža is "Ilidža".
 * With it, the notice says Binježevo - a village, not a municipality of 70,000.
 *
 * Both the regexes here and the model in extract/analyze.ts produce these
 * fields, and both produce junk in the same way: they latch onto the notice's
 * boilerplate and report "PRVOJ PRODAJI" as a cadastral municipality. So the
 * cleaning below is applied to whichever reader supplied the value, rather
 * than living inside the parser that happened to need it first.
 */

export interface Cadastral {
  kc: string[];
  zkUlozak: string[];
  ko: string[];
}

/**
 * Vocabulary that only ever occurs in the procedural prose around a notice.
 * A cadastral municipality is a settlement name; none of these are.
 *
 * The second line is a different kind of wrong answer: real place vocabulary,
 * at the wrong scale. "Distrikt Brčko", "Federacija BiH" and "Republika
 * Srpska" are an entity or a district - a k.o. sits inside one, it is never
 * named as one - and an "Općina ..." is the municipality field's answer,
 * not this one.
 */
const PROCEDURAL =
  /prodaj|zaklju[čc]|izvr[šs]|ro[čc]i[šs]t|nekretnin|pokretn|kanton|[žz]upanij|nadmetanj|osiguranj|vozil|motorn|predmet|ugovor|vlasni[šs]tv|iznos|marak|sudij|kupac/i;
const WRONG_SCALE = /distrikt|federacij|republik|entitet|op[ćc]in|op[šs]tin/i;

/**
 * A bare ordinal left behind by "zaključak o prvoj prodaji".
 *
 * Matched whole rather than as a prefix: `drug\w*` would also throw away
 * Drugovići, which is a real place.
 */
const ORDINAL = /^(?:prv|drug|tre[ćc]|[čc]etvrt|pet)(?:a|o|e|i|u|oj|om|og|em)?$/i;

/**
 * Prefixes the registers themselves add to a k.o. name. "SP" marks a
 * *stari premjer* (the pre-1984 survey) and "NP" a *novi premjer*; both name
 * the same ground, so they are noise for anything geographic.
 *
 * The separator is whatever the clerk typed: the archive holds `SP_Dolac`,
 * `SP-Dolac`, `SP – Crnotina`, `S.P.DONJI BUTMIR`, `N.P. Busovača` and one
 * `SPundefined_Vraca` where something upstream stringified a null.
 *
 * The uppercase lookahead is what keeps this from eating real names: a place
 * beginning "SP" only loses the prefix when a capital follows it, so `SPlit`
 * survives intact. That also rules out the `i` flag, which would fold
 * `\p{Lu}` to match lowercase and take the guard with it.
 */
const SURVEY_PREFIX = /^[SN]\.?\s?P\.?(?:undefined)?[\s_.–-]*(?=\p{Lu})/u;

/**
 * The old survey's urban blocks: "SP_Sarajevo –MAHALA LXVI". Safe to match
 * case-insensitively because it is anchored on the literal word.
 */
const MAHALA_SUFFIX = /\s*[–-]?\s*mahala\s+[IVXLC]+\.?$/i;

/**
 * Numbering that subdivides a place for the register rather than naming one:
 * "Sarajevo IV", "Bijeljina 1", "Goražde II.". Roman numerals here run past X
 * - CXXX appears - so the class cannot stop at I/V/X.
 *
 * Two constraints hold this in place, and dropping either corrupts real names.
 * The separator must be whitespace, and the numeral must be uppercase: with a
 * leading `\s*` and an `i` flag, this pattern reads the tail of "Poklečani" as
 * a Roman numeral and files the village under "Poklečan".
 */
const DISTRICT_SUFFIX = /\s+(?:[IVXLC]{1,6}|\d{1,2})\.?$/;

/**
 * A person, where a place should be.
 *
 * The k.o. marker sits close to the parties in a notice, and both readers
 * occasionally take the wrong side of it: "Dobrinka Milivojević" was filed as
 * a cadastral municipality, which would publish a debtor's name under a
 * heading the rest of the pipeline works to keep clear of them.
 *
 * Only the two-word "given name + patronymic surname" shape is rejected, and
 * only for -ović/-ević. A single -ić word cannot be told apart from a village
 * by its ending - Batković is one - so it is left alone; this is a guard
 * against the unmistakable case, not a name detector.
 */
const PERSONAL_NAME = /^\p{Lu}[\p{L}]+\s+\p{Lu}[\p{L}]*(?:ovi[ćc]|evi[ćc])$/u;

/**
 * A syllable, loosely: something that can be said out loud.
 *
 * The archive's placeholders are typed, not read - "xxx" is the one that
 * recurs - and they share the property that no vowel appears anywhere. `r`
 * counts as one, because it carries a syllable of its own here: Trn and Krnjin
 * are settlements, and a rule spelled with only aeiou would throw them out.
 */
const PRONOUNCEABLE = /[aeiour]/i;

/**
 * Is this string a place name at all?
 *
 * Deliberately permissive about *which* place - a gazetteer decides that, and
 * a k.o. that no gazetteer knows is still true information printed on the
 * notice. This only rejects text that cannot be a name in the first place.
 */
function isPlaceName(name: string): boolean {
  if (name.length > 60) return false;
  // Three letters, not three characters: the archive is full of stubs left by
  // a failed read - "SP", "J.", "R.", "SP ...." - that are punctuation with a
  // couple of initials attached, and no settlement here is that short.
  if ((name.match(/\p{L}/gu) ?? []).length < 3) return false;
  if (!PRONOUNCEABLE.test(name)) return false;
  if (ORDINAL.test(name)) return false;
  if (PERSONAL_NAME.test(name)) return false;
  return !PROCEDURAL.test(name) && !WRONG_SCALE.test(name);
}

/**
 * Normalise and filter k.o. names, whatever produced them.
 *
 * Order matters: the survey prefix has to come off before the name is judged,
 * or "SP Dolac" is measured as if the register's own abbreviation were part of
 * the village's name.
 */
export function cleanKoNames(names: readonly string[]): string[] {
  const out = new Set<string>();
  for (const raw of names) {
    const name = raw.replace(SURVEY_PREFIX, '').replace(/\s+/g, ' ').trim();
    if (isPlaceName(name)) out.add(name);
  }
  return [...out].slice(0, 25);
}

/** A parcel or folio number, as printed: digits, optionally "123/4". */
const NUMBER = /^\d{1,7}(?:\/\d{1,4})?$/;

function cleanNumbers(values: readonly string[]): string[] {
  return [...new Set(values.map((v) => v.trim()).filter((v) => NUMBER.test(v)))].slice(0, 25);
}

/**
 * Clean a cadastral record and drop it if nothing survives.
 *
 * Returning null rather than an empty record is what lets the merge fall back
 * to the other reader: a model answer made entirely of boilerplate should lose
 * to the regexes, not silently replace them.
 */
export function sanitiseCadastral(c: Cadastral | null | undefined): Cadastral | null {
  if (!c) return null;
  const kc = cleanNumbers(c.kc ?? []);
  const zkUlozak = cleanNumbers(c.zkUlozak ?? []);
  const ko = cleanKoNames(c.ko ?? []);
  if (!kc.length && !zkUlozak.length && !ko.length) return null;
  return { kc, zkUlozak, ko };
}

/**
 * Cadastral identifiers: k.č. (parcel), z.k. uložak (land-registry folio) and
 * k.o. (cadastral municipality).
 *
 * Notices spell the number label as "br.", "br" or "broj", and freely mix case
 * ("K.o." / "k.o."), so every pattern here has to tolerate all of those.
 */
export function parseCadastral(t: string): Cadastral | null {
  const num = String.raw`(?:br(?:oj)?\.?\s*)?`;
  const kc = collect(
    t,
    new RegExp(String.raw`\b(?:k\.?\s?[cč]\.?|parcel\w*)\s*${num}(\d+(?:\/\d+)?)`, 'gi'),
  );
  const zk = collect(
    t,
    new RegExp(
      String.raw`\b(?:z\.?\s?k\.?|zemlji[sš]noknji[zž]n\w*)\s*(?:ul(?:o[zž]ak|\.)?)?\s*${num}(\d+(?:\/\d+)?)`,
      'gi',
    ),
  );
  const ko = collect(
    t,
    // The name itself must still start with a capital, but the "k.o." marker
    // may be written either way.
    //
    // The leading boundary is spelled out instead of `\b` because JavaScript's
    // `\b` is ASCII-only: it sees a boundary between "Č" and "K", so
    // "HERCEGOVAČKO NERETVANSKI KANTON" parsed as k.o. "NERETVANSKI KANTON".
    /(?<![\p{L}\p{N}])[Kk]\.?\s?[Oo]\.?\s+((?:(?:SP|NP)[_\s]*)?\p{Lu}[\p{L}\p{N}_-]+(?:\s+\p{Lu}[\p{L}\p{N}_-]+)?)/gu,
  );

  return sanitiseCadastral({ kc, zkUlozak: zk, ko });
}

function collect(t: string, re: RegExp): string[] {
  const out = new Set<string>();
  for (const m of t.matchAll(re)) if (m[1]) out.add(m[1].trim());
  return [...out].slice(0, 25);
}

/**
 * The settlement a notice points at, as a place name.
 *
 * District numbering is dropped ("Sarajevo IV" → "Sarajevo") because it
 * subdivides a city for the register's purposes and means nothing on a map;
 * everything else is left exactly as printed, including names that genuinely
 * end in a word like Grad (Mrkonjić Grad) or Varoš (Kotor Varoš). Matching a
 * name to a coordinate is the geocoder's job - see scripts/build-geo.ts - and
 * it can try variants that would be lossy to bake in here.
 *
 * A notice spanning several k.o. keeps the first. In practice they are parcels
 * of one property and share a settlement; where they do not, the alternatives
 * are still published in full under `cadastral.ko`.
 */
export function settlementOf(c: Cadastral | null | undefined): string | null {
  // Cleaned here rather than assumed clean. The pipeline only ever hands this
  // sanitised records, but scripts/build-geo.ts reads the committed archive,
  // whose rows predate that cleaning - trusting the caller sent a few hundred
  // "SP_Dolac" straight to the gazetteer, where every one of them missed.
  const first = cleanKoNames(c?.ko ?? [])[0];
  if (!first) return null;
  const name = first.replace(MAHALA_SUFFIX, '').replace(DISTRICT_SUFFIX, '').trim();
  return isPlaceName(name) ? titleCase(name) : null;
}

/**
 * Give an all-capitals name its ordinary capitals back: "DONJI BUTMIR" is a
 * register writing in caps, not a village spelled that way, and printed as-is
 * it shouts out of a fact table where every neighbouring row is title case.
 *
 * Only all-caps names are touched. A name that already carries a lowercase
 * letter was typed by someone making a choice - "Bijeljina selo" keeps its
 * small s - and is left exactly as printed, which is also what `cadastral.ko`
 * publishes either way.
 */
function titleCase(name: string): string {
  if (name !== name.toUpperCase()) return name;
  // Split on the separators rather than the words, so hyphens and spaces come
  // back where they were: "RIČICE-SVIĆE" is one name with a hyphen in it.
  return name
    .toLowerCase()
    .replace(/(^|[\s\-–_.])(\p{L})/gu, (_, sep: string, first: string) => sep + first.toUpperCase());
}
