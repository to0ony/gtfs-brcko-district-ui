// „Što ako”: izmjene voznog reda i njihov učinak. Čiste funkcije, sve se računa u pregledniku.
import { meters, RULES, walkMinutes, type PlanData } from '../lib/planner.ts';
import type { Settlement } from './compute.ts';
import type { Proposal } from './proposals.ts';

type Pole = PlanData['poles'][number];
type Trip = PlanData['trips'][number];

export type Change =
  /** Pomak polaska za `by` minuta. */
  | { k: 'm'; t: number; by: number }
  /** Ukinuta vožnja. */
  | { k: 'r'; t: number }
  /** Nova vožnja kao kopija vožnje `t`, s polaskom u `at`; `b` je uzorak povratne vožnje ili -1. */
  | { k: 'a'; t: number; at: number; svc: number; b: number }
  /** Nova stanica ili skretanje. */
  | { k: 's'; p: number };

/** Okretanje na zadnjoj stanici prije povratne vožnje. */
export const TURN = 10;
/** Koliko nova stanica usporava vožnju, u minutama. */
export const STOP_DELAY = 0.5;

export const encode = (changes: Change[]) => changes.map((c) =>
  c.k === 'm' ? `m${c.t}_${c.by}` : c.k === 'r' ? `r${c.t}` : c.k === 's' ? `s${c.p}` : `a${c.t}_${c.at}_${c.svc}_${c.b}`).join('.');

export function decode(s: string, trips: number, proposals: number): Change[] {
  const out: Change[] = [];
  for (const part of s.split('.')) {
    const k = part[0];
    const n = part.slice(1).split('_').map(Number);
    if (n.some((x) => !Number.isInteger(x))) continue;
    const trip = n[0]! >= 0 && n[0]! < trips;
    if (k === 'm' && n.length === 2 && trip && Math.abs(n[1]!) <= 180) out.push({ k, t: n[0]!, by: n[1]! });
    else if (k === 'r' && n.length === 1 && trip) out.push({ k, t: n[0]! });
    else if (k === 's' && n.length === 1 && n[0]! >= 0 && n[0]! < proposals) out.push({ k, p: n[0]! });
    else if (k === 'a' && n.length === 4 && trip && n[1]! >= 0 && n[1]! < 1440 && n[2]! >= 0 && n[2]! < 8 && n[3]! >= -1 && n[3]! < trips) out.push({ k, t: n[0]!, at: n[1]!, svc: n[2]!, b: n[3]! });
  }
  return out;
}

export interface Base {
  poles: Pole[];
  trips: Trip[];
  settlements: Pick<Settlement, 'id' | 'pop' | 'access' | 'stops'>[];
  proposals: Proposal[];
}

export interface Net {
  poles: Pole[];
  trips: Trip[];
  /** Za svako naselje: [stajalište, minute hoda]. */
  access: [number, number][][];
  /** Usporavanje zbog novih stanica koje ne stane u cijele minute, sati po vrsti dana. */
  delay: number[];
}

const duration = (flat: number[]) => flat.at(-1)! - flat[1]!;
export const startOf = (t: Trip) => t[4][1]!;
export const endOf = (t: Trip) => t[4].at(-1)!;
const moved = (flat: number[], by: number) => flat.map((v, i) => (i % 2 ? v + by : v));

const poleCache = new WeakMap<Base, Map<string, Pole[]>>();
/** Isti niz za iste stanice, da se pješačke veze ne računaju ispočetka. */
function polesWith(base: Base, stops: Proposal[]): Pole[] {
  if (!stops.length) return base.poles;
  const cache = poleCache.get(base) ?? new Map<string, Pole[]>();
  poleCache.set(base, cache);
  const key = stops.map((p) => p.id).join();
  let poles = cache.get(key);
  if (!poles) {
    poles = [...base.poles, ...stops.map((p): Pole => [-1 - p.id, 0, p.lat, p.lon])];
    cache.set(key, poles);
  }
  return poles;
}

