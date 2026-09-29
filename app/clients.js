// Clients list, "my work" across clients, and the daily control view
// (protocol processes 32 and 33).
import { PEOPLE, PHASES, CLIENT_STATUS, OFFICE_REVIEWS } from './protocol.js';
import { clientState, openItemsFor, byUrgency, bucketOf, CLAIM } from './protocol-logic.js';
import {
  loadClients, loadChecks, loadTasks, setCheck, clearCheck, setTaskDone, createClient, signedQuotes,
  myPerson, setMyPerson, loadDirectory,
} from './protocol-data.js';
import {
  $, fill, h, toast, errorText, personChip, peopleChips, formatWhen, formatDay, statusBadge, progressBar,
  mountSession, store, directory,
} from './protocol-ui.js';

let clients = [];
let checks = {};
let tasks = [];
let me = null;              // this user's person key
let minePerson = null;      // whose work the "my work" tab shows ('' = everyone)
let view = 'mine';
let clientFilter = 'active';
const clientUrl = (id, hash = '') => `client.html?id=${encodeURIComponent(id)}${hash}`;

const states = new Map();
function stateOf(c) {
  if (!states.has(c.id)) states.set(c.id, clientState(c, checks[c.id] || {}, new Date()));
  return states.get(c.id);
}

async function load() {
  $('state').textContent = clients.length ? '' : 'טוען…';
  try {
    [clients, checks, tasks] = await Promise.all([loadClients({ includeEnded: true }), loadChecks(), loadTasks({ openOnly: true })]);
  } catch (err) {
    $('state').textContent = errorText(err);
    return;
  }
  states.clear();
  $('state').textContent = '';
  renderKeepingFocus();
}

// Re-rendering replaces elements; keep keyboard focus and scroll where they were.
function renderKeepingFocus() {
  const focusId = document.activeElement?.id;
  const y = window.scrollY;
  render();
  window.scrollTo({ top: y });
  if (focusId) document.getElementById(focusId)?.focus({ preventScroll: true });
}

// ── Identity ────────────────────────────────
async function chooseMe(key) {
  me = key; minePerson = key; store.set('me', key);
  try { await setMyPerson(key); } catch { /* kept locally */ }
  renderMe();
  setView('mine');
}
function renderMe() {
  const bar = $('me-bar');
  if (me) {
    fill(bar, h('span', { class: 'me-label' }, 'אני:'), personChip(me, 'is-me'), h('span', { class: 'muted' }, PEOPLE[me].role),
      h('button', { type: 'button', class: 'btn-text', onclick: () => { me = null; minePerson = null; renderMe(); render(); } }, 'החלפה'));
    return;
  }
  fill(bar);
}
function identityPanel() {
  return h('div', { class: 'who-panel' },
    h('h2', {}, 'מי את/ה בפרוטוקול?'),
    h('p', { class: 'muted' }, 'בוחרים פעם אחת, ואז ״מה עליי״ מציג את הפריטים הפתוחים שלך בכל הלקוחות.'),
    h('div', { class: 'who-grid' }, ...Object.values(PEOPLE).map((p) => h('button', {
      type: 'button', class: `who-btn p-${p.key}`, onclick: () => chooseMe(p.key),
    }, h('strong', {}, p.name), h('span', {}, p.role)))),
    h('button', { type: 'button', class: 'btn-text', onclick: () => { minePerson = ''; renderMine(); } }, 'להציג את הפריטים של כל הצוות'));
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
  const next = { ArrowLeft: TABS[(i + 1) % TABS.length], ArrowRight: TABS[(i + TABS.length - 1) % TABS.length], Home: TABS[0], End: TABS[TABS.length - 1] }[e.key];
  if (!next) return;
  e.preventDefault();
  setView(next, true);
});

function render() {
  if (view === 'mine') renderMine();
  if (view === 'clients') renderClients();
  if (view === 'control') renderControl();
}

