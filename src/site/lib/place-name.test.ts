import assert from 'node:assert/strict';
import { test } from 'node:test';
import { foldPlaceName } from './place-name.ts';

test('one place spelled several ways folds to one key', () => {
  const same = (a: string, b: string) => assert.equal(foldPlaceName(a), foldPlaceName(b), `${a} / ${b}`);
  same('SARAJEVO', 'Sarajevo'); // a caps-lock key
  same('Doboj Istok', 'Doboj-Istok'); // a hyphen
  same('Ćoralići', 'Čoralići'); // a slipped diacritic
  same('Žepče', 'Žepće');
  same('Bijeljina selo', 'Bijeljina Selo');
  same(' Tuzla ', 'Tuzla');
});

test('different places stay different', () => {
  const differ = (a: string, b: string) => assert.notEqual(foldPlaceName(a), foldPlaceName(b));
  differ('Novi Grad', 'Stari Grad');
  differ('Donji Vakuf', 'Gornji Vakuf');
  differ('Brčko', 'Brka');
});
