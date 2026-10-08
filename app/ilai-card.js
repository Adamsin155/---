// Ilai's part of "המשימות שלי" (system-plan section 3, "עילאי"), drawn by
// app/clients.js: the card "יום אפיון: שעתיים" when a characterization ends (one
// line per client with only the nearest due; opening it shows the access check,
// whose vault statuses mark it by themselves, the page setup in 6 quick checks and
// the Metricool link, the 9 graphics with "מוכן לבדיקה" to Irit, the Gantt skeleton
// and a new logo); and after that day: the rest of the graphics ("מוכן לבדיקה" to
// Ofir, and his returned fixes), "קיבלתי" on the editor's final versions (it closes
// the editing), and "הגאנט מלא" (Irit is told by itself). The logic: app/ilai-logic.js.
// Package 1 (docs/ops.md, section 37): the graphics are uploaded in these cards, into
// the client's files, and "מוכן לבדיקה" opens only once a graphic of that batch is up
// (the first 9 keep a card of their own after the day's card is gone); each graphics
// card opens the client's characterization, read-only; the final versions card opens
// the videos' Drive folder (the videos stay in Drive: the owner's decision of 7.10.2026).
import { setCheck, clearCheck, setChecksBulk, updateClient, canUseVault } from './protocol-data.js';
import { clientLabel } from './protocol-logic.js';
import { h, toast, errorText, formatWhen, landingTag } from './protocol-ui.js';
import { offerHandoff } from './handoff-ui.js';
import { loadAccessStatusForWork } from './office-data.js';
import { charDay, ilaiWork, PAGE_KEYS, PAGE_LABELS, GANTT_KEYS, AUTO_ACCESS_NOTE } from './ilai-logic.js';
import { fixList } from './office-ui.js';
import { ACCESS_STATUS_LABEL, NEW_STATUS } from './access-logic.js';
import { supabase } from './supa.js';
import { mountWorkFiles, workFilesState } from './files-ui.js';
import { graphicsWindow, videoWindow, uploadGate, videosLinkOf } from './files-logic.js';
import { charViewHref } from './intake-ui.js';

const NETWORK = { instagram: 'Instagram', facebook: 'Facebook', tiktok: 'TikTok', youtube: 'YouTube', google: 'Google Business', meta: 'Meta Business', other: 'אחר' };
// The vault's statuses in words, with 'new' (from the client's form, not checked yet).
const STATUS = ACCESS_STATUS_LABEL;
const ganttUrl = (id) => `gantt.html?id=${encodeURIComponent(id)}`;
const clientUrl = (id, hash = '') => `client.html?id=${encodeURIComponent(id)}${hash ? `#${hash}` : ''}`;
const isDone = (cs, k) => ['done', 'na'].includes(cs[k]?.state);

// The logins of the day's clients: statuses only (network, label, status), which the
// office reads without the vault flag; kept a minute. Whether this person may open
// the passwords themselves (staff.vault, the owner's switch on the team page) is
// asked once: without it the card says so instead of sending them to the vault.
let access = {};
let vault = null; // null until known
let viaVault = false; // the statuses came from the vault's own rows (before the migration)
let accessAt = 0;
let accessFor = '';
let loading = null;
const autoTried = new Set();
// Cards stay open across the page's re-renders.
const openCards = new Set();

