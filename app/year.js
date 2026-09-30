// "שנת החבילה" (year.html; plan stage 5, section 4 stations 7–8, decisions 31 and 33):
//  - the 90-day renewals list (owner, Lior, Irit): each client whose package ends
//    within 90 days, soonest first, with a results summary from the system's data and
//    a renewal quote prefilled from the current package (the builder, index.html).
//    Nothing is sent from here: the renewal message is advertising and stays manual;
//  - the month grid: which month of the package each client is in, and this month's
//    items of the monthly cycle (a draft) with their owners, marked in place;
//  - the protocol's versions: what changed in each, and how many clients started
//    under which.
// The logic: app/year-logic.js, app/renewals.js, app/protocol-versions.js.
import { PROTOCOL_VERSION } from './protocol.js';
import { clientState } from './protocol-logic.js';
import { loadClients, loadChecks, loadDirectory } from './protocol-data.js';
import { $, fill, h, toast, errorText, mountSession, directory, viewerOf, formatDay } from './protocol-ui.js';
import { DRAFT_LABEL, yearOf, renewalsDue, marksByKey, groupMarks, RENEWAL_DAYS } from './year-logic.js';
import { resultsSummary, renewalStage, renewalDraft, packageText, QUOTE_DRAFT_KEY, BUILDER_URL } from './renewals.js';
import { loadMonthMarks, loadAgreements, loadSurveys } from './year-data.js';
import { itemRow, saveMark, worksCycle } from './month-ui.js';
import { PROTOCOL_HISTORY, versionOf } from './protocol-versions.js';
import { officeLinks } from './office-ui.js';
import { dayKeyIL } from './tz.js';

let viewer = null;
let me = null;
let clients = [];
let checks = {};
let marks = null;          // rows (null: the table is not there yet)
let agreements = new Map();
let surveys = null;        // { clientId: rows } (null: no surveys table yet)
let lastLoad = 0;
const pending = new Set();
const openRows = new Set(); // clients whose month items are shown
const states = new Map();
const stateOf = (c) => {
  if (!states.has(c.id)) states.set(c.id, clientState(c, checks[c.id] || {}, new Date()));
  return states.get(c.id);
};
const enc = encodeURIComponent;
const cardUrl = (id, hash = '') => `client.html?id=${enc(id)}${hash ? `#${hash}` : ''}`;
// The renewals are the owner's, Lior's and Irit's (station 8).
const seesRenewals = () => !viewer?.error && (viewer?.scope === 'office' && (!me || me === 'lior' || me === 'irit'));
const office = () => worksCycle(viewer);

// ── Data ────────────────────────────────────
let inflight = null;
function load() {
  inflight ||= doLoad().finally(() => { inflight = null; });
  return inflight;
}
async function doLoad() {
  if (!clients.length) $('state').textContent = 'טוען…';
  try {
    [clients, checks, marks] = await Promise.all([loadClients(), loadChecks(), loadMonthMarks()]);
  } catch (err) {
    $('state').textContent = errorText(err);
    return;
  }
  states.clear();
  const now = new Date();
  if (seesRenewals()) {
    const due = renewalsDue(clients, now);
    const [ag, sv] = await Promise.all([
      loadAgreements(due.map((x) => x.client.quote_id)).catch(() => new Map()),
      loadSurveys(due.map((x) => x.client.id)).catch(() => null),
    ]);
    agreements = ag;
    surveys = sv;
  }
  lastLoad = Date.now();
  $('state').textContent = '';
  render();
}

// ── Render ──────────────────────────────────
function render() {
  const now = new Date();
  const renew = seesRenewals();
  $('renewals').hidden = !renew;
  if (renew) renderRenewals(now);
  renderMonths(now);
  renderVersions();
  fill($('yr-jump'), h('ul', { class: 'chips-row' },
    renew ? h('li', {}, h('a', { class: 'chip', href: '#renewals' }, 'חידושים')) : null,
    h('li', {}, h('a', { class: 'chip', href: '#months' }, 'החודש של כל לקוח')),
    h('li', {}, h('a', { class: 'chip', href: '#versions' }, 'גרסאות הפרוטוקול'))));
}
function keepFocus(fn) {
  const id = document.activeElement?.id;
  fn();
  if (id) document.getElementById(id)?.focus({ preventScroll: true });
}

