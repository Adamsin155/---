// "חוזים חריגים": the card of exceptional contracts (the owner's decisions of
// 6.10.2026), at the top of the first screen of whoever deals with them.
//   - The approvers (the owner, Ofir, Lior): "חוזים חריגים לאישור (N)". Each contract
//     with the business, the package, what differs from the built-in rules, the
//     totals, who prepared it, the full agreement in a preview, and "מאשר" /
//     "לא מאשר" (the latter asks for a note). One approval is enough.
//   - Whoever prepared them (Irit; the rest of the office sees them too): "ממתין
//     לאישור", "אושר — אפשר לשלוח" with the share dialog, "לא אושר: <הערה>" with
//     "תיקון ושליחה מחדש" (the builder, index.html?revise=…).
// The database decides who may do what (public.quote_approve / quote_reject, row
// level security on quotes); the logic is app/approvals-logic.js. The page gives a
// section and its own toast; the dialogs and the styles come from here.
import { supabase, quoteLink, explainError } from './supa.js';
import { h, renderQuoteDoc, whatsappLink, formatDate } from './quote-doc.js';
import { formatILS } from './pricing.js';
import { PEOPLE } from './protocol.js';
import {
  approvalLists, mayDecide, canApprove, seesApprovals, approvalText, APPROVAL_TEXT, businessOf, packageOf, deviationsOf,
  reviseUrl, preparedBy, shareText, APPROVER_NAMES,
} from './approvals-logic.js';

const COLS = 'id, token, number, client_name, model, monthly_gross_agorot, term_gross_agorot, created_at, created_by_email, status, approval, approval_by, approval_by_email, approval_at, approval_note, exceptions, version, submitted_at, submitted_by_email, expires_at';
const missing = (error) => ['42703', '42P01', 'PGRST204', 'PGRST205'].includes(error?.code);

let box = null;
let viewer = null;
let email = '';
let quotes = [];
let people = {};
let say = () => {};
let onChange = () => {};
let active = false;
let rejecting = null; // the id of the contract whose "לא מאשר" note is open

for (const href of ['app/styles/quote.css', 'app/styles/approvals.css']) {
  if (typeof document !== 'undefined' && !document.querySelector(`link[href="${href}"]`)) {
    document.head.append(h('link', { rel: 'stylesheet', href }));
  }
}

const nameOf = (mail) => {
  const key = String(mail || '').toLowerCase();
  if (!key) return '';
  if (key in people) return people[key] ? PEOPLE[people[key]]?.name || people[key] : 'הבעלים';
  return key.split('@')[0];
};
const APPROVER_NAME = { owner: 'הבעלים', ofir: 'אופיר', lior: 'ליאור' };
const money = (agorot) => h('bdi', { class: 'num', dir: 'ltr' }, formatILS(agorot));

// ── Data ────────────────────────────────────
// Every contract that went for approval and is not signed or cancelled. null: the
// columns are not there yet (before the migration).
export async function loadApprovals() {
  const { data, error } = await supabase.from('quotes').select(COLS).neq('approval', 'none').eq('status', 'sent')
    .order('created_at', { ascending: false }).limit(200);
  if (error) {
    if (missing(error)) return null;
    throw error;
  }
  return data || [];
}
async function loadPeople() {
  try {
    const { data } = await supabase.from('staff').select('email, person');
    if (Array.isArray(data)) people = Object.fromEntries(data.map((s) => [String(s.email || '').toLowerCase(), s.person || null]));
  } catch { /* names fall back to the email */ }
}

// ── Dialogs (made once, kept in the page) ────
function dialog(id, cls, labelId) {
  let dlg = document.getElementById(id);
  if (dlg) return dlg;
  dlg = h('dialog', { id, class: cls, 'aria-labelledby': labelId });
  dlg.addEventListener('click', (e) => { if (e.target.closest('[data-close]') || e.target === dlg) dlg.close(); });
  dlg.addEventListener('close', () => dlg._returnTo?.focus?.());
  document.body.append(dlg);
  return dlg;
}
const closeBtn = (label) => h('button', { type: 'button', class: 'close', 'data-close': true, 'aria-label': label }, '×');