// ── My work ─────────────────────────────────
// Open work grouped by client and process (tasks are groups of one).
function workFor(person) {
  const now = new Date();
  const groups = new Map();
  for (const c of clients) {
    for (const e of openItemsFor(person, c, checks[c.id] || {}, stateOf(c), now)) {
      const k = `${c.id}:${e.proc.id}`;
      if (!groups.has(k)) groups.set(k, { key: k, client: c, proc: e.proc, status: e.status, dueAt: e.dueAt, claim: e.claim, shared: e.shared, entries: [] });
      groups.get(k).entries.push(e);
    }
  }
  for (const t of tasks) {
    if (person && t.owner !== person) continue;
    const client = clients.find((c) => c.id === t.client_id);
    if (!client) continue;
    const dueAt = t.due_on ? new Date(`${t.due_on}T23:59:59`) : null;
    const status = dueAt && dueAt < now ? 'overdue' : dueAt && dueAt.toDateString() === now.toDateString() ? 'today' : 'open';
    groups.set(`task:${t.id}`, { key: `task:${t.id}`, client, task: t, status, dueAt, entries: [{ client, task: t }] });
  }
  return [...groups.values()].sort(byUrgency);
}

function nextFocusAfter(input) {
  const all = [...document.querySelectorAll('#mine-list .cbx:not(:disabled)')];
  const i = all.indexOf(input);
  return (all[i + 1] || all[i - 1])?.id || null;
}

async function toggleEntry(e, input) {
  const next = nextFocusAfter(input);
  input.disabled = true;
  try {
    if (e.task) {
      await setTaskDone(e.task.id, true);
      tasks = tasks.filter((t) => t.id !== e.task.id);
    } else {
      const row = await setCheck(e.client.id, e.item.key, 'done');
      (checks[e.client.id] ||= {})[e.item.key] = row;
      states.delete(e.client.id);
    }
  } catch (err) {
    input.checked = false;
    input.disabled = false;
    toast(`הסימון לא נשמר. ${errorText(err)}`);
    return;
  }
  renderMine();
  if (next) document.getElementById(next)?.focus();
  toast(`סומן כבוצע: ${e.task ? e.task.title : e.item.label}`, { label: 'ביטול', run: () => undo(e) });
}

async function undo(e) {
  try {
    if (e.task) {
      const row = await setTaskDone(e.task.id, false);
      tasks = [row, ...tasks];
    } else {
      await clearCheck(e.client.id, e.item.key);
      delete checks[e.client.id][e.item.key];
      states.delete(e.client.id);
    }
    renderMine();
    toast('הסימון בוטל.');
  } catch (err) {
    toast(`הביטול לא נשמר. ${errorText(err)}`);
  }
}

async function claim(g, take) {
  try {
    if (take) {
      const row = await setCheck(g.client.id, CLAIM(g.proc), 'done', me);
      (checks[g.client.id] ||= {})[CLAIM(g.proc)] = row;
    } else {
      await clearCheck(g.client.id, CLAIM(g.proc));
      delete checks[g.client.id][CLAIM(g.proc)];
    }
    states.delete(g.client.id);
    renderKeepingFocus();
    toast(take ? `לקחת את תהליך ${g.proc.num} אצל ${g.client.name}.` : 'התהליך שוחרר.');
  } catch (err) {
    toast(errorText(err));
  }
}

function claimControl(g, person) {
  if (!g.shared || !person) return null;
  const others = g.proc.owners.filter((o) => o !== person).map((o) => PEOPLE[o].name).join(', ');
  if (g.claim?.person === person) {
    return h('span', { class: 'claim' }, person === me ? 'לקחת את זה' : `${PEOPLE[person].name} לקח/ה את זה`,
      person === me ? h('button', { type: 'button', class: 'btn-text', onclick: () => claim(g, false) }, 'שחרור') : null);
  }
  return h('span', { class: 'claim' }, `משותף עם ${others}`,
    person === me ? h('button', { type: 'button', class: 'btn btn-sm', onclick: () => claim(g, true) }, 'אני על זה') : null);
}

function groupCard(g, person) {
  const title = g.task ? 'משימה' : `${g.proc.num} · ${g.proc.title}`;
  const href = clientUrl(g.client.id, g.proc ? `#${g.proc.id}` : '#tasks');
  const owners = g.task ? [g.task.owner] : [...new Set(g.entries.flatMap((e) => e.item.owners))];
  return h('li', { class: `wproc s-${g.status}` },
    h('div', { class: 'wproc-h' },
      h('a', { class: 'wclient', href }, g.client.name),
      h('span', { class: 'wtitle' }, title),
      person ? null : peopleChips(owners),
      g.dueAt ? h('span', { class: 'num' }, `יעד: ${formatWhen(g.dueAt)}`) : null,
      statusBadge(g.status, g.dueAt),
      claimControl(g, person)),
    h('ul', { class: 'wlist' }, ...g.entries.map((e) => {
      const id = `w-${e.client.id}-${e.task ? e.task.id : e.item.key}`.replace(/[^\w-]/g, '_');
      return h('li', { class: 'witem' },
        h('label', { class: 'wrow', for: id },
          h('input', { type: 'checkbox', id, class: 'cbx', onchange: (ev) => toggleEntry(e, ev.currentTarget) }),
          h('span', { class: 'wlabel' }, e.task ? e.task.title : e.item.label)));
    })));
}