// ── The graphics, uploaded here ─────────────
const GFX = 'deliverable_graphic';
const GFX_HELP = 'אם זה חוזר, לדווח לעירית ולליאור. לא מסמנים ״מוכן לבדיקה״ בלי הקבצים במערכת.';
// Who is signed in (to offer "מחיקה" on their own uploads); asked once.
let myEmail = '';
let asked = false;
function whoAmI(ctx) {
  if (asked) return;
  asked = true;
  supabase.auth.getSession().then(({ data }) => { myEmail = String(data?.session?.user?.email || '').toLowerCase(); if (myEmail) ctx.refresh?.(); }).catch(() => {});
}
const restTotal = (c) => Math.max(0, (Number(c.deliverables?.graphics) || 0) - 9) || null;
function gfxGate(c, cs, batch) {
  const state = workFilesState(c.id);
  return uploadGate({ files: state.files, kind: GFX, window: graphicsWindow(cs, batch), state, none: 'נפתח אחרי שמעלים כאן לפחות גרפיקה אחת.' });
}
const gfxFiles = (ctx, c, cs, batch, idp) => mountWorkFiles({
  client: c, kind: GFX, window: graphicsWindow(cs, batch), me: ctx.viewer?.error ? undefined : ctx.me, myEmail, idp, toast,
  title: batch === 'first' ? '9 הגרפיקות הראשונות' : 'יתרת הגרפיקות', total: batch === 'first' ? 9 : restTotal(c),
  failHelp: GFX_HELP, onChange: ctx.refresh,
});
// "מוכן לבדיקה", locked (with why) until a graphic of the batch is up.
function readyButton(id, label, gate, onclick) {
  return [h('div', { class: 'of-acts' }, h('button', { type: 'button', class: 'btn btn-sm', id, disabled: !gate.ok, 'aria-describedby': gate.ok ? null : `${id}-lock`, onclick }, label)),
    gate.ok ? null : h('p', { class: 'hint fl-lock', id: `${id}-lock` }, gate.reason)];
}
// What the graphics are made from: the characterization, read-only (intake.html).
const charLink = (c) => h('a', { class: 'btn btn-sm btn-ghost il-char', href: charViewHref(c.id) }, 'האפיון של הלקוח', h('span', { class: 'sr-only' }, `: ${c.name}`));

// Groups of "המשימות שלי" that the cards already cover (client and process), so
// nothing is listed twice: the day's processes (his new logo in 5, 6, 7, 9), the
// rest of the graphics (23), the final versions (27) and the Gantt (29).
export function coveredByCard(ctx) {
  const set = new Set();
  for (const x of charDay({ ...ctx, now: new Date() })) for (const p of ['p05', 'p06', 'p07', 'p09']) set.add(`${x.client.id}:${p}`);
  const work = ilaiWork(ctx);
  for (const x of [...work.first, ...work.rest]) set.add(`${x.client.id}:${x.state.proc.id}`);
  for (const x of [...work.finals, ...work.gantt]) set.add(`${x.client.id}:${x.state.proc.id}`);
  return (g) => !g.task && set.has(`${g.client.id}:${g.proc.id}`);
}

// ctx: { clients, checks (all, by client), stateOf, me, viewer, refresh }
export function ilaiSection(ctx) {
  const day = charDay({ ...ctx, access, now: new Date() });
  const work = ilaiWork(ctx);
  whoAmI(ctx);
  ensureAccess(day.map((x) => x.client.id), ctx);
  for (const x of day) autoAccess(x, ctx);
  const cards = [
    ...day.map((x) => dayCard(x, ctx)),
    ...work.first.map((x) => firstCard(x, ctx)),
    ...work.rest.map((x) => restCard(x, ctx)),
    ...work.finals.map((x) => finalCard(x, ctx)),
    ...work.gantt.map((x) => ganttCard(x, ctx)),
  ];
  if (!cards.length) return null;
  const title = day.length ? 'יום אפיון: שעתיים' : 'גרפיקות, גאנט וגרסאות סופיות';
  return h('section', { class: 'wgroup g-ilai', 'aria-labelledby': 'il-h' },
    h('h2', { class: 'wgroup-h', id: 'il-h' }, title, h('span', { class: 'n' }, String(cards.length))),
    h('ul', { class: 'wprocs il-list' }, ...cards));
}