// The full document, exactly as the client will get it once it is approved.
export function previewContract(q, from = document.activeElement) {
  const dlg = dialog('dlg-approval-preview', 'preview', 'apv-h');
  dlg.replaceChildren(
    h('div', { class: 'dlg-head' },
      h('h2', { id: 'apv-h' }, `${q.model?.docTitle || 'הסכם'} `, h('bdi', { class: 'num', dir: 'ltr' }, q.number)),
      h('span', { class: 'apv-hint' }, q.approval === 'pending' ? 'כך הלקוח יראה אותו אחרי האישור' : ''),
      closeBtn('סגירת התצוגה')),
    h('div', { class: 'preview-body' }, renderQuoteDoc(q.model, { number: q.number, createdAt: q.created_at, validUntil: q.expires_at })));
  dlg._returnTo = from;
  dlg.showModal();
  dlg.querySelector('.close').focus();
}

// An approved contract: the link, and sending it the usual ways.
export function shareContract(q, from = document.activeElement, notify = say) {
  const dlg = dialog('dlg-approval-share', 'apv-share', 'aps-h');
  const link = quoteLink(q.token);
  const text = shareText(q, link);
  const c = q.model?.client || {};
  const input = h('input', { class: 'input', id: 'aps-link', readonly: true, value: link, dir: 'ltr' });
  dlg.replaceChildren(
    h('div', { class: 'dlg-head' }, h('h2', { id: 'aps-h' }, 'הקישור מוכן'), closeBtn('סגירה')),
    h('div', { class: 'dlg-body' },
      h('p', {}, 'החוזה ', h('strong', { class: 'num', dir: 'ltr' }, q.number), ` של ${businessOf(q)} אושר. `,
        q.expires_at ? `הלקוח יכול לחתום עד ${formatDate(q.expires_at, true)}.` : ''),
      h('label', { class: 'field-label', for: 'aps-link' }, 'קישור ללקוח'),
      h('div', { class: 'linkbox' }, input,
        h('button', {
          type: 'button', class: 'btn', id: 'aps-copy',
          onclick: async () => {
            try { await navigator.clipboard.writeText(link); notify('הקישור הועתק.'); } catch { input.select(); notify('סמנו את הקישור והעתיקו ידנית.'); }
          },
        }, 'העתקה'))),
    h('div', { class: 'dlg-foot' },
      h('a', { class: 'btn btn-ghost', id: 'aps-open', href: link, target: '_blank', rel: 'noopener' }, 'פתיחת הקישור'),
      h('a', { class: 'btn btn-ghost', id: 'aps-mail', href: `mailto:${encodeURIComponent(String(c.email || '').trim())}?subject=${encodeURIComponent(`${q.model?.docTitle || 'הסכם התקשרות'} ${q.number} · astrateg`)}&body=${encodeURIComponent(text)}` }, 'שליחה במייל'),
      h('a', { class: 'btn', id: 'aps-wa', href: whatsappLink(c.phone, text), target: '_blank', rel: 'noopener' }, 'שליחה בוואטסאפ')));
  dlg._returnTo = from;
  dlg.showModal();
  input.select();
}

// ── Decisions ───────────────────────────────
function explain(err) {
  const msg = String(err?.message || err || '');
  if (/cannot approve a contract you prepared/.test(msg)) return 'את החוזה הזה הכנת בעצמך: מנהל אחר צריך לאשר אותו.';
  if (/not waiting for approval|quote not found/.test(msg)) return 'כבר התקבלה החלטה על החוזה הזה. הרשימה רועננה.';
  if (/note is required/.test(msg)) return 'כדי להחזיר את החוזה צריך לכתוב הערה (עד 1000 תווים).';
  if (/not allowed|permission denied/.test(msg)) return 'רק אדם, אופיר או ליאור מאשרים חוזה חריג.';
  return explainError(err);
}
async function decide(q, btn, rpc, args, done) {
  btn.disabled = true;
  const { error } = await supabase.rpc(rpc, args);
  if (error) {
    say(explain(error));
    btn.disabled = false;
    if (/not waiting|not found/.test(error.message || '')) await refreshApprovals();
    return;
  }
  rejecting = null;
  say(done);
  await refreshApprovals();
  onChange();
}

