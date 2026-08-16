/**
 * Runtime configuration and hard-won facts about the pravosudje.ba backend.
 *
 * Everything in ENDPOINTS was verified live against the portal (see docs/API.md).
 * The portal is a single Next.js frontend ("vstvfo") over an Oracle-backed
 * Express API mirrored on portalfo1/portalfo2.
 */

/**
 * Public identity of this deployment.
 *
 * `SITE_URL` is read from the environment so the same build works on a
 * Cloudflare Pages preview domain and on the final one without a code change —
 * canonical tags, RSS, the sitemap and llms.txt are baked in at build time, so
 * this must be set correctly wherever the site is built.
 */
// `||`, not `??`: CI passes an unset repository variable through as an empty
// string, which would otherwise be accepted as the site URL.
export const SITE_URL = process.env.SITE_URL || 'https://sudskeprodaje.omarzunic.com';

/** Where takedown and correction requests go. Must be a real, monitored address. */
export const CONTACT_EMAIL = 'contact@omarzunic.com';

/** API mirrors. portalfo2 is what the live frontend bundles use. */
export const API_BASES = [
  'https://portalfo2.pravosudje.ba/vstvfo-api',
  'https://portalfo1.pravosudje.ba/vstvfo-api',
] as const;

export const API_BASE = API_BASES[0];

export const WEB_BASE = 'https://pravosudje.ba/vstvfo';

/**
 * Language codes used by the portal. `B` (Bosanski) is the safest default:
 * the API falls back to the original language when a translation is absent,
 * so requesting `B` still yields Cyrillic-origin notices verbatim.
 */
export const LANGS = { bs: 'B', hr: 'H', srLatn: 'S', srCyrl: 'Sc', en: 'E' } as const;

/**
 * Item categories exposed by the central feed. The portal ships five, not the
 * four that are commonly documented — `Namještaj` is a distinct category.
 */
export const SALE_TYPES = {
  NEK: 'nekretnine',
  VOZ: 'vozila',
  TEH: 'tehnika',
  NAM: 'namjestaj',
  OST: 'ostalo',
} as const;

export type SaleTypeCode = keyof typeof SALE_TYPES;

/** Politeness: the portal publishes no robots.txt, so we self-limit. */
export const POLITENESS = {
  // A real, reachable contact: this is the courtesy contract with the portal's
  // administrators, so it must not point at anything that 404s.
  userAgent: `sudskeprodaje-bot/1.0 (+${SITE_URL}; open court-auction index; ${CONTACT_EMAIL})`,
  /** Concurrent in-flight requests. */
  concurrency: 3,
  /** Minimum gap between requests to one host, ms. */
  minDelayMs: 350,
  /** Random extra delay so we don't hammer in lockstep, ms. */
  jitterMs: 250,
  retries: 4,
  timeoutMs: 45_000,
};

/** Paging. The central feed accepts large pages; 200 is comfortably served. */
export const PAGE_SIZE = 200;

export const PATHS = {
  data: 'data',
  listings: 'data/listings.json',
  courts: 'data/courts.json',
  /** Where the model and the rules disagreed — a review queue, not a gate. */
  quality: 'data/quality-report.json',
  /** Downloaded attachments. Git-ignored: the source documents contain PII. */
  documents: '.cache/documents',
};
