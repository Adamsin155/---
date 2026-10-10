// "נודניק תזכורת לעובד" (it was "משימות מיידיות" until 7.10.2026; the owner did not
// recognise it under that name): the card of the tasks given on the spot (the owner's
// request of 6.10.2026), right under the "now" bar of "המשימות שלי" and on deal.html
// (the sales agents have no other screen). The ids and the code names kept "task".
//   - Whoever got one: "תזכורות שקיבלת (N)", each with what to do, who sent it and
//     when, when the next reminder comes, and "בוצע". Only that stops the reminders
//     (every 10 minutes, 09:00–20:00 on working days).
//   - Whoever sends them (Irit, the owner): "שליחת נודניק" (to whom, what, an optional
//     client), and "נודניקים ששלחת": the open ones with "ביטול הנודניק", and the ones
//     done or cancelled in the last week, by whom and when.
// The database decides who may do what (public.staff_task_create / _done / _cancel
// and row level security on public.staff_tasks); the rules are
// app/staff-tasks-logic.js. The page gives a section; the styles are
// app/styles/staff-tasks.css.
import { supabase } from './supa.js';
import { fill, h, toast, errorText, formatWhen } from './protocol-ui.js';
import {
  canGive, personOfViewer, ASSIGNEES, personName, validateTask, BODY_MAX, taskLists, nextNagAt, nagOpen, NAG_EVERY,
  needsBrief, NAG_BRIEF, BRIEF_MAX, briefLines,
} from './staff-tasks-logic.js';

// The state of a "נודניק" as the sender reads it (STATUS_TEXT in the logic speaks of a task).
const STATE_TEXT = { open: 'פתוח', done: 'בוצע', cancelled: 'בוטל' };

const BASE_COLS = 'id, created_at, created_by, assignee, body, client_id, client_name, status, done_at, cancelled_at';
// The brief of a task for Nirel (protocol v10; the column comes with migration 20261024100000).
const COLS = `${BASE_COLS}, brief`;
const missing = (error) => ['42P01', 'PGRST205', 'PGRST204', '42703'].includes(error?.code);

let box = null;
let viewer = null;
let tasks = [];
let clients = null; // the picker's list, loaded when the form first opens
let active = false;
let formOpen = false;
let showOpen = false;    // the giver's open tasks: folded until asked for (or until one is sent)
let showClosed = false;
let onChange = () => {};

// ── Data ────────────────────────────────────
// The tasks this login may read (its own, the ones it gave; the owner: all). null:
// the table is not there yet (before the migration).
export async function loadStaffTasks() {
  let { data, error } = await supabase.from('staff_tasks').select(COLS).order('created_at', { ascending: false }).limit(300);
  // Until the migration adds the brief's column the tasks load without it (the card must not vanish).
  if (error?.code === '42703') ({ data, error } = await supabase.from('staff_tasks').select(BASE_COLS).order('created_at', { ascending: false }).limit(300));
  if (error) {
    if (missing(error)) return null;
    throw error;
  }
  return data || [];
}
async function loadClients() {
  if (clients) return;
  try {
    const { data, error } = await supabase.from('clients').select('id, name, business').in('status', ['active', 'ending']).order('name');
    clients = error ? [] : (data || []).map((c) => ({ id: c.id, label: c.business && c.business !== c.name ? `${c.business} · ${c.name}` : c.name }));
  } catch { clients = []; }
}

function explain(err) {
  const msg = String(err?.message || err || '');
  if (/only the assignee/.test(msg)) return 'רק מי שקיבל את המשימה מסמן אותה כבוצעה.';
  if (/not open|task not found/.test(msg)) return 'המשימה כבר נסגרה. הרשימה רועננה.';
  if (/no login/.test(msg)) return 'לעובד הזה עוד אין כניסה למערכת, ולכן הוא לא יקבל את המשימה. מוסיפים אותו בעמוד ״צוות״.';
  if (/task text is required/.test(msg)) return `כותבים מה צריך לעשות, עד ${BODY_MAX} תווים.`;
  if (/needs the full brief|invalid brief/.test(msg)) return 'משימה לניראל צריכה בריף מלא: הבעיה, מה לשנות, מה נשאר והתוצאה.';
  if (/client not found/.test(msg)) return 'הלקוח שנבחר לא נמצא. בחרו לקוח אחר או השאירו ריק.';
  if (/not allowed|permission denied/.test(msg)) return 'אין לך הרשאה לפעולה הזו.';
  return errorText(err);
}