// ── The card ────────────────────────────────
function facts(q) {
  const t = q.model?.totals || {};
  const months = q.model?.termMonths || 12;
  const row = (k, v) => h('div', {}, h('dt', {}, k), h('dd', {}, v));
  return h('dl', { class: 'apv-facts' },
    row('לחודש לפני מע״מ', money(t.monthlyNet ?? 0)),
    t.discount ? row('הנחה לחודש', money(t.discount)) : null,
    row('לחודש כולל מע״מ', money(t.monthlyGross ?? q.monthly_gross_agorot)),
    row('תקופה', months === 1 ? 'חודש אחד' : `${months} חודשים`),
    row('סה״כ כולל מע״מ', money(t.termGross ?? q.term_gross_agorot)));
}
function differs(q) {
  const list = deviationsOf(q);
  return h('div', { class: 'apv-diff' },
    h('h4', {}, 'מה שונה מהחבילה'),
    list.length ? h('ul', {}, list.map((t) => h('li', {}, t))) : h('p', { class: 'hint' }, 'הפירוט לא נשמר. לפתוח את תצוגת ההסכם.'));
}
const head = (q, tag) => h('div', { class: 'apv-head' },
  h('span', { class: 'apv-title', id: `apv-${q.id}`, dir: 'auto' }, businessOf(q)),
  tag);
const meta = (q) => h('p', { class: 'apv-meta' },
  `${packageOf(q)} · `, h('bdi', { class: 'num', dir: 'ltr' }, q.number),
  ` · הכין/ה: ${nameOf(preparedBy(q))}, ${formatDate(q.submitted_at || q.created_at, true)}`,
  q.version > 1 ? ` · גרסה ${q.version}` : '');
const previewBtn = (q) => h('button', { type: 'button', class: 'btn btn-ghost', 'data-act': 'preview', onclick: (e) => previewContract(q, e.currentTarget) }, 'תצוגת ההסכם');

function decideCard(q) {
  const can = mayDecide(q, viewer, email);
  const open = rejecting === q.id;
  const noteId = `apv-note-${q.id}`;
  return h('article', { class: 'apv-item', 'data-quote': q.id, 'aria-labelledby': `apv-${q.id}` },
    head(q, h('span', { class: 'apv-state is-pending' }, APPROVAL_TEXT.pending)),
    meta(q), differs(q), facts(q),
    open ? h('form', {
      class: 'apv-reject', novalidate: true,
      onsubmit: (e) => {
        e.preventDefault();
        const note = document.getElementById(noteId);
        const text = note.value.trim();
        const err = document.getElementById(`${noteId}-err`);
        if (!text) { err.hidden = false; note.setAttribute('aria-invalid', 'true'); note.focus(); return; }
        decide(q, e.submitter || e.currentTarget.querySelector('button[type="submit"]'), 'quote_reject', { p_id: q.id, p_note: text }, `החוזה של ${businessOf(q)} חזר ל${nameOf(preparedBy(q)) || 'עירית'} עם ההערה.`);
      },
    },
    h('label', { for: noteId }, 'מה צריך לתקן? ההערה תגיע למי שהכין/ה את החוזה'),
    h('textarea', { class: 'input', id: noteId, rows: 3, maxlength: 1000, required: true, 'aria-describedby': `${noteId}-err` }),
    h('div', { class: 'err', id: `${noteId}-err`, hidden: true }, 'בלי הערה אי אפשר להחזיר את החוזה.'),
    h('div', { class: 'apv-acts' },
      h('button', { type: 'submit', class: 'btn', 'data-act': 'reject-send' }, 'לא מאשר — להחזיר לתיקון'),
      h('button', { type: 'button', class: 'btn btn-ghost', onclick: () => { rejecting = null; render(); document.querySelector(`[data-quote="${q.id}"] [data-act="reject"]`)?.focus(); } }, 'ביטול')))
      : h('div', { class: 'apv-acts' },
        can ? h('button', {
          type: 'button', class: 'btn apv-yes', 'data-act': 'approve',
          onclick: (e) => decide(q, e.currentTarget, 'quote_approve', { p_id: q.id }, `החוזה של ${businessOf(q)} אושר. ${nameOf(preparedBy(q)) || 'עירית'} יכול/ה לשלוח אותו.`),
        }, 'מאשר') : null,
        can ? h('button', {
          type: 'button', class: 'btn btn-ghost', 'data-act': 'reject',
          onclick: () => { rejecting = q.id; render(); document.getElementById(noteId)?.focus(); },
        }, 'לא מאשר') : null,
        previewBtn(q)),
    can ? null : h('p', { class: 'hint apv-own' }, 'את החוזה הזה הכנת בעצמך: מנהל אחר צריך לאשר אותו.'));
}

