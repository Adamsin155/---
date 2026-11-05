// "קריאת חוזה חתום" (the owner, 5.11.2026; docs/ops.md, section 104): a signed contract uploaded by
// hand is read by the contract-ai function, and the uploader sees what was found in one short
// screen: business, company id, contact, package, price, months, signing day. Every field can be
// corrected; nothing is kept until "אישור ושמירה". Then a row goes to public.manual_contracts
// (quotes.html lists it as "נחתם · חוזה ידני") and what is missing in the client is filled in
// (app/contract-read-logic.js clientPatchFromRead). Used by the card (app/client-card.js), also
// right after "לקוח חדש" with a contract (client.html?id=…#read-<file>).
import { supabase } from './supa.js';
import { updateClient } from './protocol-data.js';
import { $, h, toast, errorText } from './protocol-ui.js';
import { PACKAGE_OPTIONS, packageName, dealDeliverables } from './client-open.js';
import { checkReadForm, clientPatchFromRead, LIMITS } from './contract-read-logic.js';

export const MANUAL_COLS = 'id, client_id, file_id, business, company_id, contact_name, package_id, package_name, monthly_net_agorot, term_months, signed_on, read_by_ai, created_by_email, created_at';

// The confirmed readings of one client: { fileId: row }. Empty when the table is not there yet, or
// for whoever may not see them (row level security answers no rows).
export async function loadManualContracts(clientId) {
  const { data, error } = await supabase.from('manual_contracts').select(MANUAL_COLS).eq('client_id', clientId);
  if (error) return {};
  return Object.fromEntries((data || []).map((r) => [r.file_id, r]));
}

const READ_ERRORS = {
  ai_not_configured: 'החיבור ל־AI עוד לא הוגדר. אפשר למלא את הפרטים ידנית.',
  rate_limited: 'היו הרבה בקשות בדקה האחרונה. אפשר לנסות שוב בעוד דקה, או למלא ידנית.',
  ai_timeout: 'ה־AI לא ענה בזמן. אפשר לנסות שוב, או למלא ידנית.',
  ai_busy: 'ה־AI עמוס כרגע. אפשר לנסות שוב בעוד רגע, או למלא ידנית.',
  read_unsupported: 'את הקובץ הזה ה־AI לא קורא (למשל HEIC). אפשר למלא את הפרטים ידנית.',
  read_too_big: 'הקובץ גדול מדי לקריאה. אפשר למלא את הפרטים ידנית.',
  file_not_found: 'הקובץ לא נמצא. אפשר למלא את הפרטים ידנית.',
  not_allowed: 'אין לך הרשאה לקרוא את החוזה של הלקוח הזה.',
};
const READ_FAILED = 'לא הצלחנו לקרוא את החוזה. אפשר לנסות שוב, או למלא את הפרטים ידנית.';

const field = (id, label, input, hint = null) => h('div', { class: 'field cr-field' },
  h('label', { for: id }, label), input, hint ? h('p', { class: 'hint' }, hint) : null,
  h('p', { class: 'cr-ferr err', id: `${id}-err`, role: 'alert', hidden: true }));
const text = (id, max, extra = {}) => h('input', { class: 'input', id, type: 'text', maxlength: String(max), autocomplete: 'off', ...extra });

function markup() {
  return h('dialog', { id: 'dlg-cread', class: 'dlg-wide cr-dlg', 'aria-labelledby': 'cr-h' },
    h('form', { id: 'cr-form', novalidate: true },
      h('div', { class: 'dlg-head' },
        h('h2', { id: 'cr-h' }, 'מה מצאנו בחוזה'),
        h('button', { type: 'button', class: 'close', 'data-close': true, 'aria-label': 'סגירה' }, '×')),
      h('div', { class: 'dlg-body' },
        h('p', { class: 'cr-state', id: 'cr-state', role: 'status' }),
        h('ul', { class: 'cr-notes', id: 'cr-notes', hidden: true }),
        field('cr-business', 'שם העסק', text('cr-business', LIMITS.business)),
        field('cr-company', 'ח.פ / ע.מ', text('cr-company', 12, { inputmode: 'numeric', dir: 'ltr' })),
        field('cr-contact', 'איש קשר', text('cr-contact', LIMITS.contact)),
        field('cr-package', 'חבילה', h('select', { class: 'input', id: 'cr-package' },
          h('option', { value: '' }, 'לא ידוע / אחר'),
          ...PACKAGE_OPTIONS.map((p) => h('option', { value: p.id }, p.name)))),
        h('div', { class: 'cr-pair' },
          field('cr-monthly', 'מחיר לחודש, לפני מע״מ (₪)', text('cr-monthly', 9, { inputmode: 'numeric', dir: 'ltr' })),
          field('cr-term', 'חודשים', text('cr-term', 3, { inputmode: 'numeric', dir: 'ltr' }))),
        field('cr-signed', 'תאריך החתימה', h('input', { class: 'input', id: 'cr-signed', type: 'date', dir: 'ltr' })),
        h('p', { class: 'hint' }, 'זה נקרא אוטומטית מהקובץ: כדאי לעבור על כל שדה. שום דבר לא נשמר עד ״אישור ושמירה״.'),
        h('div', { class: 'err', id: 'cr-err', role: 'alert', hidden: true })),
      h('div', { class: 'dlg-foot' },
        h('button', { type: 'button', class: 'btn btn-ghost', 'data-close': true }, 'לא עכשיו'),
        h('button', { type: 'button', class: 'btn btn-ghost', id: 'cr-again', hidden: true }, 'לקרוא שוב'),
        h('button', { type: 'submit', class: 'btn btn-primary', id: 'cr-submit' }, 'אישור ושמירה'))));
}

