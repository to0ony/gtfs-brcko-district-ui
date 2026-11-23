import { calendar, useNow } from '../lib/client';
import { hhmm, upcoming, waitLabel } from '../lib/time';

/** Jedan redak: kad kreće sljedeća vožnja. */
export default function NextStart({ t, prefix = 'Sljedeći polazak' }: { t: number[][]; prefix?: string }) {
  const now = useNow();
  const u = now ? upcoming(calendar, now, [{ t }], 1)[0] : undefined;
  return (
    <p class="next-start">
      {!now ? (
        <>{prefix} …</>
      ) : !u ? (
        <>Nema polazaka u idućih 7 dana.</>
      ) : (
        <>
          {prefix} <strong>{hhmm(u.clock)}</strong> <span class={u.day === 0 ? 'soon' : 'muted'}>{waitLabel(u, now.date)}</span>
        </>
      )}
    </p>
  );
}
