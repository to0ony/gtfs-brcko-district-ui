import { useId, useState } from 'preact/hooks';
import { locate, useFavorites, useLanguage } from '../lib/client';
import { fold } from '../lib/text';

export type Place = { kind: 'stop'; slug: string } | { kind: 'here'; lat: number; lon: number };

interface Option { key: string; name: string; hint?: string; place?: Place }

interface Props {
  label: string;
  value: Place | null;
  stops: { slug: string; name: string }[];
  allowHere?: boolean;
  onChange: (p: Place | null) => void;
}

const HERE = 'Moja lokacija';

/** Polje za stanicu s prijedlozima (ARIA combobox). Prazno polje nudi lokaciju i spremljene stanice. */
export default function StopInput({ label, value, stops, allowHere = false, onChange }: Props) {
  const id = useId();
  const favorites = useFavorites('stanica');
  const convert = useLanguage();
  const [text, setText] = useState<string | null>(null); // null = prikaži odabranu vrijednost
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const nameOf = (p: Place | null) => (!p ? '' : p.kind === 'here' ? HERE : (stops.find((s) => s.slug === p.slug)?.name ?? ''));
  const q = fold((text ?? '').trim());
  const toOption = (s: { slug: string; name: string }, hint?: string): Option => ({ key: s.slug, name: s.name, hint, place: { kind: 'stop', slug: s.slug } });

  const options: Option[] = [];
  if (allowHere && fold(HERE).includes(q)) options.push({ key: '@here', name: HERE });
  if (q) {
    const words = q.split(/\s+/);
    const rank = (n: string) => (fold(n).startsWith(words[0]!) ? 0 : 1);
    options.push(
      ...stops
        .filter((s) => words.every((w) => fold(s.name).includes(w)))
        .sort((a, b) => rank(a.name) - rank(b.name))
        .slice(0, 8)
        .map((s) => toOption(s)),
    );
  } else {
    const mine = [...new Set(favorites.map((f) => f.split('#')[0]))];
    options.push(...mine.flatMap((slug) => { const s = stops.find((x) => x.slug === slug); return s ? [toOption(s, 'moja stanica')] : []; }));
  }
  const at = Math.min(active, options.length - 1);

  const close = () => { setOpen(false); setText(null); setActive(0); };
  const pick = (o: Option) => {
    setError('');
    close();
    if (o.place) return onChange(o.place);
    setBusy(true);
    locate()
      .then(([lat, lon]) => onChange({ kind: 'here', lat, lon }), (e: Error) => setError(e.message))
      .finally(() => setBusy(false));
  };

  return (
    <div class="stop-input">
      <label for={id}>{label}</label>
      <input
        id={id}
        type="text"
        role="combobox"
        autocomplete="off"
        spellcheck={false}
        placeholder={busy ? 'Tražim te…' : 'Naziv stanice'}
        aria-autocomplete="list"
        aria-expanded={open && options.length > 0}
        aria-controls={`${id}-list`}
        aria-activedescendant={open && options[at] ? `${id}-${at}` : undefined}
        aria-describedby={error ? `${id}-err` : undefined}
        value={text ?? convert(nameOf(value))}
        onFocus={(e) => { e.currentTarget.select(); setText(''); setOpen(true); }}
        onInput={(e) => { setText(e.currentTarget.value); setOpen(true); setActive(0); }}
        onBlur={() => {
          const exact = q ? stops.find((s) => fold(s.name) === q) : undefined;
          if (exact) onChange({ kind: 'stop', slug: exact.slug });
          close();
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            if (!open) return setOpen(true);
            if (options.length) setActive((at + (e.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length);
          } else if (e.key === 'Enter' && open && options[at]) {
            e.preventDefault();
            pick(options[at]!);
          } else if (e.key === 'Escape') {
            close();
          }
        }}
      />
      <ul id={`${id}-list`} class="stop-options" role="listbox" aria-label={label} hidden={!open || !options.length}>
        {options.map((o, i) => (
          // mousedown, da klik stigne prije nego što polje izgubi fokus
          <li key={o.key} id={`${id}-${i}`} role="option" aria-selected={i === at} onMouseDown={(e) => { e.preventDefault(); pick(o); }}>
            {o.name}{o.hint && <span class="muted">{o.hint}</span>}
          </li>
        ))}
      </ul>
      {open && q && !options.length && <p class="stop-input-none">Nema stanice s tim nazivom.</p>}
      {error && <p id={`${id}-err`} class="stop-input-err" role="alert">{error}</p>}
    </div>
  );
}
