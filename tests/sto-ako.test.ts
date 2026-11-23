import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { analyze, inside, planTrips, type RawSettlement } from '../src/analiza/compute.ts';
import { whatIf } from '../src/analiza/proposals.ts';
import { arrivalAt, createReach } from '../src/analiza/reach.ts';
import { apply, arrive, averages, backOf, busesOf, decode, encode, evening, hoursOf, improve, objective, leaveBy, mirror, morning, profileTo, score, startOf, STOP_RULE, travel, TURN, wantedStops, type Base, type Change } from '../src/analiza/scenario.ts';
import type { Calendar, Network } from '../src/lib/types.ts';

const read = <T>(path: string): T => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8')) as T;
const network = read<Network>('../src/generated/network.json');
const calendar = read<Calendar>('../src/generated/calendar.json');
const raw = read<RawSettlement[]>('../data/naselja.json');
const a = analyze(network, calendar.labels, raw);
const w = whatIf(network, raw);
const plan = planTrips(network);
const base: Base = { ...plan, settlements: a.settlements, proposals: w.proposals };
const center = plan.poles.flatMap(([s], p) => (network.stops[s]!.slug === 'centar' ? [p] : []));
const plain = apply(base, []);
const idx = (name: string) => a.settlements.findIndex((s) => s.name === name);

test('profil daje isti dolazak kao pretraga unaprijed', () => {
  const reach = createReach(plan);
  let n = 0;
  for (const svc of [0, 1]) {
    const profile = profileTo(plain, svc, center);
    for (const s of a.settlements) {
      if (s.access.some(([p]) => center.includes(p))) continue;
      for (const t of [300, 400, 487, 615, 790, 1003, 1180]) {
        const fwd = arrivalAt(reach.earliest(svc, new Map(s.access), t), new Map(center.map((p) => [p, 0])));
        assert.equal(arrive(profile, s.access, t), fwd, `${s.name} u ${t}, dan ${svc}`);
        n++;
      }
    }
  }
  assert.ok(n > 600, String(n));
});

test('put kući: najkasniji polazak je stvarno najkasniji', () => {
  const reach = createReach(plan);
  const start = reach.accessFrom(center);
  const home = profileTo(mirror(plain, 0), 0, center);
  let n = 0;
  for (const s of a.settlements.filter((x) => x.stops.length && !x.access.some(([p]) => center.includes(p)))) {
    for (const by of [500, 730, 1000, 1260]) {
      const dep = leaveBy(home, s.access, by);
      const at = (t: number) => arrivalAt(reach.earliest(0, start, t), new Map(s.access));
      if (dep === -Infinity) { assert.ok(at(240) > by, s.name); continue; }
      assert.ok(at(dep) <= by, `${s.name}: polazak ${dep} ne stiže do ${by}`);
      assert.ok(at(dep + 1) > by, `${s.name}: i polazak ${dep + 1} stiže do ${by}`);
      n++;
    }
  }
  assert.ok(n > 150, String(n));
});

test('ukidanje vožnje iz Centra kući pogoršava ocjenu', () => {
  const t = plan.trips.findIndex((x) => x[3] === 0 && network.lines[x[0]]!.short === '10' && x[4].some((p, i) => i % 2 === 0 && center.includes(p)) && x[1] === '1');
  const before = averages(plain, 0, center);
  const after = averages(apply(base, [{ k: 'r', t }]), 0, center);
  assert.ok(after[idx('Bijela')]! > before[idx('Bijela')]! + 1);
});

test('bez izmjena ništa se ne mijenja', () => {
  assert.deepEqual(plain.trips.map((t) => t[4]), plan.trips.map((t) => t[4]));
  const s = score(plain, 0, center);
  assert.equal(s.trips, a.trips[0]);
  assert.equal(Math.round(s.hours * 10), 1182);
  assert.equal(s.buses, 16);
  a.settlements.forEach((x, i) => { if (x.center[0]) assert.equal(s.first[i], x.center[0].first, x.name); });
});

test('pomak, ukidanje i nova vožnja s povratkom', () => {
  const t = plan.trips.findIndex((x) => x[3] === 0);
  const m = apply(base, [{ k: 'm', t, by: 15 }]);
  assert.equal(startOf(m.trips[t]!), startOf(plan.trips[t]!) + 15);
  assert.equal(hoursOf(m.trips, 0), hoursOf(plan.trips, 0));
  assert.equal(apply(base, [{ k: 'r', t }]).trips.length, plan.trips.length - 1);
  const b = backOf(plan.trips, t);
  assert.ok(b >= 0 && plan.trips[b]![0] === plan.trips[t]![0] && plan.trips[b]![1] !== plan.trips[t]![1]);
  const net = apply(base, [{ k: 'a', t, at: 600, svc: 1, b }]);
  assert.equal(net.trips.length, plan.trips.length + 2);
  const [go, ret] = net.trips.slice(-2);
  assert.equal(startOf(go!), 600);
  assert.equal(startOf(ret!), go![4].at(-1)! + TURN);
  assert.equal(go![3], 1);
});

