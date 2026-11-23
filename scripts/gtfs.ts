// data/gtfs.zip -> src/generated/{network,calendar}.json
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { strFromU8, unzipSync } from 'fflate';
import Papa from 'papaparse';
import { city } from '../city.config.ts';
import { slugify } from '../src/lib/text.ts';
import type { Calendar, Direction, Line, Network, StopGroup, Trip } from '../src/lib/types.ts';

type Row = Record<string, string>;
type Point = [number, number];

const zip = unzipSync(new Uint8Array(await readFile('data/gtfs.zip')));

function table(name: string): Row[] {
  const file = zip[`${name}.txt`];
  if (!file) return [];
  return Papa.parse<Row>(strFromU8(file).replace(/^﻿/, ''), { header: true, skipEmptyLines: true }).data;
}

function groupBy<T>(rows: T[], key: (r: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const r of rows) {
    const k = key(r);
    const list = m.get(k);
    if (list) list.push(r);
    else m.set(k, [r]);
  }
  return m;
}

const routes = table('routes');
const trips = table('trips');
const calendar = table('calendar');
const calendarDates = table('calendar_dates');
const agency = table('agency')[0] ?? {};

/* ---------- kalendar ---------- */

const WEEK = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const SHORT = ['ned', 'pon', 'uto', 'sri', 'čet', 'pet', 'sub'];
const iso = (d: string) => `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;

function describe(id: string): { label: string; order: number } {
  const c = calendar.find((x) => x.service_id === id);
  const on = WEEK.map((d) => c?.[d] === '1');
  const key = on.map(Number).join('');
  if (key === '0111110') return { label: 'Radni dan', order: 0 };
  if (key === '1000001') return { label: 'Vikend', order: 1 };
  if (key === '0000001') return { label: 'Subota', order: 1 };
  if (key === '1000000') return { label: 'Nedjelja', order: 2 };
  if (key === '1111111') return { label: 'Svaki dan', order: 0 };
  if (key === '0000000') return { label: 'Praznici i školski praznici', order: 3 };
  return { label: [1, 2, 3, 4, 5, 6, 0].filter((i) => on[i]).map((i) => SHORT[i]).join(', '), order: 2 };
}

const services = [...new Set(trips.map((t) => t.service_id!))]
  .map((id) => ({ id, ...describe(id) }))
  .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
const svcIndex = new Map(services.map((s, i) => [s.id, i]));
const exceptions = new Map(calendarDates.map((c) => [`${c.service_id}|${iso(c.date!)}`, c.exception_type]));

const allDates = [
  ...calendar.flatMap((c) => [iso(c.start_date!), iso(c.end_date!)]),
  ...calendarDates.map((c) => iso(c.date!)),
].sort();
const start = allDates[0]!;
const end = allDates.at(-1)!;
const days: number[] = [];
const seen = WEEK.map(() => new Map<number, number>());
for (let t = Date.parse(`${start}T00:00:00Z`); t <= Date.parse(`${end}T00:00:00Z`); t += 86_400_000) {
  const date = new Date(t).toISOString().slice(0, 10);
  const wd = new Date(t).getUTCDay();
  let mask = 0;
  services.forEach((s, i) => {
    const c = calendar.find((x) => x.service_id === s.id);
    let on = !!c && c[WEEK[wd]!] === '1' && iso(c.start_date!) <= date && date <= iso(c.end_date!);
    const ex = exceptions.get(`${s.id}|${date}`);
    if (ex === '1') on = true;
    if (ex === '2') on = false;
    if (on) mask |= 1 << i;
  });
  days.push(mask);
  seen[wd]!.set(mask, (seen[wd]!.get(mask) ?? 0) + 1);
}
const weekday = seen.map((m) => [...m].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0);
const cal: Calendar = { start, end, days, weekday, labels: services.map((s) => s.label) };

/* ---------- stanice ---------- */

const stopTimes = groupBy(table('stop_times'), (r) => r.trip_id!);
for (const v of stopTimes.values()) v.sort((a, b) => +a.stop_sequence! - +b.stop_sequence!);

const stops = new Map(
  table('stops')
    .filter((s) => !s.location_type || s.location_type === '0')
    .map((s) => [s.stop_id!, { id: s.stop_id!, name: s.stop_name!.trim(), lat: +(+s.stop_lat!).toFixed(5), lon: +(+s.stop_lon!).toFixed(5) }]),
);
type RawStop = typeof stops extends Map<string, infer V> ? V : never;

type Counts = Map<string, number>;
const add = (m: Map<string, Counts>, key: string, value: string) => {
  const c = m.get(key) ?? new Map<string, number>();
  c.set(value, (c.get(value) ?? 0) + 1);
  m.set(key, c);
};
/** Za svako stajalište: koliko vožnji ide na koje susjedno stajalište drugog naziva ili dolazi s njega. */
const neighboursOf = new Map<string, Counts>();
for (const st of stopTimes.values()) {
  const seq = st.map((r) => stops.get(r.stop_id!)!);
  seq.forEach((s, i) => {
    const next = seq.slice(i + 1).find((x) => x.name !== s.name);
    const prev = seq.slice(0, i).findLast((x) => x.name !== s.name);
    if (next) add(neighboursOf, s.id, next.id);
    if (prev) add(neighboursOf, s.id, prev.id);
  });
}

function meters(a: RawStop, b: RawStop) {
  const k = Math.PI / 180;
  return 6_371_000 * Math.hypot((b.lat - a.lat) * k, (b.lon - a.lon) * k * Math.cos(a.lat * k));
}

/** Istoimena stajališta dalje od ovoga nisu ista stanica. */
const SAME_STOP_METERS = 400;

function clusters(list: RawStop[]): RawStop[][] {
  const out: RawStop[][] = [];
  for (const s of list) {
    const near = out.filter((c) => c.some((x) => meters(x, s) <= SAME_STOP_METERS));
    const rest = out.filter((c) => !near.includes(c));
    out.splice(0, out.length, ...rest, [...near.flat(), s]);
  }
  return out;
}

/** Zbroj po nazivu, od najčešćeg. */
function byName(ids: string[], source: Map<string, Counts>, nameOf: (id: string) => string): [string, number][] {
  const total: Counts = new Map();
  for (const id of ids) for (const [k, n] of source.get(id) ?? []) total.set(nameOf(k), (total.get(nameOf(k)) ?? 0) + n);
  return [...total].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0], 'hr'));
}

const groups = new Map<string, StopGroup>();
const placeOf = new Map<string, { slug: string; pole: number }>();
for (const list of groupBy([...stops.values()], (s) => slugify(s.name)).values()) {
  const parts = clusters(list);
  for (const part of parts) {
    let name = part[0]!.name;
    if (parts.length > 1) {
      const others = new Set(parts.filter((x) => x !== part).flatMap((x) => byName(x.map((s) => s.id), neighboursOf, (id) => stops.get(id)!.name).map(([n]) => n)));
      const own = byName(part.map((s) => s.id), neighboursOf, (id) => stops.get(id)!.name);
      const hint = own.find(([n]) => !others.has(n)) ?? own[0];
      if (hint) name += ` (${hint[0]})`;
    }
    const slug = slugify(name);
    if (groups.has(slug)) throw new Error(`Dvije stanice imaju isti slug: ${slug}`);
    groups.set(slug, { slug, name, poles: part.map(({ id, lat, lon }) => ({ id: slugify(id), lat, lon })), lines: [] });
    part.forEach((s, pole) => placeOf.set(s.id, { slug, pole }));
  }
}

/* ---------- trase ---------- */

/** Douglas–Peucker, tolerancija u metrima. */
function simplify(pts: Point[], tol = 4): Point[] {
  if (pts.length < 3) return pts;
  const kx = 111_320 * Math.cos((pts[0]![1] * Math.PI) / 180);
  const ky = 110_540;
  const keep = new Set([0, pts.length - 1]);
  const stack: Point[] = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const ax = pts[a]![0] * kx;
    const ay = pts[a]![1] * ky;
    const dx = pts[b]![0] * kx - ax;
    const dy = pts[b]![1] * ky - ay;
    const len2 = dx * dx + dy * dy;
    let best = 0;
    let at = -1;
    for (let i = a + 1; i < b; i++) {
      const px = pts[i]![0] * kx - ax;
      const py = pts[i]![1] * ky - ay;
      const u = len2 ? Math.max(0, Math.min(1, (px * dx + py * dy) / len2)) : 0;
      const dist = Math.hypot(px - u * dx, py - u * dy);
      if (dist > best) { best = dist; at = i; }
    }
    if (best > tol) { keep.add(at); stack.push([a, at], [at, b]); }
  }
  return pts.filter((_, i) => keep.has(i)).map(([x, y]) => [+x.toFixed(5), +y.toFixed(5)]);
}

const shapes = new Map<string, Point[]>();
for (const [id, rows] of groupBy(table('shapes'), (r) => r.shape_id!)) {
  rows.sort((a, b) => +a.shape_pt_sequence! - +b.shape_pt_sequence!);
  shapes.set(id, simplify(rows.map((r): Point => [+r.shape_pt_lon!, +r.shape_pt_lat!])));
}

/* ---------- linije ---------- */

const toMinutes = (s: string) => {
  const [h, m] = s.split(':');
  return +h! * 60 + +m!;
};

/** Bijeli ili tamni tekst, što ima bolji kontrast. */
function textOn(hex: string) {
  const [r, g, b] = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  const lum = 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
  return 1.05 / (lum + 0.05) >= (lum + 0.05) / 0.0577 ? '#ffffff' : '#101418';
}

/** Spaja sve varijante vožnji jednog smjera u jedan redoslijed stanica. */
function mergePatterns(patterns: string[][]): string[] {
  const merged: string[] = [];
  for (const p of [...patterns].sort((a, b) => b.length - a.length)) {
    const first = p.find((k) => merged.includes(k));
    let cursor = first === undefined ? merged.length - 1 : -1;
    for (const key of p) {
      const at = merged.indexOf(key);
      if (at >= 0) {
        cursor = at;
      } else if (cursor < 0 && first !== undefined) {
        // Stanice prije prve zajedničke idu neposredno ispred nje.
        merged.splice(merged.indexOf(first), 0, key);
      } else {
        merged.splice(++cursor, 0, key);
      }
    }
  }
  return merged;
}

function mostCommon(xs: string[]): string | undefined {
  const c = new Map<string, number>();
  for (const x of xs) c.set(x, (c.get(x) ?? 0) + 1);
  return [...c].sort((a, b) => b[1] - a[1])[0]?.[0];
}

const groupOfKey = (key: string) => groups.get(key.split('#')[0]!)!;

function buildDirection(id: string, rows: Row[]): Direction {
  const seqs = rows
    .map((t) => {
      const st = stopTimes.get(t.trip_id!) ?? [];
      const visits = new Map<string, number>();
      // Ključ nosi redni broj posjeta jer kružna vožnja može dvaput stati na istoj stanici.
      const keys = st.map((s) => {
        const { slug } = placeOf.get(s.stop_id!)!;
        const n = (visits.get(slug) ?? 0) + 1;
        visits.set(slug, n);
        return `${slug}#${n}`;
      });
      return { t, st, keys };
    })
    .filter((s) => s.keys.length > 1);

  const merged = mergePatterns([...new Map(seqs.map((s) => [s.keys.join(), s.keys])).values()]);
  const dirTrips = seqs.map(({ t, st, keys }): Trip => {
    const times: (number | null)[] = merged.map(() => null);
    const poles: (number | null)[] = merged.map(() => null);
    keys.forEach((k, i) => {
      const at = merged.indexOf(k);
      times[at] = toMinutes(st[i]!.departure_time || st[i]!.arrival_time!);
      poles[at] = placeOf.get(st[i]!.stop_id!)!.pole;
    });
    return {
      svc: svcIndex.get(t.service_id!)!,
      headsign: t.trip_headsign?.trim() || groupOfKey(keys.at(-1)!).name,
      times,
      poles,
      last: merged.indexOf(keys.at(-1)!),
    };
  });
  return {
    id,
    label: mostCommon(dirTrips.map((t) => t.headsign)) ?? '',
    stops: merged.map((k, i) => {
      const g = groupOfKey(k);
      return { slug: g.slug, name: g.name, optional: dirTrips.some((t) => t.times[i] === null) };
    }),
    trips: dirTrips,
  };
}

