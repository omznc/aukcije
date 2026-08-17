/**
 * What a lot actually costs once you have won it.
 *
 * The notice states one number - the starting price - and every bidder then
 * discovers the rest separately: the deposit that has to be on the court's
 * account beforehand, the transfer tax, the registry fee, the thirty days in
 * which the balance falls due. Putting them in one place is the difference
 * between "1.350 KM" and the sum someone needs to have, on the day they need it.
 *
 * Dataset-free on purpose: the calculator recomputes as the bid is typed, in
 * the browser.
 *
 * Three kinds of number live in this file and they are not interchangeable:
 *
 *   STATUTE   - written in the law, quoted with the article. The deposit rule
 *               and the payment deadline are of this kind.
 *   OBSERVED  - measured off this archive, with the sample size. The price floor
 *               per hearing is of this kind: the statute was amended in December
 *               2024 and secondary sources still print the superseded fractions,
 *               but 2.686 notices do not disagree with each other.
 *   ASSUMED   - the site's own guess, editable on the page. The registry fee is
 *               of this kind and is labelled as a guess rather than quoted.
 *
 * Anything the site cannot source, it says it cannot source. A calculator that
 * prints a confident wrong number is worse than one that asks.
 */

export type Entity = 'FBiH' | 'RS' | 'BD';

/**
 * Who the law names as liable for the transfer tax.
 *
 * This is the field that matters most and the one this file previously had
 * wrong: five of the ten cantons tax the SELLER, and at a court sale the seller
 * is the debtor whose property is being sold - not you. Charging every FBiH
 * buyer a flat 5% added a tax they do not owe to 451 of the 1.168 real-estate
 * notices in the archive.
 */
export type Payer = 'kupac' | 'prodavac';

export type Canton = 'USK' | 'PK' | 'TK' | 'ZDK' | 'BPK' | 'SBK' | 'HNK' | 'ZHK' | 'KS' | 'K10';

export interface TransferTaxRule {
  /** Fraction of the base, 0..1. */
  rate: number;
  payer: Payer;
  /**
   * What the rate applies to. Nowhere is it simply "what you bid": the cantonal
   * laws assess a market value, which at a court sale can exceed the price
   * achieved - potentially by the whole multiple between appraisal and floor.
   */
  basis: 'trzisna' | 'postignuta';
}

/** Full names, because two of the ten do not take the word "kanton" as a suffix. */
export const CANTON_LABEL: Record<Canton, string> = {
  USK: 'Unsko-sanski kanton',
  PK: 'Posavski kanton',
  TK: 'Tuzlanski kanton',
  ZDK: 'Zeničko-dobojski kanton',
  BPK: 'Bosansko-podrinjski kanton',
  SBK: 'Srednjobosanski kanton',
  HNK: 'Hercegovačko-neretvanski kanton',
  ZHK: 'Zapadnohercegovački kanton',
  KS: 'Kanton Sarajevo',
  K10: 'Kanton 10',
};

/**
 * Transfer tax by canton. The rate is 5% almost everywhere; the payer is not,
 * and that is the difference between a bid costing 5% more and costing nothing
 * more. Sarajevo moved the liability to the buyer in January 2019.
 */
export const CANTON_TAX: Record<Canton, TransferTaxRule> = {
  KS: { rate: 0.05, payer: 'kupac', basis: 'trzisna' },
  USK: { rate: 0.05, payer: 'kupac', basis: 'trzisna' },
  PK: { rate: 0.05, payer: 'kupac', basis: 'trzisna' },
  HNK: { rate: 0.05, payer: 'kupac', basis: 'trzisna' },
  K10: { rate: 0.05, payer: 'kupac', basis: 'trzisna' },
  TK: { rate: 0.05, payer: 'prodavac', basis: 'trzisna' },
  ZDK: { rate: 0.05, payer: 'prodavac', basis: 'trzisna' },
  SBK: { rate: 0.05, payer: 'prodavac', basis: 'trzisna' },
  ZHK: { rate: 0.05, payer: 'prodavac', basis: 'trzisna' },
  // The one canton that names the price achieved at a forced sale as the base,
  // rather than a separately assessed market value.
  BPK: { rate: 0.05, payer: 'prodavac', basis: 'postignuta' },
};