function ensureAccess(ids, ctx) {
  const key = ids.slice().sort().join(',');
  if (!ids.length || loading || (key === accessFor && Date.now() - accessAt < 60e3)) return;
  if (vault === null) canUseVault().then((v) => { vault = v; if (!v) ctx.refresh?.(); }).catch(() => {});
  loading = loadAccessStatusForWork(ids).then((rows) => {
    access = {};
    viaVault = !!rows.viaVault;
    for (const r of rows) (access[r.client_id] ||= []).push(r);
    accessAt = Date.now();
    accessFor = key;
  }).catch(() => { accessAt = Date.now(); accessFor = key; }).finally(() => { loading = null; ctx.refresh?.(); });
}

// The statuses in the vault check the access by themselves (once per client and page).
async function autoAccess(x, ctx) {
  const line = x.lines.find((l) => l.key === 'access');
  const cs = ctx.checks[x.client.id] || {};
  if (!line?.auto || isDone(cs, 'p06.verified') || autoTried.has(x.client.id)) return;
  autoTried.add(x.client.id);
  try {
    const row = await setCheck(x.client.id, 'p06.verified', 'done', AUTO_ACCESS_NOTE);
    (ctx.checks[x.client.id] ||= {})[row.item_key] = row;
    toast(`הגישות של ${x.client.name} סומנו כנבדקו, לפי הסטטוסים בכספת.`);
    ctx.refresh?.();
  } catch { /* the check stays for Ilai to mark */ }
}

async function mark(ctx, c, keys, state, doneText, { handoff = null } = {}) {
  const cs = (ctx.checks[c.id] ||= {});
  try {
    if (state) {
      const rows = keys.length === 1 ? [await setCheck(c.id, keys[0], 'done')] : await setChecksBulk(c.id, keys, 'done');
      for (const r of rows) cs[r.item_key] = r;
    } else {
      for (const k of keys) { await clearCheck(c.id, k); delete cs[k]; }
    }
  } catch (err) {
    toast(`הסימון לא נשמר. ${errorText(err)}`);
    ctx.refresh?.();
    return false;
  }
  if (doneText) toast(doneText);
  ctx.refresh?.();
  if (handoff && state) offerHandoff({ client: c, key: handoff, checks: () => ctx.checks[c.id], me: ctx.me });
  return true;
}

const check = (ctx, c, key, label, idp) => {
  const cs = ctx.checks[c.id] || {};
  const id = `${idp}-${key.replace(/\W/g, '_')}`;
  return h('label', { class: 'wrow', for: id },
    h('input', { type: 'checkbox', class: 'cbx fin', id, checked: isDone(cs, key), onchange: (e) => mark(ctx, c, [key], e.currentTarget.checked, null) }),
    h('span', { class: 'wlabel' }, label));
};
const until = (d, now = new Date()) => (d ? h('span', { class: `muted${d < now ? ' late' : ''}` }, ` · עד ${formatWhen(d, now)}`) : null);

