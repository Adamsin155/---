// "מעקב לקוחות", the tab "משימות לעורכים ולגרפיקאי" (Irit, 10.11.2026). Self-contained:
//   import { renderTasksTab } from './tracking-tasks.js';  await renderTasksTab(hostElement);
// A table (cards on a phone) of the tasks given to the editors and to Ilai: the client, the kind
// (עריכה / גרפיקה), the task, the day it was put in, the due day, who, and "בתהליך" / "הושלם".
// Chips: הכל / עורכים / גרפיקאי and הכל / פתוחות / הושלמו. "משימה חדשה" opens the same form as
// "משימות לעובדים" in "המשימות שלי" (app/staff-tasks-ui.js, mountStaffTaskForm), limited to the
// people of the chip. Read-only otherwise: nothing is marked here.
// The rows: app/tracking-tasks-logic.js; docs/ops.md, section 122.
import { supabase, sessionEmail } from './supa.js';
import { h, fill, errorText, viewerOf } from './protocol-ui.js';
import { isManager } from './manager-rules.js';
import { icon, pill } from './kit.js';
import { mountStaffTaskForm } from './staff-tasks-ui.js';
import {
  TASK_PEOPLE, KINDS, STATES, KIND_TEXT, STATE_TEXT, PAGE_SIZE, DONE_DAYS,
  taskRows, filterTasks, chipCounts, shortDay, tasksWord, formPeople,
} from './tracking-tasks-logic.js';

const CLIENT_TASK_COLS = 'id, client_id, title, owner, due_on, done_at, created_at, brief';
const STAFF_COLS = 'id, created_at, assignee, body, client_id, client_name, status, done_at';
const PAGE = 1000;
const cardUrl = (id) => `client.html?id=${encodeURIComponent(id)}`;

async function all(build) {
  let out = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build().range(from, from + PAGE - 1);
    if (error) throw error;
    out = out.concat(data || []);
    if (!data || data.length < PAGE) return out;
  }
}

// ── Data ────────────────────────────────────
// The clients' names (any status: a task of a client that ended keeps its name), the client
// card's tasks, and the "משימות לעובדים" (each person reads the ones the database lets them:
// Irit and the owner all of those she gave; null before that table exists).
async function loadAll() {
  const owners = [...TASK_PEOPLE, 'editor'];
  const [clients, clientTasks, staffTasks] = await Promise.all([
    all(() => supabase.from('clients').select('id, name, business').order('id')),
    all(() => supabase.from('client_tasks').select(CLIENT_TASK_COLS).in('owner', owners).order('created_at')),
    loadStaff(),
  ]);
  return { clients: Object.fromEntries(clients.map((c) => [c.id, c])), clientTasks, staffTasks };
}
async function loadStaff() {
  const read = (cols) => all(() => supabase.from('staff_tasks').select(cols).in('assignee', TASK_PEOPLE).order('created_at'));
  try {
    return await read(`${STAFF_COLS}, brief`);
  } catch (err) {
    if (err?.code === '42703') return read(STAFF_COLS).catch(() => []);
    if (['42P01', 'PGRST205', 'PGRST204'].includes(err?.code)) return [];
    throw err;
  }
}

// ── The tab ─────────────────────────────────
const state = { host: null, viewer: null, rows: [], kind: 'all', status: 'all', shown: PAGE_SIZE, loaded: false };

function chipGroup(label, list, key, counts) {
  return h('div', { class: 'filters tt-chips', role: 'group', 'aria-label': label },
    ...list.map(([k, text]) => h('button', {
      type: 'button', class: 'chip', 'data-tt': key, 'data-v': k, 'aria-pressed': String(state[key] === k),
      onclick: () => { state[key] = k; state.shown = PAGE_SIZE; draw(); state.host.querySelector(`[data-tt="${key}"][data-v="${k}"]`)?.focus(); },
    }, text, h('span', { class: 'n' }, String(counts[k])))));
}

function kindChip(kind) {
  return h('span', { class: `tt-kind is-${kind}` }, icon(kind === 'graphic' ? 'image' : 'video', { size: 15 }), KIND_TEXT[kind]);
}

function row(r, now) {
  return h('tr', { 'data-id': r.id, 'data-kind': r.kind, 'data-state': r.state, class: `tt-row is-${r.state}` },
    h('td', { class: 'tt-client' }, r.clientId ? h('a', { class: 'mt-name', href: cardUrl(r.clientId) }, r.client)
      : h('span', { class: `mt-name${r.client ? '' : ' tt-none'}` }, r.client || 'בלי לקוח')),
    h('td', { 'data-label': 'סוג', class: 'tt-k' }, kindChip(r.kind)),
    h('td', { 'data-label': 'המשימה', class: 'tt-what' },
      h('span', { class: 'tt-title', dir: 'auto' }, r.title),
      r.brief ? h('span', { class: 'tt-brief', dir: 'auto' }, r.brief) : null),
    h('td', { 'data-label': 'הוכנסה', class: 'tt-d' }, h('span', { class: 'num', dir: 'ltr' }, shortDay(r.createdAt, now) || '—')),
    h('td', { 'data-label': 'תאריך יעד', class: 'tt-d' }, h('span', { class: 'num', dir: 'ltr' }, shortDay(r.dueOn, now) || '—')),
    h('td', { 'data-label': 'אחראי/ת', class: 'tt-who' }, r.who),
    h('td', { 'data-label': 'סטטוס', class: 'tt-s' }, pill(STATE_TEXT[r.state], r.state === 'done' ? 'ok' : 'info')));
}