// ── Actions ─────────────────────────────────
async function act(rpc, t, btn, done) {
  btn.disabled = true;
  const { error } = await supabase.rpc(rpc, { p_id: t.id });
  if (error) {
    toast(explain(error));
    btn.disabled = false;
    if (/not open|not found/.test(error.message || '')) await refreshStaffTasks();
    return;
  }
  toast(done);
  await refreshStaffTasks();
  onChange();
  box?.querySelector('h2')?.focus();
}

async function send(form) {
  const brief = Object.fromEntries(NAG_BRIEF.map(([k]) => [k, form.elements[`brief-${k}`]?.value || '']));
  const v = validateTask({ assignee: form.elements.assignee.value, body: form.elements.body.value, clientId: form.elements.client?.value || '', brief });
  const fields = ['assignee', 'body', ...NAG_BRIEF.map(([k]) => `brief-${k}`)];
  const errOf = (name) => v.errors[name.replace('brief-', 'brief.')];
  for (const k of fields) {
    const err = form.querySelector(`#st-${k}-err`);
    if (!err) continue;
    err.textContent = errOf(k) || '';
    err.hidden = !errOf(k);
    form.elements[k].setAttribute('aria-invalid', errOf(k) ? 'true' : 'false');
  }
  if (!v.ok) { form.elements[fields.find((k) => errOf(k))]?.focus(); return; }
  const btn = form.querySelector('button[type="submit"]');
  btn.disabled = true;
  const { error } = await supabase.rpc(v.rpc, v.args);
  if (error) { toast(explain(error)); btn.disabled = false; return; }
  formOpen = false;
  showOpen = true; // what was just sent is shown
  const who = personName(v.args.p_assignee);
  toast(nagOpen(new Date()) ? `הנודניק נשלח ל${who}. תזכורת כל ${NAG_EVERY} דקות עד ״בוצע״.` : `הנודניק נשמר. התזכורות ל${who} יתחילו ${formatWhen(nextNagAt(new Date(), new Date()))}.`);
  await refreshStaffTasks();
  onChange();
  box?.querySelector('#st-new')?.focus();
}

// A field that was refused and is being corrected: its error goes.
function clearError(el) {
  const err = document.getElementById(`${el.id}-err`);
  if (err && !err.hidden) { err.hidden = true; err.textContent = ''; el.setAttribute('aria-invalid', 'false'); }
}

// ── The card ────────────────────────────────
const stamp = (v) => formatWhen(new Date(v));
const clientOf = (t) => (t.client_name ? [' · לקוח: ',
  t.client_id && viewer?.scope === 'office' ? h('a', { href: `client.html?id=${encodeURIComponent(t.client_id)}` }, t.client_name) : h('span', { dir: 'auto' }, t.client_name)] : null);

// The brief of a task (Nirel's): the four answers, under what to do.
const briefOf = (t) => { const lines = briefLines(t); return lines.length ? h('dl', { class: 'st-brief' }, ...lines.flatMap(([l, v]) => [h('dt', {}, l), h('dd', { dir: 'auto' }, v)])) : null; };

function mineItem(t, now) {
  const next = nextNagAt(t.created_at, now);
  return h('article', { class: 'st-item is-mine', 'data-task': t.id, 'aria-labelledby': `st-${t.id}` },
    h('p', { class: 'st-body', id: `st-${t.id}`, dir: 'auto' }, t.body),
    briefOf(t),
    h('p', { class: 'st-meta' }, `נשלח מ${personName(t.created_by)} · ${stamp(t.created_at)}`, clientOf(t)),
    h('p', { class: 'st-next' }, nagOpen(now) ? `תזכורת כל ${NAG_EVERY} דקות עד שמסמנים ״בוצע״. הבאה: ${formatWhen(next, now)}.` : `התזכורות יתחדשו ${formatWhen(next, now)}.`),
    h('div', { class: 'st-acts' },
      h('button', { type: 'button', class: 'btn st-done', 'data-act': 'done', onclick: (e) => act('staff_task_done', t, e.currentTarget, 'סומן ״בוצע״. התזכורות נעצרו.') }, 'בוצע')));
}

