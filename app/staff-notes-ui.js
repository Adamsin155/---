// "הערה מיוחדת" for one employee (Lior and the owner, 9.11.2026; docs/ops.md, section 114).
//   - The banner: the notes written to the signed-in person, at the top of every page with
//     the shell (mounted by app/shell.js, on the phone and on a wide screen). Who wrote each
//     and when. No way to remove it here: only the writers delete a note.
//   - The writers' card (the owners, Irit, Lior, Ofir), in "המשימות שלי" under the
//     "נודניק" card (clients.html #staff-notes-card): "הערה חדשה" (to whom, what) and the
//     live notes by person, each with "מחיקה".
// The database decides who may do what (public.staff_notes, public.staff_note_delete); the
// rules are app/staff-notes-logic.js. Styles: the banner in app/styles/shell.css (every
// page), the card in app/styles/staff-tasks.css (beside the "נודניק" card).
// Light on purpose: the banner loads on every page, the quote pages too, so it uses the
// small helpers (quote-doc.js h) and not app/protocol-ui.js.
import { supabase } from './supa.js';
import { h } from './quote-doc.js';
import {
  canWriteNotes, personOfViewer, NOTE_PEOPLE, personName, validateNote, NOTE_MAX, notesFor, notesByPerson,
} from './staff-notes-logic.js';

const COLS = 'id, person, body, created_by, created_at, deleted_at';
const missing = (error) => ['42P01', 'PGRST205', 'PGRST204', '42703'].includes(error?.code);

// Israel time, "9.11 14:30" (and "היום 14:30" for today).
const TZ = 'Asia/Jerusalem';
const dayFmt = new Intl.DateTimeFormat('he-IL', { timeZone: TZ, day: 'numeric', month: 'numeric' });
const timeFmt = new Intl.DateTimeFormat('he-IL', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false });
const dayKey = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
export function whenWritten(at, now = new Date()) {
  const d = new Date(at);
  if (Number.isNaN(+d)) return '';
  const today = dayKey.format(now) === dayKey.format(d);
  const yesterday = dayKey.format(new Date(now.getTime() - 864e5)) === dayKey.format(d);
  return `${today ? 'היום' : yesterday ? 'אתמול' : dayFmt.format(d)} ${timeFmt.format(d)}`;
}
const byLine = (n) => `מ${personName(n.created_by) || 'המשרד'} · ${whenWritten(n.created_at)}`;

// The notes this login reads (its own; a writer: everyone's, deleted ones left out here).
// null: the table is not there yet (before the migration).
export async function loadNotes(person = null) {
  let q = supabase.from('staff_notes').select(COLS).is('deleted_at', null);
  if (person) q = q.eq('person', person);
  const { data, error } = await q.order('created_at', { ascending: true }).limit(500);
  if (error) {
    if (missing(error)) return null;
    throw error;
  }
  return data || [];
}

// ── The banner, on every page ───────────────
let banner = null;
let bannerFor = null;
function drawBanner(notes) {
  const mine = notesFor(notes, bannerFor);
  if (!mine.length) { banner?.remove(); banner = null; return; }
  const main = document.querySelector('main');
  if (!main) return;
  if (!banner) {
    banner = h('section', { class: 'sn-banner', id: 'staff-notes-banner', 'aria-labelledby': 'sn-banner-h' });
  }
  banner.replaceChildren(
    h('h2', { class: 'sn-banner-h', id: 'sn-banner-h' }, mine.length > 1 ? `הערות מיוחדות אליך (${mine.length})` : 'הערה מיוחדת אליך'),
    ...mine.map((n) => h('article', { class: 'sn-note', 'data-note': n.id },
      h('p', { class: 'sn-body', dir: 'auto' }, n.body),
      h('p', { class: 'sn-by' }, byLine(n)))));
  if (banner.parentElement !== main || main.firstElementChild !== banner) main.prepend(banner);
}
export async function refreshNoteBanner() {
  if (!bannerFor) return;
  try {
    const rows = await loadNotes(bannerFor);
    drawBanner(rows || []);
  } catch { /* keep what is shown */ }
}
// Mounted by the shell once it knows who is signed in. Again when the page comes back.
export function mountNoteBanner(viewer) {
  const me = personOfViewer(viewer);
  if (!me || bannerFor === me) return;
  bannerFor = me;
  refreshNoteBanner();
  const again = () => { if (!document.hidden) refreshNoteBanner(); };
  document.addEventListener('visibilitychange', again);
  window.addEventListener('pageshow', (e) => { if (e.persisted) refreshNoteBanner(); });
}

