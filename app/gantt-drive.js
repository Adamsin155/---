// "משיכת קישורים מהדרייב" in the content Gantt (gantt.html?id=…; the owner's request of
// 29.10.2026; docs/ops.md, section 74). One tap: the drive function lists the client's Drive
// folder (names and links only), app/drive-links.js matches the files to the Gantt's items by the
// date at the start of each name, and only the items with no link get one: a link already in the
// Gantt is never replaced (the owner's rule), and the database is asked the same (the update
// touches a row only while its link is still empty). The writes are the person's own (row level
// security: Ilai, Irit and the owners change the Gantt). Then a short summary under the title:
// "קושרו N", "כבר היה קישור: N", and what was not placed.
import { supabase } from './supa.js';
import { h } from './quote-doc.js';
import { matchFiles } from './drive-links.js';
import { addDays, contractEndKey } from './gantt-logic.js';
import { dayKeyIL } from './tz.js';
import { icon } from './kit.js';

export const DRIVE_BUTTON = 'משיכת קישורים מהדרייב';
const ERRORS = {
  drive_not_connected: 'הדרייב עוד לא מחובר. אחרי שהבעלים יחבר אותו, הכפתור יעבוד.',
  no_folder: 'אין קישור לתיקיית הדרייב בכרטיס הלקוח.',
  not_a_folder: 'הקישור לדרייב בכרטיס אינו קישור לתיקייה.',
  drive_auth: 'החיבור לדרייב נדחה. צריך לבדוק את ההגדרה.',
  not_allowed: 'את הגאנט מעדכנים עילאי, עירית, אופיר, ליאור ובעל המשרד.',
};
const errorOf = (code, robot) => (code === 'drive_no_access'
  ? `אין גישה לתיקייה. צריך לשתף אותה (צפייה) עם ${robot || 'חשבון הרובוט של אסטרטג'}.`
  : ERRORS[code] || 'הדרייב לא ענה כרגע. נסו שוב בעוד רגע.');

// The folder's files, or { error } in words.
async function listFiles(clientId) {
  const call = () => supabase.functions.invoke('drive', { body: { client_id: clientId } });
  let { data, error } = await call();
  if (error && error.context?.status === 401) { await supabase.auth.refreshSession().catch(() => null); ({ data, error } = await call()); }
  if (error) {
    let body = {};
    try { body = await error.context.json(); } catch { /* no body */ }
    return { error: errorOf(String(body.error || ''), body.robot) };
  }
  return Array.isArray(data?.files) ? { files: data.files } : { error: errorOf('') };
}

// A new row for a dated file with no row of its kind within a day (11.11.2026; docs/ops.md,
// section 128): planned, with the file's link. A number someone took meanwhile: the next one.
async function addRow(clientId, c, cols) {
  for (let n = c.num, tries = 0; tries < 5; n += 1, tries += 1) {
    const title = c.kind === 'video' ? `סרטון ${n}` : `גרפיקה ${n}`;
    const { data, error } = await supabase.from('client_gantt').insert({ client_id: clientId, key: `${c.kind}.${n}`, kind: c.kind, num: n, title, day: c.day, time_il: c.time_il, link: c.link, state: 'planned' }).select(cols).single();
    if (!error) return data;
    if (error.code !== '23505') throw error;
  }
  throw new Error('no free number');
}

// Only while the link is still empty: never over a link someone put meanwhile.
async function fillLink(id, link, cols) {
  const { data, error } = await supabase.from('client_gantt').update({ link }).eq('id', id).or('link.is.null,link.eq.').select(cols);
  if (error) throw error;
  return Array.isArray(data) ? data[0] || null : data;
}

const dm = (key) => `${Number(key.slice(8))}.${Number(key.slice(5, 7))}`;

