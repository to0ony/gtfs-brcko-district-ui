import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { calendar, getJson, locate, useNow } from '../lib/client';
import { createPlanner, RULES, type Journey, type Leg, type PlanData, type RideLeg } from '../lib/planner';
import { plural, poleHash, poleName } from '../lib/text';
import { activeServices, addDays, hhmm, weekdayOf } from '../lib/time';
import type { SearchIndex } from '../lib/types';
import { Badge } from './Badge';
import StopInput, { type Place } from './StopInput';

type Mode = 'now' | 'depart' | 'arrive';

const DAY = 1440;
/** Presjedanje s manje vremena od ovoga označava se kao tijesno. */
const TIGHT = 5;
const WEEKDAYS = ['nedjelja', 'ponedjeljak', 'utorak', 'srijeda', 'četvrtak', 'petak', 'subota'];

const duration = (m: number) => (m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}`);
const parseTime = (s: string) => { const [h, m] = s.split(':').map(Number); return h! * 60 + m!; };

function dayLabel(date: string, today: string) {
  if (date === today) return 'danas';
  if (date === addDays(today, 1)) return 'sutra';
  const [, m, d] = date.split('-').map(Number);
  return `${WEEKDAYS[weekdayOf(date)]} ${d}. ${m}.`;
}

interface Ctx { data: PlanData; index: SearchIndex }

function poleInfo({ data, index }: Ctx, pole: number) {
  const [s, p] = data.poles[pole]!;
  const stop = index.stops[s]!;
  const many = stop.poles.length > 1;
  return {
    name: stop.name,
    side: many ? poleName(p).toLowerCase() : '',
    href: `/stanica/${stop.slug}${many ? poleHash(stop.poles[p]!.id) : ''}`,
    stop: s,
  };
}

function WalkIcon() {
  return (
    <svg class="walk-icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <circle cx="13" cy="4" r="1.6" fill="currentColor" /><path d="M9 21l2.5-6L9 12l1-5 3 1 2 3 3 1M14 21l-1.5-5" />
    </svg>
  );
}

function Stop({ ctx, pole, at }: { ctx: Ctx; pole: number; at: number }) {
  const p = poleInfo(ctx, pole);
  return (
    <div class="leg-stop">
      <span class="leg-time">{hhmm(at)}</span>
      <span><a href={p.href}>{p.name}</a>{p.side && <span class="muted"> {p.side}</span>}</span>
    </div>
  );
}

function Ride({ ctx, leg }: { ctx: Ctx; leg: RideLeg }) {
  const line = ctx.index.lines[leg.line]!;
  const n = leg.stops.length - 1;
  return (
    <li class="leg ride" style={{ '--c': line.color }}>
      <Stop ctx={ctx} pole={leg.from} at={leg.dep} />
      <div class="leg-line">
        <a href={`/linija/${line.slug}#smjer-${leg.dir}`} aria-label={`Linija ${line.short}`}><Badge line={line} /></a>
        <span>smjer {leg.headsign} <span class="leg-info muted">{plural(n, 'stanica', 'stanice', 'stanica')}, {duration(leg.arr - leg.dep)}</span></span>
      </div>
      <Stop ctx={ctx} pole={leg.to} at={leg.arr} />
    </li>
  );
}

function Between({ ctx, before, walk, after }: { ctx: Ctx; before?: RideLeg; walk?: Extract<Leg, { kind: 'walk' }>; after?: RideLeg }) {
  const wait = before && after ? after.dep - (walk?.arr ?? before.arr) : null;
  const target = walk && poleInfo(ctx, walk.to);
  const sameStop = walk && before && poleInfo(ctx, before.to).stop === target!.stop;
  return (
    <li class="leg between">
      {walk && (
        <p><WalkIcon /> Hodaj {duration(walk.arr - walk.dep)} {sameStop ? `na ${target!.side}` : `do ${after ? 'stanice' : 'odredišta'} ${target!.name}${target!.side ? `, ${target!.side}` : ''}`}</p>
      )}
      {wait !== null && (
        <p>{walk ? 'Zatim čekaš' : 'Presjedanje na istom mjestu, čekaš'} {duration(wait)} {wait < TIGHT && <span class="tag">tijesno</span>}</p>
      )}
    </li>
  );
}

