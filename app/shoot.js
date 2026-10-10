// Shoot days (shoot.html; docs/plan/system-plan.md §3 "אלי הצלם" and Lior's "מצב
// יום צילום", §4 station 4). Two views of the same days:
//  - Eli, "ימי הצילום שלי": per day the date, the client, the address with Waze and
//    Google Maps, his arrival (an hour before the influencers), the number of
//    scripts (and the scripts themselves, read-only, behind one button: his own
//    shoot days only, public.shoot_scripts) and the drive label from Lior's briefing. The evening before: the
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
import { loadChecks, loadCheck, setCheck, clearCheck, setChecksBulk, loadDirectory, loadStaffPhones } from './protocol-data.js';
import { loadWorkClients, loadShootScripts } from './production-data.js';
import { STATUS, scriptLabel, linkName } from './scripts-logic.js';
import {
  $, fill, h, toast, errorText, mountSession, viewerOf, directory, formatWhen, progressBar, store, VIEWER_UNKNOWN,
} from './protocol-ui.js';
import { whatsappLink } from './quote-doc.js';
import { mountPush } from './push.js';
import { offerHandoff } from './handoff-ui.js';
import { dayKeyIL, daysBetweenIL } from './tz.js';
import * as P from './production.js';
import { mountAvailability } from './availability-ui.js';
import { headIcon, leadIcon, icon, iconSquare, sectionHead, emptyState, noteIcon, row, facts, dress } from './kit.js';

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
    h('p', { class: 'sh-addr' }, iconSquare('pin', 'blue', { size: 'sm' }), h('span', {}, h('span', { class: 'ed-k' }, 'כתובת'), sc.client.address || 'אין כתובת בכרטיס. לבקש מליאור.')),
    nav ? h('div', { class: 'sh-nav' },
      h('a', { class: 'btn btn-sm', href: nav.waze, target: '_blank', rel: 'noopener noreferrer' }, 'ניווט ב־Waze'),
      h('a', { class: 'btn btn-sm btn-ghost', href: nav.maps, target: '_blank', rel: 'noopener noreferrer' }, 'Google Maps')) : null);
}
const scriptsCount = (sc) => P.videosPerDay(sc.ctx);
// The page's one status sentence, as a notice strip (app/kit.js): the words are the same.
function say(text, kind = 'info', name = 'camera') {
  const el = $('sh-summary');
  el.textContent = text;
  if (text) noteIcon(el, kind, name);
}
// A card's heading with its icon square.
const cardHead = (id, text, name, tone) => headIcon(h('h2', { id: `${id}-h`, tabindex: '-1' }, text), name, tone, { size: 'md' });