// ── Renewals ────────────────────────────────
function daysText(n) {
  if (n === 0) return 'היום';
  if (n === 1) return 'מחר';
  return `בעוד ${n} ימים`;
}
function renderRenewals(now) {
  const list = renewalsDue(clients, now, RENEWAL_DAYS);
  $('rn-n').textContent = String(list.length);
  const grouped = groupMarks(marks || []);
  fill($('rn-list'), ...(list.length ? list.map((x) => renewalCard(x, grouped[x.client.id] || {}, now))
    : [h('li', { class: 'empty' }, 'אין לקוח שהחבילה שלו מסתיימת ב־90 הימים הקרובים.')]));
}
function renewalCard({ client: c, endAt, daysLeft }, cmarks, now) {
  const s = stateOf(c);
  const cs = checks[c.id] || {};
  const ag = c.quote_id ? agreements.get(c.quote_id) || null : null;
  const stage = renewalStage(s, cs);
  const lines = resultsSummary(c, s, cs, { marks: cmarks, surveys: surveys ? surveys[c.id] || [] : null, now });
  const draft = renewalDraft(c, ag);
  const pkg = packageText(c, ag);
  const hid = `rn-${c.id}`;
  return h('li', { class: `of-card yr-renew${daysLeft <= 30 ? ' is-soon' : ''}`, 'data-id': c.id, 'aria-labelledby': `${hid}-h` },
    h('div', { class: 'of-head' },
      h('a', { class: 'wclient', href: cardUrl(c.id), id: `${hid}-h` }, c.name),
      pkg ? h('span', { class: 'wtitle' }, pkg) : null),
    h('p', { class: 'of-line yr-end' }, h('strong', {}, `מסתיים ${formatDay(dayKeyIL(endAt))}`), ` · ${daysText(daysLeft)}`,
      h('span', { class: `tag yr-stage st-${stage.key}${stage.late ? ' is-late' : ''}` }, stage.text)),
    h('dl', { class: 'yr-sum' }, ...lines.flatMap((l) => [h('dt', {}, l.label), h('dd', { class: l.warn ? 'late' : '' }, l.text)])),
    h('div', { class: 'of-acts' },
      draft ? h('a', {
        class: 'btn btn-sm btn-primary yr-quote', href: BUILDER_URL, id: `${hid}-quote`,
        onclick: (e) => { if (!openRenewalQuote(c, draft)) e.preventDefault(); },
      }, 'הצעת חידוש') : h('span', { class: 'muted' }, 'החבילה לא ידועה: אפשר להכין הצעה ידנית.'),
      h('a', { class: 'btn btn-sm btn-ghost', href: cardUrl(c.id, 'p34') }, 'תהליך 34 בכרטיס')));
}
// The builder reads its draft from this tab's session storage (app/builder.js).
function openRenewalQuote(c, draft) {
  try {
    const prev = JSON.parse(sessionStorage.getItem(QUOTE_DRAFT_KEY) || 'null');
    const prevName = prev?.client?.['c-name'];
    if (prevName && prevName !== draft.client['c-name'] && !window.confirm(`בלשונית הזו יש טיוטת הצעה ל${prevName}. להחליף אותה בהצעת חידוש ל${c.name}?`)) return false;
    sessionStorage.setItem(QUOTE_DRAFT_KEY, JSON.stringify(draft));
    return true;
  } catch {
    toast('הדפדפן לא שומר טיוטות בלשונית הזו. פתחו הצעה חדשה ובחרו את החבילה ידנית.');
    return false;
  }
}

