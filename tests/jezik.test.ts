import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import '../src/scripts/jezik.js';
import { fold } from '../src/lib/text.ts';

interface Api {
  words: Record<string, [string | null, string | null]>;
  toCyrillic: (s: string) => string;
  convertTo: (id: string, s: string) => string;
  detect: (preferred: string[]) => string;
}
const { words, toCyrillic, convertTo, detect } = (globalThis as unknown as { jezik: Api }).jezik;

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const network = JSON.parse(read('../src/generated/network.json')) as {
  lines: { long: string; dirs: { label: string; trips: { headsign: string }[] }[] }[];
  stops: { name: string }[];
};
const names = [...new Set([
  ...network.stops.map((s) => s.name),
  ...network.lines.flatMap((l) => [l.long, ...l.dirs.flatMap((d) => [d.label, ...d.trips.map((t) => t.headsign)])]),
])];

test('dvoslovi i velika slova', () => {
  assert.equal(toCyrillic('Šljunkara / Gornji Rahić Stadion'), 'Шљункара / Горњи Рахић Стадион');
  assert.equal(toCyrillic('Njiverice, Džamija, Đurđevak, Žešće'), 'Њиверице, Џамија, Ђурђевак, Жешће');
  assert.equal(toCyrillic('Brčko(Bolnica) - Željeznička'), 'Брчко(Болница) - Жељезничка');
});

test('rimski brojevi, jedinice i oznake linija ostaju', () => {
  assert.equal(toCyrillic('Potočari III'), 'Поточари III');
  assert.equal(toCyrillic('za 1 h 05 min'), 'за 1 h 05 min');
  assert.equal(toCyrillic('Linije: 1, 12A, 12D'), 'Линије: 1, 12A, 12D');
  assert.equal(toCyrillic('GTFS, CC0'), 'GTFS, CC0');
  assert.equal(toCyrillic('FIS Pruga, PSC'), 'ФИС Пруга, ПСЦ');
});

test('ponovljeno pretvaranje u ćirilicu ništa ne mijenja', () => {
  for (const name of names) assert.equal(toCyrillic(toCyrillic(name)), toCyrillic(name));
});

test('pretraga ćirilicom nalazi svaku stanicu i liniju', () => {
  for (const name of names) {
    const cyr = toCyrillic(name);
    assert.doesNotMatch(cyr.replace(/\b[IVX]+\b/g, ''), /[a-zšđčćž]/i, cyr);
    assert.equal(fold(cyr), fold(name));
  }
});

test('izrazi, padeži i velika slova', () => {
  assert.equal(convertTo('hr', 'Cijeli vozni red'), 'Cijeli vozni red');
  assert.equal(convertTo('bs', 'Cijeli vozni red'), 'Cijeli red vožnje');
  assert.equal(convertTo('sr', 'Po voznom redu, bez kašnjenja'), 'Po redu vožnje, bez kašnjenja');
  assert.equal(convertTo('sr', 'Vozni red se nije učitao.'), 'Red vožnje se nije učitao.');
  assert.equal(convertTo('sr-cyrl', 'Vozni red se nije učitao.'), 'Ред вожње се није учитао.');
  assert.equal(convertTo('bs', 'Prijevoznik: '), 'Prijevoznik: ');
  assert.equal(convertTo('sr', 'Prijevoznik: '), 'Prevoznik: ');
  assert.equal(convertTo('sr', 'Dopusti je u postavkama preglednika.'), 'Dozvoli je u podešavanjima pregledača.');
  assert.equal(convertTo('bs', 'Dopusti je u postavkama preglednika.'), 'Dozvoli je u postavkama preglednika.');
  assert.equal(convertTo('sr', 'Kartu pomiči s dva prsta'), 'Mapu pomjeraj sa dva prsta');
  assert.equal(convertTo('sr', 'Na karti'), 'Na mapi');
  assert.equal(convertTo('sr', 'Spremi stanicu'), 'Sačuvaj stanicu');
});

test('dio druge riječi se ne mijenja', () => {
  for (const s of ['Kartaš', 'spremište', 'ispisano', 'šispis']) assert.equal(convertTo('sr', s), s);
});

test('nazivi stanica, linija i odredišta isti su na svim jezicima', () => {
  for (const name of names) {
    assert.equal(convertTo('bs', name), name);
    assert.equal(convertTo('sr', name), name);
    assert.equal(convertTo('sr-cyrl', name), toCyrillic(name));
  }
});

test('prijevod se ne prevodi ponovno', () => {
  for (const [bs, sr] of Object.values(words)) {
    if (bs) assert.equal(convertTo('bs', bs), bs);
    if (sr) assert.equal(convertTo('sr', sr), sr);
  }
});

test('svaki izraz iz rječnika postoji u sučelju', () => {
  const src = new URL('../src/', import.meta.url);
  const files = readdirSync(src, { recursive: true, encoding: 'utf8' }).filter((f) => /\.(astro|tsx|ts)$/.test(f));
  const ui = `${files.map((f) => readFileSync(new URL(f.replaceAll('\\', '/'), src), 'utf8')).join('\n')}\n${read('../scripts/gtfs.ts')}`.toLowerCase();
  for (const w of Object.keys(words)) assert.ok(ui.includes(w), `neiskorišten izraz: ${w}`);
});

test('početni jezik po pregledniku', () => {
  assert.equal(detect(['en-US', 'bs-BA']), 'bs');
  assert.equal(detect(['hr-HR', 'sr']), 'hr');
  assert.equal(detect(['sr-Latn-RS']), 'sr');
  assert.equal(detect(['sr-BA']), 'sr-cyrl');
  assert.equal(detect(['de', 'en']), 'hr');
  assert.equal(detect([]), 'hr');
});
