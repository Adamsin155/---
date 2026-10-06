// Shoot days (shoot.html; docs/plan/system-plan.md §3 "אלי הצלם" and Lior's "מצב
// יום צילום", §4 station 4). Two views of the same days:
//  - Eli, "ימי הצילום שלי": per day the date, the client, the address with Waze and
//    Google Maps, his arrival (an hour before the influencers), the number of
//    scripts and the drive label from Lior's briefing. The evening before: the
//    briefing with "קיבלתי" and the gear list (the only place it appears). On the
//    day: "הגעתי" and "קיבלתי כונן", "הבי־רול גמור?" (a "לא" reaches Lior), the
//    shooting guidance as fixed text, the finish list and "מסרתי לליאור" (locked
//    until the list is done), and the notes for the editor.
//  - Lior (the owner too; the rest of the office sees it without buttons): the day's
//    timeline, the counter "צולמו X מתוך Y" with +1 per numbered video (decision 13),
//    the quiet mode (decision 8; the reminder engine reads the same marks), the
//    drive coming back and the closing lock; and the 17:00 briefing to Eli with the
//    drive label, for the next shoot day (for a Sunday shoot, on Thursday).
// Every mark is a protocol check; the keys are in app/production.js.
import { SHOOT_TYPES } from './protocol.js';
import { clientState, clientLabel } from './protocol-logic.js';
import { loadChecks, setCheck, clearCheck, setChecksBulk, loadDirectory, loadStaffPhones } from './protocol-data.js';
import { loadWorkClients } from './production-data.js';
import {
  $, fill, h, toast, errorText, mountSession, viewerOf, directory, formatWhen, progressBar, store, VIEWER_UNKNOWN,
} from './protocol-ui.js';
import { whatsappLink } from './quote-doc.js';
import { mountPush } from './push.js';
import { offerHandoff } from './handoff-ui.js';
import { dayKeyIL, daysBetweenIL } from './tz.js';
import * as P from './production.js';

let me = null;
let mode = null; // 'eli' | 'lior'
let canAct = false;
let clients = [];
let checks = {};
let phones = {};
let lastLoad = 0;
const cs = (c) => (checks[c.id] ||= {});
const busy = () => !!document.querySelector('dialog[open]');
const isDone = (sc, k) => cs(sc.client)[sc.pre + k]?.state === 'done';
const atOf = (sc, k) => (isDone(sc, k) ? new Date(cs(sc.client)[sc.pre + k].at) : null);
const cardId = (sc) => `s-${sc.client.id}${sc.n > 1 ? `-r${sc.n}` : ''}`;
const scName = (sc) => `${clientLabel(sc.client)}${sc.n > 1 ? ` · סבב ${sc.n}` : ''}`;

async function load() {
  $('state').textContent = clients.length ? '' : 'טוען…';
  try {
    [clients, checks] = await Promise.all([loadWorkClients(), loadChecks()]);
  } catch (err) {
    $('state').textContent = errorText(err);
    return;
  }
  lastLoad = Date.now();
  $('state').textContent = '';
  render();
  const id = new URLSearchParams(location.search).get('id');
  const el = id && document.querySelector(`[id^="s-${CSS.escape(id)}"], [id^="b-${CSS.escape(id)}"]`);
  if (el && !load.jumped) { load.jumped = true; el.scrollIntoView({ block: 'start' }); el.querySelector('h2')?.focus({ preventScroll: true }); }
}

function render() {
  if (mode === 'eli') renderEli(); else renderLior();
}
function renderKeepingFocus(focusId = document.activeElement?.id) {
  const y = window.scrollY;
  render();
  window.scrollTo({ top: y });
  if (focusId) document.getElementById(focusId)?.focus({ preventScroll: true });
}

async function mark(sc, keys, note = null, focusId = null) {
  const c = cs(sc.client);
  const list = (Array.isArray(keys) ? keys : [keys]).map((k) => sc.pre + k);
  try {
    const rows = list.length === 1 ? [await setCheck(sc.client.id, list[0], 'done', note)] : await setChecksBulk(sc.client.id, list, 'done', note);
    for (const r of rows) c[r.item_key] = r;
  } catch (err) {
    toast(`הסימון לא נשמר. ${errorText(err)}`);
    return false;
  }
  renderKeepingFocus(focusId);
  return true;
}
async function unmark(sc, key, focusId = null) {
  try {
    await clearCheck(sc.client.id, sc.pre + key);
    delete cs(sc.client)[sc.pre + key];
  } catch (err) {
    toast(`לא נשמר. ${errorText(err)}`);
    return false;
  }
  renderKeepingFocus(focusId);
  return true;
}
const notYet = (sc, keys) => keys.filter((k) => !isDone(sc, k));

