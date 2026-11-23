// Prijedlog za vikend i praznike: data/vikend.json (slaže ga scripts/vikend.ts) primijenjen na vozni red.
import type { PlanData } from '../lib/planner.ts';
import type { Calendar, Network } from '../lib/types.ts';
import { CITY, planTrips, type Settlement } from './compute.ts';
import { BACK, busesOf, BY, evening, hoursOf, morning, objective, startOf, travel } from './scenario.ts';

type Trip = PlanData['trips'][number];

/** Postojeća vožnja: oznaka linije, smjer i minuta polaska. */
export interface Ref { line: string; dir: string; at: number }
/** Nova vožnja; `cut` je stanica spoja ako vozi samo rep linije od nje ili do nje. */
export interface New extends Ref { cut?: string }

/**
 * Autobus česte linije umjesto stajanja na okretištu ode dalje kao rijetka linija i vrati se na svoj sljedeći polazak.
 * Put od početka jedne do kraja druge linije je bez presjedanja.
 */
export interface Join {
  /** Vožnja koja dolazi na okretište i ona koja s njega kreće. */
  first: Ref;
  then: Ref;
  /** Rijetka linija, njezini smjerovi od spoja i prema spoju, i stanica spoja. */
  line: string;
  out: string;
  into: string;
  cut: string;
  /** Polazak sa spoja i polazak s kraja natrag. */
  at: number;
  back: number;
}

export interface Op {
  step: 0 | 1 | 2 | 3;
  svc: number;
  /** Pomak: vožnja i novi polazak. */
  move?: Ref & { to: number };
  remove?: Ref[];
  add?: New[];
  join?: Join;
}

/** data/vikend.json */
export interface Plan { trips: number; ops: Op[] }

export const STEPS = 4;

export interface Outcome {
  avg: number[];
  mean: number;
  morning: number;
  evening: number;
  hours: number;
  buses: number;
  trips: number;
}

export interface Departures { line: string; dir: string; label: string; list: { at: number; state: 'same' | 'gone' | 'new' | 'joined'; step?: number; cut?: string; /** Druga linija kod nadovezivanja. */ with?: string }[] }

export interface WeekendDay {
  svc: number;
  label: string;
  /** Ishod za svaku kombinaciju koraka (bit 0 = prvi korak). */
  outcomes: Outcome[];
  ops: Op[];
  lines: Departures[];
}

export interface Weekend {
  labels: string[];
  valid: [string, string];
  people: number;
  daysPerYear: number[];
  weekday: Outcome;
  days: WeekendDay[];
  /** Vožnje iz prijedloga kojih u ovom voznom redu nema. */
  stale: boolean;
  by: number;
  back: number;
}

export const makeBase = (network: Network) => baseFrom(planTrips(network), network);

/** Isto u pregledniku, iz /data/planer.json i /data/index.json. */
export function baseFrom({ poles, trips }: Pick<PlanData, 'poles' | 'trips'>, { stops, lines }: { stops: { slug: string }[]; lines: { short: string }[] }) {
  const slugs = poles.map(([s]) => stops[s]!.slug);
  const lineOf = new Map(lines.map((l, i) => [l.short, i]));
  const goal = poles.flatMap((_, p) => (slugs[p] === 'centar' ? [p] : []));
  return { poles, trips, slugs, lineOf, goal };
}
export type WeekendBase = ReturnType<typeof makeBase>;

/** Najdulja vožnja linije u smjeru; po potrebi samo dio od spoja ili do njega. */
export function template(b: WeekendBase, line: string, dir: string, cut?: string): number[] | null {
  const list = b.trips.filter((t) => t[0] === b.lineOf.get(line) && t[1] === dir).sort((x, y) => y[4].length - x[4].length);
  const flat = list[0]?.[4];
  if (!flat || !cut) return flat ?? null;
  const visits: [number, number][] = [];
  for (let i = 0; i < flat.length; i += 2) visits.push([flat[i]!, flat[i + 1]!]);
  const at = visits.findIndex((v) => b.slugs[v[0]] === cut);
  const center = visits.findIndex((v) => b.slugs[v[0]] === 'centar');
  if (at < 0 || center < 0) return null;
  // Rep je strana spoja na kojoj nije Centar.
  return (center < at ? visits.slice(at) : visits.slice(0, at + 1)).flat();
}

