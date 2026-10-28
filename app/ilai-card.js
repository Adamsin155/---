// Ilai's part of "המשימות שלי" (system-plan section 3, "עילאי"), drawn by
// app/clients.js: the card "יום אפיון: שעתיים" when a characterization ends (one
// line per client with only the nearest due; opening it shows the 9 graphics with
// "מוכן לבדיקה" to Ofir, the Gantt skeleton and a new logo; the access check and the
// page setup left it on 28.10.2026: process 6 is Ofir's, app/access-check-ui.js); and
// after that day: the rest of the graphics ("מוכן לבדיקה" to Ofir, and his returned fixes), "קיבלתי" on the editor's final versions (it closes
// the editing), and "הגאנט מלא" (Irit is told by itself). The logic: app/ilai-logic.js.
// Package 1 (docs/ops.md, section 37): the graphics are uploaded in these cards, into
// the client's files, and "מוכן לבדיקה" opens only once a graphic of that batch is up
// (the first 9 keep a card of their own after the day's card is gone); each graphics
// card opens the client's characterization, read-only; the final versions card opens
// the videos' Drive folder (the videos stay in Drive: the owner's decision of 7.10.2026).
import { setCheck, clearCheck, setChecksBulk } from './protocol-data.js';
import { clientLabel } from './protocol-logic.js';
import { h, toast, errorText, formatWhen, landingTag } from './protocol-ui.js';
import { offerHandoff } from './handoff-ui.js';
import { charDay, ilaiWork, GANTT_KEYS } from './ilai-logic.js';
import { fixList } from './office-ui.js';
import { supabase } from './supa.js';
import { mountWorkFiles, workFilesState } from './files-ui.js';
import { graphicsWindow, videoWindow, uploadGate, videosLinkOf } from './files-logic.js';
import { checkMark, guardVerdict } from './mark-guards.js';
import { charViewHref } from './intake-ui.js';
import { qaState } from './office-marks.js';
import { fastCaseOf, ladderWords } from './fast-ladder.js';
// The look of the cards (docs/ops.md, sections 50 and 54): an icon square per kind of card,
// a filled navy button for the card's one action, a quiet line for why it is locked.
import { iconSquare, icon, leadIcon } from './kit.js';
const LANDING_WORDS = 'בקליטה, בלי שעון'; // as LANDING_WORDS in app/mine-flow.js

