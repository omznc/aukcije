import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { API_BASES } from '../config.ts';
import { getJson } from './http.ts';

const [PRIMARY, MIRROR] = API_BASES;

/** Stub `fetch`, recording every URL asked for, and answer per-host. */
function stubFetch(reply: (host: string) => { status: number; body: string }) {
  const calls: string[] = [];
  mock.method(globalThis, 'fetch', async (url: string) => {
    calls.push(url);
    const { status, body } = reply(new URL(url).host);
    return new Response(body, { status });
  });
  return calls;
}

test('a 500 from one mirror is retried against the other', async (t) => {
  t.after(() => mock.restoreAll());
  // The real shape of the failure that killed a scheduled run: portalfo2's
  // Oracle pool saturated while portalfo1 kept serving.
  const calls = stubFetch((host) =>
    host.startsWith('portalfo2')
      ? { status: 500, body: 'Server error: NJS-076: connection request rejected.' }
      : { status: 200, body: '[{"id":1}]' },
  );

  const out = await getJson<{ id: number }[]>(`${PRIMARY}/sudske-prodaje?page=0`);

  assert.deepEqual(out, [{ id: 1 }]);
  assert.equal(calls.length, 2);
  assert.ok(calls[0].startsWith(PRIMARY));
  assert.ok(calls[1].startsWith(MIRROR), `expected failover to ${MIRROR}, got ${calls[1]}`);
});

test('the path and query survive the switch to the mirror', async (t) => {
  t.after(() => mock.restoreAll());
  const calls = stubFetch((host) =>
    host.startsWith('portalfo2') ? { status: 500, body: '' } : { status: 200, body: '{}' },
  );

  await getJson(`${PRIMARY}/news-categories//news?insId=80&page=0&pageSize=200`);

  assert.equal(calls[1], `${MIRROR}/news-categories//news?insId=80&page=0&pageSize=200`);
});

test('a 404 is fatal on the first mirror rather than retried on the second', async (t) => {
  t.after(() => mock.restoreAll());
  // Only 429 and 5xx are worth a second host; a missing article is missing on
  // both, and retrying it would double the request count of a whole crawl.
  const calls = stubFetch(() => ({ status: 404, body: 'Not Found' }));

  await assert.rejects(() => getJson(`${PRIMARY}/vijest/1?lang=B`), /HTTP 404/);
  assert.equal(calls.length, 1);
});

test('a non-API url has no mirror and is retried in place', async (t) => {
  t.after(() => mock.restoreAll());
  let n = 0;
  mock.method(globalThis, 'fetch', async (url: string) => {
    assert.equal(url, 'https://pravosudje.ba/vstvfo/B/80/vijest/1');
    return new Response(n++ === 0 ? '' : '{}', { status: n === 1 ? 503 : 200 });
  });

  await getJson('https://pravosudje.ba/vstvfo/B/80/vijest/1');
  assert.equal(n, 2);
});