test('vožnja više nikad ne šteti, manje nikad ne pomaže', () => {
  const before = averages(plain, 0, center);
  for (let t = 3; t < plan.trips.length; t += 41) {
    const more = averages(apply(base, [{ k: 'a', t, at: 620, svc: 0, b: backOf(plan.trips, t) }]), 0, center);
    const less = plan.trips[t]![3] === 0 ? averages(apply(base, [{ k: 'r', t }]), 0, center) : before;
    before.forEach((x, i) => { assert.ok(more[i]! <= x + 1e-9); assert.ok(less[i]! >= x - 1e-9); });
  }
});

test('prijedlozi stanica: u naselju, uz trasu, vremena rastu', () => {
  const stops = w.proposals.filter((p) => p.kind === 'stop');
  assert.ok(stops.length > 20, String(stops.length));
  w.proposals.forEach((p, i) => {
    assert.equal(p.id, i);
    const s = raw.find((x) => x.id === p.settlement)!;
    assert.ok(inside(s.rings, p.lon, p.lat) || p.kind === 'detour', s.name);
    assert.ok(p.inserts.length > 0, s.name);
    const net = apply(base, [{ k: 's', p: i }]);
    for (const t of net.trips) for (let k = 3; k < t[4].length; k += 2) assert.ok(t[4][k]! >= t[4][k - 2]!, `${s.name}: vrijeme ide unatrag`);
    assert.equal(net.poles.length, plan.poles.length + 1);
  });
});

test('skretanje približi naselje bez stanice', () => {
  const detours = w.proposals.filter((p) => p.kind === 'detour');
  const named = detours.map((p) => raw.find((x) => x.id === p.settlement)!.name);
  assert.ok(named.includes('Laništa'), named.join());
  for (const p of detours) {
    const i = a.settlements.findIndex((s) => s.id === p.settlement);
    const after = averages(apply(base, [{ k: 's', p: p.id }]), 0, center);
    assert.ok(after[i]! < averages(plain, 0, center)[i]!, a.settlements[i]!.name);
    assert.ok(p.extra >= 2 && p.extra <= 24, `${a.settlements[i]!.name} ${p.extra}`);
    assert.ok(hoursOf(apply(base, [{ k: 's', p: p.id }]).trips, 0) > hoursOf(plan.trips, 0));
  }
});

test('zapis scenarija i natrag', () => {
  const c: Change[] = [{ k: 'm', t: 5, by: -15 }, { k: 'r', t: 8 }, { k: 'a', t: 1, at: 615, svc: 0, b: 12 }, { k: 'a', t: 1, at: 615, svc: 1, b: -1 }, { k: 's', p: 2 }];
  assert.deepEqual(decode(encode(c), plan.trips.length, w.proposals.length), c);
  assert.deepEqual(decode('', 10, 10), []);
  assert.deepEqual(decode('m999999_5.rX.a1_2.zzz.s9999.m1_900.a1_99999_0_0', plan.trips.length, w.proposals.length), []);
});

test('traženje poštuje granice i popravlja', () => {
  let seed = 5;
  const random = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const pop = a.settlements.map((s) => (s.name === 'Brčko' ? 0 : s.pop));
  const hours = hoursOf(plan.trips, 0);
  const t0 = performance.now();
  let last: { changes: Change[]; value: number } = { changes: [], value: 0 };
  for (const step of improve(base, [], { svc: 0, goal: center, keep: true, pop, alpha: 1, maxHours: hours, maxBuses: 16, maxChanges: 6, tries: 60, random })) last = step;
  const ms = performance.now() - t0;
  const net = apply(base, last.changes);
  assert.ok(last.changes.length > 0 && last.changes.length <= 6);
  assert.ok(hoursOf(net.trips, 0) <= hours + 0.01);
  assert.ok(busesOf(net.trips, 0) <= 16);
  assert.ok(morning(travel(net, 0, center), pop) >= morning(travel(plain, 0, center), pop));
  assert.ok(evening(travel(net, 0, center), pop) >= evening(travel(plain, 0, center), pop));
  const before = objective(averages(plain, 0, center), pop, 1);
  const after = objective(averages(net, 0, center), pop, 1);
  assert.ok(Math.abs(after - last.value) < 1e-9);
  assert.ok(after < before - 0.5, `${before} -> ${after}`);
  assert.ok(ms < 20_000, `${ms} ms`);
});

test('traženje s manjim budžetom ukida vožnje', () => {
  let seed = 9;
  const random = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const pop = a.settlements.map((s) => (s.name === 'Brčko' ? 0 : s.pop));
  const maxHours = hoursOf(plan.trips, 0) - 3;
  let changes: Change[] = [];
  for (const step of improve(base, [], { svc: 0, goal: center, keep: false, pop, alpha: 1, maxHours, maxBuses: 16, maxChanges: 12, tries: 30, random })) changes = step.changes;
  assert.ok(hoursOf(apply(base, changes).trips, 0) <= maxHours + 0.01);
});

test('pravilo za stanice', () => {
  assert.equal(wantedStops({ pop: 45, km2: 7 }, 0, STOP_RULE), 0);
  assert.equal(wantedStops({ pop: 732, km2: 5 }, 0, STOP_RULE), 1);
  assert.equal(wantedStops({ pop: 1923, km2: 19.8 }, 5.4, STOP_RULE), 5);
  for (const s of a.settlements) assert.ok(w.roadKm[s.id]! >= 0);
  assert.ok(wantedStops(a.settlements[idx('Maoča')]!, w.roadKm[a.settlements[idx('Maoča')]!.id]!, STOP_RULE) > a.settlements[idx('Maoča')]!.stops.length);
});
