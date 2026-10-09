import {
  supabase, currentStaff, quoteLink, explainError,
  sendPasswordReset, consumeRecoveryLink, looksLikeEmail, cleanEmail, RESET_NEEDS_EMAIL, RESET_SENT, signOutHere, LINK_KEPT, sessionEmail,
} from './supa.js';
import { h, formatDate, whatsappLink } from './quote-doc.js';
import { dressHead, headIcon, besideIcon, leadIcon } from './kit.js';
import { formatILS } from './pricing.js';
import { glide, countUp, viewerFor } from './shell.js';
// Who opens this list (the owners and Irit) and who sees its amounts (the owners), 6.10.2026.
import { canSeeQuoteList, seesFinance, resetMode } from './manager-rules.js';
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
let showMoney = false;      // the amounts and their sum: the owners only (seesFinance)

const STATUS = {
  sent: 'ממתין לחתימה',
  viewed: 'נצפה',
  shared: 'נשלח לצפייה',
  seen: 'נצפה',
  signed: 'נחתם',
  expired: 'פג תוקף',
  cancelled: 'בוטל',
  // An exceptional contract before a manager approved it: the client has no link yet.
  awaiting: 'ממתין לאישור',
  rejected: 'לא אושר',
};
const OPEN = ['sent', 'viewed', 'shared', 'seen'];
const APPROVAL = ['awaiting', 'rejected'];
// View-only quotes have no signing step: they are either shared or seen.
const statusOf = (q) => {
  if (q.status === 'sent' && q.approval === 'pending') return 'awaiting';
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
  const signedMonthly = quotes.filter((q) => q.status === 'signed').reduce((s, q) => s + q.monthly_gross_agorot, 0);
  const stat = (k, v) => h('div', { class: 'stat' }, h('div', { class: 'k' }, k), h('div', { class: 'v ds-num', dir: 'ltr' }, v));
  $('stats').replaceChildren(
    stat('הצעות', String(quotes.length)),
    stat('ממתינות לחתימה', String(count('sent') + count('viewed'))),
    stat('הצעות לצפייה', String(count('shared') + count('seen'))),
    stat('נחתמו', String(count('signed'))),
    ...(showMoney ? [stat('חודשי בהצעות חתומות', formatILS(signedMonthly))] : []),
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
  if (n('approval') || filter === 'approval') opts.splice(1, 0, ['approval', 'באישור מנהל']);
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

// The approval of an exceptional contract: its state, who decided, the note.
const APPROVER = { owner: 'הבעלים', ofir: 'אופיר', lior: 'ליאור' };
function approvalCell(q) {
  if (!q.approval || q.approval === 'none') return h('span', { class: 'apv-cell', title: 'חוזה רגיל, בלי אישור' }, '—');
  const by = APPROVER[q.approval_by] || '';
  return h('span', { class: 'apv-cell' },
    h('span', { class: `apv-state is-${q.approval}` }, APPROVAL_TEXT[q.approval]),
    q.approval === 'rejected' && q.approval_note ? h('small', {}, `${by ? `${by}: ` : ''}${q.approval_note}`) : null,
    q.approval === 'approved' && by ? h('small', {}, `אישר/ה ${by}`) : null,
    q.approval === 'pending' ? h('small', {}, 'אדם, אופיר או ליאור') : null);
}
// An approved contract: the share dialog (the link, WhatsApp, mail), as after creating a regular one.
async function share(q, btn) {
  const { shareContract } = await import('./approvals-ui.js');
  shareContract({
    ...q,
    model: { docTitle: q.doc, signable: q.signable !== 'false', termMonths: Number(q.term) || 12, validHours: Number(q.valid) || null, client: { name: q.client_name, company: q.company, phone: q.phone, email: q.email } },
  }, btn, toast);
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
    const link = quoteLink(q.token);
    const when = s === 'signed' ? formatDate(q.signed_at, true) : (s === 'viewed' || s === 'seen') ? formatDate(q.first_viewed_at, true) : '';
    const open = OPEN.includes(s);
    // Waiting for a manager, or sent back: there is no link to open or send.
    const held = APPROVAL.includes(s);
    const agreement = q.signable !== 'false';
    const reminder = `שלום ${q.client_name}, רק מזכירים ש${agreement ? 'הסכם ההתקשרות' : 'הצעת המחיר'} מאסטרטג (${q.number}) ממתינ${agreement ? '' : 'ה'} לך כאן${q.expires_at ? `, ${agreement ? 'לחתימה' : 'בתוקף'} עד ${formatDate(q.expires_at, true)}` : ''}:\n${link}`;
    return h('tr', {},
      h('td', { 'data-label': 'מספר' }, h('span', { class: 'num', dir: 'ltr' }, q.number), h('small', { class: 'doc-type' }, q.doc || 'הצעת מחיר')),
      h('td', { class: 'client', 'data-label': 'לקוח' }, q.client_name, q.signer_name && s === 'signed' ? h('small', {}, `נחתם ע״י ${q.signer_name}`) : null),
      h('td', { class: 'client', 'data-label': 'חבילה' }, h('span', { dir: 'auto' }, q.tier || ''), h('small', {}, q.influencer || '')),
      showMoney ? h('td', { class: 'amt', dir: 'ltr', 'data-label': 'לחודש' }, formatILS(q.monthly_gross_agorot)) : null,
      h('td', { 'data-label': 'נוצר' }, formatDate(q.created_at), h('small', { class: 'by' }, q.created_by_email || '')),
      h('td', { 'data-label': 'סטטוס' }, h('span', { class: `pill ${s}` }, STATUS[s], when ? h('small', {}, ` · ${when}`) : null),
        open && q.expires_at ? h('small', { class: 'until' }, `${agreement ? 'לחתימה' : 'בתוקף'} עד ${formatDate(q.expires_at, true)}`) : null),
      h('td', { 'data-label': 'אישור מנהל' }, approvalCell(q)),
      h('td', { class: 'acts-cell' }, h('div', { class: 'acts' },
        open ? h('a', { class: 'btn btn-sm btn-ghost', href: whatsappLink(q.phone, reminder), target: '_blank', rel: 'noopener' }, 'תזכורת בוואטסאפ') : null,
        open && q.approval === 'approved' ? h('button', { type: 'button', class: 'btn btn-sm', 'data-act': 'share', onclick: (e) => share(q, e.currentTarget) }, 'שליחה ללקוח') : null,
        s === 'rejected' ? h('a', { class: 'btn btn-sm', 'data-act': 'revise', href: reviseUrl(q) }, 'תיקון ושליחה מחדש') : null,
        (open && q.approval === 'approved') || s === 'awaiting' ? h('a', { class: 'btn btn-sm btn-ghost', 'data-act': 'edit', href: reviseUrl(q) }, 'תיקון') : null,
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
  const BASE = 'id, token, number, client_name, monthly_gross_agorot, created_at, created_by_email, status, first_viewed_at, signed_at, signer_name, tier:model->package->>tierName, influencer:model->package->>influencer, doc:model->>docTitle, signable:model->>signable, expires_at, phone:model->client->>phone';
  const APPROVAL_COLS = ', approval, approval_by, approval_note, approval_at, term:model->>termMonths, valid:model->>validHours, company:model->client->>company, email:model->client->>email';
  const read = (cols) => supabase.from('quotes').select(cols).order('created_at', { ascending: false }).limit(500);
  let { data, error } = await read(BASE + APPROVAL_COLS);
  // Before the custom-contracts migration the approval columns are not there yet.
  if (error && (error.code === '42703' || error.code === 'PGRST204')) ({ data, error } = await read(BASE));
  if (error) { $('state').textContent = explainError(error); return; }
  quotes = data;
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
    // The list is the owners' and Irit's; its amounts are the owners'. The database decides
    // the same (public.quotes answers nobody else). Someone the app could not identify
    // gets the list the database gives them, without amounts.
    const viewer = await viewerFor(staff.email);
    showMoney = seesFinance(viewer);
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
$('btn-logout').addEventListener('click', async () => { resetMode(); await signOutHere(); await boot(); });
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