function dayCard(x, ctx) {
  const c = x.client;
  const cs = ctx.checks[c.id] || {};
  const idp = `il-${c.id}`;
  const now = new Date();
  const line = (key) => x.lines.find((l) => l.key === key);
  const rows = access[c.id] || [];
  const acc = line('access');
  const page = line('page');
  const gfx = line('graphics');
  const gantt = line('gantt');
  const logo = line('logo');
  return h('li', { class: 'wproc il-card', 'data-key': `il:${c.id}` },
    h('details', {
      id: `${idp}-d`, open: openCards.has(c.id),
      ontoggle: (e) => { if (e.currentTarget.open) openCards.add(c.id); else openCards.delete(c.id); },
    },
      h('summary', { id: `${idp}-s` },
        h('strong', {}, clientLabel(c)),
        h('span', {}, `הבא: ${x.next.title}`), until(x.next.due, now),
        h('span', { class: 'muted small' }, `${x.lines.filter((l) => l.done).length} מתוך ${x.lines.length}`)),
      h('div', { class: 'il-part' },
        h('h4', {}, 'בדיקת גישות (30 דק׳)', acc.done ? null : until(acc.due, now), acc.done ? h('span', { class: 'sbadge s-done' }, h('span', { class: 'sicon', 'aria-hidden': 'true' }), 'נבדק') : null),
        acc.waiting ? h('p', { class: 'hint' }, 'מחכה לגישות מהאפיון.') : [
          rows.length ? h('ul', { class: 'il-net' }, ...rows.map((a) => h('li', { class: 'tag' }, `${NETWORK[a.network] || a.network}${a.label ? ` (${a.label})` : ''}: ${STATUS[a.status] || a.status}`)))
            : vault === false && viaVault ? null : h('p', { class: 'hint' }, 'אין עדיין רשתות בכספת.'),
          rows.some((a) => a.status === NEW_STATUS)
            ? h('p', { class: 'hint il-fromclient' }, 'יש גישות שהלקוח מילא בעצמו ועוד לא נבדקו: מנסים להיכנס, ומעדכנים בכספת ״תקינה״ או ״לא עובדת״.')
            : null,
          h('p', { class: 'hint' }, 'הסטטוס של כל רשת בכספת מסמן את הבדיקה לבד. אין עמוד? פותחים אותו באותו חלון זמן.'),
          vault === false
            ? h('p', { class: 'hint il-novault' }, 'אין לך גישה לסיסמאות בכספת. בעל המשרד מפעיל אותה בעמוד הצוות.')
            : h('div', { class: 'of-acts' }, h('a', { class: 'btn btn-sm', href: clientUrl(c.id, 'access') }, 'לכספת', h('span', { class: 'sr-only' }, ` של ${c.name}`))),
          acc.done ? null : check(ctx, c, 'p06.verified', 'כל הגישות נבדקו ועובדות', idp),
        ]),
      h('div', { class: 'il-part' },
        h('h4', {}, `סידור העמוד (${page.count}/6)`, page.done ? null : until(page.due, now)),
        h('div', { class: 'il-checks' }, ...PAGE_KEYS.map((k) => check(ctx, c, k, PAGE_LABELS[k], idp))),
        isDone(cs, 'p06.metricool') ? h('p', { class: 'ps-seen' }, 'Metricool מחובר') : h('form', {
          class: 'dc-inline', novalidate: true, onsubmit: (e) => saveMetricool(e, ctx, c, `${idp}-mc`),
        },
        h('div', { class: 'field grow' }, h('label', { for: `${idp}-mc` }, 'קישור Metricool'),
          h('input', { class: 'input', id: `${idp}-mc`, type: 'url', inputmode: 'url', dir: 'ltr', placeholder: 'https://app.metricool.com/…', value: drafts.get(`${idp}-mc`) ?? (c.links?.metricool || ''), oninput: (e) => drafts.set(`${idp}-mc`, e.currentTarget.value) })),
        h('button', { type: 'submit', class: 'btn btn-sm' }, 'שמירה'))),
      h('div', { class: 'il-part' },
        h('h4', {}, '9 גרפיקות', gfx.done ? null : until(gfx.due, now)),
        h('div', { class: 'of-acts' }, charLink(c)),
        gfxFiles(ctx, c, cs, 'first', `${idp}-g9`),
        gfx.done ? h('p', { class: 'ps-seen' }, 'נשלחו לבדיקה של עירית')
          : readyButton(`${idp}-gfx`, 'מוכן לבדיקה (לעירית)', gfxGate(c, cs, 'first'),
            (e) => { e.currentTarget.disabled = true; mark(ctx, c, ['p07.made'], true, '9 הגרפיקות עברו לבדיקה של עירית.', { handoff: 'p07.made' }); })),
      h('div', { class: 'il-part' },
        h('h4', {}, 'שלד גאנט', gantt.done ? null : until(gantt.due, now)),
        h('label', { class: 'wrow', for: `${idp}-gantt` },
          h('input', { type: 'checkbox', class: 'cbx fin', id: `${idp}-gantt`, checked: gantt.done, onchange: (e) => mark(ctx, c, GANTT_KEYS, e.currentTarget.checked, e.currentTarget.checked ? 'שלד הגאנט סומן.' : null) }),
          h('span', { class: 'wlabel' }, 'גאנט התוכן נפתח במערכת, עם כל העמודות')),
        h('div', { class: 'of-acts' }, h('a', { class: 'btn btn-sm btn-ghost gantt-go', href: ganttUrl(c.id) }, 'גאנט התוכן', h('span', { class: 'sr-only' }, ` של ${c.name}`)))),
      logo ? h('div', { class: 'il-part' }, h('h4', {}, 'לוגו חדש', logo.done ? null : until(logo.due, now)), check(ctx, c, 'p05.newlogo', 'הכנתי לוגו חדש (אין ללקוח לוגו)', idp)) : null));
}