function Legs({ ctx, journey }: { ctx: Ctx; journey: Journey }) {
  const out = [];
  const { legs } = journey;
  for (let i = 0; i < legs.length; i++) {
    const leg = legs[i]!;
    if (leg.kind === 'ride') {
      const prev = legs[i - 1];
      if (prev?.kind === 'ride') out.push(<Between key={`b${i}`} ctx={ctx} before={prev} after={leg} />);
      out.push(<Ride key={i} ctx={ctx} leg={leg} />);
    } else {
      const before = legs[i - 1];
      const after = legs[i + 1];
      out.push(<Between key={i} ctx={ctx} before={before as RideLeg | undefined} walk={leg} after={after as RideLeg | undefined} />);
    }
  }
  return <ol class="legs">{out}</ol>;
}

function RouteMap({ ctx, journey, from }: { ctx: Ctx; journey: Journey; from: Place }) {
  const [shown, setShown] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!shown || !box.current) return;
    const el = box.current;
    Promise.all([import('../lib/map'), import('../lib/journey-map')])
      .then(async ([{ mountMap }, { journeyGeo }]) => mountMap(el, await journeyGeo(journey, ctx.data, ctx.index, from.kind === 'here' ? [from.lon, from.lat] : null)))
      .catch((e) => { console.error(e); el.textContent = 'Karta se nije učitala.'; });
  }, [shown]);
  if (!shown) return <button type="button" class="button" onClick={() => setShown(true)}>Prikaži na karti</button>;
  return <div ref={box} class="map journey-map" role="region" aria-label="Karta puta"><p class="map-note">Karta se učitava…</p></div>;
}

function Card({ ctx, journey, date, today, nowMinutes, from, open }: { ctx: Ctx; journey: Journey; date: string; today: string; nowMinutes: number; from: Place; open: boolean }) {
  const { dep, arr, rides, legs } = journey;
  const depDate = addDays(date, Math.floor(dep / DAY));
  const until = depDate === today ? ((dep % DAY) + DAY) % DAY - nowMinutes : Infinity;
  return (
    <li class="journey">
      <details open={open}>
        <summary>
          <span class="journey-main">
            <span class="journey-times">{hhmm(dep)} <span aria-label="do">–</span> {hhmm(arr)}</span>
            <span class="journey-total">{duration(arr - dep)}</span>
          </span>
          <span class="journey-chain">
            {legs.map((l, i) =>
              l.kind === 'ride'
                ? <Badge key={i} line={ctx.index.lines[l.line]!} />
                : <span key={i} class="journey-walk"><WalkIcon />{l.arr - l.dep} min<span class="sr-only"> hoda</span></span>)}
          </span>
          <span class="journey-meta">
            {depDate !== today && <span class="tag">{dayLabel(depDate, today)}</span>}
            {until >= 0 && until < 60 && <span class="tag">{until === 0 ? 'kreni sada' : `kreni za ${until} min`}</span>}
            <span class="muted">{rides === 1 ? 'bez presjedanja' : plural(rides - 1, 'presjedanje', 'presjedanja', 'presjedanja')}</span>
          </span>
        </summary>
        <div class="journey-body">
          <Legs ctx={ctx} journey={journey} />
          <RouteMap ctx={ctx} journey={journey} from={from} />
        </div>
      </details>
    </li>
  );
}