export function apply(base: Base, changes: Change[]): Net {
  const stops = changes.flatMap((c) => (c.k === 's' && base.proposals[c.p] ? [base.proposals[c.p]!] : []));
  const poles = polesWith(base, stops);
  const access = base.settlements.map((s) => s.access);
  const flats: (number[] | null)[] = base.trips.map((t) => t[4]);
  const svcOf = base.trips.map((t) => t[3]);
  const delay: number[] = [];

  // Stanice i skretanja prvo, da ih dobiju i dodane vožnje. Iza kraja prema početku, da se indeksi ne pomiču.
  const inserts = new Map<number, { after: number; share: number; pole: number; extra: number }[]>();
  for (const [n, p] of stops.entries()) {
    const pole = base.poles.length + n;
    for (const [t, after, share] of p.inserts) inserts.set(t, [...(inserts.get(t) ?? []), { after, share, pole, extra: p.extra }]);
    const i = base.settlements.findIndex((s) => s.id === p.settlement);
    if (i >= 0) access[i] = [...access[i]!, [pole, 0]];
  }
  for (const [t, list] of inserts) {
    const flat = flats[t]!;
    let out: number[] = [];
    let shift = 0;
    for (let v = 0; v * 2 < flat.length; v++) {
      const m = flat[2 * v + 1]!;
      out.push(flat[2 * v]!, m + shift);
      const here = list.filter((x) => x.after === v).sort((a, b) => a.share - b.share);
      const span = (flat[2 * v + 3] ?? m) - m;
      for (const x of here) {
        // Do skretanja i natrag: pola dodatnog vremena je prije stanice, pola poslije.
        out.push(x.pole, m + shift + Math.round(span * x.share) + Math.ceil(x.extra / 2));
        shift += x.extra;
      }
    }
    flats[t] = out;
    const small = list.filter((x) => !x.extra).length * STOP_DELAY;
    delay[svcOf[t]!] = (delay[svcOf[t]!] ?? 0) + small / 60;
  }

  const added: Trip[] = [];
  for (const c of changes) {
    if (c.k === 'r') flats[c.t] = null;
    else if (c.k === 'm' && flats[c.t]) flats[c.t] = moved(flats[c.t]!, c.by);
    else if (c.k === 'a') {
      const t = base.trips[c.t]!;
      const flat = inserts.has(c.t) ? flats[c.t] ?? t[4] : t[4];
      added.push([t[0], t[1], t[2], c.svc, moved(flat, c.at - flat[1]!)]);
      const back = base.trips[c.b];
      if (back) added.push([back[0], back[1], back[2], c.svc, moved(back[4], c.at + duration(flat) + TURN - back[4][1]!)]);
    }
  }
  const trips: Trip[] = [];
  flats.forEach((flat, i) => { if (flat) trips.push([base.trips[i]![0], base.trips[i]![1], base.trips[i]![2], svcOf[i]!, flat]); });
  return { poles, trips: [...trips, ...added], access, delay };
}

/* ---------- profil do odredišta ---------- */

interface Foot { to: number; minutes: number; same: boolean }

const footCache = new WeakMap<Pole[], Foot[][]>();
export function footpaths(poles: Pole[]): Foot[][] {
  let foot = footCache.get(poles);
  if (!foot) {
    foot = poles.map(([stopA, , latA, lonA], a) => poles.flatMap(([stopB, , latB, lonB], b) => {
      if (a === b || Math.abs(latA - latB) > 0.02) return [];
      const m = meters(latA, lonA, latB, lonB);
      const same = stopA === stopB;
      return same || m * RULES.detour <= RULES.maxWalk ? [{ to: b, minutes: walkMinutes(m), same }] : [];
    }));
    footCache.set(poles, foot);
  }
  return foot;
}

/** Za svako stajalište: polasci (silazno) i dolasci na odredište. Isti rezultat kao `earliest` za svaki trenutak polaska. */
export type Profile = { dep: number[]; arr: number[] }[];

/** Najraniji dolazak na odredište za polazak sa stajališta u `t` ili kasnije. */
export function lookup(p: Profile[number], t: number): number {
  // dep je silazan: zadnji s dep >= t ima najraniji dolazak.
  let lo = 0;
  let hi = p.dep.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (p.dep[mid]! >= t) lo = mid + 1;
    else hi = mid;
  }
  return lo ? p.arr[lo - 1]! : Infinity;
}

