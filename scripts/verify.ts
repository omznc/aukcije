import { readFile } from 'node:fs/promises';
import { PATHS } from '../src/config.ts';
import { ListingFile } from '../src/schema.ts';
import { plausibleSaleDate } from '../src/extract/fields.ts';

/**
 * Post-scrape assertions.
 *
 * The failure mode we care about is silent degradation: the portal changes a
 * field name or an endpoint, the scraper still "succeeds", and we quietly
 * publish an empty or gutted dataset. Each check below turns one of those into
 * a loud non-zero exit before anything is committed.
 */
const MIN_LISTINGS = 500;
const MIN_COURTS = 15;
const MIN_PRICE_RATE = 0.6;
const MIN_CASE_RATE = 0.7;

const failures: string[] = [];
const check = (ok: boolean, message: string) => {
  if (!ok) failures.push(message);
  console.log(`  ${ok ? '✓' : '✗'} ${message}`);
};

const parsed = ListingFile.safeParse(JSON.parse(await readFile(PATHS.listings, 'utf8')));
if (!parsed.success) {
  console.error('listings.json does not match the schema:');
  console.error(parsed.error.issues.slice(0, 5));
  process.exit(1);
}
const { listings } = parsed.data;

const courts = new Set(listings.map((l) => l.courtId));
const withPrice = listings.filter((l) => l.appraisedValue ?? l.startingPrice).length;
const withCase = listings.filter((l) => l.caseNumber).length;
const priceRate = withPrice / listings.length;
const caseRate = withCase / listings.length;

console.log('Verifying scraped dataset\n');
check(listings.length >= MIN_LISTINGS, `at least ${MIN_LISTINGS} listings (got ${listings.length})`);
check(courts.size >= MIN_COURTS, `at least ${MIN_COURTS} courts (got ${courts.size})`);
check(priceRate >= MIN_PRICE_RATE, `≥${MIN_PRICE_RATE * 100}% carry a price (got ${(priceRate * 100).toFixed(0)}%)`);
check(caseRate >= MIN_CASE_RATE, `≥${MIN_CASE_RATE * 100}% carry a case number (got ${(caseRate * 100).toFixed(0)}%)`);

check(
  new Set(listings.map((l) => l.id)).size === listings.length,
  'listing ids are unique',
);
check(
  listings.every((l) => /^\d{4}-\d{2}-\d{2}$/.test(l.saleDate)),
  'every sale date is a valid ISO date',
);

// A well-formed date can still be nonsense: courts mistype the year into the
// portal, and "18.07.2924" parses cleanly. Left unchecked it is permanently
// upcoming, so it pins itself to the top of the front page and never expires.
const misdated = listings.filter(
  (l) => plausibleSaleDate(l.saleDate, l.publishedDate) === null,
);
check(
  misdated.length === 0,
  `no sale dates implausibly far from publication (got ${misdated.length}${
    misdated.length ? `: ${misdated.slice(0, 3).map((l) => `${l.id} ${l.saleDate}`).join(', ')}` : ''
  })`,
);

// Real sales do reach tens of millions (an industrial plant, a large property
// portfolio), so this gate only catches magnitudes no auction produces.
const absurd = listings.filter((l) =>
  [l.appraisedValue, l.startingPrice, l.deposit].some((m) => m && m.amount > 150_000_000),
);
check(absurd.length === 0, `no implausible amounts (got ${absurd.length})`);

// A floor above the appraised value means the two were mixed up.
const inverted = listings.filter(
  (l) => l.appraisedValue && l.startingPrice && l.startingPrice.amount > l.appraisedValue.amount * 1.02,
);
check(inverted.length === 0, `no listing prices above their appraised value (got ${inverted.length})`);

// The published dataset must not carry personal identifiers. Document URLs are
// excluded because their SHA-256 hashes trip the digit patterns below.
const blob = JSON.stringify(listings.map((l) => ({ ...l, documents: [] })));
check(!/\b\d{13}\b/.test(blob), 'no 13-digit national identifiers in the published data');
check(!/[\w.+-]+@[\w-]+\.[a-z]{2,}/i.test(blob), 'no e-mail addresses in the published data');

