// The order of the editors' page (editor.html), the owner's requests of 4.11.2026 (docs/ops.md,
// section 97). Pure logic, used by app/editor.js:
//   - what already left the editor and waits for someone else (with Ofir for his check, with the
//     client for approval, with Ilai) goes into one closed fold at the end, "מחכים לבדיקה (N)";
//   - both lists by the date the job was assigned to the editor, oldest first (the default) or
//     newest first, remembered on the device; the order of before (by the deadline) breaks a tie.

// The states of app/production.js editorState that wait for someone else.
export const WAITS_FOR_OTHERS = ['qa', 'client', 'ilai'];
export const waitsForOthers = (job) => WAITS_FOR_OTHERS.includes(job?.st?.key);
// { mine, waiting }: the jobs the editor works on, and the fold's, each in the order given.
export function splitJobs(jobs) {
  const mine = [];
  const waiting = [];
  for (const j of jobs || []) (waitsForOthers(j) ? waiting : mine).push(j);
  return { mine, waiting };
}

const ms = (v) => { const t = Date.parse(v ?? ''); return Number.isFinite(t) ? t : null; };
// When the job was assigned to the editor (ms), or null: the time of "הלקוח שויך לעורך"
// (p22a.assigned) of the job's own prefix; a monthly editing round, its own start (start_at,
// app/protocol-logic.js roundContext keeps it as char_at).
export function assignedTime(job, checks) {
  if (job?.ctx?.monthly) return ms(job.ctx.char_at);
  return ms(checks?.[`${job?.pre || ''}p22a.assigned`]?.at);
}
// The jobs by that date: 'old' (the default) oldest first, 'new' newest first. A tie keeps the
// order given (today's order); a job with no date goes last. A new list; the given one untouched.
export function byAssigned(jobs, checksOf, dir = 'old') {
  const sign = dir === 'new' ? -1 : 1;
  return (jobs || []).map((j, i) => ({ j, i, t: assignedTime(j, checksOf(j)) }))
    .sort((a, b) => ((a.t === null) - (b.t === null)) || (a.t !== null && b.t !== null ? sign * (a.t - b.t) : 0) || (a.i - b.i))
    .map((x) => x.j);
}

// Since when a job of the fold waits: with Ofir, from the hand-off (editorState's `since`); with
// the client, from Ofir's approval (p25.approved); with Ilai, from the final versions (p27.final).
export function sinceOf(job, checks) {
  const at = (k) => checks?.[`${job.pre || ''}${k}`]?.at || null;
  switch (job?.st?.key) {
    case 'qa': return job.st.since || null;
    case 'client': return at('p25.approved');
    case 'ilai': return at('p27.final');
    default: return null;
  }
}

// The order, remembered on this device (localStorage; private mode or blocked storage: the default).
export const SORT_KEY = 'astrateg.editor.sort';
const store = () => { try { return globalThis.localStorage ?? null; } catch { return null; } };
export function readSort(storage = store()) {
  try { return storage?.getItem(SORT_KEY) === 'new' ? 'new' : 'old'; } catch { return 'old'; }
}
export function saveSort(dir, storage = store()) {
  try { storage?.setItem(SORT_KEY, dir === 'new' ? 'new' : 'old'); } catch { /* not remembered: the page still works */ }
}