const ganttUrl = (id) => `gantt.html?id=${encodeURIComponent(id)}`;
const clientUrl = (id, hash = '') => `client.html?id=${encodeURIComponent(id)}${hash ? `#${hash}` : ''}`;
const isDone = (cs, k) => ['done', 'na'].includes(cs[k]?.state);

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
  return [h('div', { class: 'of-acts il-go' }, h('button', { type: 'button', class: 'btn btn-sm k-btn-navy il-ready', id, disabled: !gate.ok, 'aria-describedby': gate.ok ? null : `${id}-lock`, onclick }, label)),
    gate.ok ? null : h('p', { class: 'hint fl-lock il-lock', id: `${id}-lock` }, icon('lock', { size: 16 }), h('span', {}, gate.reason))];
}
// What stands under a batch of graphics, by where it is (protocol v9: Ofir checks both
// batches): the button that hands it to him, the list of what he returned, or, while it
// is with him, one line that says so and how long he has (app/fast-ladder.js).
const BATCH = {
  first: { kind: 'graphics9', key: 'p07.made', proc: 'p07', sent: '9 הגרפיקות עברו לבדיקה של אופיר.' },
  rest: { kind: 'graphics', key: 'p23.made', proc: 'p23', sent: 'יתרת הגרפיקות עברה לבדיקה של אופיר.' },
};
function withOfirLine(ctx, c, cs, batch, id) {
  const st = ctx.stateOf(c).states;
  const s = st.find((x) => x.proc.id === BATCH[batch].proc);
  const fast = s ? fastCaseOf(c, s, st, cs) : null;
  return h('p', { class: 'ps-seen il-with-ofir', id }, fast ? ladderWords(fast, new Date(), { waiting: true }) : 'אצל אופיר לבדיקה');
}
function gfxStep(ctx, c, cs, batch, btnId) {
  const b = BATCH[batch];
  const q = qaState(cs, '', b.kind);
  if (q.stage === 'fixing') return fixList({ client: c, checks: cs, kind: b.kind, pre: '', fixer: 'ilai', me: ctx.me, viewer: ctx.viewer, onChange: ctx.refresh });
  if (q.stage === 'ofir') return withOfirLine(ctx, c, cs, batch, `${btnId}-with`);
  if (q.stage === 'approved') return h('p', { class: 'ps-seen' }, 'אופיר אישר');
  if (isDone(cs, b.key)) return h('p', { class: 'ps-seen' }, 'נמסרו לבדיקה');
  // Nothing up yet: no locked button and no lock line (the owner, 20.10.2026); the button
  // appears with the first graphic of the batch.
  if (!gfxGate(c, cs, batch).ok) return null;
  return readyButton(btnId, 'מוכן לבדיקה (לאופיר)', gfxGate(c, cs, batch),
    (e) => {
      // Fewer up than the package holds: asked, never refused (protocol v8).
      const ask = batch === 'rest' ? guardVerdict('graphicsCount', { count: gfxGate(c, cs, 'rest').count, total: restTotal(c) })?.ask : null;
      if (ask && !window.confirm(ask)) return;
      e.currentTarget.disabled = true;
      mark(ctx, c, [b.key], true, b.sent, { handoff: b.key });
    });
}
// The head of a card: the square of its kind, the client, "בקליטה", what the card is, and until when.
const KIND_ICON = { first: ['palette', 'pink'], rest: ['palette', 'pink'], final: ['play', 'orange'], gantt: ['calendar', 'teal'] };
const cardHead = (kind, c, hash, title, ...end) => h('div', { class: 'wproc-h il-head' },
  iconSquare(...KIND_ICON[kind], { size: 'sm' }),
  h('a', { class: 'wclient', href: clientUrl(c.id, hash) }, clientLabel(c)), landingTag(c),
  h('span', { class: 'il-title' }, title), ...end);
// What the graphics are made from: the characterization, read-only (intake.html).
const charLink = (c) => leadIcon(h('a', { class: 'btn-text il-char', href: charViewHref(c.id) }, 'האפיון של הלקוח', h('span', { class: 'sr-only' }, `: ${c.name}`)), 'script');

// Groups of "המשימות שלי" that the cards already cover (client and process), so
// nothing is listed twice: the day's processes (his new logo in 5, 7, 9), the
// rest of the graphics (23), the final versions (27) and the Gantt (29).
export function coveredByCard(ctx) {
  const set = new Set();
  for (const x of charDay({ ...ctx, now: new Date() })) for (const p of ['p05', 'p07', 'p09']) set.add(`${x.client.id}:${p}`);
  const work = ilaiWork(ctx);
  for (const x of [...work.first, ...work.rest]) set.add(`${x.client.id}:${x.state.proc.id}`);
  for (const x of [...work.finals, ...work.gantt]) set.add(`${x.client.id}:${x.state.proc.id}`);
  return (g) => !g.task && set.has(`${g.client.id}:${g.proc.id}`);
}

