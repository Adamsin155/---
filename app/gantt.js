// "גאנט התוכן" (gantt.html): the client's content year as a calendar.
//  - Without a client (gantt.html): the index of every client's Gantt, for Ilai, the
//    owner, Irit, Lior and Ofir (app/gantt-index.js).
//  - Staff (gantt.html?id=…). The owner's decision of 6.10.2026: Ilai (the Gantt is
//    his) and the owner make the plan from the one template (app/gantt-template.js),
//    move dates for this client (drag a chip to another day, or edit its date and
//    time), set what is scheduled and what went up (one tap on an entry's state, or
//    "סימון כתוזמנו" for a day, a week or a month), attach a link or one of the client's
//    files, add entries of their own and connect the client to its brand in Metricool.
//    Irit, Lior and Ofir read, print a month and create, copy or revoke the client's
//    read-only link. Whoever else sees the client (its editor) reads. The database
//    enforces all of it (20261007100000_gantt_roles_statuses.sql).
//    "עדכון מהתבנית" keeps dates moved by hand unless that is confirmed.
//  - The client (gantt.html?t=…): the same calendar, read-only, from
//    public.get_gantt(token): no internal entry, note or file path, and only
//    מתוכנן / תוזמן / עלה (never "חסר" or "שגיאה").
// The logic: app/gantt-logic.js; the data: app/gantt-data.js. All text goes through
// text nodes, never innerHTML.
import { GANTT_KINDS, KIND_ORDER, TEMPLATE_TEXT, TEMPLATE_VERSION, WEEKDAY_NAMES } from './gantt-template.js';
import {
  generatePlan, planDiff, monthGrid, calendarMonths, packageMonthOf, entryStatus, entriesByDay, yearGlance, totals,
  holidayName, contractEndKey, safeLink, isCustom, timeText, STATUS_TEXT, CLIENT_STATUS_TEXT, DAY_KEY, TIME_KEY, byWhen, monthRange, fileTitle,
  clientStatus, nextState, toSchedule, weekOf, nextPost, addDays,
} from './gantt-logic.js';
import { isOwnerView } from './team-rules.js';
import { clientLabel } from './protocol-logic.js';
import { termOf } from './year-logic.js';
import { dayKeyIL } from './tz.js';
import { glide } from './shell.js'; // a day or a month chosen: the calendar changes softly

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const TOKEN = params.get('t');
const SHARE = TOKEN !== null;
const enc = encodeURIComponent;

let ui = null;   // app/protocol-ui.js (staff only)
let data = null; // app/gantt-data.js
let h;
let client = null;
let rows = [];          // the plan's entries
let files = null;       // Map id -> file (null: no files table yet)
let canEdit = false;    // Ilai and the owner: everything
let canShare = false;   // the office (and Ilai): the client's read-only link, and the index
let brandUi = null;     // app/gantt-brand.js (staff only)
let mc = { settings: undefined, brand: undefined, sync: null }; // Metricool: the switch, this client's brand, its last sync
let missing = false;    // the table is not there yet
let shown = null;       // { year, month }
let view = matchMedia('(max-width: 640px)').matches ? 'list' : 'grid';
let selectedDay = null;
let share;              // the client's link (undefined: none yet / no table)
let preview = false;
let viewBeforePrint = null; // set while printing

