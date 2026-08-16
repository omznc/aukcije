import assert from 'node:assert/strict';
import { test } from 'node:test';
import { describeItem, isUsableDescription } from './describe.ts';

test('a colon-anchored goods list becomes the description', () => {
  const text = [
    'ODREĐUJE SE prvo izvršno ročište za javno nadmetanje radi prodaje pokretnih stvari izvršenika:',
    '',
    'Ugaona garnitura vrijednost 1.200,00 KM',
    'LCD TV 500,00 KM',
    'Trpezarijski sto i četri stolice 1.000,00 KM',
    '',
    '2. Prodaja će se vršiti putem usmenog i javnog nadmetanja za dan 18.08.2026.',
  ].join('\n');
  assert.equal(
    describeItem(text, 'Zaključak o prodaji pokretnih stvari'),
    'Ugaona garnitura vrijednost 1.200,00 KM; LCD TV 500,00 KM; Trpezarijski sto i četri stolice 1.000,00 KM',
  );
});

test('a parenthesised title wins, since it is already clean', () => {
  assert.equal(
    describeItem('irrelevant body', 'Prva prodaja (Kosačica za travu GGP ITALY, T 484 TR)'),
    'Kosačica za travu GGP ITALY, T 484 TR',
  );
});

test('inventory-table column headers are stripped from the result', () => {
  const text = [
    'prodaju popisanih stvari:',
    'Opis; Količina; Procijenjena vrijednost',
    'Viljuškar marke „Linde“ crvene boje, tip H45D',
  ].join('\n');
  const out = describeItem(text, '');
  assert.ok(out?.startsWith('Viljuškar'), `got: ${out}`);
});

test('procedural prose is never returned as a description', () => {
  assert.equal(isUsableDescription('Konstatuje se da je vrijednost nekretnine izvršenika'), false);
  assert.equal(isUsableDescription('Određuje se prodaja usmenim javnim'), false);
  assert.equal(isUsableDescription('Izvršno odjeljenje.'), false);
  assert.equal(isUsableDescription('Rješenjem o promjeni predmeta i sredstva izvršenja'), false);
});

test('line-wrap artefacts and bare fragments are rejected', () => {
  assert.equal(isUsableDescription('05.2026. godine sa početkom u 09,00 sati'), false);
  assert.equal(isUsableDescription('Određuje'), false);
  assert.equal(isUsableDescription('09,00'), false);
  assert.equal(isUsableDescription(''), false);
  assert.equal(isUsableDescription(null), false);
});

test('a bare table header is not a description', () => {
  assert.equal(isUsableDescription('Red. Br. Opis popisanih stvari Kom. Procijenjena Vrijednost'), false);
  assert.equal(describeItem('Red. Br. Opis popisanih stvari Kom. Vrijednost', ''), null);
});

test('genuine goods descriptions survive', () => {
  for (const good of [
    'Klima uređaj marke „Samsung" — 400,00 KM',
    'TV „PHILIPS“ 42 inča, 1 kom., procijenjena vrijednost — 700,00 KM',
    'PMV "Peugeot" i Moped "Peugeot"',
    'objekat u privredi površine 157 m2 i zemljište uz objekat površine 1236m2.',
  ]) {
    assert.equal(isUsableDescription(good), true, good);
  }
});
