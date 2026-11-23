// Samo za build: cijela mreža. Ne uvoziti u komponente koje idu u preglednik.
import type { Feature, FeatureCollection } from 'geojson';
import data from '../generated/network.json';
import calendar from '../generated/calendar.json';
import '../scripts/jezik.js';
import { poleName } from './text';
import type { BoardRow, Direction, Line, LineRef, Network, StopGroup } from './types';

export const network = data as unknown as Network;
export const labels = calendar.labels;

const lineBySlug = new Map(network.lines.map((l) => [l.slug, l]));
const stopBySlug = new Map(network.stops.map((s) => [s.slug, s]));

export const getLine = (slug: string): Line => lineBySlug.get(slug)!;
export const getStop = (slug: string): StopGroup => stopBySlug.get(slug)!;

export const lineRef = ({ slug, short, color, text }: LineRef): LineRef => ({ slug, short, color, text });

/** Ćirilica za ono što mora biti u HTML-u i bez izbora jezika. */
export const toCyrillic = (s: string): string => jezik.toCyrillic(s);

/** "31. 12. 2026." */
export const longDate = (iso: string) => iso.split('-').reverse().map((x) => `${Number(x)}.`).join(' ');

const emptyDays = () => labels.map((): number[] => []);
const sortDays = (t: number[][]) => t.map((x) => [...new Set(x)].sort((a, b) => a - b));

/** Polasci sa stanice, grupirani po liniji, smjeru, odredištu i stajalištu. */
export function boardRows(stopSlug: string): BoardRow[] {
  const rows = new Map<string, BoardRow>();
  for (const slug of getStop(stopSlug).lines) {
    const line = getLine(slug);
    for (const dir of line.dirs) {
      dir.stops.forEach((stop, i) => {
        if (stop.slug !== stopSlug) return;
        for (const trip of dir.trips) {
          const m = trip.times[i];
          if (m == null || i === trip.last) continue;
          const pole = trip.poles[i]!;
          const key = `${slug}|${dir.id}|${trip.headsign}|${pole}`;
          const row = rows.get(key) ?? { line: lineRef(line), dir: dir.id, to: trip.headsign, pole, t: emptyDays() };
          row.t[trip.svc]!.push(m);
          rows.set(key, row);
        }
      });
    }
  }
  return [...rows.values()].map((r) => ({ ...r, t: sortDays(r.t) }));
}

/** Polasci s početne stanice svake vožnje, po smjeru. */
export function startRow(dir: Direction): { t: number[][] } {
  const t = emptyDays();
  for (const trip of dir.trips) {
    const first = trip.times.find((m) => m !== null);
    if (first != null) t[trip.svc]!.push(first);
  }
  return { t: sortDays(t) };
}

export interface Departure { m: number; v: number }

export interface DirectionTimetable {
  kind: 'polasci' | 'dolasci';
  days: Departure[][];
  /** Odredišta koja nisu glavno odredište smjera; `v` u polasku je indeks + 1. */
  variants: string[];
}

/** Stajališta stanice na kojima staje ovaj smjer. */
export const polesOf = (dir: Direction, stopSlug: string): number[] =>
  [...new Set(dir.stops.flatMap((s, i) => (s.slug === stopSlug ? dir.trips.flatMap((t) => t.poles[i] ?? []) : [])))].sort();

/** Staje li ijedna vožnja na više stajališta iste stanice. */
export const servesBothPoles = (dir: Direction, stopSlug: string): boolean =>
  dir.trips.some((t) => new Set(dir.stops.flatMap((s, i) => (s.slug === stopSlug ? (t.poles[i] ?? []) : []))).size > 1);

/** Vozni red jednog smjera na stanici (ili samo na jednom stajalištu); null ako smjer tu ne staje. */
export function directionTimetable(dir: Direction, stopSlug: string, pole?: number): DirectionTimetable | null {
  const at = dir.stops.flatMap((s, i) => (s.slug === stopSlug ? [i] : []));
  if (!at.length) return null;
  const variants: string[] = [];
  const collect = (arrivals: boolean): Departure[][] => {
    const days = labels.map((): Departure[] => []);
    for (const trip of dir.trips) {
      for (const i of at) {
        const m = trip.times[i];
        if (m == null || (i === trip.last) !== arrivals) continue;
        if (pole !== undefined && trip.poles[i] !== pole) continue;
        let v = 0;
        if (trip.headsign !== dir.label) {
          if (!variants.includes(trip.headsign)) variants.push(trip.headsign);
          v = variants.indexOf(trip.headsign) + 1;
        }
        days[trip.svc]!.push({ m, v });
      }
    }
    return days.map((d) => d.sort((a, b) => a.m - b.m));
  };
  const departures = collect(false);
  if (departures.some((d) => d.length)) return { kind: 'polasci', days: departures, variants };
  return { kind: 'dolasci', days: collect(true), variants };
}

/** Uobičajeno trajanje (medijan) od stanice `from` do svake stanice smjera. */
export function minutesFrom(dir: Direction, from: number): (number | null)[] {
  return dir.stops.map((_, i) => {
    const diffs = dir.trips
      .flatMap((t) => {
        const a = t.times[from];
        const b = t.times[i];
        return a == null || b == null ? [] : [b - a];
      })
      .sort((a, b) => a - b);
    return diffs.length ? diffs[Math.floor(diffs.length / 2)]! : null;
  });
}

/** Uobičajeno trajanje od prethodne stanice smjera; null ako nijedna vožnja ne staje na obje. */
export const minutesBetween = (dir: Direction): (number | null)[] =>
  dir.stops.map((_, i) => (i ? minutesFrom(dir, i - 1)[i]! : null));

/* ---------- GeoJSON ---------- */

/** Broj i oznaka stajališta; prazno ako ga stanica ima samo jedno. */
const poleProps = (s: StopGroup, i: number) =>
  s.poles.length > 1 ? { pole: s.poles[i]!.id, num: String(i + 1), side: poleName(i) } : { pole: '', num: '', side: '' };

const stopFeature = (s: StopGroup, color: string): Feature[] =>
  s.poles.map((p, i) => ({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
    properties: { kind: 'stop', slug: s.slug, name: s.name, lines: s.lines.join(','), color, ...poleProps(s, i) },
  }));

export const stopGeo = (s: StopGroup): FeatureCollection => ({ type: 'FeatureCollection', features: stopFeature(s, '#14171C') });

const lineFeature = (l: Line): Feature => ({
  type: 'Feature',
  geometry: { type: 'MultiLineString', coordinates: l.shapes },
  properties: { kind: 'line', slug: l.slug, short: l.short, color: l.color },
});

export function lineGeo(l: Line): FeatureCollection {
  const stops = network.stops.filter((s) => s.lines.includes(l.slug));
  return { type: 'FeatureCollection', features: [lineFeature(l), ...stops.flatMap((s) => stopFeature(s, l.color))] };
}

export function networkGeo(): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: [...network.lines.map(lineFeature), ...network.stops.flatMap((s) => stopFeature(s, '#14171C'))],
  };
}
