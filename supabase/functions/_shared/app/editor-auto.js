// generated — edit app/ instead. Source: app/editor-auto.js. Regenerate: node scripts/sync-functions.mjs
// The editor's hand-off to Ofir goes by itself (the owner's decision of 9.11.2026; docs/ops.md,
// section 121). Nadia closed every item of the editing (22) and put the videos in the client's
// Drive (p24.folder, p24.drive) with the process's "בוצע", which never marks "העורך עדכן את אופיר"
// (p24.notify is `noBulk`), so the client never reached Ofir's check (25) and Irit never saw it.
// Now, once the editor's work is all marked, the system writes p24.notify itself, once, exactly
// as if the editor had pressed it: the same key, so everything that reads it runs as before:
// Ofir's queue (app/qa-logic.js qaQueue, qaState's `ready`), his one-hour clock (25 starts from 24)
// and his and Irit's ring (reminder-rules `qa`), the hand-off "הסרטונים מוכנים לבקרה"
// (app/handoffs.js), the editor's own reminders stopping (`editing`), the editor page's state
// ("אצל אופיר"), and later Irit's sending (26). The button "מוכן לבדיקה" in editor.html and the
// row in the card stay: an editor may still hand off earlier, by hand.
//
// Pure: no DOM, no network. Two writers call it, as with app/gantt-auto.js (p28.auto): the
// reminders function on every tick (supabase/functions/reminders/tick.js `handToOfir`, a copy of
// this file), and the client card right after the editor's last mark (app/client-card.js). The
// mark is inserted, never written over one that exists (the unique key on client_id and item_key),
// so it is written once, and never after a return for fixes (the mark is there by then).
//
// For one shoot (the client's own, `pre` '', and each shoot round, `r2.`), it is written when:
//   - the client is in work (active or ending; a client in landing too, as Ofir's queue has it);
//   - the shoot has an editor (one, or two with `editor2`): the marks of 22 and 24 are one set for
//     the shoot, shared by both editors (each one's share, `editor_split`, is only a count), so
//     "everything marked" is both shares done: one editor's half is never marked "all done";
//   - 22 is complete (every live item: the start checks, the edit, the self-check and the five
//     critical mistakes; done or "לא רלוונטי");
//   - every live item of 24 but p24.notify is resolved: the folder and the Drive, and Dropbox only
//     when the card has the client's Dropbox link (app/production.js needsDropbox, as "מוכן לבדיקה");
//   - p24.notify has no mark at all (done or "לא רלוונטי": never written over);
//   - nothing after it happened yet (no mark of 25, 26 or 27 in this shoot: a client long past it
//     is not sent back to Ofir), and 24 is not waiting on the client;
//   - at least one of those marks of 22 and 24 was made by a person (not all brought in by the
//     import from the old system: a history row is not a fresh hand-off).
import { editorsOf } from './protocol.js';
import { IMPORT_NOTE, isResolved } from './protocol-logic.js';
import { needsDropbox } from './production.js';

export const NOTIFY = 'p24.notify';
export const AUTO_NOTE = 'הועבר לאופיר אוטומטית: כל העריכה והדרייב סומנו';
const LATER = /^p(25|26|27)\./;

const baseOf = (key) => key.replace(/^r\d+\./, '');

// The keys to write for one client now ([] when none): `${pre}p24.notify` for the client's own
// shoot and for each round whose editing is all marked. `state`: clientState(client, checks).
export function editorReadyKeys(client, checks = {}, state = null) {
  if (!client || !state || !['active', 'ending'].includes(client.status)) return [];
  const out = [];
  for (const s24 of state.states) {
    if (s24.proc.id.replace(/^r\d+-/, '') !== 'p24' || s24.complete || s24.wait) continue;
    const pid = s24.proc.id.slice(0, -'p24'.length);
    const pre = (s24.proc.keyBase || s24.proc.id).slice(0, -'p24'.length);
    const key = `${pre}${NOTIFY}`;
    if (checks[key]) continue;
    if (!editorsOf(s24.proc.ctx || client).length) continue;
    const s22 = state.states.find((x) => x.proc.id === `${pid}p22`);
    if (!s22?.complete) continue;
    const need = s24.proc.items.filter((i) => i.key !== key && (!i.optional || (baseOf(i.key) === 'p24.dropbox' && needsDropbox(client))));
    if (!need.every((i) => isResolved(i, checks[i.key]))) continue;
    const later = Object.keys(checks).some((k) => k.startsWith(pre) && LATER.test(k.slice(pre.length)) && (pre || !/^r\d+\./.test(k)) && checks[k]);
    if (later) continue;
    const marks = [...s22.proc.items, ...need].map((i) => checks[i.key]).filter(Boolean);
    if (!marks.some((c) => c.note !== IMPORT_NOTE)) continue;
    out.push(key);
  }
  return out;
}

// Every client's marks: [{ client, marks: [{ item_key, state: 'done', note }] }].
//   checks: rows of public.protocol_checks. `stateOf(client, checks)`: clientState.
export function editorReadyPlans(clients, checks = [], stateOf) {
  const byClient = new Map();
  for (const r of checks || []) {
    if (!byClient.has(r.client_id)) byClient.set(r.client_id, {});
    byClient.get(r.client_id)[r.item_key] = r;
  }
  const out = [];
  for (const client of clients || []) {
    const cs = byClient.get(client.id);
    if (!cs) continue;
    const keys = editorReadyKeys(client, cs, stateOf(client, cs));
    if (keys.length) out.push({ client, marks: keys.map((item_key) => ({ item_key, state: 'done', note: AUTO_NOTE })) });
  }
  return out;
}
