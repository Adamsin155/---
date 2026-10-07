// The photographer's monthly availability on the screens (docs/ops.md, section 39;
// the rules are app/availability-logic.js, the database enforces them:
// supabase/migrations/20261016100000_photographer_availability.sql).
//   mountAvailability(el, { me })   one mount point.
//     The photographer (shoot.html): a compact card above his shoot days. Until next
//     month is handed over: the month as a grid of big days, "אין לי ימים פנויים בחודש
//     הזה", and one submit. After it: one line, with "עדכון" and "בלת״ם".
//     The owner, Irit, Lior and Ofir (prep.html, shoot.html): one folded line with what
//     he handed over; the owner, Irit and Lior can enter it in his name after a call.
//     Anyone else: nothing.
//   shootDayHint(input, { me, own })   the line next to a shoot date being picked:
//     whether he marked that day free, it is taken, not free, or not handed over yet.
//   confirmShootDay({ shootAt, charAt, own, me })   the confirmation before a shoot date
//     is saved. A day he did not mark free (or that already has a shoot day) asks for a
//     short reason, kept with the date change (public.date_change_note); it is a
//     warning, never a block. Anything else is asked as before (confirmShootDate).
// Before the migration ran, the tables are not there: nothing is shown and nothing asked.
import { supabase } from './supa.js';
import { h, fill, toast, errorText, store, formatWhen, confirmShootDate } from './protocol-ui.js';
import { parseDate } from './protocol-logic.js';
import { shootDateConcerns } from './shoot-prep.js';
import { dayText, timeText } from './messages-logic.js';
import { dayKeyIL } from './tz.js';
import * as A from './availability-logic.js';

if (typeof document !== 'undefined' && !document.querySelector('link[href="app/styles/availability.css"]')) {
  document.head.append(h('link', { rel: 'stylesheet', href: 'app/styles/availability.css' }));
}

// ── Data ───────────────────────────────────
const MONTH_COLS = 'person, month, days, none, submitted_at, updated_at, by_person';
const CHANGE_COLS = 'id, person, reported_at, reported_month, days, shoot_days, note';
const notThere = (err) => ['42P01', '42883', 'PGRST202', 'PGRST205'].includes(err?.code) || /does not exist|Could not find/i.test(String(err?.message || ''));
// `me`: the person key, null for the owner.
export const canSee = (me) => A.PHOTOGRAPHERS.includes(me) || A.READERS.includes(me ?? 'owner');
const isPhotographer = (me) => A.PHOTOGRAPHERS.includes(me);

// The months `from`..`to` ('YYYY-MM'): what was handed over, the unexpected changes
// and the days a shoot day sits on. null when the tables are not there yet.
export async function loadAvailability(from, to = from) {
  const [m, c, t] = await Promise.all([
    supabase.from('photographer_months').select(MONTH_COLS).gte('month', `${from}-01`).lte('month', `${to}-01`).order('month'),
    supabase.from('photographer_changes').select(CHANGE_COLS).gte('reported_month', `${A.addMonths(from, -3)}-01`).order('reported_at', { ascending: false }),
    supabase.rpc('photographer_taken', { p_from: `${from}-01`, p_to: A.monthDays(to).at(-1) }),
  ]);
  const err = m.error || c.error || t.error;
  if (err) { if (notThere(err)) return null; throw err; }
  return { months: m.data || [], changes: c.data || [], taken: Object.fromEntries((t.data || []).map((r) => [String(r.day).slice(0, 10), r.n])) };
}
async function rpc(name, args) {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw error;
  return data;
}

