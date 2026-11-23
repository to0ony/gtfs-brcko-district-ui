export interface Stop { slug: string; name: string; optional: boolean }

export interface Trip {
  svc: number;
  headsign: string;
  /** Minute od ponoći, poravnate s Direction.stops; null = vožnja tu ne staje. */
  times: (number | null)[];
  /** Indeks stajališta (StopGroup.poles) na svakoj stanici. */
  poles: (number | null)[];
  /** Indeks zadnje stanice vožnje (odatle se ne polazi). */
  last: number;
}

export interface Direction { id: string; label: string; stops: Stop[]; trips: Trip[] }

export interface LineRef { slug: string; short: string; color: string; text: string }

export interface Line extends LineRef {
  long: string;
  dirs: Direction[];
  shapes: [number, number][][];
}

/** Jedno fizičko stajalište, najčešće jedna strana ceste. */
export interface Pole {
  id: string;
  lat: number;
  lon: number;
}

export interface StopGroup {
  slug: string;
  name: string;
  poles: Pole[];
  lines: string[];
}

export interface Network {
  lines: Line[];
  stops: StopGroup[];
  operator: string;
}

export interface Calendar {
  start: string;
  end: string;
  /** Za svaki dan od `start`: bitmaska aktivnih vrsta dana. */
  days: number[];
  /** Najčešća maska po danu u tjednu (0 = nedjelja), za datume izvan feeda. */
  weekday: number[];
  labels: string[];
}

/** Polasci jedne linije s jednog stajališta prema jednom odredištu, po vrsti dana. */
export interface BoardRow { line: LineRef; dir: string; to: string; pole: number; t: number[][] }

/** Zapis u indeksu za pretragu i stanice u blizini. */
export interface SearchIndex {
  lines: (LineRef & { long: string })[];
  stops: Pick<StopGroup, 'slug' | 'name' | 'poles' | 'lines'>[];
}

export interface StopData { slug: string; name: string; poles: Pole[]; rows: BoardRow[] }
