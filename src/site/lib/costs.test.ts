import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  costs,
  depositFor,
  floorFor,
  feesFor,
  taxSeedFor,
  cantonOf,
  formatKm,
  DEPOSIT_CAP,
  CANTON_TAX,
  CANTON_LABEL,
  COURT_CANTON,
  type Lot,
} from './costs.ts';

/**
 * The calculator is the one place on the site that produces a number nobody can
 * check against the notice, so the rules behind it are pinned here. Most of
 * these assertions encode something that was previously wrong.
 */

const lot = (over: Partial<Lot> = {}): Lot => ({
  entity: 'FBiH',
  courtId: 65, // Sarajevo
  saleType: 'nekretnine',
  auctionRound: 'prvo',
  appraised: 100_000,
  starting: 50_000,
  deposit: 5_000,
  ...over,
});

test('deposit is taken from the notice when stated', () => {
  assert.deepEqual(depositFor(lot({ deposit: 4_321 })), { amount: 4_321, from: 'oglas' });
});

test('a silent notice falls back to a tenth of the appraisal', () => {
  assert.deepEqual(depositFor(lot({ deposit: null, appraised: 60_000 })), {
    amount: 6_000,
    from: 'zakon',
  });
});

test('the statutory deposit is capped at 10.000 KM', () => {
  const d = depositFor(lot({ deposit: null, appraised: 4_000_000 }));
  assert.equal(d?.amount, DEPOSIT_CAP);
});

test('no deposit and no appraisal yields nothing rather than a zero', () => {
  assert.equal(depositFor(lot({ deposit: null, appraised: null })), null);
});

test('the floor is the stated starting price', () => {
  assert.deepEqual(floorFor(lot({ starting: 33_000 })), { amount: 33_000, from: 'oglas' });
});

test('a missing starting price is reconstructed from the round', () => {
  assert.deepEqual(floorFor(lot({ starting: null, auctionRound: 'prvo' })), {
    amount: 50_000,
    from: 'procjena',
  });
  const second = floorFor(lot({ starting: null, auctionRound: 'drugo' }));
  assert.equal(Math.round(second!.amount), 33_333);
});

test('the floor is never the appraisal itself - that was the old seeding bug', () => {
  const f = floorFor(lot({ starting: null, appraised: 200_000, auctionRound: 'prvo' }));
  assert.equal(f?.amount, 100_000);
  assert.notEqual(f?.amount, 200_000);
});

test('an unknown round gives no floor rather than a guessed one', () => {
  assert.equal(floorFor(lot({ starting: null, auctionRound: 'nepoznato' })), null);
});

test('Sarajevo puts the transfer tax on the buyer', () => {
  const t = taxSeedFor(lot({ courtId: 65 }));
  assert.equal(t.canton, 'KS');
  assert.equal(t.payer, 'kupac');
  assert.equal(t.rate, 0.05);
});

test('cantons that tax the seller seed the buyer field at zero', () => {
  for (const courtId of [32, 43, 51, 64]) {
    const t = taxSeedFor(lot({ courtId }));
    assert.equal(t.payer, 'prodavac', `court ${courtId}`);
    assert.equal(t.rate, 0, `court ${courtId} should not charge the buyer`);
    // The rate still exists, it just is not yours.
    assert.equal(t.statutoryRate, 0.05, `court ${courtId}`);
  }
});

test('RS charges no transfer tax and says why', () => {
  const t = taxSeedFor(lot({ entity: 'RS', courtId: 80 }));
  assert.equal(t.rate, 0);
  assert.match(t.note, /ukinula porez na promet/);
});

test('Brčko charges the buyer 3%', () => {
  const t = taxSeedFor(lot({ entity: 'BD', courtId: 90 }));
  assert.equal(t.rate, 0.03);
  assert.equal(t.payer, 'kupac');
});

test('an unmapped FBiH court admits it does not know the canton', () => {
  const t = taxSeedFor(lot({ courtId: 999_999 }));
  assert.equal(t.canton, null);
  assert.match(t.note, /nismo mogli odrediti/);
});

test('movables carry no property transfer tax', () => {
  for (const saleType of ['vozila', 'tehnika', 'namjestaj', 'ostalo']) {
    assert.equal(taxSeedFor(lot({ saleType })).rate, 0, saleType);
  }
});

test('vehicles do not claim to be free of cost', () => {
  assert.ok(feesFor(10_000, 'vozila') > 0);
  assert.match(taxSeedFor(lot({ saleType: 'vozila' })).note, /provjerite/);
});

test('fees scale with value instead of sitting at a flat 200', () => {
  assert.ok(feesFor(3_000, 'nekretnine') < 200);
  assert.ok(feesFor(300_000, 'nekretnine') > 200);
});

test('fees stay inside their bounds', () => {
  assert.equal(feesFor(1, 'nekretnine'), 100);
  assert.equal(feesFor(10_000_000, 'nekretnine'), 1_500);
  assert.equal(feesFor(0, 'nekretnine'), 0);
});

test('every canton is labelled and every mapped court resolves', () => {
  for (const canton of Object.keys(CANTON_TAX) as Array<keyof typeof CANTON_TAX>) {
    assert.ok(CANTON_LABEL[canton], canton);
  }
  for (const [id, canton] of Object.entries(COURT_CANTON)) {
    assert.ok(CANTON_TAX[canton], `court ${id} maps to unknown canton ${canton}`);
    assert.equal(cantonOf(Number(id)), canton);
  }
});

test('the deposit counts toward the price rather than on top of it', () => {
  const b = costs({ bid: 50_000, deposit: 5_000, taxRate: 0, fees: 0 });
  assert.equal(b.balance, 45_000);
  assert.equal(b.total, 50_000);
});

test('a deposit larger than the bid cannot make the balance negative', () => {
  const b = costs({ bid: 1_000, deposit: 5_000, taxRate: 0, fees: 0 });
  assert.equal(b.balance, 0);
  assert.equal(b.deposit, 1_000);
});

test('the total splits into what is due before and after the hearing', () => {
  const b = costs({ bid: 50_000, deposit: 5_000, taxRate: 0.05, fees: 250, other: 1_000 });
  assert.equal(b.beforeHearing, 5_000);
  assert.equal(b.afterHearing, 45_000 + 2_500 + 250 + 1_000);
  assert.equal(b.beforeHearing + b.afterHearing, b.total);
});

test('the tax can be charged on the appraisal instead of the bid', () => {
  const onBid = costs({ bid: 50_000, deposit: null, taxRate: 0.05, fees: 0 });
  const onAppraisal = costs({
    bid: 50_000,
    deposit: null,
    taxRate: 0.05,
    taxBase: 100_000,
    fees: 0,
  });
  assert.equal(onBid.tax, 2_500);
  assert.equal(onAppraisal.tax, 5_000);
  // The base moves the tax without moving the price.
  assert.equal(onAppraisal.total - onBid.total, 2_500);
});

test('marks are grouped the Bosnian way regardless of browser locale data', () => {
  assert.equal(formatKm(450_000), '450.000 KM');
  assert.equal(formatKm(1_350), '1.350 KM');
  assert.equal(formatKm(0), '0 KM');
  assert.equal(formatKm(999), '999 KM');
});