export function profileTo(net: Pick<Net, 'poles' | 'trips'>, svc: number, goal: number[]): Profile {
  const foot = footpaths(net.poles);
  const walk = new Float64Array(net.poles.length).fill(Infinity);
  for (const g of goal) {
    walk[g] = 0;
    for (const f of foot[g]!) if (!f.same) walk[f.to] = Math.min(walk[f.to]!, f.minutes);
  }
  for (const g of goal) walk[g] = 0;

  const conns: { dep: number; arr: number; from: number; to: number; trip: number; i: number }[] = [];
  net.trips.forEach(([, , , s, flat], trip) => {
    if (s !== svc) return;
    for (let i = 0; i + 3 < flat.length; i += 2) conns.push({ dep: flat[i + 1]!, arr: flat[i + 3]!, from: flat[i]!, to: flat[i + 2]!, trip, i });
  });
  conns.sort((a, b) => b.dep - a.dep || b.trip - a.trip || b.i - a.i);

  const out: Profile = net.poles.map(() => ({ dep: [], arr: [] }));
  const onTrip = new Float64Array(net.trips.length).fill(Infinity);
  for (const c of conns) {
    let a = onTrip[c.trip]!;
    a = Math.min(a, c.arr + walk[c.to]!, lookup(out[c.to]!, c.arr + RULES.change));
    for (const f of foot[c.to]!) a = Math.min(a, lookup(out[f.to]!, c.arr + f.minutes + RULES.changeOnFoot));
    if (a === Infinity) continue;
    onTrip[c.trip] = a;
    const p = out[c.from]!;
    const n = p.dep.length;
    if (n && p.arr[n - 1]! <= a) continue;
    if (n && p.dep[n - 1] === c.dep) p.arr[n - 1] = a;
    else { p.dep.push(c.dep); p.arr.push(a); }
  }
  return out;
}

/** Najraniji dolazak iz naselja; naselje bira najbolje stajalište. */
export const arrive = (profile: Profile, access: [number, number][], t: number) => {
  let best = Infinity;
  for (const [p, w] of access) best = Math.min(best, lookup(profile[p]!, t + w));
  return best;
};

/* ---------- mjere ---------- */

/**
 * Uzorak dana, svakih 30 min: tko krene između 6:00 i 20:00 kad stigne na odredište, i tko kući želi biti između
 * 8:00 i 22:00 kad najkasnije mora krenuti. Put dulji od CAP (ili nemoguć) računa se kao CAP.
 */
export const SAMPLE = { from: 360, to: 1200, step: 30, back: 120 };
export const CAP = 180;
export const BY = 8 * 60;
export const BACK = 19 * 60;

export interface Score {
  /** Prosječno vrijeme puta s čekanjem, po naselju: do odredišta, natrag i sredina obaju. */
  to: number[];
  from: number[];
  avg: number[];
  /** Najraniji dolazak u danu, po naselju. */
  first: number[];
  /** Posljednji polazak s odredišta kojim se stiže kući; -Infinity ako ga nema. */
  last: number[];
  hours: number;
  trips: number;
  /** Najviše autobusa istodobno na putu. */
  buses: number;
}

export function busesOf(trips: Trip[], svc: number): number {
  const ev: [number, number][] = [];
  for (const t of trips) if (t[3] === svc) ev.push([startOf(t), 1], [endOf(t), -1]);
  ev.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let now = 0;
  let max = 0;
  for (const [, d] of ev) { now += d; max = Math.max(max, now); }
  return max;
}

export const hoursOf = (trips: Trip[], svc: number) => trips.reduce((s, t) => s + (t[3] === svc ? duration(t[4]) : 0), 0) / 60;

function average(profile: Profile, access: [number, number][], mirrored = false): number {
  let sum = 0;
  let n = 0;
  for (let t = SAMPLE.from; t <= SAMPLE.to; t += SAMPLE.step, n++) {
    const x = mirrored ? -(t + SAMPLE.back) : t;
    sum += Math.min(CAP, arrive(profile, access, x) - x);
  }
  return sum / n;
}

