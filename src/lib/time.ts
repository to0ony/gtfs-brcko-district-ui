import type { Calendar } from './types.ts';

export interface Now { date: string; minutes: number }

export interface Upcoming<T> {
  row: T;
  /** Minute do polaska. */
  wait: number;
  /** Minute od ponoći (0–1439) u trenutku polaska. */
  clock: number;
  /** Koliko dana od danas. */
  day: number;
}

const DAY = 1440;

export function zonedNow(timeZone: string, at = new Date()): Now {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).formatToParts(at);
  const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, minutes: Number(p.hour) * 60 + Number(p.minute) };
}

const toDays = (date: string) => Math.round(Date.parse(`${date}T00:00:00Z`) / 86_400_000);

export const addDays = (date: string, n: number) =>
  new Date((toDays(date) + n) * 86_400_000).toISOString().slice(0, 10);

export const weekdayOf = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay();

export const hhmm = (m: number) => {
  const c = ((m % DAY) + DAY) % DAY;
  return `${String(Math.floor(c / 60)).padStart(2, '0')}:${String(c % 60).padStart(2, '0')}`;
};

export const isOutside = (cal: Calendar, date: string) => date < cal.start || date > cal.end;

/** Bitmaska aktivnih vrsta dana na zadani datum. */
export function activeMask(cal: Calendar, date: string): number {
  if (isOutside(cal, date)) return cal.weekday[weekdayOf(date)] ?? 0;
  return cal.days[toDays(date) - toDays(cal.start)] ?? 0;
}

export const activeServices = (cal: Calendar, date: string): number[] =>
  cal.labels.map((_, i) => i).filter((i) => activeMask(cal, date) & (1 << i));

/** Sljedeći polasci, uključujući jučerašnje vožnje iza ponoći i iduće dane. */
export function upcoming<T extends { t: number[][] }>(
  cal: Calendar, now: Now, rows: T[], limit: number, horizonDays = 7,
): Upcoming<T>[] {
  const out: Upcoming<T>[] = [];
  for (let d = -1; d <= horizonDays; d++) {
    // Sve što kreće prije ponoći dana d već je prikupljeno; kasniji dani ne mogu biti raniji.
    if (d > 0 && out.filter((u) => u.day < d).length >= limit) break;
    for (const s of activeServices(cal, addDays(now.date, d))) {
      for (const row of rows) {
        for (const m of row.t[s] ?? []) {
          const at = d * DAY + m;
          if (at < now.minutes) continue;
          out.push({ row, wait: at - now.minutes, clock: at % DAY, day: Math.floor(at / DAY) });
        }
      }
    }
  }
  return out.sort((a, b) => a.wait - b.wait).slice(0, limit);
}

const WEEKDAYS = ['ned', 'pon', 'uto', 'sri', 'čet', 'pet', 'sub'];

/** "sada", "za 12 min", "za 1 h 05 min", "sutra", "sri". */
export function waitLabel(u: { wait: number; day: number }, today: string): string {
  if (u.wait === 0) return 'sada';
  if (u.wait < 60) return `za ${u.wait} min`;
  if (u.day === 0) return `za ${Math.floor(u.wait / 60)} h ${String(u.wait % 60).padStart(2, '0')} min`;
  return u.day === 1 ? 'sutra' : (WEEKDAYS[weekdayOf(addDays(today, u.day))] ?? '');
}
