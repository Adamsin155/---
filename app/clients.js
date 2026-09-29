// Clients list, "my work" across clients, and the daily control view
// (protocol processes 32 and 33).
import { PEOPLE, PHASES, CLIENT_STATUS, OFFICE_REVIEWS } from './protocol.js';
import { clientState, openItemsFor, byUrgency } from './protocol-logic.js';
import {
  loadClients, loadChecks, loadTasks, setCheck, setTaskDone, createClient, signedQuotes, myPerson, setMyPerson,
} from './protocol-data.js';
import {
  $, fill, h, toast, errorText, personChip, peopleChips, formatWhen, formatDay, statusBadge, progressBar, mountSession, store,
} from './protocol-ui.js';

let clients = [];
let checks = {};
let tasks = [];
let me = null;              // this user's person key
let minePerson = null;      // whose work the "my work" tab shows
let view = 'mine';
let clientFilter = 'active';
let includeEnded = false;
const clientUrl = (id, hash = '') => `client.html?id=${encodeURIComponent(id)}${hash}`;

const states = new Map();
function stateOf(c) {
  if (!states.has(c.id)) states.set(c.id, clientState(c, checks[c.id] || {}, new Date()));
  return states.get(c.id);
}

async function load() {
  $('state').textContent = 'טוען…';
  try {
    [clients, checks, tasks] = await Promise.all([loadClients({ includeEnded }), loadChecks(), loadTasks({ openOnly: true })]);
  } catch (err) {
    $('state').textContent = errorText(err);
    return;
  }
  states.clear();
  $('state').textContent = '';
  render();
}

// ── Identity ────────────────────────────────
function renderMe() {
  const bar = $('me-bar');
  if (me) {
    fill(bar, h('span', { class: 'me-label' }, 'אני:'), personChip(me, 'is-me'), h('span', { class: 'muted' }, PEOPLE[me].role),
      h('button', { type: 'button', class: 'btn-text', onclick: () => { me = null; renderMe(); } }, 'החלפה'));
    return;
  }
  fill(bar, 
    h('span', { class: 'me-label' }, 'מי את/ה בפרוטוקול?'),
    ...Object.values(PEOPLE).map((p) => h('button', {
      type: 'button', class: 'chip', onclick: async () => {
        me = p.key; minePerson = p.key; store.set('me', p.key);
        try { await setMyPerson(p.key); } catch { /* kept locally */ }
        renderMe(); render();
      },
    }, p.name)),
  );
}

// ── Tabs ────────────────────────────────────
const TABS = ['mine', 'clients', 'control'];
function setView(v, focus = false) {
  view = v;
  for (const t of TABS) {
    $(`tab-${t}`).setAttribute('aria-selected', String(t === v));
    $(`tab-${t}`).tabIndex = t === v ? 0 : -1;
    $(`view-${t}`).hidden = t !== v;
  }
  if (focus) $(`tab-${v}`).focus();
  history.replaceState(null, '', `#${v}`);
  render();
}
for (const t of TABS) $(`tab-${t}`).addEventListener('click', () => setView(t));
document.querySelector('.tabs').addEventListener('keydown', (e) => {
  const i = TABS.indexOf(view);
  if (e.key === 'ArrowLeft') setView(TABS[(i + 1) % TABS.length], true);
  else if (e.key === 'ArrowRight') setView(TABS[(i + TABS.length - 1) % TABS.length], true);
  else return;
  e.preventDefault();
});

function render() {
  if (view === 'mine') renderMine();
  if (view === 'clients') renderClients();
  if (view === 'control') renderControl();
}

// ── My work ─────────────────────────────────
function workFor(person) {
  const now = new Date();
  const items = [];
  for (const c of clients) {
    if (c.status === 'ended') continue;
    items.push(...openItemsFor(person, c, checks[c.id] || {}, stateOf(c), now));
  }
  const own = tasks.filter((t) => !person || t.owner === person).map((t) => {
    const client = clients.find((c) => c.id === t.client_id);
    const dueAt = t.due_on ? new Date(`${t.due_on}T23:59:59`) : null;
    const status = dueAt && dueAt < now ? 'overdue' : dueAt && dueAt.toDateString() === now.toDateString() ? 'today' : 'open';
    return client ? { client, task: t, status, dueAt } : null;
  }).filter(Boolean);
  return [...items, ...own].sort(byUrgency);
}