/** Vožnje unatrag u vremenu: put do odredišta u njima je put od odredišta u stvarnosti. */
export const mirror = (net: Pick<Net, 'poles' | 'trips'>, svc: number): Pick<Net, 'poles' | 'trips'> => ({
  poles: net.poles,
  trips: net.trips.flatMap((t): Trip[] => {
    if (t[3] !== svc) return [];
    const flat: number[] = [];
    for (let i = t[4].length - 2; i >= 0; i -= 2) flat.push(t[4][i]!, -t[4][i + 1]!);
    return [[t[0], t[1], t[2], t[3], flat]];
  }),
});

/** Najkasniji polazak s odredišta da se u naselje stigne do `by`; -Infinity ako se ne može. */
export const leaveBy = (mirrored: Profile, access: [number, number][], by: number) => -arrive(mirrored, access, -by);

const END_OF_DAY = 26 * 60;

/** Koliko u prosjeku traje put, s čekanjem, u oba smjera; i tko stiže do BY, odnosno može kući nakon BACK. */
export function travel(net: Net, svc: number, goal: number[]) {
  const there = profileTo(net, svc, goal);
  const home = profileTo(mirror(net, svc), svc, goal);
  const to = net.access.map((a) => average(there, a));
  const from = net.access.map((a) => average(home, a, true));
  return {
    to,
    from,
    avg: to.map((x, i) => (x + from[i]!) / 2),
    first: net.access.map((a) => arrive(there, a, 240)),
    last: net.access.map((a) => leaveBy(home, a, END_OF_DAY)),
  };
}

export const averages = (net: Net, svc: number, goal: number[]): number[] => travel(net, svc, goal).avg;
/** Stanovnici koji do odredišta stižu najkasnije u BY, i oni koji se kući mogu vratiti u BACK ili kasnije. */
export const morning = (t: { first: number[] }, pop: number[]) => pop.reduce((s, p, i) => s + (t.first[i]! <= BY ? p : 0), 0);
export const evening = (t: { last: number[] }, pop: number[]) => pop.reduce((s, p, i) => s + (t.last[i]! >= BACK ? p : 0), 0);

export const score = (net: Net, svc: number, goal: number[]): Score => ({
  ...travel(net, svc, goal),
  hours: hoursOf(net.trips, svc) + (net.delay[svc] ?? 0),
  trips: net.trips.filter((t) => t[3] === svc).length,
  buses: busesOf(net.trips, svc),
});

/** Jedan broj za uspoređivanje: prosjek po naselju, uz težinu stanovnici^alpha (0 = sva naselja jednako, 1 = po ljudima). */
export function objective(avg: number[], pop: number[], alpha: number): number {
  let sum = 0;
  let weight = 0;
  avg.forEach((a, i) => { const w = pop[i]! > 0 ? pop[i]! ** alpha : 0; sum += w * a; weight += w; });
  return sum / weight;
}

/* ---------- traženje poboljšanja ---------- */

export interface SearchOptions {
  svc: number;
  goal: number[];
  /** Ne dirati tko stiže do BY i tko se može vratiti nakon BACK. */
  keep: boolean;
  /** 0 za naselja koja se ne broje. */
  pop: number[];
  alpha: number;
  maxHours: number;
  maxBuses: number;
  maxChanges: number;
  /** Koliko prijedloga isprobati za svaku izmjenu. */
  tries: number;
  random?: () => number;
}

/** Uzorak povratne vožnje: isti red, suprotni smjer, kreće gdje ova završava ako je moguće. */
export function backOf(trips: Trip[], t: number): number {
  const [line, dir, , svc, flat] = trips[t]!;
  const end = flat.at(-2)!;
  const other = trips.flatMap((x, i) => (x[0] === line && x[1] !== dir ? [i] : []));
  const rank = (i: number) => (trips[i]![4][0] === end ? 0 : 2) + (trips[i]![3] === svc ? 0 : 1);
  return other.sort((a, b) => rank(a) - rank(b) || trips[b]![4].length - trips[a]![4].length)[0] ?? -1;
}