// ctx: { clients, checks (all, by client), stateOf, me, viewer, refresh }
// `only`: a set of `${client}:${process}` keys; then only the cards that cover one of
// them (the "באיחור" tab of "המשימות שלי": the same cards, the late ones alone; section 50).
export function ilaiSection(ctx, only = null) {
  const keep = (x, procs) => !only || procs.some((p) => only.has(`${x.client.id}:${p}`));
  const one = (x) => keep(x, [x.state.proc.id]);
  const day = charDay({ ...ctx, now: new Date() }).filter((x) => keep(x, ['p05', 'p07', 'p09']));
  const work = ilaiWork(ctx);
  whoAmI(ctx);
  // A client still in landing is quiet (sections 41 and 46): its cards are not laid out
  // one after the other with the working ones; they fold into one counted line per kind
  // ("N לקוחות עם יתרת גרפיקות · בקליטה, בלי שעון") that opens onto the same cards.
  const quiet = (x) => !only && x.client.landing === true;
  const kinds = [['first', work.first, firstCard], ['rest', work.rest, restCard], ['final', work.finals, finalCard], ['gantt', work.gantt, ganttCard]];
  const cards = [
    ...day.map((x) => dayCard(x, ctx)),
    ...kinds.flatMap(([, list, card]) => list.filter(one).filter((x) => !quiet(x)).map((x) => card(x, ctx))),
  ];
  const folds = kinds.map(([kind, list, card]) => landingFold(kind, list.filter(one).filter(quiet), card, ctx)).filter(Boolean);
  if (!cards.length && !folds.length) return null;
  const title = day.length ? 'יום אפיון: שעתיים' : 'גרפיקות, גאנט וגרסאות סופיות';
  return h('section', { class: 'wgroup g-ilai', 'aria-labelledby': 'il-h' },
    h('h2', { class: 'wgroup-h', id: 'il-h' }, title, cards.length ? h('span', { class: 'n' }, String(cards.length)) : null),
    cards.length ? h('ul', { class: 'wprocs il-list' }, ...cards) : null,
    ...folds);
}

// The cards of the clients in landing, of one kind, behind one counted line. It is a
// <details>: the line is its summary, and the cards under it are the same cards.
const FOLD_WORDS = { first: '9 גרפיקות ראשונות', rest: 'יתרת גרפיקות', final: 'גרסאות סופיות לקבל', gantt: 'גאנט למלא' };
const openFolds = new Set();
function landingFold(kind, list, card, ctx) {
  if (!list.length) return null;
  const n = list.length;
  const words = `${n === 1 ? 'לקוח אחד' : `${n} לקוחות`} עם ${FOLD_WORDS[kind]}`;
  return h('details', {
    class: 'il-fold', id: `il-fold-${kind}`, 'data-kind': kind, open: openFolds.has(kind),
    ontoggle: (e) => { if (e.currentTarget.open) openFolds.add(kind); else openFolds.delete(kind); },
  },
    h('summary', { class: 'k-line k-line-landing il-fold-s' },
      h('b', { class: 'k-num', 'data-n': String(n), 'aria-hidden': 'true' }),
      h('strong', { class: 'k-line-t' }, words, h('small', { class: 'k-line-sub' }, h('i', { class: 'k-sep' }, ' · '), LANDING_WORDS)),
      h('span', { class: 'k-go il-fold-go' }, h('span', { class: 'il-fold-open' }, 'הצגה'), h('span', { class: 'il-fold-close' }, 'הסתרה'))),
    h('ul', { class: 'wprocs il-list il-list-quiet' }, ...list.map((x) => card(x, ctx))));
}

