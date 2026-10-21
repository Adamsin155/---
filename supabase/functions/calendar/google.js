// Reading the staff's own Google calendars (the owner's request of 21.10.2026; docs/ops.md,
// section 65), for POST { action: 'google' } of this function (./index.ts), which pg_cron
// sends every 15 minutes (public.google_calendar_tick). For each connected person: fetch
// their secret iCal address (Google's host only, a time limit, a size limit), read it into
// rows (../_shared/app/gcal-logic.js, a copy of app/gcal-logic.js) and hand them to the
// database in one call (public.google_calendar_apply), which also hides what left the feed.
// Plain JavaScript with its database and fetch passed in, so node tests it
// (tests/calendar-google.test.mjs). The address is never logged and never returned; a
// failure is a short code on that person's status.
import { googleIcsUrl, googleRows, MAX_BYTES } from '../_shared/app/gcal-logic.js';

export const TIMEOUT_MS = 15000;
const fail = (code) => Object.assign(new Error(code), { code });
export const codeOf = (e) => String(e?.code || e?.name || 'error').replace(/[^\w.-]/g, '').slice(0, 60) || 'error';

// The text of one feed, or a thrown short code: bad_url, gone (Google says the address
// is no longer valid: it was reset), http_<status>, timeout, too_big, not_ics.
export async function readFeed(url, { fetch, timeoutMs = TIMEOUT_MS, maxBytes = MAX_BYTES } = {}) {
  if (!googleIcsUrl(url)) throw fail('bad_url');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { Accept: 'text/calendar' }, redirect: 'follow' });
    if ([401, 403, 404, 410].includes(res.status)) throw fail('gone');
    if (!res.ok) throw fail(`http_${res.status}`);
    if (Number(res.headers?.get?.('content-length')) > maxBytes) throw fail('too_big');
    let text = '';
    if (res.body?.getReader) {
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let size = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maxBytes) { await reader.cancel().catch(() => {}); throw fail('too_big'); }
        text += decoder.decode(value, { stream: true });
      }
      text += decoder.decode();
    } else {
      text = await res.text();
      if (new TextEncoder().encode(text).byteLength > maxBytes) throw fail('too_big');
    }
    if (!/BEGIN:VCALENDAR/.test(text.slice(0, 2000))) throw fail('not_ics');
    return text;
  } catch (e) {
    if (e?.name === 'AbortError' || ctrl.signal.aborted) throw fail('timeout');
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

// Every connected person, one after the other. db: { feeds(): [{ email, url }],
// clients(): [{ id, name, business }], apply(email, rows, ok, error) }.
// Returns counts only: { people, ok, failed, events }.
export async function runGoogle({ db, fetch, now = new Date(), timeoutMs = TIMEOUT_MS } = {}) {
  const feeds = await db.feeds();
  const stats = { people: feeds.length, ok: 0, failed: 0, events: 0 };
  if (!feeds.length) return stats;
  const clients = await db.clients();
  for (const f of feeds) {
    try {
      const text = await readFeed(f.url, { fetch, timeoutMs });
      const { rows } = googleRows(text, { clients, now });
      await db.apply(f.email, rows, true, null);
      stats.ok += 1;
      stats.events += rows.length;
    } catch (e) {
      stats.failed += 1;
      await db.apply(f.email, null, false, codeOf(e)).catch(() => {});
    }
  }
  return stats;
}
