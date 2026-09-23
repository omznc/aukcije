import assert from 'node:assert/strict';
import { test } from 'node:test';
import { legacyTarget } from './legacy-url.ts';

const table = { '90-165756': '/oglas/nekretnine-brcko-90-165756/' };

test('a bare id resolves to its slug, with or without the trailing slash', () => {
  assert.equal(legacyTarget('/oglas/90-165756/', table), '/oglas/nekretnine-brcko-90-165756/');
  assert.equal(legacyTarget('/oglas/90-165756', table), '/oglas/nekretnine-brcko-90-165756/');
});

test('the real page and anything else under /oglas/ pass through', () => {
  assert.equal(legacyTarget('/oglas/nekretnine-brcko-90-165756/', table), null);
  assert.equal(legacyTarget('/oglas/90-165756.ics', table), null);
  assert.equal(legacyTarget('/oglas/', table), null);
});

test('an id the table does not hold is left to the static site', () => {
  // Either it lives at its bare id, or it does not exist and should 404.
  assert.equal(legacyTarget('/oglas/1-1/', table), null);
});

test('never a redirect to itself', () => {
  assert.equal(legacyTarget('/oglas/1-1/', { '1-1': '/oglas/1-1/' }), null);
});
