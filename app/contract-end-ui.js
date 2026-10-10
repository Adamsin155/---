// The card of a contract that ended while the client is still "active", on Lior's
// "המשימות שלי" (protocol v10; docs/ops.md, section 58; the rules: app/contract-end.js).
// One sentence and two actions:
//   "נרשם חידוש"     a small dialog with the new end date of the contract; it writes the
//                    client card's own field (contract_end), the same way (updateClient);
//   "סיום התקשרות"   asks once, and sets the client's status to "מסיים התקשרות" (the client
//                    card's own field), which is what process 35 needs to appear.
// Nothing changes by itself: until one of them is pressed the client stays "active".
import { h, toast, errorText, formatDay } from './protocol-ui.js';
import { updateClient, setCheck } from './protocol-data.js';
import { CONTRACT_END, renewedEnd, validRenewal } from './contract-end.js';
import { dayFromKeyIL } from './tz.js';

export const RENEW_ACTION = 'נרשם חידוש';
export const END_ACTION = 'סיום התקשרות';
export const ENDING_MARK = 'p35.opened';
// Lior decides (and the owners, who see everything). The database lets the office edit a client.
export const mayDecideContract = (viewer) => !!viewer && !viewer.error && viewer.scope === 'office' && (viewer.me === null || viewer.me === CONTRACT_END.who);
export const contractSentence = (x) => (x.today ? 'החוזה הסתיים היום: חידוש או סיום התקשרות?' : `החוזה הסתיים ב־${formatDay(x.endAt)}: חידוש או סיום התקשרות?`);

let dlg = null;
let target = null;
function build() {
  dlg = h('dialog', { id: 'dlg-renew', class: 'dlg-renew', 'aria-labelledby': 'renew-h' },
    h('form', { id: 'renew-form', novalidate: '' },
      h('div', { class: 'dlg-head' },
        h('h2', { id: 'renew-h' }, RENEW_ACTION),
        h('button', { type: 'button', class: 'close', 'data-close': '', 'aria-label': 'סגירה' }, '×')),
      h('div', { class: 'dlg-body form-grid' },
        h('p', { class: 'span-2 wait-ctx', id: 'renew-ctx' }),
        h('div', { class: 'field span-2' }, h('label', { for: 'renew-end' }, 'עד מתי החוזה החדש?'),
          h('input', { class: 'input', id: 'renew-end', type: 'date', dir: 'ltr', required: '' })),
        h('p', { class: 'hint span-2' }, 'התאריך נשמר בכרטיס הלקוח כ״סיום החוזה״. את ההסכם החדש עצמו מכינים כרגיל, ב״חידושים״.'),
        h('div', { class: 'err span-2', id: 'renew-err', role: 'alert', hidden: '' })),
      h('div', { class: 'dlg-foot' },
        h('button', { type: 'button', class: 'btn btn-ghost', 'data-close': '' }, 'ביטול'),
        h('button', { type: 'submit', class: 'btn btn-primary', id: 'renew-submit' }, 'שמירת החידוש'))));
  document.body.append(dlg);
  const $ = (id) => dlg.querySelector(`#${id}`);
  dlg.addEventListener('click', (e) => { if (e.target.closest('[data-close]') || e.target === dlg) dlg.close(); });
  dlg.addEventListener('close', () => { const t = target; target = null; if (t?.focusId) document.getElementById(t.focusId)?.focus(); });
  $('renew-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const t = target;
    const value = $('renew-end').value;
    const ok = validRenewal(value);
    $('renew-end').setAttribute('aria-invalid', String(!ok));
    if (!ok) { $('renew-err').textContent = 'בוחרים תאריך סיום עתידי לחוזה החדש.'; $('renew-err').hidden = false; $('renew-end').focus(); return; }
    $('renew-submit').disabled = true;
    try {
      const row = await updateClient(t.x.cid, { contract_end: value });
      dlg.close();
      toast(`נרשם חידוש: החוזה של ${t.x.name} עד ${formatDay(dayFromKeyIL(value))}.`);
      await t.onDone?.(row);
    } catch (err) {
      $('renew-err').textContent = `החידוש לא נשמר. ${errorText(err)}`;
      $('renew-err').hidden = false;
    } finally {
      $('renew-submit').disabled = false;
    }
  });
}
function openRenew(x, focusId, onDone) {
  if (!dlg) build();
  target = { x, focusId, onDone };
  const $ = (id) => dlg.querySelector(`#${id}`);
  $('renew-form').reset();
  $('renew-err').hidden = true;
  $('renew-end').removeAttribute('aria-invalid');
  $('renew-ctx').textContent = `${x.name} · החוזה הסתיים ב־${formatDay(x.endAt)}`;
  $('renew-end').value = renewedEnd(x.client.contract_end);
  dlg.showModal();
  $('renew-end').focus();
}
async function startEnding(x, btn, onDone) {
  if (!window.confirm(`לסמן את ${x.name} כ״מסיים התקשרות״? תהליך 35 (עצירת קמפיינים, הסרת גישות וסגירת חיבורים) ייפתח אצלך.`)) return;
  btn.disabled = true;
  try {
    // The moment it was started (the mark p35.opened): process 35 is due a business day from it.
    await setCheck(x.cid, ENDING_MARK, 'done', 'סיום התקשרות: החוזה הסתיים');
    const row = await updateClient(x.cid, { status: 'ending' });
    toast(`${x.name} סומן ״מסיים התקשרות״. תהליך 35 נפתח.`);
    await onDone?.(row);
  } catch (err) {
    btn.disabled = false;
    toast(`הסטטוס לא נשמר. ${errorText(err)}`);
  }
}

// The card of one ended contract. `viewer` decides whether the two actions are offered;
// `onDone(row)`: after the client was saved.
export function contractCard(x, { viewer, href, onDone }) {
  const id = `ce-${String(x.cid).replace(/[^\w-]/g, '_')}`;
  const can = mayDecideContract(viewer);
  return h('li', { class: 'wproc wc s-today contract-end', 'data-key': `contract:${x.cid}`, 'data-contract': x.cid },
    h('div', { class: 'wc-head' },
      h('a', { class: 'wclient', href }, x.name),
      h('span', { class: 'wc-when s-today' }, x.today ? 'היום' : x.days === 1 ? 'אתמול' : `לפני ${x.days} ימים`)),
    h('div', { class: 'wc-what' }, h('p', { class: 'wc-title' }, contractSentence(x))),
    can ? h('div', { class: 'contract-acts', role: 'group', 'aria-label': `החוזה של ${x.name}` },
      h('button', { type: 'button', class: 'btn btn-sm k-btn-navy', id: `${id}-renew`, 'aria-haspopup': 'dialog', onclick: () => openRenew(x, `${id}-renew`, onDone) }, RENEW_ACTION),
      h('button', { type: 'button', class: 'btn btn-sm', id: `${id}-end`, onclick: (ev) => startEnding(x, ev.currentTarget, onDone) }, END_ACTION))
      : h('p', { class: 'hint' }, 'ליאור מחליט: חידוש או סיום התקשרות.'));
}
