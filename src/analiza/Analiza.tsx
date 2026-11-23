import { useEffect, useMemo, useState } from 'preact/hooks';
import { getJson } from '../lib/client';
import type { PlanData } from '../lib/planner';
import { plural } from '../lib/text';
import { hhmm } from '../lib/time';
import { CITY, type Analysis, type LineStats, type Settlement } from './compute';
import { change, classOf, clock, dec, density, int, METRICS, mins, pct, per1000, signed } from './format';
import { Legend, SettlementMap, SortTable, Tile, TipBox, useWidth, type Column, type Tip } from './parts';
import { arrivalAt, createReach } from './reach';
import Vikend from './VikendPoglavlje';

interface View { a: Analysis; day: number; selected: string | null; select: (id: string | null) => void; tip: (t: Tip | null) => void }

const LineBadge = ({ line }: { line: LineStats }) => <span class="badge notranslate" style={{ background: line.color, color: line.text }}>{line.short}</span>;
const trips = (n: number) => plural(n, 'vožnja', 'vožnje', 'vožnji');

/* ---------- naselje ---------- */

function Hours({ hours }: { hours: number[] }) {
  const top = Math.max(1, ...hours);
  const list = hours.map((n, h) => ({ n, h })).slice(4, 24);
  return (
    <div class="strip" role="img" aria-label={`Vožnje po satima: ${list.filter((x) => x.n).map((x) => `${x.h} h ${x.n}`).join(', ') || 'nema'}`}>
      {list.map(({ n, h }) => <i key={h} title={`${h} h: ${trips(n)}`}><b style={{ height: `${(100 * n) / top}%` }} /><span>{h % 4 === 0 ? h : ''}</span></i>)}
    </div>
  );
}

function Detail({ a, day, selected, select }: View) {
  const s = a.settlements.find((x) => x.id === selected);
  if (!s) {
    return (
      <div class="card detail empty">
        <p>Odaberi naselje na karti ili u izborniku iznad, pa ovdje piše sve o njemu.</p>
      </div>
    );
  }
  const d = s.days[day]!;
  const c = s.center[day];
  const h = s.hospital[day];
  const lines = a.lines.filter((l) => s.lines.includes(l.slug));
  return (
    <article class="card detail">
      <header>
        <h3>{s.name}</h3>
        <span class="muted">{s.urban ? 'gradsko' : 'seosko'} naselje</span>
        <button type="button" class="close" onClick={() => select(null)} aria-label="Zatvori naselje">×</button>
      </header>
      <dl>
        <div><dt>Stanovnika</dt><dd>{int(s.pop)} <small>{signed(change(s))} od 1991.</small></dd></div>
        <div><dt>Po km²</dt><dd>{int(density(s))} <small>{dec(s.km2)} km²</small></dd></div>
        <div><dt>0–19 godina</dt><dd>{pct(s.young / s.pop)} <small>{int(s.young)}</small></dd></div>
        <div><dt>65 i više</dt><dd>{pct(s.old / s.pop)} <small>{int(s.old)}</small></dd></div>
      </dl>
      <p class="sub">{a.labels[day]}</p>
      <dl>
        <div><dt>Vožnji</dt><dd>{d.trips} <small>{d.trips ? `${dec(per1000(s, day))} na 1000 st.` : ''}</small></dd></div>
        <div><dt>Prvi i posljednji</dt><dd>{clock(d.first)} – {clock(d.last)}</dd></div>
        <div><dt>Najduža pauza</dt><dd>{mins(d.gap)}</dd></div>
        <div><dt>Do Centra</dt><dd>{c ? mins(c.best) : '–'} <small>{c ? `prvi dolazak ${clock(c.first)}` : ''}</small></dd></div>
        <div><dt>Do Bolnice</dt><dd>{h ? mins(h.best) : '–'} <small>{h ? `prvi dolazak ${clock(h.first)}` : ''}</small></dd></div>
        <div><dt>Povratak iz Centra</dt><dd>{c ? `do ${clock(c.back)}` : '–'}</dd></div>
      </dl>
      {d.trips > 0 && <Hours hours={d.hours} />}
      {lines.length > 0 && <p class="badges">{lines.map((l) => <a key={l.slug} href={`/linija/${l.slug}`} aria-label={`Linija ${l.short}`}><LineBadge line={l} /></a>)}</p>}
      {s.stops.length ? (
        <details>
          <summary>{plural(s.stops.length, 'stanica', 'stanice', 'stanica')}</summary>
          <ul class="stops">{s.stops.map((x) => <li key={x.slug}><a href={`/stanica/${x.slug}`}>{x.name}</a></li>)}</ul>
        </details>
      ) : (
        <p class="muted">U naselju nema stanice. Najbliža je <a href={`/stanica/${s.nearest.slug}`}>{s.nearest.name}</a>, oko {s.nearest.m < 1000 ? `${s.nearest.m} m` : `${dec(s.nearest.m / 1000)} km`} od sredine naselja.</p>
      )}
    </article>
  );
}

