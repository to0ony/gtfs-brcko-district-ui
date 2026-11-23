// Moguće nove stanice i skretanja, za „Što ako”. Računa se pri gradnji stranice.
import { clip, type Pt } from '../lib/clip.ts';
import { meters } from '../lib/planner.ts';
import type { Network } from '../lib/types.ts';
import { inside, planTrips, type RawSettlement } from './compute.ts';

/** Gdje u vožnji dolazi nova stanica: [vožnja, iza kojeg zaustavljanja, udio vremena do sljedećeg]. */
export type Insert = [trip: number, after: number, share: number];

export interface Proposal {
  id: number;
  kind: 'stop' | 'detour';
  settlement: string;
  lat: number;
  lon: number;
  /** Indeksi linija koje bi ovdje stajale. */
  lines: number[];
  inserts: Insert[];
  /** Dodatne minute po vožnji; samo skretanje. */
  extra: number;
  /** Do najbliže postojeće stanice, u metrima. */
  from: number;
}

export interface WhatIf {
  proposals: Proposal[];
  /** Duljina trase kroz naselje, km. */
  roadKm: Record<string, number>;
}

/** Skretanje: ceste su duže od ravne crte, a autobus na njima vozi oko 30 km/h. */
export const DETOUR = { road: 1.4, kmPerMinute: 0.5, maxKm: 4, stopMinutes: 1 };
/** Bliže od ovoga postojećoj stanici nova se ne predlaže. */
const MIN_GAP = 350;
const PER_SETTLEMENT = 6;
const STEP = 50;

const dist = (a: Pt, b: Pt) => meters(a[1], a[0], b[1], b[0]);

interface Pattern { line: number; stops: Pt[]; trips: number[]; path: Pt[]; cum: number[]; at: number[] }

/** Najbliža točka na trasi: [udaljenost, put od početka trase]. */
function project(path: Pt[], cum: number[], p: Pt, from = 0): [number, number] {
  let best: [number, number] = [Infinity, 0];
  const kx = Math.cos((p[1] * Math.PI) / 180);
  for (let i = 0; i + 1 < path.length; i++) {
    if (cum[i + 1]! < from) continue;
    const [ax, ay] = path[i]!;
    const [bx, by] = path[i + 1]!;
    const dx = (bx - ax) * kx;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let u = len2 ? Math.max(0, Math.min(1, ((p[0] - ax) * kx * dx + (p[1] - ay) * dy) / len2)) : 0;
    const len = cum[i + 1]! - cum[i]!;
    if (cum[i]! + u * len < from) u = len ? (from - cum[i]!) / len : 0;
    const d = dist([ax + (bx - ax) * u, ay + (by - ay) * u], p);
    if (d < best[0]) best = [d, cum[i]! + u * len];
  }
  return best;
}

