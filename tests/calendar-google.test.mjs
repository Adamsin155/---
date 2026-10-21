// Reading the staff's own Google calendars on the server (supabase/functions/calendar/google.js;
// the owner, 21.10.2026): Google's address only, a time limit, a size limit, a short code
// on failure (never the address), and one database call per person with their rows.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFeed, runGoogle, codeOf } from '../supabase/functions/calendar/google.js';

const URL_OK = 'https://calendar.google.com/calendar/ical/irit%40gmail.com/private-0123456789abcdef0123456789abcdef/basic.ics';
const URL_2 = 'https://calendar.google.com/calendar/ical/lior%40gmail.com/private-fedcba9876543210/basic.ics';
const ICS = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'BEGIN:VEVENT', 'UID:m1', 'DTSTART;TZID=Asia/Jerusalem:20261105T100000', 'DTEND;TZID=Asia/Jerusalem:20261105T120000',
  'SUMMARY:פגישת אפיון קפה דנה', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
const NOW = new Date('2026-10-21T09:00:00+03:00');
const fetchOf = (map) => async (url, opts) => {
  const r = map[url];
  if (typeof r === 'function') return r(opts);
  if (!r) throw new Error('no network in tests');
  return new Response(r.body ?? ICS, { status: r.status ?? 200, headers: r.headers ?? {} });
};
const code = async (p) => { try { await p; return 'ok'; } catch (e) { return codeOf(e); } };

test('readFeed: the text of Google\'s address; anything else is a short code', async () => {
  assert.match(await readFeed(URL_OK, { fetch: fetchOf({ [URL_OK]: {} }) }), /BEGIN:VEVENT/);
  let asked = false;
  assert.equal(await code(readFeed('https://evil.com/a.ics', { fetch: async () => { asked = true; return new Response(ICS); } })), 'bad_url');
  assert.equal(asked, false, 'nothing is fetched from another host');
  assert.equal(await code(readFeed(URL_OK, { fetch: fetchOf({ [URL_OK]: { status: 404 } }) })), 'gone');
  assert.equal(await code(readFeed(URL_OK, { fetch: fetchOf({ [URL_OK]: { status: 503 } }) })), 'http_503');
  assert.equal(await code(readFeed(URL_OK, { fetch: fetchOf({ [URL_OK]: { body: '<html>sign in</html>' } }) })), 'not_ics');
  assert.equal(await code(readFeed(URL_OK, { fetch: fetchOf({ [URL_OK]: { body: `BEGIN:VCALENDAR\r\n${'X'.repeat(5000)}` } }), maxBytes: 1000 })), 'too_big');
  assert.equal(await code(readFeed(URL_OK, { fetch: fetchOf({ [URL_OK]: { headers: { 'content-length': '999999999' } } }) })), 'too_big');
  // A server that never answers: stopped at the time limit.
  const hang = (opts) => new Promise((_, reject) => opts.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
  assert.equal(await code(readFeed(URL_OK, { fetch: fetchOf({ [URL_OK]: hang }), timeoutMs: 20 })), 'timeout');
});

test('runGoogle: each connected person\'s rows in one call; a failure is a code on that person only', async () => {
  const applied = [];
  const db = {
    feeds: async () => [{ email: 'irit@astrateg.test', url: URL_OK }, { email: 'lior@astrateg.test', url: URL_2 }],
    clients: async () => [{ id: 'c1', name: 'דנה', business: 'קפה דנה' }],
    apply: async (email, rows, ok, error) => { applied.push({ email, rows, ok, error }); },
  };
  const stats = await runGoogle({ db, fetch: fetchOf({ [URL_OK]: {}, [URL_2]: { status: 404 } }), now: NOW });
  assert.deepEqual(stats, { people: 2, ok: 1, failed: 1, events: 1 });
  assert.equal(applied[0].email, 'irit@astrateg.test');
  assert.equal(applied[0].ok, true);
  assert.deepEqual(applied[0].rows.map((r) => [r.uid, r.client_id, r.kind_guess, r.starts_at]), [['m1', 'c1', 'char', '2026-11-05T08:00:00.000Z']]);
  assert.deepEqual(applied[1], { email: 'lior@astrateg.test', rows: null, ok: false, error: 'gone' });
  assert.ok(!JSON.stringify(stats).includes('private-'), 'the counts carry no address');
  // Nobody connected: the clients are not even read.
  let read = false;
  assert.deepEqual(await runGoogle({ db: { feeds: async () => [], clients: async () => { read = true; return []; }, apply: async () => {} }, fetch: fetchOf({}) }), { people: 0, ok: 0, failed: 0, events: 0 });
  assert.equal(read, false);
});