// ── The month grid ──────────────────────────
function cell(m, of) {
  let cls;
  let text;
  if (m.before) { cls = 'c-before'; text = m.n === 1 ? 'הצטרפות' : 'לפני המחזור החודשי'; }
  else if (m.future) { cls = 'c-future'; text = 'עוד לא התחיל'; }
  else if (m.late) { cls = 'c-late'; text = `${m.done} מתוך ${m.total} בוצעו, ${m.late} באיחור`; }
  else if (m.total && m.done === m.total) { cls = 'c-done'; text = 'הושלם'; }
  else { cls = 'c-part'; text = m.total ? `${m.done} מתוך ${m.total} בוצעו` : 'אין פריטים'; }
  return h('li', { class: `yr-cell ${cls}${m.current ? ' is-now' : ''}`, title: `חודש ${m.n}: ${text}` },
    h('span', { 'aria-hidden': 'true' }, String(m.n)),
    h('span', { class: 'sr-only' }, `חודש ${m.n} מתוך ${of}${m.current ? ' (החודש)' : ''}: ${text}`));
}
function monthRow(c, now) {
  const s = stateOf(c);
  const cmarks = marksByKey((marks || []).filter((r) => r.client_id === c.id));
  const y = yearOf(c, s, checks[c.id] || {}, cmarks, now);
  if (!y) return null;
  const v = versionOf(c);
  const cur = y.current;
  const own = viewer?.scope !== 'office';
  const items = cur ? cur.items.filter((i) => !own || i.owner === me) : [];
  let status;
  if (c.status === 'ending') status = 'מסיים התקשרות: אין מחזור חודשי.';
  else if (y.over) status = 'תקופת החבילה הסתיימה.';
  else if (y.from === null) status = 'המחזור מתחיל בחודש שאחרי התזמון הראשון (28).';
  else if (!cur) status = `המחזור מתחיל בחודש ${y.from}.`;
  else status = `החודש: ${cur.done} מתוך ${cur.total} בוצעו${cur.late ? ` · ${cur.late} באיחור` : ''}`;
  const rid = `mo-${c.id}`;
  const open = openRows.has(c.id) || !!cur?.late;
  return h('li', { class: `of-card yr-row${cur?.late ? ' is-late' : ''}`, 'data-id': c.id },
    h('div', { class: 'of-head' },
      h('a', { class: 'wclient', href: cardUrl(c.id, 'month') }, c.name),
      h('span', { class: 'wtitle' }, `חודש ${y.n} מתוך ${y.of}`),
      v < PROTOCOL_VERSION ? h('span', { class: 'tag yr-ver', title: 'פריטים שנוספו אחר כך לא נספרים לו באיחור' }, `התחיל בגרסה ${v} של הפרוטוקול`) : null),
    h('ol', { class: 'yr-strip', 'aria-label': `החודשים של ${c.name}` }, ...y.months.map((m) => cell(m, y.of))),
    h('p', { class: `of-line yr-status${cur?.late ? ' late' : ''}` }, status),
    items.length ? h('details', {
      class: 'yr-items', open, id: `${rid}-d`,
      ontoggle: (e) => { if (e.currentTarget.open) openRows.add(c.id); else openRows.delete(c.id); },
    },
    h('summary', {}, `פריטי חודש ${y.n}`, h('span', { class: 'tag tag-draft' }, 'טיוטה')),
    h('ul', { class: 'items' }, ...items.map((i) => itemRow(i, { client: c, me, office: office(), pending, onMark: onMark(c, cmarks) })))) : null);
}
const onMark = (c, cmarks) => async (item, state, focusId) => {
  const key = `${c.id}:${item.month}:${item.key}`;
  if (pending.has(key)) return;
  pending.add(key);
  keepFocus(render);
  try {
    await saveMark(c, item, state, cmarks, me);
    marks = [...(marks || []).filter((r) => !(r.client_id === c.id && r.month === item.month && r.item === item.key)),
      ...Object.values(cmarks).filter((r) => r.month === item.month && r.item === item.key)];
    if (state) toast(state === 'done' ? `סומן: ${item.label}` : 'סומן לא רלוונטי החודש.');
  } catch (err) {
    toast(`הסימון לא נשמר. ${errorText(err)}`);
  }
  pending.delete(key);
  openRows.add(c.id);
  render();
  document.getElementById(focusId)?.focus({ preventScroll: true });
};
function renderMonths(now) {
  const list = clients.filter((c) => c.status === 'active' || c.status === 'ending');
  const rows = list.map((c) => ({ c, s: yearOf(c, stateOf(c), checks[c.id] || {}, marksByKey((marks || []).filter((r) => r.client_id === c.id)), now) }))
    .filter((x) => x.s)
    .sort((a, b) => ((b.s.current?.late || 0) - (a.s.current?.late || 0)) || String(a.c.name).localeCompare(String(b.c.name), 'he'));
  $('mo-n').textContent = String(rows.length);
  const note = marks === null ? h('li', { class: 'empty' }, 'הסימונים של המחזור החודשי יישמרו אחרי שהמיגרציה של שלב 5 תוחל.') : null;
  fill($('mo-list'), note, ...(rows.length ? rows.map((x) => monthRow(x.c, now)) : [h('li', { class: 'empty' }, 'אין לקוחות פעילים.')]));
}

