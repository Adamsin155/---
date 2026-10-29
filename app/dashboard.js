import {
  supabase, currentStaff, quoteLink, explainError,
  sendPasswordReset, consumeRecoveryLink, looksLikeEmail, cleanEmail, RESET_NEEDS_EMAIL, RESET_SENT, signOutHere, LINK_KEPT, sessionEmail,
} from './supa.js';
import { h, formatDate, whatsappLink } from './quote-doc.js';
import { dressHead, headIcon, besideIcon, leadIcon } from './kit.js';
import { formatILS } from './pricing.js';
import { dayKeyIL } from './tz.js';
import { glide, countUp, viewerFor } from './shell.js';
// Who opens this list (the owners, Irit and Ofir) and who sees its amounts (the owners, 6.10.2026,
// and Ofir, 29.10.2026: app/manager-rules.js seesQuoteMoney).
import { canSeeQuoteList, seesQuoteMoney, resetMode } from './manager-rules.js';
import { forgetPlace, signInPlan, refusedHere } from './visit.js';
// The sign-in screen and its button with the door (docs/ops.md, section 51).
import { loginDoor } from './login-ui.js';
// Exceptional contracts (6.10.2026): their approval state, and what the office does next.
import { APPROVAL_TEXT, reviseUrl } from './approvals-logic.js';
// The contracts still out for signature (docs/ops.md, section 47): the filter "ממתינות
// לחתימה" lists exactly what the line of "המשימות שלי" counts, the oldest first.
import { waitsForSignature, sentForSignatureAt, UNSIGNED_FILTER } from './unsigned-logic.js';

const $ = (id) => document.getElementById(id);

// The look of the kit (app/kit.js; docs/ops.md, section 53): the page's head, the empty
// list and the dialogs take their icons; the table, its numbers and its words stay.
dressHead(document.querySelector('.page-head > div'), 'send', 'purple', { size: 'lg' });
headIcon($('na-h'), 'lock', 'navy', { size: 'md' });
headIcon($('pw-h'), 'lock', 'navy');
besideIcon($('empty'), 'inbox', 'navy', { size: 'sm' }).parentNode.classList.add('k-emptyrow');
leadIcon($('btn-refresh'), 'loop');
let quotes = [];
let filter = location.hash === `#${UNSIGNED_FILTER}` ? UNSIGNED_FILTER : 'all';
let showMoney = false;      // the amounts and their sums: the owners and Ofir (seesQuoteMoney)

const STATUS = {
  sent: 'ממתין לחתימה',
  viewed: 'נצפה',
  shared: 'נשלח לצפייה',
  seen: 'נצפה',
  signed: 'נחתם',
  expired: 'פג תוקף',
  cancelled: 'בוטל',
  // A contract a manager turned down before 29.10.2026 (since then nothing waits for a manager:
  // docs/ops.md, section 79; one still marked 'pending' is a regular one, its link works).
  rejected: 'לא אושר',
};
// The tone of each state's pill (the kit's status pill, kit.css).
const TONE = { sent: 'warn', viewed: 'info', shared: 'plain', seen: 'info', signed: 'ok', expired: 'late', cancelled: 'plain', rejected: 'late' };
const OPEN = ['sent', 'viewed', 'shared', 'seen'];
const APPROVAL = ['rejected'];
// View-only quotes have no signing step: they are either shared or seen.
const statusOf = (q) => {
  if (q.status === 'sent' && q.approval === 'rejected') return 'rejected';
  if (q.status === 'sent' && q.expires_at && new Date(q.expires_at) < new Date()) return 'expired';
  if (q.status === 'sent' && q.signable === 'false') return q.first_viewed_at ? 'seen' : 'shared';
  return q.status === 'sent' && q.first_viewed_at ? 'viewed' : q.status;
};

