// Sve brojke za /analiza. Računa se pri gradnji stranice; ništa ne mijenja u podacima voznog reda.
import { clip, type Pt } from '../lib/clip.ts';
import { meters, type PlanData } from '../lib/planner.ts';
import { plural } from '../lib/text.ts';
import { hhmm } from '../lib/time.ts';
import type { Direction, Line, LineRef, Network } from '../lib/types.ts';
import { arrivalAt, createReach, MAX_ACCESS_WALK } from './reach.ts';

/** data/naselja.json */
export interface RawSettlement {
  id: string;
  name: string;
  urban: boolean;
  pop: number;
  pop91: number;
  /** 0–4, 5–9, ..., 80–84, 85+ */
  ages: number[];
  km2: number;
  center: [number, number];
  rings: [number, number][][];
}

export interface DayStats {
  /** Vožnje u koje se u naselju može ući. */
  trips: number;
  first: number | null;
  last: number | null;
  /** Najdulja pauza između dva polaska. */
  gap: number | null;
  hours: number[];
}

export interface ToPlace {
  /** Najkraće putovanje u danu, s hodom i presjedanjem. */
  best: number;
  /** Najraniji dolazak u danu. */
  first: number;
  /** Posljednji polazak kojim se još stiže kući. */
  back: number | null;
}

export interface Settlement {
  id: string;
  name: string;
  urban: boolean;
  pop: number;
  pop91: number;
  young: number;
  old: number;
  km2: number;
  path: string;
  /** Sredina u koordinatama crteža. */
  at: [number, number];
  stops: { slug: string; name: string }[];
  lines: string[];
  nearest: { slug: string; name: string; m: number };
  days: DayStats[];
  center: (ToPlace | null)[];
  hospital: (ToPlace | null)[];
  /** [stajalište, minute hoda]; stajališta su redom iz /data/planer.json. */
  access: [number, number][];
}

export interface LineStats extends LineRef {
  long: string;
  path: string;
  km: number;
  speed: number;
  trips: number[];
  vkm: number[];
  stops: number;
  people: number;
  /** Udio trase (po dionicama između stanica) kojom vozi još neka linija. */
  shared: number;
  hours: number[][];
}

export interface Analysis {
  labels: string[];
  width: number;
  height: number;
  /** Zemljopisne koordinate -> crtež. */
  geo: { pad: number; minX: number; maxY: number; k: number; ky: number };
  settlements: Settlement[];
  stops: { x: number; y: number }[];
  lines: LineStats[];
  hours: number[][];
  trips: number[];
  vkm: number[];
  /** Ginijev koeficijent ponude po stanovniku, bez grada, po vrsti dana. */
  gini: number[];
  findings: string[];
}

export const HOURS = 24;
export const CITY = 'Brčko';
const WIDTH = 900;

/** Sve što planer i doseg trebaju; isti redoslijed kao /data/planer.json. */
export function planTrips(network: Network): Pick<PlanData, 'poles' | 'trips'> {
  const poles: PlanData['poles'] = [];
  const index = new Map<string, number>();
  network.stops.forEach((s, stop) => s.poles.forEach((p, i) => {
    index.set(`${s.slug}|${i}`, poles.length);
    poles.push([stop, i, p.lat, p.lon]);
  }));
  const trips = network.lines.flatMap((line, l) => line.dirs.flatMap((dir) => dir.trips.map((t): PlanData['trips'][number] => {
    const visits = t.times
      .flatMap((m, i) => (m === null ? [] : [{ m, i, pole: index.get(`${dir.stops[i]!.slug}|${t.poles[i]}`)! }]))
      .sort((a, b) => a.m - b.m || a.i - b.i);
    return [l, dir.id, 0, t.svc, visits.flatMap((v) => [v.pole, v.m])];
  })));
  return { poles, trips };
}

export function inside(rings: [number, number][][], x: number, y: number): boolean {
  let hit = false;
  for (const r of rings) {
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const [x1, y1] = r[j]!;
      const [x2, y2] = r[i]!;
      if ((y1 > y) !== (y2 > y) && x < ((x2 - x1) * (y - y1)) / (y2 - y1) + x1) hit = !hit;
    }
  }
  return hit;
}

