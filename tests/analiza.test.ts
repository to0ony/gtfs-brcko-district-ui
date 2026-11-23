import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { analyze, gini, inside, planTrips, type RawSettlement } from '../src/analiza/compute.ts';
import { createReach } from '../src/analiza/reach.ts';
import { createPlanner, RULES } from '../src/lib/planner.ts';
import type { Calendar, Network } from '../src/lib/types.ts';

const read = <T>(path: string): T => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8')) as T;
const network = read<Network>('../src/generated/network.json');
const calendar = read<Calendar>('../src/generated/calendar.json');
const raw = read<RawSettlement[]>('../data/naselja.json');
const a = analyze(network, calendar.labels, raw);
const by = (name: string) => a.settlements.find((s) => s.name === name)!;

test('popis: zbrojevi i dob', () => {
  assert.equal(raw.length, 59);
  assert.equal(raw.reduce((s, x) => s + x.pop, 0), 83_516);
  assert.equal(raw.reduce((s, x) => s + x.pop91, 0), 87_627);
  for (const x of raw) assert.equal(x.ages.reduce((s, n) => s + n, 0), x.pop, x.name);
  const km2 = raw.reduce((s, x) => s + x.km2, 0);
  assert.ok(Math.abs(km2 - 493.6) < 5, `površina ${km2}`);
});

test('svako stajalište je u točno jednom naselju', () => {
  for (const s of network.stops) for (const p of s.poles) {
    assert.equal(raw.filter((x) => inside(x.rings, p.lon, p.lat)).length, 1, p.id);
  }
});

test('naselja i istoimene stanice', () => {
  for (const [settlement, slug] of [['Maoča', 'maoca-badarka'], ['Brčko', 'bolnica'], ['Omerbegovača', 'omerbegovaca'], ['Bijela', 'bijela-skola']]) {
    assert.ok(by(settlement!).stops.some((s) => s.slug === slug), `${settlement}: ${by(settlement!).stops.map((s) => s.slug).join()}`);
  }
});

test('vožnje po naselju odgovaraju voznom redu', () => {
  // Kroz Maoču voze linije 8 i 9, i svaka njihova vožnja ondje ima barem jednu stanicu na kojoj se može ući.
  assert.deepEqual(by('Maoča').lines, ['8', '9']);
  for (const [svc] of calendar.labels.entries()) {
    const n = network.lines.filter((l) => ['8', '9'].includes(l.slug)).reduce((sum, l) => sum + l.dirs.reduce((x, d) => x + d.trips.filter((t) => t.svc === svc).length, 0), 0);
    assert.ok(by('Maoča').days[svc]!.trips <= n && by('Maoča').days[svc]!.trips >= n * 0.8, `${by('Maoča').days[svc]!.trips}/${n}`);
  }
  for (const s of a.settlements) for (const d of s.days) {
    assert.equal(d.hours.reduce((x, y) => x + y, 0), d.trips);
    assert.equal(d.trips === 0, d.first === null);
    if (!s.stops.length) assert.equal(d.trips, 0);
  }
});

test('zbrojevi po linijama i satima', () => {
  for (const [svc] of calendar.labels.entries()) {
    const n = network.lines.reduce((s, l) => s + l.dirs.reduce((x, d) => x + d.trips.filter((t) => t.svc === svc).length, 0), 0);
    assert.equal(a.trips[svc], n);
    assert.equal(a.hours[svc]!.reduce((x, y) => x + y, 0), n);
  }
  for (const l of a.lines) {
    assert.ok(l.km > 3 && l.km < 60, `${l.short}: ${l.km} km`);
    assert.ok(l.speed > 12 && l.speed < 60, `${l.short}: ${l.speed} km/h`);
    assert.ok(l.shared >= 0 && l.shared <= 1);
  }
});

test('Gini', () => {
  assert.equal(gini([{ people: 10, supply: 5 }, { people: 30, supply: 5 }]), 0);
  assert.ok(Math.abs(gini([{ people: 1, supply: 0 }, { people: 1, supply: 8 }]) - 0.5) < 1e-9);
  for (const g of a.gini) assert.ok(g > 0 && g < 1);
});

test('najraniji dolazak jednak je planeru', () => {
  const data = { ...planTrips(network), headsigns: [''] };
  const reach = createReach(data);
  const planner = createPlanner(data, calendar);
  const saved = { ...RULES };
  Object.assign(RULES, { results: 999, tooMuchLonger: Infinity });
  let seed = 11;
  const rnd = (n: number) => (seed = (seed * 1103515245 + 12345) % 2147483648) % n;
  let found = 0;
  for (let i = 0; i < 250; i++) {
    const from = rnd(network.stops.length);
    const to = rnd(network.stops.length);
    if (from === to) continue;
    const t = 300 + rnd(840);
    const own = data.poles.flatMap(([s], p) => (s === from ? [p] : []));
    const goal = data.poles.flatMap(([s], p) => (s === to ? [p] : []));
    const access = reach.accessFrom(own);
    assert.deepEqual([...access].sort(), [...planner.accessFromStop(from)].sort());
    const arrived = reach.earliest(0, access, t);
    const mine = Math.min(...goal.map((p) => arrived[p]!));
    if (goal.some((p) => access.has(p))) continue; // pješice; planer to vodi odvojeno
    const plans = planner.plan({ access, to, date: '2026-11-23', minutes: t, mode: 'depart' }).filter((j) => j.arr < 1440 + 60 && j.dep >= t && j.dep <= 1439);
    const best = Math.min(...plans.map((j) => j.arr));
    if (best === Infinity) assert.ok(mine === Infinity || mine - t > RULES.maxTotal, `${from}->${to} u ${t}: ${mine}`);
    else if (mine !== best) assert.ok(mine < best && mine - t > 0, `${from}->${to} u ${t}: doseg ${mine}, planer ${best}`);
    else found++;
  }
  Object.assign(RULES, saved);
  assert.ok(found > 150, `uspoređeno ${found}`);
});

test('put do Centra i Bolnice', () => {
  assert.equal(by('Brčko').center[0], null);
  const maoca = by('Maoča').center[0]!;
  assert.ok(maoca.best >= 25 && maoca.best <= 60, String(maoca.best));
  assert.ok(maoca.first < 8 * 60 && maoca.back! > 18 * 60);
});

test('nalazi nemaju praznih mjesta', () => {
  assert.ok(a.findings.length >= 5);
  for (const f of a.findings) assert.doesNotMatch(f, /undefined|NaN|Infinity|null|: \.|\(\)/, f);
});