export function whatIf(network: Network, raw: RawSettlement[]): WhatIf {
  const { poles, trips } = planTrips(network);
  const at = (p: number): Pt => [poles[p]![3], poles[p]![2]];

  const patterns = new Map<string, Pattern>();
  trips.forEach(([line, , , , flat], t) => {
    const ids = flat.filter((_, i) => i % 2 === 0);
    const key = `${line}|${ids.join()}`;
    let p = patterns.get(key);
    if (!p) {
      const stops = ids.map(at);
      const path = clip(network.lines[line]!.shapes as Pt[][], stops);
      const cum = [0];
      for (let i = 1; i < path.length; i++) cum.push(cum[i - 1]! + dist(path[i - 1]!, path[i]!));
      let from = 0;
      const along = stops.map((s) => { from = project(path, cum, s, from)[1]; return from; });
      p = { line, stops, trips: [], path, cum, at: along };
      patterns.set(key, p);
    }
    p.trips.push(t);
  });
  const all = [...patterns.values()];

  /** Sve vožnje koje prolaze pokraj točke, i gdje bi u njima bila nova stanica. */
  const passing = (p: Pt, within: number, only?: number): { inserts: Insert[]; lines: number[] } => {
    const inserts: Insert[] = [];
    const lines = new Set<number>();
    for (const pat of all) {
      if (only !== undefined && pat.line !== only) continue;
      const [d, pos] = project(pat.path, pat.cum, p);
      if (d > within) continue;
      const k = pat.at.findLastIndex((x) => x <= pos);
      if (k < 0 || k + 1 >= pat.at.length) continue;
      const span = pat.at[k + 1]! - pat.at[k]!;
      const share = span > 0 ? Math.round((100 * (pos - pat.at[k]!)) / span) / 100 : 0.5;
      lines.add(pat.line);
      for (const t of pat.trips) inserts.push([t, k, share]);
    }
    return { inserts, lines: [...lines].sort((a, b) => a - b) };
  };

  // Točke trase svakih 50 m; isti komad ceste kojim vozi više linija broji se jednom.
  const cells = new Map<string, Pt[]>();
  const cell = (p: Pt, dx = 0, dy = 0) => `${Math.floor(p[0] / 0.0006) + dx}|${Math.floor(p[1] / 0.0005) + dy}`;
  const road: Pt[] = [];
  for (const pat of all) {
    const fresh: Pt[] = [];
    for (let i = 1; i < pat.path.length; i++) {
      const [x1, y1] = pat.path[i - 1]!;
      const [x2, y2] = pat.path[i]!;
      const n = Math.max(1, Math.round(dist([x1, y1], [x2, y2]) / STEP));
      for (let s = 0; s < n; s++) {
        const p: Pt = [x1 + ((x2 - x1) * (s + 0.5)) / n, y1 + ((y2 - y1) * (s + 0.5)) / n];
        let taken = false;
        for (let dx = -1; dx <= 1 && !taken; dx++) for (let dy = -1; dy <= 1 && !taken; dy++) taken = !!cells.get(cell(p, dx, dy))?.some((q) => dist(p, q) < 0.9 * STEP);
        if (!taken) fresh.push(p);
      }
    }
    for (const p of fresh) {
      road.push(p);
      const key = cell(p);
      cells.set(key, [...(cells.get(key) ?? []), p]);
    }
  }
  const homes = road.map((p) => raw.findIndex((s) => inside(s.rings, p[0], p[1])));
  const roadKm = Object.fromEntries(raw.map((s, i) => [s.id, (homes.filter((h) => h === i).length * STEP) / 1000]));

  const proposals: Proposal[] = [];
  const nearestStop = (p: Pt, more: Pt[]) => Math.min(...poles.map((_, i) => dist(at(i), p)), ...more.map((q) => dist(q, p)));
  raw.forEach((s, i) => {
    const points = road.filter((_, k) => homes[k] === i);
    const picked: Pt[] = [];
    while (picked.length < PER_SETTLEMENT && points.length) {
      const best = points.map((p) => ({ p, d: nearestStop(p, picked) })).reduce((a, b) => (b.d > a.d ? b : a));
      if (best.d < MIN_GAP) break;
      picked.push(best.p);
      const { inserts, lines } = passing(best.p, 60);
      if (!inserts.length) continue;
      proposals.push({ id: proposals.length, kind: 'stop', settlement: s.id, lat: best.p[1], lon: best.p[0], lines, inserts, extra: 0, from: Math.round(best.d / 10) * 10 });
    }
  });

  // Naselje bez stanice i bez trase: skretanje linije koja prolazi najbliže.
  raw.forEach((s) => {
    const own = poles.some((_, p) => inside(s.rings, at(p)[0], at(p)[1]));
    if (own || s.pop < 100 || proposals.some((p) => p.settlement === s.id)) return;
    const near = network.lines.map((_, line) => ({
      line,
      d: Math.min(...all.filter((p) => p.line === line).map((p) => project(p.path, p.cum, s.center)[0])),
      n: all.filter((p) => p.line === line).reduce((x, p) => x + p.trips.length, 0),
    })).sort((a, b) => a.d - b.d);
    const limit = near[0]!.d * 1.15 + 100;
    // Od podjednako blizu linija, ona s najviše vožnji.
    const { line, d } = near.filter((x) => x.d <= limit).sort((a, b) => b.n - a.n)[0]!;
    if (d > DETOUR.maxKm * 1000) return;
    const { inserts } = passing(s.center, d * 1.3 + 100, line);
    const extra = Math.ceil((2 * (d / 1000) * DETOUR.road) / DETOUR.kmPerMinute) + DETOUR.stopMinutes;
    proposals.push({ id: proposals.length, kind: 'detour', settlement: s.id, lat: s.center[1], lon: s.center[0], lines: [line], inserts, extra, from: Math.round(d / 10) * 10 });
  });
  return { proposals, roadKm };
}