// ── The month as a grid ────────────────────
// `picked`: the days marked free. `onToggle`: null for a grid that is only read.
function monthGrid({ id, month, picked, taken, changed, today, onToggle = null, held = () => false }) {
  const days = A.monthDays(month);
  const cells = Array.from({ length: A.weekdayOfDay(days[0]) }, () => h('span', { class: 'av-cell is-blank', 'aria-hidden': 'true' }));
  for (const day of days) {
    const n = +day.slice(8, 10);
    const isTaken = A.takenOn(taken, day) > 0;
    const on = picked.has(day);
    const off = !on && changed.has(day);
    const past = day < today;
    const words = `${A.dayLong(day)}: ${isTaken ? 'קבוע יום צילום' : on ? 'פנוי' : off ? 'ירד בבלת״ם' : 'לא פנוי'}`;
    const cls = `av-cell${on ? ' is-free' : ''}${isTaken ? ' is-taken' : ''}${off ? ' is-off' : ''}${past ? ' is-past' : ''}`;
    const face = [h('span', { class: 'av-n', 'aria-hidden': 'true' }, String(n)), isTaken ? h('span', { class: 'av-tag', 'aria-hidden': 'true' }, 'צילום') : null];
    if (!onToggle || isTaken || past) {
      cells.push(h('span', { class: cls, role: 'img', 'aria-label': words, 'data-day': day }, ...face));
    } else {
      cells.push(h('button', {
        type: 'button', class: cls, 'data-day': day, 'aria-pressed': String(on), 'aria-label': words, 'aria-disabled': held(day) ? 'true' : null,
        onclick: () => onToggle(day),
      }, ...face));
    }
  }
  return h('div', { class: 'av-month', id, role: 'group', 'aria-label': `הימים של ${A.monthName(month)}` },
    h('div', { class: 'av-week', 'aria-hidden': 'true' }, ...A.WEEKDAYS.map((w) => h('span', {}, w))),
    h('div', { class: 'av-grid' }, ...cells));
}
const legend = (withOff) => h('p', { class: 'av-legend', 'aria-hidden': 'true' },
  h('span', { class: 'av-key is-free' }, 'פנוי'), h('span', { class: 'av-key is-taken' }, 'קבוע יום צילום'), withOff ? h('span', { class: 'av-key is-off' }, 'ירד בבלת״ם') : null);