const tripsByRoute = groupBy(trips, (t) => t.route_id!);
const lines = routes
  .filter((r) => tripsByRoute.has(r.route_id!))
  .map((r): Line => {
    const short = r.route_short_name || r.route_long_name!;
    const color = city.lineColors[short] ?? city.lineColors[short.replace(/\D+$/, '')] ?? `#${r.route_color || '444444'}`;
    const rows = tripsByRoute.get(r.route_id!)!;
    return {
      slug: slugify(short),
      short,
      long: r.route_long_name || '',
      color,
      text: textOn(color),
      dirs: [...groupBy(rows, (t) => t.direction_id || '0')]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([id, ts]) => buildDirection(id, ts)),
      shapes: [...new Set(rows.map((t) => t.shape_id!))].flatMap((id) => {
        const s = shapes.get(id);
        return s ? [s] : [];
      }),
    };
  })
  .sort((a, b) => a.short.localeCompare(b.short, 'hr', { numeric: true }));

for (const l of lines) {
  for (const slug of new Set(l.dirs.flatMap((d) => d.stops.map((s) => s.slug)))) groups.get(slug)!.lines.push(l.slug);
}

const network: Network = {
  lines,
  stops: [...groups.values()]
    .filter((g) => g.lines.length)
    .sort((a, b) => a.name.localeCompare(b.name, 'hr', { numeric: true })),
  operator: agency.agency_name ?? '',
};

await mkdir('src/generated', { recursive: true });
await writeFile('src/generated/network.json', JSON.stringify(network));
await writeFile('src/generated/calendar.json', JSON.stringify(cal));
console.log(`GTFS: ${lines.length} linija, ${network.stops.length} stanica, ${trips.length} vožnji, vrijedi ${start} – ${end}`);
