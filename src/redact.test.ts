import assert from 'node:assert/strict';
import { test } from 'node:test';
import { redactText, redactTitle, redactVenue } from './redact.ts';

test('a debtor named after their procedural role is removed', () => {
  const out = redactText('u izvršnom postupku protiv izvršenika Radovanović Miloša iz Dvorova');
  assert.ok(!out?.includes('Radovanović'));
  assert.ok(!out?.includes('Miloša'));
  assert.ok(out?.includes('izvršenika'));
});

test('company parties are kept, since they are not personal data', () => {
  const out = redactText('tražioca izvršenja Komunalac a.d. Bijeljina');
  assert.ok(out?.includes('Komunalac'));
});

test('street addresses go, localities stay', () => {
  const out = redactText('iz Dvorova, ul. Kneza Miloša br. 43, Bijeljina');
  assert.ok(!out?.includes('Kneza Miloša'));
  assert.ok(out?.includes('Dvorova'));
  assert.ok(out?.includes('Bijeljina'));
});

test('bez-broja addresses are removed too', () => {
  const out = redactText('ul. Tina Ujevića bb, Brčko');
  assert.ok(!out?.includes('Tina Ujevića'));
});

test('national identifiers and contact details are removed', () => {
  assert.ok(!redactText('JMBG 1234567890123')?.includes('1234567890123'));
  assert.ok(!redactText('kontakt marko@example.com')?.includes('marko@example.com'));
  assert.ok(!redactText('tel. 061 123 456')?.includes('061 123 456'));
});

test('titles keep the item but lose the person', () => {
  const out = redactTitle('Prva prodaja nepokretnosti izvršenika Marka Markovića (Kosačica za travu)');
  assert.ok(out.includes('Kosačica za travu'));
  assert.ok(!out.includes('Marka Markovića'));
});

test('redaction is null-safe', () => {
  assert.equal(redactText(null), null);
  assert.equal(redactText(''), null);
});

test('the whole party clause goes, not just the first capitalised word', () => {
  // The person's name can sit after an occupation, so a fixed 1–3 word window
  // leaves the actual name behind.
  const out = redactText(
    'Prva javna prodaja pokretnih stvari izvršenika Samostalni prevoznik Stevo Đajić iz Laktaša',
  );
  assert.ok(!out?.includes('Stevo'), out ?? '');
  assert.ok(!out?.includes('Đajić'), out ?? '');
});

test('a sole trader is a natural person, so the name still goes', () => {
  // "s.p." is a business form but the holder is a human being.
  const out = redactText('izvršenika Gorana Trkulje, s.p. Frizerski salon „Šurda“ Banjaluka');
  assert.ok(!out?.includes('Gorana'), out ?? '');
  assert.ok(!out?.includes('Trkulje'), out ?? '');
  // The trade name is not personal data and is worth keeping.
  assert.ok(out?.includes('Šurda'), out ?? '');
});

test('a person introducing a trade name loses the person, keeps the brand', () => {
  const out = redactText(
    'izvršenika: Dalibor Dragojević vlasnik JPS „Dnp & Transport“ s.p. Laktaši',
  );
  assert.ok(!out?.includes('Dragojević'), out ?? '');
  assert.ok(out?.includes('Dnp & Transport'), out ?? '');
});

test('a company party is left alone', () => {
  assert.ok(redactText('izvršenika „Sport Trade“ d.o.o.')?.includes('Sport Trade'));
  assert.ok(redactText('tražioca izvršenja Komunalac a.d. Bijeljina')?.includes('Komunalac'));
});

test('a courthouse venue keeps its street address', () => {
  const venue = 'Općinski sud u Sarajevu, ul. Šenoina br. 1, soba 454/IV';
  assert.equal(redactVenue(venue), venue);
});

test('a Cyrillic courthouse venue is recognised as a court', () => {
  const venue = 'Основни суд у Бијељини, ул. Вука Караџића бр. 3';
  assert.equal(redactVenue(venue), venue);
});

test('a street venue that names no court is dropped, room number or not', () => {
  // A bankruptcy sale held on the debtor company's own premises. "kancelarija"
  // is not proof of a courthouse, and this shape is what `scripts/verify.ts`
  // refuses to publish - the pipeline has to drop it first.
  assert.equal(redactVenue('ul. Željeznička br. 1, kancelarija broj 3, Lukavac'), null);
  assert.equal(redactVenue('Upravna zgrada, ul. Vase Pelagića br. 22'), null);
});

test('a venue with no street address survives even without a court name', () => {
  // Nothing to attribute: no address is published either way.
  assert.equal(redactVenue('kancelarija broj 41'), 'kancelarija broj 41');
});