// ── Shared pieces ───────────────────────────
const btn = (id, text, onclick, cls = 'btn', extra = {}) => h('button', { type: 'button', class: cls, id, onclick, disabled: !canAct, ...extra }, text);
function placeBlock(sc) {
  const nav = P.navLinks(sc.client.address);
  return h('div', { class: 'sh-place' },
    h('p', {}, h('span', { class: 'ed-k' }, 'כתובת'), sc.client.address || 'אין כתובת בכרטיס. לבקש מליאור.'),
    nav ? h('div', { class: 'sh-nav' },
      h('a', { class: 'btn btn-sm', href: nav.waze, target: '_blank', rel: 'noopener noreferrer' }, 'ניווט ב־Waze'),
      h('a', { class: 'btn btn-sm btn-ghost', href: nav.maps, target: '_blank', rel: 'noopener noreferrer' }, 'Google Maps')) : null);
}
const scriptsCount = (sc) => P.videosPerDay(sc.ctx);

// ── Eli ─────────────────────────────────────
// The days to show: from yesterday (while the drive is not handed back) to 30 days ahead.
function eliDays(now = new Date()) {
  return clients.flatMap((c) => P.shootCases(c)).filter((sc) => {
    const d = daysBetweenIL(now, sc.shootAt);
    if (d < 0) return d >= -1 && !P.handoffOf(cs(sc.client), sc.pre).done;
    return d <= 30;
  }).sort((a, b) => a.shootAt - b.shootAt);
}

function renderEli() {
  const now = new Date();
  const days = eliDays(now);
  const next = days[0];
  $('sh-summary').textContent = next ? `הקרוב: ${P.dayWords(next.shootAt, now)} · ${scName(next)} · הגעה ${P.clockText(P.arrivalOf(next.shootAt))}` : '';
  fill($('sh-list'), days.length ? days.map((sc) => eliCard(sc, now))
    : h('p', { class: 'empty' }, 'אין ימי צילום בחודש הקרוב. כשיום צילום ייסגר, הוא יופיע כאן.'));
}

function eliCard(sc, now) {
  const id = cardId(sc);
  const today = dayKeyIL(sc.shootAt) === dayKeyIL(now);
  const b = P.briefingOf(cs(sc.client), sc.pre);
  const label = b?.label || P.noteOf(cs(sc.client)[`${sc.pre}p17b.drive`]);
  const n = scriptsCount(sc);
  const eveOrDay = now >= P.briefingDay(sc.shootAt) || today || !!b;
  return h('article', { class: `sh-card${today ? ' is-today' : ''}`, id, 'aria-labelledby': `${id}-h` },
    h('header', { class: 'ed-head' },
      h('h2', { id: `${id}-h`, tabindex: '-1' }, `${P.dayWords(sc.shootAt, now) === 'היום' ? 'היום' : P.dateWords(sc.shootAt)} · ${scName(sc)}`),
      today ? h('span', { class: 'ed-state s-editing' }, 'יום צילום היום') : null),
    h('dl', { class: 'sh-facts' },
      h('dt', {}, 'ההגעה שלך'), h('dd', { class: 'num' }, `${P.clockText(P.arrivalOf(sc.shootAt))} · שעה לפני המשפיענים (${P.clockText(sc.shootAt)})`),
      h('dt', {}, 'תסריטים'), h('dd', {}, n ? `${n} סרטונים` : 'לפי מה שליאור יביא'),
      // From the briefing's hour on (and on the day itself) "will fill it in" is no longer true.
      h('dt', {}, 'תווית הכונן'), h('dd', {}, label || (eveOrDay ? 'ליאור עוד לא מילא' : 'ליאור ימלא בתדריך'))),
    placeBlock(sc),
    b ? briefingForEli(sc, b) : h('p', { class: 'muted' }, eveOrDay ? 'התדריך: ליאור עוד לא מילא.' : 'התדריך של ליאור יגיע בערב שלפני, ב־17:00.'),
    eveOrDay && !isDone(sc, 'p17b.arrived') ? gearBlock(sc) : null,
    today || isDone(sc, 'p17b.arrived') ? eliDay(sc, now) : null);
}

