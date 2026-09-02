/**
 * Runtime configuration and hard-won facts about the pravosudje.ba backend.
 *
 * Everything in ENDPOINTS was verified live against the portal (see docs/API.md).
 * The portal is a single Next.js frontend ("vstvfo") over an Oracle-backed
 * Express API mirrored on portalfo1/portalfo2.
 */

/**
 * Read an environment variable, treating blank as unset.
 *
 * Every one of these is populated from GitHub Actions, where an *unset*
 * repository variable is not absent - `${{ vars.FOO }}` expands to an empty
 * string. `??` accepts that empty string as a real value and the default never
 * applies, which is not a hypothetical: it shipped `LLM_MODEL=""` to
 * OpenRouter, every call came back "No models provided", and 295 notices
 * silently fell back to rule-based extraction on a run that then committed and
 * published the result.
 */
export function env(name: string, fallback: string): string {
  const value = process.env[name]?.trim();
  return value ? value : fallback;
}

/**
 * Public identity of this deployment.
 *
 * `SITE_URL` is read from the environment so the same build works on a
 * Cloudflare Pages preview domain and on the final one without a code change -
 * canonical tags, RSS, the sitemap and llms.txt are baked in at build time, so
 * this must be set correctly wherever the site is built.
 */
export const SITE_URL = env('SITE_URL', 'https://sudskeprodaje.omarzunic.com');

/**
 * Default OpenRouter model for extraction and OCR.
 *
 * It must support `response_format: json_schema` - extraction asks for a strict
 * schema and treats the reply as already conforming. A model that ignores the
 * parameter still answers, just in prose or near-JSON, which is precisely the
 * plausible-but-wrong output this pipeline is built to avoid.
 *
 * Note that this string is part of the analysis cache key, so changing it
 * re-analyses the whole archive rather than reusing anything.
 */
export const DEFAULT_MODEL = 'google/gemini-2.5-flash-lite';

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
 * four that are commonly documented - `Namještaj` is a distinct category.
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
  /**
   * Attempts after the first, alternating between the two API mirrors, so this
   * is also how many shots each mirror gets.
   */
  retries: 5,
  /**
   * Exponential backoff base, doubling per attempt and capped at 30s.
   *
   * Sized against a real failure: the portal's Oracle pool saturates under load
   * and answers `NJS-076 … queueMax 500 reached` as a 500 for tens of seconds at
   * a time. At the previous 800 ms the whole budget was spent in ~12 s, well
   * inside one such blip, and a scheduled run died on the very first request.
   */
  backoffMs: 1_000,
  timeoutMs: 45_000,
};

/** Paging. The central feed accepts large pages; 200 is comfortably served. */
export const PAGE_SIZE = 200;

export const PATHS = {
  data: 'data',
  listings: 'data/listings.json',
  courts: 'data/courts.json',
  /** Where the model and the rules disagreed - a review queue, not a gate. */
  quality: 'data/quality-report.json',
  /** Downloaded attachments. Git-ignored: the source documents contain PII. */
  documents: '.cache/documents',
  /**
   * Rendered share cards, keyed by what is drawn on them. Rendering one is
   * ~130 ms and there is one per notice, so an uncached build spends six
   * minutes redrawing an archive that has not changed.
   */
  cards: '.cache/og',
};