async function mark(ctx, c, keys, state, doneText, { handoff = null } = {}) {
  const cs = (ctx.checks[c.id] ||= {});
  // A mark the system looks into first ("הגאנט מלא" on an empty Gantt; app/mark-guards.js).
  if (state && keys.length === 1) {
    const verdict = await checkMark(c.id, keys[0]);
    if (verdict?.refuse) { toast(verdict.refuse); ctx.refresh?.(); return false; }
  }
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
// Until when, as a pill (hot once it passed; docs/ops.md, section 61). The " · " stays in the text and is not drawn.
const until = (d, now = new Date()) => (d ? h('span', { class: `muted il-until${d < now ? ' late' : ''}` }, h('i', { class: 'k-sep' }, ' · '), `עד ${formatWhen(d, now)}`) : null);

function dayCard(x, ctx) {
  const c = x.client;
  const cs = ctx.checks[c.id] || {};
  const idp = `il-${c.id}`;
  const now = new Date();
  const line = (key) => x.lines.find((l) => l.key === key);
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
        h('h4', {}, '9 גרפיקות', gfx.done ? null : until(gfx.due, now)),
        h('div', { class: 'of-acts' }, charLink(c)),
        gfxFiles(ctx, c, cs, 'first', `${idp}-g9`),
        gfxStep(ctx, c, cs, 'first', `${idp}-gfx`)),
      h('div', { class: 'il-part' },
        h('h4', {}, 'שלד גאנט', gantt.done ? null : until(gantt.due, now)),
        h('label', { class: 'wrow', for: `${idp}-gantt` },
          h('input', { type: 'checkbox', class: 'cbx fin', id: `${idp}-gantt`, checked: gantt.done, onchange: (e) => mark(ctx, c, GANTT_KEYS, e.currentTarget.checked, e.currentTarget.checked ? 'שלד הגאנט סומן.' : null) }),
          h('span', { class: 'wlabel' }, 'גאנט התוכן נפתח במערכת, עם כל העמודות')),
        h('div', { class: 'of-acts' }, h('a', { class: 'btn btn-sm btn-ghost gantt-go', href: ganttUrl(c.id) }, 'גאנט התוכן', h('span', { class: 'sr-only' }, ` של ${c.name}`)))),
      // v10: the logo he made goes into the client's files here; the tick is refused while none is there (app/mark-guards.js).
      logo ? h('div', { class: 'il-part' }, h('h4', {}, 'לוגו חדש', logo.done ? null : until(logo.due, now)),
        logo.done ? null : mountWorkFiles({ client: c, kind: 'logo', me: ctx.viewer?.error ? undefined : ctx.me, myEmail, idp: `${idp}-logo`, toast, title: 'הלוגו החדש', onChange: ctx.refresh }),
        check(ctx, c, 'p05.newlogo', 'הכנתי לוגו חדש (אין ללקוח לוגו)', idp)) : null));
}

// The first 9 graphics after the characterization day (its card is gone): the same
// upload and the same lock.
// A batch of graphics is one line until it is opened (the owner, 20.10.2026): the client,
// the batch, until when, how many are up ("0/9 הועלו", or where the batch stands), and
// "העלאה"; the tap opens the upload, the characterization and "מוכן לבדיקה".
function gfxCard(x, ctx, batch) {
  const c = x.client;
  const cs = ctx.checks[c.id] || {};
  const idp = batch === 'first' ? `il-9-${c.id}` : `il-r-${c.id}`;
  const q = qaState(cs, '', BATCH[batch].kind);
  const total = batch === 'first' ? 9 : restTotal(c);
  const gate = gfxGate(c, cs, batch);
  const files = workFilesState(c.id);
  const where = q.stage === 'fixing' ? 'חזר לתיקונים' : q.stage === 'ofir' ? 'אצל אופיר' : isDone(cs, BATCH[batch].key) ? 'נמסרו לבדיקה'
    : files.loaded && !files.error ? [h('bdi', { class: 'num', dir: 'ltr' }, `${gate.count}${total ? `/${total}` : ''}`), ' הועלו'] : null;
  // The first 9 share the open state of the characterization day's card of the same client: it
  // turns into this card when the day ends (or after a fix), and stays as it was left.
  const key = batch === 'first' ? c.id : `${batch}:${c.id}`;
  return h('li', { class: 'wproc il-card il-gfx', 'data-key': `il-${batch}:${c.id}` },
    h('details', {
      class: 'il-gfx-fold', id: `${idp}-d`, open: openCards.has(key),
    },
    // Kept from the tap itself (not the toggle event, which a redraw between the two can lose).
    h('summary', { class: 'il-gfx-s', id: `${idp}-s`, onclick: (e) => { if (e.currentTarget.parentElement.open) openCards.delete(key); else openCards.add(key); } },
      cardHead(batch, c, BATCH[batch].proc, batch === 'first' ? '9 גרפיקות ראשונות' : 'יתרת הגרפיקות', until(x.state.dueAt)),
      h('span', { class: 'il-gfx-line' },
        where ? h('span', { class: `il-gfx-n${q.stage === 'fixing' ? ' late' : ''}` }, where) : null,
        h('span', { class: 'btn btn-sm k-btn-navy il-gfx-go', 'aria-hidden': 'true' },
          h('span', { class: 'il-fold-open' }, q.stage === 'none' && !isDone(cs, BATCH[batch].key) ? 'העלאה' : 'פתיחה'), h('span', { class: 'il-fold-close' }, 'סגירה')))),
    h('div', { class: 'of-acts il-links' }, charLink(c)),
    gfxFiles(ctx, c, cs, batch, `${idp}-g`),
    gfxStep(ctx, c, cs, batch, `${idp}-ready`)));
}
const firstCard = (x, ctx) => gfxCard(x, ctx, 'first');
const restCard = (x, ctx) => gfxCard(x, ctx, 'rest');