function givenItem(t) {
  const open = t.status === 'open';
  return h('article', { class: 'st-item', 'data-task': t.id, 'aria-labelledby': `sg-${t.id}` },
    h('div', { class: 'st-head' },
      h('strong', { class: 'st-who' }, personName(t.assignee)),
      h('span', { class: `st-state is-${t.status}` }, STATE_TEXT[t.status])),
    h('p', { class: 'st-body', id: `sg-${t.id}`, dir: 'auto' }, t.body),
    briefOf(t),
    h('p', { class: 'st-meta' },
      personOfViewer(viewer) !== t.created_by ? `שלח/ה ${personName(t.created_by)} · ` : '', `נשלח ${stamp(t.created_at)}`,
      t.status === 'done' ? ` · בוצע ${stamp(t.done_at)}` : '', t.status === 'cancelled' ? ` · בוטל ${stamp(t.cancelled_at)}` : '', clientOf(t)),
    open ? h('div', { class: 'st-acts' },
      h('button', {
        type: 'button', class: 'btn btn-ghost', 'data-act': 'cancel',
        onclick: (e) => { if (window.confirm(`לבטל את הנודניק ל${personName(t.assignee)}? התזכורות ייעצרו והוא יסומן כמבוטל.`)) act('staff_task_cancel', t, e.currentTarget, 'הנודניק בוטל. התזכורות נעצרו.'); },
      }, 'ביטול הנודניק')) : null);
}

function newForm() {
  const counter = h('span', { class: 'st-count', id: 'st-count', 'aria-live': 'off' }, `0/${BODY_MAX}`);
  // Nirel's mandatory brief (protocol v10): the four fields appear when she is chosen, and all are required.
  const briefBox = h('fieldset', { class: 'st-brief-form', id: 'st-brief', hidden: true },
    h('legend', {}, 'הבריף לניראל (חובה)'),
    ...NAG_BRIEF.map(([k, l]) => h('div', { class: 'field' },
      h('label', { for: `st-brief-${k}` }, l),
      h('textarea', { class: 'input', id: `st-brief-${k}`, name: `brief-${k}`, rows: 2, maxlength: BRIEF_MAX, 'aria-describedby': `st-brief-${k}-err`, oninput: (e) => { if (e.currentTarget.value.trim()) clearError(e.currentTarget); } }),
      h('div', { class: 'err', id: `st-brief-${k}-err`, hidden: true }))));
  return h('form', { class: 'st-form', id: 'st-form', novalidate: true, 'aria-labelledby': 'st-form-h', onsubmit: (e) => { e.preventDefault(); send(e.currentTarget); } },
    h('h3', { id: 'st-form-h' }, 'נודניק חדש'),
    h('div', { class: 'field' },
      h('label', { for: 'st-assignee' }, 'למי'),
      h('select', { class: 'input', id: 'st-assignee', name: 'assignee', required: true, 'aria-describedby': 'st-assignee-err', onchange: (e) => { clearError(e.currentTarget); briefBox.hidden = !needsBrief(e.currentTarget.value); } },
        h('option', { value: '' }, 'בחירת עובד/ת'), ...ASSIGNEES().map((p) => h('option', { value: p.key }, p.name))),
      h('div', { class: 'err', id: 'st-assignee-err', hidden: true })),
    h('div', { class: 'field' },
      h('label', { for: 'st-body' }, 'מה צריך לעשות'),
      h('textarea', {
        class: 'input', id: 'st-body', name: 'body', rows: 3, maxlength: BODY_MAX, required: true, 'aria-describedby': 'st-body-err st-count',
        oninput: (e) => { counter.textContent = `${e.currentTarget.value.length}/${BODY_MAX}`; if (e.currentTarget.value.trim()) clearError(e.currentTarget); },
      }),
      h('div', { class: 'st-under' }, h('div', { class: 'err', id: 'st-body-err', hidden: true }), counter)),
    briefBox,
    clients?.length ? h('div', { class: 'field' },
      h('label', { for: 'st-client' }, 'לקוח (לא חובה)'),
      h('select', { class: 'input', id: 'st-client', name: 'client' }, h('option', { value: '' }, 'בלי לקוח'), ...clients.map((c) => h('option', { value: c.id }, c.label)))) : null,
    h('p', { class: 'hint' }, `העובד/ת יקבל/ו התראה מיד, ואז כל ${NAG_EVERY} דקות עד ״בוצע״, בימי עבודה 09:00–20:00.`),
    h('div', { class: 'st-acts' },
      h('button', { type: 'submit', class: 'btn st-send', id: 'st-send' }, 'שליחת הנודניק'),
      h('button', { type: 'button', class: 'btn btn-ghost', onclick: () => { formOpen = false; render(); box.querySelector('#st-new')?.focus(); } }, 'ביטול')));
}

