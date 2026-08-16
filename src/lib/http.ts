import { POLITENESS } from '../config.ts';

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

/** Retry on transport errors, 429 and 5xx. The portal 500s on malformed paths, so
 *  a persistent 500 is treated as fatal after the retry budget rather than looping. */
async function withRetry<T>(fn: () => Promise<T>, label: string): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= POLITENESS.retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const status = err instanceof HttpError ? err.status : 0;
      const retriable = status === 0 || status === 429 || status >= 500;
      if (!retriable || attempt === POLITENESS.retries) break;
      const backoff = Math.min(30_000, 800 * 2 ** attempt) + Math.random() * 500;
      console.warn(`  retry ${attempt + 1}/${POLITENESS.retries} ${label} in ${Math.round(backoff)}ms`);
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
  return withRetry(async () => (await raw(url, 'application/json')).json() as Promise<T>, url);
}

export function getText(url: string): Promise<string> {
  return withRetry(async () => (await raw(url, 'text/html')).text(), url);
}

export function getBuffer(url: string): Promise<Buffer> {
  return withRetry(
    async () => Buffer.from(await (await raw(url, '*/*')).arrayBuffer()),
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