function followCard(q) {
  const state = q.approval;
  const by = APPROVER_NAME[q.approval_by] || nameOf(q.approval_by_email);
  return h('article', { class: 'apv-item', 'data-quote': q.id, 'aria-labelledby': `apv-${q.id}` },
    head(q, h('span', { class: `apv-state is-${state}` }, APPROVAL_TEXT[state])),
    meta(q),
    state === 'rejected' ? h('p', { class: 'apv-note' }, h('strong', {}, `${by} לא אישר/ה: `), q.approval_note || '') : null,
    state === 'approved' ? h('p', { class: 'apv-meta' }, `אישר/ה ${by}, ${formatDate(q.approval_at, true)}`, q.expires_at ? ` · לחתימה עד ${formatDate(q.expires_at, true)}` : '') : null,
    state === 'pending' ? h('p', { class: 'apv-meta' }, `ממתין להחלטה של ${APPROVER_NAMES}. מספיק שאחד מהם יאשר.`) : null,
    h('div', { class: 'apv-acts' },
      state === 'approved' ? h('button', { type: 'button', class: 'btn', 'data-act': 'share', onclick: (e) => shareContract(q, e.currentTarget) }, 'שליחה ללקוח') : null,
      state === 'rejected' ? h('a', { class: 'btn', 'data-act': 'revise', href: reviseUrl(q) }, 'תיקון ושליחה מחדש') : null,
      previewBtn(q)));
}

function render() {
  if (!box) return;
  const { toDecide, follow } = approvalLists(quotes, viewer, email);
  box.hidden = !toDecide.length && !follow.length;
  if (box.hidden) { box.replaceChildren(); return; }
  box.replaceChildren(...[
    toDecide.length ? h('h2', { id: 'approvals-h' }, `חוזים חריגים לאישור (${toDecide.length})`) : h('h2', { id: 'approvals-h' }, `חוזים חריגים (${follow.length})`),
    toDecide.length ? h('p', { class: 'hint' }, 'חוזה שהוכן עם שינוי מהחבילות. הלקוח מקבל אותו רק אחרי אישור של אחד מכם.') : null,
    ...toDecide.map(decideCard),
    toDecide.length && follow.length ? h('h3', { class: 'apv-sub' }, `במעקב (${follow.length})`) : null,
    ...follow.map(followCard),
  ].filter(Boolean));
}

// Mounts the card for an office viewer; hidden for anyone else, and until the
// migration is in. `toast(text)`: the page's own; `changed()`: after a decision.
export async function mountApprovals(el, who, { mail = '', toast = () => {}, changed = () => {} } = {}) {
  box = el;
  viewer = who;
  email = String(mail || '').toLowerCase();
  say = toast;
  onChange = changed;
  if (!el || !seesApprovals(who)) { if (el) el.hidden = true; return; }
  el.classList.add('approvals-card');
  el.setAttribute('aria-labelledby', 'approvals-h');
  active = true;
  await loadPeople();
  await refreshApprovals();
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshApprovals(); });
  setInterval(() => { if (!document.hidden && rejecting === null) refreshApprovals(); }, 60e3);
}

export async function refreshApprovals() {
  if (!box || !active) return;
  try {
    const rows = await loadApprovals();
    quotes = rows || [];
  } catch {
    return; // keep the last list
  }
  if (rejecting !== null && !quotes.some((q) => q.id === rejecting && q.approval === 'pending')) rejecting = null;
  // While a note is being typed, the list waits.
  if (rejecting !== null && document.activeElement?.closest?.('.apv-reject')) return;
  render();
}

export { approvalText, canApprove };
