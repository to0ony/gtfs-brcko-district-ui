import { useEffect, useState } from 'preact/hooks';
import { getJson } from '../lib/client';
import { plural } from '../lib/text';
import { hhmm } from '../lib/time';
import { CITY, type Analysis } from './compute';
import { dec, int } from './format';
import { Legend, SettlementMap, SortTable, type Column, type Tip } from './parts';
import type { Op, Outcome, Weekend, WeekendDay } from './vikend';

interface Props { a: Analysis; selected: string | null; select: (id: string | null) => void; tip: (t: Tip | null) => void }

const minutes = (n: number) => `${Math.round(n)} min`;
const signedMin = (n: number) => (Math.abs(n) < 0.5 ? '0 min' : `${n > 0 ? '+' : '−'}${Math.round(Math.abs(n))} min`);
/** 0 puno duže ... 2 isto ... 4 puno kraće. */
const diffClass = (d: number) => (d >= 8 ? 0 : d >= 1.5 ? 1 : d > -1.5 ? 2 : d > -8 ? 3 : 4);

function Badge({ a, short }: { a: Analysis; short: string }) {
  const l = a.lines.find((x) => x.short === short);
  return <span class="badge notranslate" style={l && { background: l.color, color: l.text }}>{short}</span>;
}

function Describe({ a, op, names }: { a: Analysis; op: Op; names: Map<string, string> }) {
  if (op.move) return <><Badge a={a} short={op.move.line} /> polazak <s>{hhmm(op.move.at)}</s> → <b>{hhmm(op.move.to)}</b></>;
  if (op.join) {
    const j = op.join;
    return (
      <>
        <Badge a={a} short={j.first.line} /> {hhmm(j.first.at)} od stanice {names.get(j.cut) ?? j.cut} nastavlja kao <Badge a={a} short={j.line} /> <b>{hhmm(j.at)}</b>,
        natrag <Badge a={a} short={j.line} /> <b>{hhmm(j.back)}</b> pa <Badge a={a} short={j.then.line} /> {hhmm(j.then.at)}
      </>
    );
  }
  const add = op.add ?? [];
  const tail = add[0]?.cut;
  const times = <b>{add.map((n) => hhmm(n.at)).join(' i ')}</b>;
  if (op.remove?.length) return <><Badge a={a} short={op.remove[0]!.line} /> <s>{op.remove.map((r) => hhmm(r.at)).join(' i ')}</s> → <Badge a={a} short={add[0]!.line} /> {times}</>;
  return <><Badge a={a} short={add[0]!.line} /> nova vožnja {add.length > 1 ? 'tamo i natrag' : ''} {times}{tail ? `, od stanice ${names.get(tail) ?? tail}` : ''}</>;
}

function Compare({ label, was, now, format, less, weekday, note }: { label: string; was: number; now: number; format: (n: number) => string; less: boolean | null; weekday: number; note?: string }) {
  const same = format(was) === format(now);
  const good = less ? now < was : now > was;
  return (
    <div class="tile">
      <span class="tile-label">{label}</span>
      <strong>{format(now)}</strong>
      <span class="tile-note">
        {same ? 'bez promjene' : <>{less !== null && <b class={good ? 'good' : 'bad'}>{good ? '▲ bolje' : '▼ lošije'}</b>} bilo {format(was)}</>}
        <br />radnim danom {format(weekday)}{note && <><br />{note}</>}
      </span>
    </div>
  );
}

const TITLES = ['Pomakni polaske', 'Nadoveži čestu liniju na rijetku', 'Dio polazaka česte linije vozi kao rijetka', 'Dodaj nekoliko vožnji'];
const WHY = [
  'Iste vožnje, samo u bolje vrijeme.',
  'Autobus česte linije umjesto da stoji na okretištu ode dalje kao rijetka linija, i vrati se na svoj sljedeći polazak. Bez presjedanja.',
  'Odlazak i povratak česte linije zamijeni odlazak i povratak rijetke koja dijeli dio puta, u podjednako vrijeme.',
  'Gdje zamjene ne pomažu, isti autobusi odvezu još pokoju vožnju.',
];