// ── The raw material and the chosen take, per script (protocol v10; docs/ops.md, section 58) ──
// Next to every script of the day: the number of its file (or clip) and the take that was
// chosen. Two short fields a row, typed in a second and saved by themselves; Lior (next to
// his counter) and Eli (in his day) fill the same list, and the editor reads it on his
// page. Not required, and it holds nothing open. One mark per shoot round (P.FILES_KEY):
// before a row is written the mark is read again, so two phones do not overwrite each other.
const fileDrafts = new Map(); // what is typed in a field and not saved yet (the page redraws by the minute)
const filesOpen = new Set();  // the lists that were opened: kept across redraws
const draftKey = (sc, n, f) => `${sc.client.id}:${sc.pre}:${n}:${f}`;
function filesBlock(sc) {
  const id = cardId(sc);
  const c = cs(sc.client);
  const files = P.filesOf(c, sc.pre);
  const target = scriptsCount(sc);
  const rows = P.fileRows(files, target, P.shotOf(c, sc.pre));
  const field = (r, f, label, max) => h('input', {
    class: 'input num sh-file-in', id: `${id}-f${r.n}-${f}`, type: 'text', inputmode: 'numeric', dir: 'ltr', autocomplete: 'off', enterkeyhint: 'next',
    maxlength: String(max), disabled: !canAct, 'aria-label': `${label}, סרטון ${r.n}`,
    value: fileDrafts.has(draftKey(sc, r.n, f)) ? fileDrafts.get(draftKey(sc, r.n, f)) : r[f],
    oninput: (e) => fileDrafts.set(draftKey(sc, r.n, f), e.currentTarget.value),
    onchange: () => saveFile(sc, r.n),
  });
  return h('details', {
    class: 'ed-more sh-files', id: `${id}-files`, open: filesOpen.has(id),
    ontoggle: (e) => { if (e.currentTarget.open) filesOpen.add(id); else filesOpen.delete(id); },
  },
  // (One run of text next to the icon: on a phone the count wraps under the title, not beside it.)
  leadIcon(h('summary', {}, h('span', { class: 'sh-files-t' }, 'חומר גלם וטייק לכל תסריט', h('span', { class: 'muted sh-files-n', id: `${id}-files-n` }, ` · ${P.filesHint(files, target)}`))), 'drive'),
  h('p', { class: 'hint' }, 'ליד כל סרטון: מספר הקובץ והטייק שנבחר. לא חובה. נשמר לבד, והעורך רואה את זה בעמוד שלו.'),
  h('div', { class: 'sh-file-head', 'aria-hidden': 'true' }, h('span', {}, 'סרטון'), h('span', {}, 'קובץ'), h('span', {}, 'טייק')),
  h('ol', { class: 'sh-file-rows' }, ...rows.map((r) => h('li', { class: 'sh-file-row' },
    h('span', { class: 'num sh-file-n' }, String(r.n)),
    field(r, 'raw', 'מספר הקובץ', P.RAW_MAX),
    field(r, 'take', 'הטייק שנבחר', P.TAKE_MAX)))));
}
// One save at a time: each one reads the list as it is on the server, sets its row and writes.
// Two fields left one after the other would otherwise both read the old list, and the second
// write would lose the first row.
let fileSaves = Promise.resolve();
function saveFile(sc, n) {
  fileSaves = fileSaves.then(() => saveFileNow(sc, n), () => saveFileNow(sc, n));
  return fileSaves;
}
async function saveFileNow(sc, n) {
  const id = cardId(sc);
  const raw = $(`${id}-f${n}-raw`)?.value ?? '';
  const take = $(`${id}-f${n}-take`)?.value ?? '';
  const key = `${sc.pre}${P.FILES_KEY}`;
  const c = cs(sc.client);
  try {
    const latest = await loadCheck(sc.client.id, key);
    if (latest) c[key] = latest; else delete c[key];
  } catch { /* not read: the row is set on what this page holds */ }
  const files = P.withFile(P.filesOf(c, sc.pre), n, raw, take);
  const note = P.filesNote(files);
  try {
    if (note) c[key] = await setCheck(sc.client.id, key, 'done', note);
    else if (c[key]) { await clearCheck(sc.client.id, key); delete c[key]; }
  } catch (err) {
    toast(`לא נשמר. ${errorText(err)}`);
    return;
  }
  fileDrafts.delete(draftKey(sc, n, 'raw'));
  fileDrafts.delete(draftKey(sc, n, 'take'));
  // Only the count is rewritten: the fields keep the focus, so the next row is typed at once.
  const hint = P.filesHint(files, scriptsCount(sc));
  if ($(`${id}-files-n`)) $(`${id}-files-n`).textContent = ` · ${hint}`;
  if ($(`${id}-numbered`)) $(`${id}-numbered`).textContent = `${hint}.`;
}

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
  say(next ? `הקרוב: ${P.dayWords(next.shootAt, now)} · ${scName(next)} · הגעה ${P.clockText(P.arrivalOf(next.shootAt))}` : '', 'info', 'clock');
  fill($('sh-list'), days.length ? days.map((sc) => eliCard(sc, now))
    : emptyState({ icon: 'calendar', tone: 'blue', text: 'אין ימי צילום בחודש הקרוב. כשיום צילום ייסגר, הוא יופיע כאן.' }));
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
      cardHead(id, `${P.dayWords(sc.shootAt, now) === 'היום' ? 'היום' : P.dateWords(sc.shootAt)} · ${scName(sc)}`, 'camera', today ? 'pink' : 'teal'),
      today ? h('span', { class: 'ed-state s-editing' }, 'יום צילום היום') : null),
    h('dl', { class: 'sh-facts' },
      h('dt', {}, 'ההגעה שלך'), h('dd', { class: 'num' }, `${P.clockText(P.arrivalOf(sc.shootAt))} · שעה לפני המשפיענים (${P.clockText(sc.shootAt)})`),
      h('dt', {}, 'תסריטים'), h('dd', {}, n ? `${n} סרטונים` : 'לפי מה שליאור יביא',
        h('button', { type: 'button', class: 'btn btn-sm sh-scripts-btn', id: `${id}-scripts`, 'aria-haspopup': 'dialog', onclick: () => openScripts(sc) }, 'לקרוא את התסריטים')),
      // From the briefing's hour on (and on the day itself) "will fill it in" is no longer true.
      h('dt', {}, 'תווית הכונן'), h('dd', {}, label || (eveOrDay ? 'ליאור עוד לא מילא' : 'ליאור ימלא בתדריך'))),
    placeBlock(sc),
    readLine(sc, now),
    b ? briefingForEli(sc, b) : h('p', { class: 'muted' }, eveOrDay ? 'התדריך: ליאור עוד לא מילא.' : 'התדריך של ליאור יגיע בערב שלפני, ב־17:00.'),
    eveOrDay && !isDone(sc, 'p17b.arrived') ? gearBlock(sc) : null,
    today || isDone(sc, 'p17b.arrived') ? eliDay(sc, now) : null);
}

