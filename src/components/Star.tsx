import { toggleFavorite, useFavorites, type FavoriteKind } from '../lib/client';

interface Props {
  kind: FavoriteKind;
  /** "8", "centar" ili, za jedno stajalište, "centar#centar-2". */
  id: string;
  name: string;
  /** Samo ikona, na kartici stajališta. */
  compact?: boolean;
}

export default function Star({ kind, id, name, compact = false }: Props) {
  const on = useFavorites(kind).includes(id);
  const text = on ? 'Ukloni iz mojih' : compact ? 'Spremi' : kind === 'linija' ? 'Spremi liniju' : 'Spremi stanicu';
  return (
    <button
      type="button"
      class={`button star${on ? ' on' : ''}${compact ? ' compact' : ''}`}
      title={compact ? text : undefined}
      onClick={() => toggleFavorite(kind, id)}
    >
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
        <path
          d="M12 2.8l2.9 5.9 6.5.9-4.7 4.6 1.1 6.4L12 17.6l-5.8 3 1.1-6.4L2.6 9.6l6.5-.9z"
          fill={on ? 'currentColor' : 'none'}
          stroke="currentColor"
          stroke-width="2"
          stroke-linejoin="round"
        />
      </svg>
      {compact ? <span class="sr-only">{text}</span> : text}<span class="sr-only">: {name}</span>
    </button>
  );
}
