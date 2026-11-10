// "מעקב לקוחות", the tab "ימי צילום": the Channel 14 item (the owner, 10.11.2026):
// app/tracking-ch14-logic.js and the rows, the tile and the filter of app/tracking-shoots-logic.js.
// Invented clients; the clock is Monday 9.11.2026, 12:00 in Israel.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canSetCh14, ch14Count, ch14Of, ch14Tile, withCh14Date, parseDayTime, dayTimeText, ch14Item,
} from '../app/tracking-ch14-logic.js';
import { shootRows, filterShoots } from '../app/tracking-shoots-logic.js';
import { partsIL } from '../app/tz.js';

const NOW = new Date('2026-11-09T12:00:00+02:00');
const base = (over = {}) => ({
  id: 'c1', name: 'דנה', business: 'קפה דנה', status: 'active', rounds: [], shoot_type: 'natali',
  deal_at: '2026-08-01T09:00:00+03:00', shoot_at: '2026-09-10T11:00:00+03:00', deliverables: { shoot_days: 1 }, ...over,
});
const V = (me) => ({ me, scope: 'office', error: null });

test('who sets it: Irit, Lior and the owners', () => {
  assert.equal(canSetCh14(V('irit')), true);
  assert.equal(canSetCh14(V('lior')), true);
  assert.equal(canSetCh14({ me: null, scope: 'office', error: null }), true);
  assert.equal(canSetCh14(V('ofir')), false);
  assert.equal(canSetCh14(V('ilai')), false);
});

test('how many items, and each one\'s state', () => {
  assert.equal(ch14Count(base()), 0);
  assert.equal(ch14Of(base()), null);
  assert.equal(ch14Count(base({ deliverables: { ch14: 2 } })), 2);
  const one = ch14Of(base({ deliverables: { ch14: 1 } }), NOW);
  assert.deepEqual(one.items.map((x) => x.text), ['ממתין לקביעה']);
  assert.equal(one.set, false);
  const two = ch14Of(base({ deliverables: { ch14: 2, ch14_dates: [{ at: '2026-11-20T10:00:00+02:00' }, null] } }), NOW);
  assert.deepEqual(two.items.map((x) => x.text), ['נקבע · 20.11', 'ממתין לקביעה']);
  assert.equal(two.set, false);
  assert.equal(ch14Item(new Date('2026-11-01T10:00:00+02:00'), NOW).text, 'צולם · 1.11');
  assert.equal(ch14Item(new Date('2026-11-09T18:00:00+02:00'), NOW).state, 'set', 'today: not yet behind');
});

test('kept in deliverables.ch14_dates, one place per item; the rest untouched', () => {
  const at = new Date('2026-11-20T10:30:00+02:00');
  const d1 = withCh14Date({ ch14: 2, videos: 10 }, 1, at, { by: 'irit', now: NOW });
  assert.deepEqual(d1, { ch14: 2, videos: 10, ch14_dates: [null, { at: at.toISOString(), by: 'irit', set_at: NOW.toISOString() }] });
  const d2 = withCh14Date(d1, 1, null);
  assert.deepEqual(d2, { ch14: 2, videos: 10 }, 'taken away: nothing left');
});

test('the typed date and time', () => {
  const p = (d, t) => { const r = parseDayTime(d, t, NOW); if (r.error) return r.error; const x = partsIL(r.at); return `${x.day}.${x.month}.${x.year} ${x.hour}:${String(x.minute).padStart(2, '0')}`; };
  assert.equal(p('20.11', '10:30'), '20.11.2026 10:30');
  assert.equal(p('20.11.2026', '10.30'), '20.11.2026 10:30');
  assert.equal(p('3/1/27', '1030'), '3.1.2027 10:30');
  assert.equal(p('20.11', '9'), '20.11.2026 9:00');
  assert.equal(p('20.11', ''), '20.11.2026 12:00');
  assert.match(p('', '10:00'), /צריך תאריך/);
  assert.match(p('31.11', ''), /אין תאריך כזה/);
  assert.match(p('20 נובמבר', ''), /לא ברור/);
  assert.match(p('20.11', '25:00'), /השעה/);
  assert.deepEqual(dayTimeText(new Date('2026-11-20T10:30:00+02:00')), ['20.11.2026', '10:30']);
  assert.deepEqual(dayTimeText(null), ['', '']);
});

test('the tile and the filter', () => {
  const rows = shootRows([
    base({ id: 'a', business: 'א', deliverables: { shoot_days: 1, ch14: 1, ch14_dates: [{ at: '2026-11-20T10:00:00+02:00' }] } }),
    base({ id: 'b', business: 'ב', deliverables: { shoot_days: 1, ch14: 2, ch14_dates: [{ at: '2026-11-20T10:00:00+02:00' }] } }),
    base({ id: 'c', business: 'ג', deliverables: { shoot_days: 1 } }),
  ], {}, NOW);
  assert.deepEqual(ch14Tile(rows), { total: 2, set: 1 });
  assert.deepEqual(filterShoots(rows, { ch14: 'yes' }).map((r) => r.id).sort(), ['a', 'b']);
  assert.deepEqual(filterShoots(rows, { ch14: 'waiting' }).map((r) => r.id), ['b']);
  assert.equal(filterShoots(rows, {}).length, 3);
});
