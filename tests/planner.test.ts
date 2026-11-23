import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPlanner, pareto, tightest, type Journey, type PlanData } from '../src/lib/planner.ts';
import type { Calendar } from '../src/lib/types.ts';

// 2026-11-23 je ponedjeljak. 0 = radni dan, 1 = vikend.
const cal: Calendar = {
  start: '2026-11-23', end: '2026-11-29', days: [1, 1, 1, 1, 1, 2, 2],
  weekday: [2, 1, 1, 1, 1, 1, 2], labels: ['Radni dan', 'Vikend'],
};

// Stanice: 0 A, 1 B (dvije strane, ~45 m), 2 C, 3 D, 4 E (~200 m od B), 5 F
const poles: PlanData['poles'] = [
  [0, 0, 44.80, 18.80], [1, 0, 44.85, 18.80], [1, 1, 44.8504, 18.80],
  [2, 0, 44.90, 18.80], [3, 0, 44.95, 18.80], [4, 0, 44.852, 18.80], [5, 0, 44.99, 18.80],
];
const data: PlanData = {
  poles,
  headsigns: ['C', 'D', 'F'],
  trips: [
    [0, '0', 0, 0, [0, 480, 1, 500, 3, 530]], //  linija 0: A 8:00 - B 8:20 - C 8:50
    [0, '0', 0, 0, [0, 540, 1, 560, 3, 590]], //  A 9:00 - B 9:20 - C 9:50
    [1, '0', 1, 0, [2, 504, 4, 540]], //          linija 1: B(druga strana) 8:24 - D 9:00
    [1, '0', 1, 0, [2, 561, 4, 600]], //          B(druga strana) 9:21, prekratko nakon 9:20
    [1, '0', 1, 0, [2, 640, 4, 680]], //          B 10:40 - D 11:20
    [2, '0', 2, 0, [5, 510, 6, 540]], //          linija 2: E 8:30 - F 9:00, treba prošetati od B
    [3, '0', 0, 1, [0, 600, 3, 660]], //          vikendom: A 10:00 - C 11:00
  ],
};
const p = createPlanner(data, cal);
const go = (from: number, to: number, minutes: number, extra: object = {}) =>
  p.plan({ access: p.accessFromStop(from), to, date: '2026-11-23', minutes, mode: 'depart', ...extra });
const brief = (js: Journey[]) => js.map((j) => [j.dep, j.arr, j.rides]);

test('izravna vožnja, svi sljedeći polasci', () => {
  assert.deepEqual(brief(go(0, 2, 470)), [[480, 530, 1], [540, 590, 1]]);
});

test('presjedanje na drugu stranu poštuje hod i rezervu', () => {
  // 8:20 + 1 min hoda + 2 rezerve <= 8:24; veza 9:20 -> 9:21 je prekratka pa se čeka 10:40.
  assert.deepEqual(brief(go(0, 3, 470)), [[480, 540, 2], [540, 680, 2]]);
  const [j] = go(0, 3, 470);
  assert.deepEqual(j!.legs.map((l) => l.kind), ['ride', 'walk', 'ride']);
  assert.equal(tightest(j!), 3);
});

test('hodanje do susjedne stanice', () => {
  const [j] = go(0, 5, 470);
  assert.deepEqual([j!.dep, j!.arr, j!.rides], [480, 540, 2]);
  assert.ok(j!.walk >= 3 && j!.walk <= 5);
  const walk = j!.legs[1]!;
  assert.deepEqual([walk.kind, walk.from, walk.to], ['walk', 1, 5]);
});

test('početni hod pomiče polazak ranije', () => {
  const [j] = go(1, 5, 470); // B -> F: pješice do E pa linija 2
  assert.equal(j!.rides, 1);
  assert.equal(j!.legs[0]!.kind, 'walk');
  assert.equal(j!.dep, 510 - j!.walk);
});

test('stigni do: najkasniji polazak koji stiže na vrijeme', () => {
  assert.deepEqual(brief(go(0, 2, 589, { mode: 'arrive' })), [[480, 530, 1]]);
  assert.deepEqual(brief(go(0, 2, 590, { mode: 'arrive' })).at(-1), [540, 590, 1]);
  assert.deepEqual(brief(go(0, 2, 590, { mode: 'arrive', notBefore: 500 })), [[540, 590, 1]]);
  assert.deepEqual(go(0, 2, 520, { mode: 'arrive' }), []);
});

test('kad danas više nema, nudi sljedeći dan', () => {
  assert.deepEqual(brief(go(0, 2, 600))[0], [1440 + 480, 1440 + 530, 1]);
});

test('petak navečer vodi na vikend, a radnodnevna linija tek u ponedjeljak', () => {
  assert.deepEqual(brief(go(0, 2, 1200, { date: '2026-11-27' }))[0], [1440 + 600, 1440 + 660, 1]);
  assert.deepEqual(brief(go(0, 3, 1200, { date: '2026-11-27' }))[0], [3 * 1440 + 480, 3 * 1440 + 540, 2]);
});

test('nema veze unatrag', () => {
  assert.deepEqual(go(2, 0, 400), []);
});

test('s lokacije: hod do stajališta', () => {
  const [j] = p.plan({ access: p.accessFromPlace(44.801, 18.80), to: 2, date: '2026-11-23', minutes: 470, mode: 'depart' });
  assert.deepEqual([j!.legs[0]!.kind, j!.legs[0]!.from, j!.legs[0]!.arr], ['walk', null, 480]);
  assert.equal(j!.dep, 480 - 2);
});

test('izbacuju se prijedlozi lošiji u svemu', () => {
  const mk = (dep: number, arr: number, rides: number): Journey => ({ dep, arr, rides, walk: 0, legs: [] });
  assert.deepEqual(brief(pareto([mk(1, 9, 1), mk(2, 9, 1), mk(2, 8, 2), mk(0, 12, 3)])), [[2, 8, 2], [2, 9, 1]]);
});
