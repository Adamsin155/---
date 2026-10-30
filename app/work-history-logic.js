// "עבודה לפי עובד" on the manager view (owner.html#work; the owner, 30.10.2026: "נגיד יום ראשון
// אני יכול לראות מה נעשה כאשר אני נכנס לעילאי"; docs/ops.md, section 82). Who did what on which
// day, per employee and client, counted from what the system already records. Pure: no DOM, no
// network, Israel time. No money, and no contact details.
//   - marks:    public.protocol_log, the items of the protocol marked done by an employee;
//   - files:    public.client_files, the graphics and videos uploaded to the client's file;
//   - progress: public.editor_progress_log, the videos an editor wrote on their card, from the
//               day it was switched on (20261119100000_work_history.sql);
//   - drive:    public.drive_daily, the files added to the clients' Drive folders per day (section 83).
//               Drive does not say who added a file: a graphics folder counts as Ilai's and a
//               client's videos as its editor's, and the words say so.
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
const DRIVE_GRAPHICS = { one: 'קובץ אחד נוסף לתיקיית הגרפיקות', many: (n) => `${n} קבצים נוספו לתיקיית הגרפיקות` };
const DRIVE_VIDEOS = { one: 'סרטון אחד נוסף לדרייב (לפי העורך בכרטיס)', many: (n) => `${n} סרטונים נוספו לדרייב (לפי העורך בכרטיס)` };
// How many actions one line says; the rest is "ועוד N".
export const LINE_PARTS = 5;
const DRIVE_WORDS = {
  video: { one: 'סרטון אחד', many: (n) => `${n} סרטונים` },
  graphic: { one: 'גרפיקה אחת', many: (n) => `${n} גרפיקות` },
  raw: { one: 'חומר גלם אחד', many: (n) => `${n} חומר גלם` },
  other: { one: 'קובץ אחר', many: (n) => `${n} אחרים` },
};

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
export function workHistory(input = {}) {
  const { people, labels } = workCells(input);
  return STAFF_PEOPLE().filter((p) => p.key).map((p) => ({
    person: p.key,
    name: p.name,
    days: [...(people.get(p.key) || new Map()).entries()]
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([day, cs]) => ({
        day,
        line: dayLine([...cs.values()]),
        clients: [...cs.entries()].map(([cid, c]) => ({ cid, name: labels.get(cid) || GONE, lines: clientLines(c) }))
          .sort((a, b) => a.name.localeCompare(b.name, 'he')),
      })),
  }));
}

