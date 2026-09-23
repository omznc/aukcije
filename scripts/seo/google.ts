import { createSign } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';

/**
 * A Search Console client with no dependency: a service-account JWT exchanged
 * for a token, then plain fetch.
 *
 * The key is a service-account JSON that has been added as a user on the
 * Search Console property. It never belongs in this repository - by default it
 * is read from ~/.config/sudskeprodaje/gsc.json, or from GSC_KEY.
 */

export const SITE = 'https://sudskeprodaje.omarzunic.com/';

const keyPath = process.env.GSC_KEY || `${homedir()}/.config/sudskeprodaje/gsc.json`;

async function token(): Promise<string> {
  const key = JSON.parse(await readFile(keyPath, 'utf8'));
  const now = Math.floor(Date.now() / 1000);
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({
    iss: key.client_email,
    scope: 'https://www.googleapis.com/auth/webmasters',
    aud: key.token_uri,
    iat: now,
    exp: now + 3600,
  })}`;
  const signature = createSign('RSA-SHA256').update(unsigned).sign(key.private_key, 'base64url');
  const response = await fetch(key.token_uri, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${unsigned}.${signature}`,
    }),
  });
  const body = await response.json();
  if (!body.access_token) throw new Error(`token: ${JSON.stringify(body)}`);
  return body.access_token;
}

let bearer: Promise<string> | null = null;

/** Call a Search Console endpoint by its full URL. POST when a body is given. */
export async function google(url: string, body?: unknown, method?: string): Promise<any> {
  bearer ??= token();
  const response = await fetch(url, {
    method: method ?? (body ? 'POST' : 'GET'),
    headers: { authorization: `Bearer ${await bearer}`, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${response.status} ${url}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

const property = encodeURIComponent(SITE);
export const WEBMASTERS = `https://searchconsole.googleapis.com/webmasters/v3/sites/${property}`;

export interface Row {
  keys?: string[];
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export async function performance(
  dimensions: string[],
  days: number,
  rowLimit = 50,
): Promise<Row[]> {
  const end = new Date();
  const start = new Date(end.getTime() - days * 86_400_000);
  const body = await google(`${WEBMASTERS}/searchAnalytics/query`, {
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10),
    dimensions,
    rowLimit,
  });
  return body?.rows ?? [];
}

export async function inspect(url: string) {
  const body = await google('https://searchconsole.googleapis.com/v1/urlInspection/index:inspect', {
    inspectionUrl: url,
    siteUrl: SITE,
  });
  return body.inspectionResult.indexStatusResult as {
    verdict: string;
    coverageState: string;
    lastCrawlTime?: string;
    googleCanonical?: string;
  };
}
