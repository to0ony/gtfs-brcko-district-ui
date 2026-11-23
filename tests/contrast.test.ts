// WCAG 2.2 AA: tekst 4.5:1 (1.4.3), rubovi kontrola i grafika 3:1 (1.4.11), u obje teme.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { city } from '../city.config.ts';

const css = readFileSync(new URL('../src/styles/global.css', import.meta.url), 'utf8').replace(/\r/g, '');

function tokens(selector: string): Record<string, string> {
  const at = css.indexOf(`${selector} {`);
  assert.ok(at >= 0, `nema bloka ${selector}`);
  const body = css.slice(at, css.indexOf('}', at));
  return Object.fromEntries([...body.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})/g)].map((m) => [m[1]!, m[2]!]));
}

function luminance(hex: string) {
  const [r, g, b] = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

function contrast(a: string, b: string) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

const themes = { svijetla: tokens(':root'), tamna: tokens(":root[data-theme='dark']") };

const TEXT = [
  ['ink', 'paper'], ['ink', 'panel'], ['muted', 'paper'], ['muted', 'panel'], ['time', 'panel'],
  ['accent-ink', 'accent'], ['paper', 'ink'], ['ink', 'rule'], ['muted', 'rule'], ['head-ink', 'head'], ['alert-ink', 'alert'],
];
const GRAPHIC = [
  ['control', 'paper'], ['control', 'panel'], ['accent-edge', 'paper'], ['accent-edge', 'panel'],
  ['focus', 'paper'], ['focus', 'panel'],
];

test('znak stanice', () => {
  const t = themes.svijetla;
  assert.ok(contrast(t['sign-ink']!, t.sign!) >= 4.5);
});

for (const [name, t] of Object.entries(themes)) {
  test(`${name} tema: tekst`, () => {
    for (const [fg, bg] of TEXT) {
      const c = contrast(t[fg!]!, t[bg!]!);
      assert.ok(c >= 4.5, `${fg} na ${bg}: ${c.toFixed(2)}`);
    }
  });
  test(`${name} tema: rubovi, fokus i grafika`, () => {
    for (const [fg, bg] of GRAPHIC) {
      const c = contrast(t[fg!]!, t[bg!]!);
      assert.ok(c >= 3, `${fg} na ${bg}: ${c.toFixed(2)}`);
    }
  });
  test(`${name} tema: boje linija`, () => {
    for (const [line, color] of Object.entries(city.lineColors)) {
      assert.ok(contrast('#ffffff', color) >= 4.5, `bijeli tekst na liniji ${line}`);
      for (const bg of ['paper', 'panel']) {
        const c = contrast(color, t[bg]!);
        assert.ok(c >= 3, `linija ${line} na ${bg}: ${c.toFixed(2)}`);
      }
    }
  });
}

test('tamna tema bez JS-a jednaka je odabranoj', () => {
  assert.deepEqual(tokens(':root:not([data-theme])'), themes.tamna);
});
