// Planer putovanja. Čiste funkcije bez DOM-a; sve se računa u pregledniku.
//
// Za svaki mogući polazak s ishodišta u traženom razdoblju računa se najraniji dolazak po broju vožnji
// (kao RAPTOR, s popisom veza poredanim po vremenu), a zatim ostaju samo prijedlozi koji nisu u svemu
// lošiji od nekog drugog: kasniji polazak, raniji dolazak, manje vožnji, manje hodanja.
import { activeServices, addDays } from './time.ts';
import type { Calendar } from './types.ts';

/** Sadržaj /data/planer.json. Indeksi stanica i linija odgovaraju /data/index.json. */
export interface PlanData {
  /** [stanica, stajalište unutar stanice, lat, lon] */
  poles: [number, number, number, number][];
  headsigns: string[];
  /** [linija, id smjera, odredište, vrsta dana, [stajalište, minuta, stajalište, minuta, ...]] */
  trips: [number, string, number, number, number[]][];
}

/** Stajalište -> minute hoda od ishodišta. */
export type Access = Map<number, number>;

export interface Query {
  access: Access;
  /** Indeks odredišne stanice. */
  to: number;
  date: string;
  minutes: number;
  mode: 'depart' | 'arrive';
  /** Najraniji dopušteni polazak (minute od ponoći `date`), da se za danas ne nudi prošlost. */
  notBefore?: number;
}

export interface WalkLeg {
  kind: 'walk';
  /** null = korisnikova lokacija */
  from: number | null;
  to: number;
  dep: number;
  arr: number;
}

export interface RideLeg {
  kind: 'ride';
  line: number;
  dir: string;
  headsign: string;
  from: number;
  to: number;
  dep: number;
  arr: number;
  /** Stajališta od ulaska do izlaska, uključivo. */
  stops: { pole: number; at: number }[];
}

export type Leg = WalkLeg | RideLeg;

/** Vremena su minute od ponoći dana iz upita (mogu biti preko 1440). */
export interface Journey {
  dep: number;
  arr: number;
  rides: number;
  walk: number;
  legs: Leg[];
}

export const RULES = {
  /** Rezerva za presjedanje na istom stajalištu. */
  change: 3,
  /** Rezerva povrh hoda do drugog stajališta. */
  changeOnFoot: 2,
  /** Najdulji hod između različitih stanica, u metrima (s dodatkom za zaobilaženje). */
  maxWalk: 400,
  detour: 1.3,
  metersPerMinute: 75,
  maxRides: 4,
  /** Najdulje putovanje; sprječava presjedanja preko noći. */
  maxTotal: 8 * 60,
  window: 16 * 60,
  /** Prijedlog koji je ovoliko dulji od drugog koji ga pokriva ne vrijedi nuditi radi manje hoda ili vožnji. */
  tooMuchLonger: 45,
  results: 5,
};

const DAY = 1440;

export function meters(aLat: number, aLon: number, bLat: number, bLon: number) {
  const k = Math.PI / 180;
  return 6_371_000 * Math.hypot((bLat - aLat) * k, (bLon - aLon) * k * Math.cos(aLat * k));
}

export const walkMinutes = (m: number) => Math.ceil((m * RULES.detour) / RULES.metersPerMinute);

interface Conn { dep: number; arr: number; from: number; to: number; trip: number; day: number; i: number; key: number }

type Node =
  | { kind: 'start'; pole: number; walk: number }
  | { kind: 'walk'; pole: number; minutes: number; prev: Node }
  | { kind: 'ride'; pole: number; trip: number; day: number; board: number; alight: number; prev: Node };

interface Label { t: number; node: Node }

