// Clients list, "my work" across clients, the daily control view (protocol
// processes 32 and 33) and the performance report.
import { PEOPLE, PHASES, PROCESSES, CLIENT_STATUS, OFFICE_REVIEWS, REVIEW_TOPICS } from './protocol.js';
import {
  clientState, openItemsFor, byUrgency, bucketOf, CLAIM, WAIT, waitNote, bulkEligible, isResolved,
  isBusinessDay, businessDaysBetween, addBusinessDays, resolveTime,
} from './protocol-logic.js';
import {
  loadClients, loadChecks, loadTasks, setCheck, clearCheck, setChecksBulk, clearChecksBulk, setTaskDone, createClient,
  signedQuotes, myPerson, setMyPerson, loadDirectory, loadReviews, markReview, loadAllLog,
} from './protocol-data.js';
import {
  $, fill, h, toast, errorText, personChip, peopleChips, formatWhen, formatDay, statusBadge, progressBar,
  mountSession, store, directory, who, lateBy, formatStamp, loadQuoteNumbers,
} from './protocol-ui.js';
import { whatsappLink } from './quote-doc.js';

let clients = [];
let checks = {};
let tasks = [];
let reviews = null;         // office_reviews rows of the last 7 business days (null = not loaded)
let reviewsError = null;
let quoteInfo = new Map();  // quote id -> { number, signed_at }, for clients opened automatically
let me = null;              // this user's person key
let minePerson = null;      // whose work the "my work" tab shows ('' = everyone)
let view = 'mine';
let clientFilter = 'active';
let lastLoad = 0;
let waitGroupOpen = null;   // the collapsed "waiting on client" group keeps its state across renders
const clientUrl = (id, hash = '') => `client.html?id=${encodeURIComponent(id)}${hash}`;

const states = new Map();
function stateOf(c) {
  if (!states.has(c.id)) states.set(c.id, clientState(c, checks[c.id] || {}, new Date()));
  return states.get(c.id);
}

