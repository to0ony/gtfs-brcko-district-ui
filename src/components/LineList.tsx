import { calendar, useNow } from '../lib/client';
import { hhmm, upcoming, type Now } from '../lib/time';
import type { LineRef } from '../lib/types';
import { Badge } from './Badge';

export interface LineSummary { line: LineRef; long: string; t: number[][] }

function Status({ now, t }: { now: Now; t: number[][] }) {
  const u = upcoming(calendar, now, [{ t }], 1)[0];
  if (!u) return <span class="muted">ne vozi</span>;
  if (u.day > 0) return <span class="muted">danas više ne vozi</span>;
  return <>kreće <strong>{hhmm(u.clock)}</strong></>;
}

export default function LineList({ lines }: { lines: LineSummary[] }) {
  const now = useNow();
  return (
    <ul class="line-list">
      {lines.map(({ line, long, t }) => (
        <li key={line.slug}>
          <a href={`/linija/${line.slug}`}>
            <Badge line={line} />
            <span class="line-long">{long}</span>
            <span class="line-status">{now && <Status now={now} t={t} />}</span>
          </a>
        </li>
      ))}
    </ul>
  );
}