const BUCKETS = [['overdue', 'באיחור'], ['today', 'היום'], ['tomorrow', 'מחר'], ['week', 'השבוע'], ['later', 'בהמשך']];

function renderMine() {
  const wrap = $('mine-list');
  if (!me && minePerson === null) {
    fill($('mine-people'));
    fill(wrap, identityPanel());
    return;
  }
  const person = minePerson || null;
  const opts = [...Object.values(PEOPLE).map((p) => [p.key, p.key === me ? `${p.name} (אני)` : p.name]), ['', 'כל הצוות']];
  const count = (k) => workFor(k || null).length;
  fill($('mine-people'),
    h('div', { class: 'chips-row wide-only' }, ...opts.map(([k, label]) => h('button', {
      type: 'button', class: 'chip', 'aria-pressed': String((minePerson || '') === k),
      onclick: () => { minePerson = k; renderMine(); },
    }, label, h('span', { class: 'n' }, String(count(k)))))),
    h('label', { class: 'narrow-only person-select' }, h('span', {}, 'מציג:'),
      h('select', { class: 'input', id: 'mine-select', onchange: (ev) => { minePerson = ev.currentTarget.value; renderMine(); } },
        ...opts.map(([k, label]) => h('option', { value: k, selected: (minePerson || '') === k }, `${label} (${count(k)})`)))));

  if (!clients.length) {
    fill(wrap, h('p', { class: 'empty' }, 'עדיין אין לקוחות. לקוח חדש נפתח בכפתור ״לקוח חדש״.'));
    return;
  }
  const list = workFor(person);
  if (!list.length) {
    fill(wrap, h('p', { class: 'empty' }, person ? `אין כרגע משהו פתוח אצל ${PEOPLE[person].name}.` : 'אין כרגע פריטים פתוחים.'));
    return;
  }
  fill(wrap, ...BUCKETS.map(([k, title]) => {
    const g = list.filter((x) => bucketOf(x.status, x.dueAt) === k);
    if (!g.length) return null;
    return h('section', { class: `wgroup g-${k}`, 'aria-label': title },
      h('h2', { class: 'wgroup-h' }, title, h('span', { class: 'n' }, String(g.length))),
      h('ul', { class: 'wprocs' }, ...g.map((x) => groupCard(x, person))));
  }));
}

// ── Clients ─────────────────────────────────
function nextStep(c, s) {
  const open = openItemsFor(null, c, checks[c.id] || {}, s).sort(byUrgency)[0];
  return open ? { proc: open.proc, owners: open.claim ? [open.claim.person] : open.item.owners } : null;
}