// ── The writers' card ───────────────────────
let box = null;
let viewer = null;
let notes = [];
let formOpen = false;
let say = (msg) => { try { window.alert(msg); } catch { /* no dialog */ } };

function explain(err) {
  const msg = String(err?.message || err || '');
  if (/not allowed|permission denied|row-level security/.test(msg)) return 'אין לך הרשאה לפעולה הזו.';
  if (/note not found/.test(msg)) return 'ההערה כבר לא קיימת. הרשימה רועננה.';
  if (/check constraint|violates/.test(msg)) return `כותבים את ההערה, עד ${NOTE_MAX} תווים.`;
  return 'לא נשמר. בודקים את החיבור ומנסים שוב.';
}

async function send(form) {
  const v = validateNote({ person: form.elements.person.value, body: form.elements.body.value });
  for (const k of ['person', 'body']) {
    const err = form.querySelector(`#sn-${k}-err`);
    err.textContent = v.errors[k] || '';
    err.hidden = !v.errors[k];
    form.elements[k].setAttribute('aria-invalid', v.errors[k] ? 'true' : 'false');
  }
  if (!v.ok) { form.elements[v.errors.person ? 'person' : 'body'].focus(); return; }
  const btn = form.querySelector('button[type="submit"]');
  btn.disabled = true;
  const { error } = await supabase.from('staff_notes').insert(v.row);
  if (error) { say(explain(error)); btn.disabled = false; return; }
  formOpen = false;
  say(`ההערה נשמרה. ${personName(v.row.person)} יקבל/תקבל התראה אחת לטלפון, וההערה תופיע בראש כל עמוד עד שתמחקו אותה.`);
  await refreshNotesCard();
  refreshNoteBanner();
  box?.querySelector('#sn-new')?.focus();
}

async function remove(n, btn) {
  if (!window.confirm(`למחוק את ההערה ל${personName(n.person)}? היא תיעלם אצלו/אצלה מיד.`)) return;
  btn.disabled = true;
  const { error } = await supabase.rpc('staff_note_delete', { p_id: n.id });
  if (error) { say(explain(error)); btn.disabled = false; await refreshNotesCard(); return; }
  await refreshNotesCard();
  refreshNoteBanner();
  box?.querySelector('#sn-h')?.focus();
}