let toastTimer;
function toast(msg) {
  $('toast').textContent = msg;
  $('toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, 3200);
}

function setSession(staff) {
  $('session-dot').classList.toggle('on', !!staff?.isStaff);
  $('session-who').textContent = staff ? staff.email : 'לא מחובר';
  $('btn-logout').hidden = !staff;
  $('btn-password').hidden = !staff;
  $('btn-refresh').hidden = !staff?.isStaff;
}

let statsShown = null;
function renderStats() {
  const count = (s) => quotes.filter((q) => statusOf(q) === s).length;
  // The whole agreement with VAT (its months × the monthly gross), not a month of it (the owner,
  // 28.10.2026): what was sent this month, and what was signed this month (Israel months).
  const month = dayKeyIL(new Date()).slice(0, 7);
  const inMonth = (t) => !!t && dayKeyIL(new Date(t)).slice(0, 7) === month;
  const total = (list) => list.reduce((s, q) => s + (q.term_gross_agorot || 0), 0);
  const sentThisMonth = total(quotes.filter((q) => inMonth(q.created_at) && q.status !== 'cancelled'));
  const signedThisMonth = total(quotes.filter((q) => q.status === 'signed' && inMonth(q.signed_at)));
  const stat = (k, v, cls = '') => h('div', { class: `stat${cls}` }, h('div', { class: 'k' }, k), h('div', { class: 'v ds-num', dir: 'ltr' }, v));
  // The two sums take a row of their own, half each (app/styles/quotes.css): a sum in shekels
  // squeezed into a sixth of the row ran into the tile beside it.
  $('stats').classList.toggle('has-money', showMoney);
  $('stats').replaceChildren(
    stat('הצעות', String(quotes.filter((q) => !q.legacy).length)),
    stat('ממתינות לחתימה', String(count('sent') + count('viewed'))),
    stat('הצעות לצפייה', String(count('shared') + count('seen'))),
    stat('נחתמו', String(count('signed'))),
    ...(showMoney ? [stat('נשלח החודש · כולל מע״מ', formatILS(sentThisMonth), ' stat-money'), stat('נחתם החודש · כולל מע״מ', formatILS(signedThisMonth), ' stat-money')] : []),
  );
  $('stats').hidden = false;
  // The numbers count up the first time the page shows them.
  statsShown ??= performance.now();
  countUp($('stats'), statsShown);
}

function renderFilters() {
  const n = (k) => quotes.filter((q) => k === 'all' || (k === 'open' ? OPEN.includes(statusOf(q)) : k === 'approval' ? APPROVAL.includes(statusOf(q)) : k === UNSIGNED_FILTER ? waitsForSignature(q) : statusOf(q) === k)).length;
  const opts = [['all', 'הכול'], ['open', 'ממתינות'], ['signed', 'נחתמו'], ['expired', 'פג תוקף'], ['cancelled', 'בוטלו']];
  // Shown only when there is such a contract.
  if (n('approval') || filter === 'approval') opts.splice(1, 0, ['approval', 'לא אושרו']);
  if (n(UNSIGNED_FILTER) || filter === UNSIGNED_FILTER) opts.splice(1, 0, [UNSIGNED_FILTER, 'ממתינות לחתימה']);
  $('filters').replaceChildren(...opts.map(([k, label]) => h('button', {
    type: 'button', class: 'chip', 'aria-pressed': String(filter === k),
    onclick: () => glide(() => { filter = k; renderFilters(); renderRows(); }),
  }, label, h('span', { class: 'n' }, String(n(k))))));
}

async function copy(link) {
  try { await navigator.clipboard.writeText(link); toast('הקישור הועתק.'); } catch { toast(link); }
}

async function cancel(q, btn) {
  if (!confirm(`לבטל את הצעה ${q.number}? הלקוח לא יוכל לפתוח את הקישור או לחתום.`)) return;
  btn.disabled = true;
  const { error } = await supabase.rpc('cancel_quote', { p_id: q.id });
  if (error) {
    toast(/only unsigned/.test(error.message || '') ? `לא ניתן לבטל את ${q.number}: ההצעה כבר נחתמה או בוטלה.` : explainError(error));
    await loadQuotes();
    return;
  }
  toast(`ההצעה ${q.number} בוטלה.`);
  await loadQuotes();
}

// What a contract changed from the package (information only since 29.10.2026: no contract waits
// for a manager; docs/ops.md, section 79), and a decision a manager took before that date.
const APPROVER = { owner: 'הבעלים', ofir: 'אופיר', lior: 'ליאור' };
function approvalCell(q) {
  const list = (Array.isArray(q.exceptions) ? q.exceptions : []).map((e) => e?.text).filter(Boolean);
  const by = APPROVER[q.approval_by] || '';
  const parts = [
    list.length ? h('span', { title: list.join(' · ') }, list.length === 1 ? 'שינוי אחד מהחבילה' : `${list.length} שינויים מהחבילה`) : null,
    q.approval === 'rejected' ? h('span', { class: 'apv-state is-rejected' }, APPROVAL_TEXT.rejected) : null,
    q.approval === 'rejected' && q.approval_note ? h('small', {}, `${by ? `${by}: ` : ''}${q.approval_note}`) : null,
    q.approval === 'approved' && by ? h('small', {}, `אישר/ה ${by}`) : null,
    list.length ? h('small', {}, list.slice(0, 3).join(' · ') + (list.length > 3 ? ' …' : '')) : null,
  ].filter(Boolean);
  return parts.length ? h('span', { class: 'apv-cell' }, ...parts) : h('span', { class: 'apv-cell', title: 'חוזה רגיל' }, '—');
}
// An approved contract: the share dialog (the link, WhatsApp, mail), as after creating a regular one.
async function share(q, btn) {
  const { shareContract } = await import('./approvals-ui.js');
  shareContract({
    ...q,
    model: { docTitle: q.doc, signable: q.signable !== 'false', termMonths: Number(q.term) || 12, validHours: Number(q.valid) || null, client: { name: q.client_name, company: q.company, phone: q.phone, email: q.email } },
  }, btn, toast);
}

// A contract signed in the old system or on paper since the new system began (the owner,
// 29.10.2026: "צריך להוסיף את מה שיש מהמערכת הישנה"): read from public.legacy_contracts, shown
// as a signed row with its amount, counted in "נחתם החודש". Its only action opens the document.
function legacyRow(q, s) {
  return h('tr', { class: 'is-legacy' },
    h('td', { 'data-label': 'מספר' }, h('span', { class: 'num', dir: 'ltr' }, q.number), h('small', { class: 'doc-type' }, q.doc)),
    h('td', { class: 'client', 'data-label': 'לקוח' }, q.client_name),
    h('td', { class: 'client', 'data-label': 'חבילה' }, h('span', { dir: 'auto' }, q.tier || ''), h('small', {}, q.influencer || '')),
    showMoney ? h('td', { class: 'amt', dir: 'ltr', 'data-label': 'סה״כ כולל מע״מ' }, formatILS(q.term_gross_agorot ?? 0),
      q.monthly_gross_agorot ? h('small', { class: 'by', dir: 'rtl' }, `${formatILS(q.monthly_gross_agorot)} לחודש`) : null) : null,
    h('td', { 'data-label': 'נוצר' }, formatDate(q.created_at), h('small', { class: 'by' }, 'מחוץ למחולל')),
    h('td', { 'data-label': 'סטטוס' }, h('span', { class: `pill k-pill k-pill-${TONE[s] || 'plain'} ${s}` }, STATUS[s]), h('small', { class: 'when' }, h('span', { class: 'k-sep' }, ' · '), formatDate(q.signed_at, true))),
    h('td', { 'data-label': 'אישור מנהל' }, h('span', { class: 'apv-cell' }, '—')),
    h('td', { class: 'acts-cell' }, h('div', { class: 'acts' },
      h('a', { class: 'btn btn-sm btn-ghost', href: `legacy-contract.html?id=${encodeURIComponent(q.legacy)}` }, 'פתיחה'))));
}

// The old system's signed contracts from this date on: the clients the office signed outside the
// builder after the new system began, until everyone sends from it (the owner, 29.10.2026).
const LEGACY_FROM = '2026-10-01';
function legacyAsQuote(l) {
  const d = l.doc || {};
  const vat = 1.18;
  return {
    legacy: l.id, number: l.doc_number || `#${l.id}`, client_name: l.client_name || d.clientName || '', status: 'signed',
    signed_at: l.signed_at, created_at: l.signed_at, signer_name: l.signer_name || null,
    term_gross_agorot: l.total_amount != null ? Math.round(Number(l.total_amount) * 100) : 0,
    monthly_gross_agorot: l.retainer != null ? Math.round(Number(l.retainer) * vat) * 100 : 0,
    tier: d.packageName || '', influencer: d.influencers || '', doc: 'חוזה · מהמערכת הישנה', signable: 'true',
  };
}
async function loadLegacy() {
  const { data, error } = await supabase.from('legacy_contracts')
    .select('id, client_id, doc_type, doc_number, status, total_amount, retainer, signed_at, signer_name, doc')
    .eq('status', 'signed').eq('doc_type', 'contract').gte('signed_at', LEGACY_FROM).order('signed_at', { ascending: false }).limit(100);
  if (error || !data?.length) return [];
  const ids = [...new Set(data.map((l) => l.client_id))];
  const { data: cs } = await supabase.from('clients').select('id, name, business, quote_id').in('id', ids);
  const name = Object.fromEntries((cs || []).map((c) => [c.id, c.business || c.name]));
  // A client whose agreement was signed in the builder is counted there, not twice (רוזיטה, 26.10).
  const built = new Set((cs || []).filter((c) => c.quote_id).map((c) => c.id));
  return data.filter((l) => !built.has(l.client_id)).map((l) => legacyAsQuote({ ...l, client_name: name[l.client_id] }));
}

function renderRows() {
  const list = quotes.filter((q) => {
    const s = statusOf(q);
    if (filter === 'all') return true;
    if (filter === 'open') return OPEN.includes(s);
    if (filter === 'approval') return APPROVAL.includes(s);
    if (filter === UNSIGNED_FILTER) return waitsForSignature(q);
    return s === filter;
  });
  // What waits for a signature: the one that waits longest first.
  if (filter === UNSIGNED_FILTER) list.sort((a, b) => sentForSignatureAt(a) - sentForSignatureAt(b));
  $('rows').replaceChildren(...list.map((q) => {
    const s = statusOf(q);
    if (q.legacy) return legacyRow(q, s);
    const link = quoteLink(q.token);
    const when = s === 'signed' ? formatDate(q.signed_at, true) : (s === 'viewed' || s === 'seen') ? formatDate(q.first_viewed_at, true) : '';
    const open = OPEN.includes(s);
    // Turned down by a manager before 29.10.2026: there is no link to open or send.
    const held = APPROVAL.includes(s);
    const agreement = q.signable !== 'false';
    const reminder = `שלום ${q.client_name}, רק מזכירים ש${agreement ? 'הסכם ההתקשרות' : 'הצעת המחיר'} מאסטרטג (${q.number}) ממתינ${agreement ? '' : 'ה'} לך כאן${q.expires_at ? `, ${agreement ? 'לחתימה' : 'בתוקף'} עד ${formatDate(q.expires_at, true)}` : ''}:\n${link}`;
    return h('tr', {},
      h('td', { 'data-label': 'מספר' }, h('span', { class: 'num', dir: 'ltr' }, q.number), h('small', { class: 'doc-type' }, q.doc || 'הצעת מחיר'),
        ...(q.prepared_by === 'ai' ? [h('span', { class: 'tag tag-ai doc-ai' }, 'הוכן ע״י AI')] : [])),
      h('td', { class: 'client', 'data-label': 'לקוח' }, q.client_name, q.signer_name && s === 'signed' ? h('small', {}, `נחתם ע״י ${q.signer_name}`) : null),
      h('td', { class: 'client', 'data-label': 'חבילה' }, h('span', { dir: 'auto' }, q.tier || ''), h('small', {}, q.influencer || '')),
      showMoney ? h('td', { class: 'amt', dir: 'ltr', 'data-label': 'סה״כ כולל מע״מ' }, formatILS(q.term_gross_agorot ?? 0),
        h('small', { class: 'by', dir: 'rtl' }, `${formatILS(q.monthly_gross_agorot)} לחודש`)) : null,
      h('td', { 'data-label': 'נוצר' }, formatDate(q.created_at), h('small', { class: 'by' }, q.created_by_email || '')),
      h('td', { 'data-label': 'סטטוס' }, h('span', { class: `pill k-pill k-pill-${TONE[s] || 'plain'} ${s}` }, STATUS[s]), when ? h('small', { class: 'when' }, h('span', { class: 'k-sep' }, ' · '), when) : null,
        open && q.expires_at ? h('small', { class: 'until' }, `${agreement ? 'לחתימה' : 'בתוקף'} עד ${formatDate(q.expires_at, true)}`) : null),
      h('td', { 'data-label': 'שינויים מהחבילה' }, approvalCell(q)),
      h('td', { class: 'acts-cell' }, h('div', { class: 'acts' },
        open ? h('a', { class: 'btn btn-sm btn-ghost', href: whatsappLink(q.phone, reminder), target: '_blank', rel: 'noopener' }, 'תזכורת בוואטסאפ') : null,
        open && q.approval === 'approved' ? h('button', { type: 'button', class: 'btn btn-sm', 'data-act': 'share', onclick: (e) => share(q, e.currentTarget) }, 'שליחה ללקוח') : null,
        s === 'rejected' ? h('a', { class: 'btn btn-sm', 'data-act': 'revise', href: reviseUrl(q) }, 'תיקון ושליחה מחדש') : null,
        s !== 'cancelled' && !held ? h('a', { class: 'btn btn-sm btn-ghost', href: link, target: '_blank', rel: 'noopener' }, 'פתיחה') : null,
        s !== 'cancelled' && !held ? h('button', { type: 'button', class: 'btn btn-sm btn-ghost', onclick: () => copy(link) }, 'העתקת קישור') : null,
        open || held
          ? h('button', { type: 'button', class: 'btn btn-sm btn-ghost', onclick: (e) => cancel(q, e.currentTarget) }, 'ביטול')
          : null,
      )),
    );
  }));
  $('empty').hidden = list.length > 0;
  $('empty').textContent = quotes.length ? (filter === UNSIGNED_FILTER ? 'אין כרגע הסכם שמחכה לחתימה.' : 'אין הצעות בסינון הזה.') : 'עדיין לא נוצרו קישורים. הצעה חדשה נוצרת במסך ״הצעה חדשה והכנת חוזה״.';
}

async function loadQuotes() {
  $('state').textContent = 'טוען…';
  const BASE = 'id, token, number, client_name, monthly_gross_agorot, term_gross_agorot, created_at, created_by_email, status, first_viewed_at, signed_at, signer_name, tier:model->package->>tierName, influencer:model->package->>influencer, doc:model->>docTitle, signable:model->>signable, expires_at, phone:model->client->>phone';
  const APPROVAL_COLS = ', approval, approval_by, approval_note, approval_at, term:model->>termMonths, valid:model->>validHours, company:model->client->>company, email:model->client->>email';
  // Who prepared it ("הכנת חוזה עם AI", 20261106100000_contract_ai.sql) and what it changed.
  const AI_COLS = ', prepared_by, exceptions';
  const read = (cols) => supabase.from('quotes').select(cols).order('created_at', { ascending: false }).limit(500);
  const missing = (e) => e && (e.code === '42703' || e.code === 'PGRST204');
  let { data, error } = await read(BASE + APPROVAL_COLS + AI_COLS);
  // Before a migration its columns are not there yet: the list as it was.
  if (missing(error)) ({ data, error } = await read(BASE + APPROVAL_COLS));
  // Before the custom-contracts migration the approval columns are not there yet.
  if (missing(error)) ({ data, error } = await read(BASE));
  if (error) { $('state').textContent = explainError(error); return; }
  // With the old system's signed contracts since 1.10.2026, newest first among them all.
  const old = await loadLegacy().catch(() => []);
  quotes = [...data, ...old].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  $('state').textContent = '';
  $('list-block').hidden = false;
  renderStats();
  renderFilters();
  renderRows();
}

async function boot() {
  let staff = null;
  try { staff = await currentStaff(); } catch { /* offline */ }
  setSession(staff);
  if (staff?.isStaff) {
    $('login-block').hidden = true;
    // The app shell: the menu of this person's screens, with the managers' switch (app/shell.js).
    import('./shell.js').then((m) => m.mountShell(staff.email)).catch(() => {});
    // The list is the owners', Irit's and Ofir's; its amounts the owners' and Ofir's. The database decides
    // the same (public.quotes answers nobody else). Someone the app could not identify
    // gets the list the database gives them, without amounts.
    const viewer = await viewerFor(staff.email);
    showMoney = seesQuoteMoney(viewer);
    $('th-amt').hidden = !showMoney;
    const denied = !viewer.error && !canSeeQuoteList(viewer);
    $('no-access').hidden = !denied;
    if (denied) { $('list-block').hidden = true; $('stats').hidden = true; $('btn-refresh').hidden = true; return; }
    await loadQuotes();
  } else {
    $('login-block').hidden = false;
    $('list-block').hidden = true;
    $('stats').hidden = true;
    $('no-access').hidden = true;
    if (staff && !staff.isStaff) {
      $('lg-err').textContent = explainError(new Error('not staff'));
      $('lg-err').hidden = false;
    }
  }
}

$('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('lg-submit');
  btn.disabled = true;
  $('lg-err').hidden = true;
  $('lg-msg').hidden = true;
  loginDoor.signing(); // half open for as long as the server is asked; it opens when boot() puts the form away
  const { data, error } = await supabase.auth.signInWithPassword({
    email: cleanEmail($('lg-email').value), password: $('lg-pass').value,
  });
  btn.disabled = false;
  if (error) {
    $('lg-err').textContent = explainError(error);
    $('lg-err').hidden = false;
    loginDoor.failed();
    return;
  }
  resetMode(); // a fresh sign-in starts in the personal profile
  // Their home, whatever page the form was on; a page opened on purpose keeps them only
  // if it is theirs (docs/ops.md, section 54).
  const plan = await signInPlan(data?.user?.email || cleanEmail($('lg-email').value));
  if (plan?.go) { await loginDoor.leave(); location.replace(plan.go); return; }
  await boot();
  if (plan?.guard && refusedHere()) { location.replace(plan.guard); return; }
  if (!$('login-block').hidden) loginDoor.failed(); // signed in, but not one of the staff
});
$('lg-forgot').addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  const email = cleanEmail($('lg-email').value);
  $('lg-err').hidden = true;
  $('lg-msg').hidden = true;
  if (!looksLikeEmail(email)) {
    $('lg-err').textContent = RESET_NEEDS_EMAIL;
    $('lg-err').hidden = false;
    $('lg-email').focus();
    return;
  }
  btn.disabled = true;
  try {
    await sendPasswordReset(email);
    $('lg-msg').textContent = RESET_SENT;
    $('lg-msg').hidden = false;
  } catch (err) {
    $('lg-err').textContent = explainError(err);
    $('lg-err').hidden = false;
  } finally {
    btn.disabled = false;
  }
});
$('btn-logout').addEventListener('click', async () => { resetMode(); forgetPlace(); await signOutHere(); await boot(); });
$('btn-refresh').addEventListener('click', loadQuotes);