export const build = (b: WeekendBase, n: New, svc: number): Trip | null => {
  const flat = template(b, n.line, n.dir, n.cut);
  if (!flat || flat.length < 4) return null;
  return [b.lineOf.get(n.line)!, n.dir, 0, svc, flat.map((v, i) => (i % 2 ? v - flat[1]! + n.at : v))];
};

/** Vožnja i što se s njom dogodilo. */
export interface Tagged {
  t: Trip;
  mark?: 'new' | 'moved' | 'joined';
  /** Kod nadovezivanja: druga linija, i zaustavljanja (od, do) koja vozi kao ona. */
  with?: string;
  extra?: [number, number];
}

const shifted = (flat: number[], start: number) => flat.map((v, i) => (i % 2 ? v - flat[1]! + start : v));

const find = (b: WeekendBase, trips: Tagged[], r: Ref, svc: number) =>
  trips.findIndex(({ t }) => t[3] === svc && t[0] === b.lineOf.get(r.line) && t[1] === r.dir && startOf(t) === r.at);

/** Dva dijela iste vožnje; na zajedničkoj stanici ostaje vrijeme česte linije (njezin dolazak ili polazak). */
const same = (b: WeekendBase, x: number[], y: number[]) => b.slugs[x.at(-2)!] === b.slugs[y[0]!];
const extendOut = (b: WeekendBase, own: number[], tail: number[]) => [...own, ...(same(b, own, tail) ? tail.slice(2) : tail)];
const extendIn = (b: WeekendBase, tail: number[], own: number[]) => [...(same(b, tail, own) ? tail.slice(0, -2) : tail), ...own];

/** Dio rijetke linije koji vozi autobus česte: od spoja i natrag. */
export function tails(b: WeekendBase, j: Join): [number[], number[]] | null {
  const out = template(b, j.line, j.out, j.cut);
  const into = template(b, j.line, j.into, j.cut);
  return out && into ? [shifted(out, j.at), shifted(into, j.back)] : null;
}

export function applyTagged(b: WeekendBase, trips: Trip[], ops: Op[]): { trips: Tagged[]; skipped: number } {
  let out: Tagged[] = trips.map((t) => ({ t }));
  let skipped = 0;
  for (const op of ops) {
    const next = [...out];
    let ok = true;
    if (op.move) {
      const i = find(b, next, op.move, op.svc);
      if (i < 0) ok = false;
      else { const { t } = next[i]!; next[i] = { t: [t[0], t[1], t[2], t[3], shifted(t[4], op.move.to)], mark: 'moved' }; }
    }
    if (op.join) {
      const i = find(b, next, op.join.first, op.svc);
      const k = find(b, next, op.join.then, op.svc);
      const parts = tails(b, op.join);
      if (i < 0 || k < 0 || !parts) ok = false;
      else {
        const a = next[i]!.t;
        const c = next[k]!.t;
        const out = extendOut(b, a[4], parts[0]);
        const back = extendIn(b, parts[1], c[4]);
        next[i] = { t: [a[0], a[1], a[2], a[3], out], mark: 'joined', with: op.join.line, extra: [a[4].length / 2, out.length / 2] };
        next[k] = { t: [c[0], c[1], c[2], c[3], back], mark: 'joined', with: op.join.line, extra: [0, (back.length - c[4].length) / 2] };
      }
    }
    for (const r of op.remove ?? []) {
      const i = find(b, next, r, op.svc);
      if (i < 0) ok = false;
      else next.splice(i, 1);
    }
    for (const n of op.add ?? []) {
      const t = build(b, n, op.svc);
      if (!t) ok = false;
      else next.push({ t, mark: 'new' });
    }
    if (ok) out = next;
    else skipped++;
  }
  return { trips: out, skipped };
}

/** Vozni red s primijenjenim izmjenama; izmjene čije vožnje ne postoje preskaču se cijele. */
export function applyOps(b: WeekendBase, trips: Trip[], ops: Op[]): { trips: Trip[]; skipped: number } {
  const r = applyTagged(b, trips, ops);
  return r.skipped === ops.length ? { trips, skipped: r.skipped } : { trips: r.trips.map((x) => x.t), skipped: r.skipped };
}