// "קראתי את התסריטים" (protocol v10; the photographer's protocol, step 2): one tick per shoot
// day. Not ticked by 20:00 the evening before, Lior's evening line says so (the rule `briefing`).
function readLine(sc, now) {
  const id = cardId(sc);
  const at = atOf(sc, 'p16.read');
  return h('div', { class: 'sh-read' }, at
    ? h('p', { class: 'note-ok', id: `${id}-read-ok` }, `קראת את התסריטים ${formatWhen(at, now)}. ליאור רואה.`)
    : btn(`${id}-read`, 'קראתי את התסריטים', () => mark(sc, 'p16.read', 'אלי קרא את התסריטים', `${id}-h`), 'btn btn-sm'));
}

function briefingForEli(sc, b) {
  const id = cardId(sc);
  return h('section', { class: 'sh-brief', 'aria-labelledby': `${id}-bh` },
    headIcon(h('h3', { id: `${id}-bh` }, 'התדריך מליאור'), 'megaphone', 'orange'),
    b.label ? h('p', {}, P.driveName(b.label)) : null,
    b.notes ? h('p', { class: 'ed-note' }, b.notes) : null,
    b.ack ? h('p', { class: 'note-ok' }, `אישרת ${formatWhen(b.ack)}. ליאור רואה.`)
      : btn(`${id}-ack`, 'קיבלתי', () => mark(sc, 'p16.photographer', 'אלי אישר את התדריך', `${id}-h`), 'btn k-btn-navy'));
}