async function toggleItem(entry, input) {
  input.disabled = true;
  try {
    if (entry.task) {
      await setTaskDone(entry.task.id, true);
      tasks = tasks.filter((t) => t.id !== entry.task.id);
    } else {
      const row = await setCheck(entry.client.id, entry.item.key, 'done');
      (checks[entry.client.id] ||= {})[entry.item.key] = row;
      states.delete(entry.client.id);
    }
    input.closest('li').classList.add('is-done');
    toast(`סומן כבוצע: ${entry.task ? entry.task.title : entry.item.label}`);
  } catch (err) {
    input.checked = false;
    input.disabled = false;
    toast(`הסימון לא נשמר. ${errorText(err)}`);
  }
}

function workRow(e, showOwner) {
  const id = `w-${e.client.id}-${e.task ? e.task.id : e.item.key}`.replace(/[^\w-]/g, '_');
  const owners = e.task ? [e.task.owner] : e.item.owners;
  const where = e.task ? 'משימה' : `תהליך ${e.proc.num} · ${e.proc.title}`;
  return h('li', { class: `witem s-${e.status}` },
    h('input', { type: 'checkbox', id, class: 'cbx', onchange: (ev) => toggleItem(e, ev.currentTarget) }),
    h('div', { class: 'wbody' },
      h('label', { for: id, class: 'wlabel' }, e.task ? e.task.title : e.item.label),
      h('div', { class: 'wmeta' },
        h('a', { href: clientUrl(e.client.id, e.proc ? `#${e.proc.id}` : '#tasks'), class: 'wclient' }, e.client.name),
        h('span', {}, where),
        showOwner ? peopleChips(owners) : null,
        e.dueAt ? h('span', { class: 'num' }, `יעד: ${formatWhen(e.dueAt)}`) : null)),
    statusBadge(e.status, e.dueAt));
}

function renderMine() {
  const opts = [...Object.values(PEOPLE).map((p) => [p.key, p.key === me ? `${p.name} (אני)` : p.name]), ['', 'כולם']];
  if (minePerson === null && me) minePerson = me;
  fill($('mine-people'), ...opts.map(([k, label]) => h('button', {
    type: 'button', class: 'chip', 'aria-pressed': String((minePerson || '') === k),
    onclick: () => { minePerson = k || ''; renderMine(); },
  }, label, h('span', { class: 'n' }, String(workFor(k || null).length)))));

  const list = workFor(minePerson || null);
  const groups = [['overdue', 'באיחור'], ['today', 'להיום'], ['due', 'לביצוע השבוע'], ['open', 'פתוח']];
  const wrap = $('mine-list');
  if (!clients.length) {
    fill(wrap, h('p', { class: 'empty' }, 'עדיין אין לקוחות. לקוח חדש נפתח בכפתור ״לקוח חדש״.'));
    return;
  }
  if (!list.length) {
    fill(wrap, h('p', { class: 'empty' }, minePerson ? `אין כרגע פריטים פתוחים אצל ${PEOPLE[minePerson].name}.` : 'אין כרגע פריטים פתוחים.'));
    return;
  }
  fill(wrap, ...groups.map(([k, title]) => {
    const g = list.filter((e) => e.status === k);
    if (!g.length) return null;
    return h('section', { class: `wgroup g-${k}`, 'aria-label': title },
      h('h2', { class: 'wgroup-h' }, title, h('span', { class: 'n' }, String(g.length))),
      h('ul', { class: 'wlist' }, ...g.map((e) => workRow(e, !minePerson))));
  }));
}

// ── Clients ─────────────────────────────────
function nextStep(c, s) {
  const open = openItemsFor(null, c, checks[c.id] || {}, s).sort(byUrgency)[0];
  return open ? { proc: open.proc, owners: open.item.owners, status: open.status } : null;
}