function briefingForEli(sc, b) {
  const id = cardId(sc);
  return h('section', { class: 'sh-brief', 'aria-labelledby': `${id}-bh` },
    h('h3', { id: `${id}-bh` }, 'התדריך מליאור'),
    b.label ? h('p', {}, P.driveName(b.label)) : null,
    b.notes ? h('p', { class: 'ed-note' }, b.notes) : null,
    b.ack ? h('p', { class: 'note-ok' }, `אישרת ${formatWhen(b.ack)}. ליאור רואה.`)
      : btn(`${id}-ack`, 'קיבלתי', () => mark(sc, 'p16.photographer', 'אלי אישר את התדריך', `${id}-h`), 'btn btn-primary'));
}

// The gear list: ticks kept on this phone until all four are done (then one mark).
function gearBlock(sc) {
  const id = cardId(sc);
  if (isDone(sc, 'p17b.gear')) return h('p', { class: 'note-ok' }, 'הציוד מוכן: סוללות, כרטיסים, מיקרופונים ותאורה.');
  const key = (g) => `gear.${sc.client.id}.${sc.n}.${g}`;
  return h('fieldset', { class: 'prod-checks sh-gear' },
    h('legend', {}, 'ציוד לערב שלפני'),
    ...P.GEAR.map(([g, l]) => h('label', { class: 'prod-check', for: `${id}-gear-${g}` },
      h('input', {
        type: 'checkbox', id: `${id}-gear-${g}`, class: 'cbx', checked: store.get(key(g)) === '1', disabled: !canAct,
        onchange: async (e) => {
          store.set(key(g), e.currentTarget.checked ? '1' : '');
          if (P.GEAR.every(([x]) => store.get(key(x)) === '1')) {
            if (await mark(sc, 'p17b.gear', 'סוללות, כרטיסים ריקים, מיקרופונים ותאורה', `${id}-h`)) toast('הציוד מוכן.');
          }
        },
      }), h('span', {}, l))));
}