// ── The mount point ────────────────────────
export async function mountAvailability(el, { me, clock = () => new Date() } = {}) {
  if (!el || !canSee(me)) return;
  const self = isPhotographer(me);
  let data = null;
  let view = 'main';        // 'main' | 'edit' | 'change' (the photographer); 'main' | month key being entered in his name (the office)
  let draft = new Set();    // the days being marked
  let none = false;
  let picks = [];           // the days of an unexpected change being reported
  let note = '';
  let message = null;       // what stopped the last action, in words
  let busy = false;
  let open = location.hash === '#availability';
  const draftKey = (person, month) => `avail.draft.${person}.${month}`;

  async function refresh() {
    const ask = A.askOf(clock());
    try { data = await loadAvailability(ask.current, ask.month); } catch { data = null; }
    render();
  }
  const say = (text) => { message = text; render('av-msg'); };
  const startDraft = (person, month, row) => {
    draft = A.freeDays(row);
    none = !!row?.none;
    if (!row) {
      try { const v = JSON.parse(store.get(draftKey(person, month)) || 'null'); if (v && Array.isArray(v.days)) { draft = new Set(v.days.filter((d) => A.monthOfDay(d) === month)); none = !!v.none && !draft.size; } } catch { /* no draft */ }
    }
  };
  const keepDraft = (person, month) => store.set(draftKey(person, month), JSON.stringify({ days: [...draft], none }));

  function render(focusId = null) {
    if (!data) { el.hidden = true; fill(el); return; }
    el.hidden = false;
    const now = clock();
    fill(el, ...(self ? selfView(now) : A.PHOTOGRAPHERS.map((p) => officeView(p, now))));
    if (focusId) document.getElementById(focusId)?.focus({ preventScroll: true });
  }

  // The editable month, shared by the photographer's card and the office's entry in his name.
  function editor({ person, month, row, now, onBehalf, submitLabel, cancel }) {
    const today = dayKeyIL(now);
    const locked = !onBehalf && !!row && A.removalLocked(month, now);
    const kept = A.freeDays(row);
    const heldBack = (day) => !onBehalf && kept.has(day) && locked;
    const toggle = (day) => {
      if (busy) return;
      if (draft.has(day)) {
        if (heldBack(day)) { say(A.TEXT.locked); return; }
        draft.delete(day);
      } else { draft.add(day); none = false; }
      message = null;
      if (!row && !onBehalf) keepDraft(person, month);
      render(null);
      el.querySelector(`[data-day="${day}"]`)?.focus({ preventScroll: true });
    };
    const n = draft.size;
    const send = async () => {
      if (busy) return;
      const problem = A.submitProblem({ month, days: [...draft], none, row, taken: data.taken, now, onBehalf });
      if (problem) { say(problem.text); return; }
      busy = true; render();
      try {
        await rpc('photographer_submit', { p_month: `${month}-01`, p_days: [...draft].sort(), p_none: none, ...(onBehalf ? { p_person: person } : {}) });
        store.set(draftKey(person, month), '');
        view = 'main'; message = null; busy = false;
        toast(onBehalf ? `הזמינות של ${A.personName(person)} ל${A.monthName(month)} נשמרה.` : row ? 'הזמינות עודכנה.' : `הזמינות ל${A.monthName(month)} נמסרה. עירית וליאור רואים אותה.`);
        clearCache();
        await refresh();
        document.getElementById('av-h')?.focus({ preventScroll: true });
      } catch (err) {
        busy = false;
        say(A.refusalText(err) || `לא נשמר. ${errorText(err)}`);
      }
    };
    return [
      monthGrid({ id: 'av-grid', month, picked: draft, taken: data.taken, changed: A.changedDays(data.changes, person), today, onToggle: toggle, held: heldBack }),
      legend(false),
      h('label', { class: 'av-none', for: 'av-none' },
        h('input', {
          type: 'checkbox', class: 'cbx', id: 'av-none', checked: none, disabled: busy || n > 0,
          onchange: (e) => { none = e.currentTarget.checked; message = null; if (!row && !onBehalf) keepDraft(person, month); render('av-none'); },
        }),
        h('span', {}, onBehalf ? 'אין לו ימים פנויים בחודש הזה' : 'אין לי ימים פנויים בחודש הזה')),
      locked ? h('p', { class: 'hint' }, A.TEXT.locked) : null,
      h('p', { class: 'err', id: 'av-msg', role: 'alert', tabindex: '-1', hidden: !message }, message || ''),
      h('div', { class: 'av-act' },
        h('button', { type: 'button', class: 'btn av-go', id: 'av-submit', disabled: busy, onclick: send },
          submitLabel(n, none)),
        cancel ? h('button', { type: 'button', class: 'btn btn-ghost', id: 'av-cancel', disabled: busy, onclick: () => { view = 'main'; message = null; render('av-h'); } }, 'ביטול') : null),
    ];
  }
  const countWords = (n) => (n === 1 ? 'יום אחד' : `${n} ימים`);

  // ── The photographer ──
  function selfView(now) {
    const ask = A.askOf(now);
    const row = A.monthRow(data.months, me, ask.month);
    const month = A.monthName(ask.month, now);
    const choices = A.changeChoices({ person: me, months: data.months, taken: data.taken, now });
    const used = A.changeThisMonth(data.changes, me, now);
    if (view === 'change') return [changeView(now, choices, used)];
    if (!row || view === 'edit') {
      if (!row && view !== 'ask') { view = 'ask'; startDraft(me, ask.month, null); }
      const pill = row ? null : ask.phase === 'late' ? `באיחור: המועד היה ${A.dayShort(ask.deadlineDay)}`
        : ask.daysLeft === 0 ? 'היום המועד האחרון' : ask.phase === 'soon' ? `נשארו ${countWords(ask.daysLeft)}` : `למסור עד ${A.dayShort(ask.deadlineDay)}`;
      return [h('section', { class: `av-card${row ? '' : ` is-${ask.phase}`}`, 'aria-labelledby': 'av-h' },
        h('header', { class: 'av-head' },
          h('h2', { id: 'av-h', tabindex: '-1' }, row ? `עדכון הזמינות ל${month}` : `הזמינות שלך ל${month}`),
          pill ? h('span', { class: 'av-pill' }, pill) : null),
        h('p', { class: 'av-lead' }, row ? 'אפשר להוסיף ימים פנויים. יום שקבוע בו יום צילום נשאר.' : 'לסמן את כל הימים שאפשר לקבוע לך בהם יום צילום, ולמסור.'),
        ...editor({
          person: me, month: ask.month, row, now, onBehalf: false, cancel: !!row,
          submitLabel: (n, isNone) => (row ? 'שמירת העדכון' : isNone ? 'מסירה: אין ימים פנויים' : n ? `מסירת הזמינות · ${countWords(n)}` : 'מסירת הזמינות'),
        }),
        // Only once something of his is handed over (this month's dates) is there anything to change.
        !row && (A.monthRow(data.months, me, ask.current) || used) ? h('button', { type: 'button', class: 'btn-text av-more', id: 'av-change', onclick: () => openChange() }, 'בלת״ם: שינוי בימים שכבר מסרתי') : null)];
    }
    return [h('section', { class: 'av-card is-done', 'aria-labelledby': 'av-h' },
      h('div', { class: 'av-line' },
        h('h2', { id: 'av-h', tabindex: '-1' }, `הזמינות ל${month} נמסרה`),
        h('span', { class: 'av-sum' }, A.freeSummary(row)),
        h('span', { class: 'av-btns' },
          h('button', { type: 'button', class: 'btn btn-sm btn-ghost', id: 'av-edit', onclick: () => { view = 'edit'; message = null; startDraft(me, ask.month, row); render('av-h'); } }, 'עדכון'),
          h('button', { type: 'button', class: 'btn btn-sm btn-ghost', id: 'av-change', onclick: () => openChange() }, 'בלת״ם'))))];
  }
  function openChange() { view = 'change'; picks = []; note = ''; message = null; render('av-h'); }
  function changeView(now, choices, used) {
    const close = h('button', { type: 'button', class: 'btn btn-ghost', id: 'av-cancel', disabled: busy, onclick: () => { view = 'main'; message = null; render('av-h'); } }, used ? 'סגירה' : 'ביטול');
    const head = h('header', { class: 'av-head' }, h('h2', { id: 'av-h', tabindex: '-1' }, 'בלת״ם: שינוי בזמינות'));
    // At the limit: said in words, with what to do.
    if (used) {
      return h('section', { class: 'av-card', 'aria-labelledby': 'av-h' }, head,
        h('p', { class: 'av-limit', id: 'av-msg', role: 'alert' }, A.TEXT.used(used)),
        h('div', { class: 'av-act' }, close));
    }
    const pick = (day) => {
      if (busy) return;
      const next = picks.includes(day) ? picks.filter((d) => d !== day) : [...picks, day];
      if (next.length > A.CHANGE_MAX_DAYS || !A.consecutive(next)) { message = A.TEXT.span; render(); el.querySelector(`[data-pick="${day}"]`)?.focus({ preventScroll: true }); return; }
      picks = next; message = null; render();
      el.querySelector(`[data-pick="${day}"]`)?.focus({ preventScroll: true });
    };
    const send = async () => {
      if (busy) return;
      const problem = A.changeProblem({ days: picks, person: me, months: data.months, changes: data.changes, taken: data.taken, now });
      if (problem) { say(problem.text); return; }
      busy = true; render();
      const held = picks.some((d) => A.takenOn(data.taken, d) > 0);
      try {
        await rpc('photographer_change', { p_days: [...picks].sort(), p_note: note.trim() || null });
        view = 'main'; message = null; busy = false;
        toast(`הבלת״ם על ${A.daysWords(picks)} דווח. עירית וליאור קיבלו הודעה${held ? '. להתקשר גם לליאור: קבוע יום צילום' : ''}.`);
        clearCache();
        await refresh();
        document.getElementById('av-h')?.focus({ preventScroll: true });
      } catch (err) {
        busy = false;
        // The limit was reached from another device meanwhile: read again, and say it.
        const text = A.refusalText(err, { changes: data.changes, person: me, now });
        if (/availability_change_used/.test(String(err?.message || ''))) { await refresh(); }
        say(text || `לא נשמר. ${errorText(err)}`);
      }
    };
    const byMonth = new Map();
    for (const c of choices) { const m = A.monthOfDay(c.day); if (!byMonth.has(m)) byMonth.set(m, []); byMonth.get(m).push(c); }
    const warnings = A.changeWarnings({ days: picks, taken: data.taken, now });
    return h('section', { class: 'av-card', 'aria-labelledby': 'av-h' }, head,
      h('p', { class: 'av-lead' }, 'פעם אחת בחודש, עד 48 שעות: יום אחד או יומיים רצופים. ההודעה מגיעה מיד לעירית ולליאור.'),
      choices.length ? [...byMonth].map(([m, list]) => h('div', { class: 'av-picks', role: 'group', 'aria-label': A.monthName(m, now) },
        h('span', { class: 'av-picks-h' }, A.monthName(m, now)),
        ...list.map((c) => h('button', {
          type: 'button', class: `av-pick${picks.includes(c.day) ? ' is-on' : ''}${c.taken ? ' is-taken' : ''}`, 'data-pick': c.day, 'aria-pressed': String(picks.includes(c.day)), disabled: busy,
          'aria-label': `${A.dayLong(c.day)}${c.taken ? ', קבוע יום צילום' : ''}`, onclick: () => pick(c.day),
        }, h('span', { class: 'av-n' }, `${A.WEEKDAYS[A.weekdayOfDay(c.day)]} ${A.dayShort(c.day)}`), c.taken ? h('span', { class: 'av-tag' }, 'צילום') : null))))
        : h('p', { class: 'muted' }, 'אין ימים פנויים או ימי צילום קרובים לדווח עליהם.'),
      warnings.length ? h('ul', { class: 'av-warn', id: 'av-warn' }, ...warnings.map((w) => h('li', {}, w))) : null,
      choices.length ? h('div', { class: 'field' }, h('label', { for: 'av-note' }, 'מה קרה (לא חובה)'),
        h('input', { class: 'input', id: 'av-note', maxlength: A.NOTE_MAX, autocomplete: 'off', value: note, disabled: busy, oninput: (e) => { note = e.currentTarget.value; } })) : null,
      h('p', { class: 'err', id: 'av-msg', role: 'alert', tabindex: '-1', hidden: !message }, message || ''),
      h('div', { class: 'av-act' },
        choices.length ? h('button', { type: 'button', class: 'btn av-go', id: 'av-report', disabled: busy || !picks.length, onclick: send }, picks.length ? `דיווח בלת״ם · ${A.daysWords(picks)}` : 'דיווח בלת״ם') : null,
        close));
  }

  // ── The office ──
  function officeView(person, now) {
    const ask = A.askOf(now);
    const name = A.personName(person);
    const months = [ask.current, ask.month];
    const line = (m) => {
      const row = A.monthRow(data.months, person, m);
      if (row) return h('span', { class: 'av-sum' }, `${A.monthName(m, now)}: ${A.freeSummary(row)}`);
      const late = m === ask.current || ask.phase === 'late';
      return h('span', { class: `av-sum${late ? ' is-late' : ''}` }, `${A.monthName(m, now)}: עוד לא נמסרה${m === ask.month && !late ? ` (עד ${A.dayShort(ask.deadlineDay)})` : ''}`);
    };
    const canEnter = A.ON_BEHALF.includes(me ?? 'owner');
    const changes = data.changes.filter((c) => c.person === person && (c.days || []).some((d) => months.includes(A.monthOfDay(d))));
    return h('details', { class: 'av-card av-office', open, ontoggle: (e) => { open = e.currentTarget.open; } },
      h('summary', { class: 'av-line', id: person === A.PHOTOGRAPHERS[0] ? 'av-h' : null }, h('strong', {}, `הזמינות של ${name}`), ...months.map(line)),
      ...months.map((m) => {
        const row = A.monthRow(data.months, person, m);
        const entering = view === m;
        return h('section', { class: 'av-office-month', 'aria-label': A.monthName(m, now) },
          h('h3', {}, A.monthName(m, now), ' ', h('small', {}, row
            ? `${row.by_person === person ? 'נמסר' : `הוזן על ידי ${row.by_person === 'owner' ? 'הבעלים' : A.personName(row.by_person)}`} ${formatWhen(new Date(row.updated_at || row.submitted_at), now)}${row.none ? ' · אין ימים פנויים' : ''}`
            : `${name} עוד לא מסר`)),
          ...(entering
            ? editor({ person, month: m, row, now, onBehalf: true, cancel: true, submitLabel: () => `שמירה בשם ${name}` })
            : [
              row || Object.keys(data.taken).some((d) => A.monthOfDay(d) === m)
                ? monthGrid({ id: `av-grid-${m}`, month: m, picked: A.freeDays(row), taken: data.taken, changed: A.changedDays(data.changes, person), today: dayKeyIL(now) }) : null,
              canEnter ? h('button', { type: 'button', class: 'btn btn-sm btn-ghost', id: `av-enter-${m}`, onclick: () => { view = m; message = null; draft = A.freeDays(row); none = !!row?.none; render('av-submit'); } },
                row ? `עדכון בשם ${name}` : `הזנה בשם ${name}`) : null,
            ]));
      }),
      legend(changes.length > 0),
      changes.length ? h('ul', { class: 'av-changes' }, ...changes.map((c) => h('li', {},
        `בלת״ם: ${A.daysWords(c.days)} · דווח ${formatWhen(new Date(c.reported_at), now)}${c.note ? ` · ${c.note}` : ''}`))) : null);
  }

  await refresh();
  if (self) {
    // His card is a place reminders point to (shoot.html#availability).
    if (location.hash === '#availability' && !el.hidden) { el.scrollIntoView({ block: 'start' }); document.getElementById('av-h')?.focus({ preventScroll: true }); }
    document.addEventListener('visibilitychange', () => { if (!document.hidden && view === 'main' && !busy) refresh(); });
  }
}

