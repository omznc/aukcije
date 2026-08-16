import type { Analysis } from './analyze.ts';
import type { ExtractedFields } from './fields.ts';

/**
 * Cross-check the model against the rules and record where they disagree.
 *
 * `extraction.confidence` measures how many fields got *filled*, not whether
 * they are *right* — a wrong-but-plausible number scores the same as a correct
 * one. Since both extraction paths already run on every notice, comparing them
 * is free, and the places where two independent readings differ are exactly the
 * ones worth a human look.
 *
 * This is a review aid, not a gate: a disagreement usually means one side is
 * wrong, but not which, so nothing is failed on this basis.
 */

export interface Disagreement {
  id: string;
  court: string;
  sourceUrl: string;
  field: 'appraisedValue' | 'startingPrice' | 'deposit' | 'caseNumber' | 'saleTime';
  llm: string | number | null;
  rules: string | number | null;
  /** For amounts: how far apart they are, as a multiple of the smaller value. */
  ratio: number | null;
}

/** Ignore rounding-level differences in amounts. */
const MATERIAL = 0.02;

function compareMoney(
  field: Extract<Disagreement['field'], 'appraisedValue' | 'startingPrice' | 'deposit'>,
  llm: number | null | undefined,
  rules: { amount: number } | null,
): Omit<Disagreement, 'id' | 'court' | 'sourceUrl'> | null {
  if (typeof llm !== 'number' || !rules) return null;
  const a = Math.min(llm, rules.amount);
  const b = Math.max(llm, rules.amount);
  if (a <= 0) return null;
  const ratio = b / a;
  if (ratio - 1 <= MATERIAL) return null;
  return { field, llm, rules: rules.amount, ratio: Number(ratio.toFixed(2)) };
}

export function findDisagreements(
  meta: { id: string; court: string; sourceUrl: string },
  llm: Analysis | undefined,
  rules: ExtractedFields,
): Disagreement[] {
  if (!llm) return [];
  const found: Array<Omit<Disagreement, 'id' | 'court' | 'sourceUrl'>> = [];

  for (const [field, llmValue, ruleValue] of [
    ['appraisedValue', llm.appraisedValue, rules.appraisedValue],
    ['startingPrice', llm.startingPrice, rules.startingPrice],
    ['deposit', llm.deposit, rules.deposit],
  ] as const) {
    const hit = compareMoney(field, llmValue, ruleValue);
    if (hit) found.push(hit);
  }

  // Case numbers are highly structured, so any mismatch is a genuine conflict.
  const normalise = (s: string | null | undefined) => s?.replace(/\s+/g, ' ').trim().toLowerCase();
  if (llm.caseNumber && rules.caseNumber && normalise(llm.caseNumber) !== normalise(rules.caseNumber)) {
    found.push({ field: 'caseNumber', llm: llm.caseNumber, rules: rules.caseNumber, ratio: null });
  }

  if (llm.saleTime && rules.saleTime && llm.saleTime !== rules.saleTime) {
    found.push({ field: 'saleTime', llm: llm.saleTime, rules: rules.saleTime, ratio: null });
  }

  return found.map((f) => ({ ...meta, ...f }));
}

export interface QualityReport {
  generatedAt: string;
  listings: number;
  comparable: number;
  disagreements: number;
  byField: Record<string, number>;
  /** Worst offenders first — the most useful place to start reviewing. */
  worst: Disagreement[];
}

export function buildReport(
  all: Disagreement[],
  listingCount: number,
  comparable: number,
): QualityReport {
  const byField: Record<string, number> = {};
  for (const d of all) byField[d.field] = (byField[d.field] ?? 0) + 1;

  // Keep the worst few of *each* field. A single global list would be filled
  // entirely by whichever field disagrees most often, hiding the rest.
  const worst = Object.keys(byField).flatMap((field) =>
    all
      .filter((d) => d.field === field)
      .sort((a, b) => (b.ratio ?? 0) - (a.ratio ?? 0))
      .slice(0, 20),
  );

  return {
    generatedAt: new Date().toISOString(),
    listings: listingCount,
    comparable,
    disagreements: all.length,
    byField,
    worst,
  };
}
