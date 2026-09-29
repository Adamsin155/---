// "צוות וכניסות" (team.html): everyone's login at a glance, and a personal sign-in
// link to send by WhatsApp for a first login or a forgotten password, with no email.
// For the owner, Irit and Lior; the staff-admin function checks the same on the
// server (supabase/functions/staff-admin/). Links are kept only in this page's memory.
import { supabase } from './supa.js';
import { STAFF_PEOPLE } from './protocol.js';
import { $, fill, h, toast, errorText, mountSession, viewerOf, VIEWER_UNKNOWN, formatWhen } from './protocol-ui.js';
import { whatsappLink } from './quote-doc.js';
import { canManageTeam, loginState, linkMessage, LINK_VALID_FOR, TEAM_MANAGERS } from './team-rules.js';

let rows = [];               // staff rows with their login state (from the function)
let caller = null;           // { email, person, owner }
const links = new Map();     // email -> { link, type, name } made on this page
const busy = new Set();      // emails with a request in flight

const ERRORS = {
  not_signed_in: 'יש להתחבר מחדש.',
  not_allowed: 'אין לך הרשאה לפעולה הזו.',
  owner_only: 'רק הבעלים יכול לעשות את זה.',
  bad_email: 'כתובת המייל לא תקינה.',
  bad_person: 'התפקיד לא מוכר. רעננו את הדף.',
  bad_redirect: 'הקישור לא נוצר, כי העמוד נפתח מכתובת לא מוכרת. פתחו אותו מהכתובת הרגילה של המערכת.',
  person_taken: 'לאדם הזה כבר יש כתובת. להחלפת כתובת פנו לבעלים.',
  own_role: 'אי אפשר לשנות כאן את התפקיד של עצמך.',
  cannot_remove_self: 'אי אפשר להסיר את עצמך.',
  not_found: 'השורה כבר לא קיימת. רעננו את הדף.',
  not_staff: 'הכתובת לא ברשימת הצוות. שמרו אותה קודם.',
  too_soon: 'נוצרו כמה קישורים ברצף. נסו שוב בעוד דקה.',
  link_failed: 'הקישור לא נוצר. נסו שוב בעוד רגע.',
  server_error: 'משהו השתבש בשרת. נסו שוב בעוד רגע.',
  unknown_action: 'הפעולה לא מוכרת. רעננו את הדף.',
  bad_request: 'הבקשה לא תקינה. רעננו את הדף.',
  no_function: 'שירות הכניסות עוד לא הופעל בשרת. פנו למנהל המערכת.',
};
const explain = (err) => ERRORS[err?.code] || errorText(err);

async function call(action, payload = {}) {
  const { data, error } = await supabase.functions.invoke('staff-admin', { body: { action, ...payload } });
  if (!error) return data;
  let code = null;
  try { code = (await error.context.json()).error; } catch { /* no JSON body */ }
  if (!code && error.context?.status === 404) code = 'no_function';
  throw Object.assign(new Error(code || error.message), { code });
}

// ── The list ──────────────────────────────
const isManagerPerson = (person) => person === null || TEAM_MANAGERS.includes(person);
const nameOfEmail = (email) => {
  const r = rows.find((x) => x.email === email);
  if (!r) return String(email || '').split('@')[0];
  if (r.person === null) return 'הבעלים';
  return STAFF_PEOPLE().find((p) => p.key === r.person)?.name || r.email.split('@')[0];
};

// Owner first, then everyone in the protocol in its order (one entry per staff row,
// or an empty one for someone without a row), then rows with no protocol role.
// Each entry gets a short id for the page: the person's key, numbered when repeated.
function entries() {
  const people = STAFF_PEOPLE();
  const out = rows.filter((r) => r.person === null).map((r) => ({ key: 'owner', person: null, name: 'הבעלים', role: 'בעל המשרד', row: r }));
  for (const p of people) {
    const mine = rows.filter((r) => r.person === p.key);
    if (!mine.length) out.push({ key: p.key, person: p.key, name: p.name, role: p.role, row: null });
    for (const r of mine) out.push({ key: p.key, person: p.key, name: p.name, role: p.role, row: r });
  }
  for (const r of rows) {
    if (r.person !== null && !people.some((p) => p.key === r.person)) {
      out.push({ key: 'other', person: r.person, name: r.email.split('@')[0], role: 'ללא תפקיד בפרוטוקול', row: r });
    }
  }
  const seen = {};
  for (const e of out) {
    seen[e.key] = (seen[e.key] || 0) + 1;
    e.id = seen[e.key] === 1 ? e.key : `${e.key}-${seen[e.key]}`;
  }
  return out;
}