// ── Small helpers ───────────────────────────
const dayIso = (d) => new Date(d).toLocaleDateString('en-CA');
const dm = (d) => `${d.getDate()}.${d.getMonth() + 1}`;
const WEEKDAY = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];
// A bare date (yyyy-mm-dd) as "ב׳ 30.9", read as a local calendar day.
const dayShort = (iso) => { const [y, m, d] = String(iso).split('-').map(Number); const x = new Date(y, m - 1, d); return `${WEEKDAY[x.getDay()]} ${dm(x)}`; };
const weekdayLong = new Intl.DateTimeFormat('he-IL', { weekday: 'long' });
const hm = (d) => new Intl.DateTimeFormat('he-IL', { hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(d));
const live = (c) => c.status !== 'cancelled';
// A client opened by the signing trigger stays "new" until someone confirms its details.
const isAuto = (c) => c.created_by_email === 'system' && !c.verified_at && live(c);
const roundOf = (proc) => /^r(\d+)-/.exec(proc.id)?.[1] || null;
const procLabel = (proc, sep = ' · ') => `${roundOf(proc) ? `סבב ${roundOf(proc)} · ` : ''}${proc.num}${sep}${proc.title}`;
const namesOf = (keys) => keys.map((k) => PEOPLE[k]?.name || k).join(', ');
const busy = () => !!document.querySelector('dialog[open]');
const recheckDue = (wait, today = dayIso(new Date())) => !!(wait?.recheck && wait.recheck <= today);
const peopleOf = (x) => (x.claim ? [x.claim.person] : x.proc.owners);

async function load() {
  $('state').textContent = clients.length ? '' : 'טוען…';
  const now = new Date();
  try {
    [clients, checks, tasks] = await Promise.all([loadClients({ includeEnded: true }), loadChecks(), loadTasks({ openOnly: true })]);
  } catch (err) {
    $('state').textContent = errorText(err);
    return;
  }
  // Reviews and agreement numbers are extras: the page works without them.
  const [rv, qi] = await Promise.allSettled([
    loadReviews(dayIso(lastBusinessDays(7, now).at(-1))),
    loadQuoteNumbers(clients.filter(isAuto).map((c) => c.quote_id)),
  ]);
  reviews = rv.status === 'fulfilled' ? rv.value : null;
  reviewsError = rv.status === 'rejected' ? rv.reason : null;
  if (qi.status === 'fulfilled') quoteInfo = qi.value;
  states.clear();
  lastLoad = Date.now();
  $('state').textContent = '';
  watchNewClients();
  checkLate();
  if (!document.hidden) renderKeepingFocus();
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
  lastLate = null;
  try { await setMyPerson(key); } catch { /* kept locally */ }
  renderMe();
  setView('mine');
}
function renderMe() {
  const bar = $('me-bar');
  if (me) {
    fill(bar, h('span', { class: 'me-label' }, 'אני:'), personChip(me, 'is-me'), h('span', { class: 'muted' }, PEOPLE[me].role),
      h('button', { type: 'button', class: 'btn-text', onclick: () => { me = null; minePerson = null; lastLate = null; renderMe(); render(); } }, 'החלפה'));
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
const TABS = ['mine', 'clients', 'control', 'performance'];
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
  if (view === 'performance') renderPerformance();
}

// ── My work ─────────────────────────────────
// Open work grouped by client and process (tasks are groups of one).
// Cancelled clients have no open work (openItemsFor), and their tasks are left out too.
function workFor(person) {
  const now = new Date();
  const groups = new Map();
  for (const c of clients) {
    for (const e of openItemsFor(person, c, checks[c.id] || {}, stateOf(c), now)) {
      const k = `${c.id}:${e.proc.id}`;
      if (!groups.has(k)) groups.set(k, { key: k, client: c, proc: e.proc, status: e.status, dueAt: e.dueAt, claim: e.claim, shared: e.shared, wait: e.wait, entries: [] });
      groups.get(k).entries.push(e);
    }
  }
  for (const t of tasks) {
    if (person && t.owner !== person) continue;
    const client = clients.find((c) => c.id === t.client_id);
    if (!client || !live(client)) continue;
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

// ── Mark the whole process (spec §1) ─────────
// Offered by `me` only, never on behalf of the person being viewed.
function bulkFor(g) {
  if (!me || g.task) return null;
  const s = stateOf(g.client).states.find((x) => x.proc.id === g.proc.id);
  if (!s) return null;
  const cs = checks[g.client.id] || {};
  const items = bulkEligible(s, me, g.client, cs);
  if (items.length < 2) return null;
  const open = g.proc.items.filter((i) => !i.optional && !isResolved(i, cs[i.key]));
  return { items, whole: items.length === open.length };
}

function focusGroupAt(index) {
  const cards = [...document.querySelectorAll('#mine-list .wproc')];
  const card = cards[Math.min(index, cards.length - 1)];
  card?.querySelector('.cbx:not(:disabled), .bulk-btn, a')?.focus();
}

async function bulkMark(g, bulk, btn) {
  const c = g.client;
  const keys = bulk.items.map((i) => i.key);
  const index = [...document.querySelectorAll('#mine-list .wproc')].indexOf(btn.closest('.wproc'));
  btn.disabled = true;
  let rows;
  try {
    rows = await setChecksBulk(c.id, keys, 'done');
  } catch (err) {
    btn.disabled = false;
    toast(`הסימון לא נשמר ולכן בוטל. אף פריט לא סומן. ${errorText(err)}`);
    return;
  }
  for (const r of rows) (checks[c.id] ||= {})[r.item_key] = r;
  states.delete(c.id);
  const cs = checks[c.id];
  // Items that were blocked stay open for a separate, deliberate check.
  const left = g.proc.items.filter((i) => !i.optional && i.owners.includes(me) && !isResolved(i, cs[i.key]));
  renderMine();
  focusGroupAt(index);
  const n = keys.length;
  const msg = left.length
    ? `סומנו ${n} פריטים. ${left.map((i) => `״${i.label}״`).join(', ')} ${left.length > 1 ? 'נשארו פתוחים' : 'נשאר פתוח'} לסימון נפרד.`
    : `סומנו ${n} פריטים בתהליך ${procLabel(g.proc)}.`;
  toast(msg, { label: 'ביטול', run: () => bulkUndo(c, keys, g) });
}

async function bulkUndo(c, keys, g) {
  try {
    await clearChecksBulk(c.id, keys);
  } catch (err) {
    toast(`הביטול לא נשמר. הפריטים נשארו מסומנים. ${errorText(err)}`);
    return;
  }
  for (const k of keys) delete checks[c.id][k];
  states.delete(c.id);
  renderMine();
  document.querySelector(`#mine-list .wproc[data-key="${CSS.escape(g.key)}"]`)?.querySelector('.bulk-btn, .cbx')?.focus();
  toast(`הסימון של ${keys.length} הפריטים בוטל.`);
}

// ── Waiting on the client (spec §4) ──────────
const waitDlg = $('dlg-wait');
let waitTarget = null;
waitDlg.addEventListener('click', (e) => { if (e.target.closest('[data-close]') || e.target === waitDlg) waitDlg.close(); });
function openWait(g) {
  waitTarget = g;
  $('wait-form').reset();
  $('wait-err').hidden = true;
  $('wait-reason').removeAttribute('aria-invalid');
  $('wait-ctx').textContent = `${g.client.name} · תהליך ${procLabel(g.proc)}`;
  $('wait-recheck').value = dayIso(addBusinessDays(new Date(), 1));
  waitDlg.showModal();
  $('wait-reason').focus();
}
$('wait-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const g = waitTarget;
  const reason = $('wait-reason').value.trim();
  $('wait-reason').setAttribute('aria-invalid', String(!reason));
  if (!reason) {
    $('wait-err').textContent = 'כתבו בקצרה למה ממתינים, כדי שמי שבודק יידע מה לבקש מהלקוח.';
    $('wait-err').hidden = false;
    $('wait-reason').focus();
    return;
  }
  $('wait-submit').disabled = true;
  try {
    const row = await setCheck(g.client.id, WAIT(g.proc), 'done', waitNote(reason, $('wait-recheck').value || null));
    (checks[g.client.id] ||= {})[WAIT(g.proc)] = row;
    states.delete(g.client.id);
    waitDlg.close();
    renderKeepingFocus();
    toast(`תהליך ${g.proc.num} סומן כממתין ללקוח.`, { label: 'ביטול', run: () => endWait(g, true) });
  } catch (err) {
    $('wait-err').textContent = `ההמתנה לא נשמרה. ${errorText(err)}`;
    $('wait-err').hidden = false;
  } finally {
    $('wait-submit').disabled = false;
  }
});

async function endWait(g, isUndo = false) {
  const prev = checks[g.client.id]?.[WAIT(g.proc)];
  try {
    await clearCheck(g.client.id, WAIT(g.proc));
  } catch (err) {
    toast(`${isUndo ? 'הביטול' : 'סיום ההמתנה'} לא נשמר. ${errorText(err)}`);
    return;
  }
  delete checks[g.client.id][WAIT(g.proc)];
  states.delete(g.client.id);
  renderKeepingFocus();
  if (isUndo) { toast('הסימון בוטל.'); return; }
  toast('ההמתנה הסתיימה. התהליך חוזר לחישוב הרגיל.', {
    label: 'ביטול',
    run: async () => {
      try {
        const row = await setCheck(g.client.id, WAIT(g.proc), 'done', prev?.note ?? null);
        (checks[g.client.id] ||= {})[WAIT(g.proc)] = row;
        states.delete(g.client.id);
        renderKeepingFocus();
        toast('ההמתנה חזרה.');
      } catch (err) { toast(`הביטול לא נשמר. ${errorText(err)}`); }
    },
  });
}

function waitLine(wait, id) {
  if (!wait) return null;
  return h('p', { class: 'wait-line', id },
    `ממתין ללקוח מאז ${formatStamp(wait.at)}`,
    wait.by_email ? ` · ${who(wait.by_email)}` : '',
    wait.reason ? ` · ״${wait.reason}״` : '',
    wait.recheck ? ` · לבדוק שוב: ${dayShort(wait.recheck)}` : '',
    recheckDue(wait) ? h('span', { class: 'tag tag-warn' }, 'הגיע מועד הבדיקה') : null);
}

function groupCard(g, person) {
  const title = g.task ? 'משימה' : procLabel(g.proc);
  const href = clientUrl(g.client.id, g.proc ? `#${g.proc.id}` : '#tasks');
  const owners = g.task ? [g.task.owner] : [...new Set(g.entries.flatMap((e) => e.item.owners))];
  const bulk = bulkFor(g);
  const waitId = `wl-${g.key}`.replace(/[^\w-]/g, '_');
  const canWait = !g.task && !g.proc.recurring;
  return h('li', { class: `wproc s-${g.status}`, 'data-key': g.key },
    h('div', { class: 'wproc-h', 'aria-describedby': g.wait ? waitId : null },
      h('a', { class: 'wclient', href }, g.client.name),
      isAuto(g.client) ? h('span', { class: 'auto-tag' }, 'חדש') : null,
      h('span', { class: 'wtitle' }, title),
      person ? null : peopleChips(owners),
      g.dueAt ? h('span', { class: 'num' }, `יעד: ${formatWhen(g.dueAt)}`) : null,
      statusBadge(g.status, g.dueAt),
      claimControl(g, person)),
    g.status === 'client' ? waitLine(g.wait, waitId) : null,
    bulk || canWait ? h('div', { class: 'wproc-acts' },
      bulk ? h('button', {
        type: 'button', class: 'btn btn-sm btn-ghost bulk-btn',
        'aria-label': `סימון ${bulk.items.length} פריטים כבוצעו בתהליך ${procLabel(g.proc)}`,
        onclick: (ev) => bulkMark(g, bulk, ev.currentTarget),
      }, bulk.whole ? `סימון כל התהליך כבוצע (${bulk.items.length})` : `סימון כל הפריטים שלי כבוצעו (${bulk.items.length})`) : null,
      canWait && g.status !== 'client' ? h('button', { type: 'button', class: 'btn-text', onclick: () => openWait(g) }, 'ממתין ללקוח') : null,
      canWait && g.status === 'client' ? h('button', { type: 'button', class: 'btn-text', onclick: () => endWait(g) }, 'סיום המתנה') : null) : null,
    h('ul', { class: 'wlist' }, ...g.entries.map((e) => {
      const id = `w-${e.client.id}-${e.task ? e.task.id : e.item.key}`.replace(/[^\w-]/g, '_');
      return h('li', { class: 'witem' },
        h('label', { class: 'wrow', for: id },
          h('input', { type: 'checkbox', id, class: 'cbx', onchange: (ev) => toggleEntry(e, ev.currentTarget) }),
          h('span', { class: 'wlabel' }, e.task ? e.task.title : e.item.label)));
    })));
}

const BUCKETS = [['overdue', 'באיחור'], ['today', 'היום'], ['tomorrow', 'מחר'], ['week', 'השבוע'], ['later', 'בהמשך'], ['client', 'ממתין ללקוח']];

// Clients the signing trigger opened, shown to Irit and to the whole-team view (spec §10).
function autoBanner() {
  const list = clients.filter(isAuto).sort((a, b) => new Date(b.deal_at) - new Date(a.deal_at));
  if (!list.length) return null;
  const now = new Date();
  return h('div', { class: 'auto-banner', role: 'status' },
    ...list.slice(0, 3).map((c) => {
      const q = quoteInfo.get(c.quote_id);
      const at = q?.signed_at || c.created_at;
      return h('p', {},
        `לקוח חדש נפתח אוטומטית: ${c.name}`,
        q ? [' · הסכם ', h('bdi', { class: 'num', dir: 'ltr' }, q.number)] : null,
        `${at ? ` · לפני ${lateBy(new Date(at), now)}` : ''} `,
        h('a', { href: clientUrl(c.id) }, 'לכרטיס'));
    }),
    list.length > 3 ? h('p', { class: 'muted' }, `ועוד ${list.length - 3}`) : null);
}

function renderMine() {
  const wrap = $('mine-list');
  if (!me && minePerson === null) {
    fill($('mine-people'));
    fill($('mine-tools'));
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
  fill($('mine-tools'),
    person ? summaryActions(person, 'mine') : null,
    person && person === me ? notifyRow() : null);

  if (!clients.length) {
    fill(wrap, h('p', { class: 'empty' }, 'עדיין אין לקוחות. לקוח חדש נפתח בכפתור ״לקוח חדש״.'));
    return;
  }
  const list = workFor(person);
  const review = person ? OFFICE_REVIEWS.find((r) => r.owner === person && reviewPending(r)) : null;
  const banner = !person || person === 'irit' ? autoBanner() : null;
  if (!list.length && !review) {
    fill(wrap, banner, h('p', { class: 'empty' }, person ? `אין כרגע משהו פתוח אצל ${PEOPLE[person].name}.` : 'אין כרגע פריטים פתוחים.'));
    return;
  }
  const today = dayIso(new Date());
  fill(wrap, banner, ...BUCKETS.map(([k, title]) => {
    let g = list.filter((x) => bucketOf(x.status, x.dueAt) === k);
    const extra = k === 'today' && review ? reviewCard(review) : null;
    if (!g.length && !extra) return null;
    if (k === 'client') {
      // What reached its recheck day first, then the longest wait.
      g = g.sort((a, b) => (recheckDue(b.wait, today) - recheckDue(a.wait, today)) || (new Date(a.wait?.at || 0) - new Date(b.wait?.at || 0)));
      if (waitGroupOpen === null) waitGroupOpen = !window.matchMedia('(max-width: 760px)').matches;
      return h('details', {
        class: 'wgroup g-client', open: waitGroupOpen,
        ontoggle: (ev) => { waitGroupOpen = ev.currentTarget.open; },
      },
      h('summary', { class: 'wgroup-h' }, title, h('span', { class: 'n' }, String(g.length))),
      h('ul', { class: 'wprocs' }, ...g.map((x) => groupCard(x, person))));
    }
    return h('section', { class: `wgroup g-${k}`, 'aria-label': title },
      h('h2', { class: 'wgroup-h' }, title, h('span', { class: 'n' }, String(g.length + (extra ? 1 : 0)))),
      h('ul', { class: 'wprocs' }, extra, ...g.map((x) => groupCard(x, person))));
  }));
}

// ── Morning summary via WhatsApp (spec §6a) ──
const listUrl = () => new URL('clients.html#mine', location.href).href;
const PER_SECTION = 8;

function personSummary(person, now = new Date()) {
  const name = PEOPLE[person].name;
  const w = workFor(person);
  const procs = w.filter((g) => !g.task);
  const today = dayIso(now);
  const until = (d) => (d.getHours() === 23 && d.getMinutes() === 59 ? 'עד סוף היום' : `עד ${hm(d)}`);
  const line = (g) => `${g.client.name} · ${procLabel(g.proc, ' ')}`;
  const sections = [
    ['באיחור', procs.filter((g) => g.status === 'overdue'), (g) => `${line(g)} · באיחור ${lateBy(g.dueAt, now)}`],
    ['היום', procs.filter((g) => bucketOf(g.status, g.dueAt, now) === 'today'), (g) => (g.dueAt ? `${line(g)} · ${until(g.dueAt)}` : line(g))],
    ['מחר', procs.filter((g) => bucketOf(g.status, g.dueAt, now) === 'tomorrow'), line],
    ['ממתין ללקוח, לבדוק היום', procs.filter((g) => g.status === 'client' && recheckDue(g.wait, today)), (g) => `${line(g)}${g.wait?.reason ? ` · ${g.wait.reason}` : ''}`],
    ['משימות', w.filter((g) => g.task).sort((a, b) => (a.dueAt?.getTime() ?? Infinity) - (b.dueAt?.getTime() ?? Infinity)),
      (g) => `${g.client.name} · ${g.task.title}${g.dueAt ? ` · עד ${dm(g.dueAt)}` : ''}`],
  ].filter(([, list]) => list.length);
  const head = `בוקר טוב ${name},`;
  if (!sections.length) {
    return [head, 'אין לך היום תהליכים באיחור, להיום או למחר. יום טוב.', `הרשימה המלאה: ${listUrl()}`].join('\n');
  }
  let cut = 0;
  const body = sections.flatMap(([title, list, fmt]) => {
    cut += Math.max(0, list.length - PER_SECTION);
    return [`${title} (${list.length}):`, ...list.slice(0, PER_SECTION).map((g) => `- ${fmt(g)}`)];
  });
  return [head, `הסיכום שלך ל${weekdayLong.format(now)} ${dm(now)}:`, '', ...body, '',
    ...(cut ? [`ועוד ${cut} ברשימה המלאה.`] : []), `הרשימה המלאה: ${listUrl()}`].join('\n');
}

function lateProcsOf(c) {
  return stateOf(c).states.filter((x) => x.status === 'overdue' && (c.status !== 'ended' || x.proc.id === 'p35'));
}
function waitingProcsOf(c) {
  return stateOf(c).states.filter((x) => x.status === 'client' && (c.status !== 'ended' || x.proc.id === 'p35'));
}

function teamSummary(now = new Date()) {
  const lines = [`סיכום בוקר, ${weekdayLong.format(now)} ${dm(now)}:`];
  for (const p of Object.values(PEOPLE)) {
    const w = workFor(p.key);
    lines.push(`${p.name}: באיחור ${w.filter((g) => g.status === 'overdue').length} · להיום ${w.filter((g) => bucketOf(g.status, g.dueAt, now) === 'today').length}`);
  }
  const late = clients.filter(live).flatMap((c) => lateProcsOf(c).map((x) => ({ c, x })));
  if (late.length) {
    lines.push('באיחור אצלנו:', ...late.slice(0, PER_SECTION).map(({ c, x }) => `- ${c.name} · ${procLabel(x.proc, ' ')} · ${namesOf(peopleOf(x))}`));
    if (late.length > PER_SECTION) lines.push(`ועוד ${late.length - PER_SECTION} ברשימה המלאה.`);
  }
  const waiting = clients.filter((c) => live(c) && waitingProcsOf(c).length).length;
  if (waiting) lines.push(`ממתינים ללקוח: ${waiting} לקוחות`);
  return lines.join('\n');
}

const openedKey = (person) => `summary.${person}.${dayIso(new Date())}`;
function summaryActions(person, where) {
  const text = () => (person === 'team' ? teamSummary() : personSummary(person));
  const label = person === 'team' ? 'סיכום לכל הצוות ב־WhatsApp' : where === 'mine' ? 'שליחת סיכום בוקר ב־WhatsApp' : 'סיכום בוקר ב־WhatsApp';
  const link = h('a', {
    class: where === 'row' ? 'btn-text wa-link' : 'btn btn-sm wa-link', href: whatsappLink('', text()), target: '_blank', rel: 'noopener',
    'aria-label': person === 'team' || where === 'mine' ? null : `סיכום בוקר ב־WhatsApp ל${PEOPLE[person].name}`,
    onclick: (ev) => {
      ev.currentTarget.href = whatsappLink('', text()); // fresh at the moment of the click
      store.set(openedKey(person), new Date().toISOString());
      toast('WhatsApp נפתח עם הסיכום. השליחה עצמה נעשית שם.');
      if (view === 'control') setTimeout(() => { if (!busy()) renderKeepingFocus(); }, 0);
    },
  }, label);
  if (where === 'row') return link;
  return h('div', { class: 'summary-acts' }, link,
    h('button', {
      type: 'button', class: 'btn-text',
      onclick: async () => {
        try { await navigator.clipboard.writeText(text()); toast('הסיכום הועתק.'); } catch (err) { toast(`הטקסט לא הועתק. ${errorText(err)}`); }
      },
    }, 'העתקת הטקסט'));
}

// ── Browser notifications (spec §6b) ─────────
const canNotify = () => typeof window.Notification === 'function';
function notifyState() {
  if (!canNotify()) return 'none';
  if (Notification.permission === 'denied') return 'blocked';
  if (Notification.permission === 'granted' && store.get('notify') === 'on') return 'on';
  return 'off';
}
function notifyRow() {
  const st = notifyState();
  if (st === 'none') return null;
  if (st === 'blocked') return h('p', { class: 'notify-row muted' }, 'ההתראות חסומות בדפדפן. אפשר לאפשר אותן בהגדרות האתר.');
  if (st === 'on') {
    return h('p', { class: 'notify-row' }, 'התראות איחור פעילות בדפדפן הזה. ',
      h('button', { type: 'button', class: 'btn-text', onclick: () => { store.set('notify', 'off'); renderMine(); } }, 'כיבוי'));
  }
  return h('div', { class: 'notify-row' },
    h('button', {
      type: 'button', class: 'btn-text', id: 'btn-notify',
      onclick: async () => {
        // Permission is asked only here, on a click, never on load.
        const p = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
        if (p === 'granted') store.set('notify', 'on');
        renderMine();
      },
    }, 'התראה כשמשהו שלי נכנס לאיחור'),
    h('span', { class: 'hint' }, 'עובד רק כשהעמוד פתוח בדפדפן, גם בלשונית ברקע.'));
}

function alertOnce(key, title, body, href) {
  const k = `notified.${key}.${dayIso(new Date())}`;
  if (store.get(k)) return;
  store.set(k, '1');
  if (document.hidden) {
    try {
      const n = new Notification(title, { body, tag: key });
      n.onclick = () => { window.focus(); location.href = href; n.close(); };
    } catch { /* the browser refused */ }
  } else {
    toast(`${title} · ${body}`, { label: 'מעבר', run: () => { location.href = href; } });
  }
}

// Processes of `me` that turned overdue since the previous check. The first
// check only records the state: on load every overdue process is "new".
let lastLate = null;
function checkLate() {
  if (!me || !PEOPLE[me] || !clients.length) return;
  const late = workFor(me).filter((g) => !g.task && g.status === 'overdue');
  const prev = lastLate;
  lastLate = new Set(late.map((g) => g.key));
  if (!prev || notifyState() !== 'on') return;
  for (const g of late) {
    if (prev.has(g.key)) continue;
    alertOnce(`${g.client.id}:${g.proc.id}`, `באיחור: ${g.client.name}`,
      `תהליך ${procLabel(g.proc)}. היעד היה ${formatWhen(g.dueAt)}.`, clientUrl(g.client.id, `#${g.proc.id}`));
  }
}

// A client the signing trigger opened while this page was open (spec §10).
let knownAuto = null;
function watchNewClients() {
  const ids = new Set(clients.filter(isAuto).map((c) => c.id));
  const prev = knownAuto;
  knownAuto = ids;
  if (!prev || me !== 'irit' || notifyState() !== 'on') return;
  for (const c of clients.filter((x) => ids.has(x.id) && !prev.has(x.id))) {
    alertOnce(`new:${c.id}`, `לקוח חדש נחתם: ${c.name}`, 'תהליכים 2 ו־3: עד 5 דקות.', clientUrl(c.id));
  }
}

// ── Clients ─────────────────────────────────
// The next step skips processes that wait on the client.
function nextStep(c, s) {
  const open = openItemsFor(null, c, checks[c.id] || {}, s).sort(byUrgency);
  const ours = open.find((e) => e.status !== 'client');
  if (ours) return { proc: ours.proc, owners: ours.claim ? [ours.claim.person] : ours.item.owners };
  return open[0] ? { proc: open[0].proc, waiting: true } : null;
}

function autoTag(c) {
  const q = quoteInfo.get(c.quote_id);
  return h('span', { class: 'auto-tag' }, 'חדש · נפתח אוטומטית מהסכם', q ? [' ', h('bdi', { class: 'num', dir: 'ltr' }, q.number)] : null);
}

function renderClients() {
  const FILTERS = [['active', 'פעילים'], ['late', 'עם איחור'], ['client', 'ממתין ללקוח'], ['ending', 'מסיימים'], ['ended', 'הסתיימו'], ['cancelled', 'בוטלו']];
  fill($('client-filters'), ...FILTERS.map(([k, label]) => h('button', {
    type: 'button', class: 'chip', 'aria-pressed': String(clientFilter === k),
    onclick: () => { clientFilter = k; renderClients(); },
  }, label)));

  const q = $('client-search').value.trim();
  const open = (c) => c.status === 'active' || c.status === 'ending';
  const list = clients.filter((c) => {
    if (q && !`${c.name} ${c.business || ''} ${c.phone || ''}`.includes(q)) return false;
    if (clientFilter === 'active') return c.status === 'active';
    if (clientFilter === 'late') return open(c) && stateOf(c).overdue > 0;
    if (clientFilter === 'client') return open(c) && stateOf(c).waitingOnClient > 0;
    return c.status === clientFilter;
  }).sort((a, b) => (isAuto(b) - isAuto(a)) || (stateOf(b).overdue - stateOf(a).overdue) || (new Date(b.deal_at) - new Date(a.deal_at)));

  if (!list.length) {
    fill($('client-list'), h('p', { class: 'empty' }, clients.length ? 'אין לקוחות בסינון הזה.' : 'עדיין אין לקוחות. לקוח חדש נפתח בכפתור ״לקוח חדש״.'));
    return;
  }
  const now = new Date();
  fill($('client-list'), h('ul', { class: 'clist' }, ...list.map((c) => {
    const s = stateOf(c);
    const phase = PHASES.find((p) => p.key === s.current);
    const next = live(c) ? nextStep(c, s) : null;
    const signed = quoteInfo.get(c.quote_id)?.signed_at;
    return h('li', {},
      h('a', { class: 'crow', href: clientUrl(c.id) },
        h('div', { class: 'cname' },
          h('strong', {}, c.name),
          isAuto(c) ? autoTag(c) : null,
          isAuto(c) && signed ? h('small', { class: 'auto-when' }, `נחתם ${formatWhen(new Date(signed), now)}`) : null,
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
          !next ? h('span', { class: 'muted' }, 'אין פריטים פתוחים')
            : next.waiting ? h('span', {}, `ממתין ללקוח (${procLabel(next.proc)})`)
              : h('span', {}, `${procLabel(next.proc)} `, peopleChips(next.owners))),
        h('div', { class: 'cflags' },
          live(c) && s.overdue ? h('span', { class: 'flag' }, statusBadge('overdue', null), h('span', { class: 'num' }, ` · ${s.overdue} תהליכים`)) : null,
          live(c) && s.waitingOnClient ? h('span', { class: 'flag' }, statusBadge('client', null), h('span', { class: 'num' }, ` · ${s.waitingOnClient}`)) : null,
          c.shoot_at && live(c) ? h('span', { class: 'muted' }, `צילום: ${formatWhen(new Date(c.shoot_at))}`) : null)));
  })));
}
$('client-search').addEventListener('input', renderClients);

// ── Daily reviews (spec §7) ──────────────────
function lastBusinessDays(n, now = new Date()) {
  const out = [];
  const d = new Date(now);
  d.setHours(12, 0, 0, 0);
  for (let guard = 0; out.length < n && guard < 60; guard += 1) {
    if (isBusinessDay(d)) out.push(new Date(d));
    d.setDate(d.getDate() - 1);
  }
  return out;
}
const reviewKind = (r) => `p${r.num}`;
const reviewOn = (day, kind) => reviews?.find((x) => x.day === day && x.kind === kind) || null;
// The note is JSON { general, clients: { clientId: text } }; plain text is read as general.
function parseReviewNote(note) {
  if (!note) return { general: '', clients: {} };
  try {
    const v = JSON.parse(note);
    if (v && typeof v === 'object') return { general: v.general || '', clients: v.clients || {} };
  } catch { /* plain text */ }
  return { general: note, clients: {} };
}
function reviewPending(r) {
  const now = new Date();
  return reviews !== null && isBusinessDay(now) && !reviewOn(dayIso(now), reviewKind(r));
}

async function doMarkReview(r, input) {
  if (input) input.disabled = true;
  const day = dayIso(new Date());
  try {
    const row = await markReview(day, reviewKind(r), null);
    reviews = [row, ...(reviews || []).filter((x) => !(x.day === row.day && x.kind === row.kind))];
  } catch (err) {
    if (input) { input.checked = false; input.disabled = false; }
    toast(`הסימון לא נשמר. ${errorText(err)}`);
    return;
  }
  renderKeepingFocus();
  // No undo: review records cannot be deleted (the table has no delete grant).
  toast('הבקרה של היום סומנה.');
}

function reviewMarkControl(r, idPrefix) {
  const owner = PEOPLE[r.owner];
  if (me === r.owner) {
    const id = `${idPrefix}-${reviewKind(r)}`;
    return h('label', { class: 'wrow rv-check', for: id },
      h('input', {
        type: 'checkbox', id, class: 'cbx', 'aria-label': `הבקרה היומית בוצעה: תהליך ${r.num}, ${r.title}`,
        onchange: (ev) => doMarkReview(r, ev.currentTarget),
      }),
      h('span', { class: 'wlabel' }, 'הבקרה היומית בוצעה'));
  }
  return h('button', { type: 'button', class: 'btn btn-sm', onclick: (ev) => doMarkReview(r, ev.currentTarget) }, `סימון בשם ${owner.name}`);
}

// The fixed card in Irit's / Ofir's "today" group, until the review is marked.
function reviewCard(r) {
  return h('li', { class: 'wproc rv-card' },
    h('div', { class: 'wproc-h' },
      h('span', { class: 'wtitle' }, `בקרה יומית · תהליך ${r.num} · ${r.title}`),
      h('a', { class: 'btn-text', href: '#control' }, 'מעבר לבקרה')),
    reviewMarkControl(r, 'rvm'));
}

function reviewDone(rec, r) {
  // Marked by someone else on the owner's behalf: the record keeps who actually marked it.
  const by = directory[String(rec.by_email || '').toLowerCase()];
  const onBehalf = by && by !== r.owner ? ` (בשם ${PEOPLE[r.owner].name})` : '';
  return `בוצעה · ${who(rec.by_email)} · ${hm(rec.at)}${onBehalf}`;
}

function reviewWeek(r, now) {
  const today = dayIso(now);
  const days = lastBusinessDays(7, now).reverse();
  const items = days.map((d) => {
    const iso = dayIso(d);
    const rec = reviewOn(iso, reviewKind(r));
    const label = iso === today ? 'היום' : `${WEEKDAY[d.getDay()]} ${dm(d)}`;
    const cls = rec ? 'is-done' : iso === today ? 'is-pending' : 'is-miss';
    const text = rec ? `בוצעה ${hm(rec.at)} · ${who(rec.by_email)}` : iso === today ? 'טרם בוצעה' : 'לא בוצעה';
    return { cls, label, text };
  });
  const done = items.filter((x) => x.cls === 'is-done').length;
  const list = (cls) => h('ol', { class: cls }, ...items.map((x) => h('li', { class: `rv-day ${x.cls}` },
    h('span', { class: 'rv-icon', 'aria-hidden': 'true' }), h('span', { class: 'rv-d' }, x.label), h('span', { class: 'rv-s' }, x.text))));
  const summary = `בוצעה ב־${done} מתוך 7 ימי העבודה האחרונים`;
  return h('div', { class: 'rv-hist' },
    h('p', { class: 'rv-sum rv-wide' }, summary),
    list('rv-week rv-wide'),
    h('details', { class: 'rv-narrow' }, h('summary', {}, summary), list('rv-week')));
}

function reviewRow(r, now) {
  const kind = reviewKind(r);
  const rec = reviewOn(dayIso(now), kind);
  const notes = parseReviewNote(rec?.note);
  return h('div', { class: 'rv-row' },
    h('div', { class: 'rv-main' },
      !isBusinessDay(now) ? h('p', { class: 'muted rv-off' }, 'היום אינו יום עבודה.')
        : rec ? h('div', { class: 'rv-state' },
          h('label', { class: 'wrow rv-check' },
            h('input', { type: 'checkbox', class: 'cbx', checked: true, disabled: true, 'aria-label': `הבקרה היומית בוצעה: תהליך ${r.num}, ${r.title}` }),
            h('span', { class: 'wlabel' }, 'הבקרה היומית בוצעה')),
          h('span', { class: 'rv-by' }, reviewDone(rec, r)),
          h('button', { type: 'button', class: 'btn-text', onclick: () => openNotes(r) }, notes.general || Object.keys(notes.clients).length ? 'עריכת הערות' : 'הוספת הערות'))
          : reviewMarkControl(r, 'rv'),
      h('p', { class: 'rv-meta' }, `תהליך ${r.num} · ${r.title} · `, personChip(r.owner), ` · ${r.sla}`)),
    notes.general ? h('p', { class: 'rv-general' }, `הערות: ״${notes.general}״`) : null,
    h('details', { class: 'rv-topics' }, h('summary', {}, 'על מה עוברים'),
      h('ul', {}, ...(REVIEW_TOPICS[kind] || []).map((t) => h('li', {}, t)))),
    reviewWeek(r, now));
}

function reviewPanel(now) {
  return h('section', { class: 'rv-panel', 'aria-labelledby': 'rv-h' },
    h('h2', { class: 'wgroup-h', id: 'rv-h' }, 'הבקרה של היום'),
    reviews === null
      ? h('p', { class: 'muted' }, `הבקרות לא נטענו. ${reviewsError ? errorText(reviewsError) : ''}`)
      : OFFICE_REVIEWS.map((r) => reviewRow(r, now)));
}

// Notes written today next to a client in the control lists.
function clientNotes(c, now) {
  const today = dayIso(now);
  return OFFICE_REVIEWS.map((r) => {
    const rec = reviewOn(today, reviewKind(r));
    const text = rec && parseReviewNote(rec.note).clients[c.id];
    if (!text) return null;
    return h('p', { class: 'rv-cnote' }, `${who(rec.by_email)}, ${new Date(rec.at).getHours() < 12 ? 'הבוקר' : 'היום'}: ״${text}״`);
  });
}

// Notes dialog for today's review.
const notesDlg = $('dlg-notes');
let notesFor = null;
notesDlg.addEventListener('click', (e) => { if (e.target.closest('[data-close]') || e.target === notesDlg) notesDlg.close(); });
function controlLists(now) {
  const late = clients.filter(live).map((c) => ({
    c,
    lateProcs: lateProcsOf(c),
    lateTasks: tasks.filter((t) => t.client_id === c.id && t.due_on && t.due_on < dayIso(now)),
  })).filter((x) => x.lateProcs.length || x.lateTasks.length);
  const today = dayIso(now);
  const waiting = clients.filter(live).flatMap((c) => waitingProcsOf(c).map((x) => ({ c, x })))
    .sort((a, b) => (recheckDue(b.x.wait, today) - recheckDue(a.x.wait, today)) || (new Date(a.x.wait?.at || 0) - new Date(b.x.wait?.at || 0)));
  return { late, waiting };
}
function openNotes(r) {
  notesFor = r;
  const now = new Date();
  const rec = reviewOn(dayIso(now), reviewKind(r));
  const notes = parseReviewNote(rec?.note);
  const { late, waiting } = controlLists(now);
  const seen = new Set();
  const list = [...late.map((x) => x.c), ...waiting.map((x) => x.c)].filter((c) => !seen.has(c.id) && seen.add(c.id));
  $('notes-h').textContent = `הערות לבקרה של היום · תהליך ${r.num}`;
  $('notes-err').hidden = true;
  fill($('notes-fields'), list.length ? list.map((c, i) => h('div', { class: 'field note-field' },
    h('label', { for: `note-c-${i}` }, `${c.name}: למה תקוע ומה הצעד הבא`),
    h('input', { class: 'input', id: `note-c-${i}`, 'data-client': c.id, value: notes.clients[c.id] || '', autocomplete: 'off', maxlength: 300 }),
    h('a', { class: 'btn-text', href: clientUrl(c.id, '#tasks'), target: '_blank', rel: 'noopener' }, 'פתיחת משימה בכרטיס')))
    : h('p', { class: 'muted' }, 'אין היום לקוחות באיחור או ממתינים ללקוח.'));
  $('notes-general').value = notes.general;
  notesDlg.showModal();
  (notesDlg.querySelector('.note-field input') || $('notes-general')).focus();
}
$('notes-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const r = notesFor;
  const clientsNotes = {};
  for (const el of notesDlg.querySelectorAll('[data-client]')) if (el.value.trim()) clientsNotes[el.dataset.client] = el.value.trim();
  const general = $('notes-general').value.trim();
  const note = general || Object.keys(clientsNotes).length ? JSON.stringify({ general, clients: clientsNotes }) : null;
  if (note && note.length > 2000) {
    $('notes-err').textContent = 'ההערות ארוכות מדי לשמירה. קצרו אותן, או פתחו משימה בכרטיס הלקוח.';
    $('notes-err').hidden = false;
    return;
  }
  $('notes-submit').disabled = true;
  try {
    const row = await markReview(dayIso(new Date()), reviewKind(r), note);
    reviews = [row, ...(reviews || []).filter((x) => !(x.day === row.day && x.kind === row.kind))];
    notesDlg.close();
    renderKeepingFocus();
    toast('ההערות נשמרו.');
  } catch (err) {
    $('notes-err').textContent = `ההערות לא נשמרו. ${errorText(err)}`;
    $('notes-err').hidden = false;
  } finally {
    $('notes-submit').disabled = false;
  }
});

// ── Daily control (processes 32, 33) ─────────
function contactLinks(c) {
  if (!c.phone) return h('span', { class: 'muted' }, 'אין טלפון בכרטיס');
  return h('span', { class: 'contact' },
    h('a', { class: 'btn-text', href: `tel:${String(c.phone).replace(/[^\d+]/g, '')}` }, 'התקשרות'),
    h('a', { class: 'btn-text', href: whatsappLink(c.phone, ''), target: '_blank', rel: 'noopener' }, 'WhatsApp'));
}

function renderControl() {
  const now = new Date();
  const rows = Object.values(PEOPLE).map((p) => {
    const w = workFor(p.key);
    const late = w.filter((g) => g.status === 'overdue');
    const opened = store.get(openedKey(p.key));
    return {
      p, late: late.length, today: w.filter((g) => bucketOf(g.status, g.dueAt) === 'today').length, open: w.length,
      waiting: w.filter((g) => g.status === 'client').length, opened,
      clients: [...new Set(late.map((g) => g.client.name))],
    };
  });
  const { late: stuck, waiting } = controlLists(now);
  const byClient = new Map();
  for (const w of waiting) (byClient.get(w.c.id) || byClient.set(w.c.id, { c: w.c, list: [] }).get(w.c.id)).list.push(w.x);
  const teamOpened = store.get(openedKey('team'));

  fill($('control'),
    reviewPanel(now),
    h('div', { class: 'team-summary' }, summaryActions('team', 'control'),
      teamOpened ? h('span', { class: 'muted small' }, `נפתח היום ${hm(teamOpened)}`) : null),
    h('h2', { class: 'wgroup-h' }, 'לפי עובד', h('span', { class: 'muted small' }, 'נספר בתהליכים')),
    h('div', { class: 'table-wrap' }, h('table', { class: 'qtable ctable' },
      h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'עובד'), h('th', { scope: 'col' }, 'באיחור'), h('th', { scope: 'col' }, 'להיום'), h('th', { scope: 'col' }, 'פתוחים'), h('th', { scope: 'col' }, 'ממתין ללקוח'), h('th', { scope: 'col' }, 'לקוחות עם איחור'), h('th', { scope: 'col' }, h('span', { class: 'sr-only' }, 'פעולות')))),
      h('tbody', {}, ...rows.map((r) => h('tr', {},
        h('td', { 'data-label': 'עובד' }, personChip(r.p.key), h('small', { class: 'by' }, r.p.role)),
        h('td', { 'data-label': 'באיחור', class: r.late ? 'late num' : 'num' }, String(r.late)),
        h('td', { 'data-label': 'להיום', class: 'num' }, String(r.today)),
        h('td', { 'data-label': 'פתוחים', class: 'num' }, String(r.open)),
        h('td', { 'data-label': 'ממתין ללקוח', class: 'num' }, String(r.waiting)),
        h('td', { 'data-label': 'לקוחות עם איחור', class: 'client' }, r.clients.join(', ') || '—'),
        h('td', { class: 'acts-cell' }, h('div', { class: 'row-acts' },
          h('button', {
            type: 'button', class: 'btn-text', onclick: () => { minePerson = r.p.key; setView('mine'); },
          }, `הרשימה של ${r.p.name}`),
          summaryActions(r.p.key, 'row'),
          r.opened ? h('span', { class: 'muted small' }, `נפתח היום ${hm(r.opened)}`) : null))))))),
    h('h2', { class: 'wgroup-h' }, 'באיחור אצלנו', h('span', { class: 'n' }, String(stuck.length))),
    stuck.length
      ? h('ul', { class: 'stuck' }, ...stuck.map(({ c, lateProcs, lateTasks }) => h('li', {},
        h('a', { href: clientUrl(c.id), class: 'wclient' }, c.name),
        clientNotes(c, now),
        h('ul', {},
          ...lateProcs.map((x) => h('li', {},
            h('a', { href: clientUrl(c.id, `#${x.proc.id}`) }, procLabel(x.proc)), ' ',
            peopleChips(peopleOf(x)),
            x.proc.owners.length > 1 && !x.claim ? h('span', { class: 'tag' }, 'לא נלקח') : null,
            h('span', { class: 'muted num' }, ` · יעד ${formatWhen(x.dueAt)}`))),
          ...lateTasks.map((t) => h('li', {},
            h('a', { href: clientUrl(c.id, '#tasks') }, `משימה: ${t.title}`), ' ', personChip(t.owner),
            h('span', { class: 'muted num' }, ` · עד ${formatDay(t.due_on)}`)))))))
      : h('p', { class: 'empty' }, 'אין לקוחות עם תהליכים או משימות באיחור.'),
    h('h2', { class: 'wgroup-h' }, 'ממתין ללקוח · צריך ליצור קשר', h('span', { class: 'n' }, String(byClient.size))),
    byClient.size
      ? h('ul', { class: 'stuck waiting-list' }, ...[...byClient.values()].map(({ c, list }) => h('li', {},
        h('div', { class: 'wait-head' }, h('a', { href: clientUrl(c.id), class: 'wclient' }, c.name), contactLinks(c)),
        clientNotes(c, now),
        h('ul', {}, ...list.map((x) => h('li', {},
          h('a', { href: clientUrl(c.id, `#${x.proc.id}`) }, procLabel(x.proc)),
          h('span', { class: 'muted' }, ` · מאז ${formatStamp(x.wait.at)}`),
          x.wait.reason ? h('span', {}, ` · ״${x.wait.reason}״`) : null,
          x.wait.recheck ? h('span', { class: 'muted' }, ` · לבדוק שוב: ${dayShort(x.wait.recheck)}`) : null,
          recheckDue(x.wait) ? h('span', { class: 'tag tag-warn' }, 'הגיע מועד הבדיקה') : null,
          businessDaysBetween(new Date(x.wait.at), now) > 2 ? h('span', { class: 'tag' }, 'ממתין יותר מיומיים') : null))))))
      : h('p', { class: 'empty' }, 'אין לקוחות שממתינים להם.'),
  );
}