function draw() {
  const { host } = state;
  if (!host) return;
  const now = new Date();
  const counts = chipCounts(state.rows, state);
  const list = filterTasks(state.rows, state);
  const page = list.slice(0, state.shown);
  const gives = isManager(state.viewer);
  fill(host,
    h('div', { class: 'tt-tools' },
      h('div', { class: 'tt-filters' },
        chipGroup('למי', KINDS, 'kind', counts.kind),
        chipGroup('מצב', STATES, 'status', counts.status)),
      gives ? h('button', { type: 'button', class: 'btn btn-primary tt-new', id: 'tt-new', onclick: openForm }, icon('plus', { size: 18 }), 'משימה חדשה') : null),
    h('p', { class: 'mt-count tt-count', id: 'tt-count', role: 'status', 'aria-live': 'polite' },
      list.length === state.rows.length ? tasksWord(list.length) : `${tasksWord(list.length)} מתוך ${state.rows.length}`),
    h('div', { class: 'mt-wrap tt-wrap', tabindex: '0', role: 'region', 'aria-label': 'משימות לעורכים ולגרפיקאי' },
      h('table', { class: 'mt tt' },
        h('thead', {}, h('tr', {}, ...['לקוח', 'סוג', 'תיאור המשימה', 'תאריך הכנסה', 'תאריך יעד', 'אחראי/ת', 'סטטוס'].map((t) => h('th', { scope: 'col' }, h('span', {}, t))))),
        h('tbody', { id: 'tt-body' }, page.length ? page.map((r) => row(r, now))
          : h('tr', { class: 'tt-none-row' }, h('td', { class: 'mt-empty', colspan: '7' }, state.rows.length ? 'אין משימות בסינון הזה.' : 'אין משימות לעורכים ולגרפיקאי.'))))),
    list.length > page.length ? h('button', {
      type: 'button', class: 'btn btn-ghost tt-more', id: 'tt-more',
      onclick: () => { state.shown += PAGE_SIZE; draw(); state.host.querySelector('#tt-more')?.focus(); },
    }, `הצגת עוד (${list.length - page.length})`) : null,
    h('p', { class: 'mt-money-note' }, `המשימות שנשלחו ב״משימות לעובדים״ ובכרטיס הלקוח. משימה שהושלמה נשארת כאן ${DONE_DAYS} יום. משימה שבוטלה לא מוצגת.`));
}

// "משימה חדשה": the form of "משימות לעובדים", in a dialog, for the people of the chosen chip.
let dlg = null;
async function openForm(e) {
  const btn = e?.currentTarget;
  if (btn) btn.disabled = true;
  dlg ||= document.body.appendChild(h('dialog', { class: 'tt-dlg', id: 'tt-dlg', 'aria-labelledby': 'tt-dlg-h' },
    h('div', { class: 'dlg-head' },
      h('h2', { id: 'tt-dlg-h' }, 'משימה חדשה'),
      h('button', { type: 'button', class: 'close', 'aria-label': 'סגירה', onclick: () => dlg.close() }, '×')),
    h('div', { class: 'dlg-body', id: 'tt-dlg-body' })));
  const done = () => { dlg.close(); };
  const ok = await mountStaffTaskForm(dlg.querySelector('#tt-dlg-body'), state.viewer, {
    people: formPeople(state.kind),
    cancel: done,
    changed: async () => { done(); await reload(); },
  }).catch(() => false);
  if (btn) btn.disabled = false;
  if (!ok) return;
  dlg.addEventListener('close', () => state.host?.querySelector('#tt-new')?.focus(), { once: true });
  dlg.showModal();
  dlg.querySelector('#st-body')?.focus();
}

async function reload() {
  try {
    state.rows = taskRows(await loadAll(), new Date());
    state.loaded = true;
  } catch (err) {
    if (!state.loaded) { fill(state.host, h('p', { class: 'state', role: 'alert' }, errorText(err))); return; }
  }
  draw();
}

// Draws the tab into `host`. `viewer` ({ me, scope }) when the page knows it already.
export async function renderTasksTab(host, { viewer = null } = {}) {
  if (!host) return;
  host.classList.add('tt-tab');
  state.host = host;
  state.viewer = viewer || state.viewer || await viewerOf(await sessionEmail());
  if (!isManager(state.viewer)) { fill(host, h('p', { class: 'state' }, 'אין לך גישה לרשימה הזו.')); return; }
  if (!state.loaded) fill(host, h('p', { class: 'state', role: 'status' }, 'טוען…'));
  await reload();
}