async function load() {
  $('state').textContent = rows.length ? '' : 'טוען…';
  try {
    const data = await call('list');
    rows = data.rows || [];
    caller = data.caller;
  } catch (err) {
    if (err.code === 'not_allowed' || err.code === 'owner_only') return showNoAccess();
    $('state').textContent = explain(err);
    return;
  }
  $('state').textContent = '';
  render();
}

// Re-rendering replaces the rows: keep focus and anything typed but not saved yet.
function render() {
  const focusId = document.activeElement?.id;
  const typed = [...document.querySelectorAll('.tm-add .input')].map((i) => [i.id, i.value]);
  fill($('team-list'), entries().map(rowView));
  for (const [id, value] of typed) { const el = document.getElementById(id); if (el) el.value = value; }
  if (focusId) document.getElementById(focusId)?.focus({ preventScroll: true });
}

function statusView(row) {
  const state = loginState(row);
  const badge = (cls, text) => h('span', { class: `sbadge ${cls}` }, h('span', { class: 'sicon', 'aria-hidden': 'true' }), text);
  if (state === 'active') return badge('s-done', `מחובר/ה לאחרונה ${formatWhen(new Date(row.last_sign_in_at))}`);
  if (state === 'pending') return badge('s-waiting', 'טרם נכנס/ה');
  return badge('s-none', 'אין חשבון');
}

function vaultView(e) {
  const on = !!e.row?.vault;
  if (!e.row) return null;
  if (!caller?.owner) return h('span', { class: `tag tm-vault${on ? ' is-on' : ''}` }, on ? 'גישה לכספת' : 'בלי כספת');
  return h('button', {
    type: 'button', class: 'chip tm-vault-btn', id: `vault-${e.id}`, 'aria-pressed': String(on), 'aria-label': `גישה לכספת: ${e.name}`,
    disabled: busy.has(e.row.email),
    onclick: () => toggleVault(e),
  }, 'גישה לכספת');
}

function emailView(e) {
  if (e.row) return h('bdi', { dir: 'ltr', class: 'tm-address' }, e.row.email);
  if (!caller?.owner && isManagerPerson(e.person)) return h('span', { class: 'muted' }, 'אין כתובת. רק הבעלים מוסיף אותה.');
  const inputId = `email-${e.id}`;
  return h('form', { class: 'tm-add', novalidate: true, onsubmit: (ev) => { ev.preventDefault(); addEmail(e, inputId); } },
    h('label', { class: 'sr-only', for: inputId }, `כתובת המייל של ${e.name}`),
    h('input', { class: 'input', id: inputId, type: 'email', dir: 'ltr', placeholder: 'כתובת מייל', autocomplete: 'off', required: true }),
    h('button', { type: 'submit', class: 'btn btn-sm', id: `save-${e.id}` }, 'שמירה'));
}

function lastLinkView(row) {
  if (!row?.last_link_at) return null;
  return h('span', { class: 'muted tm-last' }, `קישור אחרון: ${formatWhen(new Date(row.last_link_at))}${row.last_link_by ? `, ${nameOfEmail(row.last_link_by)}` : ''}`);
}

function linkPanel(e) {
  const made = e.row && links.get(e.row.email);
  if (!made) return null;
  const invite = made.type === 'invite';
  const inputId = `link-${e.id}`;
  return h('div', { class: 'tm-link', role: 'group', 'aria-labelledby': `${inputId}-h` },
    h('p', { class: 'tm-link-h', id: `${inputId}-h` }, invite ? `קישור הזמנה ל${e.name}` : `קישור לבחירת סיסמה ל${e.name}`),
    h('div', { class: 'linkbox' },
      h('label', { class: 'sr-only', for: inputId }, 'הקישור'),
      h('input', { class: 'input', id: inputId, readonly: true, dir: 'ltr', value: made.link, onfocus: (ev) => ev.target.select() }),
      h('button', { type: 'button', class: 'btn btn-sm', id: `copy-${e.id}`, onclick: () => copyLink(made.link, inputId) }, 'העתקה'),
      h('a', {
        class: 'btn btn-sm btn-primary tm-wa', id: `wa-${e.id}`, target: '_blank', rel: 'noopener noreferrer',
        href: whatsappLink('', linkMessage({ name: e.person === null ? '' : e.name, link: made.link, type: made.type })),
      }, 'שליחה בוואטסאפ')),
    h('p', { class: 'hint tm-link-note' },
      `הקישור אישי: מי שפותח אותו נכנס לחשבון של ${e.name}, ולכן שולחים אותו רק ל${e.name}. `
      + `הוא תקף ל${LINK_VALID_FOR} ולכניסה אחת. אם פג או הלך לאיבוד, יוצרים כאן קישור חדש בכל רגע.`));
}