// ── Performance (spec §8) ────────────────────
let perfDays = 30;
const perfLog = new Map(); // days -> { rows } | { error }
const TEAM_VIEWERS = new Set(OFFICE_REVIEWS.map((r) => r.owner));
const baseId = (proc) => proc.id.replace(/^r\d+-/, '');

// Processes closed in the window, with their due date and how long they took.
// A process closed entirely as "not relevant" is not counted.
function closings(days, now) {
  const since = new Date(now.getTime() - days * 864e5);
  const out = [];
  for (const c of clients) {
    const s = stateOf(c);
    const cs = checks[c.id] || {};
    const procs = s.states.map((x) => x.proc);
    for (const x of s.states) {
      if (!x.complete || !x.completedAt || x.completedAt < since || !x.dueAt) continue;
      const req = x.proc.items.filter((i) => !i.optional);
      if (req.length && req.every((i) => cs[i.key]?.state === 'na')) continue;
      // Without its own start, a process starts at the anchor of its due date.
      const start = x.startAt || resolveTime({ from: x.proc.due?.from }, x.proc.ctx || c, procs, cs, now);
      out.push({
        key: baseId(x.proc), client: c, proc: x.proc, dueAt: x.dueAt, completedAt: x.completedAt, start,
        onTime: x.completedAt <= x.dueAt,
        ms: start && x.completedAt > start ? x.completedAt - start : null,
        targetMs: start && x.dueAt > start ? x.dueAt - start : null,
        people: peopleOf(x),
      });
    }
  }
  return out;
}
const medianRow = (rows, f) => {
  const r = rows.filter((x) => x[f] !== null).sort((a, b) => a[f] - b[f]);
  return r.length ? r[Math.floor((r.length - 1) / 2)] : null;
};
const FEW = 5;
function onTimeCell(done, onTime) {
  if (done < FEW) return h('span', { class: 'muted' }, `מעט מדי נתונים (${done})`);
  return h('span', { class: 'rate' }, `${onTime} מתוך ${done} (${Math.round((onTime / done) * 100)}%) `,
    h('span', { class: 'pbar', role: 'img', 'aria-label': `בזמן: ${onTime} מתוך ${done}` },
      h('span', { class: 'pbar-fill', style: `inline-size:${Math.round((onTime / done) * 100)}%` })));
}