// Street addresses are forbidden everywhere except `auctionLocation`, which is
// the courthouse a bidder has to physically attend - public infrastructure, not
// personal data. That exemption is only safe if the venue really is a court, so
// assert that separately rather than trusting the field name.
// A street address needs an actual street *name* between "ul." and the number.
// This must not fire on land-registry references like "zk. ul. broj 8061" or
// "Z.K.uložak broj 654", which are cadastral data we publish on purpose.
const STREET =
  /(?<!\bz\.?\s?k\.?\s?)(?<!\bzk\.?\s?)\b(?:ul\.|ulica|ulici)\s+(?!broj\b|br\.)[A-ZČĆŽŠĐa-zčćžšđ]{3,}[^,;.()]{0,40}\bbr(?:oj)?\.?\s*\d/;
const leaked = listings.filter((l) =>
  [l.title, l.itemDescription, l.viewingInfo, l.location?.municipality].some(
    (v) => v && STREET.test(v),
  ),
);
check(leaked.length === 0, `no street addresses outside the venue field (got ${leaked.length})`);

// Residual debtor names. Redaction removes the party clause after a procedural
// role, so a capitalised name still sitting there means it failed. This is the
// check that would have caught "izvršenika Samostalni prevoznik Stevo Đajić".
const ROLE = /(?:izvr[sš]enik\w*|izvr[sš]enic\w*|tra[zž]io\w*\s+izvr[sš]enja|du[zž]ni\w*|tu[zž]en\w*|vlasnik\w*)\s*:?\s+/gi;
const CAPITALISED_PAIR = /\b[A-ZČĆŽŠĐ][a-zčćžšđ]{2,}\s+[A-ZČĆŽŠĐ][a-zčćžšđ]{2,}/;
// A legal form means the capitalised words were a company, not a person.
const LEGAL_FORM = /\b(?:d\.?\s?o\.?\s?o\.?|d\.?\s?d\.?|a\.?\s?d\.?|j\.?\s?p\.?|doo|dd|ad)\b/i;

/** Does a party clause still name a natural person? */
function namesAPerson(text: string): boolean {
  for (const m of text.matchAll(ROLE)) {
    const after = text.slice(m.index + m[0].length);
    // Look only at the party clause, not the rest of the sentence.
    const clause = after.split(/[;(]|\bradi\b|\bzbog\b/)[0];
    if (!clause) continue;
    // Already redacted, or a company - either way, not a leak. The legal-form
    // test runs on a wider window because "d.o.o." contains the very dots a
    // sentence split would break it on.
    if (clause.includes('[uklonjeno]')) continue;
    if (LEGAL_FORM.test(after.slice(0, 160))) continue;
    // A quoted trade name is not personal data; check only what precedes it.
    const beforeQuote = clause.split(/["„“”']/)[0];
    if (CAPITALISED_PAIR.test(beforeQuote)) return true;
  }
  return false;
}

const named = listings.filter((l) =>
  [l.title, l.itemDescription, l.headline].some((v) => v && namesAPerson(v)),
);
check(named.length === 0, `no debtor names survive redaction (got ${named.length})`);
if (named.length) {
  for (const l of named.slice(0, 5)) console.log(`      ${l.id}: ${l.title.slice(0, 90)}`);
}

const suspiciousVenues = listings.filter(
  (l) => l.auctionLocation && STREET.test(l.auctionLocation) && !/\bsud/i.test(l.auctionLocation),
);
check(
  suspiciousVenues.length === 0,
  `every venue address belongs to a court (got ${suspiciousVenues.length} that do not)`,
);

console.log();
if (failures.length) {
  console.error(`${failures.length} check(s) failed - refusing to publish.`);
  process.exit(1);
}
console.log(`All checks passed: ${listings.length} listings from ${courts.size} courts.`);
