// The editor's assignment dialog (22א), shared by "בקרה ושיוך" (qa.html, app/qa.js) and the
// client card (client.html, app/client-card.js; the owner, 29.10.2026). One dialog, one set of
// rules: the editors a shoot type allows, Nirel marked in advance on a star's day, the
// suggestion (an editor already in the card, the earlier round's, else the least loaded), the
// optional reason, the second editor with the split, the swap with its editing clocks, the
// folder task (24), and the ready WhatsApp to the editor afterwards (offerHandoff).
// The writes are the page's own (app/protocol-data.js), so the database's rules are the same
// wherever the dialog opens.
//
// assignDialog(store) → { open(a), openSwap(from, job), saveAssign(a, …), suggestionOf, inCardOf }
// `store` gives the page's data, read fresh on every call:
//   clients(), setClient(row), checks() (client id → item key → row, changed in place),
//   tasks(), setTasks(list), selections() (Map quote id → selection), stateOf(c), clearStates(),
//   me(), onClose() (the dialog closed), onSaved(result) (after a save, before the WhatsApp).
// `a` is an item of awaitingEditor() (app/qa-logic.js), with `swap: { from, job }` for a swap and
// `record: { from }` for an editor recorded without touching 22א's marks (the card only).
import { PEOPLE, evenSplit, splitProblem, shootTypeName } from './protocol.js';
import { setCheck, setChecksBulk, clearCheck, addTask, updateClient, setTaskDone, editor2Ready } from './protocol-data.js';
import { $, fill, h, toast, errorText, formatWhen, formatStamp } from './protocol-ui.js';
import {
  editorLoad, loadText, dayText, preselected, reasonHint, eligibleEditors, jointFromSelection, reasonNote, folderTitle, folderDueOn,
  swapClock, swapReasonNeeded, swapNote, suggestAssignment, SUGGESTED_TAG, CONTINUITY_TAG, editingChoices, editingShift, editingChoiceText,
} from './qa-logic.js';
import { AUTO_DRIVE_NOTE } from './auto-assign.js';
import { REASON_KEY, SHIFT_KEY, shiftNote, todoText } from './office-marks.js';
import { withEditor, swapEditor } from './decisions-logic.js';
import { offerHandoff } from './handoff-ui.js';
import { dayFromKeyIL, endOfDayIL } from './tz.js';
import { recordNote } from './card-assign-logic.js';

const roundText = (ctx) => (ctx?.round ? ` · סבב צילום ${ctx.round}` : '');
// What stands in place of a clock on work of a client that came from the old system (docs/ops.md, sections 41 and 46).
export const LANDING_LINE = 'בקליטה · בלי שעון עד שהלקוח יופעל';
const AFTER_FIRST = 'השיוך מסמן את 22א, מתחיל את זמן העריכה שבחרת, פותח לך את משימת התיקייה (24) עד סוף יום העריכה הראשון, ומכין וואטסאפ לעורך עם שני המועדים.';
const AFTER_SWAP = 'ההחלפה נרשמת בהיסטוריה של הלקוח, העורך החדש מקבל את ההודעה על לקוח חדש בעריכה, ומוכן לו וואטסאפ עם שני המועדים.';
const AFTER_KEPT = '22א כבר מסומן, ולכן השיוך רק רושם את העורך בכרטיס: הסימון ומועדי העריכה נשארים כמו שהם. השיוך נרשם בהיסטוריה של הלקוח, והלקוח מופיע אצל העורך. אם העריכה עוד פתוחה, מוכן לו וואטסאפ.';
const AFTER_EARLY = 'העורך נרשם בכרטיס. 22א עוד לא הגיע: כשיגיע, העורך הזה יופיע ב״בקרה ושיוך״ כ״רשום בכרטיס״, ושם מסמנים את השיוך והמועדים מתחילים.';

// The dialog's elements, built once with the ids qa.html had in its page (no markup from text: tests/csp.test.mjs).
const clockRow = (id, value) => h('label', { class: 'wrow', for: id },
  h('input', { type: 'radio', class: 'radio', name: 'as-clock', id, value }), h('span', { class: 'wlabel', id: `${id}-label` }));
