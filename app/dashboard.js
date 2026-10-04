import {
  supabase, currentStaff, quoteLink, explainError,
  sendPasswordReset, consumeRecoveryLink, looksLikeEmail, cleanEmail, RESET_NEEDS_EMAIL, RESET_SENT,
} from './supa.js';
import { h, formatDate, whatsappLink } from './quote-doc.js';
import { formatILS } from './pricing.js';

const $ = (id) => document.getElementById(id);
let quotes = [];
let filter = 'all';

const STATUS = {
  sent: 'ממתין לחתימה',
  viewed: 'נצפה',
  shared: 'נשלח לצפייה',
  seen: 'נצפה',
  signed: 'נחתם',
  expired: 'פג תוקף',
  cancelled: 'בוטל',
};
const OPEN = ['sent', 'viewed', 'shared', 'seen'];
// View-only quotes have no signing step: they are either shared or seen.
const statusOf = (q) => {
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

function renderStats() {
  const count = (s) => quotes.filter((q) => statusOf(q) === s).length;
  const signedMonthly = quotes.filter((q) => q.status === 'signed').reduce((s, q) => s + q.monthly_gross_agorot, 0);
  const stat = (k, v) => h('div', { class: 'stat' }, h('div', { class: 'k' }, k), h('div', { class: 'v', dir: 'ltr' }, v));
  $('stats').replaceChildren(
    stat('הצעות', String(quotes.length)),
    stat('ממתינות לחתימה', String(count('sent') + count('viewed'))),
    stat('הצעות לצפייה', String(count('shared') + count('seen'))),
    stat('נחתמו', String(count('signed'))),
    stat('חודשי בהצעות חתומות', formatILS(signedMonthly)),
  );
  $('stats').hidden = false;
}

function renderFilters() {
  const opts = [['all', 'הכול'], ['open', 'ממתינות'], ['signed', 'נחתמו'], ['expired', 'פג תוקף'], ['cancelled', 'בוטלו']];
  const n = (k) => quotes.filter((q) => k === 'all' || (k === 'open' ? OPEN.includes(statusOf(q)) : statusOf(q) === k)).length;
  $('filters').replaceChildren(...opts.map(([k, label]) => h('button', {
    type: 'button', class: 'chip', 'aria-pressed': String(filter === k),
    onclick: () => { filter = k; renderFilters(); renderRows(); },
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

function renderRows() {
  const list = quotes.filter((q) => {
    const s = statusOf(q);
    if (filter === 'all') return true;
    if (filter === 'open') return OPEN.includes(s);
    return s === filter;
  });
  $('rows').replaceChildren(...list.map((q) => {
    const s = statusOf(q);
    const link = quoteLink(q.token);
    const when = s === 'signed' ? formatDate(q.signed_at, true) : (s === 'viewed' || s === 'seen') ? formatDate(q.first_viewed_at, true) : '';
    const open = OPEN.includes(s);
    const agreement = q.signable !== 'false';
    const reminder = `שלום ${q.client_name}, רק מזכירים ש${agreement ? 'הסכם ההתקשרות' : 'הצעת המחיר'} מאסטרטג (${q.number}) ממתינ${agreement ? '' : 'ה'} לך כאן${q.expires_at ? `, ${agreement ? 'לחתימה' : 'בתוקף'} עד ${formatDate(q.expires_at, true)}` : ''}:\n${link}`;
    return h('tr', {},
      h('td', { 'data-label': 'מספר' }, h('span', { class: 'num', dir: 'ltr' }, q.number), h('small', { class: 'doc-type' }, q.doc || 'הצעת מחיר')),
      h('td', { class: 'client', 'data-label': 'לקוח' }, q.client_name, q.signer_name && s === 'signed' ? h('small', {}, `נחתם ע״י ${q.signer_name}`) : null),
      h('td', { class: 'client', 'data-label': 'חבילה' }, h('span', { dir: 'auto' }, q.tier || ''), h('small', {}, q.influencer || '')),
      h('td', { class: 'amt', dir: 'ltr', 'data-label': 'לחודש' }, formatILS(q.monthly_gross_agorot)),
      h('td', { 'data-label': 'נוצר' }, formatDate(q.created_at), h('small', { class: 'by' }, q.created_by_email || '')),
      h('td', { 'data-label': 'סטטוס' }, h('span', { class: `pill ${s}` }, STATUS[s], when ? h('small', {}, ` · ${when}`) : null),
        open && q.expires_at ? h('small', { class: 'until' }, `${agreement ? 'לחתימה' : 'בתוקף'} עד ${formatDate(q.expires_at, true)}`) : null),
      h('td', { class: 'acts-cell' }, h('div', { class: 'acts' },
        open ? h('a', { class: 'btn btn-sm btn-ghost', href: whatsappLink(q.phone, reminder), target: '_blank', rel: 'noopener' }, 'תזכורת בוואטסאפ') : null,
        s !== 'cancelled' ? h('a', { class: 'btn btn-sm btn-ghost', href: link, target: '_blank', rel: 'noopener' }, 'פתיחה') : null,
        s !== 'cancelled' ? h('button', { type: 'button', class: 'btn btn-sm btn-ghost', onclick: () => copy(link) }, 'העתקת קישור') : null,
        open
          ? h('button', { type: 'button', class: 'btn btn-sm btn-ghost', onclick: (e) => cancel(q, e.currentTarget) }, 'ביטול')
          : null,
      )),
    );
  }));
  $('empty').hidden = list.length > 0;
  $('empty').textContent = quotes.length ? 'אין הצעות בסינון הזה.' : 'עדיין לא נוצרו קישורים. הצעה חדשה נוצרת במסך ״הצעה חדשה״.';
}

async function loadQuotes() {
  $('state').textContent = 'טוען…';
  const { data, error } = await supabase
    .from('quotes')
    .select('id, token, number, client_name, monthly_gross_agorot, created_at, created_by_email, status, first_viewed_at, signed_at, signer_name, tier:model->package->>tierName, influencer:model->package->>influencer, doc:model->>docTitle, signable:model->>signable, expires_at, phone:model->client->>phone')
    .order('created_at', { ascending: false })
    .limit(500);
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
    // The managers' switch, "המשימות שלי" / "מבט מנהל" (app/manager-ui.js).
    import('./manager-ui.js').then((m) => m.mountModeSwitch(staff.email)).catch(() => {});
    await loadQuotes();
  } else {
    $('login-block').hidden = false;
    $('list-block').hidden = true;
    $('stats').hidden = true;
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
  const { error } = await supabase.auth.signInWithPassword({
    email: cleanEmail($('lg-email').value), password: $('lg-pass').value,
  });
  btn.disabled = false;
  if (error) {
    $('lg-err').textContent = explainError(error);
    $('lg-err').hidden = false;
    return;
  }
  await boot();
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
$('btn-logout').addEventListener('click', async () => { await supabase.auth.signOut(); await boot(); });
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
});

(async () => {
  const link = await consumeRecoveryLink();
  await boot();
  if (link === 'recovery') openPasswordDialog(true);
  if (link === 'expired') {
    const msg = 'הקישור לאיפוס הסיסמה אינו תקף או שפג תוקפו. אפשר לבקש קישור חדש דרך ״שכחתי סיסמה״.';
    if ($('login-block').hidden) toast(msg);
    else { $('lg-err').textContent = msg; $('lg-err').hidden = false; }
  }
})();
