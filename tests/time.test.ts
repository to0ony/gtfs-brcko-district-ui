import assert from 'node:assert/strict';
import { test } from 'node:test';
import { slugify } from '../src/lib/text.ts';
import { activeMask, hhmm, upcoming, waitLabel, zonedNow } from '../src/lib/time.ts';
import type { Calendar } from '../src/lib/types.ts';

// 2026-11-23 je ponedjeljak. 0 = radni dan, 1 = vikend.
const cal: Calendar = {
  start: '2026-11-23', end: '2026-11-29', days: [1, 1, 1, 1, 1, 2, 2],
  weekday: [2, 1, 1, 1, 1, 1, 2], labels: ['Radni dan', 'Vikend'],
};
const row = { t: [[360, 720, 1450], [600]] };

test('vrijeme se računa u zoni grada', () => {
  assert.deepEqual(zonedNow('Europe/Sarajevo', new Date('2026-11-23T23:30:00Z')), { date: '2026-11-24', minutes: 30 });
  assert.deepEqual(zonedNow('Europe/Sarajevo', new Date('2026-07-01T10:00:00Z')), { date: '2026-07-01', minutes: 720 });
});

test('vrsta dana, i izvan raspona feeda', () => {
  assert.equal(activeMask(cal, '2026-11-25'), 1);
  assert.equal(activeMask(cal, '2026-11-28'), 2);
  assert.equal(activeMask(cal, '2027-01-03'), 2);
  assert.equal(activeMask(cal, '2027-01-04'), 1);
});

test('polasci su poredani i prelaze na idući dan', () => {
  const u = upcoming(cal, { date: '2026-11-23', minutes: 700 }, [row], 3);
  assert.deepEqual(u.map((x) => [hhmm(x.clock), x.day, x.wait]), [['12:00', 0, 20], ['00:10', 1, 750], ['06:00', 1, 1100]]);
});

test('jučerašnja vožnja iza ponoći još vrijedi', () => {
  const [u] = upcoming(cal, { date: '2026-11-24', minutes: 5 }, [row], 1);
  assert.deepEqual([u!.wait, u!.day, hhmm(u!.clock)], [5, 0, '00:10']);
});

test('petak navečer vodi na vikend red', () => {
  const [u] = upcoming(cal, { date: '2026-11-27', minutes: 1300 }, [{ t: [[360], [600]] }], 1);
  assert.deepEqual([hhmm(u!.clock), u!.day], ['10:00', 1]);
});

test('bez polazaka vraća prazno', () => {
  assert.deepEqual(upcoming(cal, { date: '2026-11-23', minutes: 0 }, [{ t: [[], []] }], 3), []);
});

test('oznake čekanja', () => {
  const today = '2026-11-23';
  assert.equal(waitLabel({ wait: 0, day: 0 }, today), 'sada');
  assert.equal(waitLabel({ wait: 12, day: 0 }, today), 'za 12 min');
  assert.equal(waitLabel({ wait: 65, day: 0 }, today), 'za 1 h 05 min');
  assert.equal(waitLabel({ wait: 20, day: 1 }, today), 'za 20 min');
  assert.equal(waitLabel({ wait: 900, day: 1 }, today), 'sutra');
  assert.equal(waitLabel({ wait: 2800, day: 2 }, today), 'sri');
});

test('slug', () => {
  assert.equal(slugify('Đurđevdan – Šatorovići (škola)'), 'durdevdan-satorovici-skola');
});