function renderClients() {
  const FILTERS = [['active', 'פעילים'], ['late', 'עם איחור'], ['ending', 'מסיימים'], ['ended', 'הסתיימו']];
  fill($('client-filters'), ...FILTERS.map(([k, label]) => h('button', {
    type: 'button', class: 'chip', 'aria-pressed': String(clientFilter === k),
    onclick: async () => {
      clientFilter = k;
      if (k === 'ended' && !includeEnded) { includeEnded = true; await load(); } else renderClients();
    },
  }, label)));

  const q = $('client-search').value.trim();
  const list = clients.filter((c) => {
    if (q && !`${c.name} ${c.business || ''} ${c.phone || ''}`.includes(q)) return false;
    if (clientFilter === 'active') return c.status === 'active';
    if (clientFilter === 'late') return c.status !== 'ended' && stateOf(c).overdue > 0;
    return c.status === clientFilter;
  }).sort((a, b) => (stateOf(b).overdue - stateOf(a).overdue) || (new Date(b.deal_at) - new Date(a.deal_at)));

  if (!list.length) {
    fill($('client-list'), h('p', { class: 'empty' }, clients.length ? 'אין לקוחות בסינון הזה.' : 'עדיין אין לקוחות. לקוח חדש נפתח בכפתור ״לקוח חדש״.'));
    return;
  }
  fill($('client-list'), h('ul', { class: 'clist' }, ...list.map((c) => {
    const s = stateOf(c);
    const phase = PHASES.find((p) => p.key === s.current);
    const next = nextStep(c, s);
    return h('li', {},
      h('a', { class: 'crow', href: clientUrl(c.id) },
        h('div', { class: 'cname' },
          h('strong', {}, c.name),
          h('small', {}, [c.business, c.package_name].filter(Boolean).join(' · ') || ' ')),
        h('div', { class: 'cphase' },
          h('span', { class: 'k' }, 'שלב'),
          h('span', {}, c.status === 'active' ? phase?.title : CLIENT_STATUS[c.status])),
        h('div', { class: 'cprog' },
          h('span', { class: 'k' }, 'התקדמות'),
          h('span', { class: 'num', dir: 'ltr' }, `${s.resolved}/${s.required}`),
          progressBar(s.resolved, s.required, 'התקדמות בפרוטוקול')),
        h('div', { class: 'cnext' },
          h('span', { class: 'k' }, 'הצעד הבא'),
          next ? h('span', {}, `${next.proc.num} · ${next.proc.title} `, peopleChips(next.owners)) : h('span', { class: 'muted' }, 'אין פריטים פתוחים')),
        h('div', { class: 'cflags' },
          s.overdue ? statusBadge('overdue', null) : null,
          s.overdue ? h('span', { class: 'num' }, `${s.overdue} תהליכים`) : null,
          c.shoot_at ? h('span', { class: 'muted' }, `צילום: ${formatWhen(new Date(c.shoot_at))}`) : null)));
  })));
}
$('client-search').addEventListener('input', renderClients);

// ── Daily control (processes 32, 33) ─────────
function renderControl() {
  const people = Object.values(PEOPLE);
  const rows = people.map((p) => {
    const w = workFor(p.key);
    return { p, overdue: w.filter((e) => e.status === 'overdue').length, today: w.filter((e) => e.status === 'today').length, open: w.length };
  });
  const late = clients.filter((c) => c.status !== 'ended' && stateOf(c).overdue > 0);
  const stuck = late.map((c) => {
    const s = stateOf(c);
    const lateProcs = s.states.filter((x) => x.status === 'overdue');
    return { c, lateProcs };
  });

  fill($('control'), 
    h('p', { class: 'control-intro' }, ...OFFICE_REVIEWS.map((r) => h('span', {}, `תהליך ${r.num} · ${r.title} (${PEOPLE[r.owner].name}, ${r.sla})`))),
    h('h2', { class: 'wgroup-h' }, 'לפי עובד'),
    h('div', { class: 'table-wrap' }, h('table', { class: 'qtable ctable' },
      h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'עובד'), h('th', { scope: 'col' }, 'באיחור'), h('th', { scope: 'col' }, 'להיום'), h('th', { scope: 'col' }, 'פתוחים'), h('th', { scope: 'col' }, h('span', { class: 'sr-only' }, 'פעולות')))),
      h('tbody', {}, ...rows.map((r) => h('tr', {},
        h('td', { 'data-label': 'עובד' }, personChip(r.p.key), h('small', { class: 'by' }, r.p.role)),
        h('td', { 'data-label': 'באיחור', class: r.overdue ? 'late num' : 'num' }, String(r.overdue)),
        h('td', { 'data-label': 'להיום', class: 'num' }, String(r.today)),
        h('td', { 'data-label': 'פתוחים', class: 'num' }, String(r.open)),
        h('td', { class: 'acts-cell' }, h('button', {
          type: 'button', class: 'btn btn-sm btn-ghost', onclick: () => { minePerson = r.p.key; setView('mine'); },
        }, 'הצגת הרשימה'))))))),
    h('h2', { class: 'wgroup-h' }, 'לקוחות עם איחור', h('span', { class: 'n' }, String(stuck.length))),
    stuck.length
      ? h('ul', { class: 'stuck' }, ...stuck.map(({ c, lateProcs }) => h('li', {},
        h('a', { href: clientUrl(c.id), class: 'wclient' }, c.name),
        h('ul', {}, ...lateProcs.map((x) => h('li', {},
          h('a', { href: clientUrl(c.id, `#${x.proc.id}`) }, `${x.proc.num} · ${x.proc.title}`), ' ', peopleChips(x.proc.owners),
          h('span', { class: 'muted num' }, ` · יעד ${formatWhen(x.dueAt)}`)))))))
      : h('p', { class: 'empty' }, 'אין לקוחות עם תהליכים באיחור.'),
  );
}