function rowView(e) {
  const me = e.row && caller && e.row.email === caller.email;
  const canLink = !!e.row && (caller?.owner || e.person !== null);
  const canRemove = !!e.row && caller?.owner && !me;
  const pending = e.row && busy.has(e.row.email);
  return h('li', { class: 'tm-row', id: `row-${e.id}`, 'data-person': e.person ?? 'owner' },
    h('div', { class: 'tm-who' },
      h('div', { class: 'tm-name' }, h('h3', {}, e.name), me ? h('span', { class: 'tag' }, 'זה אני') : null),
      h('p', { class: 'muted tm-role' }, e.role)),
    h('div', { class: 'tm-email' }, emailView(e)),
    h('div', { class: 'tm-state' }, statusView(e.row), vaultView(e), lastLinkView(e.row)),
    h('div', { class: 'tm-acts' },
      canLink ? h('button', {
        type: 'button', class: 'btn btn-sm', id: `mklink-${e.id}`, disabled: pending, onclick: () => makeLink(e),
        'aria-label': `${links.has(e.row.email) ? 'קישור כניסה חדש' : 'יצירת קישור כניסה'} ל${e.name}`,
      }, links.has(e.row.email) ? 'קישור חדש' : 'יצירת קישור כניסה') : null,
      canRemove ? h('button', {
        type: 'button', class: 'btn-text tm-remove', id: `remove-${e.id}`, disabled: pending, onclick: () => removeRow(e),
        'aria-label': `הסרת ${e.name} מהצוות`,
      }, 'הסרה') : null),
    linkPanel(e));
}

// ── Actions ───────────────────────────────
async function run(email, work) {
  busy.add(email);
  render();
  try { return await work(); } catch (err) { toast(explain(err)); return null; } finally { busy.delete(email); render(); }
}

async function addEmail(e, inputId) {
  const input = $(inputId);
  const email = input.value.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    input.setAttribute('aria-invalid', 'true');
    input.focus();
    toast(ERRORS.bad_email);
    return;
  }
  const ok = await run(email, () => call('upsert', { email, person: e.person }));
  if (!ok) return;
  toast(`הכתובת של ${e.name} נשמרה. עכשיו אפשר ליצור קישור כניסה.`);
  await load();
  document.getElementById(`mklink-${e.id}`)?.focus();
}

async function toggleVault(e) {
  const on = !e.row.vault;
  if (on && !confirm(`לתת ל${e.name} גישה לכספת? עם הגישה רואים את הסיסמאות של הלקוחות.`)) return;
  const ok = await run(e.row.email, () => call('upsert', { email: e.row.email, vault: on }));
  if (!ok) return;
  toast(on ? `ל${e.name} יש עכשיו גישה לכספת.` : `הגישה של ${e.name} לכספת הוסרה.`);
  await load();
}

async function removeRow(e) {
  if (!confirm(`להסיר את ${e.row.email} מהצוות? הכתובת לא תוכל להיכנס למערכת. אפשר להוסיף אותה שוב אחר כך.`)) return;
  const ok = await run(e.row.email, () => call('remove', { email: e.row.email }));
  if (!ok) return;
  links.delete(e.row.email);
  toast('הכתובת הוסרה מהצוות.');
  await load();
}

async function makeLink(e) {
  const email = e.row.email;
  const redirectTo = new URL('clients.html', window.location.href).href;
  const data = await run(email, () => call('link', { email, redirectTo }));
  if (!data?.link) return;
  links.set(email, { link: data.link, type: data.type });
  await load();
  document.getElementById(`wa-${e.id}`)?.focus();
}

async function copyLink(link, inputId) {
  try {
    await navigator.clipboard.writeText(link);
  } catch {
    $(inputId).select();
    if (!document.execCommand('copy')) { toast('ההעתקה לא הצליחה. סמנו את הקישור והעתיקו ידנית.'); return; }
  }
  toast('הקישור הועתק. שלחו אותו רק לאדם שהוא מיועד לו.');
}

// ── Start ─────────────────────────────────
function showNoAccess(msg = null) {
  $('team-page').hidden = true;
  $('no-access').hidden = false;
  $('state').textContent = msg || '';
}

$('btn-refresh').addEventListener('click', load);
document.addEventListener('visibilitychange', () => { if (!document.hidden && !$('team-page').hidden) load(); });

mountSession(async (staff) => {
  const viewer = await viewerOf(staff.email);
  if (!canManageTeam(viewer)) return showNoAccess(viewer.error ? VIEWER_UNKNOWN : null);
  $('team-page').hidden = false;
  await load();
});
