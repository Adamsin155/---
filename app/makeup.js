// makeup.html, "הימים שלי עם נטלי": the one screen of Tal, Natali Dadon's makeup artist (the owner's
// request of 15.11.2026; docs/ops.md, section 132). Each upcoming shoot day with Natali is one card:
// the date and the hour of the shoot, the businesses of that day, and where her answer stands.
// "מאשרת" is saved only with the hour she arrives at Natali's home, which she types; "לא יכולה"
// tells Lior at once. She can change either later. She sees nothing else: the database answers her
// only through public.makeup_my_days() and public.makeup_answer() (app/makeup-data.js).
// The logic is app/makeup-logic.js.
import { PEOPLE, isMakeup } from './protocol.js';
import {
  MAKEUP_TITLE, daysFromRows, upcoming, answerFor, statusOf, STATUS_WORDS, hourText, dayWords, readHour, hourProblem, shortHour,
} from './makeup-logic.js';
import { loadMakeupDays, saveMakeupAnswer } from './makeup-data.js';
import { $, h, toast, errorText, mountSession, viewerOf, leafOf } from './protocol-ui.js';
import { mountPush } from './push.js';
import { dateLeaf, headIcon, pill, emptyState } from './kit.js';

headIcon($('mk-h1'), 'camera', 'pink', { size: 'md' });
headIcon($('na-h'), 'lock', 'navy', { size: 'md' });

let days = [];
let answers = [];
let busy = false;
const editing = new Set(); // days whose hour is being changed after "אישרת"
const drafts = new Map(); // what she typed, kept across a redraw
const TONE = { open: 'warn', yes: 'ok', no: 'late', again: 'warn' };

// The database's refusals in her words.
function answerError(err) {
  const m = String(err?.message || '');
  if (/before the shoot/.test(m)) return 'השעה צריכה להיות לפני הצילום';
  if (/required/.test(m)) return 'צריך לכתוב באיזו שעה את מגיעה לנטלי';
  if (/passed/.test(m)) return 'היום הזה כבר עבר';
  if (/no shoot day/.test(m)) return 'יום הצילום הזה כבר לא במערכת. רעננו את הדף.';
  return `לא נשמר. ${errorText(err)}`;
}

function card(d) {
  const a = answerFor(d, answers);
  const s = statusOf(d, a);
  const k = d.day;
  const open = s !== 'yes' || editing.has(k);
  const several = d.cases.length > 1;
  const who = d.cases.map((c) => (several ? `${c.business} · ${hourText(c.shootAt)}` : c.business)).join('\n');
  const err = h('p', { class: 'err mk-err', id: `mk-err-${k}`, role: 'alert', hidden: true });
  const field = h('input', {
    class: 'input mk-hour', id: `mk-hour-${k}`, type: 'text', inputmode: 'numeric', dir: 'ltr', maxlength: '5', autocomplete: 'off',
    placeholder: '07:30', value: drafts.get(k) ?? (s === 'yes' ? shortHour(a.arrive_time) : ''), 'aria-describedby': `mk-err-${k}`,
    oninput: (ev) => { drafts.set(k, ev.currentTarget.value); if (!err.hidden) { err.hidden = true; ev.currentTarget.removeAttribute('aria-invalid'); } },
    onkeydown: (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); confirm(d); } },
  });
  return h('li', { class: `mk-card is-${s}`, id: `mk-${k}` },
    h('div', { class: 'mk-top' },
      dateLeaf({ ...leafOf(d.shootAt), label: `${dayWords(d.shootAt)} ${hourText(d.shootAt)}` }),
      h('div', { class: 'mk-what' },
        h('h2', { class: 'mk-when' }, `צילום עם נטלי · ${dayWords(d.shootAt)} · ${hourText(d.shootAt)}`),
        h('p', { class: 'mk-who' }, who),
        pill(s === 'yes' ? `${STATUS_WORDS.yes} · מגיעה ב־${shortHour(a.arrive_time)}` : STATUS_WORDS[s], TONE[s], { id: `mk-st-${k}` }))),
    open
      ? h('div', { class: 'mk-form' },
        h('label', { class: 'mk-label', for: `mk-hour-${k}` }, 'באיזו שעה את מגיעה לנטלי?'),
        h('div', { class: 'mk-acts' },
          field,
          h('button', { type: 'button', class: 'btn k-btn-navy mk-yes', id: `mk-yes-${k}`, disabled: busy, onclick: () => confirm(d) }, 'מאשרת'),
          s === 'no' ? null : h('button', { type: 'button', class: 'btn btn-ghost mk-no', id: `mk-no-${k}`, disabled: busy, onclick: () => decline(d) }, 'לא יכולה'),
          s === 'yes' ? h('button', { type: 'button', class: 'btn-text', id: `mk-cancel-${k}`, disabled: busy, onclick: () => { editing.delete(k); drafts.delete(k); render(); } }, 'ביטול') : null),
        err)
      : h('div', { class: 'mk-acts' },
        h('button', { type: 'button', class: 'btn btn-ghost', id: `mk-change-${k}`, disabled: busy, onclick: () => { editing.add(k); render(`mk-hour-${k}`); } }, 'שינוי שעה'),
        h('button', { type: 'button', class: 'btn btn-ghost mk-no', id: `mk-no-${k}`, disabled: busy, onclick: () => decline(d) }, 'לא יכולה')));
}

