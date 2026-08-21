import type { Analysis } from './analyze.ts';
import type { ExtractedFields } from './fields.ts';
import type { Money, SaleType } from '../schema.ts';
import { inferSaleType } from './fields.ts';
import { isUsableDescription } from './describe.ts';
import { sanitiseCadastral } from './cadastral.ts';

/**
 * Reconcile the model's reading of a notice with the rule-based one.
 *
 * The model is trusted for description and classification, where it is clearly
 * better. Money is the one place it needs supervision: a plausible-looking but
 * wrong number is worse than a missing one, so amounts are accepted only if
 * they satisfy the invariants a real auction must obey, and the deterministic
 * value is used whenever they do not.
 */

/** Statutory ceiling on a bidder's security under both entities' laws. */
const DEPOSIT_CAP = 10_000;
const MAX_PLAUSIBLE = 150_000_000;

function money(n: number | null | undefined): Money | null {
  return typeof n === 'number' && n > 0 && n <= MAX_PLAUSIBLE
    ? { amount: Math.round(n * 100) / 100, currency: 'BAM' }
    : null;
}

export interface MergedFields {
  headline: string | null;
  itemDescription: string | null;
  itemTags: string[];
  caseNumber: string | null;
  appraisedValue: Money | null;
  startingPrice: Money | null;
  deposit: Money | null;
  saleTime: string | null;
  auctionRound: ExtractedFields['auctionRound'];
  saleMethod: ExtractedFields['saleMethod'];
  auctionLocation: string | null;
  municipality: string | null;
  cadastral: ExtractedFields['cadastral'];
  saleType: SaleType | null;
}

/**
 * Money invariants. A price floor above the appraised value, or a deposit
 * larger than the thing being sold, means one of the two numbers was misread.
 */
function reconcileMoney(
  llm: Analysis,
  rules: ExtractedFields,
): Pick<MergedFields, 'appraisedValue' | 'startingPrice' | 'deposit'> {
  // A figure larger than every amount in the document added together cannot
  // have been read off it. This catches the model's worst failure mode: summing
  // a parcel list while dropping the decimal separator, which inflates the
  // result by exactly 100× and still looks like a number a court might print.
  const ceiling = rules.amountsTotal > 0 ? rules.amountsTotal * 1.05 : Number.POSITIVE_INFINITY;
  const bounded = (m: Money | null): Money | null => (m && m.amount > ceiling ? null : m);

  let appraised = bounded(money(llm.appraisedValue)) ?? rules.appraisedValue;
  let starting = bounded(money(llm.startingPrice)) ?? rules.startingPrice;

  // A floor above the value is impossible; prefer whichever the rules derived.
  if (appraised && starting && starting.amount > appraised.amount * 1.02) {
    if (rules.appraisedValue && rules.startingPrice) {
      appraised = rules.appraisedValue;
      starting = rules.startingPrice;
    } else if (rules.appraisedValue) {
      appraised = rules.appraisedValue;
      starting = starting.amount > appraised.amount * 1.02 ? null : starting;
    } else {
      starting = null;
    }
  }

  let deposit = bounded(money(llm.deposit)) ?? rules.deposit;
  // A deposit above the statutory cap, or above the value itself, is a misread.
  if (deposit && (deposit.amount > DEPOSIT_CAP || (appraised && deposit.amount > appraised.amount))) {
    deposit = rules.deposit && rules.deposit.amount <= DEPOSIT_CAP ? rules.deposit : null;
  }

  return { appraisedValue: appraised, startingPrice: starting, deposit };
}

function cleanHeadline(s: string | null): string | null {
  if (!s) return null;
  const t = s
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s\-–—;,:]+|[\s;,:]+$/g, '')
    .trim();
  if (t.length < 4) return null;
  // Guard against the model echoing the bureaucratic source title.
  if (/^zaklju[cč]ak\b/i.test(t) && t.length > 40) return null;
  return t.slice(0, 90);
}

export function mergeAnalysis(
  llm: Analysis | undefined,
  rules: ExtractedFields,
  ruleDescription: string | null,
  ruleTags: string[],
  title: string,
  bodyForTypeInference: string,
): MergedFields {
  // No model result (no key, failed call, or text too short) → rules only.
  if (!llm) {
    return {
      headline: null,
      itemDescription: ruleDescription,
      itemTags: ruleTags,
      caseNumber: rules.caseNumber,
      appraisedValue: rules.appraisedValue,
      startingPrice: rules.startingPrice,
      deposit: rules.deposit,
      saleTime: rules.saleTime,
      auctionRound: rules.auctionRound,
      saleMethod: rules.saleMethod,
      auctionLocation: rules.auctionLocation,
      municipality: rules.municipality,
      cadastral: rules.cadastral,
      saleType: null,
    };
  }

  const description =
    llm.itemDescription && isUsableDescription(llm.itemDescription)
      ? llm.itemDescription.slice(0, 400)
      : ruleDescription;

  // Cleaned *before* the choice, not after: the model reads a notice's heading
  // as data often enough that an unchecked answer used to win on the strength
  // of junk alone - 40 listings carried k.o. "PRVOJ PRODAJI", one of them a
  // car. Junk now leaves nothing behind, so the regexes win by default.
  const cadastral = sanitiseCadastral(llm.cadastral) ?? rules.cadastral;

  return {
    headline: cleanHeadline(llm.headline),
    itemDescription: description,
    itemTags: llm.itemTags?.length ? llm.itemTags : ruleTags,
    // Case numbers have a fixed grammar, so the pattern is the better reader:
    // the model occasionally drops the court prefix or misreads "I 0" as "10".
    caseNumber: rules.caseNumber ?? llm.caseNumber?.trim() ?? null,
    ...reconcileMoney(llm, rules),
    saleTime: /^\d{2}:\d{2}$/.test(llm.saleTime ?? '') ? llm.saleTime : rules.saleTime,
    auctionRound: llm.auctionRound !== 'nepoznato' ? llm.auctionRound : rules.auctionRound,
    saleMethod: llm.saleMethod !== 'nepoznato' ? llm.saleMethod : rules.saleMethod,
    auctionLocation: llm.auctionLocation?.trim() || rules.auctionLocation,
    municipality: llm.municipality?.trim() || rules.municipality,
    cadastral,
    saleType: llm.itemTags?.length
      ? inferSaleType(`${title}\n${description ?? bodyForTypeInference.slice(0, 2000)}`)
      : null,
  };
}