// What is typed in a link field and not saved yet: the list is rebuilt after every mark,
// and a rebuild must not wipe a link someone is in the middle of typing.
const drafts = new Map();

async function saveMetricool(e, ctx, c, inputId) {
  e.preventDefault();
  const el = document.getElementById(inputId);
  const v = el.value.trim();
  let ok = false;
  try {
    const u = new URL(v);
    ok = u.protocol === 'https:' && !u.username && !u.password && (u.hostname === 'metricool.com' || u.hostname.endsWith('.metricool.com'));
  } catch { ok = false; }
  if (!ok) { el.setAttribute('aria-invalid', 'true'); toast('הדביקו קישור של Metricool (https://…metricool.com/…).'); el.focus(); return; }
  el.removeAttribute('aria-invalid');
  try {
    const updated = await updateClient(c.id, { links: { ...(c.links || {}), metricool: v } });
    Object.assign(c, updated);
  } catch (err) { toast(`הקישור לא נשמר. ${errorText(err)}`); return; }
  drafts.delete(inputId);
  await mark(ctx, c, ['p06.metricool'], true, 'הקישור נשמר, ו־Metricool סומן כמחובר.');
}

// The first 9 graphics after the characterization day (its card is gone): the same
// upload and the same lock.
function firstCard(x, ctx) {
  const c = x.client;
  const cs = ctx.checks[c.id] || {};
  const idp = `il-9-${c.id}`;
  return h('li', { class: 'wproc il-card', 'data-key': `il-first:${c.id}` },
    h('div', { class: 'wproc-h' }, h('a', { class: 'wclient', href: clientUrl(c.id, 'p07') }, clientLabel(c)), landingTag(c), h('span', { class: 'il-title' }, '9 גרפיקות ראשונות'), until(x.state.dueAt)),
    h('div', { class: 'of-acts' }, charLink(c)),
    gfxFiles(ctx, c, cs, 'first', `${idp}-g`),
    readyButton(`${idp}-ready`, 'מוכן לבדיקה (לעירית)', gfxGate(c, cs, 'first'),
      (e) => { e.currentTarget.disabled = true; mark(ctx, c, ['p07.made'], true, '9 הגרפיקות עברו לבדיקה של עירית.', { handoff: 'p07.made' }); }));
}

function restCard(x, ctx) {
  const c = x.client;
  const cs = ctx.checks[c.id] || {};
  const idp = `il-r-${c.id}`;
  return h('li', { class: 'wproc il-card', 'data-key': `il-rest:${c.id}` },
    h('div', { class: 'wproc-h' }, h('a', { class: 'wclient', href: clientUrl(c.id, 'p23') }, clientLabel(c)), landingTag(c), h('span', { class: 'il-title' }, 'יתרת הגרפיקות'), until(x.state.dueAt)),
    h('div', { class: 'of-acts' }, charLink(c)),
    gfxFiles(ctx, c, cs, 'rest', `${idp}-g`),
    x.qa.stage === 'fixing'
      ? fixList({ client: c, checks: cs, kind: 'graphics', pre: '', fixer: 'ilai', me: ctx.me, viewer: ctx.viewer, onChange: ctx.refresh })
      : readyButton(`${idp}-ready`, 'מוכן לבדיקה (לאופיר)', gfxGate(c, cs, 'rest'),
        (e) => { e.currentTarget.disabled = true; mark(ctx, c, ['p23.made'], true, 'יתרת הגרפיקות עברה לבדיקה של אופיר (יעד: שעה).', { handoff: 'p23.made' }); }));
}