/** Nejednakost: 0 = svatko ima jednaku ponudu, 1 = sve ima jedan. Težine su stanovnici. */
export function gini(rows: { people: number; supply: number }[]): number {
  const sorted = rows.filter((r) => r.people > 0).sort((a, b) => a.supply - b.supply);
  const people = sorted.reduce((s, r) => s + r.people, 0);
  const total = sorted.reduce((s, r) => s + r.people * r.supply, 0);
  if (!total) return 0;
  let area = 0;
  let cum = 0;
  for (const r of sorted) {
    const next = cum + (r.people * r.supply) / total;
    area += ((r.people / people) * (cum + next)) / 2;
    cum = next;
  }
  return 1 - 2 * area;
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const length = (pts: Pt[]) => sum(pts.slice(1).map((p, i) => meters(pts[i]![1], pts[i]![0], p[1], p[0]))) / 1000;
const emptyHours = () => new Array<number>(HOURS).fill(0);
const hourOf = (m: number) => Math.floor(m / 60) % 24;

export function analyze(network: Network, labels: string[], raw: RawSettlement[]): Analysis {
  const svcs = labels.map((_, i) => i);

  /* ---------- crtež ---------- */
  const all = raw.flatMap((s) => s.rings.flat());
  const minX = Math.min(...all.map((p) => p[0]));
  const maxX = Math.max(...all.map((p) => p[0]));
  const minY = Math.min(...all.map((p) => p[1]));
  const maxY = Math.max(...all.map((p) => p[1]));
  const ky = 1 / Math.cos((((minY + maxY) / 2) * Math.PI) / 180);
  const PAD = 6;
  const k = (WIDTH - 2 * PAD) / (maxX - minX);
  const height = Math.round((maxY - minY) * ky * k) + 2 * PAD;
  const xy = ([lon, lat]: [number, number]): [number, number] => [PAD + (lon - minX) * k, PAD + (maxY - lat) * ky * k];
  /** Zaokruženo na istu mrežu za sva naselja, pa između susjeda nema rupa. */
  const toPath = (pts: [number, number][], close: boolean) => {
    let out = '';
    let last: [number, number] | null = null;
    for (const p of pts) {
      const [x, y] = xy(p).map(Math.round) as [number, number];
      if (last && x === last[0] && y === last[1]) continue;
      out += last ? `l${x - last[0]} ${y - last[1]}` : `M${x} ${y}`;
      last = [x, y];
    }
    return out.includes('l') ? out + (close ? 'z' : '') : '';
  };

  /* ---------- stanice i naselja ---------- */
  const { poles, trips } = planTrips(network);
  const reach = createReach({ poles, trips });
  const homeOf = poles.map(([, , lat, lon]) => raw.findIndex((s) => inside(s.rings, lon, lat)));
  const poleAt = new Map<string, number>();
  poles.forEach(([stop, i], p) => poleAt.set(`${network.stops[stop]!.slug}|${i}`, p));

  type Visit = { settlement: number; m: number };
  /** Za svaku vožnju: prvi mogući ulazak u svakom naselju kroz koje prolazi. */
  const boardings = (dir: Direction, t: Direction['trips'][number]): Visit[] => {
    const seen = new Map<number, number>();
    t.times.forEach((m, i) => {
      if (m === null || i === t.last) return;
      const home = homeOf[poleAt.get(`${dir.stops[i]!.slug}|${t.poles[i]}`)!]!;
      if (home >= 0 && m < (seen.get(home) ?? Infinity)) seen.set(home, m);
    });
    return [...seen].map(([settlement, m]) => ({ settlement, m }));
  };

  const times = raw.map(() => svcs.map((): number[] => []));
  const linesOf = raw.map(() => new Set<string>());
  for (const line of network.lines) {
    for (const dir of line.dirs) {
      for (const t of dir.trips) {
        for (const v of boardings(dir, t)) {
          times[v.settlement]![t.svc]!.push(v.m);
          linesOf[v.settlement]!.add(line.slug);
        }
      }
    }
  }

  const stats = (list: number[]): DayStats => {
    const s = [...list].sort((a, b) => a - b);
    const hours = emptyHours();
    for (const m of s) hours[hourOf(m)]!++;
    const gaps = s.slice(1).map((m, i) => m - s[i]!);
    return { trips: s.length, first: s[0] ?? null, last: s.at(-1) ?? null, gap: gaps.length ? Math.max(...gaps) : null, hours };
  };

  const ownPoles = raw.map((_, i) => poles.flatMap((__, p) => (homeOf[p] === i ? [p] : [])));
  const access = raw.map((s, i) => (ownPoles[i]!.length ? reach.accessFrom(ownPoles[i]!) : reach.accessFromPlace(s.center[1], s.center[0])));
  /** Dolazak u naselje s vlastitim stanicama ne uključuje hod iz susjednog. */
  const target = raw.map((_, i) => (ownPoles[i]!.length ? new Map(ownPoles[i]!.map((p) => [p, 0])) : access[i]!));

  const toStop = (slug: string): (ToPlace | null)[][] => {
    const stop = network.stops.findIndex((s) => s.slug === slug);
    const own = poles.flatMap(([s], p) => (s === stop ? [p] : []));
    const goal = new Map(own.map((p) => [p, 0]));
    const start = reach.accessFrom(own);
    const backFrom = svcs.map((svc) => reach.events(svc, start).map((t) => ({ t, arrived: reach.earliest(svc, start, t) })));
    return raw.map((_, i) => svcs.map((svc): ToPlace | null => {
      let best = Infinity;
      let first = Infinity;
      for (const t of reach.events(svc, access[i]!)) {
        const at = arrivalAt(reach.earliest(svc, access[i]!, t), goal);
        if (at === Infinity) continue;
        best = Math.min(best, at - t);
        first = Math.min(first, at);
      }
      const back = backFrom[svc]!.findLast((x) => arrivalAt(x.arrived, target[i]!) < Infinity);
      // Naselje u kojem je i samo odredište nema put do njega.
      if (best === Infinity || own.some((p) => homeOf[p] === i)) return null;
      return { best, first, back: back ? back.t : null };
    }));
  };
  const center = toStop('centar');
  const hospital = toStop('bolnica');

  const settlements = raw.map((s, i): Settlement => {
    const stopIds = [...new Set(ownPoles[i]!.map((p) => poles[p]![0]))];
    const near = poles
      .map(([stop, , lat, lon]) => ({ stop, m: meters(s.center[1], s.center[0], lat, lon) }))
      .sort((a, b) => a.m - b.m)[0]!;
    const { slug, name } = network.stops[near.stop]!;
    return {
      id: s.id, name: s.name, urban: s.urban, pop: s.pop, pop91: s.pop91,
      young: sum(s.ages.slice(0, 4)),
      old: sum(s.ages.slice(13)),
      km2: s.km2,
      path: s.rings.map((r) => toPath(r, true)).join(''),
      at: xy(s.center).map(Math.round) as [number, number],
      stops: stopIds.map((x) => ({ slug: network.stops[x]!.slug, name: network.stops[x]!.name })),
      lines: network.lines.filter((l) => linesOf[i]!.has(l.slug)).map((l) => l.slug),
      nearest: { slug, name, m: Math.round(near.m / 10) * 10 },
      days: times[i]!.map(stats),
      center: center[i]!,
      hospital: hospital[i]!,
      access: [...access[i]!],
    };
  });

  /* ---------- linije ---------- */
  const pairs = new Map<string, Set<string>>();
  const eachLeg = (line: Line, fn: (key: string, km: number) => void) => {
    const done = new Set<string>();
    for (const dir of line.dirs) {
      for (const t of dir.trips) {
        let prev = -1;
        t.times.forEach((m, i) => {
          if (m === null) return;
          if (prev >= 0) {
            const a = dir.stops[prev]!.slug;
            const b = dir.stops[i]!.slug;
            const key = [a, b].sort().join('|');
            if (a !== b && !done.has(key)) {
              done.add(key);
              const pa = poles[poleAt.get(`${a}|${t.poles[prev]}`)!]!;
              const pb = poles[poleAt.get(`${b}|${t.poles[i]}`)!]!;
              fn(key, meters(pa[2], pa[3], pb[2], pb[3]) / 1000);
            }
          }
          prev = i;
        });
      }
    }
  };
  for (const line of network.lines) eachLeg(line, (key) => pairs.set(key, (pairs.get(key) ?? new Set()).add(line.slug)));

  const lines = network.lines.map((line): LineStats => {
    const lengths = new Map<string, number>();
    const tripKm = svcs.map(() => 0);
    const tripCount = svcs.map(() => 0);
    const hours = svcs.map(emptyHours);
    let minutes = 0;
    let longest = 0;
    for (const dir of line.dirs) {
      for (const t of dir.trips) {
        const at = t.times.flatMap((m, i) => (m === null ? [] : [{ m, i }])).sort((a, b) => a.m - b.m || a.i - b.i);
        const pts = at.map(({ i }): Pt => { const p = poles[poleAt.get(`${dir.stops[i]!.slug}|${t.poles[i]}`)!]!; return [p[3], p[2]]; });
        const key = pts.join();
        let km = lengths.get(key);
        if (km === undefined) {
          km = length(clip(line.shapes as Pt[][], pts));
          lengths.set(key, km);
        }
        longest = Math.max(longest, km);
        tripKm[t.svc]! += km;
        tripCount[t.svc]!++;
        minutes += at.at(-1)!.m - at[0]!.m;
        hours[t.svc]![hourOf(at[0]!.m)]!++;
      }
    }
    let shared = 0;
    let total = 0;
    eachLeg(line, (key, km) => { total += km; if (pairs.get(key)!.size > 1) shared += km; });
    const served = settlements.filter((s) => s.lines.includes(line.slug) && s.name !== CITY);
    return {
      slug: line.slug, short: line.short, color: line.color, text: line.text, long: line.long,
      path: line.shapes.map((s) => toPath(s, false)).join(''),
      km: longest,
      speed: minutes ? (sum(tripKm) / minutes) * 60 : 0,
      trips: tripCount,
      vkm: tripKm,
      stops: new Set(line.dirs.flatMap((d) => d.stops.map((s) => s.slug))).size,
      people: sum(served.map((s) => s.pop)),
      shared: total ? shared / total : 0,
      hours,
    };
  });

  const base = {
    labels,
    width: WIDTH,
    height,
    geo: { pad: PAD, minX, maxY, k, ky },
    settlements,
    stops: poles.map(([, , lat, lon]) => { const [x, y] = xy([lon, lat]); return { x: Math.round(x), y: Math.round(y) }; }),
    lines,
    hours: svcs.map((s) => emptyHours().map((_, h) => sum(lines.map((l) => l.hours[s]![h]!)))),
    trips: svcs.map((s) => sum(lines.map((l) => l.trips[s]!))),
    vkm: svcs.map((s) => sum(lines.map((l) => l.vkm[s]!))),
    gini: svcs.map((d) => gini(settlements.filter((s) => s.name !== CITY).map((s) => ({ people: s.pop, supply: s.days[d]!.trips })))),
  };
  return { ...base, findings: findings(base) };
}

const fmt = (n: number) => String(Math.round(n)).replace(/\B(?=(\d{3})+$)/g, '.');
const names = (list: Settlement[], max = 4) => {
  const n = list.slice(0, max).map((s) => s.name);
  const rest = list.length - n.length;
  return rest > 0 ? `${n.join(', ')} i još ${rest}` : n.length > 1 ? `${n.slice(0, -1).join(', ')} i ${n.at(-1)}` : (n[0] ?? '');
};
const people = (n: number) => `${fmt(n)} ${plural(n, 'stanovnik', 'stanovnika', 'stanovnika').split(' ')[1]}`;
const settlementsWord = (n: number) => plural(n, 'naselje', 'naselja', 'naselja');
const fromSettlements = (n: number) => `${n} naselja`;

/** Rečenice se slažu iz podataka, pa vrijede i za sljedeći red vožnje. Radni dan je prva vrsta dana, vikend druga. */
function findings(a: Omit<Analysis, 'findings'>): string[] {
  const out: string[] = [];
  const byPop = [...a.settlements].sort((x, y) => y.pop - x.pop);
  const villages = byPop.filter((s) => s.name !== CITY);
  const total = sum(byPop.map((s) => s.pop));

  const none = byPop.filter((s) => !s.stops.length);
  const far = none.filter((s) => s.nearest.m > 1000);
  out.push(`U naselju sa stanicom živi ${Math.round((100 * (total - sum(none.map((s) => s.pop)))) / total)} % stanovnika. Bez stanice: ${settlementsWord(none.length)} (${people(sum(none.map((s) => s.pop)))}), a od toga je u ${far.length} od sredine naselja do najbliže stanice više od kilometra: ${names(far)}.`);

  if (a.labels.length > 1) {
    const few = villages.filter((s) => s.stops.length && s.days[1]!.trips <= 2);
    out.push(`Vikendom vozi ${fmt(a.trips[1]!)} umjesto ${fmt(a.trips[0]!)} vožnji, dakle ${Math.round((100 * a.trips[1]!) / a.trips[0]!)} %. Najviše dvije vožnje tada ima ${settlementsWord(few.length)} (${people(sum(few.map((s) => s.pop)))}).`);
  }

  const late = villages.filter((s) => s.center[0] && s.center[0]!.first > 8 * 60);
  const never = villages.filter((s) => !s.center[0]);
  out.push(late.length
    ? `Radnim danom do 8:00 u Centar se ne stiže iz ${fromSettlements(late.length)}: ${names(late)}.`
    : `Radnim danom do 8:00 u Centar se stiže iz svih naselja iz kojih se uopće stiže autobusom.`);
  if (never.length) out.push(`Autobusom se radnim danom u Centar ne može iz ${fromSettlements(never.length)} ni uz ${MAX_ACCESS_WALK} min hoda: ${names(never)}.`);

  const early = villages.filter((s) => s.center[0]?.back != null && s.center[0]!.back! < 18 * 60).sort((x, y) => x.center[0]!.back! - y.center[0]!.back!);
  if (early.length) out.push(`Nakon 18:00 iz Centra se više ne može vratiti u ${settlementsWord(early.length)} (${people(sum(early.map((s) => s.pop)))}). Najranije se zatvara ${early[0]!.name}: posljednji polazak je u ${hhmm(early[0]!.center[0]!.back!)}.`);

  const big = villages.filter((s) => s.pop >= 1000 && s.stops.length).sort((x, y) => x.days[0]!.trips / x.pop - y.days[0]!.trips / y.pop);
  if (big.length > 1) {
    const lo = big[0]!;
    const hi = big.at(-1)!;
    const per = (s: Settlement) => ((1000 * s.days[0]!.trips) / s.pop).toFixed(1).replace('.', ',');
    out.push(`Među većim naseljima najmanje vožnji na 1000 stanovnika ima ${lo.name} (${per(lo)}), a najviše ${hi.name} (${per(hi)}).`);
  }

  const oldest = villages.filter((s) => s.pop >= 200).sort((x, y) => y.old / y.pop - x.old / x.pop)[0];
  if (oldest) {
    const h = oldest.hospital[0];
    out.push(`Najstarije naselje je ${oldest.name}: ${Math.round((100 * oldest.old) / oldest.pop)} % ima 65 ili više godina. Radnim danom ima ${plural(oldest.days[0]!.trips, 'vožnju', 'vožnje', 'vožnji')}${h ? `, do Bolnice treba najmanje ${h.best} min, a posljednji povratak je u ${h.back === null ? '–' : hhmm(h.back)}` : ', a do Bolnice se autobusom ne stiže'}.`);
  }
  return out;
}
