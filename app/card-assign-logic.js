// "שיוך עורך" from the client card (the owner, 29.10.2026: "צריך לעשות אופציה לעשות שיוך
// עורך מתוך התיק לקוח"). 28 old clients came in with 22א marked by the import and no editor
// in the card; from now on any client without an editor can be given one from its card.
// Who: the people who assign in "בקרה ושיוך" (Ofir, the owners), Lior who supervises it, and
// Irit (the owner, the same day: "ותתן אופציה גם לעירית"). All of them write every protocol
// item already (private.protocol_writers '@office'), so the database needs nothing new.
// The dialog itself is qa.html's (app/assign-dialog.js). No DOM here: tests/card-assign.test.mjs.
import { isOwnerView } from './team-rules.js';
import { editorName, reasonNote } from './qa-logic.js';

export const CARD_ASSIGNERS = ['ofir', 'lior', 'irit'];
export const canAssignFromCard = (v) => isOwnerView(v)
  || (!!v && !v.error && v.scope === 'office' && CARD_ASSIGNERS.includes(v.me));

const inWork = (c) => c?.status === 'active' || c?.status === 'ending';

// What the card offers beside "עורך" (the client's own shoot, not a round's), or null:
//  'first'  22א is open and its turn came: exactly qa.html's first assignment (marks 22א, clocks start).
//  'record' 22א is marked (the import marked it) but no editor is written: the editor is
//           recorded, the mark and every deadline stay as they are.
//  'early'  22א's turn has not come (the shoot is ahead): the editor is written in the card,
//           and qa.html suggests them ("רשום בכרטיס") when the time comes. No clocks.
//  'change' an editor is written: "שינוי" (the swap of qa.html when the editing is on).
export function cardAssignMode({ viewer, client, checks = {}, state = null }) {
  if (!canAssignFromCard(viewer) || !inWork(client)) return null;
  if (client.editor) return 'change';
  if (checks['p22a.assigned']?.state === 'done') return 'record';
  const s = state?.states?.find((x) => x.proc.id === 'p22a') || null;
  return s?.ready && !s.complete ? 'first' : 'early';
}

// "החזרה לשיוך" (the owner, 4.11.2026: a client assigned by mistake): the editor leaves the card and
// 22א opens again, so the client is back on qa.html's "מחכים לשיוך עורך". Irit, Ofir and the owners.
// What the editor already marked stays in the history (and counts again once someone is assigned).
export const UNASSIGNERS = ['ofir', 'irit', 'lior']; // Lior since 4.11.2026 (the managers)
export const canUnassign = (v) => isOwnerView(v) || (!!v && !v.error && v.scope === 'office' && UNASSIGNERS.includes(v.me));
// The marks of the assignment that are taken back (the client's own shoot; a round's carry its prefix).
export const UNASSIGN_KEYS = (pre = '') => ['p22a.assigned', 'p22a.load', 'p22a.irit', 'p22a.reason', 'p22a.handoff.editor'].map((k) => pre + k);
export const unassignable = (client, checks = {}) => !!client?.editor && inWork(client);
// Whether the editor already started (then the card says so before it asks).
export const editorStarted = (checks = {}, pre = '') => checks[`${pre}p22.received`]?.state === 'done';

// The reason mark of an editor recorded on a 22א that was already marked: the time of the
// mark is kept, and the words say so in the client's history.
export function recordNote({ editor, reason = '', from = null }) {
  const why = String(reason || '').trim();
  const text = [from ? `העורך עודכן מתוך תיק הלקוח: מ${editorName(from)} ל${editorName(editor)}` : `העורך נרשם מתוך תיק הלקוח: ${editorName(editor)}`,
    why || null, 'המועדים לא השתנו'].filter(Boolean).join(' · ');
  return JSON.stringify({ ...JSON.parse(reasonNote({ editor, reason: text })), card: true, kept: true, from: from || null });
}
