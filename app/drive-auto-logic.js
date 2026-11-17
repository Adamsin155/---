// What the clients' Google Drive folders show is done, marked by the system so that nobody has to
// tick it (the owner, 17.11.2026; docs/ops.md, section 141). The Drive scan (supabase/functions/
// drive-scan, every 10 minutes, a few clients a tick) lists a client's folder, writes the day's
// counts (public.drive_daily), and then asks this module what that folder proves:
//
//   folder    "יש תיקייה מסודרת בדרייב עם שם הלקוח" (p24.folder, rN.p24.folder): the card has a
//             link to a folder and the robot just opened it;
//   videos    "כל הסרטונים הועלו לדרייב של הלקוח" (p24.drive, rN.p24.drive): the edited videos
//             (drive_daily kind 'video': not footage, app/drive-class.js fileClass) added on or
//             after the deal day reach what the shoot needs. The number needed is the one the
//             check of a person's mark uses (app/drive-guard-logic.js neededFor, branch
//             fix/track-sync): round 1 its part, round N the parts of 1..N up to the package, a
//             monthly round that month's number (and only that month's files count). A number
//             that is not known marks nothing (the person's check asks for one video; the system
//             does not guess);
//   first9    "9 גרפיקות הוכנו לפי האפיון ושפת העסק" (p07.made): graphics (kind 'graphic', not a
//             highlights folder: app/gfx-auto-logic.js) since the deal day, at least
//             min(9, the package's graphics);
//   rest      "כל הגרפיקות לפי החבילה הושלמו" (p23.made): at least the package's graphics. Its
//             guard `graphicsCount` only ASKS a person with fewer than the package; here the count
//             is the package's, so nothing is asked over. `noBulk` keeps it out of "mark the whole
//             process"; this is one mark from its own evidence, as p24.notify (app/editor-auto.js);
//   raw       the footage after a shoot day: no step of the protocol is about Google Drive (19,
//             19ב, 22 speak of "הכונן", the physical drive), so nothing is marked (RAW_STEP null);
//   gantt     the content Gantt's empty links, as "משיכת קישורים מהדרייב" (app/drive-links.js
//             matchFiles, the same call as app/gantt-drive.js): fills only, never a link over a
//             link, and no new rows ("creates" are left to the person's tap: a row the system
//             adds by itself changes the client's plan).
//
// When a mark is written (all of these are inserts, never over a mark that exists: a person's
// "done" or "לא רלוונטי" stays):
//   - the item is live for the client (not retired, not passed) and has no mark at all;
//   - 24: the shoot was handed to an editor (`${pre}p22a.assigned` resolved; a round with no such
//     item: an editor on it), so a folder is not "the editor's" before the editing;
//   - 7 and 23: the process started (its start time is behind us: the characterization ended, the
//     shoot day passed), it is not complete, and nothing else of it (or of 7ב / 23ב) was marked
//     yet: the graphics then go to Ofir's check on his fast ladder exactly as after Ilai's
//     "מוכן לבדיקה", and a client long past it is not sent back to him;
//   - 23 only after 7's own mark (p07.made resolved, or written in the same plan).
// Pure, no DOM and no network (tests/drive-auto.test.mjs); the scan has a copy
// (node scripts/sync-functions.mjs).
import { isResolved } from './protocol-logic.js';
import { editorsOf } from './protocol.js';
import { neededFor } from './drive-guard-logic.js';
import { dealDayOf } from './package-parts.js';
import { isHighlightFolder } from './gfx-auto-logic.js';
import { matchFiles } from './drive-links.js';
import { addDays, contractEndKey } from './gantt-logic.js';
import { dayKeyIL } from './tz.js';

export const RULES = ['folder', 'videos', 'first9', 'rest', 'raw', 'gantt'];
// No protocol step says the footage was put in Google Drive (see above).
export const RAW_STEP = null;
export const FIRST_BATCH = 9;

export const NOTES = {
  folder: 'סומן אוטומטית: תיקיית הדרייב של הלקוח נפתחה',
  videos: (n, of) => `סומן אוטומטית: ${n} סרטונים ערוכים בדרייב (צריך ${of})`,
  graphics: (n, of) => `סומן אוטומטית: ${n} גרפיקות בדרייב (צריך ${of})`,
};
// Every note the system writes here starts so (the card and the history show it as the system's).
export const AUTO_PREFIX = 'סומן אוטומטית';

const whole = (v) => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : null; };

