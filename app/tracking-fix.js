// "מעקב לקוחות": the small dialogs that fix a number by hand, and set the Channel 14 dates
// (Irit, 10.11.2026; the owner approved). One <dialog>, filled for each use:
//   openCountFix({ client, kind, x, … })   tab 1: "סרטונים נערכו", "גרפיקות הועלו", "ימי צילום" (done / of)
//   openShootFix({ client, row, … })       tab 2: "ימי צילום מכלל", "שנותרו", the status, "יום צילום כל חודש"
//   openCh14({ client, … })                tab 2: one date (and time) per Channel 14 item
//   openDueFix({ task, … })                tab 3: a client-card task's due day
// What is kept and how: app/tracking-fix-logic.js and app/tracking-ch14-logic.js; docs/ops.md, section 122.
// Every number is typed (inputmode numeric, 16px: no zoom on an iPhone); an empty field is the count's.
import { supabase } from './supa.js';
import { updateClient } from './protocol-data.js';
import { h, fill, toast, errorText } from './protocol-ui.js';
import { clientLabel } from './protocol-logic.js';
import { withShootMonthly, isShootMonthly } from './monthly-shoot.js';
import {
  FIELDS, parseCount, withFix, changedOnly, problemOf, fixLine, byKey, MAX,
} from './tracking-fix-logic.js';
import { ch14Count, ch14Dates, withCh14Date, parseDayTime, dayTimeText } from './tracking-ch14-logic.js';
import { partsIL } from './tz.js';

let dlg = null;
let opener = null;
function dialog() {
  if (dlg) return dlg;
  dlg = document.body.appendChild(h('dialog', { class: 'fx-dlg', id: 'fx-dlg', 'aria-labelledby': 'fx-h' },
    h('form', { id: 'fx-form', novalidate: true, method: 'dialog' },
      h('div', { class: 'dlg-head' },
        h('h2', { id: 'fx-h' }),
        h('button', { type: 'button', class: 'close', 'aria-label': 'סגירה', onclick: () => dlg.close() }, '×')),
      h('div', { class: 'dlg-body', id: 'fx-body' }),
      h('div', { class: 'dlg-foot', id: 'fx-foot' }))));
  dlg.addEventListener('close', () => { opener?.focus?.(); opener = null; });
  return dlg;
}

const numInput = (id, value, label) => h('input', {
  class: 'input num fx-num', id, type: 'text', inputmode: 'numeric', pattern: '[0-9]*', dir: 'ltr', autocomplete: 'off',
  maxlength: String(String(MAX).length), value: value ?? '', 'aria-label': label,
});
const field = (id, label, control, hint = null) => h('div', { class: 'field fx-field' },
  h('label', { for: id }, label), control, hint ? h('p', { class: 'hint', id: `${id}-hint` }, hint) : null);
const err = () => h('div', { class: 'err', id: 'fx-err', role: 'alert', hidden: true });
function sayErr(text) {
  const e = dlg.querySelector('#fx-err');
  e.textContent = text;
  e.hidden = !text;
}
const autoText = (a, b) => (b ? `${a ?? 0} / ${b}` : String(a ?? 0));

// The dialog, open: title, the body's parts, and the foot's buttons. `save` returns true when done.
function show(title, parts, { save, reset = null, saveText = 'שמירה' }) {
  const d = dialog();
  opener = document.activeElement;
  d.querySelector('#fx-h').textContent = title;
  fill(d.querySelector('#fx-body'), parts, err());
  const go = h('button', { type: 'submit', class: 'btn btn-primary', id: 'fx-save' }, saveText);
  fill(d.querySelector('#fx-foot'),
    reset ? h('button', { type: 'button', class: 'btn-text fx-reset', id: 'fx-reset', onclick: () => run(reset, go) }, 'חזרה לספירה האוטומטית') : null,
    h('button', { type: 'button', class: 'btn btn-ghost', onclick: () => d.close() }, 'ביטול'),
    go);
  d.querySelector('#fx-form').onsubmit = (e) => { e.preventDefault(); run(save, go); };
  d.showModal();
  d.querySelector('input, select')?.focus();
}
async function run(fn, btn) {
  btn.disabled = true;
  sayErr('');
  try {
    if (await fn()) dlg.close();
  } catch (e) {
    sayErr(`לא נשמר. ${errorText(e)}`);
  } finally {
    btn.disabled = false;
  }
}

// The client's deliverables as the database has them now (another change a moment ago is kept), changed by `fn`.
async function saveDeliverables(id, fn) {
  const { data, error } = await supabase.from('clients').select('deliverables').eq('id', id).single();
  if (error) throw error;
  return updateClient(id, { deliverables: fn(data?.deliverables || {}) });
}

const TITLES = { videos: 'סרטונים נערכו', graphics: 'גרפיקות הועלו', shoots: 'ימי צילום' };
const LABELS = {
  videos: ['כמה נערכו', 'מתוך'], graphics: ['כמה הועלו', 'מתוך'], shoots: ['כמה ימים בוצעו', 'מתוך'],
};

