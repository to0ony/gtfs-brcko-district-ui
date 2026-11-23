import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { Analysis, Settlement } from './compute';

export interface Tip { x: number; y: number; title: string; rows: [string, string][] }

/** Jedan oblačić za cijelu stranicu; samo za miš, sve iz njega piše i drugdje. */
export function TipBox({ tip }: { tip: Tip | null }) {
  if (!tip) return null;
  const right = tip.x > innerWidth - 230;
  return (
    <div class="tip" style={{ left: `${tip.x + (right ? -14 : 14)}px`, top: `${tip.y + 14}px`, transform: right ? 'translateX(-100%)' : undefined }} aria-hidden="true">
      <strong>{tip.title}</strong>
      {tip.rows.map(([value, label]) => <span key={label}><b>{value}</b> {label}</span>)}
    </div>
  );
}

/** Širina elementa, da tekst u crtežu ostane čitljiv na svakom ekranu. */
export function useWidth(initial = 640) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(initial);
  useEffect(() => {
    const el = ref.current!;
    const ro = new ResizeObserver(() => el.clientWidth && setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

export function Tile({ value, label, note }: { value: ComponentChildren; label: string; note?: string }) {
  return (
    <div class="tile">
      <span class="tile-label">{label}</span>
      <strong>{value}</strong>
      {note && <span class="tile-note">{note}</span>}
    </div>
  );
}

export function Legend({ items, none, reverse = false }: { items: string[]; none?: string; reverse?: boolean }) {
  return (
    <ul class="legend">
      {items.map((t, i) => <li key={t}><i class={`c${reverse ? items.length - 1 - i : i}`} aria-hidden="true" />{t}</li>)}
      {none && <li><i class="none" aria-hidden="true" />{none}</li>}
    </ul>
  );
}

interface MapProps {
  a: Analysis;
  label: string;
  /** Razred 0–4 ili -1. */
  classFor: (s: Settlement) => number;
  tipFor: (s: Settlement) => [string, string][];
  selected: string | null;
  onSelect: (id: string) => void;
  onTip: (t: Tip | null) => void;
  /** Dodatne točke, npr. predložene stanice. */
  extra?: { lat: number; lon: number }[];
}

/** Naselja obojena po razredu, s trasama i stajalištima. Odabir je moguć i iz izbornika i iz tablice. */
export function SettlementMap({ a, label, classFor, tipFor, selected, onSelect, onTip, extra = [] }: MapProps) {
  const [hover, setHover] = useState<string | null>(null);
  const [ref, width] = useWidth();
  const px = a.width / width; // jedinica crteža po pikselu
  const outline = (id: string | null, cls: string) => {
    const s = a.settlements.find((x) => x.id === id);
    return s && <path d={s.path} class={cls} stroke-width={(cls === 'sel' ? 2.5 : 1.5) * px} />;
  };
  const chosen = a.settlements.find((s) => s.id === selected);
  const leave = () => { setHover(null); onTip(null); };
  return (
    <div ref={ref} class="map-box">
      <svg viewBox={`0 0 ${a.width} ${a.height}`} role="img" aria-label={label} onPointerLeave={leave}>
        <defs>
          <pattern id="hatch" width={6 * px} height={6 * px} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width={6 * px} height={6 * px} class="hatch-bg" />
            <rect width={1.5 * px} height={6 * px} class="hatch-line" />
          </pattern>
        </defs>
        {a.settlements.map((s) => {
          const c = classFor(s);
          return (
            <path
              key={s.id}
              d={s.path}
              class={c < 0 ? 'area none' : `area c${c}`}
              stroke-width={px}
              onClick={() => onSelect(s.id)}
              onPointerMove={(e) => {
                if (e.pointerType !== 'mouse') return;
                setHover(s.id);
                onTip({ x: e.clientX, y: e.clientY, title: s.name, rows: tipFor(s) });
              }}
            />
          );
        })}
        <g class="routes" stroke-width={1.2 * px}>{a.lines.map((l) => <path key={l.slug} d={l.path} />)}</g>
        <g class="dots">{a.stops.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r={1.6 * px} />)}</g>
        <g class="extra" stroke-width={1.2 * px}>{extra.map((p, i) => { const x = a.geo.pad + (p.lon - a.geo.minX) * a.geo.k; const y = a.geo.pad + (a.geo.maxY - p.lat) * a.geo.ky * a.geo.k; return <circle key={i} cx={x} cy={y} r={4.5 * px} />; })}</g>
        {hover !== selected && outline(hover, 'hov')}
        {outline(selected, 'sel')}
        {chosen && (
          <text
            x={Math.min(a.width - 60 * px, Math.max(60 * px, chosen.at[0]))}
            y={Math.max(16 * px, chosen.at[1] - 8 * px)}
            font-size={13 * px}
            stroke-width={4 * px}
            text-anchor="middle"
            class="map-name"
          >
            {chosen.name}
          </text>
        )}
      </svg>
    </div>
  );
}

export interface Column<T> {
  id: string;
  label: string;
  /** Za razvrstavanje. */
  sort: (row: T) => number | string;
  cell: (row: T) => ComponentChildren;
  /** Prvi klik razvrstava uzlazno. */
  asc?: boolean;
  text?: boolean;
}

export function SortTable<T extends { id: string }>({ caption, rows, columns, start, selected }: { caption: string; rows: T[]; columns: Column<T>[]; start: string; selected?: string | null }) {
  const [by, setBy] = useState({ id: start, asc: columns.find((c) => c.id === start)?.asc ?? false });
  const column = columns.find((c) => c.id === by.id)!;
  const sorted = [...rows].sort((a, b) => {
    const x = column.sort(a);
    const y = column.sort(b);
    const order = typeof x === 'string' ? x.localeCompare(y as string, 'hr') : x - (y as number);
    return by.asc ? order : -order;
  });
  return (
    <div class="scroll" role="region" aria-label={caption} tabIndex={0}>
      <table>
        <caption class="sr-only">{caption}</caption>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.id} scope="col" class={c.text ? 'text' : ''} aria-sort={by.id === c.id ? (by.asc ? 'ascending' : 'descending') : undefined}>
                <button type="button" onClick={() => setBy({ id: c.id, asc: by.id === c.id ? !by.asc : !!c.asc })}>
                  {c.label}<span class="arrow" aria-hidden="true">{by.id === c.id ? (by.asc ? '↑' : '↓') : ''}</span>
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => (
            <tr key={row.id} class={row.id === selected ? 'sel' : ''}>
              {columns.map((c, i) => (i ? <td key={c.id} class={c.text ? 'text' : ''}>{c.cell(row)}</td> : <th key={c.id} scope="row">{c.cell(row)}</th>))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
