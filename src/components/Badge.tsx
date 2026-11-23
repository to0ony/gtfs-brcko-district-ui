import type { LineRef } from '../lib/types';

export function Badge({ line }: { line: LineRef }) {
  return (
    <span class="badge notranslate" style={{ background: line.color, color: line.text }}>
      {line.short}
    </span>
  );
}