function Solution({ a, w, day, selected, select, tip }: Props & { w: Weekend; day: WeekendDay }) {
  const [on, setOn] = useState(TITLES.map(() => true));
  const [open, setOpen] = useState(false);
  const mask = on.reduce((m, x, i) => m | (x ? 1 << i : 0), 0);
  const was = day.outcomes[0]!;
  const now = day.outcomes[mask]!;
  const names = new Map(a.settlements.flatMap((s) => s.stops.map((x): [string, string] => [x.slug, x.name])));
  const rows = a.settlements.map((s, i) => ({ id: s.id, s, was: was.avg[i]!, now: now.avg[i]!, diff: now.avg[i]! - was.avg[i]! })).filter((r) => r.s.name !== CITY);
  const better = rows.filter((r) => r.diff <= -1.5).sort((x, y) => x.diff - y.diff);
  const worse = rows.filter((r) => r.diff >= 1.5).sort((x, y) => y.diff - x.diff);
  const people = (list: typeof rows) => int(list.reduce((n, r) => n + r.s.pop, 0));
  const columns: Column<(typeof rows)[number]>[] = [
    { id: 'name', label: 'Naselje', text: true, asc: true, sort: (r) => r.s.name, cell: (r) => <button type="button" class="link" aria-pressed={r.id === selected} onClick={() => select(r.id === selected ? null : r.id)}>{r.s.name}</button> },
    { id: 'diff', label: 'Razlika', asc: true, sort: (r) => r.diff, cell: (r) => <b>{signedMin(r.diff)}</b> },
    { id: 'was', label: 'Bilo', sort: (r) => r.was, cell: (r) => minutes(r.was) },
    { id: 'now', label: 'Prijedlog', sort: (r) => r.now, cell: (r) => minutes(r.now) },
    { id: 'pop', label: 'Stanovnika', sort: (r) => r.s.pop, cell: (r) => int(r.s.pop) },
  ];
  const cost = (i: number) => day.outcomes[1 << i]!.hours - was.hours;
  const o = (f: (x: Outcome) => number) => ({ was: f(was), now: f(now), weekday: f(w.weekday) });
  return (
    <>
      <div class="steps">
        {TITLES.map((title, i) => {
          const ops = day.ops.filter((x) => x.step === i);
          return (
            <div class={`card step${on[i] ? '' : ' off'}`} key={title}>
              <label class="check"><input type="checkbox" checked={on[i]} disabled={!ops.length} onChange={() => setOn(on.map((x, k) => (k === i ? !x : x)))} /> <b>{i + 1}. {title}</b></label>
              <p class="muted">{WHY[i]} <b>{Math.abs(cost(i)) < 0.05 ? 'Bez dodatnih sati.' : `${cost(i) > 0 ? '+' : '−'}${dec(Math.abs(cost(i)))} sati vožnje na dan.`}</b></p>
              {ops.length ? <ul class="ops">{ops.map((op, k) => <li key={k}><Describe a={a} op={op} names={names} /></li>)}</ul> : <p class="muted">Za ove dane nije nađeno ništa korisno.</p>}
            </div>
          );
        })}
      </div>
      <div class="tiles" aria-live="polite">
        <Compare label="Prosječan put do Centra" {...o((x) => x.mean)} format={minutes} less note="s čekanjem, u jednom smjeru" />
        <Compare label={`Povratak nakon ${hhmm(w.back)}`} {...o((x) => x.evening)} format={int} less={false} note={`od ${int(w.people)} ljudi`} />
        <Compare label={`U Centru do ${hhmm(w.by)}`} {...o((x) => x.morning)} format={int} less={false} note="ljudi" />
        <Compare label="Sati vožnje" {...o((x) => x.hours)} format={(n) => dec(n)} less={null} />
        <Compare label="Vožnji" {...o((x) => x.trips)} format={int} less={null} />
        <Compare label="Autobusa istodobno" {...o((x) => x.buses)} format={int} less={null} />
      </div>
      <div class="pair">
        <div class="card diverging">
          <h3>Tko dobiva, a tko gubi</h3>
          <SettlementMap
            a={a} label="Promjena prosječnog puta po naselju; iste brojke su u popisu ispod" selected={selected} onSelect={select} onTip={tip}
            classFor={(s) => { const r = rows.find((x) => x.id === s.id); return r ? diffClass(r.diff) : 2; }}
            tipFor={(s) => { const r = rows.find((x) => x.id === s.id); return r ? [[signedMin(r.diff), 'razlika'], [minutes(r.now), `umjesto ${minutes(r.was)}`]] : [['–', 'odredište']]; }}
          />
          <Legend items={['8+ min duže', '2–8 min duže', 'isto', '2–8 min kraće', '8+ min kraće']} />
        </div>
        <div class="card">
          <p class="big"><b class="good">▲ {plural(better.length, 'naselje dobiva', 'naselja dobivaju', 'naselja dobiva')}</b><span>{people(better)} ljudi</span></p>
          <ul class="names">{better.slice(0, 8).map((r) => <li key={r.id}><span>{r.s.name}</span><b>{signedMin(r.diff)}</b></li>)}</ul>
          <p class="big"><b class="bad">▼ {plural(worse.length, 'naselje gubi', 'naselja gube', 'naselja gubi')}</b><span>{people(worse)} ljudi</span></p>
          <ul class="names">{worse.slice(0, 5).map((r) => <li key={r.id}><span>{r.s.name}</span><b>{signedMin(r.diff)}</b></li>)}</ul>
          <p class="muted small">Dobiva ili gubi: prosjek se promijeni za bar 2 min.</p>
        </div>
      </div>
      <div class="card">
        <h3>Polasci prije i poslije</h3>
        <p class="muted small">Istaknuti su novi polasci, uokvireni se produžuju na drugu liniju, precrtani otpadaju. PDF je vozni red cijele linije s uključenim izmjenama.</p>
        <ul class="before">
          {day.lines.map((l) => {
            const list = l.list.filter((x) => x.state !== 'new' || on[x.step!]).map((x) => ({ ...x, state: (x.state === 'gone' || x.state === 'joined') && !on[x.step!] ? 'same' as const : x.state }));
            const slug = a.lines.find((x) => x.short === l.line)?.slug;
            return list.length > 0 && (
              <li key={`${l.line}${l.dir}`}>
                <span class="who"><Badge a={a} short={l.line} /> smjer {l.label}</span>
                <span class="when">
                  {list.map((x, k) => <span key={k} class={`dep ${x.state}`}>{hhmm(x.at)}{x.with && x.state !== 'same' && <small>{x.state === 'joined' ? ` +${x.with}` : ` kao ${x.with}`}</small>}{x.state !== 'same' && <span class="sr-only">{x.state === 'new' ? ', novo' : x.state === 'joined' ? ', produženo' : ', otpada'}</span>}</span>)}
                </span>
                <a class="pdf" href={`/analiza/pdf?linija=${slug}&koraci=${mask}`}>PDF<span class="sr-only">: linija {l.line} s izmjenama</span></a>
              </li>
            );
          })}
        </ul>
      </div>
      {/* Tablica nastaje tek kad se otvori: Edge ne crta redove presložene u zatvorenom <details>. */}
      <details class="card flush fold" onToggle={(e) => setOpen(e.currentTarget.open)}>
        <summary>Sva naselja, prije i poslije</summary>
        {open && <SortTable caption="Naselja prije i poslije" rows={rows} columns={columns} start="diff" selected={selected} />}
      </details>
    </>
  );
}