function renderClients() {
  const FILTERS = [['active', 'פעילים'], ['late', 'עם איחור'], ['ending', 'מסיימים'], ['ended', 'הסתיימו']];
  fill($('client-filters'), ...FILTERS.map(([k, label]) => h('button', {
    type: 'button', class: 'chip', 'aria-pressed': String(clientFilter === k),
    onclick: () => { clientFilter = k; renderClients(); },
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
          h('span', { class: 'k' }, 'תהליכים שהושלמו'),
          h('span', { class: 'num', dir: 'ltr' }, `${s.procsDone}/${s.procsTotal}`),
          progressBar(s.procsDone, s.procsTotal, 'תהליכים שהושלמו')),
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
  const rows = Object.values(PEOPLE).map((p) => {
    const w = workFor(p.key);
    const late = w.filter((g) => g.status === 'overdue');
    return {
      p, late: late.length, today: w.filter((g) => bucketOf(g.status, g.dueAt) === 'today').length, open: w.length,
      clients: [...new Set(late.map((g) => g.client.name))],
    };
  });
  const todayIso = new Date().toLocaleDateString('en-CA');
  const stuck = clients.map((c) => ({
    c,
    lateProcs: stateOf(c).states.filter((x) => x.status === 'overdue' && (c.status !== 'ended' || x.proc.id === 'p35')),
    lateTasks: tasks.filter((t) => t.client_id === c.id && t.due_on && t.due_on < todayIso),
  })).filter((x) => x.lateProcs.length || x.lateTasks.length);

  fill($('control'),
    h('p', { class: 'control-intro' }, ...OFFICE_REVIEWS.map((r) => h('span', {}, `תהליך ${r.num} · ${r.title} (${PEOPLE[r.owner].name}, ${r.sla})`))),
    h('h2', { class: 'wgroup-h' }, 'לפי עובד', h('span', { class: 'muted small' }, 'נספר בתהליכים')),
    h('div', { class: 'table-wrap' }, h('table', { class: 'qtable ctable' },
      h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'עובד'), h('th', { scope: 'col' }, 'באיחור'), h('th', { scope: 'col' }, 'להיום'), h('th', { scope: 'col' }, 'פתוחים'), h('th', { scope: 'col' }, 'לקוחות עם איחור'), h('th', { scope: 'col' }, h('span', { class: 'sr-only' }, 'פעולות')))),
      h('tbody', {}, ...rows.map((r) => h('tr', {},
        h('td', { 'data-label': 'עובד' }, personChip(r.p.key), h('small', { class: 'by' }, r.p.role)),
        h('td', { 'data-label': 'באיחור', class: r.late ? 'late num' : 'num' }, String(r.late)),
        h('td', { 'data-label': 'להיום', class: 'num' }, String(r.today)),
        h('td', { 'data-label': 'פתוחים', class: 'num' }, String(r.open)),
        h('td', { 'data-label': 'לקוחות עם איחור', class: 'client' }, r.clients.join(', ') || '—'),
        h('td', { class: 'acts-cell' }, h('button', {
          type: 'button', class: 'btn-text', onclick: () => { minePerson = r.p.key; setView('mine'); },
        }, `הרשימה של ${r.p.name}`))))))),
    h('h2', { class: 'wgroup-h' }, 'לקוחות עם איחור', h('span', { class: 'n' }, String(stuck.length))),
    stuck.length
      ? h('ul', { class: 'stuck' }, ...stuck.map(({ c, lateProcs, lateTasks }) => h('li', {},
        h('a', { href: clientUrl(c.id), class: 'wclient' }, c.name),
        h('ul', {},
          ...lateProcs.map((x) => h('li', {},
            h('a', { href: clientUrl(c.id, `#${x.proc.id}`) }, `${x.proc.num} · ${x.proc.title}`), ' ',
            peopleChips(x.claim ? [x.claim.person] : x.proc.owners),
            x.proc.owners.length > 1 && !x.claim ? h('span', { class: 'tag' }, 'לא נלקח') : null,
            h('span', { class: 'muted num' }, ` · יעד ${formatWhen(x.dueAt)}`))),
          ...lateTasks.map((t) => h('li', {},
            h('a', { href: clientUrl(c.id, '#tasks') }, `משימה: ${t.title}`), ' ', personChip(t.owner),
            h('span', { class: 'muted num' }, ` · עד ${formatDay(t.due_on)}`)))))))
      : h('p', { class: 'empty' }, 'אין לקוחות עם תהליכים או משימות באיחור.'),
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
  $('new-contract-end').value = end.toLocaleDateString('en-CA');
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
    // The deal reaches the office now, so the clocks of processes 1–3 start now.
    const row = await createClient({
      name, business: val('new-business'), phone: val('new-phone'), package_name: val('new-package'),
      shoot_type: val('new-shoot-type'), contract_end: val('new-contract-end'), quote_id: q?.id || null,
    });
    // An agreement signed in the system already covers process 1.
    if (q) {
      const note = `נחתם במערכת: ${q.number}`;
      await Promise.allSettled(['p01.prepared', 'p01.sent', 'p01.signed'].map((k) => setCheck(row.id, k, 'done', note)));
    }
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
setInterval(() => { if (!document.hidden && !$('app').hidden) { states.clear(); renderKeepingFocus(); } }, 60e3);

mountSession(async () => {
  Object.assign(directory, await loadDirectory());
  me = (await myPerson()) || store.get('me') || null;
  if (me && !PEOPLE[me]) me = null;
  minePerson = me;
  renderMe();
  const fromHash = location.hash.slice(1);
  view = TABS.includes(fromHash) ? fromHash : 'mine';
  await load();
  setView(view);
});