function newForm() {
  const counter = h('span', { class: 'st-count', id: 'sn-count', 'aria-live': 'off' }, `0/${NOTE_MAX}`);
  const clear = (el) => { const err = document.getElementById(`${el.id}-err`); if (err && !err.hidden) { err.hidden = true; el.setAttribute('aria-invalid', 'false'); } };
  return h('form', { class: 'st-form', id: 'sn-form', novalidate: true, 'aria-labelledby': 'sn-form-h', onsubmit: (e) => { e.preventDefault(); send(e.currentTarget); } },
    h('h3', { id: 'sn-form-h' }, 'הערה חדשה'),
    h('div', { class: 'field' },
      h('label', { for: 'sn-person' }, 'למי'),
      h('select', { class: 'input', id: 'sn-person', name: 'person', required: true, 'aria-describedby': 'sn-person-err', onchange: (e) => clear(e.currentTarget) },
        h('option', { value: '' }, 'בחירת עובד/ת'), ...NOTE_PEOPLE().map((p) => h('option', { value: p.key }, p.name))),
      h('div', { class: 'err', id: 'sn-person-err', hidden: true })),
    h('div', { class: 'field' },
      h('label', { for: 'sn-body' }, 'ההערה'),
      h('textarea', {
        class: 'input', id: 'sn-body', name: 'body', rows: 3, maxlength: NOTE_MAX, required: true, 'aria-describedby': 'sn-body-err sn-count',
        placeholder: 'למשל: לא לגעת בלקוח מסעדת בוכרה',
        oninput: (e) => { counter.textContent = `${e.currentTarget.value.length}/${NOTE_MAX}`; if (e.currentTarget.value.trim()) clear(e.currentTarget); },
      }),
      h('div', { class: 'st-under' }, h('div', { class: 'err', id: 'sn-body-err', hidden: true }), counter)),
    h('p', { class: 'hint' }, 'העובד/ת יקבל/ו התראה אחת לטלפון. ההערה תופיע בראש כל עמוד שלו/ה עד שתמחקו אותה.'),
    h('div', { class: 'st-acts' },
      h('button', { type: 'submit', class: 'btn st-send', id: 'sn-send' }, 'שמירת ההערה'),
      h('button', { type: 'button', class: 'btn btn-ghost', onclick: () => { formOpen = false; render(); box.querySelector('#sn-new')?.focus(); } }, 'ביטול')));
}

function noteItem(n) {
  return h('article', { class: 'st-item sn-item', 'data-note': n.id, 'aria-label': `הערה ל${personName(n.person)}` },
    h('p', { class: 'st-body', dir: 'auto' }, n.body),
    h('div', { class: 'sn-row' },
      h('p', { class: 'st-meta' }, `כתב/ה ${personName(n.created_by) || 'המשרד'} · ${whenWritten(n.created_at)}`),
      h('button', { type: 'button', class: 'btn btn-ghost btn-sm sn-del', 'data-act': 'delete', onclick: (e) => remove(n, e.currentTarget) }, 'מחיקה')));
}

function render() {
  if (!box) return;
  const groups = notesByPerson(notes);
  const count = groups.reduce((s, g) => s + g.notes.length, 0);
  box.classList.toggle('is-quiet', !formOpen && !count);
  const heading = h('h2', { id: 'sn-h', tabindex: '-1' }, 'הערות מיוחדות לעובדים');
  const newBtn = h('button', { type: 'button', class: 'btn', id: 'sn-new', onclick: () => { formOpen = true; render(); box.querySelector('#sn-person')?.focus(); } }, 'הערה חדשה');
  // No null to replaceChildren: it would be written as the text "null".
  box.replaceChildren(...[
    h('div', { class: 'st-top' },
      h('div', { class: 'st-top-t' }, heading, count ? null : h('p', { class: 'hint st-empty' }, 'אין הערות פעילות.')),
      formOpen ? null : newBtn),
    formOpen ? newForm() : null,
    ...groups.map((g) => h('div', { class: 'sn-group', 'data-person': g.person },
      h('h3', { class: 'sn-to' }, `ל${g.name}`),
      ...g.notes.map(noteItem))),
  ].filter(Boolean));
}

export async function refreshNotesCard() {
  if (!box) return;
  try {
    const rows = await loadNotes();
    if (rows === null) { box.hidden = true; box.replaceChildren(); return; }
    notes = rows;
  } catch { return; }
  box.hidden = false;
  // While a note is being typed, the list waits.
  if (formOpen && box.querySelector('#sn-form')) return;
  render();
}

// Mounts the writers' card; hidden for everyone else and until the migration is in.
// `toast`: how the page says something (app/protocol-ui.js toast), else an alert.
export async function mountNotesCard(el, who, { toast = null } = {}) {
  if (!el) return;
  if (!canWriteNotes(who)) { el.hidden = true; return; }
  box = el;
  viewer = who;
  if (toast) say = toast;
  el.classList.add('st-card', 'sn-card');
  el.setAttribute('aria-labelledby', 'sn-h');
  await refreshNotesCard();
  document.addEventListener('visibilitychange', () => { if (!document.hidden && viewer) refreshNotesCard(); });
}
