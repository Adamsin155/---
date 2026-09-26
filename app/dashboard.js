import { supabase, currentStaff, quoteLink, explainError } from './supa.js';
import { h, formatDate } from './quote-doc.js';
import { formatILS } from './pricing.js';

const $ = (id) => document.getElementById(id);
let quotes = [];
let filter = 'all';

const STATUS = {
  sent: 'ממתין לחתימה',
  viewed: 'נצפה',
  signed: 'נחתם',
  cancelled: 'בוטל',
};
const statusOf = (q) => (q.status === 'sent' && q.first_viewed_at ? 'viewed' : q.status);

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
    stat('נחתמו', String(count('signed'))),
    stat('חודשי בהצעות חתומות', formatILS(signedMonthly)),
  );
  $('stats').hidden = false;
}

function renderFilters() {
  const opts = [['all', 'הכול'], ['open', 'ממתינות'], ['signed', 'נחתמו'], ['cancelled', 'בוטלו']];
  const n = (k) => quotes.filter((q) => k === 'all' || (k === 'open' ? ['sent', 'viewed'].includes(statusOf(q)) : statusOf(q) === k)).length;
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
    if (filter === 'open') return s === 'sent' || s === 'viewed';
    return s === filter;
  });
  $('rows').replaceChildren(...list.map((q) => {
    const s = statusOf(q);
    const link = quoteLink(q.token);
    const when = s === 'signed' ? formatDate(q.signed_at, true) : s === 'viewed' ? formatDate(q.first_viewed_at, true) : '';
    return h('tr', {},
      h('td', { class: 'num', dir: 'ltr' }, q.number),
      h('td', { class: 'client' }, q.client_name, q.signer_name && s === 'signed' ? h('small', {}, `נחתם ע״י ${q.signer_name}`) : null),
      h('td', { class: 'client' }, h('span', { dir: 'auto' }, q.tier || ''), h('small', {}, q.influencer || '')),
      h('td', { class: 'amt', dir: 'ltr' }, formatILS(q.monthly_gross_agorot)),
      h('td', {}, formatDate(q.created_at), h('small', { style: 'display:block;color:var(--muted);font-size:12px' }, q.created_by_email || '')),
      h('td', {}, h('span', { class: `pill ${s}` }, STATUS[s], when ? h('small', {}, ` · ${when}`) : null)),
      h('td', {}, h('div', { class: 'acts' },
        s !== 'cancelled' ? h('a', { class: 'btn btn-sm btn-ghost', href: link, target: '_blank', rel: 'noopener' }, 'פתיחה') : null,
        s !== 'cancelled' ? h('button', { type: 'button', class: 'btn btn-sm btn-ghost', onclick: () => copy(link) }, 'העתקת קישור') : null,
        s === 'sent' || s === 'viewed'
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
    .select('id, token, number, client_name, monthly_gross_agorot, created_at, created_by_email, status, first_viewed_at, signed_at, signer_name, tier:model->package->>tierName, influencer:model->package->>influencer')
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
  const { error } = await supabase.auth.signInWithPassword({
    email: $('lg-email').value.trim(), password: $('lg-pass').value,
  });
  btn.disabled = false;
  if (error) {
    $('lg-err').textContent = explainError(error);
    $('lg-err').hidden = false;
    return;
  }
  await boot();
});
$('btn-logout').addEventListener('click', async () => { await supabase.auth.signOut(); await boot(); });
$('btn-refresh').addEventListener('click', loadQuotes);

const pwDialog = $('dlg-password');
pwDialog.addEventListener('click', (e) => { if (e.target.closest('[data-close]') || e.target === pwDialog) pwDialog.close(); });
pwDialog.addEventListener('close', () => $('btn-password').focus());
$('btn-password').addEventListener('click', () => {
  $('pw-form').reset();
  $('pw-err').hidden = true;
  pwDialog.showModal();
  $('pw-new').focus();
});
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

boot();