// Weekly calls (31): logged calls out of the client-weeks the call was due.
function weeklyCalls(log, days, now) {
  const since = new Date(now.getTime() - days * 864e5);
  let due = 0; let done = 0;
  for (const c of clients.filter(live)) {
    const s = stateOf(c).states.find((x) => x.proc.id === 'p31');
    if (!s?.startAt) continue;
    const from = new Date(Math.max(since, s.startAt));
    const weeks = Math.floor((now - from) / (7 * 864e5));
    if (weeks <= 0) continue;
    due += weeks;
    const hit = new Set(log.filter((l) => l.client_id === c.id && l.item_key === 'p31.call' && l.action === 'done' && new Date(l.at) >= from)
      .map((l) => Math.floor((new Date(l.at) - from) / (7 * 864e5))).filter((i) => i < weeks));
    done += hit.size;
  }
  return { due, done };
}

async function renderPerformance() {
  const box = $('performance');
  const now = new Date();
  const chips = h('div', { class: 'chips-row', role: 'group', 'aria-label': 'תקופה' }, ...[30, 90].map((d) => h('button', {
    type: 'button', class: 'chip', 'aria-pressed': String(perfDays === d), onclick: () => { perfDays = d; renderPerformance(); },
  }, `${d} הימים האחרונים`)));
  const intro = h('p', { class: 'perf-intro' }, 'נמדד מהיעד המחושב עד שהתהליך נסגר. ימי עבודה א׳–ה׳, בלי חגים ובתוך שעות העבודה. תהליך שכולו ״לא רלוונטי״ לא נספר. זמן שבו התהליך המתין ללקוח נספר.');
  const days = perfDays;
  if (!perfLog.has(days)) {
    fill(box, chips, intro, h('p', { class: 'state' }, 'מחשב…'));
    try {
      perfLog.set(days, { rows: await loadAllLog(new Date(now.getTime() - days * 864e5).toISOString()) });
    } catch (err) {
      if (view !== 'performance' || days !== perfDays) return;
      fill(box, chips, intro, h('div', { class: 'state' }, `הנתונים לא נטענו. ${errorText(err)} `,
        h('button', { type: 'button', class: 'btn btn-sm', onclick: () => renderPerformance() }, 'ניסיון נוסף')));
      return;
    }
    if (view !== 'performance' || days !== perfDays) return;
  }
  const rows = closings(days, now);
  const calls = weeklyCalls(perfLog.get(days).rows, days, now);
  if (!rows.length) {
    fill(box, chips, intro, h('p', { class: 'empty' }, 'עוד אין מספיק תהליכים שנסגרו בתקופה הזו. הנתונים יופיעו אחרי שייסגרו תהליכים עם יעד מחושב.'),
      calls.due ? h('p', { class: 'perf-calls' }, `שיחה שבועית (31): שיחות שתועדו: ${calls.done} מתוך ${calls.due} שבועות־לקוח`) : null);
    return;
  }
  const byProc = PROCESSES.filter((p) => !p.recurring).map((p) => ({ p, list: rows.filter((r) => r.key === p.id) })).filter((x) => x.list.length);
  const procTable = h('div', { class: 'table-wrap' }, h('table', { class: 'qtable ctable perf-table' },
    h('caption', { class: 'sr-only' }, 'לפי תהליך'),
    h('thead', {}, h('tr', {}, ...['תהליך', 'זמן ביצוע בפרוטוקול', 'נסגרו', 'בזמן', 'זמן בפועל (חציון)', 'יעד'].map((t) => h('th', { scope: 'col' }, t)))),
    h('tbody', {}, ...byProc.map(({ p, list }) => {
      const onTime = list.filter((r) => r.onTime).length;
      const med = medianRow(list, 'ms');
      const tgt = medianRow(list, 'targetMs');
      const flag = list.length >= FEW && med && tgt && med.ms > 2 * tgt.targetMs;
      return h('tr', {},
        h('td', { 'data-label': 'תהליך', class: 'client' },
          h('details', { class: 'perf-proc' }, h('summary', {}, `${p.num} · ${p.title}`),
            h('ul', {}, ...list.sort((a, b) => b.completedAt - a.completedAt).map((r) => h('li', {},
              `${r.client.name}${roundOf(r.proc) ? ` · סבב ${roundOf(r.proc)}` : ''} · יעד ${formatWhen(r.dueAt, now)} · נסגר ${formatWhen(r.completedAt, now)}${r.ms !== null ? ` · ${lateBy(r.start, r.completedAt)}` : ''}${r.onTime ? '' : ' · אחרי היעד'}`)))),
          flag ? h('span', { class: 'tag tag-warn' }, 'כדאי לבדוק את התהליך או את היעד') : null),
        h('td', { 'data-label': 'זמן ביצוע בפרוטוקול', class: 'client sla' }, p.sla),
        h('td', { 'data-label': 'נסגרו', class: 'num' }, String(list.length)),
        h('td', { 'data-label': 'בזמן', class: 'client' }, onTimeCell(list.length, onTime)),
        h('td', { 'data-label': 'זמן בפועל (חציון)' }, med ? lateBy(med.start, med.completedAt) : '—'),
        h('td', { 'data-label': 'יעד' }, tgt ? lateBy(tgt.start, tgt.dueAt) : '—'));
    }))));

  const personRow = (key) => {
    const mine = rows.filter((r) => r.people.includes(key));
    const w = workFor(key);
    return h('tr', {},
      h('td', { 'data-label': 'עובד' }, personChip(key)),
      h('td', { 'data-label': 'תהליכים שנסגרו', class: 'num' }, String(mine.length)),
      h('td', { 'data-label': 'בזמן', class: 'client' }, onTimeCell(mine.length, mine.filter((r) => r.onTime).length)),
      h('td', { 'data-label': 'פתוחים עכשיו', class: 'num' }, String(w.filter((g) => !g.task && g.status !== 'client').length)),
      h('td', { 'data-label': 'ממתינים ללקוח', class: 'num' }, String(w.filter((g) => g.status === 'client').length)));
  };
  const personTable = (caption, keys) => h('div', { class: 'table-wrap' }, h('table', { class: 'qtable ctable perf-table perf-people' },
    h('caption', { class: 'sr-only' }, caption),
    h('thead', {}, h('tr', {}, ...['עובד', 'תהליכים שנסגרו', 'בזמן', 'פתוחים עכשיו', 'ממתינים ללקוח'].map((t) => h('th', { scope: 'col' }, t)))),
    h('tbody', {}, ...keys.map(personRow))));

  fill(box, chips, intro,
    me ? h('section', { class: 'perf-me', 'aria-label': 'הנתונים שלי' }, h('h2', { class: 'wgroup-h' }, 'הנתונים שלי'), personTable('הנתונים שלי', [me])) : null,
    h('h2', { class: 'wgroup-h' }, 'לפי תהליך'),
    procTable,
    h('h2', { class: 'wgroup-h' }, 'שיחה שבועית (31)'),
    h('p', { class: 'perf-calls' }, calls.due ? `שיחות שתועדו: ${calls.done} מתוך ${calls.due} שבועות־לקוח` : 'עוד אין לקוחות בשלב השיחות השבועיות בתקופה הזו.'),
    TEAM_VIEWERS.has(me) ? h('section', { class: 'perf-team', 'aria-label': 'לפי עובד' },
      h('h2', { class: 'wgroup-h' }, 'לפי עובד'),
      h('p', { class: 'perf-intro' }, 'אחוז נמוך בתהליך הוא קודם כול סימן לבדוק את התהליך או את היעד.'),
      personTable('לפי עובד', Object.keys(PEOPLE))) : null);
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

$('btn-refresh').addEventListener('click', () => { perfLog.clear(); load(); });
window.addEventListener('hashchange', () => {
  const v = location.hash.slice(1);
  if (TABS.includes(v) && v !== view && !$('app').hidden) setView(v);
});
document.addEventListener('visibilitychange', () => { if (!document.hidden && !$('app').hidden && !busy()) load(); });
// Statuses depend on the clock: every minute, even in a background tab, check
// for processes that turned overdue (for the notification); render only when visible.
// With notifications on, a background tab also reloads the data every 5 minutes.
function tick() {
  if ($('app').hidden) return;
  states.clear();
  if (document.hidden && notifyState() === 'on' && Date.now() - lastLoad > 5 * 60e3) { load(); return; }
  checkLate();
  if (!document.hidden && !busy()) renderKeepingFocus();
}
setInterval(tick, 60e3);

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
