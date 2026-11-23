import { useState } from 'preact/hooks';
import { calendar, useNow } from '../lib/client';
import { plural, poleHash } from '../lib/text';
import { activeServices, hhmm, upcoming, waitLabel } from '../lib/time';
import type { BoardRow, LineRef } from '../lib/types';
import { Badge } from './Badge';
import Star from './Star';

interface Props {
  /** Slug i naziv stanice. */
  stop: string;
  name: string;
  rows: BoardRow[];
  /** Id i naziv stajališta, ako ih stanica ima više. */
  pole?: string;
  title?: string;
  /** Mjesto stajališta u Google Maps. */
  maps?: string;
  limit: number;
}

/** Tabla sa sljedećim polascima s jednog stajališta. */
export default function Board({ stop, name, rows, pole, title, maps, limit }: Props) {
  const now = useNow();
  const [only, setOnly] = useState<string | null>(null);
  const [all, setAll] = useState(false);

  const lines = [...new Map(rows.map((r) => [r.line.slug, r.line])).values()];
  const shown = only ? rows.filter((r) => r.line.slug === only) : rows;
  // Sve do kraja prvog dana u kojem još nešto vozi, ali nikad manje od `limit`.
  const coming = now ? upcoming(calendar, now, shown, 500) : [];
  const count = Math.max(limit, coming.filter((u) => u.day === coming[0]!.day).length);
  const next = coming.slice(0, all ? count : limit);
  const today = now ? activeServices(calendar, now.date).map((i) => calendar.labels[i]).join(', ') : '';

  const toggle = (l: LineRef) => setOnly(only === l.slug ? null : l.slug);

  return (
    <section class="board" id={pole && poleHash(pole).slice(1)} aria-label={title ? `${title}, sljedeći polasci` : 'Sljedeći polasci'}>
      {pole && title && (
        <div class="board-title">
          <h2><span class="pole-num" aria-hidden="true">{title.split(' ')[1]}</span>{title}</h2>
          {maps && <a class="maps" href={maps} target="_blank" rel="noopener"><span class="notranslate">Google Maps</span><span class="sr-only">: {name}, {title.toLowerCase()}</span></a>}
          <Star kind="stanica" id={`${stop}#${pole}`} name={`${name}, ${title.toLowerCase()}`} compact />
        </div>
      )}
      <div class="board-head">
        <span>{today || 'Po voznom redu'}</span>
        <span class="board-clock">{now ? hhmm(now.minutes) : '--:--'}</span>
      </div>
      {lines.length > 1 && (
        <div class="board-filter" role="group" aria-label="Prikaži samo liniju">
          {lines.map((l) => (
            <button type="button" key={l.slug} aria-pressed={only === l.slug} class={only && only !== l.slug ? 'off' : ''} onClick={() => toggle(l)}>
              <Badge line={l} />
            </button>
          ))}
        </div>
      )}
      <ol class="board-rows">
        {!rows.length && <li class="board-note">Odavde nema polazaka, samo dolasci.</li>}
        {next.length > 0 && next[0]!.day > 0 && <li class="board-note">Danas više nema polazaka.</li>}
        {!now && rows.length > 0 && Array.from({ length: limit }, (_, i) => <li key={i} class="board-row ghost" aria-hidden="true"><span /></li>)}
        {now && rows.length > 0 && next.length === 0 && <li class="board-note">Nema polazaka u idućih 7 dana.</li>}
        {next.map((u, i) => (
          <li key={`${u.row.line.slug}|${u.row.dir}|${u.row.to}|${u.day}|${u.clock}`}>
            <a class={i === 0 && u.day === 0 ? 'board-row first' : 'board-row'} href={`/linija/${u.row.line.slug}/stanica/${stop}#smjer-${u.row.dir}`}>
              <Badge line={u.row.line} />
              <span class="board-to">{u.row.to}</span>
              <span class="board-wait"><span class="when">{waitLabel(u, now!.date)}</span></span>
              <span class="board-time">{hhmm(u.clock)}</span>
            </a>
          </li>
        ))}
      </ol>
      {count > limit && (
        <button type="button" class="board-all" aria-expanded={all} onClick={() => setAll(!all)}>
          {all ? 'Prikaži manje' : `Još ${plural(count - limit, 'polazak', 'polaska', 'polazaka')} do kraja dana`}
        </button>
      )}
    </section>
  );
}
