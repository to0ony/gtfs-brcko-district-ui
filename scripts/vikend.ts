// Traži prijedlog za vikend i praznike i zapisuje ga u data/vikend.json. Pokreće se ručno (minuta-dvije):
//   node scripts/vikend.ts
// Pravila: nijedno naselje ne gubi više od MAX_LOSS min, dolasci do 8:00 i povratci nakon 19:00 se ne smanjuju,
// sati vožnje rastu najviše BUDGET puta.
import { readFile, writeFile } from 'node:fs/promises';
import { analyze, type RawSettlement } from '../src/analiza/compute.ts';
import { endOf, startOf } from '../src/analiza/scenario.ts';
import { applyOps, build, makeBase, outcome, popOf, template, type New, type Op, type Outcome, type Plan } from '../src/analiza/vikend.ts';
import type { Calendar, Network } from '../src/lib/types.ts';

const MAX_LOSS = 5;
const BUDGET = 1.3;
const EXTRA_BUSES = 3;
const MAX_WAIT = 150;
/** Linije koje i vikendom voze češće; neki njihovi polasci mogu postati druga linija. */
const FREQUENT = ['8', '14'];
/** Rep rijetke linije i stanica na kojoj se hvata na čestu. */
const TAILS: [line: string, cut: string, frequent: string][] = [['1', 'pirometal', '14'], ['15', 'pirometal', '14'], ['2', 'ulicki-put', '14'], ['13', 'ulicki-put', '14'], ['6', 'krajnovici', '8'], ['7', 'omerbegovaca', '8']];

const json = async <T>(f: string) => JSON.parse(await readFile(f, 'utf8')) as T;
const network = await json<Network>('src/generated/network.json');
const calendar = await json<Calendar>('src/generated/calendar.json');
const { settlements } = analyze(network, calendar.labels, await json<RawSettlement[]>('data/naselja.json'));
const b = makeBase(network);
const pop = popOf(settlements);
const dirsOf = (line: string) => network.lines[b.lineOf.get(line)!]!.dirs.map((d) => d.id);
const span = (line: string, dir: string, cut?: string) => { const f = template(b, line, dir, cut); return f && f.length >= 4 ? f.at(-1)! - f[1]! : null; };
const centerOffset = (line: string, dir: string) => { const f = template(b, line, dir)!; for (let i = 0; i < f.length; i += 2) if (b.slugs[f[i]!] === 'centar') return f[i + 1]! - f[1]!; return null; };

