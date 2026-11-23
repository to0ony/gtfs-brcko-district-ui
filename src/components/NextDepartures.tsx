import { calendar, useNow } from '../lib/client';
import { hhmm, upcoming, waitLabel } from '../lib/time';

const COUNT = 3;

/** Tri sljedeća polaska iznad voznog reda. */
export default function NextDepartures({ t }: { t: number[][] }) {
  const now = useNow();
  const next = now ? upcoming(calendar, now, [{ t }], COUNT) : null;
  if (next && !next.length) return <p class="next-start">Nema polazaka u idućih 7 dana.</p>;
  return (
    <div class="next-deps">
      <p class="next-deps-title">Sljedeći polasci</p>
      <ol>
        {next
          ? next.map((u) => (
            <li key={`${u.day}|${u.clock}`}>
              <strong>{hhmm(u.clock)}</strong>
              <span class="wait">{waitLabel(u, now!.date)}</span>
            </li>
          ))
          : Array.from({ length: COUNT }, (_, i) => <li key={i} aria-hidden="true"><strong>--:--</strong><span class="wait">&nbsp;</span></li>)}
      </ol>
    </div>
  );
}