function eliDay(sc, now) {
  const id = cardId(sc);
  const c = cs(sc.client);
  const arrived = atOf(sc, 'p17b.arrived');
  const drive = isDone(sc, 'p17b.drive');
  const label = P.briefingOf(c, sc.pre)?.label || '';
  const q = c[`${sc.pre}p17b.brollq`];
  const h2 = P.handoffOf(c, sc.pre);
  const open = P.finishOpen(c, sc.pre);
  const notes = c[`${sc.pre}p19b.notes`];
  // Arrival: two taps.
  const arrival = !arrived
    ? h('div', { class: 'ed-act' }, btn(`${id}-arrived`, 'הגעתי', () => mark(sc, 'p17b.arrived', null, `${id}-drive`), 'btn btn-primary btn-big'))
    : !drive
      ? h('div', { class: 'ed-act' }, h('p', { class: 'note-ok' }, `הגעת ${P.clockText(arrived)}.`),
        btn(`${id}-drive`, label ? `קיבלתי ${P.driveName(label)}` : 'קיבלתי את הכונן', () => mark(sc, 'p17b.drive', label || null, `${id}-yes`), 'btn btn-primary btn-big'))
      : h('p', { class: 'note-ok' }, `הגעת ${P.clockText(arrived)} · ${P.driveName(label) || 'הכונן'} אצלך.`);
  // "הבי־רול גמור?" (15 minutes before the influencers; a "לא" reaches Lior).
  const broll = !arrived ? null : !q
    ? h('div', { class: 'sh-q', role: 'group', 'aria-labelledby': `${id}-q` },
      h('p', { id: `${id}-q` }, h('strong', {}, 'הבי־רול גמור?'), ` המשפיענים מגיעים ב־${P.clockText(sc.shootAt)}.`),
      btn(`${id}-yes`, 'כן', () => mark(sc, ['p17b.brollq', ...notYet(sc, ['p17b.broll', 'p17b.zones', 'p17b.variety'])], null, `${id}-h`), 'btn btn-primary'),
      btn(`${id}-no`, 'לא', () => answerNo(sc), 'btn'))
    : q.note === 'no' && !isDone(sc, 'p17b.broll')
      ? h('div', { class: 'sh-q' }, h('p', {}, 'ענית שהבי־רול לא גמור. ליאור קיבל הודעה.'),
        btn(`${id}-brolldone`, 'הבי־רול הושלם עכשיו', () => mark(sc, 'p17b.broll', 'הושלם אחרי הגעת המשפיענים', `${id}-h`), 'btn btn-sm'))
      : h('p', { class: 'note-ok' }, 'הבי־רול גמור.');
  // Finish: four items, then the handoff (locked until they are done).
  const finish = arrived ? h('fieldset', { class: 'prod-checks sh-finish' },
    h('legend', {}, 'לפני שעוזבים'),
    ...P.FINISH.map(([k, l], i) => h('label', { class: 'prod-check', for: `${id}-fin-${i}` },
      h('input', {
        type: 'checkbox', id: `${id}-fin-${i}`, class: 'cbx', checked: isDone(sc, k), disabled: !canAct || h2.eli,
        onchange: (e) => (e.currentTarget.checked ? mark(sc, k, null, `${id}-fin-${i}`) : unmark(sc, k, `${id}-fin-${i}`)),
      }), h('span', {}, l))),
    h2.eli
      ? h('p', { class: h2.lior ? 'note-ok' : 'ed-wait' }, h2.lior
        ? `המסירה אושרה. אפשר לפרמט את הכרטיסים של ${sc.client.name}${label ? `, ${P.driveName(label)}` : ''}.`
        : `מסרת ${P.clockText(h2.eli)}. ממתין שליאור יאשר שקיבל.`)
      : h('div', { class: 'ed-act' },
        // The shooting guidance was followed: its items close with the handoff (fixed text, not a checklist).
        btn(`${id}-handed`, 'מסרתי לליאור', () => mark(sc, ['p19b.handed', ...notYet(sc, ['p18b.order', 'p18b.quality', 'p18b.numbered'])], null, `${id}-h`), 'btn btn-primary', { disabled: !canAct || open.length > 0, 'aria-describedby': `${id}-lock` }),
        h('p', { class: 'hint', id: `${id}-lock` }, open.length ? `נפתח אחרי ${open.length === 1 ? 'הפריט שנשאר' : `${open.length} הפריטים שנשארו`} ברשימה.` : 'ליאור מאשר מצדו, והמסירה נרשמת פעם אחת.'))) : null;
  return h('div', { class: 'sh-day' },
    arrival,
    broll,
    h('details', { class: 'ed-more' }, h('summary', {}, 'הנחיות הצילום'),
      h('ul', { class: 'sh-guide' },
        h('li', {}, 'עוברים עם ליאור על אזורי הצילום: זוויות, תאורה, סאונד ורקע נקי.'),
        h('li', {}, 'בי־רול מגוון לפני המשפיענים: המקום, חזית ופנים, מוצרים, שירותים, עובדים, שילוט ואווירה; תקריבים וצילומים רחבים.'),
        h('li', {}, 'מצלמים לפי סדר התסריטים של ליאור. בכל סרטון: חדות, פריים, תאורה, סאונד ומיקרופון.'),
        h('li', {}, 'לכל חומר ברור לאיזה מספר סרטון הוא שייך. תקלה: פותרים לפני שממשיכים.'))),
    finish,
    arrived ? h('div', { class: 'field sh-notes' },
      h('label', { for: `${id}-notes` }, 'הערות לעורך'),
      h('textarea', { class: 'input', id: `${id}-notes`, rows: 3, maxlength: 2000, disabled: !canAct, placeholder: 'למשל: בסרטון 4 יש שתי גרסאות; הסאונד בסרטון 7 מהמיקרופון השני' }, P.noteOf(notes)),
      h('div', { class: 'ed-act' }, btn(`${id}-notes-save`, 'שמירה', () => saveNotes(sc), 'btn btn-sm'),
        h('span', { class: 'hint' }, 'מופיע בעמוד של העורך שישויך.'))) : null);
}
// "לא": the answer (its note) rings Lior; the zones and the variety were still done.
async function answerNo(sc) {
  const id = cardId(sc);
  if (!await mark(sc, 'p17b.brollq', 'no', `${id}-brolldone`)) return;
  const rest = notYet(sc, ['p17b.zones', 'p17b.variety']);
  if (rest.length) await mark(sc, rest, null, `${id}-brolldone`);
  toast('ליאור קיבל הודעה שהבי־רול לא גמור.');
}
async function saveNotes(sc) {
  const text = $(`${cardId(sc)}-notes`).value.trim();
  if (!text) { if (await unmark(sc, 'p19b.notes', `${cardId(sc)}-notes`)) toast('ההערות נמחקו.'); return; }
  if (await mark(sc, 'p19b.notes', text.slice(0, 2000), `${cardId(sc)}-notes`)) toast('ההערות נשמרו לעורך.');
}