// ── Where the office picks a shoot date ────
// One month of data at a time, kept for a minute (he may hand it over meanwhile).
const cache = new Map();
const clearCache = () => cache.clear();
function monthData(month) {
  const hit = cache.get(month);
  if (hit && Date.now() - hit.at < 60e3) return hit.data;
  const data = loadAvailability(month).catch(() => null);
  cache.set(month, { at: Date.now(), data });
  return data;
}
const ownDay = (own) => { const v = typeof own === 'function' ? own() : own; const d = v ? parseDate(v) : null; return d && !Number.isNaN(+d) ? dayKeyIL(d) : null; };
const RANK = { taken: 3, busy: 2, unknown: 1, free: 0 };

// The statuses of one day ('YYYY-MM-DD') for every photographer; null when unknown here.
export async function dayStatuses(day, { me, own = null } = {}) {
  if (!canSee(me) || isPhotographer(me) || !/^\d{4}-\d{2}-\d{2}$/.test(String(day || ''))) return null;
  const data = await monthData(A.monthOfDay(day));
  return data ? A.PHOTOGRAPHERS.map((person) => A.dayStatus({ day, person, ...data, own: ownDay(own) })) : null;
}
// The line under a datetime-local input (its value is an Israel wall time). `own`: the
// saved date of the shoot being edited (or a function giving it), which is not "taken".
// `me` may be a function too (a page that learns who is signed in after it is drawn).
export function shootDayHint(input, { me, own = null } = {}) {
  const el = h('p', { class: 'hint av-hint', role: 'status', hidden: true });
  el.refresh = async () => {
    const day = String(input.value || '').slice(0, 10);
    const sts = await dayStatuses(day, { me: typeof me === 'function' ? me() : me, own }).catch(() => null);
    if (String(input.value || '').slice(0, 10) !== day) return; // typed on meanwhile
    if (!sts) { el.hidden = true; el.textContent = ''; return; }
    const now = new Date();
    el.textContent = sts.map((st) => A.dayHintText(st, now)).join(' ');
    el.className = `hint av-hint is-${sts.map((s) => s.status).sort((a, b) => RANK[b] - RANK[a])[0]}`;
    el.hidden = false;
  };
  input.addEventListener('input', el.refresh);
  input.addEventListener('change', el.refresh);
  return el;
}