const fmtMonth = new Intl.DateTimeFormat('he-IL', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const fmtMonthShort = new Intl.DateTimeFormat('he-IL', { month: 'short', timeZone: 'UTC' });
const monthName = (y, m) => fmtMonth.format(new Date(Date.UTC(y, m - 1, 15)));
const shortMonth = (y, m) => fmtMonthShort.format(new Date(Date.UTC(y, m - 1, 15)));
const dmy = (key) => { const [y, m, d] = String(key || '').split('-').map(Number); return key ? `${d}.${m}.${y}` : ''; };
const dm = (key) => { const [, m, d] = String(key).split('-').map(Number); return `${d}.${m}`; };
const dayLine = (key) => `יום ${WEEKDAY_NAMES[new Date(`${key}T12:00:00Z`).getUTCDay()]}, ${dmy(key)}`;
const todayKey = () => dayKeyIL(new Date());
const kindOf = (e) => GANTT_KINDS[e.kind] || GANTT_KINDS.custom;
const kindStyle = (kind) => `--k:${(GANTT_KINDS[kind] || GANTT_KINDS.custom).color};--ks:${(GANTT_KINDS[kind] || GANTT_KINDS.custom).soft}`;
const fileOf = (e) => (e.file_id && files ? files.get(e.file_id) || null : null);
const linkOf = (e) => safeLink(e.link) || safeLink(fileOf(e)?.link);
const postedOn = (e) => e.posted_on || (e.state === 'posted' ? fileOf(e)?.posted_on : null) || null;
// The client never sees "חסר" or "שגיאה": on its link both read as planned.
const statusOf = (e) => (SHARE ? clientStatus(entryStatus(e, new Date())) : entryStatus(e, new Date()));
const statusText = (s) => (SHARE ? CLIENT_STATUS_TEXT : STATUS_TEXT)[s];
// ✓ up, a clock for scheduled, ! only for what is missing or failed.
const stateMark = (s) => (s === 'posted' ? h('span', { class: 'gt-tick', 'aria-hidden': 'true' }, '✓')
  : s === 'scheduled' ? h('span', { class: 'gt-clock', 'aria-hidden': 'true' })
    : s === 'missing' || s === 'error' ? h('span', { class: 'gt-warn', 'aria-hidden': 'true' }, '!') : null);
const stateLabel = (e, s) => (s === 'posted' && postedOn(e) ? `עלה ${dm(postedOn(e))}` : statusText(s));
const toast = (msg, action) => (ui ? ui.toast(msg, action) : null);
// The team names a client by the business first, then the contact (clientLabel); the
// client's own link has the business name only.
const nameOfClient = () => (SHARE ? client.name : clientLabel(client));

// ── Boot ──────────────────────────────────
async function boot() {
  ({ h } = await import('./quote-doc.js'));
  data = await import('./gantt-data.js');
  if (SHARE) return bootShare();
  ui = await import('./protocol-ui.js');
  const { loadClient, loadDirectory } = await import('./protocol-data.js');
  const { worksCycle } = await import('./month-ui.js');
  ui.mountSession(async (staff) => {
    const id = params.get('id');
    const [dir, viewer] = await Promise.all([loadDirectory().catch(() => ({})), ui.viewerOf(staff.email)]);
    Object.assign(ui.directory, dir);
    // Ilai and the owner change the Gantt; the office (Irit, Lior, Ofir) reads and shares the client's link.
    canShare = worksCycle(viewer);
    canEdit = !viewer.error && (viewer.me === 'ilai' || isOwnerView(viewer));
    $('nav-year').hidden = !canShare;
    if (!id) {
      if (!canShare) { $('state').textContent = 'לא נבחר לקוח. פתחו את הגאנט מכרטיס הלקוח.'; return; }
      const [{ mountIndex }, { loadClients }] = await Promise.all([import('./gantt-index.js'), import('./protocol-data.js')]);
      await mountIndex({ ui, data, loadClients, canEdit });
      return;
    }
    $('state').textContent = 'טוען…';
    try {
      client = await loadClient(id);
      if (!client) { $('no-access').hidden = false; $('state').textContent = ''; return; }
      const [r, f] = await Promise.all([data.loadGantt(id), data.loadFiles(id).catch(() => null)]);
      missing = r === null;
      rows = r || [];
      files = f ? new Map(f.map((x) => [x.id, x])) : null;
      if (canShare && !missing) share = await data.loadShare(id).catch(() => undefined);
      // Metricool: the owner's switch, this client's brand and its last sync (the office only).
      if (canShare && !missing) {
        brandUi = await import('./gantt-brand.js');
        const [settings, brands, syncs, none] = await Promise.all([data.metricoolSettings(), data.loadBrands(id), data.loadSyncs(id), data.loadNoBrand(id)]);
        mc = { settings, brand: brands ? brands[id] || { blogId: null, brand: null } : undefined, sync: syncs[id] || null, none };
      }
    } catch (err) {
      $('state').textContent = ui.errorText(err);
      return;
    }
    $('state').textContent = '';
    document.title = `גאנט התוכן · ${nameOfClient()} · astrateg`;
    pickMonth();
    render();
  });
}

const CLOSED = {
  invalid: ['הקישור לא תקין', 'כדאי לבדוק שהקישור הועתק במלואו, או לבקש מאיתנו קישור חדש.'],
  revoked: ['הקישור הוחלף', 'שלחנו קישור חדש לגאנט. אפשר לבקש אותו מאיתנו בקבוצה.'],
  expired: ['פג תוקף הקישור', 'אפשר לבקש מאיתנו קישור חדש בקבוצה.'],
  closed: ['תקופת העבודה הסתיימה', 'תודה שעבדתם איתנו. לכל שאלה אנחנו כאן.'],
  error: ['לא הצלחנו לטעון את הגאנט', 'כדאי לנסות שוב בעוד רגע.'],
};
async function bootShare() {
  document.body.classList.add('is-share');
  $('staff-nav').hidden = true;
  $('brand').removeAttribute('href');
  $('login-block').hidden = true;
  const closed = (kind) => {
    const [t, x] = CLOSED[kind] || CLOSED.error;
    $('closed').replaceChildren(h('h1', {}, t), h('p', {}, x));
    $('closed').hidden = false;
    document.title = `${t} · astrateg`;
  };
  if (!/^[A-Za-z0-9_-]{43}$/.test(TOKEN)) { closed('invalid'); return; }
  $('state').textContent = 'טוען…';
  let d;
  try { d = await data.loadShared(TOKEN); } catch { $('state').textContent = ''; closed('error'); return; }
  $('state').textContent = '';
  if (!d || d.state !== 'ok') { closed(d?.state || 'invalid'); return; }
  preview = !!d.preview;
  client = { id: null, name: d.client.business, deal_at: d.client.dealAt, contract_end: d.client.contractEnd, deliverables: {} };
  rows = (d.entries || []).map((e, i) => ({ id: `s${i}`, key: e.key, kind: e.kind, title: e.title, day: e.day, time_il: e.time, num: e.num, state: e.state, posted_on: e.postedOn, link: e.link }));
  document.title = `גאנט התוכן · ${client.name} · astrateg`;
  $('app').hidden = false;
  pickMonth();
  render();
}

// The month shown first: this month when it is in the contract, else the first.
// `d` (a day, from the index's week or a reminder) opens that day.
function pickMonth() {
  const months = calendarMonths(client);
  const day = DAY_KEY.test(params.get('d') || '') ? params.get('d') : null;
  const want = (day ? day.slice(0, 7) : null) || params.get('m') || todayKey().slice(0, 7);
  const hit = months.find((m) => m.key === want) || (todayKey() > (contractEndKey(client) || '') ? months.at(-1) : months[0]);
  shown = hit ? { year: hit.year, month: hit.month } : null;
  if (day && hit && hit.key === day.slice(0, 7)) {
    selectedDay = day;
    setTimeout(() => (document.querySelector(`.gt-aday[data-day="${day}"]`) || $('gm-day'))?.scrollIntoView?.({ block: 'center' }), 0);
  }
}

// ── Render ────────────────────────────────
function render() {
  const has = rows.length > 0;
  $('gt-preview').hidden = !preview;
  $('gt-hero').hidden = false;
  renderHero();
  $('gt-empty').hidden = has;
  if (!has) renderEmpty();
  for (const id of ['gt-stats', 'gt-glance', 'gt-cal']) $(id).hidden = !has || !shown;
  $('gt-rules').hidden = SHARE;
  $('gt-share').hidden = SHARE || !canShare || missing || !has;
  // The office that only reads is told so (and why there is nothing to press).
  $('gt-readonly').hidden = SHARE || canEdit || !canShare || !has;
  $('btn-bulk').hidden = !canEdit || !has || !shown;
  renderMetricool();
  if (has && shown) { renderStats(); renderGlance(); renderMonth(); }
  if (!SHARE) renderRules();
  if (!$('gt-share').hidden) renderShare();
}

// The line about Metricool, with "חיבור למותג" for Ilai and the owner. Nothing before
// the migration (settings undefined), and nothing for whoever is not the office.
function renderMetricool() {
  if (SHARE || !brandUi || !mc.settings || mc.brand === undefined || missing) { $('gt-mc').hidden = true; return; }
  // Marked "ללקוח אין מותג" in the card of "המשימות שלי" (section 33): said here, with the way back.
  const none = !!mc.none && !mc.brand.blogId;
  const line = none ? { tone: 'off', text: 'סומן שללקוח אין מותג ב־Metricool. הסימון ידני.' }
    : brandUi.clientLine({ enabled: !!mc.settings.enabled, blogId: mc.brand.blogId, brand: mc.brand.brand, sync: mc.sync });
  const act = canEdit ? h('button', {
    type: 'button', class: 'btn btn-sm btn-ghost gt-mc-act', id: 'btn-brand',
    onclick: () => brandUi.openBrandDialog({
      client, current: mc.brand, toast,
      onSaved: async (saved) => { mc.brand = saved; mc.sync = null; if (saved.blogId) mc.none = false; rows = (await data.loadGantt(client.id).catch(() => rows)) || rows; render(); },
    }),
  }, mc.brand.blogId ? 'החלפת מותג' : 'חיבור למותג ב־Metricool') : null;
  const back = canEdit && none ? h('button', {
    type: 'button', class: 'btn btn-sm btn-ghost gt-mc-act', id: 'btn-brand-back',
    onclick: async (e) => {
      e.currentTarget.disabled = true;
      try { await data.setNoBrand(client.id, false); mc.none = false; toast('הלקוח חזר לרשימת ״לקוחות שלא מחוברים ל־Metricool״.'); } catch { toast('לא נשמר. נסו שוב.'); }
      render();
    },
  }, 'ביטול הסימון') : null;
  brandUi.paintLine($('gt-mc'), line, act && back ? h('span', { class: 'gt-mc-acts' }, back, act) : act);
}

function renderHero() {
  const of = termOf(client);
  const endKey = contractEndKey(client);
  const deal = client.deal_at ? dayKeyIL(new Date(client.deal_at)) : null;
  const now = todayKey();
  const n = deal ? packageMonthOf(client, now) : 0;
  $('gt-title').textContent = `גאנט התוכן · ${nameOfClient()}`;
  const parts = [];
  if (deal) parts.push(`חוזה מ־${dmy(deal)} עד ${dmy(endKey)}`);
  if (deal && n >= 1 && n <= of) parts.push(`חודש ${n} מתוך ${of}`);
  else if (deal && n > of) parts.push('תקופת החוזה הסתיימה');
  $('gt-sub').textContent = parts.join(' · ');
  const acts = [];
  if (!SHARE && canShare) acts.push(h('a', { class: 'btn btn-sm btn-ghost', href: 'gantt.html', id: 'to-index' }, 'כל הגאנטים'));
  if (!SHARE) acts.push(h('a', { class: 'btn btn-sm btn-ghost', href: `client.html?id=${enc(client.id)}`, id: 'to-card' }, 'לכרטיס הלקוח'));
  if (rows.length) acts.push(h('button', { type: 'button', class: 'btn btn-sm btn-ghost', id: 'btn-print', onclick: printMonth }, 'הדפסת החודש'));
  // The one pink action of the screen is "סימון כתוזמנו" (by the calendar); these stay plain.
  if (canEdit && rows.length) {
    acts.push(h('button', { type: 'button', class: 'btn btn-sm', id: 'btn-add', onclick: () => openEntry(null) }, 'הוספת פריט'));
    acts.push(h('button', { type: 'button', class: 'btn btn-sm', id: 'btn-regen', onclick: regenerate }, 'עדכון מהתבנית'));
  }
  $('gt-actions').replaceChildren(...acts);
}

function renderEmpty() {
  const acts = [];
  let text;
  if (SHARE) text = 'הגאנט עוד בהכנה. נעדכן אתכם כשהוא מוכן.';
  else if (missing) text = 'הגאנט יישמר אחרי שהמיגרציה של הגאנט תוחל במסד (20261003130000_content_gantt.sql).';
  else if (!client.deal_at) text = 'חסר תאריך החתימה בכרטיס הלקוח. הגאנט נבנה ממנו: החודשים נספרים מיום החתימה.';
  else {
    const plan = generatePlan(client);
    const posts = plan.entries.filter((e) => GANTT_KINDS[e.kind].post).length;
    text = canEdit
      ? `התבנית תיצור ${plan.entries.length} פריטים, מהם ${posts} פרסומים, מ־${dmy(plan.entries[0]?.day)} עד ${dmy(plan.endKey)}, לפי הכמויות בחבילה. אחר כך אפשר להזיז כל תאריך ללקוח הזה בלבד.`
      : 'עילאי או בעל המשרד יוצרים אותו מהתבנית.';
    if (canEdit) acts.push(h('button', { type: 'button', class: 'btn btn-primary', id: 'btn-create', onclick: regenerate }, 'יצירת הגאנט מהתבנית'));
  }
  $('ge-text').textContent = text;
  $('ge-acts').replaceChildren(...acts);
}

function renderStats() {
  const now = new Date();
  const t = totals(rows, now);
  const next = nextPost(rows, now);
  const pct = t.posts ? Math.round((t.posted / t.posts) * 100) : 0;
  const stat = (cls, label, value, extra = null) => h('div', { class: `gt-stat ${cls}` }, h('span', { class: 'gt-stat-l' }, label), h('strong', { class: 'gt-stat-v' }, value), extra);
  // "חסרים": past their time and neither scheduled nor up. The alert colour only when there are any.
  // A failed post is one of them (it needs someone), and is named. Never on the client's link.
  const bad = t.missing + t.errors;
  $('gt-stats').replaceChildren(...[
    stat('st-posts', 'פרסומים בשנה', String(t.posts)),
    stat('st-up', 'עלו', `${t.posted}`, h('span', { class: 'gt-meter', role: 'img', 'aria-label': `${pct} אחוז עלו` }, h('span', { style: `inline-size:${pct}%` }))),
    stat('st-sched', 'תוזמנו', String(t.scheduled)),
    SHARE ? null : stat(`st-missing${bad ? ' is-missing' : ''}`, 'חסרים', String(bad), t.errors ? h('span', { class: 'gt-stat-x' }, t.errors === 1 ? 'מהם שגיאת פרסום אחת' : `מהם ${t.errors} שגיאות פרסום`) : null),
    stat('st-next', 'הפרסום הבא', next ? `${dm(next.day)}${next.time_il ? ` · ${timeText(next.time_il)}` : ''}` : '—', next ? h('span', { class: 'gt-stat-x' }, next.title) : null),
  ].filter(Boolean));
}

function renderGlance() {
  const of = termOf(client);
  const g = yearGlance(client, rows.filter((e) => !SHARE || !['plan', 'renewal'].includes(e.kind)), new Date());
  const pct = (n, of) => Math.round((n / of) * 100);
  const now = packageMonthOf(client, todayKey());
  const head = [h('th', { scope: 'col', class: 'gg-kind' }, 'סוג')];
  for (let n = 1; n <= of; n += 1) {
    const r = monthRange(client, n);
    const [y, m] = r.from.split('-').map(Number);
    head.push(h('th', { scope: 'col', class: n === now ? 'is-now' : '' },
      h('button', { type: 'button', class: 'gg-month', onclick: () => goTo(y, m), 'aria-label': `חודש ${n} בחבילה, מ־${dmy(r.from)}: פתיחה בלוח` },
        h('span', { class: 'gg-n' }, String(n)), h('span', { class: 'gg-m' }, shortMonth(y, m)))));
  }
  const body = g.map((row) => h('tr', { style: kindStyle(row.kind) },
    h('th', { scope: 'row', class: 'gg-kind' }, h('span', { class: 'gt-swatch', 'aria-hidden': 'true' }), GANTT_KINDS[row.kind].plural),
    ...row.months.map((c) => {
      // The bar: full for what is up, hatched above it for what is scheduled; a dot when something is missing (never for the client).
      const miss = SHARE ? 0 : c.missing;
      const words = [`${c.posted} מתוך ${c.planned} עלו`, c.scheduled ? `${c.scheduled} תוזמנו` : null, miss ? `${miss} חסרים` : null].filter(Boolean).join(', ');
      return h('td', { class: `${c.n === now ? 'is-now' : ''}${c.planned ? '' : ' is-empty'}${miss ? ' has-missing' : ''}` },
        c.planned ? h('span', { class: 'gg-cell', title: words },
          h('span', { class: 'gg-bar' },
            h('span', { class: 'gg-sched', style: `block-size:${pct(c.posted + c.scheduled, c.planned)}%` }),
            h('span', { class: 'gg-up', style: `block-size:${pct(c.posted, c.planned)}%` })),
          h('span', { class: 'gg-num' }, kindOf(row).post ? `${c.posted}/${c.planned}` : String(c.planned)),
          miss ? h('span', { class: 'gg-miss', 'aria-hidden': 'true' }, '!') : null,
          h('span', { class: 'sr-only' }, ` (${words})`)) : '');
    })));
  $('gg-table').replaceChildren(h('thead', {}, h('tr', {}, ...head)), h('tbody', {}, ...body));
}

function goTo(y, m) {
  shown = { year: y, month: m };
  selectedDay = null;
  renderMonth();
  $('gt-cal').scrollIntoView({ block: 'start' });
  $('gm-h').focus?.();
}

// The package months a calendar month touches ("חודשים 8–9 בחבילה").
function pkgText(y, m) {
  const days = monthGrid(y, m).flat().filter((d) => d.inMonth).map((d) => d.key);
  const of = termOf(client);
  const ns = [...new Set(days.map((k) => packageMonthOf(client, k)).filter((n) => n >= 1 && n <= of))];
  if (!ns.length) return 'מחוץ לתקופת החוזה';
  return ns.length === 1 ? `חודש ${ns[0]} בחבילה` : `חודשים ${ns[0]}–${ns.at(-1)} בחבילה`;
}

function renderMonth() {
  const { year, month } = shown;
  const months = calendarMonths(client);
  const i = months.findIndex((m) => m.year === year && m.month === month);
  $('gm-h').textContent = monthName(year, month);
  $('gm-h').setAttribute('tabindex', '-1');
  $('gm-pkg').textContent = pkgText(year, month);
  $('gp-client').textContent = `גאנט התוכן · ${client.business || client.name}`;
  $('gp-month').textContent = ` · ${monthName(year, month)} · ${pkgText(year, month)}`;
  $('gm-prev').disabled = i <= 0;
  $('gm-next').disabled = i < 0 || i >= months.length - 1;
  const now = todayKey().slice(0, 7);
  $('gm-pills').replaceChildren(h('ul', {}, ...months.map((m) => h('li', {},
    h('button', {
      type: 'button', class: `gt-pill${m.key === now ? ' is-today' : ''}`, 'aria-current': m.year === year && m.month === month ? 'true' : null,
      'aria-label': monthName(m.year, m.month), onclick: () => glide(() => { shown = { year: m.year, month: m.month }; selectedDay = null; renderMonth(); }),
    }, h('span', {}, shortMonth(m.year, m.month)), h('span', { class: 'gt-pill-y' }, String(m.year).slice(2)))))));
  $('gm-pills').querySelector('[aria-current="true"]')?.scrollIntoView?.({ block: 'nearest', inline: 'center' });
  const visible = rows.filter((e) => e.day.slice(0, 7) === `${year}-${String(month).padStart(2, '0')}`);
  const kinds = new Set(rows.map((e) => e.kind));
  $('gt-legend').replaceChildren(...KIND_ORDER.filter((k) => kinds.has(k)).map((k) => h('li', { style: kindStyle(k) }, h('span', { class: 'gt-swatch', 'aria-hidden': 'true' }), GANTT_KINDS[k].label)),
    h('li', { class: 'lg-sched' }, stateMark('scheduled'), 'תוזמן'),
    h('li', { class: 'lg-posted' }, stateMark('posted'), 'עלה'),
    ...(SHARE ? [] : [h('li', { class: 'lg-missing' }, stateMark('missing'), 'חסר')]));
  $('view-grid').setAttribute('aria-pressed', String(view === 'grid'));
  $('view-list').setAttribute('aria-pressed', String(view === 'list'));
  $('gm-grid').hidden = view !== 'grid';
  $('gm-list').hidden = view !== 'list';
  if (view === 'grid') renderGrid(year, month, visible); else renderList(visible);
  renderDay();
}

// ── The month grid ────────────────────────
const MAX_CHIPS = 3;
function chip(e) {
  const s = statusOf(e);
  const k = kindOf(e);
  const time = timeText(e.time_il);
  return h('button', {
    type: 'button', class: `gt-chip s-${s}`, style: kindStyle(e.kind), 'data-id': e.id, 'data-key': e.key,
    draggable: canEdit ? 'true' : null,
    title: `${e.title} · ${k.label}${time ? ` · ${time}` : ''} · ${statusText(s)}`,
    'aria-label': `${e.title}, ${k.label}${time ? `, ${time}` : ''}, ${statusText(s)}`,
    onclick: (ev) => { ev.stopPropagation(); openEntry(e); },
    ondragstart: (ev) => { ev.dataTransfer.setData('text/plain', e.id); ev.dataTransfer.effectAllowed = 'move'; ev.currentTarget.classList.add('is-drag'); },
    ondragend: (ev) => ev.currentTarget.classList.remove('is-drag'),
  },
  time ? h('span', { class: 'gt-chip-time num' }, time) : null,
  h('span', { class: 'gt-chip-t' }, e.title),
  stateMark(s));
}
function renderGrid(year, month, visible) {
  const byDay = entriesByDay(visible);
  const deal = dayKeyIL(new Date(client.deal_at));
  const end = contractEndKey(client);
  const today = todayKey();
  const starts = new Map();
  for (let n = 1; n <= termOf(client); n += 1) { const r = monthRange(client, n); if (r) starts.set(r.from, n); }
  const head = h('tr', {}, ...WEEKDAY_NAMES.map((w) => h('th', { scope: 'col' }, h('span', { class: 'wd-long' }, w), h('span', { class: 'wd-short', 'aria-hidden': 'true' }, w.slice(0, 1)))));
  const body = monthGrid(year, month).map((week) => h('tr', {}, ...week.map((d) => {
    const list = d.inMonth ? byDay.get(d.key) || [] : [];
    const out = d.key < deal || d.key > end;
    const hol = d.inMonth ? holidayName(d.key) : null;
    const wd = new Date(`${d.key}T12:00:00Z`).getUTCDay();
    const cls = ['gt-day-cell', d.inMonth ? '' : 'is-other', out ? 'is-out' : '', d.key === today ? 'is-today' : '', wd >= 5 ? 'is-weekend' : '', hol ? 'is-holiday' : '', selectedDay === d.key ? 'is-selected' : '', list.length ? 'has-items' : ''].filter(Boolean).join(' ');
    if (!d.inMonth) return h('td', { class: cls, 'aria-hidden': 'true' });
    const more = viewBeforePrint ? 0 : list.length - MAX_CHIPS; // a printed month shows every chip
    return h('td', {
      class: cls, 'data-day': d.key,
      ondragover: canEdit ? (ev) => { ev.preventDefault(); ev.currentTarget.classList.add('is-drop'); } : null,
      ondragleave: canEdit ? (ev) => ev.currentTarget.classList.remove('is-drop') : null,
      ondrop: canEdit ? (ev) => { ev.preventDefault(); ev.currentTarget.classList.remove('is-drop'); moveEntry(ev.dataTransfer.getData('text/plain'), d.key); } : null,
    },
    h('div', { class: 'gt-day-top' },
      h('button', {
        type: 'button', class: 'gt-daynum num', onclick: () => selectDay(d.key),
        'aria-label': `${dayLine(d.key)}${hol ? `, ${hol}` : ''}: ${list.length ? `${list.length} פריטים` : 'אין פריטים'}`,
      }, String(Number(d.key.slice(8)))),
      starts.has(d.key) ? h('span', { class: 'gt-pm' }, `חודש ${starts.get(d.key)}`) : null),
    hol ? h('span', { class: 'gt-hol' }, hol) : null,
    list.length ? h('div', { class: 'gt-chips' }, ...list.slice(0, more > 0 ? MAX_CHIPS - 1 : MAX_CHIPS).map(chip),
      more > 0 ? h('button', { type: 'button', class: 'gt-more', onclick: () => selectDay(d.key) }, `ועוד ${more + 1}`) : null) : null,
    list.length ? h('span', { class: 'gt-dots', 'aria-hidden': 'true' }, ...list.slice(0, 6).map((e) => h('span', { class: `gt-dot s-${statusOf(e)}`, style: kindStyle(e.kind) }))) : null);
  })));
  $('gm-grid').replaceChildren(h('table', { class: 'gt-grid', 'aria-label': `לוח ${monthName(year, month)}` }, h('thead', {}, head), h('tbody', {}, ...body)));
}
function selectDay(key) {
  glide(() => {
    selectedDay = selectedDay === key ? null : key;
    renderMonth();
    if (selectedDay) $('gm-day').scrollIntoView({ block: 'nearest' });
  });
}

// ── The list (phones, and the selected day) ─
function entryRow(e) {
  const s = statusOf(e);
  const k = kindOf(e);
  const link = linkOf(e);
  const f = fileOf(e);
  const thumb = f && /^image\//.test(f.mime || '') ? h('img', { class: 'gt-thumb', alt: '', 'data-path': f.storage_path, width: '44', height: '44' })
    : f || link ? h('span', { class: 'gt-thumb is-icon', 'aria-hidden': 'true' }, /^video\//.test(f?.mime || '') || ['video', 'monthly', 'story', 'collab', 'ch14'].includes(e.kind) ? '▶' : '↗') : null;
  // The state: words for everyone; for Ilai and the owner a button, one tap moves it on
  // (planned → scheduled → posted → planned), with an undo.
  const next = nextState(e.state);
  const stateEl = canEdit && k.post
    ? h('button', {
      type: 'button', class: `gt-state gt-state-btn s-${s}`, 'data-key': e.key, 'data-state': e.state,
      'aria-label': `${e.title}: ${stateLabel(e, s)}. לחיצה מסמנת ״${STATUS_TEXT[next]}״`, title: `לחיצה מסמנת ״${STATUS_TEXT[next]}״`,
      onclick: () => tapState(e),
    }, stateMark(s), stateLabel(e, s))
    : h('span', { class: `gt-state s-${s}` }, stateMark(s), stateLabel(e, s));
  return h('li', { class: `gt-row s-${s}`, style: kindStyle(e.kind), 'data-key': e.key },
    h('button', { type: 'button', class: 'gt-row-main', onclick: () => openEntry(e) },
      h('span', { class: 'gt-row-time num' }, timeText(e.time_il) || 'כל היום'),
      h('span', { class: 'gt-row-text' },
        h('span', { class: 'gt-row-title' }, e.title),
        h('span', { class: 'gt-row-meta' }, h('span', { class: 'gt-swatch', 'aria-hidden': 'true' }), k.label,
          e.mc_extra && !SHARE ? h('span', { class: 'gt-from-mc' }, ' · מ־Metricool') : null,
          e.edited && !e.mc_extra && !SHARE ? h('span', { class: 'gt-moved' }, ' · הוזז ידנית') : null))),
    stateEl,
    thumb,
    link ? h('a', { class: 'btn btn-sm btn-ghost gt-open', href: link, target: '_blank', rel: 'noopener noreferrer' }, 'לתוכן', h('span', { class: 'sr-only' }, ` (${e.title}, נפתח בחלון חדש)`)) : null);
}
function renderList(visible) {
  const byDay = entriesByDay(visible);
  if (!byDay.size) { $('gm-list').replaceChildren(h('p', { class: 'gt-none' }, 'אין פריטים בחודש הזה.')); return; }
  const today = todayKey();
  $('gm-list').replaceChildren(h('ol', { class: 'gt-agenda' }, ...[...byDay].map(([key, list]) => {
    const hol = holidayName(key);
    return h('li', { class: `gt-aday${key === today ? ' is-today' : ''}`, 'data-day': key },
      h('h3', { class: 'gt-aday-h' }, dayLine(key), key === today ? h('span', { class: 'tag' }, 'היום') : null, hol ? h('span', { class: 'gt-hol' }, hol) : null),
      h('ul', { class: 'gt-rows' }, ...list.map(entryRow)));
  })));
  loadThumbs($('gm-list'));
}
function renderDay() {
  const box = $('gm-day');
  if (!selectedDay || view !== 'grid') { box.hidden = true; return; }
  const list = rows.filter((e) => e.day === selectedDay).sort(byWhen);
  const hol = holidayName(selectedDay);
  box.hidden = false;
  box.replaceChildren(...[
    h('div', { class: 'gt-day-h' }, h('h3', {}, dayLine(selectedDay), hol ? h('span', { class: 'gt-hol' }, hol) : null),
      h('button', { type: 'button', class: 'btn-text', onclick: () => selectDay(selectedDay) }, 'סגירה')),
    list.length ? h('ul', { class: 'gt-rows' }, ...list.map(entryRow)) : h('p', { class: 'gt-none' }, 'אין פריטים ביום הזה.'),
    canEdit ? h('button', { type: 'button', class: 'btn btn-sm', onclick: () => openEntry(null, selectedDay) }, 'הוספת פריט ביום הזה') : null].filter(Boolean));
  loadThumbs(box);
}
async function loadThumbs(root) {
  if (SHARE) return;
  for (const img of root.querySelectorAll('img.gt-thumb[data-path]')) {
    const url = await data.fileUrl(img.dataset.path);
    if (url) img.src = url; else img.replaceWith(h('span', { class: 'gt-thumb is-icon', 'aria-hidden': 'true' }, '▣'));
  }
}

// ── One entry ─────────────────────────────
const dlg = () => $('entry-dlg');
function field(label, input, hint = null) {
  return h('div', { class: 'field' }, h('label', { for: input.id }, label), input, hint ? h('p', { class: 'hint' }, hint) : null);
}
function readOnlyEntry(e) {
  const s = statusOf(e);
  const link = linkOf(e);
  const f = fileOf(e);
  return [
    h('dl', { class: 'gt-facts' },
      h('dt', {}, 'מתי'), h('dd', {}, `${dayLine(e.day)}${e.time_il ? ` · ${timeText(e.time_il)}` : ''}`),
      h('dt', {}, 'מצב'), h('dd', {}, h('span', { class: `gt-state s-${s}` }, stateMark(s), s === 'posted' && postedOn(e) ? `עלה ב־${dmy(postedOn(e))}` : statusText(s))),
      !SHARE && mcNote(e) ? [h('dt', {}, 'Metricool'), h('dd', {}, mcNote(e))] : null,
      f ? [h('dt', {}, 'קובץ'), h('dd', {}, fileTitle(f))] : null,
      !SHARE && e.note ? [h('dt', {}, 'הערה'), h('dd', {}, e.note)] : null),
    f && /^image\//.test(f.mime || '') ? h('img', { class: 'gt-preview-img', alt: f.label || '', 'data-path': f.storage_path }) : null,
    link ? h('a', { class: 'btn btn-primary gt-open-big', href: link, target: '_blank', rel: 'noopener noreferrer' }, 'צפייה בתוכן', h('span', { class: 'sr-only' }, ' (נפתח בחלון חדש)')) : null,
    !link && f && !SHARE ? h('button', { type: 'button', class: 'btn', onclick: async () => { const u = await data.fileUrl(f.storage_path); if (u) window.open(u, '_blank', 'noopener'); else toast('הקובץ לא נפתח. נסו שוב.'); } }, 'פתיחת הקובץ') : null,
  ];
}
// What Metricool says about an entry, for the team: who set the state, and a failure.
function mcNote(e) {
  if (!e) return '';
  const parts = [];
  if (e.mc_extra) parts.push('הפריט הגיע מהתזמון ב־Metricool ולא מהתבנית');
  if (e.mc_status === 'error') parts.push(`הפרסום נכשל ב־Metricool${e.mc_error ? ` (${e.mc_error})` : ''}. כדאי לבדוק שם ולתזמן מחדש`);
  else if (e.source === 'metricool' && e.state !== 'planned') parts.push('המצב סומן לפי Metricool');
  else if (e.mc_post_id) parts.push('מקושר לפוסט ב־Metricool; המצב סומן ידנית ולכן לא משתנה לבד');
  if (e.mc_networks?.length) parts.push(e.mc_networks.join(', '));
  return parts.join(' · ');
}
function openEntry(e, day = null) {
  const isNew = !e;
  const kind = e?.kind || 'custom';
  $('ed-kind').textContent = isNew ? 'פריט חדש' : kindOf(e).label;
  $('ed-kind').setAttribute('style', kindStyle(kind));
  $('ed-h').textContent = isNew ? 'הוספת פריט לגאנט' : e.title;
  const foot = [];
  if (!canEdit) {
    $('ed-body').replaceChildren(...readOnlyEntry(e).flat().filter(Boolean));
    foot.push(h('button', { type: 'button', class: 'btn btn-ghost', onclick: () => dlg().close() }, 'סגירה'));
    $('ed-foot').replaceChildren(...foot);
    dlg().showModal();
    for (const img of $('ed-body').querySelectorAll('img[data-path]')) data.fileUrl(img.dataset.path).then((u) => { if (u) img.src = u; else img.remove(); });
    return;
  }
  const inp = (id, attrs) => h('input', { class: 'input', id, ...attrs });
  const title = inp('ed-title', { type: 'text', value: e?.title || '', maxlength: '200', required: true });
  const kindSel = isNew ? h('select', { class: 'input', id: 'ed-kindsel' }, ...KIND_ORDER.filter((k) => !['plan', 'renewal', 'end'].includes(k))
    .map((k) => h('option', { value: k, selected: k === 'custom' ? true : null }, GANTT_KINDS[k].label))) : null;
  const dayIn = inp('ed-day', { type: 'date', value: e?.day || day || shownDefaultDay(), required: true, min: dayKeyIL(new Date(client.deal_at)), max: contractEndKey(client) });
  const timeIn = inp('ed-time', { type: 'time', value: timeText(e?.time_il) || '', step: '60' });
  const st = e?.state || 'planned';
  // "שגיאה" is offered only while the entry is in it (Metricool reports it; nobody marks a failure by hand).
  const choices = [['planned', 'מתוכנן'], ['scheduled', 'תוזמן'], ['posted', 'עלה'], ...(st === 'error' ? [['error', 'שגיאה']] : []), ['skipped', 'בוטל']];
  const states = h('div', { class: 'gt-seg', role: 'radiogroup', 'aria-label': 'מצב' }, ...choices.map(([v, l]) => h('label', { class: 'gt-seg-opt' },
    h('input', { type: 'radio', name: 'ed-state', value: v, checked: v === st ? true : null, onchange: () => { $('ed-posted-wrap').hidden = v !== 'posted'; } }), h('span', {}, l))));
  const posted = inp('ed-posted', { type: 'date', value: e?.posted_on || todayKey() });
  const link = inp('ed-link', { type: 'url', dir: 'ltr', value: e?.link || '', placeholder: 'https://', inputmode: 'url' });
  const fileKinds = GANTT_KINDS[kind].files;
  const fileList = files ? [...files.values()].filter((f) => !fileKinds.length || fileKinds.includes(f.kind) || f.id === e?.file_id) : [];
  const fileSel = files ? h('select', { class: 'input', id: 'ed-file' }, h('option', { value: '' }, 'בלי קובץ'),
    ...fileList.map((f) => h('option', { value: f.id, selected: f.id === e?.file_id ? true : null }, `${fileTitle(f)}${f.posted_on ? ` · ${dm(f.posted_on)}` : ''}`))) : null;
  const note = h('textarea', { class: 'input', id: 'ed-note', rows: '2', maxlength: '500' }, e?.note || '');
  const meta = [];
  if (e && !isCustom(e)) meta.push(e.edited ? 'התאריך שונה ידנית: עדכון מהתבנית לא יזיז אותו בלי אישור.' : 'התאריך נקבע לפי התבנית.');
  if (mcNote(e)) meta.push(`${mcNote(e)}.`);
  if (e?.by_email && ui) meta.push(`עודכן לאחרונה: ${e.by_email === 'system' ? 'הסנכרון מ־Metricool' : ui.who(e.by_email)} · ${ui.formatStamp(e.at)}`);
  $('ed-body').replaceChildren(...[
    h('div', { class: 'gt-form' },
      kindSel ? field('סוג', kindSel) : null,
      field('כותרת', title),
      h('div', { class: 'gt-form-row' }, field('תאריך', dayIn), field('שעה', timeIn, 'ריק: כל היום')),
      h('fieldset', { class: 'gt-fs' }, h('legend', {}, 'מצב'), states,
        h('div', { id: 'ed-posted-wrap', hidden: st !== 'posted' }, field('עלה בתאריך', posted))),
      field('קישור לתוכן', link, 'למשל הקישור לפוסט או לסרטון. רק https.'),
      fileSel ? field('קובץ מהלקוח', fileSel, fileList.length ? null : 'אין עדיין קבצים מתאימים בתיקיית הלקוח.') : h('p', { class: 'hint' }, 'בחירת קובץ תתאפשר כשתיקיית הקבצים של הלקוח תהיה במערכת.'),
      field('הערה פנימית', note, 'לא מוצגת ללקוח.'),
      meta.length ? h('p', { class: 'gt-meta' }, meta.join(' ')) : null,
      h('p', { class: 'err', id: 'ed-err', role: 'alert', hidden: true })),
    e ? h('details', { class: 'gt-view-ro' }, h('summary', {}, 'איך זה נראה ללקוח'), ...readOnlyEntry(e).flat().filter(Boolean)) : null,
  ].filter(Boolean));
  foot.push(h('button', { type: 'button', class: 'btn btn-primary', id: 'ed-save', onclick: () => saveFromDialog(e) }, isNew ? 'הוספה' : 'שמירה'));
  // A row that came from Metricool leaves when its post leaves there; it is not deleted here.
  if (e && isCustom(e) && !e.mc_extra) foot.push(h('button', { type: 'button', class: 'btn btn-ghost danger', id: 'ed-del', onclick: () => deleteEntry(e) }, 'מחיקה'));
  foot.push(h('button', { type: 'button', class: 'btn btn-ghost', onclick: () => dlg().close() }, 'ביטול'));
  $('ed-foot').replaceChildren(...foot);
  dlg().showModal();
  title.focus();
}
function shownDefaultDay() {
  const t = todayKey();
  const m = `${shown.year}-${String(shown.month).padStart(2, '0')}`;
  return t.startsWith(m) ? t : `${m}-01`;
}
function fail(msg) { $('ed-err').textContent = msg; $('ed-err').hidden = false; }
async function saveFromDialog(e) {
  const title = $('ed-title').value.trim();
  const day = $('ed-day').value;
  const time = $('ed-time').value;
  const state = document.querySelector('input[name="ed-state"]:checked')?.value || 'planned';
  const link = $('ed-link').value.trim();
  const fileId = $('ed-file')?.value || null;
  const note = $('ed-note').value.trim();
  if (!title) return fail('חסרה כותרת.');
  if (!DAY_KEY.test(day)) return fail('חסר תאריך.');
  if (day < dayKeyIL(new Date(client.deal_at)) || day > contractEndKey(client)) return fail(`התאריך מחוץ לתקופת החוזה (${dmy(dayKeyIL(new Date(client.deal_at)))}–${dmy(contractEndKey(client))}).`);
  if (time && !TIME_KEY.test(time.slice(0, 5))) return fail('השעה לא תקינה.');
  if (link && !safeLink(link)) return fail('הקישור צריך להתחיל ב־https://');
  const fields = {
    title, day, time_il: time || null, state, posted_on: state === 'posted' ? $('ed-posted').value || null : null,
    link: link || null, note: note || null, month: Math.max(1, Math.min(termOf(client), packageMonthOf(client, day))),
  };
  if (files) fields.file_id = fileId || null;
  $('ed-save').disabled = true;
  try {
    if (!e) {
      const kind = $('ed-kindsel').value;
      const row = await data.addEntry({ client_id: client.id, key: `custom.${Date.now()}`, kind, edited: true, template_version: TEMPLATE_VERSION, ...fields });
      rows = [...rows, row];
      toast(`נוסף: ${row.title}`);
    } else {
      if (day !== e.day || (time || null) !== (timeText(e.time_il) || null)) fields.edited = true;
      const row = await data.saveEntry(e.id, fields);
      rows = rows.map((r) => (r.id === e.id ? row : r));
      toast(state === e.state ? `נשמר: ${row.title}` : state === 'posted' ? `סומן שעלה: ${row.title}` : state === 'scheduled' ? `סומן שתוזמן: ${row.title}` : `נשמר: ${row.title}`);
    }
    dlg().close();
    if (day.slice(0, 7) !== `${shown.year}-${String(shown.month).padStart(2, '0')}`) shown = { year: +day.slice(0, 4), month: +day.slice(5, 7) };
    render();
  } catch (err) {
    $('ed-save').disabled = false;
    fail(`לא נשמר. ${ui.errorText(err)}`);
  }
}
async function deleteEntry(e) {
  if (!window.confirm(`למחוק את ״${e.title}״ מהגאנט?`)) return;
  try {
    await data.removeEntry(e.id);
    rows = rows.filter((r) => r.id !== e.id);
    dlg().close();
    toast('נמחק.');
    render();
  } catch (err) { fail(`לא נמחק. ${ui.errorText(err)}`); }
}
// A chip dropped on another day: the same time, that day, "moved by hand".
async function moveEntry(id, day) {
  const e = rows.find((r) => r.id === id);
  if (!e || e.day === day) return;
  const before = { day: e.day, edited: e.edited, month: e.month };
  const apply = async (fields, msg) => {
    try {
      const row = await data.saveEntry(e.id, fields);
      rows = rows.map((r) => (r.id === e.id ? row : r));
      renderMonth(); renderGlance(); renderStats();
      if (msg) toast(msg, { label: 'ביטול', run: () => apply(before, 'ההזזה בוטלה.') });
    } catch (err) { toast(`לא הוזז. ${ui.errorText(err)}`); }
  };
  await apply({ day, edited: true, month: Math.max(1, Math.min(termOf(client), packageMonthOf(client, day))) }, `${e.title} הוזז ל${dayLine(day)}`);
}

// ── Marking by hand: one tap, and a whole day, week or month ──
// Until Metricool is connected (and for whatever it does not know) Ilai marks by hand.
const SET_TEXT = { planned: 'חזר ל״מתוכנן״', scheduled: 'סומן שתוזמן', posted: 'סומן שעלה' };
const redraw = () => { renderStats(); renderGlance(); renderMonth(); };
async function tapState(e) {
  const before = e.state;
  const set = async (state, msg, undo) => {
    try {
      const row = await data.saveEntry(e.id, { state });
      rows = rows.map((r) => (r.id === e.id ? row : r));
      redraw();
      toast(msg, undo ? { label: 'ביטול', run: () => set(before, `בוטל: ${e.title} חזר ל״${STATUS_TEXT[before]}״`, false) } : null);
      document.querySelector(`.gt-state-btn[data-key="${CSS.escape(e.key)}"]`)?.focus();
    } catch (err) { toast(`לא נשמר. ${ui.errorText(err)}`); }
  };
  const next = nextState(before);
  await set(next, `${SET_TEXT[next]}: ${e.title}`, true);
}
// The three ranges "סימון כתוזמנו" offers: the day chosen (or today), its week, the month shown.
function bulkRanges() {
  const m = `${shown.year}-${String(shown.month).padStart(2, '0')}`;
  const t = todayKey();
  const anchor = selectedDay || (t.startsWith(m) ? t : `${m}-01`);
  const week = weekOf(anchor);
  const days = monthGrid(shown.year, shown.month).flat().filter((d) => d.inMonth).map((d) => d.key);
  return [
    { id: 'day', label: selectedDay ? `היום שנבחר: ${dayLine(anchor)}` : anchor === t ? `היום: ${dayLine(anchor)}` : dayLine(anchor), from: anchor, to: anchor },
    { id: 'week', label: `השבוע של ${dm(week.from)}–${dm(week.to)}`, from: week.from, to: week.to },
    { id: 'month', label: `כל ${monthName(shown.year, shown.month)}`, from: days[0], to: days.at(-1) },
  ].map((r) => ({ ...r, list: toSchedule(rows, r.from, r.to) }));
}
function openBulk() {
  const n = (x) => (x === 1 ? 'פרסום אחד' : `${x} פרסומים`);
  $('bk-body').replaceChildren(
    h('p', { class: 'hint' }, 'מסמן ״תוזמן״ את הפרסומים שעדיין ״מתוכנן״ בטווח שנבחר. מה שכבר עלה, בוטל או תוזמן לא משתנה, ואפשר לבטל מיד אחרי הסימון.'),
    h('div', { class: 'gt-bulk-opts' }, ...bulkRanges().map((r) => h('button', {
      type: 'button', class: 'btn gt-bulk-opt', id: `bk-${r.id}`, disabled: r.list.length ? null : true,
      onclick: () => { $('bulk-dlg').close(); applyBulk(r); },
    }, h('span', {}, r.label), h('strong', { class: 'num' }, r.list.length ? n(r.list.length) : 'אין מה לסמן')))));
  $('bulk-dlg').showModal();
}
async function applyBulk(range) {
  const ids = range.list.map((e) => e.id);
  const put = async (state, msg, undo) => {
    try {
      const changed = await data.setStates(ids, state);
      const by = new Map(changed.map((r) => [r.id, r]));
      rows = rows.map((r) => by.get(r.id) || r);
      redraw();
      toast(msg(changed.length), undo ? { label: 'ביטול', run: () => put('planned', (k) => `בוטל: ${k} חזרו ל״מתוכנן״`, false) } : null);
    } catch (err) { toast(`לא נשמר. ${ui.errorText(err)}`); }
  };
  await put('scheduled', (k) => (k === 1 ? 'פרסום אחד סומן ״תוזמן״' : `${k} פרסומים סומנו ״תוזמן״`), true);
}

// ── Update from the template ──────────────
async function regenerate() {
  const plan = generatePlan(client);
  if (plan.error) { toast('חסר תאריך החתימה בכרטיס הלקוח.'); return; }
  const diff = planDiff(rows, plan.entries);
  if (!rows.length) return applyRegen(plan, false);
  const n = (x, one, many) => (x === 1 ? one : `${x} ${many}`);
  const lines = [];
  if (diff.insert.length) lines.push(`יתווספו ${n(diff.insert.length, 'פריט אחד', 'פריטים')}.`);
  if (diff.update.length) lines.push(`יתעדכנו ${n(diff.update.length, 'פריט אחד', 'פריטים')} לפי התבנית.`);
  if (diff.remove.length) lines.push(`יוסרו ${n(diff.remove.length, 'פריט אחד', 'פריטים')} שהתבנית כבר לא יוצרת ולא נעשה בהם דבר.`);
  if (diff.orphans.length) lines.push(`${n(diff.orphans.length, 'פריט אחד', 'פריטים')} שהתבנית כבר לא יוצרת יישארו, כי כבר עלו או שיש בהם קישור או הערה.`);
  if (!lines.length && !diff.keptEdited.length) { toast('הגאנט כבר תואם לתבנית.'); return; }
  const body = [h('ul', { class: 'gt-regen-list' }, ...(lines.length ? lines : ['אין שינוי מהתבנית בפריטים שלא הוזזו.']).map((l) => h('li', {}, l)))];
  if (diff.keptEdited.length) {
    body.push(h('p', {}, `${n(diff.keptEdited.length, 'פריט אחד הוזז', 'פריטים הוזזו')} ידנית, והם יישארו בתאריך שנבחר.`),
      h('label', { class: 'gt-check' }, h('input', { type: 'checkbox', id: 'rg-overwrite' }), h('span', {}, `להחזיר גם אותם לתאריך שבתבנית (${diff.keptEdited.slice(0, 3).map((r) => r.title).join(', ')}${diff.keptEdited.length > 3 ? '…' : ''})`)));
  }
  body.push(h('p', { class: 'hint' }, 'מה שעלה, קישורים, קבצים והערות לא משתנים.'));
  $('rg-body').replaceChildren(...body);
  $('rg-go').onclick = () => { const o = !!$('rg-overwrite')?.checked; $('regen-dlg').close(); applyRegen(plan, o); };
  $('regen-dlg').showModal();
}
async function applyRegen(plan, overwrite) {
  const diff = planDiff(rows, plan.entries, { overwrite });
  $('state').textContent = 'מעדכן…';
  try {
    await data.applyPlan(client.id, diff, rows, TEMPLATE_VERSION);
    rows = (await data.loadGantt(client.id)) || [];
    if (share === undefined) share = await data.loadShare(client.id).catch(() => undefined);
    toast(diff.insert.length && diff.insert.length === plan.entries.length ? `הגאנט נוצר: ${plan.entries.length} פריטים.` : 'הגאנט עודכן מהתבנית.');
  } catch (err) {
    toast(`לא עודכן. ${ui.errorText(err)}`);
  }
  $('state').textContent = '';
  if (!shown) pickMonth();
  render();
}

// ── The client's link ─────────────────────
function renderShare() {
  const body = [];
  // The link is the one thing Irit, Lior and Ofir do here: for them it is the pink action.
  // For Ilai and the owner the pink one is "סימון כתוזמנו", so this stays plain.
  const main = canEdit ? 'btn' : 'btn btn-primary';
  if (share === undefined) body.push(h('p', { class: 'hint' }, 'הקישור יהיה זמין אחרי שהמיגרציה של הגאנט תוחל.'));
  else if (!share) body.push(h('button', { type: 'button', class: main, id: 'gs-create', onclick: () => makeShare() }, 'יצירת קישור ללקוח'));
  else {
    const url = share.token ? data.shareUrl(share.token) : null;
    body.push(url ? h('div', { class: 'gt-share-row' },
      h('input', { class: 'input', id: 'gs-url', readonly: true, dir: 'ltr', value: url, 'aria-label': 'הקישור ללקוח', onfocus: (ev) => ev.target.select() }),
      h('button', { type: 'button', class: main, id: 'gs-copy', onclick: () => copy(url) }, 'העתקה'),
      h('a', { class: 'btn btn-ghost', href: url, target: '_blank', rel: 'noopener', id: 'gs-open' }, 'תצוגה מקדימה')) : h('p', { class: 'hint' }, 'הקישור קיים, אבל אי אפשר להציג אותו שוב. אפשר ליצור קישור חדש.'),
    h('p', { class: 'hint' }, `בתוקף עד ${ui.formatDay(dayKeyIL(new Date(share.expires_at)))}.`),
    h('div', { class: 'gt-share-acts' },
      h('button', { type: 'button', class: 'btn-text', onclick: () => { if (window.confirm('קישור חדש מבטל את הקודם. להמשיך?')) makeShare(); } }, 'קישור חדש'),
      h('button', { type: 'button', class: 'btn-text danger', onclick: () => killShare() }, 'ביטול הקישור')));
  }
  $('gs-body').replaceChildren(...body);
}
async function makeShare() {
  try { share = await data.createShare(client.id); toast('נוצר קישור ללקוח.'); } catch (err) { toast(`הקישור לא נוצר. ${ui.errorText(err)}`); }
  renderShare();
}
async function killShare() {
  if (!window.confirm('לבטל את הקישור? הלקוח לא יוכל לפתוח אותו יותר.')) return;
  try { await data.revokeShare(share.id); share = null; toast('הקישור בוטל.'); } catch (err) { toast(`לא בוטל. ${ui.errorText(err)}`); }
  renderShare();
}
async function copy(text) {
  try { await navigator.clipboard.writeText(text); toast('הקישור הועתק.'); } catch { $('gs-url').select(); toast('סמנו והעתיקו את הקישור.'); }
}

function renderRules() {
  $('gt-rules-list').replaceChildren(...TEMPLATE_TEXT.map((t) => h('li', {}, t)),
    h('li', {}, `גרסת התבנית: ${TEMPLATE_VERSION}. ההגדרה עצמה: app/gantt-template.js.`));
}

// ── Print ─────────────────────────────────
function printMonth() { window.print(); }
window.addEventListener('beforeprint', () => { if (!shown) return; viewBeforePrint = view || 'grid'; view = 'grid'; renderMonth(); });
window.addEventListener('afterprint', () => { if (viewBeforePrint) { view = viewBeforePrint; viewBeforePrint = null; renderMonth(); } });

// ── Controls ──────────────────────────────
function step(d) {
  const months = calendarMonths(client);
  const i = months.findIndex((m) => m.year === shown.year && m.month === shown.month);
  const next = months[i + d];
  if (next) glide(() => { shown = { year: next.year, month: next.month }; selectedDay = null; renderMonth(); });
}
$('gm-prev').addEventListener('click', () => step(-1));
$('gm-next').addEventListener('click', () => step(1));
$('view-grid').addEventListener('click', () => { view = 'grid'; renderMonth(); });
$('view-list').addEventListener('click', () => { view = 'list'; selectedDay = null; renderMonth(); });
$('ed-close').addEventListener('click', () => dlg().close());
$('rg-close').addEventListener('click', () => $('regen-dlg').close());
$('rg-cancel').addEventListener('click', () => $('regen-dlg').close());
$('btn-bulk').addEventListener('click', openBulk);
$('bk-close').addEventListener('click', () => $('bulk-dlg').close());
$('bk-cancel').addEventListener('click', () => $('bulk-dlg').close());
$('bd-close').addEventListener('click', () => $('brand-dlg').close());
for (const d of [dlg(), $('regen-dlg'), $('bulk-dlg'), $('brand-dlg')]) d.addEventListener('click', (ev) => { if (ev.target === d) d.close(); });

boot();

