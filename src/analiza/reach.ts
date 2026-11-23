// Najraniji dolazak s jednog mjesta na sva ostala (connection scan), po istim pravilima presjedanja kao planer.
// Gleda samo jedan dan, bez vožnji preko ponoći.
import { meters, RULES, walkMinutes, type Access, type PlanData } from '../lib/planner.ts';

interface Conn { dep: number; arr: number; from: number; to: number; trip: number; i: number }

/** Do koliko se minuta hoda računa kad u naselju nema stanice. */
export const MAX_ACCESS_WALK = 40;

export function createReach({ poles, trips }: Pick<PlanData, 'poles' | 'trips'>) {
  const foot = poles.map(([stopA, , latA, lonA], a) =>
    poles.flatMap(([stopB, , latB, lonB], b) => {
      if (a === b) return [];
      const m = meters(latA, lonA, latB, lonB);
      const same = stopA === stopB;
      return same || m * RULES.detour <= RULES.maxWalk ? [{ to: b, minutes: walkMinutes(m), same }] : [];
    }));

  const cache = new Map<number, Conn[]>();
  function connections(svc: number): Conn[] {
    let list = cache.get(svc);
    if (!list) {
      list = [];
      for (const [trip, [, , , s, flat]] of trips.entries()) {
        if (s !== svc) continue;
        for (let i = 0; i + 3 < flat.length; i += 2) list.push({ dep: flat[i + 1]!, arr: flat[i + 3]!, from: flat[i]!, to: flat[i + 2]!, trip, i });
      }
      list.sort((a, b) => a.dep - b.dep || a.trip - b.trip || a.i - b.i);
      cache.set(svc, list);
    }
    return list;
  }

  /** Minuta dolaska na svako stajalište za polazak u `t`; Infinity ako se ne stiže. */
  function earliest(svc: number, access: Access, t: number): Float64Array {
    const ready = new Float64Array(poles.length).fill(Infinity);
    const arrived = new Float64Array(poles.length).fill(Infinity);
    const on = new Uint8Array(trips.length);
    for (const [p, w] of access) ready[p] = arrived[p] = t + w;
    for (const c of connections(svc)) {
      if (c.dep < t) continue;
      if (!on[c.trip]) {
        if (ready[c.from]! > c.dep) continue;
        on[c.trip] = 1;
      }
      if (c.arr >= arrived[c.to]!) continue;
      arrived[c.to] = c.arr;
      ready[c.to] = Math.min(ready[c.to]!, c.arr + RULES.change);
      for (const f of foot[c.to]!) {
        ready[f.to] = Math.min(ready[f.to]!, c.arr + f.minutes + RULES.changeOnFoot);
        if (!f.same) arrived[f.to] = Math.min(arrived[f.to]!, c.arr + f.minutes);
      }
    }
    return arrived;
  }

  /** Sa stajališta jedne stanice ili naselja: ona sama, i susjedna do kojih se može prošetati. */
  function accessFrom(own: number[]): Access {
    const access: Access = new Map(own.map((p) => [p, 0]));
    for (const p of own) for (const f of foot[p]!) if (f.minutes < (access.get(f.to) ?? Infinity)) access.set(f.to, f.minutes);
    return access;
  }

  /** Iz naselja bez stanice: pješice od sredine naselja. */
  function accessFromPlace(lat: number, lon: number): Access {
    const list = poles.map(([, , la, lo], p): [number, number] => [p, Math.max(1, walkMinutes(meters(lat, lon, la, lo)))]);
    return new Map(list.filter(([, w]) => w <= MAX_ACCESS_WALK));
  }

  /** Trenuci u kojima se isplati krenuti: svaki polazak s dostupnog stajališta. */
  function events(svc: number, access: Access): number[] {
    const out = new Set<number>();
    for (const c of connections(svc)) {
      const w = access.get(c.from);
      if (w !== undefined) out.add(c.dep - w);
    }
    return [...out].sort((a, b) => a - b);
  }

  return { earliest, accessFrom, accessFromPlace, events };
}

/** Najraniji dolazak u naselje: prvo stajalište u njemu ili, ako ga nema, hod od stajališta do sredine. */
export const arrivalAt = (arrived: Float64Array, access: Access): number => {
  let best = Infinity;
  for (const [p, w] of access) best = Math.min(best, arrived[p]! + w);
  return best;
};
