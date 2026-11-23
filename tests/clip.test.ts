import assert from 'node:assert/strict';
import { test } from 'node:test';
import { clip, type Pt } from '../src/lib/clip.ts';

const road: Pt[] = [[18.8, 44.8], [18.8, 44.85], [18.8, 44.9]];

test('reže trasu između dvije stanice, s točkama između vrhova', () => {
  const out = clip([road], [[18.8001, 44.82], [18.8001, 44.88]]);
  assert.equal(out.length, 3);
  assert.ok(Math.abs(out[0]![1] - 44.82) < 1e-6 && out[0]![0] === 18.8);
  assert.deepEqual(out[1], [18.8, 44.85]);
});

test('stanica na samom kraju trase', () => {
  assert.deepEqual(clip([road], [[18.8, 44.8], [18.8, 44.9], [18.8, 44.9]]).at(-1), [18.8, 44.9]);
});

test('bira trasu u pravom smjeru', () => {
  const back = [...road].reverse();
  const out = clip([road, back], [[18.8, 44.88], [18.8, 44.82]]);
  assert.ok(out[0]![1] > out.at(-1)![1] && out.length === 3);
});

test('trasa tamo i natrag: povratak se ne miješa s odlaskom', () => {
  const loop: Pt[] = [...road, ...[...road].reverse().slice(1)];
  const out = clip([loop], [[18.8, 44.88], [18.8, 44.9], [18.8, 44.83]]);
  assert.deepEqual(out.map((p) => +p[1].toFixed(2)), [44.88, 44.9, 44.85, 44.83]);
});

test('daleka trasa se ne koristi', () => {
  const stops: Pt[] = [[18.9, 44.82], [18.9, 44.88]];
  assert.deepEqual(clip([road], stops), stops);
  assert.deepEqual(clip([], stops), stops);
});
