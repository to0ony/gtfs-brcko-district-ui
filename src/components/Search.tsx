import { useState } from 'preact/hooks';
import { getJson } from '../lib/client';
import { fold } from '../lib/text';
import type { SearchIndex } from '../lib/types';
import { Badge } from './Badge';

export default function Search() {
  const [q, setQ] = useState('');
  const [index, setIndex] = useState<SearchIndex | null>(null);
  const [failed, setFailed] = useState(false);

  const load = () => {
    if (index) return;
    getJson<SearchIndex>('/data/index.json').then((i) => { setIndex(i); setFailed(false); }, () => setFailed(true));
  };

  const words = fold(q).split(/\s+/).filter(Boolean);
  const active = words.length > 0;
  const hit = (s: string) => { const f = fold(s); return words.every((w) => f.includes(w)); };
  const starts = (s: string) => (fold(s).startsWith(words[0] ?? '') ? 0 : 1);

  const lines = active && index ? index.lines.filter((l) => fold(l.short).startsWith(fold(q.trim())) || hit(l.long)).slice(0, 5) : [];
  const stops = active && index
    ? index.stops.filter((s) => hit(s.name)).sort((a, b) => starts(a.name) - starts(b.name)).slice(0, 8)
    : [];
  const byStop = new Map(index?.lines.map((l) => [l.slug, l]));
  const numeric = /^\d/.test(q.trim());
  const first = stops[0] ? `/stanica/${stops[0].slug}` : lines[0] ? `/linija/${lines[0].slug}` : null;
  const exact = lines.find((l) => fold(l.short) === fold(q.trim()));

  const lineItems = lines.map((l) => (
    <li key={`l-${l.slug}`}>
      <a href={`/linija/${l.slug}`}><Badge line={l} /><span>{l.long}</span></a>
    </li>
  ));

  return (
    <form
      class="search"
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        const to = exact ? `/linija/${exact.slug}` : first;
        if (to) location.assign(to);
      }}
    >
      <label for="q" class="sr-only">Traži stanicu ili liniju</label>
      <input
        id="q"
        type="search"
        placeholder="Stanica ili broj linije"
        autocomplete="off"
        value={q}
        onFocus={load}
        onInput={(e) => { setQ(e.currentTarget.value); load(); }}
        onKeyDown={(e) => { if (e.key === 'Escape') setQ(''); }}
      />
      {active && (
        <div class="search-results" aria-live="polite">
          {failed && <p class="search-empty">Popis se nije učitao. Provjeri vezu pa pokušaj ponovno.</p>}
          {!failed && !index && <p class="search-empty">Učitavam…</p>}
          {index && !lines.length && !stops.length && <p class="search-empty">Nema stanice ni linije za „{q.trim()}”.</p>}
          <ul>
            {numeric && lineItems}
            {stops.map((s) => (
              <li key={`s-${s.slug}`}>
                <a href={`/stanica/${s.slug}`}>
                  <span class="pin" aria-hidden="true" />
                  <span>{s.name}</span>
                  <span class="badges">{s.lines.slice(0, 6).map((x) => { const l = byStop.get(x); return l && <Badge key={x} line={l} />; })}{s.lines.length > 6 && <span class="muted">+{s.lines.length - 6}</span>}</span>
                </a>
              </li>
            ))}
            {!numeric && lineItems}
          </ul>
        </div>
      )}
    </form>
  );
}