export default function Planner({ stops }: { stops: { slug: string; name: string }[] }) {
  const now = useNow();
  const [ctx, setCtx] = useState<Ctx | null>(null);
  const [failed, setFailed] = useState(false);
  const [from, setFrom] = useState<Place | null>(null);
  const [to, setTo] = useState<Place | null>(null);
  const [mode, setMode] = useState<Mode>('now');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [ready, setReady] = useState(false);
  const [hereError, setHereError] = useState('');

  const load = () => {
    setFailed(false);
    Promise.all([getJson<PlanData>('/data/planer.json'), getJson<SearchIndex>('/data/index.json')]).then(
      ([data, index]) => setCtx({ data, index }),
      () => setFailed(true),
    );
  };

  // Upit je u adresi, pa se poveznica može podijeliti.
  useEffect(() => {
    load();
    const q = new URLSearchParams(location.search);
    const stop = (v: string | null): Place | null => (v && stops.some((s) => s.slug === v) ? { kind: 'stop', slug: v } : null);
    setFrom(stop(q.get('od')));
    setTo(stop(q.get('do')));
    if (q.get('od') === 'lokacija') locate().then(([lat, lon]) => setFrom({ kind: 'here', lat, lon }), (e: Error) => setHereError(e.message));
    const dan = q.get('dan') ?? '';
    const u = q.get('u') ?? '';
    if (/^\d{4}-\d\d-\d\d$/.test(dan) && !Number.isNaN(Date.parse(dan)) && /^([01]\d|2[0-3]):[0-5]\d$/.test(u)) {
      setMode(q.get('nacin') === 'stigni' ? 'arrive' : 'depart');
      setDate(dan);
      setTime(u);
    }
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    const q = new URLSearchParams();
    if (from) q.set('od', from.kind === 'here' ? 'lokacija' : from.slug);
    if (to?.kind === 'stop') q.set('do', to.slug);
    if (mode !== 'now' && date && time) {
      q.set('dan', date);
      q.set('u', time);
      if (mode === 'arrive') q.set('nacin', 'stigni');
    }
    const s = q.toString();
    history.replaceState(history.state, '', s ? `?${s}` : location.pathname);
  }, [ready, from, to, mode, date, time]);

  const planner = useMemo(() => ctx && createPlanner(ctx.data, calendar), [ctx]);
  const day = mode === 'now' || !date ? now?.date : date;
  const minutes = mode === 'now' || !time ? now?.minutes : parseTime(time);

  // Trenutak "sada" utječe na rezultat samo u načinima koji ovise o njemu.
  const notBefore = mode === 'arrive' && now && day === now.date ? now.minutes : undefined;
  const result = useMemo(() => {
    if (!planner || !ctx || !from || to?.kind !== 'stop' || day === undefined || minutes === undefined) return null;
    const target = ctx.index.stops.findIndex((s) => s.slug === to.slug);
    if (target < 0) return null;
    let access;
    let walk = Infinity;
    if (from.kind === 'stop') {
      const source = ctx.index.stops.findIndex((s) => s.slug === from.slug);
      if (source < 0) return null;
      if (source === target) return { same: true, list: [], walk };
      access = planner.accessFromStop(source);
      walk = Math.min(...ctx.index.stops[source]!.poles.map((p) => planner.directWalk(p.lat, p.lon, target)));
    } else {
      access = planner.accessFromPlace(from.lat, from.lon);
      walk = planner.directWalk(from.lat, from.lon, target);
    }
    return { same: false, walk, list: planner.plan({ access, to: target, date: day, minutes, mode: mode === 'arrive' ? 'arrive' : 'depart', notBefore }) };
  }, [planner, from, to, mode, day, minutes, notBefore]);

  const chooseMode = (m: Mode) => {
    if (m !== 'now' && now) {
      if (!date) setDate(now.date);
      if (!time) setTime(hhmm(now.minutes));
    }
    setMode(m);
  };
  /** Pomakni upit na minutu `at`, računanu od ponoći prikazanog dana. */
  const jump = (m: Mode, at: number) => {
    setMode(m);
    setDate(addDays(day!, Math.floor(at / DAY)));
    setTime(hhmm(at));
  };
  const swap = () => { setFrom(to); setTo(from?.kind === 'stop' ? from : null); };

  const list = result?.list ?? [];
  const kind = day && activeServices(calendar, day).map((i) => calendar.labels[i]).join(', ');

  return (
    <div class="planner">
      <form class="plan-form" onSubmit={(e) => e.preventDefault()}>
        <div class="plan-ends">
          <StopInput label="Od" value={from} stops={stops} allowHere onChange={(p) => { setHereError(''); setFrom(p); }} />
          <button type="button" class="button swap" onClick={swap} aria-label="Zamijeni polazište i odredište">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 4v16M7 20l-4-4M7 20l4-4M17 20V4M17 4l-4 4M17 4l4 4" /></svg>
          </button>
          <StopInput label="Do" value={to} stops={stops} onChange={setTo} />
        </div>
        <div class="plan-when">
          <label>
            <span>Kada</span>
            <select value={mode} onChange={(e) => chooseMode(e.currentTarget.value as Mode)}>
              <option value="now">Kreni sada</option>
              <option value="depart">Kreni u</option>
              <option value="arrive">Stigni do</option>
            </select>
          </label>
          {mode !== 'now' && (
            <>
              <label><span>Dan</span><input type="date" value={date} min={now?.date} onChange={(e) => e.currentTarget.value && setDate(e.currentTarget.value)} /></label>
              <label><span>Vrijeme</span><input type="time" value={time} onChange={(e) => e.currentTarget.value && setTime(e.currentTarget.value)} /></label>
            </>
          )}
        </div>
      </form>

      <section class="plan-results" aria-label="Prijedlozi">
        {hereError && <p role="alert">{hereError}</p>}
        {failed && <p role="alert">Vozni red se nije učitao. <button type="button" class="button" onClick={load}>Pokušaj ponovno</button></p>}
        <p class="plan-status" role="status">
          {!failed && !result && (from && to ? 'Učitavam…' : 'Odaberi polazište i odredište.')}
          {result?.same && 'Polazište i odredište su ista stanica.'}
          {result && !result.same && !list.length && (mode === 'arrive' ? 'Nema veze koja stiže do tada.' : 'Nema veze u idućih nekoliko dana.')}
          {list.length > 0 && `${plural(list.length, 'prijedlog', 'prijedloga', 'prijedloga')}${kind && list.every((j) => j.dep >= 0 && j.dep < DAY) ? `, ${kind.toLowerCase()}` : ''}`}
        </p>
        {result && !result.same && result.walk <= 15 && <p class="plan-walk"><WalkIcon /> Pješice je oko {result.walk} min.</p>}
        {ctx && now && day && from && list.length > 0 && (
          <>
            {mode === 'arrive' && <button type="button" class="button" onClick={() => jump('arrive', list[0]!.arr - 1)}>Raniji dolasci</button>}
            <ol class="journeys">
              {list.map((j, i) => (
                <Card
                  key={`${day}|${j.dep}|${j.legs.map((l) => (l.kind === 'ride' ? `${l.line}-${l.dep}-${l.from}` : `h${l.to}`)).join()}`}
                  ctx={ctx} journey={j} date={day} today={now.date} nowMinutes={now.minutes} from={from}
                  open={i === (mode === 'arrive' ? list.length - 1 : 0)}
                />
              ))}
            </ol>
            {mode !== 'arrive' && list.length > 0 && <button type="button" class="button" onClick={() => jump('depart', list.at(-1)!.dep + 1)}>Kasniji polasci</button>}
            <p class="plan-note muted">
              Po voznom redu, bez kašnjenja uživo. Za presjedanje se računa najmanje {RULES.change} min, a hod je procjena.
            </p>
          </>
        )}
      </section>
    </div>
  );
}