const splitInput = (id) => h('input', { class: 'input num', id, type: 'number', min: '0', max: '500', inputmode: 'numeric', dir: 'ltr' });
const markup = () => h('dialog', { id: 'dlg-assign', class: 'dlg-wide', 'aria-labelledby': 'as-h' },
  h('form', { id: 'as-form', novalidate: true },
    h('div', { class: 'dlg-head' },
      h('h2', { id: 'as-h' }, 'שיוך עורך'),
      h('button', { type: 'button', class: 'close', 'data-close': true, 'aria-label': 'סגירה' }, '×')),
    h('div', { class: 'dlg-body' },
      h('p', { class: 'of-meta', id: 'as-meta' }),
      h('label', { class: 'wrow as-joint', id: 'as-joint-wrap', for: 'as-joint', hidden: true },
        h('input', { type: 'checkbox', class: 'cbx', id: 'as-joint' }),
        h('span', { class: 'wlabel' }, 'יום צילום משותף לנטלי ולסמיון')),
      h('fieldset', { class: 'as-editors' }, h('legend', {}, 'העורך'), h('div', { id: 'as-editors' })),
      h('button', { type: 'button', class: 'btn btn-sm btn-ghost as-add2', id: 'as-editor2-add', hidden: true }, '+ עורך/ת נוסף/ת'),
      h('div', { class: 'field as-pair', id: 'as-editor2-wrap', hidden: true },
        h('label', { for: 'as-editor2' }, 'עורך/ת נוסף/ת'),
        h('select', { class: 'input', id: 'as-editor2' }),
        h('fieldset', { class: 'as-split', id: 'as-split' },
          h('legend', { id: 'as-split-h' }, 'חלוקת הסרטונים'),
          h('div', { class: 'as-split-row' },
            h('label', { for: 'as-split-1', id: 'as-split-1-name' }), splitInput('as-split-1'),
            h('span', { 'aria-hidden': 'true' }, '·'),
            h('label', { for: 'as-split-2', id: 'as-split-2-name' }), splitInput('as-split-2'))),
        h('button', { type: 'button', class: 'btn-text', id: 'as-editor2-remove' }, 'בלי עורך נוסף')),
      h('div', { class: 'field', id: 'as-days-wrap', hidden: true },
        h('label', { for: 'as-days' }, 'זמן עריכה'),
        h('select', { class: 'input', id: 'as-days' })),
      h('fieldset', { class: 'as-clock', id: 'as-clock-wrap', hidden: true },
        h('legend', {}, 'מועדי העריכה'),
        h('p', { class: 'as-clock-late', id: 'as-clock-late', hidden: true }),
        clockRow('as-clock-restart', 'restart'),
        clockRow('as-clock-keep', 'keep')),
      h('div', { class: 'field', id: 'as-reason-wrap' },
        h('label', { for: 'as-reason', id: 'as-reason-label' }, 'סיבה'),
        h('textarea', { class: 'input', id: 'as-reason', rows: '2', maxlength: '500', 'aria-describedby': 'as-reason-hint' }),
        h('p', { class: 'hint', id: 'as-reason-hint' })),
      h('p', { class: 'hint', id: 'as-after' }),
      h('div', { class: 'err', id: 'as-err', role: 'alert', hidden: true })),
    h('div', { class: 'dlg-foot' },
      h('button', { type: 'button', class: 'btn btn-ghost', 'data-close': true }, 'ביטול'),
      h('button', { type: 'submit', class: 'btn btn-primary', id: 'as-submit' }, 'שיוך'))));

const videosOf = (ctx) => Number(ctx?.deliverables?.videos) || 0;
const showErr = (id, text) => { $(id).textContent = text; $(id).hidden = false; };