function render() {
  if (!box) return;
  const now = new Date();
  const gives = canGive(viewer);
  const { mine, given } = taskLists(tasks, viewer, now);
  box.hidden = !gives && !mine.length;
  if (box.hidden) { fill(box); return; }
  box.classList.toggle('has-mine', mine.length > 0);
  // The giver's part is one quiet row ("שליחת נודניק" and how many are open): the lists
  // open on demand, so the card never pushes the person's own work down the screen
  // (the simplicity pass of 6.10.2026). A task one got stays big: it is work to do now.
  const heading = h('h2', { id: 'staff-tasks-h', tabindex: '-1' }, mine.length ? `תזכורות שקיבלת (${mine.length})` : 'נודניק תזכורת לעובד');
  box.classList.toggle('is-quiet', gives && !mine.length && !formOpen);
  const newBtn = h('button', { type: 'button', class: 'btn', id: 'st-new', onclick: async (e) => { e.currentTarget.disabled = true; await loadClients(); formOpen = true; render(); box.querySelector('#st-assignee')?.focus(); } }, 'שליחת נודניק');
  const none = given.open.length ? null : h('p', { class: 'hint st-empty' }, 'אין נודניקים פתוחים ששלחת.');
  fill(box,
    mine.length ? heading : null,
    ...mine.map((t) => mineItem(t, now)),
    gives ? [
      mine.length ? h('h3', { class: 'st-sub' }, 'נודניקים ששלחת') : null,
      ...(formOpen ? [mine.length ? null : heading, newForm(), none]
        : [h('div', { class: 'st-top' }, h('div', { class: 'st-top-t' }, mine.length ? null : heading, none), newBtn)]),
      given.open.length || given.closed.length ? h('div', { class: 'st-folds' },
        given.open.length ? h('h3', { class: 'st-fold-h', id: 'st-open-h' }, h('button', {
          type: 'button', class: 'btn-text st-more', id: 'st-open-toggle', 'aria-expanded': String(showOpen),
          onclick: () => { showOpen = !showOpen; render(); box.querySelector('#st-open-toggle')?.focus(); },
        }, `פתוחים (${given.open.length})`)) : null,
        given.closed.length ? h('button', {
          type: 'button', class: 'btn-text st-more', id: 'st-closed-toggle', 'aria-expanded': String(showClosed),
          onclick: () => { showClosed = !showClosed; render(); box.querySelector('#st-closed-toggle')?.focus(); },
        }, showClosed ? 'הסתרת מה שנסגר' : `מה שנסגר בשבוע האחרון (${given.closed.length})`) : null) : null,
      ...(showOpen ? given.open.map(givenItem) : []),
      ...(showClosed ? given.closed.map(givenItem) : []),
    ] : null);
}

// Mounts the card: for whoever gives these tasks, and for anyone with an open one;
// hidden for everyone else, and until the migration is in. `changed()`: after an action.
export async function mountStaffTasks(el, who, { changed = () => {} } = {}) {
  box = el;
  viewer = who;
  onChange = changed;
  if (!el || !personOfViewer(who)) { if (el) el.hidden = true; return; }
  el.classList.add('st-card');
  el.setAttribute('aria-labelledby', 'staff-tasks-h');
  active = true;
  await refreshStaffTasks();
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshStaffTasks(); });
  setInterval(() => { if (!document.hidden) refreshStaffTasks(); }, 60e3);
}

export async function refreshStaffTasks() {
  if (!box || !active) return;
  try {
    const rows = await loadStaffTasks();
    if (rows === null) { tasks = []; active = false; box.hidden = true; fill(box); return; }
    tasks = rows;
  } catch {
    return; // keep the last list
  }
  // While the new task is being typed, the list waits.
  if (formOpen && box.querySelector('#st-form')) return;
  render();
}