/**
 * Which canton a court sits in. Keyed by the portal's court id, because the
 * municipality field is the notice's own wording and drifts into settlements
 * ("Kobilja Glava", "Nišići") and alphabets ("Лукавац"); the court is a closed
 * set of two dozen and never ambiguous.
 */
export const COURT_CANTON: Record<number, Canton> = {
  20: 'USK', // Cazin
  23: 'USK', // Velika Kladuša
  25: 'PK', // Orašje
  28: 'TK', // Gradačac
  32: 'TK', // Tuzla
  33: 'TK', // Živinice
  36: 'ZDK', // Kakanj
  39: 'ZDK', // Tešanj
  42: 'ZDK', // Zavidovići
  43: 'ZDK', // Zenica
  44: 'ZDK', // Žepče
  45: 'BPK', // Goražde
  46: 'SBK', // Bugojno
  51: 'SBK', // Travnik
  53: 'HNK', // Čapljina
  55: 'HNK', // Čitluk
  56: 'HNK', // Konjic
  58: 'HNK', // Mostar
  64: 'ZHK', // Široki Brijeg
  65: 'KS', // Sarajevo
  68: 'K10', // Livno
  126: 'TK', // Lukavac
  127: 'TK', // Banovići
  128: 'SBK', // Jajce
};

/** VAT, where the debtor is a VAT payer and the lot is first-transfer or business property. */
export const VAT_RATE = 0.17;

/**
 * Deposit: ZIP FBiH čl. 86 st. 3 - one tenth of the assessed value, and no more
 * than 10.000 KM.
 *
 * The archive agrees to the decimal: median deposit over appraisal is exactly
 * 0,100 across 1.418 notices that state both, and the largest deposit among all
 * 1.702 is 10.000 KM - which 406 of them sit on precisely.
 */
export const DEPOSIT_FRACTION = 0.1;
export const DEPOSIT_CAP = 10_000;

/** ZIP FBiH čl. 92 st. 1 - the court sets the deadline and it cannot exceed 30 days. */
export const PAYMENT_DEADLINE_DAYS = 30;

/**
 * The lowest price a hearing may accept, as a fraction of the appraisal.
 *
 * OBSERVED, not quoted. Of 343 FBiH first hearings for real estate that state
 * both figures, 334 open at exactly one half; of 117 second hearings, 110 at
 * exactly one third. RS and Brčko land on the same two fractions.
 */
export const ROUND_FLOOR: Record<string, number | null> = {
  prvo: 0.5,
  drugo: 1 / 3,
  trece: 1 / 3,
  nepoznato: null,
};

/** Where a figure came from, so the page can say so beside it. */
export type Provenance = 'oglas' | 'zakon' | 'procjena';

export const PROVENANCE_LABEL: Record<Provenance, string> = {
  oglas: 'iz oglasa',
  zakon: 'po zakonu',
  procjena: 'procjena',
};

/** The slice of a listing the calculator needs. Keeps this file free of the dataset. */
export interface Lot {
  entity: Entity;
  courtId: number;
  saleType: string;
  auctionRound: string;
  appraised: number | null;
  starting: number | null;
  deposit: number | null;
}

export function cantonOf(courtId: number): Canton | null {
  return COURT_CANTON[courtId] ?? null;
}

/**
 * The deposit, preferring the notice and falling back to the statutory rule.
 * 984 notices state none; 577 of those state an appraisal, which is all the
 * rule needs. Treating a silent notice as a zero deposit told those bidders the
 * whole price was due after the hearing.
 */
export function depositFor(lot: Lot): { amount: number; from: Provenance } | null {
  if (lot.deposit !== null) return { amount: lot.deposit, from: 'oglas' };
  if (lot.appraised === null || lot.appraised <= 0) return null;
  return { amount: Math.min(lot.appraised * DEPOSIT_FRACTION, DEPOSIT_CAP), from: 'zakon' };
}

/**
 * The lowest bid this hearing can accept. The notice's own starting price is
 * that figure by definition; where it is missing, the round's fraction of the
 * appraisal reconstructs it.
 */
export function floorFor(lot: Lot): { amount: number; from: Provenance } | null {
  if (lot.starting !== null && lot.starting > 0) return { amount: lot.starting, from: 'oglas' };
  const fraction = ROUND_FLOOR[lot.auctionRound];
  if (fraction === null || fraction === undefined) return null;
  if (lot.appraised === null || lot.appraised <= 0) return null;
  return { amount: lot.appraised * fraction, from: 'procjena' };
}