/** Problem vikenda i praznika, i gotov prijedlog u tri koraka. */
export default function Vikend(props: Props) {
  const [w, setW] = useState<Weekend | null>(null);
  const [failed, setFailed] = useState(false);
  const [pick, setPick] = useState(0);
  useEffect(() => { getJson<Weekend>('/data/prijedlog.json').then(setW, () => setFailed(true)); }, []);
  const day = w?.days[pick];
  const free = w ? w.days.reduce((n, d) => n + w.daysPerYear[d.svc]!, 0) : 0;
  return (
    <section id="vikend">
      <h2>Vikend i praznici</h2>
      {failed && <p role="alert">Podaci se nisu učitali. Provjeri vezu i osvježi stranicu.</p>}
      {!w || !day ? !failed && <p class="muted">Učitavam…</p> : (
        <>
          <p class="lead">Vikendi, praznici i dani bez škole su {free} dana u godini. Tada većina linija vozi jednom ujutro i jednom popodne. Ovo je prijedlog s istim autobusima, u kojem nijedno naselje ne gubi više od 5 minuta.</p>
          {w.stale && <p class="card">Vozni red se u međuvremenu promijenio, pa dio prijedloga više ne vrijedi.</p>}
          <div class="seg" role="group" aria-label="Dani prijedloga">
            {w.days.map((d, i) => <button type="button" key={d.svc} aria-pressed={i === pick} onClick={() => setPick(i)}>{d.label}</button>)}
          </div>
          <Solution key={day.svc} {...props} w={w} day={day} />
          <p class="muted small">Ne zna se ima li vozača, gdje su vozila na početku vožnje ni što je ugovoreno za škole. Broj autobusa i sati je donja granica, bez praznih vožnji.</p>
        </>
      )}
    </section>
  );
}
