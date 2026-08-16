import { z } from 'zod';

/** A monetary amount. BiH auctions are denominated in konvertibilna marka. */
export const Money = z.object({
  amount: z.number().nonnegative(),
  currency: z.literal('BAM'),
});
export type Money = z.infer<typeof Money>;

export const SaleType = z.enum(['nekretnine', 'vozila', 'tehnika', 'namjestaj', 'ostalo']);
export type SaleType = z.infer<typeof SaleType>;

export const Entity = z.enum(['FBiH', 'RS', 'BD']);
export type Entity = z.infer<typeof Entity>;

/** Which hearing this is. FBiH moved to two hearings for real estate in Dec 2024. */
export const AuctionRound = z.enum(['prvo', 'drugo', 'trece', 'nepoznato']);

export const SaleMethod = z.enum([
  'usmeno-javno-nadmetanje',
  'neposredna-pogodba',
  'prikupljanje-ponuda',
  'nepoznato',
]);

export const Court = z.object({
  id: z.number().int(),
  name: z.string(),
  slug: z.string(),
  entity: Entity,
  /** Court subdomain on pravosudje.ba, when known. */
  host: z.string().nullable(),
});
export type Court = z.infer<typeof Court>;

/**
 * One court sale, after extraction and PII minimisation.
 *
 * Deliberately absent: debtor/creditor names, street addresses tied to a
 * natural person, and the full notice body. Those stay upstream; we link to
 * the authoritative document instead.
 */
export const Listing = z.object({
  /** Stable across runs: the portal's own article id. */
  id: z.string(),
  articleId: z.number().int(),

  court: z.string(),
  courtId: z.number().int(),
  entity: Entity,

  caseNumber: z.string().nullable(),
  saleType: SaleType,
  title: z.string(),
  /**
   * Short, readable title for listing cards. The court's own `title` is a
   * bureaucratic reference line ("Zaključak o prodaji … u predmetu 65 0 Ip …"),
   * which is useless for browsing.
   */
  headline: z.string().nullable().default(null),
  /** Operative description of what is being sold, redacted. */
  itemDescription: z.string().nullable(),
  /**
   * Concrete item categories found in the notice ("monitor", "traktor"), so
   * the site can be browsed by goods rather than by the court's coarse
   * five-way classification. See extract/items.ts.
   */
  itemTags: z.array(z.string()).default([]),

  cadastral: z
    .object({
      kc: z.array(z.string()).default([]),
      zkUlozak: z.array(z.string()).default([]),
      ko: z.array(z.string()).default([]),
    })
    .nullable(),

  location: z
    .object({
      municipality: z.string().nullable(),
      settlement: z.string().nullable(),
    })
    .nullable(),

  appraisedValue: Money.nullable(),
  startingPrice: Money.nullable(),
  deposit: Money.nullable(),

  auctionRound: AuctionRound,
  saleMethod: SaleMethod,

  /** ISO date (no time) of the sale, from the feed — always present upstream. */
  saleDate: z.string(),
  /** Local wall-clock time of the hearing, "HH:mm", when stated. */
  saleTime: z.string().nullable(),
  auctionLocation: z.string().nullable(),
  viewingInfo: z.string().nullable(),

  publishedDate: z.string(),

  sourceUrl: z.string().url(),
  documents: z.array(
    z.object({
      id: z.number().int(),
      name: z.string(),
      type: z.string(),
      url: z.string().url(),
      sha256: z.string().nullable(),
    }),
  ),

  /** Original language the notice was written in. */
  language: z.string().nullable(),
  /** Where the structured fields came from, for auditing extraction quality. */
  extraction: z.object({
    /**
     * Which prompt/redaction/rules combination produced this row. Rows built by
     * an older pipeline are rebuilt rather than reused, so a fix reaches the
     * whole archive on the next run instead of only new notices.
     */
    pipelineVersion: z.string().default('0'),
    source: z.enum(['inline', 'pdf', 'docx', 'doc', 'ocr', 'none']),
    /** 0..1 — fraction of high-value fields we managed to fill. */
    confidence: z.number().min(0).max(1),
    llm: z.boolean().default(false),
  }),

  scrapedAt: z.string(),
});
export type Listing = z.infer<typeof Listing>;

export const ListingFile = z.object({
  generatedAt: z.string(),
  count: z.number().int(),
  listings: z.array(Listing),
});