// What the client's drive_daily rows ({ day, folder, kind, files }) hold, counted from `from`
// ('YYYY-MM-DD', the deal day; null: everything), only in `month` ('YYYY-MM') when given.
export function countDaily(rows, kind, { from = null, month = null } = {}) {
  let n = 0;
  for (const r of rows || []) {
    if (r?.kind !== kind) continue;
    if (kind === 'graphic' && isHighlightFolder(r.folder)) continue;
    const day = String(r.day || '').slice(0, 10);
    if (!day || (from && day < from) || (month && day.slice(0, 7) !== month)) continue;
    n += Number(r.files) || 0;
  }
  return n;
}

const itemOf = (s, key) => s?.proc?.items?.find((i) => i.key === key) || null;
const baseOf = (s) => String(s?.proc?.id || '').replace(/^r\d+-/, '');
const preOf = (s) => (s.proc.keyBase || s.proc.id).slice(0, -baseOf(s).length);

// The marks for one client now: [{ item_key, state: 'done', note, rule, count, needed }].
//   client   the clients row; checks { item_key: row } (protocol_checks of the client);
//   state    clientState(client, checks, now); daily: the client's drive_daily rows;
//   folderOk the robot opened the folder in this run.
export function driveMarks({ client, checks = {}, state, daily = [], folderOk = false, now = new Date() }) {
  if (!client || !state || !['active', 'ending'].includes(client.status)) return [];
  const out = [];
  const free = (key) => !checks[key] && !out.some((m) => m.item_key === key);
  const resolved = (s, key) => { const i = itemOf(s, key); return i ? isResolved(i, checks[key], now) : false; };
  const from = dealDayOf(client);
  const states = state.states || [];

  // 24, each shoot (the client's own, and each round).
  for (const s of states.filter((x) => baseOf(x) === 'p24')) {
    const pre = preOf(s);
    const s22a = states.find((x) => x.proc.id === `${s.proc.id.slice(0, -3)}p22a`);
    const assigned = itemOf(s22a, `${pre}p22a.assigned`)
      ? resolved(s22a, `${pre}p22a.assigned`)
      : editorsOf(s.proc.ctx || client).length > 0;
    if (!assigned || !folderOk) continue;
    const fk = `${pre}p24.folder`;
    if (itemOf(s, fk) && free(fk)) out.push({ item_key: fk, state: 'done', note: NOTES.folder, rule: 'folder', count: 1, needed: 1 });
    const dk = `${pre}p24.drive`;
    if (!itemOf(s, dk) || !free(dk)) continue;
    const { needed, month } = neededFor(client, dk, now);
    if (!needed) continue;
    const count = countDaily(daily, 'video', { from, month });
    if (count >= needed) out.push({ item_key: dk, state: 'done', note: NOTES.videos(count, needed), rule: 'videos', count, needed });
  }

  // 7 and 23: the client's own graphics (not a round's).
  const graphics = whole(client.deliverables?.graphics);
  if (graphics) {
    const count = countDaily(daily, 'graphic', { from });
    const plan = [
      { proc: 'p07', key: 'p07.made', rule: 'first9', needed: Math.min(FIRST_BATCH, graphics), after: ['p07b'] },
      { proc: 'p23', key: 'p23.made', rule: 'rest', needed: graphics, after: ['p23b'], requires: 'p07.made' },
    ];
    for (const p of plan) {
      const s = states.find((x) => x.proc.id === p.proc);
      if (!s || !itemOf(s, p.key) || !free(p.key) || s.complete || s.wait) continue;
      if (!s.startAt || s.startAt > now) continue;
      const family = [p.proc, ...p.after].map((id) => `${id}.`);
      if (Object.keys(checks).some((k) => k !== p.key && family.some((f) => k.startsWith(f)) && checks[k])) continue;
      if (p.requires) {
        const s07 = states.find((x) => x.proc.id === 'p07');
        const ok = !itemOf(s07, p.requires) || resolved(s07, p.requires) || out.some((m) => m.item_key === p.requires);
        if (!ok) continue;
      }
      if (count >= p.needed) out.push({ item_key: p.key, state: 'done', note: NOTES.graphics(count, p.needed), rule: p.rule, count, needed: p.needed });
    }
  }
  return out;
}

// The Gantt's empty links this listing fills, as the button does ([{ id, link, file, day }]).
//   rows: client_gantt rows ({ id, kind, key, day, time_il, num, link }); files: the Drive
//   listing ({ name, mimeType, createdTime, link, path }).
export function ganttFills(client, rows, files, now = new Date()) {
  if (!client || !Array.isArray(rows) || !rows.length || !Array.isArray(files) || !files.length) return [];
  const deal = client.deal_at ? dayKeyIL(new Date(client.deal_at)) : null;
  const end = contractEndKey(client);
  const plan = matchFiles(rows, files, { upTo: addDays(dayKeyIL(now), 7), range: deal && end ? { from: deal, to: end } : null });
  return plan.fills.map(({ id, link, file, day }) => ({ id, link, file, day }));
}