const pwDialog = $('dlg-password');
pwDialog.addEventListener('click', (e) => { if (e.target.closest('[data-close]') || e.target === pwDialog) pwDialog.close(); });
pwDialog.addEventListener('close', () => $('btn-password').focus());
function openPasswordDialog(recovery = false) {
  $('pw-form').reset();
  $('pw-err').hidden = true;
  $('pw-h').textContent = recovery ? 'בחירת סיסמה חדשה' : 'שינוי סיסמה';
  pwDialog.showModal();
  $('pw-new').focus();
}
$('btn-password').addEventListener('click', () => openPasswordDialog());
$('pw-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const pw = $('pw-new').value;
  const fail = (msg) => { $('pw-err').textContent = msg; $('pw-err').hidden = false; };
  if (pw.length < 10) return fail('הסיסמה צריכה להכיל לפחות 10 תווים.');
  if (pw !== $('pw-again').value) return fail('הסיסמאות אינן זהות.');
  $('pw-submit').disabled = true;
  const { error } = await supabase.auth.updateUser({ password: pw });
  $('pw-submit').disabled = false;
  if (error) return fail(/same/i.test(error.message) ? 'זו הסיסמה הנוכחית. בחרו סיסמה אחרת.' : explainError(error));
  pwDialog.close();
  toast('הסיסמה עודכנה.');
  // Chosen from a reset link: a sign-in like any other, so the person goes to their home
  // (the link opens this page for everyone; docs/ops.md, section 54).
  if (cameByLink) {
    cameByLink = false;
    resetMode();
    forgetPlace();
    const email = await sessionEmail();
    const plan = email ? await signInPlan(email, { entry: false }) : null;
    if (plan?.go) location.replace(plan.go);
  }
});

let cameByLink = false;
(async () => {
  const link = await consumeRecoveryLink();
  await boot();
  if (link === 'recovery') { cameByLink = true; openPasswordDialog(true); }
  if (link === 'kept') toast(LINK_KEPT);
  if (link === 'expired') {
    const msg = 'הקישור לאיפוס הסיסמה אינו תקף או שפג תוקפו. אפשר לבקש קישור חדש דרך ״שכחתי סיסמה״.';
    if ($('login-block').hidden) toast(msg);
    else { $('lg-err').textContent = msg; $('lg-err').hidden = false; }
  }
})();