const FIELDS = { business: 'cr-business', company_id: 'cr-company', contact_name: 'cr-contact', package_id: 'cr-package', monthly_net: 'cr-monthly', term_months: 'cr-term', signed_on: 'cr-signed' };
function setForm(v = {}) {
  $('cr-business').value = v.business || '';
  $('cr-company').value = v.company_id || '';
  $('cr-contact').value = v.contact_name || '';
  $('cr-package').value = v.package_id || '';
  $('cr-monthly').value = v.monthly_net ? String(v.monthly_net) : '';
  $('cr-term').value = v.term_months ? String(v.term_months) : '';
  $('cr-signed').value = v.signed_on || '';
}
const formValues = () => Object.fromEntries(Object.entries(FIELDS).map(([k, id]) => [k, $(id).value]));
function showErrors(errors) {
  for (const [k, id] of Object.entries(FIELDS)) {
    const e = $(`${id}-err`);
    const msg = errors[k] || '';
    e.textContent = msg; e.hidden = !msg;
    if (msg) $(id).setAttribute('aria-invalid', 'true'); else $(id).removeAttribute('aria-invalid');
  }
}

// Reads `file` (a row of public.client_files) of `client` and opens the review. `onSaved(row, client)`
// after a confirmed save; `existing`: a row already kept for that file (a correction: no reading).
export function readSignedContract({ client, file, existing = null, onSaved = () => {} }) {
  if (!document.getElementById('dlg-cread')) document.body.append(markup());
  const dlg = $('dlg-cread');
  const returnTo = document.activeElement;
  let readByAi = false;
  let busy = false;
  const state = (t) => { $('cr-state').textContent = t; };
  const fail = (t) => { $('cr-err').textContent = t; $('cr-err').hidden = !t; };
  showErrors({}); fail(''); setForm({}); $('cr-notes').hidden = true;

  const read = async () => {
    busy = true;
    $('cr-submit').disabled = true; $('cr-again').hidden = true;
    state('קורא את החוזה… זה לוקח כמה שניות.');
    try {
      const ask = () => supabase.functions.invoke('contract-ai', { body: { mode: 'read', fileId: file.id } });
      let { data, error } = await ask();
      if (error && error.context?.status === 401) { await supabase.auth.refreshSession(); ({ data, error } = await ask()); }
      if (error) {
        let code = '';
        try { code = String((await error.context.json()).error || ''); } catch { /* no body */ }
        state(''); fail(READ_ERRORS[code] || READ_FAILED); $('cr-again').hidden = false;
        setForm({ business: client.business || client.name || '', company_id: client.company_id || '' });
        return;
      }
      const r = data?.result || {};
      readByAi = true;
      setForm(r);
      const notes = Array.isArray(r.notes) ? r.notes : [];
      const dropped = (Array.isArray(data?.dropped) ? data.dropped : []).map((d) => d.text).filter(Boolean);
      const all = [...notes, ...dropped];
      $('cr-notes').replaceChildren(...all.map((n) => h('li', {}, n)));
      $('cr-notes').hidden = !all.length;
      state(all.length ? 'נקרא מהחוזה. כדאי לבדוק במיוחד:' : 'נקרא מהחוזה. כדאי לעבור על כל שדה לפני השמירה.');
    } catch (err) {
      state(''); fail(errorText(err)); $('cr-again').hidden = false;
    } finally {
      busy = false;
      $('cr-submit').disabled = false;
    }
  };

  const save = async (e) => {
    e.preventDefault();
    if (busy) return;
    const c = checkReadForm(formValues());
    showErrors(c.errors);
    if (!c.ok) { fail('יש שדות לתקן.'); $(FIELDS[Object.keys(c.errors)[0]])?.focus(); return; }
    fail('');
    busy = true;
    $('cr-submit').disabled = true;
    $('cr-submit').textContent = 'שומר…';
    try {
      const row = { ...c.row, package_name: c.row.package_id ? packageName(c.row.package_id) : null, read_by_ai: readByAi || !!existing?.read_by_ai };
      const q = existing
        ? supabase.from('manual_contracts').update(row).eq('id', existing.id)
        : supabase.from('manual_contracts').insert({ client_id: client.id, file_id: file.id, ...row });
      const { data: saved, error } = await q.select().single();
      if (error) throw error;
      const patch = clientPatchFromRead(c.row, client, { packageName, dealDeliverables });
      let next = client;
      if (Object.keys(patch).length) {
        try {
          next = await updateClient(client.id, patch);
        } catch (err) {
          toast(`החוזה נשמר, אבל פרטי הלקוח לא עודכנו: ${errorText(err)}`);
        }
      }
      dlg.close();
      toast(existing ? 'פרטי החוזה עודכנו.' : 'החוזה נשמר. הוא מופיע ב״הצעות שנשלחו״ כחוזה ידני.');
      onSaved(saved, next);
    } catch (err) {
      fail(`לא נשמר: ${errorText(err)}`);
    } finally {
      busy = false;
      $('cr-submit').disabled = false;
      $('cr-submit').textContent = 'אישור ושמירה';
    }
  };

  const form = $('cr-form');
  form.onsubmit = save;
  $('cr-again').onclick = () => { fail(''); read(); };
  dlg.onclick = (e) => { if (e.target.closest('[data-close]') || e.target === dlg) dlg.close(); };
  dlg.onclose = () => { if (returnTo?.isConnected) returnTo.focus(); };
  dlg.showModal();
  if (existing) {
    setForm({ ...existing, monthly_net: existing.monthly_net_agorot ? existing.monthly_net_agorot / 100 : null });
    state('הפרטים שנשמרו מהחוזה. אפשר לתקן.');
    $('cr-business').focus();
  } else {
    read().then(() => $('cr-business').focus());
  }
}