const ops: Op[] = [];
for (const svc of [1, 2].filter((s) => s < calendar.labels.length)) {
  const start = outcome(b, settlements, pop, b.trips, svc);
  const mine: Op[] = [];
  const run = (extra: Op[]) => { const r = applyOps(b, b.trips, [...mine, ...extra]); return r.skipped ? null : outcome(b, settlements, pop, r.trips, svc); };
  const allowed = (o: Outcome, hours: number, buses: number) =>
    o.hours <= hours + 0.01 && o.buses <= buses && o.morning >= start.morning && o.evening >= start.evening
    && o.avg.every((x, i) => !pop[i] || x <= start.avg[i]! + MAX_LOSS);
  const inDay = (n: New) => { const t = build(b, n, svc); return !!t && startOf(t) >= 290 && endOf(t) <= 1400; };
  let now = start;
  const greedy = (name: string, step: Op['step'], max: number, hours: number, buses: number, candidates: () => Op[], perHour: boolean) => {
    for (let n = 0; n < max; n++) {
      let best: { op: Op; o: Outcome; gain: number } | null = null;
      for (const op of candidates()) {
        const o = run([op]);
        if (!o || !allowed(o, hours, buses)) continue;
        const gain = (now.mean - o.mean) / (perHour ? Math.max(0.5, o.hours - now.hours) : 1);
        if (now.mean - o.mean > 0.25 && (!best || gain > best.gain)) best = { op: { ...op, step }, o, gain };
      }
      if (!best) break;
      mine.push(best.op);
      console.log(calendar.labels[svc], name, JSON.stringify(best.op), `${now.mean.toFixed(1)} -> ${best.o.mean.toFixed(1)}, ${best.o.hours.toFixed(1)} h, ${best.o.buses} busova`);
      now = best.o;
    }
  };

  // 1. Pomaci polazaka rijetkih linija, bez dodatnih sati.
  greedy('pomak', 0, 5, start.hours, start.buses, () => {
    const used = new Set(mine.flatMap((o) => (o.move ? [`${o.move.line}|${o.move.dir}|${o.move.at}`] : [])));
    return b.trips.filter((t) => t[3] === svc && !FREQUENT.includes(network.lines[t[0]]!.short)).flatMap((t) => {
      const r = { line: network.lines[t[0]]!.short, dir: t[1], at: startOf(t) };
      if (used.has(`${r.line}|${r.dir}|${r.at}`)) return [];
      return [-90, -60, -45, -30, 30, 45, 60, 90, 120].filter((d) => startOf(t) + d >= 290 && endOf(t) + d <= 1400).map((d): Op => ({ step: 0, svc, move: { ...r, to: r.at + d } }));
    });
  }, false);

  // 2. Odlazak i povratak česte linije zajedno postaju odlazak i povratak rijetke, s istim vremenom u Centru.
  greedy('zamjena', 2, 4, start.hours * BUDGET, start.buses + 1, () => FREQUENT.flatMap((f) => {
    // Svaka se vožnja mijenja najviše jednom, da se koraci mogu uključivati neovisno.
    const gone = new Set(mine.flatMap((o) => [...(o.remove ?? []), ...(o.join ? [o.join.first, o.join.then] : [])].map((r) => `${r.line}|${r.dir}|${r.at}`)));
    const list = (d: string) => b.trips.filter((t) => t[3] === svc && t[0] === b.lineOf.get(f) && t[1] === d).sort((x, y) => startOf(x) - startOf(y));
    const [d0, d1] = dirsOf(f);
    return list(d0!).flatMap((t, k) => {
      const back = list(d1!)[k];
      if (!back) return [];
      const remove = [{ line: f, dir: d0!, at: startOf(t) }, { line: f, dir: d1!, at: startOf(back) }];
      if (remove.some((r) => gone.has(`${r.line}|${r.dir}|${r.at}`))) return [];
      const center = startOf(t) + centerOffset(f, d0!)!;
      return network.lines.map((l) => l.short).filter((x) => !FREQUENT.includes(x)).flatMap((x) => dirsOf(x).flatMap((dir) => {
        const off = centerOffset(x, dir);
        const other = dirsOf(x).find((y) => y !== dir);
        const len = span(x, dir);
        if (off === null || len === null || !other) return [];
        return [-60, -30, 0, 30, 60].flatMap((shift): Op[] => {
          const at = center - off + shift;
          const add: New[] = [{ line: x, dir, at }, { line: x, dir: other, at: at + len + 10 }];
          return add.every(inDay) ? [{ step: 2, svc, remove, add }] : [];
        });
      }));
    });
  }), false);

  // 3. Autobus česte linije s okretišta nastavi kao rijetka i vrati se na svoj sljedeći polazak.
  const visitsOf = (flat: number[]) => { const v: [string, number][] = []; for (let i = 0; i < flat.length; i += 2) v.push([b.slugs[flat[i]!]!, flat[i + 1]!]); return v; };
  greedy('nadovezivanje', 1, 6, start.hours * BUDGET, start.buses + 1, () => FREQUENT.flatMap((f) => dirsOf(f).flatMap((dIn) => {
    const dOut = dirsOf(f).find((x) => x !== dIn)!;
    const used = new Set(mine.flatMap((o) => [...(o.remove ?? []), ...(o.join ? [o.join.first, o.join.then] : [])].map((r) => `${r.line}|${r.dir}|${r.at}`)));
    const own = (d: string) => b.trips.filter((t) => t[3] === svc && t[0] === b.lineOf.get(f) && t[1] === d && !used.has(`${f}|${d}|${startOf(t)}`)).sort((x, y) => startOf(x) - startOf(y));
    return own(dIn).flatMap((t) => network.lines.map((l) => l.short).filter((x) => !FREQUENT.includes(x)).flatMap((x): Op[] => {
      const v = visitsOf(t[4]);
      const end = v.at(-1)!;
      // Spoj je okretište ili stanica najviše 6 min prije njega.
      for (let i = v.length - 1; i >= 0 && end[1] - v[i]![1] <= 6; i--) {
        const cut = v[i]![0];
        const link = end[1] - v[i]![1];
        const dirs = dirsOf(x).map((dir) => ({ dir, flat: template(b, x, dir, cut) })).filter((y) => y.flat && y.flat.length >= 6);
        const out = dirs.find((y) => b.slugs[y.flat![0]!] === cut);
        const into = dirs.find((y) => b.slugs[y.flat!.at(-2)!] === cut && y.dir !== out?.dir);
        if (!out || !into) continue;
        const onF = new Set(v.map((y) => y[0]));
        if (visitsOf(out.flat!).filter((y) => !onF.has(y[0])).length < 2) continue;
        const wait = Math.max(2, link + 1);
        const at = end[1] + wait;
        const lenOut = out.flat!.at(-1)! - out.flat![1]!;
        const lenIn = into.flat!.at(-1)! - into.flat![1]!;
        const then = own(dOut).find((y) => b.slugs[y[4][0]!] === end[0] && startOf(y) - wait - lenIn >= at + lenOut + 3);
        // Autobus ne čeka satima na kraju rijetke linije.
        if (!then || startOf(then) - wait - lenIn - (at + lenOut) > MAX_WAIT) return [];
        return [{ step: 1, svc, join: { first: { line: f, dir: dIn, at: startOf(t) }, then: { line: f, dir: dOut, at: startOf(then) }, line: x, out: out.dir, into: into.dir, cut, at, back: startOf(then) - wait - lenIn } }];
      }
      return [];
    }));
  })), true);

  // 4. Dodaci: kratki repovi koji se hvataju na čestu liniju, ili cijele vožnje tamo i natrag.
  const arrivals = (cut: string, f: string, toCenter: boolean) => [...new Set(b.trips.filter((t) => t[3] === svc && t[0] === b.lineOf.get(f)).flatMap((t) => {
    const v: [number, number][] = [];
    for (let i = 0; i < t[4].length; i += 2) v.push([t[4][i]!, t[4][i + 1]!]);
    const j = v.findIndex((x) => b.slugs[x[0]] === cut);
    const c = v.findIndex((x) => b.slugs[x[0]] === 'centar');
    return j >= 0 && c >= 0 && j < c === toCenter ? [v[j]![1]] : [];
  }))];
  const tails = TAILS.flatMap(([line, cut, f]) => {
    const dirs = dirsOf(line).map((dir) => ({ dir, flat: template(b, line, dir, cut) })).filter((x) => x.flat && x.flat.length >= 4);
    const out = dirs.find((x) => b.slugs[x.flat![0]!] === cut);
    const into = dirs.find((x) => b.slugs[x.flat!.at(-2)!] === cut);
    if (!out || !into) return [];
    const lo = span(line, out.dir, cut)!;
    const li = span(line, into.dir, cut)!;
    return [
      ...arrivals(cut, f, false).map((e): Op => ({ step: 3, svc, add: [{ line, dir: out.dir, at: e + 3, cut }, { line, dir: into.dir, at: e + 3 + lo + 5, cut }] })),
      ...arrivals(cut, f, true).map((e): Op => ({ step: 3, svc, add: [{ line, dir: into.dir, at: e - 4 - li, cut }, { line, dir: out.dir, at: e + 5, cut }] })),
    ];
  });
  const full = network.lines.flatMap((l) => l.dirs.flatMap((d): Op[] => {
    const other = l.dirs.find((x) => x.id !== d.id);
    const len = span(l.short, d.id);
    if (len === null) return [];
    return Array.from({ length: 29 }, (_, k) => 300 + 30 * k).map((at): Op => ({ step: 3, svc, add: [{ line: l.short, dir: d.id, at }, ...(other ? [{ line: l.short, dir: other.id, at: at + len + 10 }] : [])] }));
  }));
  greedy('dodatak', 3, 10, start.hours * BUDGET, start.buses + EXTRA_BUSES, () => [...tails, ...full].filter((o) => o.add!.every(inDay)), true);

  ops.push(...mine);
  console.log(`${calendar.labels[svc]}: ${start.mean.toFixed(1)} -> ${now.mean.toFixed(1)} min, ${start.hours.toFixed(1)} -> ${now.hours.toFixed(1)} h, kući nakon 19: ${start.evening} -> ${now.evening}, do 8: ${start.morning} -> ${now.morning}`);
}
const plan: Plan = { trips: b.trips.length, ops };
await writeFile('data/vikend.json', `{"trips":${plan.trips},"ops":[\n${ops.map((o) => JSON.stringify(o)).join(',\n')}\n]}\n`);
