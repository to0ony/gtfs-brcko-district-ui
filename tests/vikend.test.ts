import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { analyze, type RawSettlement } from '../src/analiza/compute.ts';
import { endOf, startOf } from '../src/analiza/scenario.ts';
import { mergePatterns, sheets } from '../src/analiza/sheet.ts';
import { applyOps, build, makeBase, outcome, popOf, template, weekend, type Plan } from '../src/analiza/vikend.ts';
import type { Calendar, Network } from '../src/lib/types.ts';

const read = <T>(path: string): T => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8')) as T;
const network = read<Network>('../src/generated/network.json');
const calendar = read<Calendar>('../src/generated/calendar.json');
const plan = read<Plan>('../data/vikend.json');
const a = analyze(network, calendar.labels, read<RawSettlement[]>('../data/naselja.json'));
const b = makeBase(network);
const pop = popOf(a.settlements);
const w = weekend(network, calendar.labels, a.settlements, calendar, plan);

test('prijedlog odgovara ovom voznom redu', () => {
  assert.equal(w.stale, false);
  assert.equal(w.days.length, 2);
  for (const d of w.days) assert.ok(d.ops.length >= 4, d.label);
});

test('bez koraka ishod je današnji vozni red', () => {
  for (const d of w.days) {
    const now = outcome(b, a.settlements, pop, b.trips, d.svc);
    assert.equal(d.outcomes[0]!.trips, a.trips[d.svc]);
    assert.ok(Math.abs(d.outcomes[0]!.mean - now.mean) < 0.01);
    assert.equal(d.outcomes[0]!.buses, now.buses);
  }
});

test('obećane granice: nitko ne gubi više od 5 min, dolasci i povratci ne padaju, najviše 30 % više sati', () => {
  for (const d of w.days) {
    const [was, now] = [d.outcomes[0]!, d.outcomes.at(-1)!];
    was.avg.forEach((x, i) => assert.ok(!pop[i] || now.avg[i]! <= x + 5.1, `${d.label}: ${a.settlements[i]!.name} ${x} -> ${now.avg[i]}`));
    assert.ok(now.morning >= was.morning && now.evening >= was.evening);
    assert.ok(now.hours <= was.hours * 1.3 + 0.02, `${was.hours} -> ${now.hours}`);
    assert.ok(now.mean < was.mean - 10, `${was.mean} -> ${now.mean}`);
    assert.ok(now.buses <= was.buses + 3);
  }
});

test('svaka izmjena se može primijeniti i vozi unutar dana', () => {
  for (const op of plan.ops) {
    assert.equal(applyOps(b, b.trips, plan.ops.filter((o) => o.svc === op.svc)).skipped, 0);
    for (const n of op.add ?? []) {
      const t = build(b, n, op.svc)!;
      assert.ok(startOf(t) >= 290 && endOf(t) <= 1400);
      for (let i = 3; i < t[4].length; i += 2) assert.ok(t[4][i]! >= t[4][i - 2]!);
    }
    if (op.remove) {
      assert.equal(op.remove.length, 2);
      assert.equal(op.add!.length, 2);
      assert.notEqual(op.add![0]!.dir, op.add![1]!.dir);
      const [go, back] = op.add!.map((n) => build(b, n, op.svc)!);
      assert.ok(startOf(back!) >= endOf(go!) + 10, 'povratak kreće nakon dolaska');
    }
  }
});

test('izmjene drugog voznog reda se preskaču cijele', () => {
  const r = applyOps(b, b.trips, [{ step: 1, svc: 1, remove: [{ line: '14', dir: '0', at: 1 }], add: [{ line: '10', dir: '0', at: 600 }] }]);
  assert.equal(r.skipped, 1);
  assert.equal(r.trips, b.trips);
});

test('rep linije ide od spoja prema vanjskom kraju', () => {
  const dirs = network.lines.find((l) => l.short === '15')!.dirs;
  for (const d of dirs) {
    const flat = template(b, '15', d.id, 'pirometal')!;
    const ends = [b.slugs[flat[0]!], b.slugs[flat.at(-2)!]];
    assert.ok(ends.includes('pirometal') && !flat.some((p, i) => i % 2 === 0 && b.slugs[p] === 'centar'), ends.join());
  }
});

test('popis polazaka prije i poslije', () => {
  for (const d of w.days) for (const l of d.lines) {
    const today = b.trips.filter((t) => t[3] === d.svc && t[0] === b.lineOf.get(l.line) && t[1] === l.dir).length;
    assert.equal(l.list.filter((x) => x.state !== 'new').length, today);
  }
});

