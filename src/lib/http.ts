import { API_BASES, POLITENESS } from '../config.ts';

/**
 * A single global queue that keeps us under `concurrency` in-flight requests and
 * spaces them out. The portal is a public-sector site with modest capacity, so
 * this is deliberately conservative rather than fast.
 */
let active = 0;
let lastStart = 0;
const waiting: Array<() => void> = [];

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function acquire() {
  if (active >= POLITENESS.concurrency) {
    await new Promise<void>((r) => waiting.push(r));
  }
  active++;
  const gap = POLITENESS.minDelayMs + Math.random() * POLITENESS.jitterMs;
  const wait = lastStart + gap - Date.now();
  if (wait > 0) await sleep(wait);
  lastStart = Date.now();
}

function release() {
  active--;
  waiting.shift()?.();
}

export class HttpError extends Error {
  status: number;
  url: string;
  body: string;

  constructor(status: number, url: string, body: string) {
    super(`HTTP ${status} for ${url}`);
    this.status = status;
    this.url = url;
    this.body = body;
  }
}

/**
 * Mirrors of one API URL, most-preferred first.
 *
 * portalfo1 and portalfo2 are separate Express processes in front of the same
 * Oracle database, each with its own node-oracledb connection pool. When one
 * saturates it answers 500 with `NJS-076: connection request rejected. Pool
 * queue length queueMax 500 reached` while the other still serves normally, so
 * a failed attempt is worth repeating against the sibling before sleeping.
 * Verified live: every endpoint this scraper uses is served by both.
 */
function mirrorsFor(url: string): string[] {
  const base = API_BASES.find((b) => url.startsWith(b));
  if (!base) return [url];
  const rest = url.slice(base.length);
  return [url, ...API_BASES.filter((b) => b !== base).map((b) => b + rest)];
}

/** Retry on transport errors, 429 and 5xx, alternating mirrors between attempts.
 *  The portal 500s on malformed paths, so a persistent 500 is treated as fatal
 *  after the retry budget rather than looping - but a *transient* 500 from pool
 *  exhaustion outlives a couple of hundred milliseconds, which is why the budget
 *  is tens of seconds rather than the ~12s that let one scheduled run die. */
async function withRetry<T>(fn: (url: string) => Promise<T>, url: string): Promise<T> {
  const urls = mirrorsFor(url);
  let lastErr: unknown;
  for (let attempt = 0; attempt <= POLITENESS.retries; attempt++) {
    const target = urls[attempt % urls.length];
    try {
      return await fn(target);
    } catch (err) {
      lastErr = err;
      const status = err instanceof HttpError ? err.status : 0;
      const retriable = status === 0 || status === 429 || status >= 500;
      if (!retriable || attempt === POLITENESS.retries) break;
      const backoff = Math.min(30_000, POLITENESS.backoffMs * 2 ** attempt) + Math.random() * 500;
      console.warn(`  retry ${attempt + 1}/${POLITENESS.retries} ${url} in ${Math.round(backoff)}ms`);
      await sleep(backoff);
    }
  }
  throw lastErr;
}

async function raw(url: string, accept: string): Promise<Response> {
  await acquire();
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), POLITENESS.timeoutMs);
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': POLITENESS.userAgent, Accept: accept },
        signal: ctl.signal,
        redirect: 'follow',
      });
      if (!res.ok) {
        throw new HttpError(res.status, url, (await res.text().catch(() => '')).slice(0, 300));
      }
      return res;
    } finally {
      clearTimeout(timer);
    }
  } finally {
    release();
  }
}

export function getJson<T>(url: string): Promise<T> {
  return withRetry(async (u) => (await raw(u, 'application/json')).json() as Promise<T>, url);
}

export function getText(url: string): Promise<string> {
  return withRetry(async (u) => (await raw(u, 'text/html')).text(), url);
}

export function getBuffer(url: string): Promise<Buffer> {
  return withRetry(
    async (u) => Buffer.from(await (await raw(u, '*/*')).arrayBuffer()),
    url,
  );
}

/** Build a query string, dropping null/undefined so we never send `foo=undefined`. */
export function qs(params: Record<string, string | number | null | undefined>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== null && v !== undefined && v !== '') p.set(k, String(v));
  }
  return p.toString();
}