// A few words under "אלי הצלם" where his approval is ticked by hand: what he handed
// over for that shoot's own day. null until known (or when there is nothing to say).
export async function photographerNote(shootAt, { me } = {}) {
  const d = shootAt ? parseDate(shootAt) : null;
  if (!d || Number.isNaN(+d)) return null;
  const sts = await dayStatuses(dayKeyIL(d), { me, own: d }).catch(() => null);
  return sts?.length ? A.dayShortNote(sts[0]) : null;
}

// The reason, asked in a small dialog over whatever is open. Resolves to the reason,
// or null when cancelled.
function askReason(shootAt, concerns) {
  return new Promise((resolve) => {
    const d = parseDate(shootAt);
    let answer = null;
    const input = h('input', { class: 'input', id: 'av-reason', maxlength: 200, autocomplete: 'off', required: true, 'aria-describedby': 'av-reason-err' });
    const err = h('p', { class: 'err', id: 'av-reason-err', role: 'alert', hidden: true }, 'לכתוב סיבה קצרה.');
    const dlg = h('dialog', { class: 'av-dlg', id: 'dlg-shoot-day', 'aria-labelledby': 'av-dlg-h' },
      h('form', {
        novalidate: true,
        onsubmit: (e) => {
          e.preventDefault();
          const v = input.value.trim();
          if (!v) { err.hidden = false; input.setAttribute('aria-invalid', 'true'); input.focus(); return; }
          answer = v;
          dlg.close();
        },
      },
      h('h2', { id: 'av-dlg-h' }, 'לקבוע את יום הצילום בכל זאת?'),
      h('p', { class: 'av-dlg-when' }, `${dayText(d, new Date())} בשעה ${timeText(d)}`),
      h('ul', { class: 'av-warn' }, ...concerns.map((c) => h('li', {}, c))),
      h('div', { class: 'field' }, h('label', { for: 'av-reason' }, 'סיבה קצרה (נשמרת עם שינוי המועד)'), input),
      err,
      h('div', { class: 'av-act' },
        h('button', { type: 'submit', class: 'btn', id: 'av-reason-ok' }, 'לקבוע בכל זאת'),
        h('button', { type: 'button', class: 'btn btn-ghost', id: 'av-reason-cancel', onclick: () => dlg.close() }, 'ביטול'))));
    dlg.addEventListener('close', () => { dlg.remove(); resolve(answer); });
    document.body.append(dlg);
    dlg.showModal();
    input.focus();
  });
}

// Before a shoot date is saved. Returns { ok, note }: `note` goes to the date-change
// history (null: nothing was asked).
export async function confirmShootDay({ shootAt, charAt = null, own = null, me, now = new Date() }) {
  const d = shootAt ? parseDate(shootAt) : null;
  let extra = [];
  if (d && !Number.isNaN(+d) && canSee(me) && !isPhotographer(me)) {
    const day = dayKeyIL(d);
    const data = await monthData(A.monthOfDay(day)).catch(() => null);
    if (data) extra = A.availabilityConcerns({ day, ...data, own: ownDay(own), now });
  }
  if (!extra.length) return confirmShootDate({ shootAt, charAt, now });
  const concerns = [...shootDateConcerns({ shootAt, charAt, now }), ...extra];
  const reason = await askReason(shootAt, concerns);
  if (reason === null) return { ok: false, note: null };
  clearCache(); // the day is about to be taken
  return { ok: true, note: A.exceptionNote(concerns, reason) };
}