function render(focus = null) {
  const list = $('mk-list');
  const ahead = upcoming(days, new Date());
  list.replaceChildren(...ahead.map(card));
  $('mk-empty').replaceChildren(ahead.length ? '' : emptyState({ icon: 'calendar', tone: 'pink', text: 'אין כרגע ימי צילום עם נטלי. כשייקבע יום, תגיע הודעה לטלפון.' }));
  if (focus) $(focus)?.focus();
}

async function confirm(d) {
  if (busy) return;
  const k = d.day;
  const field = $(`mk-hour-${k}`);
  const err = $(`mk-err-${k}`);
  const problem = hourProblem(field.value, d);
  if (problem) {
    err.textContent = problem;
    err.hidden = false;
    field.setAttribute('aria-invalid', 'true');
    field.focus();
    return;
  }
  await save(d, 'yes', readHour(field.value), 'נשמר. ליאור קיבל הודעה.');
}
async function decline(d) {
  if (busy) return;
  await save(d, 'no', null, 'נשמר. ליאור קיבל הודעה ויסדר מאפרת אחרת.');
}
async function save(d, answer, hour, done) {
  busy = true;
  render();
  try {
    await saveMakeupAnswer(d.day, answer, hour);
    editing.delete(d.day);
    drafts.delete(d.day);
    busy = false;
    await load();
    toast(done);
    $(`mk-st-${d.day}`)?.focus?.();
  } catch (err) {
    busy = false;
    render();
    const box = $(`mk-err-${d.day}`);
    if (box) { box.textContent = answerError(err); box.hidden = false; } else toast(answerError(err));
  }
}

async function load() {
  try {
    const r = await loadMakeupDays();
    if (r === null) { $('state').textContent = 'המסך עוד לא הוקם במערכת. פנו למנהל המערכת.'; return; }
    days = daysFromRows(r.days);
    answers = r.answers;
    $('state').textContent = '';
    if (!busy) render();
  } catch (err) {
    $('state').textContent = `הימים לא נטענו. ${errorText(err)}`;
  }
}

mountSession(async (staff) => {
  const viewer = await viewerOf(staff.email);
  const me = viewer.me;
  if (!isMakeup(me)) { $('no-access').hidden = false; return; }
  $('mk-main').hidden = false;
  document.title = `${MAKEUP_TITLE} · ${PEOPLE[me].name} · astrateg`;
  mountPush({ who: me, card: $('push-card'), button: $('btn-inbox'), dialog: $('dlg-inbox') });
  $('state').textContent = 'טוען…';
  await load();
  document.addEventListener('visibilitychange', () => { if (!document.hidden && !busy) load(); });
  setInterval(() => { if (!document.hidden && !busy && !editing.size && !drafts.size) load(); }, 60e3);
});
