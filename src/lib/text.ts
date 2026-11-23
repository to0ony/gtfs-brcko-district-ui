const CYRILLIC: Record<string, string> = { љ: 'lj', њ: 'nj', џ: 'dz' };
[...'абвгдђежзијклмнопрстћуфхцчш'].forEach((c, i) => { CYRILLIC[c] = 'abvgddezzijklmnoprstcufhccs'[i]!; });

/** Mala slova bez dijakritike, ćirilica kao latinica; za pretragu i slugove. */
export const fold = (s: string) =>
  s.replace(/[\u0400-\u04ff]/g, (c) => CYRILLIC[c.toLowerCase()] ?? c).replace(/[đĐ]/g, 'd').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

export const slugify = (s: string) => fold(s).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** Redni broj stajališta na stanici. Feed ga nema, pa se uvijek prikazuje uz kartu ili vodi na nju. */
export const poleName = (i: number) => `Stajalište ${i + 1}`;

/** Mjesto u Google Maps. */
export const mapsUrl = (p: { lat: number; lon: number }) => `https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lon}`;

/** Sidro kartice stajališta na stranici stanice. */
export const poleHash = (id: string) => `#stajaliste-${id}`;

/** Hrvatska množina: 1 linija, 2 linije, 5 linija. */
export function plural(n: number, one: string, few: string, many: string) {
  const d = n % 10;
  const h = n % 100;
  if (d === 1 && h !== 11) return `${n} ${one}`;
  if (d >= 2 && d <= 4 && (h < 12 || h > 14)) return `${n} ${few}`;
  return `${n} ${many}`;
}