// ── Lior ────────────────────────────────────
function renderLior() {
  const now = new Date();
  const all = clients.flatMap((c) => P.shootCases(c));
  const today = all.filter((sc) => dayKeyIL(sc.shootAt) === dayKeyIL(now)).sort((a, b) => a.shootAt - b.shootAt);
  // The briefing to Eli: from its day (17:00 of the business day before) until the shoot.
  const briefs = all.filter((sc) => sc.shootAt > now && dayKeyIL(P.briefingDay(sc.shootAt)) <= dayKeyIL(now) && dayKeyIL(sc.shootAt) !== dayKeyIL(now))
    .sort((a, b) => a.shootAt - b.shootAt);
  const later = all.filter((sc) => sc.shootAt > now && !today.includes(sc) && !briefs.includes(sc)).sort((a, b) => a.shootAt - b.shootAt).slice(0, 8);
  $('sh-summary').textContent = today.length ? `יום צילום היום: ${today.map(scName).join(', ')}` : 'אין היום יום צילום.';
  fill($('sh-list'),
    ...today.map((sc) => shootMode(sc, now)),
    ...briefs.map((sc) => briefingForm(sc, now)),
    later.length ? h('section', { class: 'prod-sec', 'aria-labelledby': 'later-h' },
      h('h2', { class: 'prod-h', id: 'later-h' }, 'ימי הצילום הבאים'),
      h('ul', { class: 'sh-later' }, ...later.map((sc) => h('li', {}, h('span', { class: 'num' }, `${P.dateWords(sc.shootAt)} ${P.clockText(sc.shootAt)}`), ` · ${scName(sc)}`)))) : null,
    !today.length && !briefs.length && !later.length ? h('p', { class: 'empty' }, 'אין ימי צילום קרובים.') : null);
}

