import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cleanKoNames, parseCadastral, sanitiseCadastral, settlementOf } from './cadastral.ts';

test('cadastral identifiers are collected', () => {
  const c = parseCadastral('k.č. 2933/1 upisana u zk. uložak br. 565 k.o. Omerbegovača');
  assert.deepEqual(c?.kc, ['2933/1']);
  assert.deepEqual(c?.zkUlozak, ['565']);
  assert.deepEqual(c?.ko, ['Omerbegovača']);
});

test('a k.o. is not read out of a word ending in a diacritic', () => {
  // JavaScript's `\b` is ASCII-only and sees a boundary between "Č" and "K",
  // which used to turn this heading into k.o. "NERETVANSKI KANTON".
  assert.equal(parseCadastral('HERCEGOVAČKO NERETVANSKI KANTON, Mostar'), null);
  // The real marker still matches when it genuinely follows a letter boundary.
  assert.deepEqual(parseCadastral('nekretnine u k.o. Binježevo')?.ko, ['Binježevo']);
});

test('boilerplate is not accepted as a cadastral municipality', () => {
  assert.deepEqual(cleanKoNames(['PRVOJ PRODAJI', 'DRUGOJ', 'Dvorovi']), ['Dvorovi']);
  assert.deepEqual(cleanKoNames(['NERETVANSKI KANTON', 'ZAKLJUČAK']), []);
  // An ordinal is rejected whole, so a place that merely starts like one lives.
  assert.deepEqual(cleanKoNames(['Drugovići', 'Petrovo']), ['Drugovići', 'Petrovo']);
});

test('survey prefixes are stripped whoever produced them', () => {
  // The model returns these unnormalised; the regex path strips them itself.
  assert.deepEqual(cleanKoNames(['SP Donji Butmir', 'NP_Travnik']), ['Donji Butmir', 'Travnik']);
  assert.deepEqual(parseCadastral('upisano u k.o. SP Koševo')?.ko, ['Koševo']);
});

test('a model answer made only of boilerplate is discarded, not kept empty', () => {
  // Returning null is what lets merge.ts fall back to the rule-based reading.
  assert.equal(sanitiseCadastral({ kc: [], zkUlozak: [], ko: ['PRVOJ PRODAJI'] }), null);
  assert.deepEqual(sanitiseCadastral({ kc: ['12/3'], zkUlozak: [], ko: ['PRVOJ PRODAJI'] }), {
    kc: ['12/3'],
    zkUlozak: [],
    ko: [],
  });
  // Numbers that are not numbers are dropped too.
  assert.equal(sanitiseCadastral({ kc: ['nepoznato'], zkUlozak: [], ko: [] }), null);
});

test('settlement drops district numbering but keeps real names', () => {
  const ko = (...names: string[]) => ({ kc: [], zkUlozak: [], ko: names });
  assert.equal(settlementOf(ko('Sarajevo IV')), 'Sarajevo');
  assert.equal(settlementOf(ko('Bijeljina 1')), 'Bijeljina');
  assert.equal(settlementOf(ko('Poklečani')), 'Poklečani');
  assert.equal(settlementOf(ko('Goražde II.')), 'Goražde');
  assert.equal(settlementOf(ko('SP_Sarajevo –MAHALA LXVI')), 'Sarajevo');
  // Names that genuinely end in a word are left alone.
  assert.equal(settlementOf(ko('Mrkonjić Grad')), 'Mrkonjić Grad');
  assert.equal(settlementOf(ko('Kotor Varoš')), 'Kotor Varoš');
  assert.equal(settlementOf(null), null);
});

test('district numbering never eats the end of a real name', () => {
  const ko = (...names: string[]) => ({ kc: [], zkUlozak: [], ko: names });
  // Every one of these ends in letters that are also Roman numerals. The
  // suffix rule has to require whitespace and uppercase, or the villages
  // become "Poklečan", "Ćoralić" and "Bosanski Nov".
  assert.equal(settlementOf(ko('Poklečani')), 'Poklečani');
  assert.equal(settlementOf(ko('Ćoralići')), 'Ćoralići');
  assert.equal(settlementOf(ko('Bosanski Novi')), 'Bosanski Novi');
  assert.equal(settlementOf(ko('Šatorovići')), 'Šatorovići');
});

test('survey prefixes come off however the clerk typed them', () => {
  assert.deepEqual(
    cleanKoNames(['SP-Dolac', 'SP – Crnotina', 'S.P.DONJI BUTMIR', 'N.P. Busovača', 'SPundefined_Vraca']),
    ['Dolac', 'Crnotina', 'DONJI BUTMIR', 'Busovača', 'Vraca'],
  );
  // A real name that merely starts with those letters keeps them: the prefix
  // only comes off when a capital follows it.
  assert.deepEqual(cleanKoNames(['Sputnik', 'Novigrad']), ['Sputnik', 'Novigrad']);
  // Stubs left by a failed read are not names.
  assert.deepEqual(cleanKoNames(['SP', 'J.', 'R.', 'SP ....', 'MOTORNO VOZILO']), []);
});

test('a place at the wrong scale is not a settlement', () => {
  // Real vocabulary, wrong rung: a k.o. sits inside a district or an entity and
  // is never named as one, and "Općina ..." answers the municipality field.
  assert.deepEqual(
    cleanKoNames(['Distrikt Brčko', 'DISTRIKTA BiH', 'Republika Srpska', 'Općina Centar']),
    [],
  );
  // Brčko itself is still a place - only the word "distrikt" is disqualifying.
  assert.deepEqual(cleanKoNames(['Brčko']), ['Brčko']);
});

test('a typed placeholder is not a name', () => {
  assert.deepEqual(cleanKoNames(['xxx', 'XXX']), []);
  // Trn is a real settlement near Laktaši and has no vowel in the aeiou sense:
  // r carries its syllable, so the rule has to count r as one.
  assert.deepEqual(cleanKoNames(['Trn']), ['Trn']);
});

test('a register shouting in capitals is given its capitals back', () => {
  const ko = (name: string) => ({ kc: [], zkUlozak: [], ko: [name] });
  assert.equal(settlementOf(ko('DONJI BUTMIR')), 'Donji Butmir');
  assert.equal(settlementOf(ko('RIČICE-SVIĆE')), 'Ričice-Sviće');
  assert.equal(settlementOf(ko('SP_ĆORALIĆI')), 'Ćoralići');
  // A name someone actually typed in mixed case is left as typed, lowercase
  // qualifier and all - that spelling was a choice.
  assert.equal(settlementOf(ko('Bijeljina selo')), 'Bijeljina selo');
  assert.equal(settlementOf(ko('Mrkonjić Grad')), 'Mrkonjić Grad');
  // The published k.o. list is untouched: it quotes the notice.
  assert.deepEqual(cleanKoNames(['DONJI BUTMIR']), ['DONJI BUTMIR']);
});

test('a debtor is not filed as a cadastral municipality', () => {
  // The one shape that cannot be anything else. Checked against every k.o. in
  // the archive and every name in the gazetteer: it matches this and nothing
  // that is a place.
  assert.deepEqual(cleanKoNames(['Dobrinka Milivojević']), []);
  // A single patronymic word is a village as often as a surname, and the
  // ending cannot tell them apart, so it stays.
  assert.deepEqual(cleanKoNames(['Batković', 'Petrović']), ['Batković', 'Petrović']);
});