// The summary under the title.
function summaryNode(plan, linked, failed, { kinds, onClose, added = 0 }) {
  const closeBtn = h('button', { type: 'button', class: 'btn btn-sm btn-ghost gd-close', onclick: onClose }, 'סגירה');
  const counts = h('ul', { class: 'gd-counts' },
    h('li', { class: 'gd-count is-ok' }, h('strong', {}, String(linked)), ' קושרו'),
    added ? h('li', { class: 'gd-count is-ok' }, h('strong', {}, String(added)), ' נוספו לגאנט') : null,
    h('li', { class: 'gd-count' }, h('strong', {}, String(plan.already + failed.already)), ' כבר היה קישור'),
    h('li', { class: `gd-count${plan.unplaced.length ? ' is-warn' : ''}` }, h('strong', {}, String(plan.unplaced.length)), ' לא שובצו'));
  const lines = [];
  if (plan.unplaced.length) {
    lines.push(h('details', { class: 'gd-more', open: plan.unplaced.length <= 6 },
      h('summary', {}, `קבצים שלא שובצו (${plan.unplaced.length})`),
      h('ul', { class: 'gd-list' }, plan.unplaced.slice(0, 60).map((u) => h('li', {}, h('span', { class: 'gd-name', dir: 'auto' }, u.name), h('span', { class: 'gd-why' }, u.why))))));
  }
  if (plan.empty.length) {
    lines.push(h('details', { class: 'gd-more' },
      h('summary', {}, `פריטים בלי קובץ (${plan.empty.length})`),
      h('ul', { class: 'gd-list' }, plan.empty.slice(0, 60).map((r) => h('li', {}, h('span', { class: 'gd-name' }, `${dm(r.day)} · ${r.title || kinds[r.kind]?.label || ''}`))))));
  }
  if (failed.count) lines.push(h('p', { class: 'gd-fail' }, `${failed.count} לא נשמרו. נסו שוב.`));
  if (!linked && !added && !plan.already && !plan.unplaced.length) lines.push(h('p', { class: 'gd-hint' }, 'לא נמצאו בתיקייה קבצים ששמם מתחיל בתאריך (למשל ״15.11 רילס.mp4״).'));
  return [
    h('div', { class: 'gd-head' }, h('h2', { id: 'gd-h' }, 'קישורים מהדרייב'), closeBtn),
    counts, ...lines,
  ];
}

// The button, for the hero's actions. ctx: { client, rows(), setRows(rows), cols, kinds, today(), redraw(), toast }.
export function driveButton(ctx) {
  const btn = h('button', { type: 'button', class: 'btn btn-sm', id: 'btn-drive' }, icon('link', { size: 16 }), DRIVE_BUTTON);
  btn.addEventListener('click', async () => {
    if (btn.disabled) return;
    btn.disabled = true;
    btn.setAttribute('aria-busy', 'true');
    const panel = document.getElementById('gt-drive');
    try {
      const got = await listFiles(ctx.client.id);
      if (got.error) {
        panel.replaceChildren(h('div', { class: 'gd-head' }, h('h2', { id: 'gd-h' }, 'קישורים מהדרייב'), h('button', { type: 'button', class: 'btn btn-sm btn-ghost gd-close', onclick: () => { panel.hidden = true; } }, 'סגירה')), h('p', { class: 'gd-fail' }, got.error));
        panel.hidden = false;
        panel.focus({ preventScroll: false });
        return;
      }
      const deal = ctx.client.deal_at ? dayKeyIL(new Date(ctx.client.deal_at)) : null;
      const end = contractEndKey(ctx.client);
      const plan = matchFiles(ctx.rows(), got.files, { upTo: addDays(ctx.today(), 7), range: deal && end ? { from: deal, to: end } : null });
      let linked = 0;
      const failed = { count: 0, already: 0 };
      let rows = ctx.rows();
      for (const f of plan.fills) {
        try {
          const row = await fillLink(f.id, f.link, ctx.cols);
          if (row) { linked += 1; rows = rows.map((r) => (r.id === f.id ? { ...r, ...row } : r)); } else failed.already += 1;
        } catch { failed.count += 1; }
      }
      let added = 0;
      for (const c of plan.creates || []) {
        try {
          const row = await addRow(ctx.client.id, c, ctx.cols);
          if (row) { added += 1; rows = [...rows, row]; }
        } catch { failed.count += 1; }
      }
      ctx.setRows(rows);
      ctx.redraw();
      panel.replaceChildren(...summaryNode(plan, linked, failed, { kinds: ctx.kinds, added, onClose: () => { panel.hidden = true; } }));
      panel.hidden = false;
      panel.focus({ preventScroll: false });
      ctx.toast(linked || added ? [linked ? `קושרו ${linked} קישורים מהדרייב.` : '', added ? `נוספו ${added} פריטים לגאנט.` : ''].filter(Boolean).join(' ') : 'לא נוספו קישורים.');
    } finally {
      btn.disabled = false;
      btn.removeAttribute('aria-busy');
    }
  });
  return btn;
}