// Tab 1: done and of. `x`: the row's count (with `auto` and `fix` when fixed already).
export function openCountFix({ client, kind, x, viewer, month = null, saved }) {
  const auto = x.auto || { done: x.done, of: x.of };
  const [a, b] = FIELDS[kind];
  const name = clientLabel(client);
  const line = x.fix ? h('p', { class: 'fx-by' }, fixLine(x.fix)) : null;
  show(`${TITLES[kind]} · ${name}`, [
    h('p', { class: 'fx-auto', id: 'fx-auto' }, `לפי הספירה האוטומטית: `, h('bdi', { class: 'num', dir: 'ltr' }, autoText(auto.done, auto.of)),
      '. מספר שמקלידים כאן גובר עליה. שדה ריק חוזר לספירה.'),
    line,
    h('div', { class: 'fx-pair' },
      field('fx-a', LABELS[kind][0], numInput('fx-a', x.done ?? '', LABELS[kind][0])),
      h('span', { class: 'fx-slash', 'aria-hidden': 'true' }, '/'),
      field('fx-b', LABELS[kind][1], numInput('fx-b', x.of ?? '', LABELS[kind][1]))),
  ], {
    reset: x.fix ? async () => { await saveDeliverables(client.id, (d) => withFix(d, kind, null)); toast('חזר לספירה האוטומטית.'); await saved(); return true; } : null,
    save: async () => {
      const typed = { [a]: parseCount(dlg.querySelector('#fx-a').value), [b]: parseCount(dlg.querySelector('#fx-b').value) };
      const autoKeyed = { [a]: auto.done, [b]: auto.of };
      const bad = problemOf(kind, typed, autoKeyed);
      if (bad) { sayErr(bad); return false; }
      const values = changedOnly(kind, typed, autoKeyed);
      await saveDeliverables(client.id, (d) => withFix(d, kind, values, { by: byKey(viewer), month }));
      toast(values[a] === null && values[b] === null ? 'חזר לספירה האוטומטית.' : 'נשמר. המספר עודכן ביד.');
      await saved();
      return true;
    },
  });
}

// Tab 2: "ימי צילום מכלל", "שנותרו" (held = total − remaining), the status, and every month.
export function openShootFix({ client, row, viewer, saved }) {
  const auto = row.auto;
  const name = clientLabel(client);
  const monthly = isShootMonthly(client);
  const status = h('select', { class: 'input fx-sel', id: 'fx-status' },
    h('option', { value: '' }, `לפי המערכת (${auto.status === 'set' ? 'נקבע' : auto.status === 'done' ? 'בוצעו כולם' : 'ממתין לקביעה'})`),
    h('option', { value: 'waiting' }, 'ממתין לקביעה'),
    h('option', { value: 'set' }, 'נקבע'));
  status.value = row.fix?.status || '';
  const every = h('input', { type: 'checkbox', class: 'cbx', id: 'fx-monthly' });
  every.checked = monthly;
  show(`ימי צילום · ${name}`, [
    h('p', { class: 'fx-auto', id: 'fx-auto' }, 'לפי הספירה האוטומטית: ', h('bdi', { class: 'num', dir: 'ltr' }, `${auto.agreed ?? '—'}`), ' ימים, ',
      h('bdi', { class: 'num', dir: 'ltr' }, `${auto.agreed ? Math.max(0, auto.agreed - auto.held) : '—'}`), ' נותרו. מספר שמקלידים כאן גובר. שדה ריק חוזר לספירה.'),
    row.fix ? h('p', { class: 'fx-by' }, fixLine(row.fix)) : null,
    h('div', { class: 'fx-pair' },
      field('fx-a', 'ימי צילום מכלל', numInput('fx-a', row.total ?? '', 'ימי צילום מכלל')),
      field('fx-b', 'שנותרו', numInput('fx-b', row.remaining ?? '', 'ימי צילום שנותרו'))),
    field('fx-status', 'סטטוס', status),
    h('label', { class: 'wrow fx-check', for: 'fx-monthly' }, every, h('span', { class: 'wlabel' }, 'יום צילום כל חודש')),
  ], {
    reset: row.fix ? async () => { await saveDeliverables(client.id, (d) => withFix(d, 'shoots', null)); toast('חזר לספירה האוטומטית.'); await saved(); return true; } : null,
    save: async () => {
      const agreed = parseCount(dlg.querySelector('#fx-a').value);
      const remaining = parseCount(dlg.querySelector('#fx-b').value);
      if (Number.isNaN(agreed) || Number.isNaN(remaining)) { sayErr(`רק מספר שלם, 0 עד ${MAX}.`); return false; }
      const total = agreed ?? auto.agreed;
      let held = null;
      if (remaining !== null) {
        if (!total) { sayErr('צריך קודם את מספר ימי הצילום מכלל.'); return false; }
        if (remaining > total) { sayErr('אי אפשר יותר ימים שנותרו מכלל הימים.'); return false; }
        held = total - remaining;
      } else if (agreed !== null && auto.held > agreed) {
        sayErr('כבר בוצעו יותר ימים מזה. כתבו גם כמה נותרו.');
        return false;
      }
      const values = changedOnly('shoots', { held, agreed, status: status.value || null }, { held: auto.held, agreed: auto.agreed, status: auto.status });
      await saveDeliverables(client.id, (d) => withShootMonthly(withFix(d, 'shoots', values, { by: byKey(viewer) }), every.checked));
      const back = values.held === null && values.agreed === null && !values.status;
      toast(back ? 'נשמר. המספרים לפי הספירה האוטומטית.' : 'נשמר. עודכן ביד.');
      await saved();
      return true;
    },
  });
}