/* ---------- ponuda prema broju ljudi ---------- */

function Scatter({ a, day, selected, select, tip }: View) {
  const [ref, width] = useWidth();
  const height = Math.max(260, Math.min(380, width * 0.6));
  const list = a.settlements.filter((s) => s.name !== CITY);
  const m = { l: 34, r: 14, t: 14, b: 40 };
  const maxY = Math.max(10, Math.ceil(Math.max(...list.map((s) => s.days[day]!.trips)) / 10) * 10);
  const lo = Math.log10(40);
  const hi = Math.log10(4000);
  const x = (n: number) => m.l + ((Math.log10(n) - lo) / (hi - lo)) * (width - m.l - m.r);
  const y = (n: number) => height - m.b - (n / maxY) * (height - m.t - m.b);
  const step = maxY > 30 ? 20 : maxY > 12 ? 10 : 5;
  const ticks = Array.from({ length: Math.floor(maxY / step) + 1 }, (_, i) => i * step);
  // Imenuju se samo naselja koja odskaču: puno ljudi a malo vožnji, i najviše vožnji.
  const named = new Set([
    ...[...list].filter((s) => s.pop >= 700).sort((p, q) => per1000(p, day) - per1000(q, day)).slice(0, 4).map((s) => s.id),
    ...[...list].sort((p, q) => q.days[day]!.trips - p.days[day]!.trips).slice(0, 2).map((s) => s.id),
    ...(selected ? [selected] : []),
  ]);
  const near = (e: PointerEvent | MouseEvent) => {
    const box = (e.currentTarget as SVGElement).getBoundingClientRect();
    const best = list
      .map((s) => ({ s, d: Math.hypot(x(s.pop) - (e.clientX - box.left), y(s.days[day]!.trips) - (e.clientY - box.top)) }))
      .sort((p, q) => p.d - q.d)[0];
    return best && best.d < 26 ? best.s : null;
  };
  const placed: { x1: number; x2: number; y: number }[] = [];
  return (
    <figure class="card">
      <h3>Stanovnici i vožnje</h3>
      <p class="muted">Svako naselje osim grada. Desno dolje su naselja s puno ljudi i malo vožnji.</p>
      <div ref={ref}>
        <svg
          width={width} height={height} class="plot" role="img" aria-label="Broj stanovnika i broj vožnji po naselju; iste brojke su u popisu naselja ispod"
          onPointerMove={(e) => {
            if (e.pointerType !== 'mouse') return;
            const s = near(e);
            tip(s && { x: e.clientX, y: e.clientY, title: s.name, rows: [[int(s.pop), 'stanovnika'], [String(s.days[day]!.trips), 'vožnji na dan'], [dec(per1000(s, day)), 'na 1000 stanovnika']] });
          }}
          onPointerLeave={() => tip(null)}
          onClick={(e) => { const s = near(e); if (s) select(s.id); }}
        >
          {ticks.map((t) => <g key={t}><line class="grid" x1={m.l} x2={width - m.r} y1={y(t)} y2={y(t)} /><text class="axis" x={m.l - 6} y={y(t) + 4} text-anchor="end">{t}</text></g>)}
          {[50, 100, 200, 500, 1000, 2000].map((t) => <text key={t} class="axis" x={x(t)} y={height - m.b + 18} text-anchor="middle">{int(t)}</text>)}
          <text class="axis" x={width - m.r} y={height - 4} text-anchor="end">stanovnika</text>
          <text class="axis" x={0} y={height - 4}>vožnji na dan ↑</text>
          {list.map((s) => <circle key={s.id} class={s.id === selected ? 'dot sel' : 'dot'} cx={x(s.pop)} cy={y(s.days[day]!.trips)} r={s.id === selected ? 7 : 5} />)}
          {list.filter((s) => named.has(s.id)).sort((p, q) => Number(q.id === selected) - Number(p.id === selected)).map((s) => {
            const w = s.name.length * 7;
            const left = x(s.pop) + 10 + w > width - m.r;
            const x1 = left ? x(s.pop) - 10 - w : x(s.pop) + 10;
            const yy = y(s.days[day]!.trips) + 4;
            if (placed.some((p) => Math.abs(p.y - yy) < 13 && x1 < p.x2 && x1 + w > p.x1)) return null;
            placed.push({ x1, x2: x1 + w, y: yy });
            return <text key={s.id} class="label" x={left ? x(s.pop) - 10 : x(s.pop) + 10} y={yy} text-anchor={left ? 'end' : 'start'}>{s.name}</text>;
          })}
        </svg>
      </div>
      <p class="gini"><strong>{dec(a.gini[day]!, 2)}</strong> je Ginijev koeficijent ponude izvan grada: 0 znači da svi imaju jednako vožnji, a 1 da sve ima jedno naselje.</p>
    </figure>
  );
}