// The gear list: ticks kept on this phone until all four are done (then one mark).
function gearBlock(sc) {
  const id = cardId(sc);
  if (isDone(sc, 'p17b.gear')) return h('p', { class: 'note-ok' }, 'הציוד מוכן: סוללות, כרטיסים, מיקרופונים ותאורה.');
  const key = (g) => `gear.${sc.client.id}.${sc.n}.${g}`;
  return h('fieldset', { class: 'prod-checks sh-gear' },
    leadIcon(h('legend', {}, 'ציוד לערב שלפני'), 'box'),
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
      btn(`${id}-yes`, 'כן', () => mark(sc, ['p17b.brollq', ...notYet(sc, ['p17b.broll', 'p17b.zones', 'p17b.variety'])], null, `${id}-h`), 'btn k-btn-navy'),
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
        h('p', { class: 'hint', id: `${id}-lock` }, open.length ? `נפתח אחרי ${open.length === 1 ? 'הפריט שנשאר' : `${open.length} הפריטים שנשארו`} ברשימה.` : 'ליאור מאשר מצדו, והמסירה נרשמת פעם אחת.'),
        // "לכל חומר ברור לאיזה מספר סרטון הוא שייך" (p18b.numbered) closes with the handoff: how many scripts have a file by now.
        h('p', { class: 'hint sh-numbered', id: `${id}-numbered` }, `${P.filesHint(P.filesOf(c, sc.pre), scriptsCount(sc))}.`))) : null;
  return h('div', { class: 'sh-day' },
    arrival,
    broll,
    arrived ? filesBlock(sc) : null,
    h('details', { class: 'ed-more' }, leadIcon(h('summary', {}, 'הנחיות הצילום'), 'list'),
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

// The scripts of this shoot day, to read (title, text, order, inspiration links).
// The database gives them only for Eli's own shoot days, from the day the shoot is
// in his list until the day after it; nothing here can be changed.
const scriptsDlg = $('dlg-scripts');
// The dialog's head takes its icon square (app/kit.js); the title is rewritten on every opening.
dress(scriptsDlg, [['.dlg-head h2', 'file', 'blue', 'md']]);
scriptsDlg.addEventListener('click', (e) => { if (e.target.closest('[data-close]') || e.target === scriptsDlg) scriptsDlg.close(); });
let scriptsBack = null;
scriptsDlg.addEventListener('close', () => { document.getElementById(scriptsBack)?.focus(); });
async function openScripts(sc) {
  scriptsBack = `${cardId(sc)}-scripts`;
  $('scr-h').textContent = `התסריטים · ${scName(sc)}`;
  $('scr-sum').textContent = 'טוען…';
  fill($('scr-list'));
  scriptsDlg.showModal();
  $('scr-h').focus();
  let data;
  try {
    data = await loadShootScripts(sc.client.id);
  } catch {
    $('scr-sum').textContent = 'התסריטים לא נטענו. נסו שוב; אם זה חוזר, לבקש מליאור.';
    return;
  }
  const list = (data?.scripts || []).filter((s) => s.round === sc.n);
  $('scr-sum').textContent = list.length
    ? `${list.length === 1 ? 'תסריט אחד' : `${list.length} תסריטים`}, לפי סדר הצילום. לקריאה בלבד.`
    : 'ליאור עוד לא כתב כאן תסריטים ליום הזה. כשייכתבו, הם יופיעו כאן.';
  fill($('scr-list'), list.map((s) => h('li', { class: 'sh-script' },
    h('h3', {}, scriptLabel(s.n), s.title ? ` · ${s.title}` : '', s.status === 'draft' ? h('span', { class: 'tag tag-warn' }, `${STATUS.draft}: עוד יכול להשתנות`) : null),
    s.body ? h('p', { class: 'sh-script-body' }, s.body) : null,
    s.links?.length ? h('ul', { class: 'sh-script-links', 'aria-label': 'קישורים להשראה' }, s.links.map((l) => h('li', {},
      h('a', { href: l, target: '_blank', rel: 'noopener noreferrer', dir: 'ltr' }, linkName(l), h('span', { class: 'sr-only' }, ' (נפתח בחלון חדש)'))))) : null)));
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
  say(today.length ? `יום צילום היום: ${today.map(scName).join(', ')}` : 'אין היום יום צילום.', today.length ? 'late' : 'info', today.length ? 'video' : 'sun');
  fill($('sh-list'),
    ...today.map((sc) => shootMode(sc, now)),
    ...briefs.map((sc) => briefingForm(sc, now)),
    later.length ? h('section', { class: 'prod-sec k-sec', 'aria-labelledby': 'later-h' },
      sectionHead({ icon: 'calendar', tone: 'blue', id: 'later-h', title: 'ימי הצילום הבאים', hint: 'מה שכבר נקבע, לפי הסדר.', count: later.length }),
      // Each day is a row: the date and the hour first, the client under them.
      h('ul', { class: 'sh-later k-rows' }, ...later.map((sc) => row({ tag: 'li', icon: 'camera', tone: 'teal',
        title: h('span', { class: 'num' }, `${P.dateWords(sc.shootAt)} ${P.clockText(sc.shootAt)}`),
        sub: [h('i', { class: 'k-sep' }, ' · '), scName(sc)] })))) : null,
    !today.length && !briefs.length && !later.length ? emptyState({ icon: 'calendar', tone: 'blue', text: 'אין ימי צילום קרובים.' }) : null);
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
      cardHead(id, `מצב יום צילום · ${scName(sc)}`, 'video', 'pink'),
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
    started ? filesBlock(sc) : null,
    h('ol', { class: 'sh-timeline' }, ...tl.map((x) => h('li', { class: `${x.at <= now ? 'is-past' : ''}${x === nextPoint ? ' is-next' : ''}${x.prompt ? ' is-prompt' : ''}` },
      h('span', { class: 'num sh-t' }, P.clockText(x.at)), h('span', { class: x.prompt ? 'sh-prompt' : null }, x.prompt ? icon('clock', { size: 16 }) : null, x.label), x === nextPoint ? h('span', { class: 'sr-only' }, ' (הבא)') : null))),
    h('p', { class: 'sh-fixed' }, 'להחזיק את הראיונות על המסר.'),
    // Eli, at a glance.
    h('dl', { class: 'sh-facts' },
      h('dt', {}, 'אלי'), h('dd', {}, arrived ? `הגיע ${P.clockText(arrived)}${h2.lior || closed ? ' · הכונן אצל ליאור' : isDone(sc, 'p17b.drive') ? ' · הכונן אצלו' : ''}` : h2.lior || closed ? 'הכונן אצל ליאור' : `עוד לא סימן הגעה (הגעה ${P.clockText(P.arrivalOf(sc.shootAt))})`),
      h('dt', {}, 'בי־רול'), h('dd', {}, !brollq ? '—' : brollq.note === 'no' ? (isDone(sc, 'p17b.broll') ? 'הושלם באיחור' : 'לא גמור') : 'גמור'),
      h('dt', {}, 'סיום'), h('dd', {}, h2.eli ? `מסר את הכונן ${P.clockText(h2.eli)}` : `${P.FINISH.length - P.finishOpen(c, sc.pre).length} מתוך ${P.FINISH.length} ברשימה`)),
    // Closing: the lock (testimonial, the full quantity, the drive back and confirmed by both).
    closed ? h('p', { class: 'note-ok' }, `יום הצילום נסגר ${formatWhen(st.completedAt, now)}. ${P.afterCloseText(c, sc.pre, sc.ctx)}`)
      : h('section', { class: 'sh-close', 'aria-labelledby': `${id}-close-h` },
        headIcon(h('h3', { id: `${id}-close-h` }, 'סגירת היום'), 'lock', 'navy'),
        h('label', { class: 'prod-check', for: `${id}-testimonial` },
          h('input', { type: 'checkbox', id: `${id}-testimonial`, class: 'cbx', checked: isDone(sc, 'p19.testimonial'), disabled: !canAct || !started, onchange: (e) => (e.currentTarget.checked ? mark(sc, 'p19.testimonial', null, `${id}-testimonial`) : unmark(sc, 'p19.testimonial', `${id}-testimonial`)) }),
          h('span', {}, 'צולם סרטון המלצה של הלקוח עם המשפיענים')),
        target ? null : h('label', { class: 'prod-check', for: `${id}-all` },
          h('input', { type: 'checkbox', id: `${id}-all`, class: 'cbx', checked: isDone(sc, 'p18.all'), disabled: !canAct || !started, onchange: (e) => (e.currentTarget.checked ? mark(sc, 'p18.all', null, `${id}-all`) : unmark(sc, 'p18.all', `${id}-all`)) }),
          h('span', {}, 'צולמה כל הכמות (אין כמות בחבילה בכרטיס)')),
        h2.lior ? h('p', { class: 'note-ok' }, `אישרת שהכונן חזר ${P.clockText(h2.lior)}.${h2.eli ? '' : ' אלי עוד לא סימן מסירה.'}`)
          : btn(`${id}-took`, h2.eli ? `אלי מסר את הכונן · קיבלתי` : 'הכונן חזר אליי', () => mark(sc, 'p19.took', h2.eli ? null : 'ליאור אישר לפני אלי', `${id}-close`), 'btn', { disabled: !canAct || !started }),
        h('div', { class: 'ed-act' },
          btn(`${id}-close`, 'סגירת יום הצילום', () => closeDay(sc), 'btn k-btn-navy', { disabled: !canAct || !lock.ok, 'aria-describedby': `${id}-lock` }),
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
  // What really happens next: Ofir is rung to assign the editor (protocol v9, the rule `fast`).
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
      cardHead(id, `תדריך לאלי · ${scName(sc)}`, 'megaphone', 'orange'),
      h('span', { class: `ed-state ${b?.ack ? 's-done' : b ? 's-qa' : 's-waiting'}` }, b?.ack ? 'אלי אישר' : b ? 'נשלח' : 'עוד לא נשלח')),
    // The same facts, each with its own small icon.
    facts([['calendar', summary[0]], ['clock', summary[1]], sc.client.address ? ['pin', sc.client.address] : null, n ? ['file', `${n} תסריטים`] : null]),
    b ? h('p', { class: b.ack ? 'note-ok' : 'ed-wait' }, `נשלח ${formatWhen(b.at, now)}${b.label ? ` · ${P.driveName(b.label)}` : ''}. ${b.ack ? `אלי אישר ${formatWhen(b.ack, now)}.` : 'אלי עוד לא אישר (ב־20:00 תקבל תזכורת).'}`) : null,
    // v10: whether he read the scripts of this day (his own tick).
    h('p', { class: atOf(sc, 'p16.read') ? 'note-ok' : 'ed-wait', id: `${id}-read` }, atOf(sc, 'p16.read') ? `אלי קרא את התסריטים ${formatWhen(atOf(sc, 'p16.read'), now)}.` : 'אלי עוד לא סימן שקרא את התסריטים.'),
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
      h('button', { type: 'submit', class: 'btn k-btn-navy', id: `${id}-send` }, b ? 'עדכון התדריך' : 'שליחת התדריך לאלי'),
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
  // The photographer's monthly availability (docs/ops.md, section 39): its own mount point, above the shoot days.
  mountAvailability($('availability'), { me });
  // The cards other modules draw on this page take their icon square (app/kit.js).
  dress($('app'), [['#availability h2#av-h', 'calendar-check', 'teal'], ['#availability summary#av-h > strong', 'calendar-check', 'teal'], ['#na-h', 'lock', 'navy']]);
  await load();
});
