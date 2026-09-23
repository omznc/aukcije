import assert from 'node:assert/strict';
import { test } from 'node:test';
import { listings } from './data.ts';
import { clip, listingDescription, listingTitle } from './meta.ts';

test('clip cuts on a word and marks the cut', () => {
  assert.equal(clip('kratko', 20), 'kratko');
  assert.equal(clip('Stan 81 m², Zenica, sa garažom i ostavom', 24), 'Stan 81 m², Zenica, sa…');
});

test('every listing gets a title and description inside the search-result limits', () => {
  for (const l of listings) {
    const title = listingTitle(l);
    const description = listingDescription(l);
    assert.ok(title.length <= 65, `${l.id} title ${title.length}: ${title}`);
    assert.ok(title.endsWith(' - sudska prodaja'), `${l.id}: ${title}`);
    assert.ok(description.length <= 158, `${l.id} description ${description.length}`);
    // A date ends on its own full stop; a second one after it reads as a typo.
    assert.ok(!description.includes('..'), `${l.id}: ${description}`);
    assert.ok(description.includes(l.court) || description.endsWith('…'), `${l.id}: ${description}`);
  }
});
