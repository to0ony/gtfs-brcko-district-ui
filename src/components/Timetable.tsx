import { useEffect, useRef } from 'preact/hooks';
import { calendar, useNow } from '../lib/client';
import { plural } from '../lib/text';
import { activeServices, hhmm } from '../lib/time';
import type { Departure, DirectionTimetable } from '../lib/network';

const letter = (v: number) => String.fromCharCode(96 + v);

/** Polasci po satima, samo sati u kojima nešto vozi. Vožnje iza ponoći ostaju na kraju. */
function byHour(deps: Departure[]) {
  const hours: { key: number; from: number; deps: Departure[] }[] = [];
  deps.forEach((d, i) => {
    const key = Math.floor(d.m / 60);
    if (hours.at(-1)?.key !== key) hours.push({ key, from: i, deps: [] });
    hours.at(-1)!.deps.push(d);
  });
  return hours;
}

/** Svi polasci po vrsti dana. Bez JS-a je sve otvoreno; s JS-om se otvara i ističe današnji dan. */
export default function Timetable({ table }: { table: DirectionTimetable }) {
  const now = useNow();
  const root = useRef<HTMLDivElement>(null);
  const today = now ? activeServices(calendar, now.date) : [];
  const order = calendar.labels
    .map((label, i) => ({ label, i, deps: table.days[i] ?? [], isToday: today.includes(i) }))
    .sort((a, b) => Number(b.isToday) - Number(a.isToday) || a.i - b.i);

  // Na papir idu svi dani, i oni koji su na ekranu zatvoreni.
  useEffect(() => {
    let opened: HTMLDetailsElement[] = [];
    const before = () => {
      opened = [...root.current!.querySelectorAll<HTMLDetailsElement>('details:not([open])')];
      for (const d of opened) d.open = true;
    };
    const after = () => { for (const d of opened) d.open = false; };
    addEventListener('beforeprint', before);
    addEventListener('afterprint', after);
    return () => {
      removeEventListener('beforeprint', before);
      removeEventListener('afterprint', after);
    };
  }, []);

  return (
    <div class="timetable" ref={root}>
      {order.map(({ label, i, deps, isToday }) => {
        const nextAt = now && isToday ? deps.findIndex((d) => d.m >= now.minutes) : -1;
        return (
          <details key={i} open={!now || isToday}>
            <summary>
              <span>{label}</span>
              {isToday && <span class="tag">danas</span>}
              <span class="muted">{deps.length ? (table.kind === 'polasci' ? plural(deps.length, 'polazak', 'polaska', 'polazaka') : plural(deps.length, 'dolazak', 'dolaska', 'dolazaka')) : 'ne vozi'}</span>
            </summary>
            {deps.length > 0 && (
              <ol class="hours">
                {byHour(deps).map((h) => (
                  <li key={h.key}>
                    <span class="hour" aria-hidden="true">{hhmm(h.key * 60).slice(0, 2)}</span>
                    <ol class="mins">
                      {h.deps.map((d, k) => {
                        const n = h.from + k;
                        const past = isToday && now && d.m < now.minutes;
                        return (
                          <li key={n} class={n === nextAt ? 'next' : past ? 'past' : ''} aria-current={n === nextAt ? 'time' : undefined}>
                            <span class="sr-only">{hhmm(d.m)}</span>
                            <span aria-hidden="true">{hhmm(d.m).slice(3)}</span>
                            {d.v > 0 && <sup>{letter(d.v)}</sup>}
                          </li>
                        );
                      })}
                    </ol>
                  </li>
                ))}
              </ol>
            )}
          </details>
        );
      })}
      {table.variants.length > 0 && (
        <ul class="legend">
          {table.variants.map((name, i) => <li key={name}><b>{letter(i + 1)}</b> {table.kind === 'polasci' ? 'vozi za' : 'oznaka na busu'}: {name}</li>)}
        </ul>
      )}
    </div>
  );
}
