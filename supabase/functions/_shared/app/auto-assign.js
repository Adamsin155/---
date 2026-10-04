// generated — edit app/ instead. Source: app/auto-assign.js. Regenerate: node scripts/sync-functions.mjs
// Automatic work distribution (the owner's decision of 3.10.2026, item 6): when a
// shoot day is closed (19 done, the client's or an extra round's) and no editor
// was assigned yet, the server assigns one by itself, so it happens even when
// nobody opens the app. The same rule Ofir's screen proposes (app/qa-logic.js):
// Natali's shoot goes to Nirel (preselected); any other to the editor with the
// least active editing (then the fewest open tasks) among Nadia, Yariv and Anna.
// An editor the office already put in the card is kept. Ofir can still change it
// (the assignment dialog in qa.html, the card, or Lior's reassign in decisions.html).
//
// Pure, no DOM and no network: the reminders tick (supabase/functions/reminders/
// tick.js) plans with it and writes the plan with the service role: the editor on
// the client (or the round), the marks 22א load/assigned and Irit's check, the
// reason (with `auto: true`, which the reminder `autoAssigned` reads to tell Ofir),
// and Ofir's folder task (24) as qa.html opens it.
// Characterizations need no code here: clients.characterizer defaults to 'ofir' in
// the database (migration 20261003100000_sales_deals.sql).
import {
  awaitingEditor, editorLoad, proposeEditor, preselected, reasonNote, folderTitle, folderDueOn,
} from './qa-logic.js';
import { REASON_KEY, readJson } from './office-marks.js';
import { withEditor } from './decisions-logic.js';
import { isImported } from './protocol-logic.js';

export const AUTO_REASON = 'שיוך אוטומטי בסיום יום הצילום, לפי העומס';
export const AUTO_CHECK_NOTE = 'שויך אוטומטית בסיום יום הצילום';

// The reason mark of an automatic assignment ({ editor, auto: true, … }), or null.
export function autoReasonOf(checks, pre = '') {
  const r = readJson(checks?.[REASON_KEY(pre)]);
  return r && r.auto === true && r.editor ? r : null;
}

// What to write now: [{ clientId, client, pre, n, editor, kept, patch, checks: [{ key, note }],
// reason: { key, note }, task }]. `patch` is the clients update (null when the card
// already had that editor); `task` Ofir's folder task, or null.
export function planAutoAssign({ clients = [], stateOf, checks = {}, tasks = [], now = new Date() }) {
  const load = editorLoad({ clients, stateOf, checks, tasks, now });
  const out = [];
  for (const a of awaitingEditor({ clients, stateOf, checks })) {
    const cs = checks[a.client.id] || {};
    const p19 = stateOf(a.client).states.find((s) => s.proc.id === `${a.n ? `r${a.n}-` : ''}p19`);
    // Only a shoot day closed for real: imported history is not an event.
    if (!p19?.complete || isImported(p19.proc, cs)) continue;
    const type = a.ctx.shoot_type;
    const kept = a.ctx.editor || null;
    const editor = kept || preselected(type) || proposeEditor(load, type === 'natali' ? 'natali' : 'dms');
    if (!editor) continue;
    // The next assignment in this same plan sees this one.
    load[editor]?.jobs.push({ client: a.client, n: a.n, paused: null });
    const title = folderTitle(a.n);
    const folderOpen = cs[`${a.pre}p24.folder`]?.state === 'done'
      || tasks.some((t) => t.client_id === a.client.id && t.title === title && !t.done_at);
    const note = JSON.stringify({ ...JSON.parse(reasonNote({ editor, reason: AUTO_REASON, preselected: preselected(type) })), auto: true, kept: !!kept });
    out.push({
      clientId: a.client.id, client: a.client, pre: a.pre, n: a.n, editor, kept: !!kept,
      patch: kept ? null : withEditor(a.client, a.n, editor),
      checks: [
        { key: `${a.pre}p22a.load`, note: AUTO_CHECK_NOTE },
        { key: `${a.pre}p22a.assigned`, note: AUTO_CHECK_NOTE },
        { key: `${a.pre}p22a.irit`, note: 'נסגר לבד: השיוך נרשם במערכת' },
      ],
      reason: { key: REASON_KEY(a.pre), note },
      task: folderOpen ? null : { client_id: a.client.id, title, owner: 'ofir', due_on: folderDueOn(now) },
    });
  }
  return out;
}
