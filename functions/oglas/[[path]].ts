import { legacyTarget, type AddressTable } from '../../src/site/lib/legacy-url.ts';

/**
 * A real 301 for the old `/oglas/{id}/` addresses.
 *
 * Cloudflare Pages routes every request under /oglas/ here first. Anything that
 * is not an old address goes straight on to the static file with `next()`, so a
 * listing page costs one table lookup and nothing else.
 *
 * `_redirects` cannot do this: it takes 2,000 static rules, the archive already
 * holds more listings than that, and a dynamic rule cannot pull the id out of a
 * slug. See src/site/lib/legacy-url.ts for why the old meta-refresh stubs went.
 */

interface Context {
  request: Request;
  env: { ASSETS: { fetch: (input: Request | string) => Promise<Response> } };
  next: () => Promise<Response>;
}

/** One fetch per isolate. A failed fetch is forgotten, so the next request retries. */
let table: Promise<AddressTable> | null = null;

function load(ctx: Context): Promise<AddressTable> {
  table ??= ctx.env.ASSETS.fetch(new URL('/adrese.json', ctx.request.url).href)
    .then((r) => {
      if (!r.ok) throw new Error(`adrese.json: ${r.status}`);
      return r.json() as Promise<AddressTable>;
    })
    .catch((error) => {
      table = null;
      throw error;
    });
  return table;
}

export async function onRequest(ctx: Context): Promise<Response> {
  const url = new URL(ctx.request.url);
  // Only a bare id can be an old address; everything else skips the table.
  if (!/^\/oglas\/\d+-\d+\/?$/.test(url.pathname)) return ctx.next();

  let target: string | null = null;
  try {
    target = legacyTarget(url.pathname, await load(ctx));
  } catch {
    // Without the table, the static site answers - a 404 at worst, never a 500.
  }
  if (!target) return ctx.next();
  return Response.redirect(new URL(target + url.search, url).href, 301);
}
