import type { LineRef } from '../lib/types';
import { Badge } from './Badge';

export interface DirLink { line: LineRef; dirs: { id: string; label: string }[] }

/** Linije i smjerovi na stanici. */
export default function DirLinks({ stop, links }: { stop: string; links: DirLink[] }) {
  return (
    <ul class="dir-list">
      {links.map(({ line, dirs }) => (
        <li key={line.slug}>
          <Badge line={line} />
          <span>{dirs.map((d) => <a key={d.id} href={`/linija/${line.slug}/stanica/${stop}#smjer-${d.id}`}>{d.label}</a>)}</span>
        </li>
      ))}
    </ul>
  );
}
