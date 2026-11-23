// Vozni red jedne linije s izmjenama, za ispis: stanice u redovima, vožnje u stupcima.
import { startOf } from './scenario.ts';
import { applyTagged, tails, type Op, type Ref, type Tagged, type WeekendBase } from './vikend.ts';

export interface Column {
  /** Minute poravnate s redovima; null = tu ne staje. */
  times: (number | null)[];
  mark?: Tagged['mark'];
  /** Kod nadovezivanja: druga linija istog autobusa. */
  with?: string;
}

export interface Sheet {
  dir: string;
  /** Slugovi stanica. */
  rows: string[];
  columns: Column[];
  /** Početna i završna stanica glavne varijante. */
  from: string;
  to: string;
  /** Polasci koji otpadaju. */
  gone: number[];
}

/** Spaja redoslijede stanica svih vožnji u jedan. */
export function mergePatterns(patterns: string[][]): string[] {
  const merged: string[] = [];
  for (const p of [...patterns].sort((a, b) => b.length - a.length)) {
    const first = p.find((k) => merged.includes(k));
    let cursor = first === undefined ? merged.length - 1 : -1;
    for (const key of p) {
      const at = merged.indexOf(key);
      if (at >= 0) cursor = at;
      else if (cursor < 0 && first !== undefined) merged.splice(merged.indexOf(first), 0, key);
      else merged.splice(++cursor, 0, key);
    }
  }
  return merged;
}

/** Ključ nosi redni broj posjeta, jer vožnja može dvaput stati na istoj stanici; dio druge linije ima svoje redove. */
function visits(b: WeekendBase, flat: number[], extra?: [number, number], other = '') {
  const seen = new Map<string, number>();
  const out: { key: string; m: number }[] = [];
  for (let i = 0; i < flat.length; i += 2) {
    const outside = extra && i / 2 >= extra[0] && i / 2 < extra[1];
    const id = `${b.slugs[flat[i]!]!}#${outside ? other : ''}`;
    const n = (seen.get(id) ?? 0) + 1;
    seen.set(id, n);
    out.push({ key: `${id}#${n}`, m: flat[i + 1]! });
  }
  return out;
}

export function sheets(b: WeekendBase, all: Op[], line: string, svc: number): Sheet[] {
  const ops = all.filter((o) => o.svc === svc);
  const id = b.lineOf.get(line);
  const { trips } = applyTagged(b, b.trips, ops);
  const rows: (Tagged & { dir: string })[] = trips.filter(({ t }) => t[3] === svc && t[0] === id).map((x) => ({ ...x, dir: x.t[1] }));
  // Na listu rijetke linije ide i njezin dio koji vozi autobus česte.
  for (const o of ops) {
    const parts = o.join?.line === line ? tails(b, o.join) : null;
    if (!parts) continue;
    const j = o.join!;
    rows.push({ t: [id!, j.out, 0, svc, parts[0]], mark: 'joined', with: j.first.line, dir: j.out });
    rows.push({ t: [id!, j.into, 0, svc, parts[1]], mark: 'joined', with: j.then.line, dir: j.into });
  }
  const gone = ops.flatMap((o) => o.remove ?? []).filter((r: Ref) => r.line === line);
  const dirs = [...new Set(rows.map((r) => r.dir))].sort();
  return dirs.map((dir): Sheet => {
    const list = rows.filter((r) => r.dir === dir).sort((x, y) => startOf(x.t) - startOf(y.t)).map((r) => ({ ...r, v: visits(b, r.t[4], r.extra, r.with) }));
    const keys = mergePatterns([...new Map(list.map((r) => [r.v.map((x) => x.key).join(), r.v.map((x) => x.key)])).values()]);
    const count = new Map<string, number>();
    // Glavna varijanta je najčešća među vožnjama koje nisu nadovezane.
    for (const r of list.some((x) => x.mark !== 'joined') ? list.filter((x) => x.mark !== 'joined') : list) {
      const k = `${r.v[0]!.key}|${r.v.at(-1)!.key}`;
      count.set(k, (count.get(k) ?? 0) + 1);
    }
    const [from, to] = [...count].sort((x, y) => y[1] - x[1])[0]![0].split('|').map((k) => k.split('#')[0]!);
    return {
      dir,
      rows: keys.map((k) => k.split('#')[0]!),
      columns: list.map((r) => ({
        times: keys.map((k) => r.v.find((x) => x.key === k)?.m ?? null),
        ...(r.mark ? { mark: r.mark } : {}),
        ...(r.with ? { with: r.with } : {}),
      })),
      from: from!,
      to: to!,
      gone: gone.filter((r) => r.dir === dir).map((r) => r.at).sort((x, y) => x - y),
    };
  });
}