export function assignDialog(store) {
  if (!document.getElementById('dlg-assign')) document.body.append(markup());
  const dlg = $('dlg-assign');
  let item = null;
  let returnTo = null;
  let pairOpen = false;
  const checksOf = (c) => store.checks()[c.id] || {};
  const rowsOf = (c) => (store.checks()[c.id] ||= {});

  dlg.addEventListener('click', (e) => { if (e.target.closest('[data-close]') || e.target === dlg) dlg.close(); });
  dlg.addEventListener('close', () => {
    store.onClose?.();
    const el = returnTo && document.getElementById(returnTo);
    returnTo = null;
    if (el) el.focus();
  });

  // The suggestion of one waiting shoot (the owner's choice of 13.10.2026; app/qa-logic.js
  // suggestAssignment): qa.html's card and the dialog ask the same question, so they never disagree.
  const inCardOf = (a) => (!a.swap && a.ctx.editor && eligibleEditors(a.ctx.shoot_type).includes(a.ctx.editor) ? a.ctx.editor : null);
  const suggestionOf = (a, load, joint, now = new Date()) => suggestAssignment({
    client: a.client, n: a.n, shootType: a.ctx.shoot_type, joint, inCard: inCardOf(a), load, checks: checksOf(a.client), now,
  });

  function open(a) {
    item = a;
    returnTo = document.activeElement?.id || null;
    const type = a.ctx.shoot_type;
    const joint = jointFromSelection(store.selections().get(a.client.quote_id));
    const sw = a.swap || null;
    const rec = a.record || null;
    $('as-h').textContent = `${sw || rec?.from ? 'החלפת עורך' : 'שיוך עורך'} · ${a.client.name}${roundText(a.ctx)}`;
    $('as-meta').textContent = sw
      ? [shootTypeName(a.ctx) || null, `עכשיו אצל ${PEOPLE[sw.from].name}`, sw.job.day === null ? null : dayText(sw.job.day, sw.job.of), sw.job.paused ? 'העריכה עצורה' : null].filter(Boolean).join(' · ')
      : rec ? [shootTypeName(a.ctx) || null, rec.from ? `עכשיו אצל ${PEOPLE[rec.from]?.name || rec.from}` : null, rec.kept ? '22א כבר מסומן' : '22א עוד לא הגיע'].filter(Boolean).join(' · ')
        : [shootTypeName(a.ctx) || null, a.ctx.shoot_at ? `צולם ${formatStamp(a.ctx.shoot_at)}` : null, a.client.landing === true ? LANDING_LINE : null, a.todo ? todoText(a.todo) : null].filter(Boolean).join(' · ');
    $('as-joint-wrap').hidden = type !== 'natali';
    $('as-joint').checked = joint;
    $('as-reason').value = '';
    $('as-reason').removeAttribute('aria-invalid');
    $('as-err').hidden = true;
    $('as-submit').disabled = false;
    $('as-submit').textContent = sw || rec?.from ? 'החלפה' : 'שיוך';
    $('as-after').textContent = sw ? AFTER_SWAP : rec ? (rec.kept ? AFTER_KEPT : AFTER_EARLY) : AFTER_FIRST;
    // The editing clocks of a swap (app/qa-logic.js swapClock): a late job keeps its deadlines unless Ofir says otherwise.
    $('as-clock-wrap').hidden = !sw;
    // The editing time is chosen on a first assignment only: a swap has its own clocks, a record keeps them.
    $('as-days-wrap').hidden = !!sw || !!rec;
    if (!sw && !rec) {
      const days = editingChoices(a.client);
      fill($('as-days'), ...days.map((d) => h('option', { value: String(d) }, editingChoiceText(d))));
      $('as-days').value = String(days.includes(a.days) ? a.days : days[0]);
    }
    if (sw) {
      const now = new Date();
      const k = swapClock(sw.job, now);
      $('as-clock-restart').checked = k.choice === 'restart';
      $('as-clock-keep').checked = k.choice === 'keep';
      $('as-clock-restart-label').textContent = `לספור מחדש מהיום: יעד ${formatWhen(k.restartDue, now)}`;
      $('as-clock-keep-label').textContent = k.keepDue ? `להשאיר את המועד: יעד ${formatWhen(k.keepDue, now)}${k.late ? ' (באיחור)' : ''}` : 'להשאיר את המועדים כמו שהם';
      $('as-clock-late').hidden = !k.late;
      $('as-clock-late').textContent = k.late ? 'העריכה כבר באיחור. ההחלפה לא מאפסת את האיחור, אלא אם בוחרים לספור מחדש וכותבים למה.' : '';
    }
    renderEditors(true);
    dlg.showModal();
    ($('as-editors').querySelector('input:checked') || $('as-editors').querySelector('input:not(:disabled)'))?.focus();
  }

  function renderEditors(preselect = false) {
    const a = item;
    const type = a.ctx.shoot_type;
    const joint = $('as-joint').checked;
    const load = editorLoad({ clients: store.clients(), stateOf: store.stateOf, checks: store.checks(), tasks: store.tasks(), now: new Date() });
    const pre = preselected(type, joint);
    const from = a.swap?.from || a.record?.from || null;
    // The suggestion (protocol v9: Ofir assigns, the system only suggests): the rule's own
    // choice (Nirel for Natali), else the least loaded editor who may take this shoot. It is
    // marked and already chosen, so the usual case is one tap on "שיוך".
    // A swap preselects nobody but the rule's own, never the one who has it now.
    const sug = from ? null : suggestionOf(a, load, joint);
    const inCard = inCardOf(a);
    const first = from ? (pre && pre !== from ? pre : null) : sug.editor;
    const chosen = preselect ? first : $('as-editors').querySelector('input:checked')?.value || null;
    // A swap keeps the other editor of the pair: they are not offered in the place being swapped.
    const partner = a.swap?.job?.partner || null;
    fill($('as-editors'), ...eligibleEditors(type).map((k) => h('label', { class: 'wrow as-editor', for: `as-e-${k}` },
      h('input', { type: 'radio', class: 'radio', name: 'as-editor', id: `as-e-${k}`, value: k, checked: chosen === k, disabled: k === from || k === partner, onchange: () => { fillEditor2(); syncReason(); } }),
      h('span', { class: 'wlabel' }, h('strong', {}, PEOPLE[k].name), pre === k ? h('span', { class: 'tag' }, 'מסומנת מראש') : null,
        sug?.editor === k && sug.why === 'load' ? h('span', { class: 'tag as-suggested', id: 'as-suggested' }, SUGGESTED_TAG) : null,
        sug?.editor === k && sug.why === 'continuity' ? h('span', { class: 'tag as-suggested', id: 'as-suggested' }, CONTINUITY_TAG) : null,
        inCard === k ? h('span', { class: 'tag' }, 'רשום בכרטיס') : null,
        k === from ? h('span', { class: 'tag' }, 'העורך הנוכחי') : null,
        k === partner ? h('span', { class: 'tag' }, a.swap.job.second ? 'העורך הראשי' : 'העורך הנוסף') : null,
        h('span', { class: 'muted small as-load' }, loadText(load[k]))))));
    if (preselect) pairOpen = false;
    fillEditor2();
    syncReason();
  }

  // "+ עורך/ת נוסף/ת" (the owner's request of 21.10.2026): a second editor beside the chosen
  // one, and how the package's videos are split between them ("נדיה 8 · יריב 4"). Offered on
  // the first assignment (and on recording the first editor), once the database has the column.
  function fillEditor2() {
    const a = item;
    const can = !a.swap && !a.record?.from && editor2Ready();
    const main = $('as-editors').querySelector('input:checked')?.value || null;
    $('as-editor2-add').hidden = !can || pairOpen || !main;
    $('as-editor2-wrap').hidden = !can || !pairOpen || !main;
    if ($('as-editor2-wrap').hidden) return;
    const keys = eligibleEditors(a.ctx.shoot_type).filter((k) => k !== main);
    const was = $('as-editor2').value;
    fill($('as-editor2'), ...keys.map((k) => h('option', { value: k }, PEOPLE[k].name)));
    $('as-editor2').value = keys.includes(was) ? was : keys[0];
    fillSplit();
  }
  // The two numbers, even by default (the main editor takes the odd one).
  function fillSplit() {
    const main = $('as-editors').querySelector('input:checked')?.value;
    const second = $('as-editor2').value;
    const total = videosOf(item.ctx);
    $('as-split-h').textContent = total ? `חלוקת הסרטונים (${total} לפי החבילה)` : 'חלוקת הסרטונים (לא חובה: מספר הסרטונים לא הוזן)';
    $('as-split-1-name').textContent = PEOPLE[main].name;
    $('as-split-2-name').textContent = PEOPLE[second].name;
    const even = evenSplit(total, main, second);
    $('as-split-1').value = even ? String(even[main]) : '';
    $('as-split-2').value = even ? String(even[second]) : '';
  }
  // The split as typed: null when both are empty (only allowed without a count).
  function splitValue(main, second) {
    const v = (id) => ($(id).value.trim() === '' ? null : Number($(id).value));
    const x = v('as-split-1');
    const y = v('as-split-2');
    return x === null && y === null ? null : { [main]: x, [second]: y };
  }
  $('as-editor2-add').addEventListener('click', () => { pairOpen = true; fillEditor2(); $('as-editor2').focus(); });
  $('as-editor2-remove').addEventListener('click', () => { pairOpen = false; fillEditor2(); $('as-editor2-add').focus(); });
  $('as-editor2').addEventListener('change', fillSplit);
  for (const id of ['as-split-1', 'as-split-2']) $(id).addEventListener('input', () => { $('as-err').hidden = true; });

  // A swap that restarts the clocks of a late job: the reason is optional (21.10.2026, 29.10.2026).
  function swapChoice() {
    const sw = item?.swap;
    if (!sw) return { late: false, restart: false };
    return { late: swapClock(sw.job, new Date()).late, restart: $('as-clock-restart').checked };
  }
  const needsReason = (editor) => swapReasonNeeded({ editor, ...swapChoice() });
  function syncReason() {
    const a = item;
    const editor = $('as-editors').querySelector('input:checked')?.value || null;
    const joint = $('as-joint').checked;
    const need = needsReason(editor);
    $('as-reason-label').textContent = need ? 'סיבה (חובה)' : 'סיבה (לא חובה)';
    $('as-reason').required = need;
    $('as-reason-hint').textContent = reasonHint({ shootType: a.ctx.shoot_type, joint }) || 'הסיבה נשמרת בהיסטוריה של הלקוח.';
  }
  $('as-joint').addEventListener('change', () => renderEditors(true));
  for (const id of ['as-clock-restart', 'as-clock-keep']) $(id).addEventListener('change', syncReason);

  // "החלפת עורך": the same dialog, for a job that already has an editor (an item of editorLoad's jobs).
  function openSwap(from, job) {
    const c = job.client;
    const s = store.stateOf(c).states.find((x) => x.proc.id === `${job.n ? `r${job.n}-` : ''}p22a`);
    if (!s) { toast('לא נמצא שיוך להחלפה. רעננו את העמוד.'); return; }
    open({ key: `${c.id}:${s.proc.id}`, client: c, pre: job.pre, n: job.n, proc: s.proc, ctx: s.proc.ctx || c, state: s, dueAt: s.dueAt, swap: { from, job } });
  }

  async function saveSwap(a, editor, joint, reason) {
    const c = a.client;
    const { from, job } = a.swap;
    const now = new Date();
    const k = swapClock(job, now);
    const restart = $('as-clock-restart').checked;
    const rows = rowsOf(c);
    const prev = rows[`${a.pre}p22a.assigned`]?.at || null;
    const client = await updateClient(c.id, swapEditor(c, a.n, from, editor));
    store.setClient(client);
    // Marking 22א again, as the first assignment does, starts the editing days over.
    if (restart) for (const row of await setChecksBulk(c.id, ['p22a.load', 'p22a.assigned'].map((x) => `${a.pre}${x}`), 'done')) rows[row.item_key] = row;
    rows[REASON_KEY(a.pre)] = await setCheck(c.id, REASON_KEY(a.pre), 'done',
      swapNote({ editor, from, reason, preselected: preselected(a.ctx.shoot_type, joint), joint, restart, late: k.late, prev }));
    // The new editor starts: a pause of the one before ends, and its tasks close (as Lior's reassignment does).
    if (job.paused) {
      const pause = `${a.pre}p22.pause`;
      try {
        await clearCheck(c.id, pause);
        delete rows[pause];
        for (const t of store.tasks().filter((x) => x.client_id === c.id && x.source === 'pause' && !x.done_at)) {
          const done = await setTaskDone(t.id, true);
          store.setTasks(store.tasks().map((x) => (x.id === t.id ? done : x)));
        }
      } catch { /* the swap is saved; the pause is closed in the card */ }
    }
    store.clearStates();
    const due = restart ? `מועדי העריכה נספרים מהיום: יעד ${formatWhen(k.restartDue, now)}.` : k.late ? 'המועדים לא השתנו: העריכה נשארת באיחור.' : 'המועדים לא השתנו.';
    return { client, text: `${c.name} עבר מ${PEOPLE[from].name} ל${PEOPLE[editor].name}. ${due}` };
  }

  // The first assignment's write, the same for the dialog's "שיוך" and for qa.html's card
  // "שיוך ל<שם>": the editor in the card, 22א's "נבדק העומס" and "שויך", Irit's and Lior's
  // items that close with it, the reason when one was written, and Ofir's folder task (24).
  // Throws when the assignment itself was not saved. → { client, folder (a sentence for the toast) }
  async function saveAssign(a, editor, joint, reason, editor2 = undefined, split = undefined, days = null) {
    const c = a.client;
    const client = await updateClient(c.id, withEditor(c, a.n, editor, editor2, split));
    store.setClient(client);
    const rows = rowsOf(c);
    const keys = ['p22a.load', 'p22a.assigned'].map((k) => `${a.pre}${k}`);
    for (const row of await setChecksBulk(c.id, keys, 'done')) rows[row.item_key] = row;
    // Irit's check that the client moved to editing closes by itself (section 4, 5א).
    const irit = `${a.pre}p22a.irit`;
    if (rows[irit]?.state !== 'done') rows[irit] = await setCheck(c.id, irit, 'done', 'נסגר לבד: השיוך נרשם במערכת');
    // Lior's "the drive came back" (22א) is what he confirmed when he closed the shoot day
    // (19, "הכונן חזר אליי"): it closes with the assignment, so 22א does not stay open on it.
    const drive = `${a.pre}p22a.drive`;
    if (rows[`${a.pre}p19.took`]?.state === 'done' && !['done', 'na'].includes(rows[drive]?.state)) rows[drive] = await setCheck(c.id, drive, 'done', AUTO_DRIVE_NOTE);
    // The editing time he chose: the days above the client's own move its deadlines.
    const shift = editingShift(c, days);
    if (shift) rows[SHIFT_KEY(a.pre)] = await setCheck(c.id, SHIFT_KEY(a.pre), 'done', shiftNote(shift, 'זמן העריכה שנבחר בשיוך'));
    // The reason is optional: kept when one was written.
    if (reason) {
      rows[REASON_KEY(a.pre)] = await setCheck(c.id, REASON_KEY(a.pre), 'done', reasonNote({ editor, reason, preselected: preselected(a.ctx.shoot_type, joint), joint }));
    }
    // Ofir's folder task (24), due at the end of editing day 1 (once: a swap opens none).
    let folder = '';
    const title = folderTitle(a.n);
    if (rows[`${a.pre}p24.folder`]?.state !== 'done' && !store.tasks().some((t) => t.client_id === c.id && t.title === title && !t.done_at)) {
      try {
        const t = await addTask({ client_id: c.id, title, owner: 'ofir', due_on: folderDueOn(new Date()) });
        store.setTasks([t, ...store.tasks()]);
        folder = ` נפתחה לאופיר משימת תיקייה (24) עד ${formatWhen(endOfDayIL(dayFromKeyIL(t.due_on)))}.`;
      } catch { folder = ' משימת התיקייה (24) לא נפתחה: לפתוח אותה בכרטיס.'; }
    }
    store.clearStates();
    return { client, folder };
  }

  // The card's own case (app/card-assign-logic.js): the editor is written, 22א's marks and
  // every deadline stay. On a 22א already marked (the import), who recorded it is kept in the
  // reason mark, as a swap's "המועדים לא השתנו".
  async function saveRecord(a, editor, reason, editor2 = undefined, split = undefined) {
    const c = a.client;
    const { from = null, kept = false } = a.record;
    const client = await updateClient(c.id, from ? swapEditor(c, a.n, from, editor) : withEditor(c, a.n, editor, editor2, split));
    store.setClient(client);
    if (kept) rowsOf(c)[REASON_KEY(a.pre)] = await setCheck(c.id, REASON_KEY(a.pre), 'done', recordNote({ editor, reason, from }));
    store.clearStates();
    return { client };
  }

  $('as-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const a = item;
    const editor = $('as-editors').querySelector('input:checked')?.value || null;
    const joint = $('as-joint').checked && a.ctx.shoot_type === 'natali';
    const reason = $('as-reason').value.trim();
    const pair = !a.swap && !$('as-editor2-wrap').hidden;
    const editor2 = pair ? $('as-editor2').value || null : undefined;
    const split = pair && editor2 ? splitValue(editor, editor2) : pair ? null : undefined;
    if (pair && editor2) {
      const bad = splitProblem(split, videosOf(a.ctx), editor, editor2);
      if (bad) { showErr('as-err', bad); $('as-split-1').focus(); return; }
    }
    if (!editor) { showErr('as-err', a.swap || a.record?.from ? 'בחרו את העורך החדש.' : 'בחרו עורך.'); $('as-editors').querySelector('input:not(:disabled)')?.focus(); return; }
    if (needsReason(editor) && !reason) {
      $('as-reason').setAttribute('aria-invalid', 'true');
      showErr('as-err', 'העריכה כבר באיחור. כדי לספור את המועדים מחדש כתבו למה.');
      $('as-reason').focus();
      return;
    }
    $('as-reason').removeAttribute('aria-invalid');
    $('as-submit').disabled = true;
    const c = a.client;
    const me = store.me();
    const handoff = (client) => offerHandoff({ client, key: `${a.pre}p22a.assigned`, checks: () => store.checks()[c.id], me });
    const names = `${PEOPLE[editor].name}${editor2 ? ` ול${PEOPLE[editor2].name}` : ''}`;
    let saved;
    let text;
    try {
      if (a.swap) {
        saved = await saveSwap(a, editor, joint, reason);
        text = saved.text;
      } else if (a.record) {
        saved = await saveRecord(a, editor, reason, editor2, split);
        text = a.record.from ? `העורך של ${c.name} עודכן ל${names}. המועדים לא השתנו.`
          : a.record.kept ? `${c.name} שויך ל${names}. 22א והמועדים נשארו כמו שהם.` : `${names} נרשם/ה בכרטיס של ${c.name}.`;
      } else {
        saved = await saveAssign(a, editor, joint, reason, editor2, split, Number($('as-days').value));
        text = `${c.name} שויך ל${names}.${saved.folder}`;
      }
    } catch (err) {
      showErr('as-err', `${a.swap ? 'ההחלפה' : 'השיוך'} לא נשמר${a.swap ? 'ה' : ''}. ${errorText(err)}`);
      $('as-submit').disabled = false;
      return;
    }
    $('as-submit').disabled = false;
    store.onSaved?.({ a, editor, client: saved.client });
    dlg.close();
    toast(text);
    // A ready WhatsApp to the editor with both dates and the link (before 22א's turn there is nothing to hand off yet).
    if (!a.record || a.record.kept) handoff(saved.client);
  });

  return { open, openSwap, saveAssign, suggestionOf, inCardOf, dialog: dlg };
}