function finalDrive(c, cs, x) {
  const link = videosLinkOf(c, cs, x.pre);
  return link
    ? h('div', { class: 'of-acts il-links' }, h('a', { class: 'btn btn-sm btn-ghost il-drive', href: link, target: '_blank', rel: 'noopener noreferrer' }, 'פתיחת הסרטונים בדרייב', h('span', { class: 'sr-only' }, ` של ${c.name} (נפתח בחלון חדש)`)))
    : h('p', { class: 'hint il-nodrive' }, 'אין קישור לסרטונים בדרייב. לבקש מהעורך.');
}

function finalCard(x, ctx) {
  const c = x.client;
  const key = `${x.pre}p27.toilai`;
  return h('li', { class: 'wproc il-card', 'data-key': `il-final:${c.id}:${x.pre}` },
    cardHead('final', c, x.state.proc.id, `גרסאות סופיות בדרייב${x.n ? ` · סבב ${x.n}` : ''}`, h('span', { class: 'muted il-until' }, h('i', { class: 'k-sep' }, ' · '), `מ־${formatWhen(x.at)}`)),
    // Where they are: the client's Drive (the editor's link); any uploaded into the system are listed.
    finalDrive(c, ctx.checks[c.id] || {}, x),
    mountWorkFiles({
      client: c, kind: 'deliverable_video', window: videoWindow(c, ctx.checks[c.id] || {}, x.n || 1), me: ctx.viewer?.error ? undefined : ctx.me, readOnly: true, hideEmpty: true,
      idp: `il-f-${c.id}-${x.pre.replace(/\W/g, '')}-v`, title: 'סרטונים שהועלו למערכת', total: null, toast, onChange: ctx.refresh,
    }),
    h('p', { class: 'task-meta' }, '״קיבלתי״ סוגר את משימת העריכה, ומתחילות השעתיים לתזמון ולגאנט.'),
    h('div', { class: 'of-acts il-go' }, h('button', {
      type: 'button', class: 'btn btn-sm k-btn-navy', id: `il-f-${c.id}-${x.pre.replace(/\W/g, '')}`,
      onclick: (e) => { e.currentTarget.disabled = true; mark(ctx, c, [key], true, 'קיבלת את הגרסאות הסופיות. העריכה נסגרה.'); },
    }, 'קיבלתי')));
}

function ganttCard(x, ctx) {
  const c = x.client;
  const key = `${x.pre}p29.filled`;
  return h('li', { class: 'wproc il-card', 'data-key': `il-gantt:${c.id}:${x.pre}` },
    cardHead('gantt', c, x.state.proc.id, `גאנט${x.n ? ` · סבב ${x.n}` : ''}`, until(x.state.dueAt)),
    h('div', { class: 'of-acts il-go' }, h('a', { class: 'btn btn-sm btn-ghost gantt-go', href: ganttUrl(c.id) }, 'פתיחת גאנט התוכן', h('span', { class: 'sr-only' }, ` של ${c.name}`)), h('button', {
      type: 'button', class: 'btn btn-sm k-btn-navy', id: `il-g-${c.id}-${x.pre.replace(/\W/g, '')}`,
      onclick: (e) => { e.currentTarget.disabled = true; mark(ctx, c, [key], true, 'הגאנט מלא. עירית מקבלת ״לשלוח גאנט״.', { handoff: key }); },
    }, 'הגאנט מלא')));
}