function shootMode(sc, now) {
  const id = cardId(sc);
  const c = cs(sc.client);
  const target = scriptsCount(sc);
  const shot = P.shotOf(c, sc.pre);
  const next = P.nextVideo(shot);
  const st = clientState(sc.client, c, now).states.find((s) => s.proc.id === (sc.pre ? `r${sc.n}-p19` : 'p19'));
  const closed = !!st?.complete;
  const q = P.quietWindow(sc, c, closed ? st.completedAt : null);
  const quietOn = q && now >= q.from && now < q.to;
  const started = P.shootStarted(sc, now);
  const lock = P.closeLock(c, sc.pre, target, { startAt: sc.shootAt, now });
  const h2 = P.handoffOf(c, sc.pre);
  const arrived = atOf(sc, 'p17b.arrived');
  const brollq = c[`${sc.pre}p17b.brollq`];
  const tl = P.timeline(sc);
  const nextPoint = tl.find((x) => x.at > now);
  return h('article', { class: 'sh-card sh-mode is-today', id, 'aria-labelledby': `${id}-h` },
    h('header', { class: 'ed-head' },
      h('h2', { id: `${id}-h`, tabindex: '-1' }, `מצב יום צילום · ${scName(sc)}`),
      h('span', { class: `ed-state ${closed ? 's-done' : 's-editing'}` }, closed ? 'היום נסגר' : !started ? P.startsText(sc.shootAt) : SHOOT_TYPES[sc.ctx.shoot_type]?.name || '')),
    // Quiet mode (decision 8): from Eli's "הגעתי" until the drive is back.
    closed ? null : quietOn
      ? h('p', { class: 'sh-quiet', role: 'note' }, h('strong', {}, 'מצב שקט'), ` מאז ${P.clockText(q.from)}${q.by === 'eli' ? ' (אלי הגיע)' : ''}: חריגות עוברות לאופיר, ושאר ההודעות יגיעו בסיכום אחד אחרי המסירה.`)
      : !h2.done ? h('div', { class: 'sh-quiet is-off' }, h('p', {}, 'מצב שקט מתחיל כשאלי מסמן ״הגעתי״.'),
        btn(`${id}-quiet`, 'להפעיל מצב שקט עכשיו', () => mark(sc, 'p18.quiet', null, `${id}-h`), 'btn btn-sm')) : null,
    // The counter replaces the green marks in Google Docs (decision 13).
    h('section', { class: 'sh-counter', 'aria-labelledby': `${id}-count` },
      h('p', { class: 'sh-count num', id: `${id}-count`, 'aria-live': 'polite' }, P.counterText(shot.length, target)),
      target ? progressBar(Math.min(shot.length, target), target, 'סרטונים שצולמו') : null,
      // Once the day is closed the counter is final: no controls. Before the start it waits.
      closed ? null : h('div', { class: 'ed-act' },
        btn(`${id}-plus`, `+1 · סרטון ${next}`, () => count(sc, [...shot, next], `${id}-plus`), 'btn btn-primary btn-big', { disabled: !canAct || !started, ...(started ? {} : { 'aria-describedby': `${id}-early` }) }),
        shot.length ? btn(`${id}-minus`, `ביטול סרטון ${Math.max(...shot)}`, () => count(sc, shot.filter((x) => x !== Math.max(...shot)), `${id}-minus`), 'btn btn-sm btn-ghost', { disabled: !canAct || !started }) : null),
      closed || started ? null : h('p', { class: 'hint', id: `${id}-early` }, `יום הצילום ${P.startsText(sc.shootAt)}. המונה והסגירה נפתחים אז.`)),
    h('ol', { class: 'sh-timeline' }, ...tl.map((x) => h('li', { class: `${x.at <= now ? 'is-past' : ''}${x === nextPoint ? ' is-next' : ''}${x.prompt ? ' is-prompt' : ''}` },
      h('span', { class: 'num sh-t' }, P.clockText(x.at)), h('span', {}, x.label), x === nextPoint ? h('span', { class: 'sr-only' }, ' (הבא)') : null))),
    h('p', { class: 'sh-fixed' }, 'להחזיק את הראיונות על המסר.'),
    // Eli, at a glance.
    h('dl', { class: 'sh-facts' },
      h('dt', {}, 'אלי'), h('dd', {}, arrived ? `הגיע ${P.clockText(arrived)}${h2.lior || closed ? ' · הכונן אצל ליאור' : isDone(sc, 'p17b.drive') ? ' · הכונן אצלו' : ''}` : h2.lior || closed ? 'הכונן אצל ליאור' : `עוד לא סימן הגעה (הגעה ${P.clockText(P.arrivalOf(sc.shootAt))})`),
      h('dt', {}, 'בי־רול'), h('dd', {}, !brollq ? '—' : brollq.note === 'no' ? (isDone(sc, 'p17b.broll') ? 'הושלם באיחור' : 'לא גמור') : 'גמור'),
      h('dt', {}, 'סיום'), h('dd', {}, h2.eli ? `מסר את הכונן ${P.clockText(h2.eli)}` : `${P.FINISH.length - P.finishOpen(c, sc.pre).length} מתוך ${P.FINISH.length} ברשימה`)),
    // Closing: the lock (testimonial, the full quantity, the drive back and confirmed by both).
    closed ? h('p', { class: 'note-ok' }, `יום הצילום נסגר ${formatWhen(st.completedAt, now)}. ${P.afterCloseText(c, sc.pre, sc.ctx)}`)
      : h('section', { class: 'sh-close', 'aria-labelledby': `${id}-close-h` },
        h('h3', { id: `${id}-close-h` }, 'סגירת היום'),
        h('label', { class: 'prod-check', for: `${id}-testimonial` },
          h('input', { type: 'checkbox', id: `${id}-testimonial`, class: 'cbx', checked: isDone(sc, 'p19.testimonial'), disabled: !canAct || !started, onchange: (e) => (e.currentTarget.checked ? mark(sc, 'p19.testimonial', null, `${id}-testimonial`) : unmark(sc, 'p19.testimonial', `${id}-testimonial`)) }),
          h('span', {}, 'צולם סרטון המלצה של הלקוח עם המשפיענים')),
        target ? null : h('label', { class: 'prod-check', for: `${id}-all` },
          h('input', { type: 'checkbox', id: `${id}-all`, class: 'cbx', checked: isDone(sc, 'p18.all'), disabled: !canAct || !started, onchange: (e) => (e.currentTarget.checked ? mark(sc, 'p18.all', null, `${id}-all`) : unmark(sc, 'p18.all', `${id}-all`)) }),
          h('span', {}, 'צולמה כל הכמות (אין כמות בחבילה בכרטיס)')),
        h2.lior ? h('p', { class: 'note-ok' }, `אישרת שהכונן חזר ${P.clockText(h2.lior)}.${h2.eli ? '' : ' אלי עוד לא סימן מסירה.'}`)
          : btn(`${id}-took`, h2.eli ? `אלי מסר את הכונן · קיבלתי` : 'הכונן חזר אליי', () => mark(sc, 'p19.took', h2.eli ? null : 'ליאור אישר לפני אלי', `${id}-close`), 'btn', { disabled: !canAct || !started }),
        h('div', { class: 'ed-act' },
          btn(`${id}-close`, 'סגירת יום הצילום', () => closeDay(sc), 'btn btn-primary', { disabled: !canAct || !lock.ok, 'aria-describedby': `${id}-lock` }),
          h('p', { class: lock.ok ? 'hint' : 'ed-miss', id: `${id}-lock` }, lock.ok ? 'אפשר לסגור.' : `עוד חסר: ${lock.missing.join(' · ')}`))));
}
async function count(sc, videos, focusId) {
  if (!P.shootStarted(sc, new Date())) { toast(`יום הצילום ${P.startsText(sc.shootAt)}. המונה נפתח אז.`); return; }
  const target = scriptsCount(sc);
  if (await mark(sc, 'p18.shot', P.shotNote(videos), focusId) && target && videos.length === target) toast(`צולמו כל ${target} הסרטונים.`);
}
async function closeDay(sc) {
  const lock = P.closeLock(cs(sc.client), sc.pre, scriptsCount(sc), { startAt: sc.shootAt, now: new Date() });
  if (!lock.ok) { toast(`עוד חסר: ${lock.missing.join(' · ')}`); return; }
  const keys = notYet(sc, P.CLOSE_KEYS);
  if (keys.length && !await mark(sc, keys, 'בסגירת יום הצילום', `${cardId(sc)}-h`)) return;
  // What really happens next: the server assigns the editor by itself (app/auto-assign.js).
  toast(`יום הצילום נסגר. ${P.afterCloseText(cs(sc.client), sc.pre, sc.ctx)} אלי קיבל ״אפשר לפרמט את הכרטיסים״.`);
  offerHandoff({ client: sc.client, keys: keys.map((k) => sc.pre + k), checks: () => cs(sc.client), me });
}