function finalDrive(c, cs, x) {
  const link = videosLinkOf(c, cs, x.pre);
  return link
    ? h('div', { class: 'of-acts' }, h('a', { class: 'btn btn-sm il-drive', href: link, target: '_blank', rel: 'noopener noreferrer' }, 'פתיחת הסרטונים בדרייב', h('span', { class: 'sr-only' }, ` של ${c.name} (נפתח בחלון חדש)`)))
    : h('p', { class: 'hint il-nodrive' }, 'אין קישור לסרטונים בדרייב. לבקש מהעורך.');
}

function finalCard(x, ctx) {
  const c = x.client;
  const key = `${x.pre}p27.toilai`;
  return h('li', { class: 'wproc il-card', 'data-key': `il-final:${c.id}:${x.pre}` },
    h('div', { class: 'wproc-h' }, h('a', { class: 'wclient', href: clientUrl(c.id, x.state.proc.id) }, clientLabel(c)), landingTag(c),
      h('span', { class: 'il-title' }, `גרסאות סופיות בדרייב${x.n ? ` · סבב ${x.n}` : ''}`), h('span', { class: 'muted' }, ` · מ־${formatWhen(x.at)}`)),
    // Where they are: the client's Drive (the editor's link); any uploaded into the system are listed.
    finalDrive(c, ctx.checks[c.id] || {}, x),
    mountWorkFiles({
      client: c, kind: 'deliverable_video', window: videoWindow(c, ctx.checks[c.id] || {}, x.n || 1), me: ctx.viewer?.error ? undefined : ctx.me, readOnly: true, hideEmpty: true,
      idp: `il-f-${c.id}-${x.pre.replace(/\W/g, '')}-v`, title: 'סרטונים שהועלו למערכת', total: null, toast, onChange: ctx.refresh,
    }),
    h('p', { class: 'task-meta' }, '״קיבלתי״ סוגר את משימת העריכה, ומתחילות השעתיים לתזמון ולגאנט.'),
    h('div', { class: 'of-acts' }, h('button', {
      type: 'button', class: 'btn btn-sm', id: `il-f-${c.id}-${x.pre.replace(/\W/g, '')}`,
      onclick: (e) => { e.currentTarget.disabled = true; mark(ctx, c, [key], true, 'קיבלת את הגרסאות הסופיות. העריכה נסגרה.'); },
    }, 'קיבלתי')));
}

function ganttCard(x, ctx) {
  const c = x.client;
  const key = `${x.pre}p29.filled`;
  return h('li', { class: 'wproc il-card', 'data-key': `il-gantt:${c.id}:${x.pre}` },
    h('div', { class: 'wproc-h' }, h('a', { class: 'wclient', href: clientUrl(c.id, x.state.proc.id) }, clientLabel(c)), landingTag(c),
      h('span', { class: 'il-title' }, `גאנט${x.n ? ` · סבב ${x.n}` : ''}`), until(x.state.dueAt)),
    h('div', { class: 'of-acts' }, h('a', { class: 'btn btn-sm btn-ghost gantt-go', href: ganttUrl(c.id) }, 'פתיחת גאנט התוכן', h('span', { class: 'sr-only' }, ` של ${c.name}`)), h('button', {
      type: 'button', class: 'btn btn-sm', id: `il-g-${c.id}-${x.pre.replace(/\W/g, '')}`,
      onclick: (e) => { e.currentTarget.disabled = true; mark(ctx, c, [key], true, 'הגאנט מלא. עירית מקבלת ״לשלוח גאנט״.', { handoff: key }); },
    }, 'הגאנט מלא')));
}