/**
 * Court and registry fees.
 *
 * ASSUMED. Court fees in FBiH are set by cantonal tariff and scale with value;
 * we could not source the ten tariff tables, so rather than quote a figure we
 * use a shape that is at least not absurd at either end - the flat 200 KM this
 * replaced was too much on a 3.000 KM lot and far too little on a 300.000 KM
 * one. The page renders this as an editable field and labels it a guess.
 */
export function feesFor(price: number, saleType: string): number {
  if (price <= 0) return 0;
  if (saleType !== 'nekretnine') {
    // No land registry entry. What remains is transfer paperwork, and for a
    // vehicle also re-registration.
    return saleType === 'vozila' ? 150 : 0;
  }
  return Math.round(Math.min(Math.max(price * 0.005, 100), 1500) / 10) * 10;
}

export interface TaxSeed {
  canton: Canton | null;
  /** The rate the page puts in the box - zero where the buyer is not the taxpayer. */
  rate: number;
  /** The statutory rate, whoever it falls on. */
  statutoryRate: number;
  payer: Payer | null;
  basis: TransferTaxRule['basis'] | null;
  /** Why the box says what it says, in one paragraph, in Bosnian. */
  note: string;
}

/**
 * What to seed the tax field with, and the sentence that explains it. The three
 * entities are three different regimes, and inside FBiH there are ten more.
 */
export function taxSeedFor(lot: Lot): TaxSeed {
  const none = { canton: null, rate: 0, statutoryRate: 0, payer: null, basis: null } as const;

  if (lot.saleType !== 'nekretnine') {
    return {
      ...none,
      note:
        lot.saleType === 'vozila'
          ? 'Za vozila nema poreza na promet nekretnina. Prenos vlasništva i registracija se plaćaju posebno i uračunati su u takse. Da li se i po kojoj stopi plaća porez na promet polovnih vozila, nismo mogli pouzdano utvrditi - provjerite kod nadležne poreske uprave.'
          : 'Za pokretne stvari nema poreza na promet nekretnina. Ako je izvršenik u sistemu PDV-a, na prodaju se može obračunati PDV.',
    };
  }

  if (lot.entity === 'RS') {
    return {
      ...none,
      note: 'Republika Srpska je 2012. ukinula porez na promet nepokretnosti, pa ga kupac ne plaća. Od upisa nadalje, međutim, plaćate godišnji porez na nepokretnosti po stopi koju određuje opština - do 0,20%, odnosno do 0,10% za nepokretnosti u kojima se obavlja proizvodnja.',
    };
  }

  if (lot.entity === 'BD') {
    return {
      canton: null,
      rate: 0.03,
      statutoryRate: 0.03,
      payer: 'kupac',
      basis: 'trzisna',
      note: 'U Brčko distriktu porez na promet nepokretnosti plaća kupac. Stopu i osnovicu potvrdite kod Poreske uprave Distrikta.',
    };
  }

  const canton = cantonOf(lot.courtId);
  if (!canton) {
    return {
      canton: null,
      rate: 0.05,
      statutoryRate: 0.05,
      payer: null,
      basis: null,
      note: 'Porez na promet nekretnina u FBiH je kantonalni, a kanton ovog suda nismo mogli odrediti. 5% je najčešća stopa - provjerite propis svog kantona i, važnije, ko je po njemu obveznik.',
    };
  }

  const rule = CANTON_TAX[canton];
  const pct = (rule.rate * 100).toFixed(0);
  const where = CANTON_LABEL[canton];

  if (rule.payer === 'prodavac') {
    return {
      canton,
      rate: 0,
      statutoryRate: rule.rate,
      payer: 'prodavac',
      basis: rule.basis,
      note: `U ovom kantonu (${where}) obveznik poreza na promet nekretnina je prodavac, a kod sudske prodaje prodavac je izvršenik - ne vi. Zato polje stoji na nuli. Porez time ne nestaje i u praksi zna zaustaviti upis dok nije plaćen, pa ako računate da ćete ga snositi, upišite ${pct}%.`,
    };
  }

  return {
    canton,
    rate: rule.rate,
    statutoryRate: rule.rate,
    payer: 'kupac',
    basis: rule.basis,
    note: `U ovom kantonu (${where}) obveznik je kupac, po stopi od ${pct}%.${
      rule.basis === 'trzisna'
        ? ' Osnovica nije vaša ponuda nego tržišna vrijednost koju utvrđuje nadležna komisija, a kod sudske prodaje ona zna biti bliža procijenjenoj nego postignutoj cijeni.'
        : ' Osnovica kod prisilne prodaje je postignuta prodajna cijena.'
    }`,
  };
}