function Settlements(v: View) {
  const { a, day, selected, select, tip } = v;
  const [metricId, setMetric] = useState('trips');
  const metric = METRICS.find((m) => m.id === metricId)!;
  const none = a.settlements.some((s) => metric.value(s, day) === null);
  const columns: Column<Settlement>[] = [
    { id: 'name', label: 'Naselje', text: true, asc: true, sort: (s) => s.name, cell: (s) => <button type="button" class="link" aria-pressed={s.id === selected} onClick={() => select(s.id === selected ? null : s.id)}>{s.name}</button> },
    { id: 'pop', label: 'Stanovnika', sort: (s) => s.pop, cell: (s) => int(s.pop) },
    { id: 'change', label: 'Od 1991.', sort: change, cell: (s) => signed(change(s)) },
    { id: 'density', label: 'Po km²', sort: density, cell: (s) => int(density(s)) },
    { id: 'young', label: '0–19', sort: (s) => s.young / s.pop, cell: (s) => pct(s.young / s.pop) },
    { id: 'old', label: '65+', sort: (s) => s.old / s.pop, cell: (s) => pct(s.old / s.pop) },
    { id: 'stops', label: 'Stanica', sort: (s) => s.stops.length, cell: (s) => s.stops.length },
    { id: 'trips', label: 'Vožnji', sort: (s) => s.days[day]!.trips, cell: (s) => s.days[day]!.trips },
    { id: 'per', label: 'Na 1000 st.', sort: (s) => per1000(s, day), cell: (s) => dec(per1000(s, day)) },
    { id: 'first', label: 'Prvi', asc: true, sort: (s) => s.days[day]!.first ?? 9999, cell: (s) => clock(s.days[day]!.first) },
    { id: 'last', label: 'Posljednji', sort: (s) => s.days[day]!.last ?? -1, cell: (s) => clock(s.days[day]!.last) },
    { id: 'gap', label: 'Pauza', sort: (s) => s.days[day]!.gap ?? -1, cell: (s) => mins(s.days[day]!.gap) },
    { id: 'center', label: 'Do Centra', asc: true, sort: (s) => s.center[day]?.best ?? 9999, cell: (s) => mins(s.center[day]?.best) },
    { id: 'hospital', label: 'Do Bolnice', asc: true, sort: (s) => s.hospital[day]?.best ?? 9999, cell: (s) => mins(s.hospital[day]?.best) },
    { id: 'back', label: 'Povratak', sort: (s) => s.center[day]?.back ?? -1, cell: (s) => clock(s.center[day]?.back) },
  ];
  return (
    <section id="naselja">
      <h2>Naselja</h2>
      <p class="lead">Što koje naselje dobije i koliko ljudi u njemu živi.</p>
      <div class="pair">
        <div class="card">
          <label class="field">Boja prikazuje
            <select value={metricId} onChange={(e) => setMetric(e.currentTarget.value)}>{METRICS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</select>
          </label>
          <SettlementMap
            a={a} label={`Naselja prema: ${metric.label}. Iste brojke su u popisu naselja ispod.`} selected={selected} onSelect={select} onTip={tip}
            classFor={(s) => classOf(metric.value(s, day), metric.breaks)}
            tipFor={(s) => { const n = metric.value(s, day); return [[n === null ? '–' : metric.format(n), metric.label.toLowerCase()], ...(metric.id === 'pop' ? [] : [[int(s.pop), 'stanovnika'] as [string, string]])]; }}
          />
          <Legend items={metric.legend} none={none ? metric.none : undefined} />
        </div>
        <Detail {...v} />
      </div>
      <Scatter {...v} />
      <div class="card flush">
        <h3>Sva naselja</h3>
        <SortTable caption="Sva naselja" rows={a.settlements} columns={columns} start="pop" selected={selected} />
      </div>
    </section>
  );
}

/* ---------- vrijeme ---------- */

function Times({ a, day, selected, select }: View) {
  const [mode, setMode] = useState<'naselja' | 'linije'>('naselja');
  const used = a.hours.flatMap((h) => h.flatMap((n, i) => (n ? [i] : [])));
  const reached = a.settlements.flatMap((s) => s.days.flatMap((d) => d.hours.flatMap((n, i) => (n ? [i] : []))));
  const from = Math.min(...used, ...reached);
  const to = Math.max(...used, ...reached);
  const hours = Array.from({ length: to - from + 1 }, (_, i) => from + i);
  const top = Math.max(...a.hours[day]!);
  const rows = mode === 'naselja'
    ? [...a.settlements].filter((s) => s.stops.length && s.name !== CITY).sort((p, q) => q.days[day]!.trips - p.days[day]!.trips || p.name.localeCompare(q.name, 'hr')).map((s) => ({ id: s.id, name: s.name, hours: s.days[day]!.hours, line: undefined as LineStats | undefined }))
    : a.lines.map((l) => ({ id: l.slug, name: l.short, hours: l.hours[day]!, line: l as LineStats | undefined }));
  const cls = (n: number) => (n === 0 ? '' : `c${n >= 5 ? 4 : n - 1}`);
  return (
    <section id="vrijeme">
      <h2>Vrijeme</h2>
      <p class="lead">Kada se vozi, a kada ne.</p>
      <figure class="card">
        <h3>Polasci po satu, cijela mreža</h3>
        <p class="muted">{a.labels[day]}: {trips(a.trips[day]!)}, brojano po satu u kojem vožnja kreće.</p>
        <ol class="columns" style={{ '--n': hours.length }}>
          {hours.map((h) => {
            const n = a.hours[day]![h]!;
            return <li key={h}><span class="n">{n || ''}</span><b style={{ height: `${(100 * n) / top}%` }} /><span class="h">{h}<span class="sr-only"> h{n ? '' : ', nema polazaka'}</span></span></li>;
          })}
        </ol>
      </figure>
      <div class="card flush">
        <div class="card-head">
          <h3>Vožnje po satu</h3>
          <div class="seg" role="group" aria-label="Redovi">
            <button type="button" aria-pressed={mode === 'naselja'} onClick={() => setMode('naselja')}>Naselja</button>
            <button type="button" aria-pressed={mode === 'linije'} onClick={() => setMode('linije')}>Linije</button>
          </div>
        </div>
        <Legend items={['1 vožnja', '2', '3', '4', '5 i više']} />
        <div class="scroll" role="region" aria-label="Vožnje po satu" tabIndex={0}>
          <table class="heat">
            <caption class="sr-only">Vožnje po satu</caption>
            <thead><tr><th scope="col" class="text">{mode === 'naselja' ? 'Naselje' : 'Linija'}</th>{hours.map((h) => <th key={h} scope="col">{h}</th>)}</tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} class={r.id === selected ? 'sel' : ''}>
                  <th scope="row">{r.line ? <LineBadge line={r.line} /> : <button type="button" class="link" onClick={() => select(r.id)}>{r.name}</button>}</th>
                  {hours.map((h) => <td key={h} class={cls(r.hours[h]!)} title={r.hours[h] ? `${r.name}, ${h} h: ${trips(r.hours[h]!)}` : undefined}><span>{r.hours[h] || ''}</span></td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

/* ---------- doseg ---------- */

const REACH = [30, 45, 60, 90] as const;
/** Razred 4 (najtamnije) je najbliže. */
const reachClass = (m: number) => (m === Infinity ? -1 : 4 - REACH.filter((r) => m > r).length);

function Reach({ a, day, selected, select, tip }: View) {
  const [data, setData] = useState<PlanData | null>(null);
  const [failed, setFailed] = useState(false);
  const [time, setTime] = useState(7 * 60);
  useEffect(() => { getJson<PlanData>('/data/planer.json').then(setData, () => setFailed(true)); }, []);
  const engine = useMemo(() => data && createReach(data), [data]);
  const origin = a.settlements.find((s) => s.id === selected)
    ?? [...a.settlements].filter((s) => s.name !== CITY && s.stops.length).sort((p, q) => q.pop - p.pop)[0]!;
  /** Naselje -> minute od odabranog trenutka, s čekanjem. */
  const times = useMemo(() => {
    if (!engine) return null;
    const arrived = engine.earliest(day, new Map(origin.access), time);
    return new Map(a.settlements.map((s) => [s.id, s.id === origin.id ? 0 : arrivalAt(arrived, new Map(s.access)) - time]));
  }, [engine, origin, day, time, a]);
  const within = (m: number) => a.settlements.filter((s) => s.id !== origin.id && times && times.get(s.id)! <= m);
  const next = engine && times ? engine.events(day, new Map(origin.access)).find((t) => t >= time) : undefined;
  const sorted = times ? [...a.settlements].filter((s) => s.id !== origin.id).sort((p, q) => times.get(p.id)! - times.get(q.id)! || p.name.localeCompare(q.name, 'hr')) : [];
  const unreachable = times ? a.settlements.filter((s) => times.get(s.id) === Infinity) : [];
  return (
    <section id="doseg">
      <h2>Doseg</h2>
      <p class="lead">Kamo se stiže ako se krene u zadano vrijeme. Računa se čekanje, presjedanje i hod.</p>
      <div class="card">
        <div class="controls">
          <label class="field">Iz naselja
            <select value={origin.id} onChange={(e) => select(e.currentTarget.value)}>{a.settlements.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
          </label>
          <label class="field grow">Kreni u <output>{hhmm(time)}</output>
            <input type="range" min={5 * 60} max={21 * 60} step={15} value={time} aria-valuetext={hhmm(time)} onInput={(e) => setTime(Number(e.currentTarget.value))} />
          </label>
        </div>
        {failed ? <p role="alert">Podaci se nisu učitali. Provjeri vezu i osvježi stranicu.</p> : (
          <>
            <div class="tiles" aria-live="polite">
              {REACH.map((m) => {
                const list = within(m);
                return <Tile key={m} label={`do ${m} min`} value={times ? plural(list.length, 'naselje', 'naselja', 'naselja') : '…'} note={times ? `${int(list.reduce((n, s) => n + s.pop, 0))} stanovnika` : ' '} />;
              })}
            </div>
            <p class="next muted">{!times ? '…' : next === undefined ? 'Odavde toga dana više nema polazaka.' : next === time ? 'Polazak je odmah.' : `Prvi polazak nakon toga je u ${hhmm(next)}; čekanje se računa u putovanje.`}</p>
            <div class="reach">
            <div>
            <SettlementMap
              a={a} label={`Vrijeme putovanja iz naselja ${origin.name} u ${hhmm(time)}`} selected={origin.id} onSelect={select} onTip={tip}
              classFor={(s) => (times ? (s.id === origin.id ? 4 : reachClass(times.get(s.id)!)) : -1)}
              tipFor={(s) => { const t = times?.get(s.id); return [[t === undefined ? '…' : t === Infinity ? 'ne stiže se' : s.id === origin.id ? 'polazište' : mins(t), t && t !== Infinity ? `dolazak u ${hhmm(time + t)}` : '']]; }}
            />
            <Legend items={['do 30 min', '31–45', '46–60', '61–90', 'više od 90']} none="toga dana se više ne stiže" reverse />
            </div>
            {times && (
              <div class="reach-side">
                <h3>Od najbližeg</h3>
                <ol class="reach-list" tabIndex={0} aria-label="Naselja po vremenu putovanja">
                  {sorted.map((s) => <li key={s.id}><span>{s.name}</span><b>{times.get(s.id) === Infinity ? '–' : mins(times.get(s.id))}</b></li>)}
                </ol>
                {unreachable.length > 0 && <p class="muted">Ne stiže se u {plural(unreachable.length, 'naselje', 'naselja', 'naselja')}.</p>}
              </div>
            )}
            </div>
          </>
        )}
      </div>
    </section>
  );
}

/* ---------- linije ---------- */

function Lines({ a, day }: View) {
  const top = Math.max(...a.lines.map((l) => l.vkm[day]!));
  const rows = a.lines.map((l) => ({ ...l, id: l.slug }));
  const columns: Column<(typeof rows)[number]>[] = [
    { id: 'line', label: 'Linija', text: true, asc: true, sort: (l) => parseInt(l.short, 10) + (l.short.charCodeAt(l.short.length - 1) % 64) / 100, cell: (l) => <a href={`/linija/${l.slug}`} aria-label={`Linija ${l.short}`}><LineBadge line={l} /></a> },
    { id: 'trips', label: 'Vožnji', sort: (l) => l.trips[day]!, cell: (l) => l.trips[day] },
    { id: 'vkm', label: 'Km na dan', sort: (l) => l.vkm[day]!, cell: (l) => <span class="bar"><i style={{ width: `${top ? (100 * l.vkm[day]!) / top : 0}%` }} /><b>{int(l.vkm[day]!)}</b></span> },
    { id: 'km', label: 'Dužina', sort: (l) => l.km, cell: (l) => `${dec(l.km)} km` },
    { id: 'speed', label: 'Brzina', sort: (l) => l.speed, cell: (l) => `${dec(l.speed, 0)} km/h` },
    { id: 'stops', label: 'Stanica', sort: (l) => l.stops, cell: (l) => l.stops },
    { id: 'people', label: 'Ljudi uz liniju', sort: (l) => l.people, cell: (l) => int(l.people) },
    { id: 'shared', label: 'Dijeli trasu', sort: (l) => l.shared, cell: (l) => pct(l.shared) },
    { id: 'long', label: 'Relacija', text: true, asc: true, sort: (l) => l.long, cell: (l) => l.long },
  ];
  return (
    <section id="linije">
      <h2>Linije</h2>
      <p class="lead">Koliko koja linija radi i koliko toga dijeli s drugima.</p>
      <div class="tiles">
        <Tile label="Vožnji" value={int(a.trips[day]!)} note={a.labels[day]} />
        <Tile label="Kilometara" value={int(a.vkm[day]!)} note="svi autobusi zajedno" />
        <Tile label="Linija koje voze" value={`${a.lines.filter((l) => l.trips[day]).length} od ${a.lines.length}`} note={a.labels[day]} />
      </div>
      <div class="card flush">
        <SortTable caption="Linije" rows={rows} columns={columns} start="vkm" />
      </div>
      <p class="muted">Ljudi uz liniju su stanovnici naselja u kojima linija staje, bez samog grada. Dijeli trasu: koliko njezinih dionica vozi još neka linija.</p>
    </section>
  );
}

/* ---------- sve ---------- */

export default function Analiza() {
  const [a, setData] = useState<Analysis | null>(null);
  const [failed, setFailed] = useState(false);
  const [day, setDay] = useState(0);
  const [selected, select] = useState<string | null>(null);
  const [tip, setTip] = useState<Tip | null>(null);
  useEffect(() => {
    getJson<Analysis>('/data/analiza.json').then(setData, () => setFailed(true));
    const hide = () => setTip(null);
    addEventListener('scroll', hide, { passive: true });
    return () => removeEventListener('scroll', hide);
  }, []);
  if (failed) return <p class="wrap" role="alert">Podaci se nisu učitali. Provjeri vezu i osvježi stranicu.</p>;
  if (!a) return <p class="wrap muted loading">Učitavam…</p>;
  const view: View = { a, day, selected, select, tip: setTip };
  return (
    <>
      <div class="filters">
        <div class="wrap">
          <div class="seg" role="group" aria-label="Vrsta dana">
            {a.labels.map((l, i) => <button type="button" key={l} aria-pressed={day === i} onClick={() => setDay(i)}>{l}</button>)}
          </div>
          <select aria-label="Naselje" value={selected ?? ''} onChange={(e) => select(e.currentTarget.value || null)}>
            <option value="">Sva naselja</option>
            {a.settlements.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
      </div>
      <div class="wrap chapters">
        <Settlements {...view} />
        <Times {...view} />
        <Vikend a={a} selected={selected} select={select} tip={setTip} />
        <Reach {...view} />
        <Lines {...view} />
      </div>
      <TipBox tip={tip} />
    </>
  );
}