/** Po jedna najbolja izmjena odjednom; svaki korak javlja dosadašnji popis. */
export function* improve(base: Base, start: Change[], o: SearchOptions): Generator<{ changes: Change[]; value: number; tried: number }> {
  const rnd = o.random ?? Math.random;
  const pick = <T>(xs: T[]): T => xs[Math.floor(rnd() * xs.length)]!;
  const value = (c: Change[]) => {
    const net = apply(base, c);
    const hours = hoursOf(net.trips, o.svc) + (net.delay[o.svc] ?? 0);
    const t = travel(net, o.svc, o.goal);
    return { v: objective(t.avg, o.pop, o.alpha), hours, buses: busesOf(net.trips, o.svc), am: morning(t, o.pop), pm: evening(t, o.pop) };
  };
  // Uzorak vožnje po liniji i smjeru: najdulja.
  const templates = new Map<string, number>();
  base.trips.forEach((t, i) => {
    const key = `${t[0]}|${t[1]}`;
    const cur = templates.get(key);
    if (cur === undefined || t[4].length > base.trips[cur]![4].length) templates.set(key, i);
  });
  let changes = [...start];
  let now = value(changes);
  const floor = now;
  const limit = start.length + o.maxChanges;
  let tried = 0;
  while (changes.length < limit) {
    const touched = new Set(changes.flatMap((c) => (c.k === 'm' || c.k === 'r' ? [c.t] : [])));
    const free = base.trips.flatMap((t, i) => (t[3] === o.svc && !touched.has(i) ? [i] : []));
    const over = now.hours > o.maxHours + 0.01;
    const add = (): Change => {
      const t = pick([...templates.values()]);
      return { k: 'a', t, at: 330 + 10 * Math.floor(rnd() * 88), svc: o.svc, b: backOf(base.trips, t) };
    };
    let best: { changes: Change[]; r: typeof now; gain: number } | null = null;
    for (let n = 0; n < o.tries; n++) {
      const roll = rnd();
      const more: Change[] = [];
      if (over) {
        if (!free.length) break;
        more.push({ k: 'r', t: pick(free) });
      } else if (roll < 0.45 && free.length) more.push({ k: 'm', t: pick(free), by: pick([-60, -45, -30, -20, -15, -10, -5, 5, 10, 15, 20, 30, 45, 60]) });
      else if (roll < 0.7 || !free.length) more.push(add());
      else if (changes.length + 2 <= limit) more.push({ k: 'r', t: pick(free) }, add());
      else continue;
      const next = [...changes, ...more];
      const bad = more.some((c) => c.k === 'm' && (startOf(base.trips[c.t]!) + c.by < 300 || endOf(base.trips[c.t]!) + c.by > 1410))
        || more.some((c) => c.k === 'a' && c.at + 2 * duration(base.trips[c.t]![4]) + TURN > 1410);
      if (bad) continue;
      const r = value(next);
      tried++;
      if (r.buses > o.maxBuses) continue;
      if (o.keep && (r.am < floor.am || r.pm < floor.pm)) continue;
      if (over) {
        // Treba skratiti: ukida se vožnja koja najmanje šteti po satu.
        const gain = -(r.v - now.v) / Math.max(0.1, now.hours - r.hours);
        if (!best || gain > best.gain) best = { changes: next, r, gain };
      } else {
        if (r.hours > o.maxHours + 0.01) continue;
        const gain = (now.v - r.v) / more.length;
        if (gain > 0.02 && (!best || gain > best.gain)) best = { changes: next, r, gain };
      }
      if (n % 8 === 7) yield { changes, value: now.v, tried };
    }
    if (!best) break;
    changes = best.changes;
    now = best.r;
    yield { changes, value: now.v, tried };
  }
  yield { changes, value: now.v, tried };
}

/* ---------- pravilo za stanice ---------- */

export interface StopRule {
  /** Razmak u metrima i ljudi po stanici: gusto (300+/km²), srednje (100–300), rijetko. */
  spacing: [number, number, number];
  people: [number, number, number];
}
export const STOP_RULE: StopRule = { spacing: [400, 600, 1000], people: [600, 400, 400] };
export const MIN_PEOPLE = 100;

export function wantedStops(s: Pick<Settlement, 'pop' | 'km2'>, roadKm: number, rule: StopRule): number {
  if (s.pop < MIN_PEOPLE) return 0;
  const d = s.pop / s.km2;
  const i = d >= 300 ? 0 : d >= 100 ? 1 : 2;
  const byRoad = (roadKm * 1000) / rule.spacing[i]!;
  const byPeople = s.pop / rule.people[i]!;
  return Math.max(1, Math.round(Math.min(byRoad, byPeople)));
}
