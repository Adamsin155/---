// "עבודה לפי עובד" on the manager view (owner.html#work; the owner, 30.10.2026: "נגיד יום ראשון
// אני יכול לראות מה נעשה כאשר אני נכנס לעילאי"; docs/ops.md, section 82). Who did what on which
// day, per employee and client, counted from what the system already records. Pure: no DOM, no
// network, Israel time. No money, and no contact details.
//   - marks:    public.protocol_log, the items of the protocol marked done by an employee;
//   - files:    public.client_files, the graphics and videos uploaded to the client's file;
//   - progress: public.editor_progress_log, the videos an editor wrote on their card, from the
//               day it was switched on (20261119100000_work_history.sql).
import { PEOPLE, PROCESSES, STAFF_PEOPLE } from './protocol.js';
import { clientLabel, IMPORT_NOTE } from './protocol-logic.js';
import { AUTO_DRIVE_NOTE } from './auto-assign.js';
import { isOwnerView } from './team-rules.js';
import { dayKeyIL } from './tz.js';

// How far one load goes back, and how much "ימים קודמים" adds.
export const WORK_DAYS = 30;
// The managers who see it: the owners, Lior and Ofir.
const WORK_READERS = ['lior', 'ofir'];
export const canSeeWorkHistory = (v) => isOwnerView(v) || (!!v && !v.error && v.scope === 'office' && WORK_READERS.includes(v.me));

// The marks that are worth their own words; any other item counts as work on a step.
const NAMED = {
  'p22a.assigned': { one: 'שיוך עורך', many: (n) => `${n} שיוכי עורך` },
  'p24.notify': { one: 'לקוח הועבר לבקרה', many: (n) => `${n} לקוחות הועברו לבקרה` },
  'p25.approved': { one: 'בקרת סרטונים אושרה', many: (n) => `${n} בקרות סרטונים אושרו` },
  'p26.sent': { one: 'סרטונים נשלחו ללקוח', many: (n) => `סרטונים נשלחו ל־${n} לקוחות` },
  'p27.approved': { one: 'לקוח אישר סרטונים', many: (n) => `${n} לקוחות אישרו סרטונים` },
  'p28.scheduled': { one: 'תזמון אחד', many: (n) => `${n} תזמונים` },
  'p29.filled': { one: 'גאנט אחד מולא', many: (n) => `${n} גאנטים מולאו` },
  'p29.sent': { one: 'גאנט אחד נשלח', many: (n) => `${n} גאנטים נשלחו` },
};
const word = (n, w) => (n === 1 ? w.one : w.many(n));
const GRAPHICS = { one: 'גרפיקה אחת', many: (n) => `${n} גרפיקות` };
const UPLOADED = { one: 'סרטון אחד הועלה', many: (n) => `${n} סרטונים הועלו` };
const EDITED = { one: 'סרטון אחד נערך', many: (n) => `${n} סרטונים נערכו` };
const STEPS = { one: 'שלב אחד', many: (n) => `${n} שלבים` };
const MORE_STEPS = { one: 'עוד שלב אחד', many: (n) => `עוד ${n} שלבים` };

const baseKey = (key) => String(key || '').replace(/^r\d+\./, '');
const PROC_OF = new Map(PROCESSES.flatMap((p) => p.items.map((i) => [i.key, p])));
// A mark nobody did by hand: brought in by the import, or closed by another mark.
const byItself = (note) => note === IMPORT_NOTE || note === AUTO_DRIVE_NOTE || String(note || '').startsWith('נסגר לבד');

// The marks that stand: `log` in order of time; "cleared" takes back the mark it follows.
export function standingMarks(log = []) {
  const open = new Map();
  for (const r of log) {
    const k = `${r.client_id}|${r.item_key}`;
    if (r.action === 'done') open.set(k, r);
    else open.delete(k);
  }
  return [...open.values()];
}

