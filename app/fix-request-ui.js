// The small dialog of "הלקוח ביקש תיקון" (protocol v10; docs/ops.md, section 58; the rules:
// app/fix-request.js). One field, what the client asked, and one button. It is built here
// once and shared by "המשימות שלי" (clients.html) and the client card (client.html).
import { h, toast, errorText } from './protocol-ui.js';
import { PEOPLE } from './protocol.js';
import { supabase } from './supa.js';
import { fixSpecOf, validateFix, FIX_ACTION, FIX_RULE_TEXT, NOTE_MAX } from './fix-request.js';

// Opens the task (public.staff_request_fix). Returns the task's row.
export async function recordClientFix(clientId, key, note) {
  const { data, error } = await supabase.rpc('staff_request_fix', { p_client: clientId, p_key: key, p_note: note });
  if (error) throw error;
  return Array.isArray(data) ? data[0] : data;
}

const WHY = {
  'not awaiting approval': 'הפריט כבר לא מחכה לתשובת הלקוח (אושר, או שכבר נרשמה בקשת תיקון). רעננו את העמוד.',
  'not allowed': 'רק המשרד רושם בקשת תיקון של לקוח.',
};
const reason = (err) => WHY[String(err?.message || '').trim()] || errorText(err);

let dlg = null;
let target = null;
function build() {
  dlg = h('dialog', { id: 'dlg-fix', class: 'dlg-fix', 'aria-labelledby': 'fix-h' },
    h('form', { id: 'fix-form', novalidate: '' },
      h('div', { class: 'dlg-head' },
        h('h2', { id: 'fix-h' }, FIX_ACTION),
        h('button', { type: 'button', class: 'close', 'data-close': '', 'aria-label': 'סגירה' }, '×')),
      h('div', { class: 'dlg-body form-grid' },
        h('p', { class: 'span-2 wait-ctx', id: 'fix-ctx' }),
        h('div', { class: 'field span-2' }, h('label', { for: 'fix-note' }, 'מה הלקוח ביקש?'),
          h('textarea', { class: 'input', id: 'fix-note', rows: '3', maxlength: String(NOTE_MAX), required: '', placeholder: 'למשל: להחליף את הטלפון בגרפיקה 4, ולהגדיל את הלוגו' })),
        h('p', { class: 'hint span-2', id: 'fix-hint' }),
        h('div', { class: 'err span-2', id: 'fix-err', role: 'alert', hidden: '' })),
      h('div', { class: 'dlg-foot' },
        h('button', { type: 'button', class: 'btn btn-ghost', 'data-close': '' }, 'ביטול'),
        h('button', { type: 'submit', class: 'btn btn-primary', id: 'fix-submit' }, 'פתיחת משימת תיקון'))));
  document.body.append(dlg);
  const $ = (id) => dlg.querySelector(`#${id}`);
  dlg.addEventListener('click', (e) => { if (e.target.closest('[data-close]') || e.target === dlg) dlg.close(); });
  dlg.addEventListener('close', () => { const t = target; target = null; if (t?.focusId) document.getElementById(t.focusId)?.focus(); });
  // Once something is written, "כותבים מה הלקוח ביקש" is no longer true: it goes.
  $('fix-note').addEventListener('input', () => { if ($('fix-note').value.trim()) { $('fix-err').hidden = true; $('fix-note').removeAttribute('aria-invalid'); } });
  $('fix-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const t = target;
    const v = validateFix($('fix-note').value);
    $('fix-note').setAttribute('aria-invalid', String(!v.ok));
    if (!v.ok) { $('fix-err').textContent = v.error; $('fix-err').hidden = false; $('fix-note').focus(); return; }
    $('fix-submit').disabled = true;
    try {
      const task = await recordClientFix(t.client.id, t.key, v.note);
      dlg.close();
      toast(`נפתחה משימת תיקון${task?.owner && PEOPLE[task.owner] ? ` ל${PEOPLE[task.owner].name}` : ''}${task?.due_on ? `, עד ${task.due_on.split('-').reverse().slice(0, 2).map(Number).join('.')}` : ''}.`);
      await t.onDone?.(task);
    } catch (err) {
      $('fix-err').textContent = `הבקשה לא נשמרה. ${reason(err)}`;
      $('fix-err').hidden = false;
    } finally {
      $('fix-submit').disabled = false;
    }
  });
}

// Opens the dialog for one approval of one client. `onDone(task)`: after the task was opened.
export function openFixRequest({ client, key, name = '', focusId = null, onDone = null }) {
  const spec = fixSpecOf(key);
  if (!spec) return;
  if (!dlg) build();
  target = { client, key, focusId, onDone };
  const $ = (id) => dlg.querySelector(`#${id}`);
  $('fix-form').reset();
  $('fix-err').hidden = true;
  $('fix-note').removeAttribute('aria-invalid');
  $('fix-ctx').textContent = `${name || client.name} · ${spec.what}`;
  $('fix-hint').textContent = `נפתחת אותה משימת תיקון כמו בקשה שהלקוח כותב בדף הסטטוס, עם אותן תזכורות. ${FIX_RULE_TEXT}`;
  dlg.showModal();
  $('fix-note').focus();
}

// The action itself, as it stands next to the approval's row.
export function fixButton({ id, label = FIX_ACTION, onclick }) {
  return h('button', { type: 'button', class: 'btn-text fix-ask', id, onclick }, label);
}
