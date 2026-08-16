import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  extractFields,
  inferSaleType,
  parseAmount,
  parseCaseNumber,
  parseDate,
  plausibleSaleDate,
} from './fields.ts';

test('parseAmount handles BiH separator conventions', () => {
  assert.equal(parseAmount('1.234.567,89'), 1234567.89);
  assert.equal(parseAmount('47.425,06'), 47425.06);
  assert.equal(parseAmount('936,46'), 936.46);
  assert.equal(parseAmount('1.500'), 1500);
  // Some courts use the dot as both thousands and decimal separator.
  assert.equal(parseAmount('2.000.00'), 2000);
  assert.equal(parseAmount('100.00'), 100);
  assert.equal(parseAmount('500'), 500);
});

test('parseCaseNumber reads BiH case numbers in both scripts', () => {
  assert.equal(parseCaseNumber('u predmetu 65 0 Ip 1177038 25 Ip glasi'), '65 0 Ip 1177038 25 Ip');
  assert.equal(parseCaseNumber('Broj: 126 0 I 221246 23 I'), '126 0 I 221246 23 I');
  assert.equal(parseCaseNumber('Број: 80 0 И 171697 25 И'), '80 0 I 171697 25 I');
  assert.equal(parseCaseNumber('nema broja ovdje'), null);
});

test('parseDate normalises the portal date formats', () => {
  assert.equal(parseDate('05.08.2026'), '2026-08-05');
  assert.equal(parseDate('5.8.2026.'), '2026-08-05');
  assert.equal(parseDate('2026-08-05T22:00:00.000Z'), '2026-08-05');
  assert.equal(parseDate('45.13.2026'), null);
  assert.equal(parseDate(null), null);
});

test('a mistyped year is rejected as a sale date', () => {
  // Real records from the portal: a hearing "in 2924", and one scheduled four
  // and a half years after the notice was published.
  assert.equal(plausibleSaleDate('2924-07-18', '2025-08-21'), null);
  assert.equal(plausibleSaleDate('2029-01-08', '2024-06-26'), null);

  // A hearing weeks after publication is the ordinary case.
  assert.equal(plausibleSaleDate('2026-09-30', '2026-08-21'), '2026-09-30');
  // Some archived notices were published shortly after their own hearing.
  assert.equal(plausibleSaleDate('2011-03-30', '2011-05-17'), '2011-03-30');
  // Judged against publication, not today, so the archive does not decay.
  assert.equal(plausibleSaleDate('2013-04-02', '2013-03-01'), '2013-04-02');

  assert.equal(plausibleSaleDate(null, '2026-08-21'), null);
  // With no publication date there is nothing to judge against; keep it.
  assert.equal(plausibleSaleDate('2026-09-30', null), '2026-09-30');
});

test('the debt being enforced is never mistaken for a sale price', () => {
  const text = `radi naplate duga, v.sp. 7.452,58 KM.
    Nekretnine upisane u zk. uložak broj 4815 k.o. Brčko 1 iznose 47.425,06 KM.
    Na prvom ročištu ne može se nekretnina prodati ispod polovine (1/2) utvrđene vrijednosti, tj. 23.712,53 KM.
    Kupci su dužni položiti jemstvo u iznosu od 1/10 utvrđene vrijednosti odnosno 4.742,51 KM.`;
  const f = extractFields(text);
  assert.equal(f.appraisedValue?.amount, 47425.06);
  assert.equal(f.startingPrice?.amount, 23712.53);
  assert.equal(f.deposit?.amount, 4742.51);
});

test('the appraised value is derived from a stated fraction when not given outright', () => {
  const text = `ne može se prodati ispod polovine (1/2) utvrđene vrijednosti, tj. 10.000,00 KM`;
  assert.equal(extractFields(text).appraisedValue?.amount, 20000);
});

test('per-item prices are summed into the lot total', () => {
  const text = `Prodavat će se pokretne stvari izvršenika i to:
    - umivaonik, po početnoj cijeni od 100,00 KM;
    - vodokotlić, po početnoj cijeni od 100,00 KM`;
  assert.equal(extractFields(text).startingPrice?.amount, 200);
});

test('dotted-leader item prices become the value', () => {
  const text = `za prodaju sljedećih pokretnih stvari izvršenika:
    - Kosačica za travu crvene boje GGP ITALY, T 484 TR, 30kg................500,00 KM`;
  assert.equal(extractFields(text).appraisedValue?.amount, 500);
});

test('hearing round and sale method are read from stock phrasing', () => {
  assert.equal(extractFields('Određuje se prvo ročište za prodaju').auctionRound, 'prvo');
  assert.equal(extractFields('Ročište za drugu prodaju nekretnina').auctionRound, 'drugo');
  assert.equal(extractFields('Одређује се треће рочиште за продају').auctionRound, 'trece');
  assert.equal(
    extractFields('prodaja putem usmenog javnog nadmetanja').saleMethod,
    'usmeno-javno-nadmetanje',
  );
  assert.equal(
    extractFields('prvo ročište neposrednom pogodbom').saleMethod,
    'neposredna-pogodba',
  );
});

test('hearing times are normalised to 24-hour HH:mm', () => {
  assert.equal(extractFields('u 9,00 sati').saleTime, '09:00');
  assert.equal(extractFields('dana 13.10.2026. godine u 09.00 časova').saleTime, '09:00');
  assert.equal(extractFields('u 13:30 sati').saleTime, '13:30');
});

test('cadastral identifiers are collected', () => {
  const f = extractFields('k.č. 2933/1 upisana u zk. uložak br. 565 k.o. Omerbegovača');
  assert.deepEqual(f.cadastral?.kc, ['2933/1']);
  assert.deepEqual(f.cadastral?.zkUlozak, ['565']);
  assert.deepEqual(f.cadastral?.ko, ['Omerbegovača']);
});

test('sale type is inferred when the source gives no category', () => {
  assert.equal(inferSaleType('prodaja stana u Sarajevu'), 'nekretnine');
  assert.equal(inferSaleType('Putničko vozilo Seat, godište 2004'), 'vozila');
  assert.equal(inferSaleType('kompresor i agregat'), 'tehnika');
});

test('the total of every printed amount is exposed for bounds-checking', () => {
  // Used to reject an extracted value larger than the document can support.
  const f = extractFields('vrijednost 100,00 KM i 250,00 KM te osiguranje 50,00 KM');
  assert.equal(f.amountsTotal, 400);
});
