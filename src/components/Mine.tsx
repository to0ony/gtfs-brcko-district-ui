import { useEffect, useState } from 'preact/hooks';
import { calendar, getJson, locate, useFavorites, useNow } from '../lib/client';
import { meters } from '../lib/planner';
import { poleHash, poleName } from '../lib/text';
import { hhmm, upcoming, waitLabel, type Now } from '../lib/time';
import type { BoardRow, LineRef, SearchIndex, StopData } from '../lib/types';
import { Badge } from './Badge';

/** `id` je "centar" ili, za jedno stajalište, "centar#centar-2". */
function StopCard({ id, now, meta, closer, limit }: { id: string; now: Now | null; meta?: string; closer?: string; limit: number }) {
  const [slug, poleId] = id.split('#');
  const [data, setData] = useState<StopData | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    getJson<StopData>(`/data/stanica/${slug}.json`).then((d) => live && setData(d), () => live && setFailed(true));
    return () => { live = false; };
  }, [slug]);

  if (failed) return null; // stanica više ne postoji u voznom redu
  const at = data ? data.poles.findIndex((p) => p.id === poleId) : -1;
  const pole = data && data.poles.length > 1 ? data.poles[at] : undefined;
  const rows = !data ? [] : pole ? data.rows.filter((r) => r.pole === at) : data.rows;
  const next = now ? upcoming(calendar, now, rows, limit) : [];
  const note = pole ? poleName(at) : closer;
  return (
    <li class="stop-card">
      <a href={`/stanica/${slug}${pole ? poleHash(pole.id) : ''}`}>
        <span class="stop-card-name">{data?.name ?? '…'}{meta && <span class="muted">{meta}</span>}</span>
        {note && <span class="stop-card-side muted">{note}</span>}
        {next.map((u) => (
          <span class="stop-card-row" key={`${u.row.line.slug}${u.row.to}${u.row.dir}${u.row.pole}${u.day}${u.clock}`}>
            <Badge line={u.row.line} />
            <span class="stop-card-to">{u.row.to}</span>
            <span class="stop-card-wait">{u.day === 0 && u.wait < 60 ? waitLabel(u, now!.date) : `${u.day ? `${waitLabel(u, now!.date)} ` : ''}${hhmm(u.clock)}`}</span>
          </span>
        ))}
      </a>
    </li>
  );
}

export interface MyLine { line: LineRef; long: string; dirs: (Pick<BoardRow, 'to' | 't'> & { id: string })[] }

function LineCard({ data, now }: { data: MyLine; now: Now | null }) {
  const { line, long, dirs } = data;
  return (
    <li class="line-card">
      <a class="line-card-head" href={`/linija/${line.slug}`}><Badge line={line} /><span>{long}</span></a>
      {dirs.map((d) => {
        const u = now ? upcoming(calendar, now, [d], 1)[0] : undefined;
        return (
          <a class="line-card-dir" key={d.id} href={`/linija/${line.slug}#smjer-${d.id}`}>
            <span><span class="muted">Smjer</span> {d.to}</span>
            <span class="stop-card-wait">{now && (u ? `${u.day ? `${waitLabel(u, now.date)} ` : ''}${hhmm(u.clock)}` : 'ne vozi')}</span>
          </a>
        );
      })}
    </li>
  );
}

const metersLabel = (m: number) => (m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1).replace('.', ',')} km`);

type Near = { state: 'idle' | 'busy' } | { state: 'error'; message: string } | { state: 'done'; stops: { slug: string; m: number; closer?: string }[] };

/** Razlika manja od ovoga je unutar greške GPS-a, pa ne tvrdimo koje je stajalište bliže. */
const POLE_METERS = 50;

function nearest(me: [number, number], { slug, poles }: SearchIndex['stops'][number]) {
  const [a, b] = poles.map((p, i) => ({ i, m: meters(me[0], me[1], p.lat, p.lon) })).sort((x, y) => x.m - y.m);
  return { slug, m: a!.m, closer: b && b.m - a!.m >= POLE_METERS ? `Bliže je stajalište ${a!.i + 1}` : undefined };
}

export default function Mine({ lines }: { lines: MyLine[] }) {
  const now = useNow();
  const favs = useFavorites('stanica');
  const favLines = useFavorites('linija').flatMap((slug) => lines.find((l) => l.line.slug === slug) ?? []);
  const [near, setNear] = useState<Near>({ state: 'idle' });

  const findNear = () => {
    setNear({ state: 'busy' });
    locate()
      .then(async (me) => {
        const { stops } = await getJson<SearchIndex>('/data/index.json').catch(() => {
          throw new Error('Popis stanica se nije učitao. Pokušaj ponovno.');
        });
        setNear({ state: 'done', stops: stops.map((s) => nearest(me, s)).sort((x, y) => x.m - y.m).slice(0, 4) });
      })
      .catch((e: Error) => setNear({ state: 'error', message: e.message }));
  };

  return (
    <div class="my-stops">
      {favs.length > 0 && (
        <section>
          <h2>Moje stanice</h2>
          <ul class="stop-cards">{favs.map((s) => <StopCard key={s} id={s} now={now} limit={3} />)}</ul>
        </section>
      )}
      {favLines.length > 0 && (
        <section>
          <h2>Moje linije</h2>
          <ul class="stop-cards">{favLines.map((l) => <LineCard key={l.line.slug} data={l} now={now} />)}</ul>
        </section>
      )}
      <section>
        <h2>U blizini</h2>
        {near.state === 'done' ? (
          <ul class="stop-cards">{near.stops.map((s) => <StopCard key={s.slug} id={s.slug} now={now} limit={2} meta={metersLabel(s.m)} closer={s.closer} />)}</ul>
        ) : (
          <button type="button" class="button" disabled={near.state === 'busy'} onClick={findNear}>
            {near.state === 'busy' ? 'Tražim te…' : 'Nađi najbliže stanice'}
          </button>
        )}
        {near.state === 'error' && <p class="muted" role="alert">{near.message}</p>}
        {near.state === 'idle' && <p class="muted">Lokacija ostaje na tvom uređaju.</p>}
      </section>
    </div>
  );
}
