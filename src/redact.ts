import { toLatin } from './lib/text.ts';

/**
 * Personal-data minimisation.
 *
 * BiH's Law on Personal Data Protection ("Sl. glasnik BiH" 12/25, in force
 * 8 Mar 2025, applied from 4 Oct 2025) is GDPR-aligned. Court sale notices are
 * lawfully published by the courts, but that does not make wholesale
 * re-publication of debtor identities proportionate for an aggregator.
 *
 * The policy implemented here:
 *  - We never emit the notice body. Only structured, bidder-relevant fields
 *    leave this pipeline; the authoritative full text stays with the court and
 *    we deep-link to it.
 *  - Names attached to a procedural role (izvršenik/tražilac izvršenja/dužnik)
 *    are removed from every string we do publish.
 *  - Street-level addresses are dropped; the municipality is kept, because a
 *    buyer needs to know roughly where the property is.
 *  - National identifiers (JMBG) and contact details are removed outright.
 *
 * Company parties are left intact where they are clearly legal persons - a
 * d.o.o./a.d./j.p. is not personal data - since that information is useful and
 * carries no privacy cost.
 */

const REDACTED = '[uklonjeno]';

/**
 * Markers of a *legal* person. A company name is not personal data, so these
 * are preserved.
 *
 * Deliberately excludes `s.p.` / `s.z.r.` (samostalni preduzetnik): a sole
 * trader is a natural person trading under a business name, so "Gorana Trkulje
 * s.p." must still have the name removed.
 */
const LEGAL_FORM = String.raw`(?:d\.?\s?o\.?\s?o\.?|d\.?\s?d\.?|a\.?\s?d\.?|j\.?\s?p\.?|d\.?\s?n\.?\s?o\.?|k\.?\s?d\.?|banka|osiguranje|mikrokredit|telekom|elektro)`;

/** Roles after which a party is named. */
const ROLE = String.raw`(?:izvr[sš]enik\w*|izvr[sš]enic\w*|tra[zž]io\w*\s+izvr[sš]enja|du[zž]ni\w*|protivnik\w*\s+osiguranja|tu[zž]en\w*|prodav\w*|zalo[zž]n\w*\s+du[zž]ni\w*|vlasnik\w*)`;

/**
 * Where a party designation ends. Quotes open a trade name, a legal form means
 * we were reading a company, and these conjunctions start a new clause.
 */
const PARTY_STOP = String.raw`["„“”']|\b${LEGAL_FORM}\b|\bradi\b|\bzbog\b|\bu\s+predmetu\b|\bu\s+iznosu\b|\bprotiv\b`;

/**
 * Remove the party designation that follows a procedural role.
 *
 * Consuming a fixed one-to-three capitalised words is not enough: real titles
 * read "izvršenika Samostalni prevoznik Stevo Đajić iz Laktaša", where the
 * person's name sits *after* an occupation. So we consume the whole clause up
 * to a stop, then decide what it was:
 *
 *   - stopped by a legal form  → it was a company name, keep it
 *   - stopped by a quote       → a person introducing a trade name, drop the person
 *   - stopped by punctuation, a conjunction or end of string → drop it
 */
function redactParties(input: string): string {
  const re = new RegExp(
    String.raw`(${ROLE}\s*:?\s+)((?:(?!${PARTY_STOP})[^,.;:()\n])+)`,
    'gi',
  );

  return input.replace(re, (match, role: string, party: string, offset: number) => {
    const after = input.slice(offset + match.length, offset + match.length + 12);
    // "Komunalac a.d." - the run we just consumed is a company name.
    if (new RegExp(String.raw`^\s*${LEGAL_FORM}\b`, 'i').test(after)) return match;
    // Nothing but whitespace or an already-redacted marker.
    if (!party.trim() || party.includes(REDACTED)) return match;
    // Preserve the party's trailing space so the marker does not collide with
    // whatever follows it ("[uklonjeno]„Dnp" → "[uklonjeno] „Dnp").
    const gap = /\s$/.test(party) ? ' ' : '';
    return `${role}${REDACTED}${gap}`;
  });
}

export function redactText(input: string | null | undefined): string | null {
  if (!input) return null;
  let s = input;

  // 1. National identification number (JMBG) and similar long digit runs.
  s = s.replace(/\b\d{13}\b/g, REDACTED);

  // 2. The named party following a procedural role.
  s = redactParties(s);

  // 3. Quoted or possessive personal addresses: "ul. Kneza Miloša br. 43".
  s = s.replace(
    /\b(?:ul\.|ulica|ulici)\s+[^,;.()]{2,60}?\s*(?:br(?:oj)?\.?\s*\d+[a-zA-Z]?)/gi,
    REDACTED,
  );
  // Bare "bb" addresses (bez broja) are equally identifying.
  s = s.replace(/\b(?:ul\.|ulica)\s+[^,;.()]{2,40}\s+bb\b/gi, REDACTED);

  // 4. Direct contact details.
  s = s.replace(/\b[\w.+-]+@[\w-]+\.[\w.]{2,}\b/g, REDACTED);
  s = s.replace(/\b(?:\+387|0)\s?\d{2}[\s/-]?\d{3}[\s-]?\d{3}\b/g, REDACTED);

  return s.replace(/\s{2,}/g, ' ').trim();
}

/**
 * Titles routinely embed the debtor's name, e.g.
 * "Prva prodaja nepokretnosti izvršenika Marka Markovića".
 * The item description in parentheses is the useful part and is kept.
 */
export function redactTitle(title: string): string {
  return redactText(title) ?? title;
}

/**
 * Does the text name a court? A court's own address is public infrastructure,
 * which is what makes the venue exempt from the street-address redaction above.
 *
 * Room and building words ("kancelarija", "soba", "ured", "zgrada") deliberately
 * do NOT count: every venue names a room, so accepting them exempts any address
 * that happens to end in an office number - including a bankruptcy sale held on
 * the debtor company's own premises. `\bsud` covers the declensions and
 * "sudnica"/"sudski"; the Cyrillic fold makes "суд" count too.
 *
 * `scripts/verify.ts` asserts this same predicate over the published dataset, so
 * it must stay the single definition - the two drifting apart is what wedged the
 * scrape: the pipeline published a venue the verifier then refused.
 */
export function namesACourt(text: string): boolean {
  return /\bsud/i.test(toLatin(text));
}

export function redactVenue(venue: string | null): string | null {
  if (!venue) return null;
  const cleaned = venue.replace(/\b\d{13}\b/g, REDACTED).trim();

  // A street address is only publishable here because it is the courthouse. If
  // nothing in the text names a court, its provenance is unclear - drop it
  // rather than publish an unattributed address.
  const hasStreet = /\b(?:ul\.|ulica|ulici)\s+\S/i.test(cleaned);
  if (hasStreet && !namesACourt(cleaned)) return null;

  return cleaned;
}