test('nadovezivanje: isti autobus, vrijeme ide naprijed i stigne na svoj sljedeći polazak', () => {
  const joins = plan.ops.filter((o) => o.join);
  assert.ok(joins.some((o) => o.join!.first.line === '8' && o.join!.line === '7'));
  for (const o of joins) {
    const j = o.join!;
    const before = b.trips.filter((t) => t[3] === o.svc);
    const { trips, skipped } = applyOps(b, b.trips, [o]);
    assert.equal(skipped, 0);
    assert.equal(trips.length, b.trips.length, 'nema novih vožnji, samo duže');
    const id = b.lineOf.get(j.first.line);
    const first = trips.find((t) => t[3] === o.svc && t[0] === id && t[1] === j.first.dir && startOf(t) === j.first.at)!;
    const old = before.find((t) => t[0] === id && t[1] === j.first.dir && startOf(t) === j.first.at)!;
    assert.deepEqual(first[4].slice(0, old[4].length), old[4], 'stari dio je netaknut');
    const then = trips.find((t) => t[3] === o.svc && t[0] === id && t[1] === j.then.dir && startOf(t) === j.back)!;
    const oldThen = before.find((t) => t[0] === id && t[1] === j.then.dir && startOf(t) === j.then.at)!;
    assert.deepEqual(then[4].slice(-oldThen[4].length), oldThen[4], 'povratak nastavlja po starom redu, s istim polaskom');
    for (const t of [first, then]) for (let i = 3; i < t[4].length; i += 2) assert.ok(t[4][i]! >= t[4][i - 2]!, `${j.line}: vrijeme unatrag`);
    assert.ok(j.back >= endOf(first) + 3, 'stigne se okrenuti');
    assert.equal(b.slugs[then[4][0]!], b.slugs[first[4].at(-2)!], 'kreće natrag odande gdje je stao');
  }
});

test('svaka se vožnja mijenja najviše jednom, pa se koraci mogu uključivati neovisno', () => {
  for (const svc of [1, 2]) {
    const refs = plan.ops.filter((o) => o.svc === svc).flatMap((o) => [o.move, ...(o.remove ?? []), o.join?.first, o.join?.then]).flatMap((r) => (r ? [`${r.line}|${r.dir}|${r.at}`] : []));
    assert.equal(new Set(refs).size, refs.length);
    for (let mask = 0; mask < 16; mask++) assert.equal(applyOps(b, b.trips, plan.ops.filter((o) => o.svc === svc && mask & (1 << o.step))).skipped, 0);
  }
});

test('list linije bez izmjena jednak je voznom redu', () => {
  for (const l of network.lines) for (const svc of calendar.labels.keys()) {
    const got = sheets(b, [], l.short, svc).flatMap((s) => s.columns.flatMap((c) => c.times.filter((m) => m !== null))).sort((x, y) => x - y);
    const want = l.dirs.flatMap((d) => d.trips.filter((t) => t.svc === svc).flatMap((t) => t.times.filter((m) => m !== null))).sort((x, y) => x - y);
    assert.deepEqual(got, want, `${l.short} ${svc}`);
  }
});

test('list linije s izmjenama', () => {
  const eight = sheets(b, plan.ops, '8', 1);
  const joined = eight.flatMap((s) => s.columns.filter((c) => c.mark === 'joined'));
  assert.equal(joined.length, 2 * plan.ops.filter((o) => o.svc === 1 && o.join?.first.line === '8').length);
  assert.ok(eight.some((s) => s.rows.includes('strepci')), 'list osmice ima i stanice sedmice');
  const seven = sheets(b, plan.ops, '7', 1);
  assert.equal(seven.flatMap((s) => s.columns.filter((c) => c.with === '8')).length, 2 * plan.ops.filter((o) => o.svc === 1 && o.join?.line === '7').length);
  assert.ok(sheets(b, plan.ops, '14', 1).some((s) => s.gone.length > 0));
  assert.ok(sheets(b, plan.ops, '10', 1).flatMap((s) => s.columns).some((c) => c.mark === 'new'));
  for (const l of network.lines) for (const svc of [1, 2]) for (const s of sheets(b, plan.ops, l.short, svc)) for (const c of s.columns) {
    const t = c.times.filter((m) => m !== null);
    // Osim ako su stanice i u samom voznom redu u drugom redoslijedu.
    const plain = sheets(b, [], l.short, svc).find((x) => x.dir === s.dir)?.columns.every((x) => { const y = x.times.filter((m) => m !== null); return y.every((m, i) => !i || m >= y[i - 1]!); });
    if (plain) assert.deepEqual(t, [...t].sort((x, y) => x - y), `${l.short} ${svc}: stanice su u redoslijedu vožnje`);
  }
  assert.deepEqual(mergePatterns([['b', 'c'], ['a', 'b', 'c', 'd']]), ['a', 'b', 'c', 'd']);
});