// The briefing to Eli, the evening before: the drive label and anything else.
function briefingForm(sc, now) {
  const id = `b-${sc.client.id}${sc.n > 1 ? `-r${sc.n}` : ''}`;
  const b = P.briefingOf(cs(sc.client), sc.pre);
  const n = scriptsCount(sc);
  const summary = [`${P.dateWords(sc.shootAt)}: ${scName(sc)}`, `הגעה ${P.clockText(P.arrivalOf(sc.shootAt))} (המשפיענים ${P.clockText(sc.shootAt)})`,
    sc.client.address || null, n ? `${n} תסריטים` : null].filter(Boolean);
  const waText = (label, notes) => [`תדריך ליום צילום · ${summary.join(' · ')}`, label ? P.driveName(label) : null, notes || null, `ללחוץ "קיבלתי" בעמוד ימי הצילום.`].filter(Boolean).join('\n');
  return h('article', { class: 'sh-card sh-briefing', id, 'aria-labelledby': `${id}-h` },
    h('header', { class: 'ed-head' },
      h('h2', { id: `${id}-h`, tabindex: '-1' }, `תדריך לאלי · ${scName(sc)}`),
      h('span', { class: `ed-state ${b?.ack ? 's-done' : b ? 's-qa' : 's-waiting'}` }, b?.ack ? 'אלי אישר' : b ? 'נשלח' : 'עוד לא נשלח')),
    h('p', {}, summary.join(' · ')),
    b ? h('p', { class: b.ack ? 'note-ok' : 'ed-wait' }, `נשלח ${formatWhen(b.at, now)}${b.label ? ` · ${P.driveName(b.label)}` : ''}. ${b.ack ? `אלי אישר ${formatWhen(b.ack, now)}.` : 'אלי עוד לא אישר (ב־20:00 תקבל תזכורת).'}`) : null,
    canAct ? h('form', {
      class: 'sh-brief-form', novalidate: true,
      onsubmit: async (e) => {
        e.preventDefault();
        const label = $(`${id}-label`).value.trim();
        const notes = $(`${id}-notes`).value.trim();
        if (!label) { $(`${id}-err`).textContent = 'כתבו את תווית הכונן.'; $(`${id}-err`).hidden = false; $(`${id}-label`).setAttribute('aria-invalid', 'true'); $(`${id}-label`).focus(); return; }
        const keys = [...notYet(sc, ['p16.drive', 'p16.early'])];
        if (keys.length && !await mark(sc, keys, 'בתדריך לאלי')) return;
        if (await mark(sc, 'p16.brief', P.briefNote(label, notes), `${id}-h`)) toast('התדריך נשלח לאלי. הוא יקבל אותו ב־17:00, ותראה כאן כשיאשר.');
      },
    },
    h('div', { class: 'field' }, h('label', { for: `${id}-label` }, 'תווית הכונן'),
      h('input', { class: 'input', id: `${id}-label`, maxlength: 60, autocomplete: 'off', value: b?.label || '', required: true, 'aria-describedby': `${id}-err` })),
    h('div', { class: 'field' }, h('label', { for: `${id}-notes` }, 'עוד לאלי (לא חובה)'),
      h('textarea', { class: 'input', id: `${id}-notes`, rows: 2, maxlength: 1000 }, b?.notes || '')),
    h('p', { class: 'err', id: `${id}-err`, role: 'alert', hidden: true }),
    h('div', { class: 'ed-act' },
      h('button', { type: 'submit', class: 'btn btn-primary', id: `${id}-send` }, b ? 'עדכון התדריך' : 'שליחת התדריך לאלי'),
      phones.eli ? h('a', { class: 'btn btn-sm btn-ghost', href: whatsappLink(phones.eli, waText(b?.label, b?.notes)), target: '_blank', rel: 'noopener noreferrer' }, 'גם בוואטסאפ') : null)) : null);
}