// ── New client ──────────────────────────────
const dlg = $('dlg-new');
let quotesForNew = [];
dlg.addEventListener('click', (e) => { if (e.target.closest('[data-close]') || e.target === dlg) dlg.close(); });
$('btn-new').addEventListener('click', async () => {
  $('new-form').reset();
  $('new-err').hidden = true;
  dlg.showModal();
  $('new-name').focus();
  try {
    quotesForNew = await signedQuotes();
  } catch { quotesForNew = []; }
  $('from-quote-field').hidden = !quotesForNew.length;
  fill($('new-quote'), h('option', { value: '' }, 'בלי הסכם (מילוי ידני)'),
    ...quotesForNew.map((q) => h('option', { value: q.id }, `${q.number} · ${q.client_name}${q.company ? ` (${q.company})` : ''} · נחתם ${formatDay(q.signed_at)}`)));
});
$('new-quote').addEventListener('change', () => {
  const q = quotesForNew.find((x) => x.id === $('new-quote').value);
  if (!q) return;
  $('new-name').value = q.client_name || '';
  $('new-business').value = q.company || '';
  $('new-phone').value = q.phone || '';
  $('new-package').value = [q.tier, q.influencer].filter(Boolean).join(' · ');
  $('new-shoot-type').value = /נטלי/.test(q.influencer || '') ? 'natali' : q.influencer ? 'dms' : '';
  const end = new Date(q.signed_at);
  end.setMonth(end.getMonth() + (Number(q.term_months) || 12));
  $('new-contract-end').value = `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}-${String(end.getDate()).padStart(2, '0')}`;
});
$('new-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = $('new-name').value.trim();
  const fail = (msg) => { $('new-err').textContent = msg; $('new-err').hidden = false; };
  $('new-name').setAttribute('aria-invalid', String(!name));
  if (!name) { $('new-name').focus(); return fail('חסר שם לקוח.'); }
  const q = quotesForNew.find((x) => x.id === $('new-quote').value);
  const val = (id) => $(id).value.trim() || null;
  $('new-submit').disabled = true;
  try {
    const row = await createClient({
      name, business: val('new-business'), phone: val('new-phone'), package_name: val('new-package'),
      shoot_type: val('new-shoot-type'), contract_end: val('new-contract-end'),
      quote_id: q?.id || null, deal_at: q?.signed_at || new Date().toISOString(),
    });
    location.href = clientUrl(row.id);
  } catch (err) {
    fail(errorText(err));
    $('new-submit').disabled = false;
  }
});

$('btn-refresh').addEventListener('click', load);
window.addEventListener('hashchange', () => {
  const v = location.hash.slice(1);
  if (TABS.includes(v) && v !== view && !$('app').hidden) setView(v);
});
document.addEventListener('visibilitychange', () => { if (!document.hidden && !$('app').hidden) load(); });
// Statuses depend on the clock: refresh them every minute.
setInterval(() => { if (!document.hidden && !$('app').hidden) { states.clear(); render(); } }, 60e3);

mountSession(async () => {
  me = (await myPerson()) || store.get('me') || null;
  if (me && !PEOPLE[me]) me = null;
  minePerson = me;
  renderMe();
  const fromHash = location.hash.slice(1);
  view = TABS.includes(fromHash) ? fromHash : (me ? 'mine' : 'clients');
  await load();
  setView(view);
});