export function outcome(b: WeekendBase, settlements: Pick<Settlement, 'access'>[], pop: number[], trips: Trip[], svc: number): Outcome {
  const net = { poles: b.poles, trips, access: settlements.map((s) => s.access), delay: [] };
  const t = travel(net, svc, b.goal);
  return {
    avg: t.avg,
    mean: objective(t.avg, pop, 1),
    morning: morning(t, pop),
    evening: evening(t, pop),
    hours: hoursOf(trips, svc),
    buses: busesOf(trips, svc),
    trips: trips.filter((x) => x[3] === svc).length,
  };
}

export const popOf = (settlements: Pick<Settlement, 'name' | 'pop'>[]) => settlements.map((s) => (s.name === CITY ? 0 : s.pop));

export function weekend(network: Network, labels: string[], settlements: Settlement[], calendar: Pick<Calendar, 'days' | 'start' | 'end'>, plan: Plan): Weekend {
  const b = makeBase(network);
  const pop = popOf(settlements);
  let skipped = 0;
  const round = (o: Outcome): Outcome => ({ ...o, avg: o.avg.map((x) => Math.round(x * 10) / 10) });
  const svcs = [...new Set(plan.ops.map((o) => o.svc))].filter((s) => s < labels.length).sort((x, y) => x - y);
  const days = svcs.map((svc): WeekendDay => {
    const ops = plan.ops.filter((o) => o.svc === svc);
    const outcomes = Array.from({ length: 1 << STEPS }, (_, mask) => {
      const r = applyOps(b, b.trips, ops.filter((o) => mask & (1 << o.step)));
      if (mask === (1 << STEPS) - 1) skipped += r.skipped;
      return round(outcome(b, settlements, pop, r.trips, svc));
    });

    const lines: Departures[] = [];
    const touched = new Set(ops.flatMap((o) => [
      ...[o.move, ...(o.remove ?? []), ...(o.add ?? []), o.join?.first, o.join?.then].flatMap((r) => (r ? [`${r.line}|${r.dir}`] : [])),
      ...(o.join ? [`${o.join.line}|${o.join.out}`, `${o.join.line}|${o.join.into}`] : []),
    ]));
    for (const line of network.lines) {
      for (const dir of line.dirs) {
        if (!touched.has(`${line.short}|${dir.id}`)) continue;
        const list: Departures['list'] = b.trips
          .filter((t) => t[3] === svc && t[0] === b.lineOf.get(line.short) && t[1] === dir.id)
          .map((t) => ({ at: startOf(t), state: 'same' }));
        for (const o of ops) {
          const gone = [...(o.move ? [o.move] : []), ...(o.remove ?? [])].filter((r) => r.line === line.short && r.dir === dir.id);
          for (const r of gone) { const x = list.find((y) => y.at === r.at && y.state === 'same'); if (x) { x.state = 'gone'; x.step = o.step; } }
          if (o.move && o.move.line === line.short && o.move.dir === dir.id) list.push({ at: o.move.to, state: 'new', step: o.step });
          if (o.join) {
            for (const r of [o.join.first, o.join.then]) {
              if (r.line !== line.short || r.dir !== dir.id) continue;
              const x = list.find((y) => y.at === r.at && y.state === 'same');
              if (x) Object.assign(x, { state: 'joined', step: o.step, with: o.join.line });
            }
            if (o.join.line === line.short && o.join.out === dir.id) list.push({ at: o.join.at, state: 'new', step: o.step, cut: o.join.cut, with: o.join.first.line });
            if (o.join.line === line.short && o.join.into === dir.id) list.push({ at: o.join.back, state: 'new', step: o.step, with: o.join.then.line });
          }
          for (const n of o.add ?? []) if (n.line === line.short && n.dir === dir.id) list.push({ at: n.at, state: 'new', step: o.step, ...(n.cut ? { cut: n.cut } : {}) });
        }
        lines.push({ line: line.short, dir: dir.id, label: dir.label, list: list.sort((x, y) => x.at - y.at) });
      }
    }
    return { svc, label: labels[svc]!, outcomes, ops, lines };
  });
  return {
    labels,
    valid: [calendar.start, calendar.end],
    people: pop.reduce((x, y) => x + y, 0),
    daysPerYear: labels.map((_, i) => calendar.days.filter((m) => m & (1 << i)).length),
    weekday: round(outcome(b, settlements, pop, b.trips, 0)),
    days,
    stale: skipped > 0 || plan.trips !== b.trips.length,
    by: BY,
    back: BACK,
  };
}