// Tab 2: the Channel 14 items' dates. One pair of fields (date, time) per item; an empty date takes it away.
export function openCh14({ client, viewer, saved, now = new Date() }) {
  const q = ch14Count(client);
  const dates = ch14Dates(client);
  const name = clientLabel(client);
  const rows = dates.map((at, i) => {
    const [d, t] = dayTimeText(at);
    const n = q > 1 ? ` ${i + 1}` : '';
    return h('fieldset', { class: 'fx-item' },
      q > 1 ? h('legend', {}, `אייטם${n}`) : null,
      h('div', { class: 'fx-pair' },
        field(`fx-d${i}`, 'תאריך', h('input', {
          class: 'input num fx-day', id: `fx-d${i}`, type: 'text', inputmode: 'decimal', dir: 'ltr', autocomplete: 'off', maxlength: '10',
          placeholder: 'למשל 20.11', value: d, 'aria-label': `תאריך${n}`,
        })),
        field(`fx-t${i}`, 'שעה', h('input', {
          class: 'input num fx-time', id: `fx-t${i}`, type: 'text', inputmode: 'decimal', dir: 'ltr', autocomplete: 'off', maxlength: '5',
          placeholder: 'למשל 10:30', value: at ? t : '', 'aria-label': `שעה${n}`,
        }))));
  });
  show(`ערוץ 14 · ${name}`, [
    h('p', { class: 'fx-auto' }, q > 1 ? `בחבילה ${q} אייטמים בערוץ 14: תאריך לכל אחד.` : 'מתי מצלמים את האייטם בערוץ 14.', ' תאריך כמו 20.11, שעה כמו 10:30. מוחקים את התאריך כדי לבטל אותו.'),
    ...rows,
  ], {
    saveText: 'שמירת המועד',
    save: async () => {
      const got = [];
      for (let i = 0; i < q; i += 1) {
        const day = dlg.querySelector(`#fx-d${i}`).value;
        const time = dlg.querySelector(`#fx-t${i}`).value;
        if (!day.trim()) { got.push(null); continue; }
        const r = parseDayTime(day, time, now);
        if (r.error) { sayErr(q > 1 ? `אייטם ${i + 1}: ${r.error}` : r.error); dlg.querySelector(`#fx-d${i}`).focus(); return false; }
        got.push(r.at);
      }
      await saveDeliverables(client.id, (d) => got.reduce((acc, at, i) => {
        const same = (dates[i]?.getTime() || null) === (at?.getTime() || null);
        return same ? acc : withCh14Date(acc, i, at, { by: byKey(viewer), now: new Date() });
      }, d));
      toast(got.some(Boolean) ? 'המועד לערוץ 14 נשמר.' : 'המועד לערוץ 14 בוטל.');
      await saved();
      return true;
    },
  });
}

// Tab 3: a client-card task's due day ("20.11"; empty: no due day).
export function openDueFix({ task, saved, now = new Date() }) {
  let d = '';
  if (task.dueOn) { const [y, m, day] = task.dueOn.split('-').map(Number); d = `${day}.${m}.${y}`; }
  show(`תאריך יעד · ${task.title}`, [
    field('fx-due', 'תאריך יעד', h('input', {
      class: 'input num fx-day', id: 'fx-due', type: 'text', inputmode: 'decimal', dir: 'ltr', autocomplete: 'off', maxlength: '10', placeholder: '20.11', value: d,
    }), 'יום.חודש, למשל 20.11. ריק: בלי תאריך יעד.'),
  ], {
    save: async () => {
      const text = dlg.querySelector('#fx-due').value;
      let key = null;
      if (text.trim()) {
        const r = parseDayTime(text, '', now);
        if (r.error) { sayErr(r.error); return false; }
        const p = partsIL(r.at);
        key = `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
      }
      const { error } = await supabase.from('client_tasks').update({ due_on: key }).eq('id', task.rawId);
      if (error) throw error;
      toast(key ? 'תאריך היעד עודכן.' : 'תאריך היעד הוסר.');
      await saved();
      return true;
    },
  });
}
