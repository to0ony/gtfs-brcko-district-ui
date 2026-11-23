import { hhmm } from '../lib/time.ts';
import type { Settlement } from './compute.ts';

export const int = (n: number) => String(Math.round(n)).replace(/\B(?=(\d{3})+$)/g, '.');
export const dec = (n: number, digits = 1) => n.toFixed(digits).replace('.', ',');
export const pct = (share: number) => `${Math.round(100 * share)} %`;
export const clock = (m: number | null | undefined) => (m == null ? '–' : hhmm(m));
export const mins = (m: number | null | undefined) =>
  m == null ? '–' : m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${String(m % 60).padStart(2, '0')} min` : ''}`;
export const signed = (share: number) => `${share > 0 ? '+' : share < 0 ? '−' : ''}${Math.abs(Math.round(100 * share))} %`;

export const density = (s: Settlement) => s.pop / s.km2;
export const change = (s: Settlement) => (s.pop91 ? s.pop / s.pop91 - 1 : 0);
export const per1000 = (s: Settlement, day: number) => (1000 * s.days[day]!.trips) / s.pop;

export interface Metric {
  id: string;
  label: string;
  /** null = nema vrijednosti, crta se šrafirano. */
  value: (s: Settlement, day: number) => number | null;
  /** Četiri praga, pet razreda; razred počinje pragom. */
  breaks: [number, number, number, number];
  format: (n: number) => string;
  /** Natpisi razreda. */
  legend: string[];
  none: string;
}

const ranges = (b: number[], unit = '') => [`< ${b[0]}${unit}`, `${b[0]}–${b[1]! - 1}${unit}`, `${b[1]}–${b[2]! - 1}${unit}`, `${b[2]}–${b[3]! - 1}${unit}`, `${b[3]}+${unit}`];
const metric = (m: Omit<Metric, 'legend'> & { unit?: string }): Metric => ({ ...m, legend: ranges(m.breaks, m.unit) });

export const METRICS: Metric[] = [
  metric({ id: 'trips', label: 'Vožnji na dan', value: (s, d) => s.days[d]!.trips || null, breaks: [5, 10, 20, 40], format: int, none: 'ne vozi' }),
  metric({ id: 'per1000', label: 'Vožnji na 1000 stanovnika', value: (s, d) => (s.days[d]!.trips ? per1000(s, d) : null), breaks: [5, 10, 20, 40], format: (n) => dec(n), none: 'ne vozi' }),
  metric({ id: 'center', label: 'Najbrže do Centra', value: (s, d) => s.center[d]?.best ?? null, breaks: [15, 25, 35, 50], unit: ' min', format: (n) => mins(n), none: 'ne stiže se ili je tamo' }),
  metric({ id: 'hospital', label: 'Najbrže do Bolnice', value: (s, d) => s.hospital[d]?.best ?? null, breaks: [15, 25, 35, 50], unit: ' min', format: (n) => mins(n), none: 'ne stiže se ili je tamo' }),
  metric({ id: 'gap', label: 'Najduža pauza', value: (s, d) => s.days[d]!.gap, breaks: [90, 180, 300, 480], unit: ' min', format: (n) => mins(n), none: 'manje od dvije vožnje' }),
  metric({ id: 'pop', label: 'Stanovnika', value: (s) => s.pop, breaks: [200, 500, 1000, 2000], format: int, none: '' }),
  metric({ id: 'density', label: 'Stanovnika po km²', value: density, breaks: [40, 80, 150, 300], format: int, none: '' }),
  metric({ id: 'old', label: '65 i više godina', value: (s) => (100 * s.old) / s.pop, breaks: [10, 14, 18, 22], unit: ' %', format: (n) => `${dec(n)} %`, none: '' }),
  metric({ id: 'young', label: '0–19 godina', value: (s) => (100 * s.young) / s.pop, breaks: [15, 19, 23, 27], unit: ' %', format: (n) => `${dec(n)} %`, none: '' }),
];

export const classOf = (v: number | null, breaks: readonly number[]) => (v === null ? -1 : breaks.filter((b) => v >= b).length);
