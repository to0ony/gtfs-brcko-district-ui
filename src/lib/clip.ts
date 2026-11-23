import { meters } from './planner.ts';

export type Pt = [number, number];

/** Najbliža točka na crti iza položaja `after` (indeks segmenta + udio). */
function project(shape: Pt[], p: Pt, after: number) {
  let best = { pos: -1, d: Infinity, pt: p };
  const first = Math.min(Math.floor(after), shape.length - 2);
  for (let i = first; i + 1 < shape.length; i++) {
    const [ax, ay] = shape[i]!;
    const [bx, by] = shape[i + 1]!;
    const kx = Math.cos((p[1] * Math.PI) / 180);
    const dx = (bx - ax) * kx;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let u = len2 ? (((p[0] - ax) * kx) * dx + (p[1] - ay) * dy) / len2 : 0;
    u = Math.max(i === first ? after - i : 0, Math.min(1, u));
    const pt: Pt = [ax + (bx - ax) * u, ay + (by - ay) * u];
    const d = meters(p[1], p[0], pt[1], pt[0]);
    if (d < best.d) best = { pos: i + u, d, pt };
  }
  return best;
}

/** Dio trase linije između ulaska i izlaska; ravne crte ako se trasa ne može pouzdano pogoditi. */
export function clip(shapes: Pt[][], stops: Pt[]): Pt[] {
  let best: Pt[] = stops;
  let bestCost = 80 * stops.length; // u prosjeku najviše 80 m od trase
  for (const shape of shapes) {
    if (shape.length < 2) continue;
    let pos = 0;
    let cost = 0;
    const hits = stops.map((s) => {
      const h = project(shape, s, pos);
      pos = h.pos;
      cost += h.d;
      return h;
    });
    const a = hits[0]!;
    const b = hits.at(-1)!;
    if (b.pos <= a.pos || cost >= bestCost) continue;
    bestCost = cost;
    best = [a.pt, ...shape.slice(Math.floor(a.pos) + 1, Math.floor(b.pos) + 1), b.pt];
  }
  return best;
}