export interface CostInput {
  /** What you intend to bid. */
  bid: number;
  /** Deposit - from the notice where stated, otherwise the statutory rule. */
  deposit: number | null;
  /** Transfer tax or VAT as a fraction, 0..1, as the visitor has it set. */
  taxRate: number;
  /** What the tax is charged on. Defaults to the bid. */
  taxBase?: number | null;
  /** Registry, court and paperwork fees, in KM. */
  fees: number;
  /** Anything the visitor adds themselves: vacating, debts, legalisation. */
  other?: number;
}

export interface CostBreakdown {
  bid: number;
  deposit: number;
  /** Due within the court's deadline: the bid less the deposit already lodged. */
  balance: number;
  tax: number;
  fees: number;
  other: number;
  total: number;
  /** On the court's account before the hearing starts, or you cannot bid at all. */
  beforeHearing: number;
  /** Everything that follows winning, most of it inside the deadline. */
  afterHearing: number;
}

export function costs({
  bid,
  deposit,
  taxRate,
  taxBase,
  fees,
  other = 0,
}: CostInput): CostBreakdown {
  const lodged = Math.min(deposit ?? 0, bid);
  const tax = Math.max(0, taxBase ?? bid) * taxRate;
  // The deposit counts toward the price rather than being an extra charge - a
  // calculator that adds it on top overstates the cost by 10%.
  const balance = Math.max(0, bid - lodged);
  return {
    bid,
    deposit: lodged,
    balance,
    tax,
    fees,
    other,
    total: bid + tax + fees + other,
    beforeHearing: lodged,
    afterHearing: balance + tax + fees + other,
  };
}

/**
 * Costs this calculator does not carry, because no notice states them and
 * inventing a figure would be worse than naming the risk. Mostly real estate:
 * they are what separates the price from what people actually end up spending.
 */
export const UNPRICED: Array<{ title: string; body: string; types: string[] }> = [
  {
    title: 'Iseljenje',
    body: 'Predmet se prodaje u zatečenom stanju i može biti useljen. Ispražnjenje se traži posebno, traje i košta.',
    types: ['nekretnine'],
  },
  {
    title: 'Zaostali računi',
    body: 'Dugovi prethodnog vlasnika pravno ne prelaze na vas, ali komunalna preduzeća u praksi znaju uslovljavati priključak njihovim izmirenjem.',
    types: ['nekretnine'],
  },
  {
    title: 'Etažiranje i legalizacija',
    body: 'Ako objekat nije upisan ili nije etažiran, upis vašeg prava traži postupak koji sud ne vodi umjesto vas.',
    types: ['nekretnine'],
  },
  {
    title: 'Stanje predmeta',
    body: 'Procjena je starija od ročišta i često rađena bez uvida iznutra. Popravke se ne vide u cijeni.',
    types: ['nekretnine', 'vozila', 'tehnika', 'namjestaj', 'ostalo'],
  },
];

/** What you are not paying, which people routinely budget for out of habit. */
export const NOT_PAYABLE = [
  'notara - rješenje o dosudi je isprava za upis, ugovor se ne sačinjava',
  'agencijsku proviziju - prodaje sud, ne posrednik',
];

/**
 * Whole marks in BiH notation, grouped by a dot.
 *
 * Spelled out rather than handed to `toLocaleString('bs-BA')`, which is what
 * the build uses: browsers do not all carry Bosnian locale data, and Chromium
 * silently falls back to English grouping - turning 450.000 KM into "450,000
 * KM", which reads here as four hundred and fifty. A number that changes
 * meaning depending on the browser is worse than one that is merely plain.
 */
export function formatKm(amount: number): string {
  return `${Math.round(amount)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, '.')} KM`;
}