// ── Start ───────────────────────────────────
$('btn-refresh').addEventListener('click', () => load());
document.addEventListener('visibilitychange', () => { if (!document.hidden && !$('app').hidden && !busy()) load(); });
// The shoot day moves by the minute (the timeline, the quiet mode); data every 2 minutes.
setInterval(() => {
  if ($('app').hidden || document.hidden || busy()) return;
  if (document.activeElement?.matches?.('input[type="text"], input:not([type]), textarea')) return;
  if (Date.now() - lastLoad > 2 * 60e3) { load(); return; }
  renderKeepingFocus();
}, 60e3);

mountSession(async (staff) => {
  const [dir, viewer] = await Promise.all([loadDirectory(), viewerOf(staff.email)]);
  Object.assign(directory, dir);
  me = viewer.me;
  if (me === 'eli') {
    mode = 'eli';
    canAct = true;
  } else if (viewer.scope === 'office' && !viewer.error) {
    mode = 'lior';
    // Lior runs the day; the owner may too (decision 23). The rest of the office watches.
    canAct = me === 'lior' || me === null;
  } else {
    $('no-access').hidden = false;
    $('sh-summary').textContent = viewer.error ? VIEWER_UNKNOWN : '';
    $('btn-refresh').hidden = true;
    return;
  }
  $('sh-h1').textContent = mode === 'eli' ? 'ימי הצילום שלי' : 'מצב יום צילום';
  $('sh-sub').textContent = mode === 'eli'
    ? 'לכל יום צילום: לאן, מתי להגיע, והכונן. ביום עצמו: הגעה, בי־רול, וסיום עם מסירה לליאור.'
    : `ציר הזמן, מונה הסרטונים ונעילת הסיום${canAct ? '' : ' (לצפייה: ליאור מנהל את היום)'}, והתדריך לאלי לפני כל יום צילום.`;
  if (mode === 'lior') phones = await loadStaffPhones().catch(() => ({}));
  mountPush({ who: me || 'owner', card: $('push-card'), button: $('btn-inbox'), dialog: $('dlg-inbox'), changed: () => {} });
  await load();
});