// ── Protocol versions ───────────────────────
function renderVersions() {
  const counts = new Map();
  for (const c of clients) if (c.status === 'active' || c.status === 'ending') counts.set(versionOf(c), (counts.get(versionOf(c)) || 0) + 1);
  const byVersion = [...counts].sort((a, b) => b[0] - a[0]).map(([v, n]) => `גרסה ${v}: ${n === 1 ? 'לקוח אחד' : `${n} לקוחות`}`).join(' · ');
  fill($('vr-body'),
    h('p', { class: 'hint' }, `הגרסה הנוכחית: ${PROTOCOL_VERSION}. לקוח שהתחיל בגרסה קודמת: פריט שנוסף אחר כך מסומן ״חדש בפרוטוקול״ ולא נספר באיחור, ומועד שהתקצר נשאר כמו שהתחיל.`),
    byVersion ? h('p', { class: 'of-line' }, `הלקוחות הפעילים לפי הגרסה שבה התחילו: ${byVersion}`) : null,
    h('ol', { class: 'yr-versions', reversed: true },
      ...[...PROTOCOL_HISTORY].reverse().map((v) => h('li', { value: String(v.version) },
        h('p', { class: 'yr-vh' }, h('strong', {}, `גרסה ${v.version} · ${v.title}`), h('span', { class: 'muted' }, ` · ${formatDay(v.date)}`),
          v.items?.length ? h('span', { class: 'tag' }, `${v.items.length} פריטים חדשים`) : null),
        h('ul', {}, ...v.changes.map((t) => h('li', {}, t)))))));
}

// ── Boot ────────────────────────────────────
$('btn-refresh').addEventListener('click', () => load());
document.addEventListener('visibilitychange', () => { if (!document.hidden && viewer && Date.now() - lastLoad > 60e3) load(); });
window.addEventListener('hashchange', () => document.getElementById(location.hash.slice(1))?.focus());

mountSession(async (staff) => {
  const [dir, v] = await Promise.all([loadDirectory(), viewerOf(staff.email)]);
  Object.assign(directory, dir);
  viewer = v;
  me = v.me;
  if (!office()) { $('no-access').hidden = false; return; }
  $('yr-page').hidden = false;
  $('head-actions').prepend(...officeLinks(v, 'year.html'));
  $('yr-draft').title = DRAFT_LABEL;
  await load();
  const target = location.hash.slice(1);
  if (target && document.getElementById(target) && !document.getElementById(target).hidden) {
    document.getElementById(target).scrollIntoView();
    document.getElementById(target).focus({ preventScroll: true });
  }
});

