// bookkeeper.html, "לקוחות לחשבוניות": the one screen of Gal, the office's bookkeeper (the owner's
// request of 16.11.2026; docs/ops.md, section 137). A card per active client with what she types
// into an invoice, each with a copy button, and a search. She sees nothing else: the database answers
// her only through public.bookkeeper_clients() (app/bookkeeper-data.js). The logic is
// app/bookkeeper-logic.js.
import { PEOPLE, isBookkeeper } from './protocol.js';
import { BOOKKEEPER_TITLE, FIELDS, DASH, clientOf, search, sortClients, countWords } from './bookkeeper-logic.js';
import { loadBookkeeperClients } from './bookkeeper-data.js';
import { $, h, toast, errorText, mountSession, viewerOf } from './protocol-ui.js';
import { headIcon, icon, pill, emptyState } from './kit.js';
import { isOwnerView } from './team-rules.js';

headIcon($('bk-h1'), 'file', 'teal', { size: 'md' });
headIcon($('na-h'), 'lock', 'navy', { size: 'md' });

let all = [];

// The clipboard, and a way that works where it is refused (an older WebKit).
async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const t = h('textarea', { class: 'bk-clip', readonly: true, 'aria-hidden': 'true', tabindex: '-1' });
    t.value = text;
    document.body.append(t);
    t.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    t.remove();
    return ok;
  }
}

async function copy(btn, value, label) {
  const ok = await copyText(value);
  if (!ok) { toast('ההעתקה לא הצליחה. אפשר לסמן את הטקסט ולהעתיק.'); return; }
  btn.classList.add('is-done');
  btn.replaceChildren(icon('check', { size: 18 }));
  toast(`הועתק: ${label}`);
  setTimeout(() => { btn.classList.remove('is-done'); btn.replaceChildren(icon('copy', { size: 18 })); }, 1600);
}

function field(c, f, i) {
  const v = c.fields[f.key];
  const id = `bk-${i}-${f.key}`;
  const value = v.text
    ? h('span', { class: `bk-val${f.money ? ' bk-money' : ''}`, id, dir: f.ltr ? 'ltr' : null }, v.text)
    : h('span', { class: 'bk-val is-empty', id }, DASH);
  const extra = f.key === 'total' && v.text && c.months ? h('span', { class: 'bk-months' }, `${c.months} חודשים`) : null;
  return h('div', { class: 'bk-row' },
    h('dt', { class: 'bk-label' }, f.label),
    h('dd', { class: 'bk-cell' },
      h('span', { class: 'bk-text' }, value, extra),
      v.copy
        ? h('button', { type: 'button', class: 'bk-copy', id: `${id}-copy`, 'aria-label': `העתקת ${f.label} של ${c.title}`, title: 'העתקה', onclick: (ev) => copy(ev.currentTarget, v.copy, f.label) }, icon('copy', { size: 18 }))
        : null));
}

function card(c, i) {
  return h('li', { class: `bk-card${c.ending ? ' is-ending' : ''}`, id: `bk-${i}` },
    h('div', { class: 'bk-top' },
      h('h2', { class: 'bk-title' }, c.title),
      c.ending ? pill(c.statusText, 'warn') : null),
    h('dl', { class: 'bk-fields' }, FIELDS.map((f) => field(c, f, i))),
    c.note ? h('p', { class: 'bk-note', role: 'note' }, c.note) : c.source ? h('p', { class: 'bk-source' }, `הסכומים ${c.source}`) : null);
}

function render() {
  const shown = search(all, $('bk-q').value);
  $('bk-list').replaceChildren(...shown.map((c) => card(c, all.indexOf(c))));
  $('bk-count').textContent = countWords(shown.length, all.length);
  $('bk-empty').replaceChildren(all.length && !shown.length ? emptyState({ icon: 'question', tone: 'blue', text: 'לא נמצא לקוח כזה. אפשר לחפש לפי שם, שם העסק, ח.פ, טלפון או מייל.' })
    : !all.length ? emptyState({ icon: 'inbox', tone: 'blue', text: 'אין כרגע לקוחות פעילים.' }) : '');
}

async function load() {
  try {
    const rows = await loadBookkeeperClients();
    if (rows === null) { $('state').textContent = 'המסך עוד לא הוקם במערכת. פנו למנהל המערכת.'; return; }
    all = sortClients(rows.map(clientOf));
    $('state').textContent = '';
    $('bk-tools').hidden = false;
    render();
  } catch (err) {
    $('state').textContent = `הלקוחות לא נטענו. ${errorText(err)}`;
  }
}

mountSession(async (staff) => {
  const viewer = await viewerOf(staff.email);
  const me = viewer.me;
  // Her, and the owners (to look at what she sees). The database decides the same.
  if (!(isBookkeeper(me) || isOwnerView(viewer))) { $('no-access').hidden = false; return; }
  $('bk-main').hidden = false;
  if (me) document.title = `${BOOKKEEPER_TITLE} · ${PEOPLE[me].name} · astrateg`;
  $('state').textContent = 'טוען…';
  $('bk-q').addEventListener('input', render);
  $('bk-q').addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && ev.currentTarget.value) { ev.currentTarget.value = ''; render(); } });
  await load();
  document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });
});