// → [{ person, name, days: [{ day, line, clients: [{ cid, name, lines }] }] }], every employee of
// the office in the protocol's order; the newest day first, and days with nothing are not listed.
export function workHistory({ log = [], files = [], progress = [], clients = [], personOf = () => null } = {}) {
  const labels = new Map(clients.map((c) => [c.id, clientLabel(c)]));
  const people = new Map();
  const cell = (person, day, cid) => {
    if (!people.has(person)) people.set(person, new Map());
    const days = people.get(person);
    if (!days.has(day)) days.set(day, new Map());
    const cs = days.get(day);
    if (!cs.has(cid)) cs.set(cid, { graphics: 0, uploaded: 0, edited: 0, named: new Map(), steps: new Map() });
    return cs.get(cid);
  };
  for (const r of standingMarks(log)) {
    const key = baseKey(r.item_key);
    const proc = PROC_OF.get(key);
    const person = personOf(r.by_email);
    if (!proc || !PEOPLE[person] || byItself(r.note)) continue;
    const c = cell(person, dayKeyIL(new Date(r.at)), r.client_id);
    if (NAMED[key]) c.named.set(key, (c.named.get(key) || 0) + 1);
    else c.steps.set(proc.id, proc.title);
  }
  for (const f of files) {
    const person = personOf(f.uploaded_by);
    if (!PEOPLE[person] || f.deleted_at) continue;
    const kind = f.kind === 'deliverable_graphic' ? 'graphics' : f.kind === 'deliverable_video' ? 'uploaded' : null;
    if (kind) cell(person, dayKeyIL(new Date(f.created_at)), f.client_id)[kind] += 1;
  }
  // A correction may lower the number: what counts is the day's sum per client, never below zero.
  const net = new Map();
  for (const r of progress) {
    const k = `${r.editor}|${r.day}|${r.client_id}`;
    net.set(k, { ...r, delta: (net.get(k)?.delta || 0) + (Number(r.delta) || 0) });
  }
  for (const r of net.values()) if (r.delta > 0 && PEOPLE[r.editor]) cell(r.editor, r.day, r.client_id).edited += r.delta;

  return STAFF_PEOPLE().filter((p) => p.key).map((p) => ({
    person: p.key,
    name: p.name,
    days: [...(people.get(p.key) || new Map()).entries()]
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([day, cs]) => ({
        day,
        line: dayLine([...cs.values()]),
        clients: [...cs.entries()].map(([cid, c]) => ({ cid, name: labels.get(cid) || 'לקוח שכבר לא במערכת', lines: clientLines(c) }))
          .sort((a, b) => a.name.localeCompare(b.name, 'he')),
      })),
  }));
}

const counted = (list) => list.reduce((sum, c) => sum + c, 0);
// The steps of a client's day, without a process its named mark already says ("שיוך עורך", not also its process).
const stepsOf = (c) => {
  const said = new Set([...c.named.keys()].map((k) => PROC_OF.get(k).id));
  return [...c.steps].filter(([id]) => !said.has(id)).map(([, title]) => title);
};
// "4 גרפיקות, 2 גאנטים נשלחו, עוד 3 שלבים": the one line of a day.
export function dayLine(cells) {
  const parts = [];
  const add = (n, w) => { if (n) parts.push(word(n, w)); };
  add(counted(cells.map((c) => c.edited)), EDITED);
  add(counted(cells.map((c) => c.graphics)), GRAPHICS);
  add(counted(cells.map((c) => c.uploaded)), UPLOADED);
  for (const key of Object.keys(NAMED)) add(counted(cells.map((c) => c.named.get(key) || 0)), NAMED[key]);
  const steps = counted(cells.map((c) => stepsOf(c).length));
  add(steps, parts.length ? MORE_STEPS : STEPS);
  return parts.join(', ');
}
// The lines of one client on that day.
function clientLines(c) {
  const out = [];
  const add = (n, w) => { if (n) out.push(word(n, w)); };
  add(c.edited, EDITED);
  add(c.graphics, GRAPHICS);
  add(c.uploaded, UPLOADED);
  for (const key of Object.keys(NAMED)) add(c.named.get(key) || 0, NAMED[key]);
  return [...out, ...stepsOf(c)];
}

// The line beside an employee in the list: the last day they did something.
export function lastWork(person, today) {
  const last = person.days[0];
  if (!last) return null;
  return { day: last.day, isToday: last.day === today, line: last.line };
}
