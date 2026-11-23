import { useEffect, useState } from 'preact/hooks';
import { getJson } from '../lib/client';
import type { PlanData } from '../lib/planner';
import { hhmm } from '../lib/time';
import type { SearchIndex } from '../lib/types';
import { sheets, type Sheet } from './sheet';
import { baseFrom, STEPS, type Weekend } from './vikend';

/** Koliko vožnji stane u širinu stranice; ostatak ide u blok ispod. */
const COLUMNS = 18;
const NARROW = 6;
const ALL = (1 << STEPS) - 1;

const time = (m: number) => hhmm(m).replace(/^0/, '');
const date = (iso: string) => iso.split('-').reverse().map((x) => `${Number(x)}.`).join(' ');

function Table({ s, name, label, columns }: { s: Sheet; name: (slug: string) => string; label: string; columns: number }) {
  const blocks = [];
  for (let k = 0; k < s.columns.length; k += columns) blocks.push(s.columns.slice(k, k + columns));
  return (
    <div class="dir">
      <h3>{name(s.from)} <span aria-hidden="true">→</span><span class="sr-only"> do </span> {name(s.to)}</h3>
      {blocks.map((cols, n) => (
        <div class="scroll" role="region" tabIndex={0} key={n} aria-label={`${label}, ${name(s.from)} – ${name(s.to)}`}>
          <table>
            <thead>
              <tr>
                <th scope="col"><span class="sr-only">Stanica</span></th>
                {Array.from({ length: columns }, (_, k) => {
                  const c = cols[k];
                  return c ? <th key={k} scope="col">{c.mark === 'joined' ? `+${c.with}` : c.mark ? 'novo' : <span class="sr-only">vožnja</span>}</th> : <td key={k} />;
                })}
              </tr>
            </thead>
            <tbody>
              {s.rows.map((slug, i) => (
                <tr key={i} class={slug === s.from || slug === s.to ? 'end' : ''}>
                  <th scope="row">{name(slug)}</th>
                  {Array.from({ length: columns }, (_, k) => {
                    const c = cols[k];
                    const m = c?.times[i];
                    return <td key={k} class={c?.mark ? 'changed' : ''}>{c && (m == null ? '·' : time(m))}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
      {s.gone.length > 0 && <p class="variant">Otpada: <s>{s.gone.map(time).join(', ')}</s></p>}
    </div>
  );
}

interface Loaded { plan: PlanData; index: SearchIndex; w: Weekend }

/** Vozni red linije s prijedlogom za vikende i praznike; linija i koraci su u adresi. */
export default function LinePdf() {
  const [d, setD] = useState<Loaded | null>(null);
  const [failed, setFailed] = useState(false);
  const [line, setLine] = useState('');
  const [mask, setMask] = useState(ALL);
  useEffect(() => {
    const q = new URLSearchParams(location.search);
    const m = Number(q.get('koraci') ?? ALL);
    setMask(Number.isInteger(m) && m >= 0 && m <= ALL ? m : ALL);
    Promise.all([getJson<PlanData>('/data/planer.json'), getJson<SearchIndex>('/data/index.json'), getJson<Weekend>('/data/prijedlog.json')]).then(([plan, index, w]) => {
      const wanted = q.get('linija');
      setLine(index.lines.find((l) => l.slug === wanted)?.slug ?? index.lines[0]!.slug);
      setD({ plan, index, w });
    }, () => setFailed(true));
  }, []);
  const l = d?.index.lines.find((x) => x.slug === line);
  useEffect(() => {
    if (!l) return;
    document.title = `Linija ${l.short} – prijedlog za vikende i praznike`;
    history.replaceState(history.state, '', `${location.pathname}?linija=${l.slug}&koraci=${mask}`);
  }, [l, mask]);
  if (failed) return <p class="bar" role="alert">Podaci se nisu učitali. Provjeri vezu i osvježi stranicu.</p>;
  if (!d || !l) return <p class="bar">Učitavam…</p>;

  const { plan, index, w } = d;
  const b = baseFrom(plan, index);
  const ops = w.days.flatMap((x) => x.ops).filter((o) => mask & (1 << o.step));
  const names = new Map(index.stops.map((s) => [s.slug, s.name]));
  const name = (slug: string) => names.get(slug) ?? slug;
  const touches = (short: string) => w.days.flatMap((x) => x.ops).some((o) => [o.move, ...(o.remove ?? []), ...(o.add ?? []), o.join?.first, o.join && { line: o.join.line }].some((r) => r?.line === short));
  const days = w.labels.map((label, svc) => {
    const list = sheets(b, ops, l.short, svc);
    return { label, svc, list, changed: list.some((s) => s.gone.length || s.columns.some((c) => c.mark)), narrow: list.length > 1 && list.every((s) => s.columns.length <= NARROW) };
  });
  const running = days.filter((x) => x.list.length);
  const idle = days.filter((x) => !x.list.length).map((x) => x.label.toLowerCase());
  return (
    <div style={{ '--c': l.color, '--t': l.text }}>
      <div class="bar">
        <a href="/analiza#vikend">← Vikend i praznici</a>
        <label>Linija{' '}
          <select value={line} onChange={(e) => setLine(e.currentTarget.value)}>
            {index.lines.map((x) => <option key={x.slug} value={x.slug}>{x.short}{touches(x.short) ? ' (mijenja se)' : ''}</option>)}
          </select>
        </label>
        <button type="button" onClick={() => print()}>Spremi kao PDF</button>
        <p>U prozoru za ispis pod Odredište odaberi spremanje u PDF. Žuto je novo ili promijenjeno.</p>
      </div>
      <main class="sheet">
        <header class="head">
          <div><h1>Linija {l.short} – prijedlog</h1><p>{l.long}</p></div>
          <span class="no notranslate">{l.short}</span>
        </header>
        <p class="warning">Prijedlog za vikende i praznike, nije stvarni vozni red.</p>
        {running.map(({ label, svc, list, changed, narrow }) => (
          <section class={narrow ? 'day narrow' : 'day'} key={svc}>
            <div class="day-head">
              <div><h2>{label}</h2><p>{changed ? 'S izmjenama iz prijedloga' : 'Bez promjena'}</p></div>
              <span class="no notranslate">{l.short}</span>
            </div>
            {list.map((s) => <Table key={s.dir} s={s} name={name} label={label} columns={narrow ? NARROW : COLUMNS} />)}
          </section>
        ))}
        <footer>
          {idle.length > 0 && <p>Ne vozi: {idle.join(', ')}.</p>}
          <p>· vožnja tu ne staje. <b>novo</b>: nov ili pomaknut polazak. <b>+7</b>: isti autobus vozi i kao linija 7, bez presjedanja.</p>
          <p>Složeno prema voznom redu koji vrijedi od {date(w.valid[0])} do {date(w.valid[1])} Nije službeni dokument prijevoznika.</p>
        </footer>
      </main>
    </div>
  );
}