export function createPlanner(data: PlanData, calendar: Calendar) {
  const { poles, trips, headsigns } = data;
  const polesOfStop = new Map<number, number[]>();
  poles.forEach(([stop], i) => polesOfStop.set(stop, [...(polesOfStop.get(stop) ?? []), i]));

  /** Pješačke veze: unutar iste stanice uvijek, između različitih do RULES.maxWalk. */
  const foot = poles.map(([stopA, , latA, lonA], a) =>
    poles.flatMap(([stopB, , latB, lonB], b) => {
      if (a === b) return [];
      const m = meters(latA, lonA, latB, lonB);
      const same = stopA === stopB;
      return same || m * RULES.detour <= RULES.maxWalk ? [{ to: b, minutes: walkMinutes(m), same }] : [];
    }),
  );

  const byDate = new Map<string, Conn[]>();
  function connectionsOn(date: string): Conn[] {
    let list = byDate.get(date);
    if (!list) {
      const active = new Set(activeServices(calendar, date));
      list = [];
      for (const [trip, [, , , svc, flat]] of trips.entries()) {
        if (!active.has(svc)) continue;
        for (let i = 0; i + 3 < flat.length; i += 2) {
          list.push({ dep: flat[i + 1]!, arr: flat[i + 3]!, from: flat[i]!, to: flat[i + 2]!, trip, day: 0, i: i / 2, key: 0 });
        }
      }
      byDate.set(date, list);
    }
    return list;
  }

  function connections(date: string, dayFrom: number, dayTo: number): Conn[] {
    const out: Conn[] = [];
    for (let day = dayFrom; day <= dayTo; day++) {
      const shift = day * DAY;
      for (const c of connectionsOn(addDays(date, day))) {
        out.push({ ...c, dep: c.dep + shift, arr: c.arr + shift, day, key: (day - dayFrom) * trips.length + c.trip });
      }
    }
    return out.sort((a, b) => a.dep - b.dep || a.key - b.key || a.i - b.i);
  }

  function lowerBound(list: Conn[], dep: number) {
    let lo = 0;
    let hi = list.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (list[mid]!.dep < dep) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  function build(end: Node): Journey {
    const chain: Node[] = [];
    for (let n: Node | undefined = end; n; n = n.kind === 'start' ? undefined : n.prev) chain.unshift(n);
    const legs: Leg[] = [];
    let walk = 0;
    for (const n of chain) {
      if (n.kind === 'ride') {
        const [line, dir, headsign, , flat] = trips[n.trip]!;
        const stops = [];
        for (let i = n.board; i <= n.alight; i++) stops.push({ pole: flat[2 * i]!, at: flat[2 * i + 1]! + n.day * DAY });
        const first = stops[0]!;
        const last = stops.at(-1)!;
        legs.push({ kind: 'ride', line, dir, headsign: headsigns[headsign]!, from: first.pole, to: last.pole, dep: first.at, arr: last.at, stops });
      } else if (n.kind === 'walk') {
        walk += n.minutes;
        const dep = legs.at(-1)!.arr;
        legs.push({ kind: 'walk', from: n.prev.pole, to: n.pole, dep, arr: dep + n.minutes });
      }
    }
    const start = chain[0]!;
    const first = legs[0]!;
    if (start.kind === 'start' && start.walk > 0) {
      walk += start.walk;
      legs.unshift({ kind: 'walk', from: null, to: start.pole, dep: first.dep - start.walk, arr: first.dep });
    }
    return { dep: legs[0]!.dep, arr: legs.at(-1)!.arr, rides: legs.filter((l) => l.kind === 'ride').length, walk, legs };
  }

  /** Najraniji dolasci za polazak u `dep`, po jedan za svaki broj vožnji koji ga poboljšava. */
  function earliest(conns: Conn[], access: Access, to: number, dep: number, onFoot: boolean): Journey[] {
    const out: Journey[] = [];
    const from = lowerBound(conns, dep);
    let bestAtTarget = Infinity;
    // ready[p]: kad se na stajalištu p može ući u vozilo; arrived[p]: najraniji dolazak vozilom.
    let ready: (Label | undefined)[] = new Array(poles.length);
    const arrived = new Float64Array(poles.length).fill(Infinity);
    for (const [pole, walk] of access) ready[pole] = { t: dep + walk, node: { kind: 'start', pole, walk } };

    for (let round = 1; round <= RULES.maxRides; round++) {
      const boarded = new Map<number, { i: number; prev: Node }>();
      const reached = new Map<number, Label>();
      for (let k = from; k < conns.length; k++) {
        const c = conns[k]!;
        if (c.dep > dep + RULES.maxTotal || c.dep >= bestAtTarget) break;
        let on = boarded.get(c.key);
        if (!on) {
          const r = ready[c.from];
          if (!r || r.t > c.dep) continue;
          on = { i: c.i, prev: r.node };
          boarded.set(c.key, on);
        }
        if (c.arr < arrived[c.to]! && c.arr < bestAtTarget) {
          arrived[c.to] = c.arr;
          reached.set(c.to, { t: c.arr, node: { kind: 'ride', pole: c.to, trip: c.trip, day: c.day, board: on.i, alight: c.i + 1, prev: on.prev } });
          if (poles[c.to]![0] === to) bestAtTarget = c.arr;
        }
      }
      if (!reached.size) break;

      const nextReady = ready.slice();
      const offer = (pole: number, t: number, node: Node) => {
        const cur = nextReady[pole];
        if (!cur || t < cur.t) nextReady[pole] = { t, node };
      };
      let goal: Label | undefined;
      const atGoal = (l: Label) => { if (!goal || l.t < goal.t) goal = l; };
      for (const [pole, l] of reached) {
        if (poles[pole]![0] === to) atGoal(l);
        offer(pole, l.t + RULES.change, l.node);
      }
      for (const [pole, l] of reached) {
        for (const f of foot[pole]!) {
          if (!f.same && !onFoot) continue;
          const node: Node = { kind: 'walk', pole: f.to, minutes: f.minutes, prev: l.node };
          offer(f.to, l.t + f.minutes + RULES.changeOnFoot, node);
          if (!f.same && poles[f.to]![0] === to && l.t + f.minutes < bestAtTarget) {
            bestAtTarget = l.t + f.minutes;
            atGoal({ t: bestAtTarget, node });
          }
        }
      }
      if (goal && goal.t <= dep + RULES.maxTotal) out.push(build(goal.node));
      ready = nextReady;
    }
    return out;
  }

  /** Svi dobri prijedlozi s polaskom između `from` i `to`. */
  function search(q: Query, from: number, to: number): Journey[] {
    // Polasci iza ruba također se računaju: mogu biti bolji od onih prije njega (kasnije krenu, jednako stignu).
    const last = to + RULES.maxTotal;
    const conns = connections(q.date, Math.floor(from / DAY) - 1, Math.floor((last + RULES.maxTotal) / DAY));
    const onlySameStop: Access = new Map([...q.access].filter(([, w]) => w === 0));
    const found: Journey[] = [];
    for (const onFoot of onlySameStop.size ? [true, false] : [true]) {
      const access = onFoot ? q.access : onlySameStop;
      const events = new Set<number>();
      for (const c of conns) {
        const w = access.get(c.from);
        if (w !== undefined && c.dep - w >= from && c.dep - w <= last) events.add(c.dep - w);
      }
      for (const dep of events) found.push(...earliest(conns, access, q.to, dep, onFoot));
    }
    return pareto(found).filter((j) => j.dep <= to);
  }

  function plan(q: Query): Journey[] {
    if (q.mode === 'arrive') {
      const from = Math.max(q.minutes - RULES.window, q.notBefore ?? -Infinity);
      return search(q, from, q.minutes).filter((j) => j.arr <= q.minutes).slice(-RULES.results);
    }
    // Ako u prvom razdoblju nema ničega (npr. petak navečer, a linija vozi samo radnim danom), gleda se dalje.
    for (let from = q.minutes, n = 0; n < 6; n++, from += RULES.window) {
      const found = search(q, from, from + RULES.window);
      if (found.length) return found.slice(0, RULES.results);
    }
    return [];
  }

  /** Sa stanice: sva njezina stajališta, i susjedna do kojih se može prošetati. */
  function accessFromStop(stop: number): Access {
    const access: Access = new Map();
    for (const p of polesOfStop.get(stop) ?? []) access.set(p, 0);
    for (const p of polesOfStop.get(stop) ?? []) {
      for (const f of foot[p]!) if (f.minutes < (access.get(f.to) ?? Infinity)) access.set(f.to, f.minutes);
    }
    return access;
  }

  /** S lokacije: do 12 stajališta unutar kilometra, ili barem najbliže. */
  function accessFromPlace(lat: number, lon: number): Access {
    const near = poles.map(([, , la, lo], i) => ({ i, m: meters(lat, lon, la, lo) })).sort((a, b) => a.m - b.m);
    const within = near.filter((x) => x.m <= 1000).slice(0, 12);
    return new Map((within.length ? within : near.slice(0, 1)).map((x) => [x.i, Math.max(1, walkMinutes(x.m))]));
  }

  /** Koliko bi trajao izravan hod do odredišta. */
  function directWalk(lat: number, lon: number, to: number): number {
    return Math.min(...(polesOfStop.get(to) ?? []).map((p) => walkMinutes(meters(lat, lon, poles[p]![2], poles[p]![3]))));
  }

  return { plan, accessFromStop, accessFromPlace, directWalk };
}

export type Planner = ReturnType<typeof createPlanner>;

/** Najkraće čekanje pri presjedanju, bez hoda. Bez presjedanja: Infinity. */
export function tightest(j: Journey): number {
  let min = Infinity;
  let ready = -Infinity;
  for (const l of j.legs) {
    if (l.kind === 'ride') {
      if (ready > -Infinity) min = Math.min(min, l.dep - ready);
      ready = l.arr;
    } else if (ready > -Infinity) {
      ready = l.arr;
    }
  }
  return min;
}

/** Hod se uspoređuje na 5 minuta, da minuta razlike ne stvara novi prijedlog. */
const walkBucket = (j: Journey) => Math.floor(j.walk / 5);

function dominates(a: Journey, b: Journey): boolean {
  if (a.dep < b.dep || a.arr > b.arr) return false;
  if (b.arr - b.dep - (a.arr - a.dep) > RULES.tooMuchLonger) return true;
  return a.rides <= b.rides && walkBucket(a) <= walkBucket(b);
}

export function pareto(list: Journey[]): Journey[] {
  const sorted = [...list].sort((a, b) =>
    b.dep - a.dep || a.arr - b.arr || a.rides - b.rides || a.walk - b.walk || tightest(b) - tightest(a));
  const kept: Journey[] = [];
  for (const j of sorted) if (!kept.some((k) => dominates(k, j))) kept.push(j);
  return kept.sort((a, b) => a.dep - b.dep || a.arr - b.arr);
}
