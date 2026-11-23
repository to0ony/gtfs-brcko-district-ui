import { useEffect, useState } from 'preact/hooks';
import { city } from '../../city.config';
import calendarJson from '../generated/calendar.json';
import { zonedNow, type Now } from './time';
import type { Calendar } from './types';

export const calendar: Calendar = calendarJson;

/** Trenutno vrijeme u gradu. `null` do hidracije, da HTML iz builda ne ovisi o satu. */
export function useNow(): Now | null {
  const [now, setNow] = useState<Now | null>(null);
  useEffect(() => {
    const tick = () =>
      setNow((prev) => {
        const next = zonedNow(city.timeZone);
        return prev && prev.date === next.date && prev.minutes === next.minutes ? prev : next;
      });
    tick();
    const id = setInterval(tick, 5000);
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', tick);
    };
  }, []);
  return now;
}

declare global {
  /** src/scripts/jezik.js */
  var jezik: { cyrillic: boolean; toCyrillic: (s: string) => string; convert: (s: string) => string };
}

/** Tekst koji nije u DOM-u (vrijednost polja, natpisi na karti) u odabranom jeziku. */
export const convert = (s: string) => jezik.convert(s);

/** Kao `convert`, uz ponovni ispis kad se jezik promijeni. */
export function useLanguage(): (s: string) => string {
  const [current, setCurrent] = useState(() => (s: string) => s);
  useEffect(() => {
    const sync = () => setCurrent(() => (s: string) => convert(s));
    sync();
    addEventListener('jezikchange', sync);
    return () => removeEventListener('jezikchange', sync);
  }, []);
  return current;
}

export type FavoriteKind = 'stanica' | 'linija';

const KEYS: Record<FavoriteKind, string> = { stanica: 'favoriti', linija: 'favoriti-linije' };
const EVENT = 'favoriti';

function readFavorites(kind: FavoriteKind): string[] {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(KEYS[kind]) ?? '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export function toggleFavorite(kind: FavoriteKind, slug: string) {
  const cur = readFavorites(kind);
  const next = cur.includes(slug) ? cur.filter((s) => s !== slug) : [...cur, slug];
  try {
    localStorage.setItem(KEYS[kind], JSON.stringify(next));
  } catch {
    return; // privatni način rada: favoriti se jednostavno ne pamte
  }
  dispatchEvent(new Event(EVENT));
}

export function useFavorites(kind: FavoriteKind): string[] {
  const [favs, setFavs] = useState<string[]>([]);
  useEffect(() => {
    const sync = () => setFavs(readFavorites(kind));
    sync();
    addEventListener(EVENT, sync);
    addEventListener('storage', sync);
    return () => {
      removeEventListener(EVENT, sync);
      removeEventListener('storage', sync);
    };
  }, [kind]);
  return favs;
}

/** Adrese spremljenih stanica i linija, da ih service worker spremi za rad bez veze. */
export const savedPaths = (): string[] => [
  ...readFavorites('stanica').flatMap((s) => { const slug = encodeURIComponent(s.split('#')[0]!); return [`/stanica/${slug}`, `/data/stanica/${slug}.json`]; }),
  ...readFavorites('linija').map((s) => `/linija/${encodeURIComponent(s)}`),
];

/** Lokacija korisnika; greška nosi poruku za prikaz. */
export function locate(): Promise<[number, number]> {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) return reject(new Error('Ovaj preglednik ne podržava lokaciju.'));
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => resolve([coords.latitude, coords.longitude]),
      (e) => reject(new Error(e.code === e.PERMISSION_DENIED
        ? 'Lokacija je blokirana. Dopusti je u postavkama preglednika.'
        : 'Lokacija trenutno nije dostupna. Pokušaj ponovno.')),
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 },
    );
  });
}

const cache = new Map<string, Promise<unknown>>();

export function getJson<T>(url: string): Promise<T> {
  let p = cache.get(url);
  if (!p) {
    p = fetch(url).then((r) => {
      if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
      return r.json();
    });
    p.catch(() => cache.delete(url));
    cache.set(url, p);
  }
  return p as Promise<T>;
}