const GONE = 'לקוח שכבר לא במערכת';
function workCells({ log = [], files = [], progress = [], drive = [], clients = [], personOf = () => null } = {}) {
  const labels = new Map(clients.map((c) => [c.id, clientLabel(c)]));
  const byId = new Map(clients.map((c) => [c.id, c]));
  const people = new Map();
  const cell = (person, day, cid) => {
    if (!people.has(person)) people.set(person, new Map());
    const days = people.get(person);
    if (!days.has(day)) days.set(day, new Map());
    const cs = days.get(day);
    if (!cs.has(cid)) cs.set(cid, { graphics: 0, uploaded: 0, edited: 0, driveGraphics: 0, driveVideos: 0, named: new Map(), steps: new Map() });
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
  // Drive: the graphics folders are Ilai's; finished videos, the one editor in the client's card.
  for (const r of drive) {
    const n = Number(r.files) || 0;
    if (n <= 0) continue;
    if (r.kind === 'graphic') cell('ilai', r.day, r.client_id).driveGraphics += n;
    const c = byId.get(r.client_id);
    if (r.kind === 'video' && c?.editor && !c.editor2 && PEOPLE[c.editor]) cell(c.editor, r.day, r.client_id).driveVideos += n;
  }
  return { people, labels };
}

const counted = (list) => list.reduce((sum, c) => sum + c, 0);
// The steps of a client's day, without a process its named mark already says ("שיוך עורך", not also its process).
const stepsOf = (c) => {
  const said = new Set([...c.named.keys()].map((k) => PROC_OF.get(k).id));
  return [...c.steps].filter(([id]) => !said.has(id)).map(([, title]) => title);
};
// "5 שיוכי עורך, 2 בקרות סרטונים אושרו, הכנת גאנט · 3 לקוחות, ועוד 2": the one line of a day,
// always actions in words: a process by its title and how many clients, never "13 שלבים".
export function dayLine(cells) {
  const parts = [];
  const add = (n, w) => { if (n) parts.push(word(n, w)); };
  add(counted(cells.map((c) => c.edited)), EDITED);
  add(counted(cells.map((c) => c.graphics)), GRAPHICS);
  add(counted(cells.map((c) => c.uploaded)), UPLOADED);
  add(counted(cells.map((c) => c.driveGraphics)), DRIVE_GRAPHICS);
  add(counted(cells.map((c) => c.driveVideos)), DRIVE_VIDEOS);
  for (const key of Object.keys(NAMED)) add(counted(cells.map((c) => c.named.get(key) || 0)), NAMED[key]);
  const titles = new Map();
  for (const c of cells) for (const t of stepsOf(c)) titles.set(t, (titles.get(t) || 0) + 1);
  for (const [t, n] of [...titles].sort((a, b) => b[1] - a[1])) parts.push(n === 1 ? t : `${t} · ${n} לקוחות`);
  const rest = parts.length - LINE_PARTS;
  return rest > 0 ? `${parts.slice(0, LINE_PARTS).join(', ')}, ועוד ${rest}` : parts.join(', ');
}
// The lines of one client on that day.
function clientLines(c) {
  const out = [];
  const add = (n, w) => { if (n) out.push(word(n, w)); };
  add(c.edited, EDITED);
  add(c.graphics, GRAPHICS);
  add(c.uploaded, UPLOADED);
  add(c.driveGraphics, DRIVE_GRAPHICS);
  add(c.driveVideos, DRIVE_VIDEOS);
  for (const key of Object.keys(NAMED)) add(c.named.get(key) || 0, NAMED[key]);
  return [...out, ...stepsOf(c)];
}

// "עלו 23 קבצים: 14 סרטונים, 9 גרפיקות, 40 חומר גלם".
const KINDS = ['video', 'graphic', 'raw', 'other'];
const kindsLine = (counts) => KINDS.filter((k) => counts[k]).map((k) => word(counts[k], DRIVE_WORDS[k])).join(', ');
export function filesLine(counts) {
  const total = KINDS.reduce((sum, k) => sum + (counts[k] || 0), 0);
  if (!total) return '';
  return `${total === 1 ? 'עלה קובץ אחד' : `עלו ${total} קבצים`}: ${kindsLine(counts)}`;
}

// "כל הימים": everything of a day for everyone, newest first.
// → [{ day, files: { video, graphic, raw, other }, filesLine, workLine,
//      clients: [{ cid, name, files (line), folders: ['גרפיקות: 9'], work: [{ person, name, lines }] }] }]
export function allDays(input = {}) {
  const { people, labels } = workCells(input);
  const days = new Map();
  const dayOf = (day) => {
    if (!days.has(day)) days.set(day, { day, files: { video: 0, graphic: 0, raw: 0, other: 0 }, cells: [], clients: new Map() });
    return days.get(day);
  };
  const clientOf = (d, cid) => {
    if (!d.clients.has(cid)) d.clients.set(cid, { cid, name: labels.get(cid) || GONE, counts: { video: 0, graphic: 0, raw: 0, other: 0 }, folders: new Map(), work: [] });
    return d.clients.get(cid);
  };
  for (const r of input.drive || []) {
    const n = Number(r.files) || 0;
    if (n <= 0 || !KINDS.includes(r.kind)) continue;
    const d = dayOf(r.day);
    d.files[r.kind] += n;
    const c = clientOf(d, r.client_id);
    c.counts[r.kind] += n;
    if (r.folder) c.folders.set(r.folder, (c.folders.get(r.folder) || 0) + n);
  }
  for (const p of STAFF_PEOPLE().filter((x) => x.key)) {
    for (const [day, cs] of people.get(p.key) || new Map()) {
      const d = dayOf(day);
      for (const [cid, cell] of cs) {
        // What the files already say is not said again as somebody's work.
        const done = { ...cell, driveGraphics: 0, driveVideos: 0 };
        const lines = clientLines(done);
        if (!lines.length) continue;
        d.cells.push(done);
        clientOf(d, cid).work.push({ person: p.key, name: p.name, lines });
      }
    }
  }
  return [...days.values()].sort((a, b) => b.day.localeCompare(a.day)).map((d) => ({
    day: d.day,
    files: d.files,
    filesLine: filesLine(d.files),
    workLine: dayLine(d.cells),
    clients: [...d.clients.values()].map((c) => ({
      cid: c.cid, name: c.name, files: kindsLine(c.counts),
      folders: [...c.folders].sort((a, b) => b[1] - a[1]).map(([f, n]) => `${f}: ${n}`),
      work: c.work,
    })).sort((a, b) => a.name.localeCompare(b.name, 'he')),
  }));
}

// What the Drive numbers do not cover, in plain names. `state` is null before the scan is on.
// → { on, at (the newest count), noLink: [names], failed: [names], scanned }
export function driveCoverage(clients = [], state = null) {
  const live = clients.filter((c) => c.status === 'active' || c.status === 'ending');
  const noLink = live.filter((c) => !c.links?.drive).map(clientLabel);
  if (!state) return { on: false, at: null, noLink, failed: [], scanned: 0 };
  const byId = new Map(state.map((s) => [s.client_id, s]));
  const withLink = live.filter((c) => c.links?.drive);
  const failed = withLink.filter((c) => byId.get(c.id)?.error).map(clientLabel);
  const waiting = withLink.filter((c) => !byId.has(c.id)).length;
  const newest = state.reduce((x, s) => (!x || s.scanned_at > x ? s.scanned_at : x), null);
  return { on: state.length > 0, at: newest ? new Date(newest) : null, noLink, failed, waiting, scanned: withLink.length - waiting - failed.length };
}

// The line beside an employee in the list: the last day they did something.
export function lastWork(person, today) {
  const last = person.days[0];
  if (!last) return null;
  return { day: last.day, isToday: last.day === today, line: last.line };
}
