// "חיבור Metricool" on the team screen (team.html), for the owner only, next to the
// WhatsApp switch (docs/ops.md, section 27): which of the two Vault secrets are in
// place (their names, never their values), "בדיקת חיבור" (the edge function asks
// Metricool and answers with the account's name and the number of brands), the switch
// (public.metricool_set_enabled refuses while a secret is missing) and how the last
// sync went. Before the migration (20261007100100) nothing here shows.
import { h, fill, toast, errorText as dbErrorText } from './protocol-ui.js';
import { accountLine, agoText, errorText } from './metricool-logic.js';
import { metricoolSettings, checkMetricool, setMetricoolEnabled } from './gantt-data.js';

export const MC_SECRET_NAMES = { user_token: 'metricool_user_token', user_id: 'metricool_user_id' };
export const missingMcSecrets = (s) => Object.entries(MC_SECRET_NAMES).filter(([k]) => !s?.secrets?.[k]).map(([, name]) => name);

// The settings, or null when the card is not for this person or not built yet.
export async function loadMetricoolCard() {
  const s = await metricoolSettings();
  return s && s.owner ? s : null;
}

let checked = null; // the last "בדיקת חיבור": { ok, account, brands } | { ok: false, error }

async function toggle(s, reload) {
  const on = !s.enabled;
  const ask = on
    ? 'להפעיל את הסנכרון מ־Metricool? כל רבע שעה, בין 06:00 לחצות, המערכת תקרא את התזמון של הלקוחות המחוברים ותסמן בגאנט ״תוזמן״, ״עלה״ ו״שגיאה״.'
    : 'לכבות את הסנכרון מ־Metricool? הגאנט נשאר כמו שהוא, ומסמנים ביד.';
  if (!window.confirm(ask)) return;
  try {
    await setMetricoolEnabled(on);
  } catch (err) {
    toast(/not_ready/.test(err?.message || '') ? `חסרים סודות ב־Vault: ${missingMcSecrets(s).join(', ')}.` : `לא נשמר. ${dbErrorText(err)}`);
    return;
  }
  toast(on ? 'הסנכרון מ־Metricool הופעל. הריצה הראשונה ברבע השעה הקרובה.' : 'הסנכרון מ־Metricool כובה.');
  await reload();
  document.getElementById('mc-toggle')?.focus();
}
async function check(reload) {
  const btn = document.getElementById('mc-check');
  if (btn) { btn.disabled = true; btn.textContent = 'בודק…'; }
  try { checked = await checkMetricool(); } catch (err) { checked = { ok: false, error: err?.code || 'server_error' }; }
  await reload();
  document.getElementById('mc-check')?.focus();
}

// The card, above the list (created before `before` on first use).
export function paintMetricoolCard(s, before, reload) {
  let el = document.getElementById('mc-panel');
  if (!s) { if (el) el.hidden = true; return; }
  if (!el) {
    el = h('section', { class: 'block tm-help tm-wa tm-mc', id: 'mc-panel', 'aria-labelledby': 'mc-panel-h' });
    before.before(el);
  }
  el.hidden = false;
  const missing = missingMcSecrets(s);
  const line = accountLine(s);
  const summary = s.mapped
    ? `${s.mapped} לקוחות מחוברים למותג${s.lastAt ? ` · ${s.synced} סונכרנו${s.failed ? ` · ${s.failed} נכשלו` : ''} · הסנכרון האחרון ${agoText(s.lastAt)}` : ' · עוד לא רץ סנכרון'}`
    : 'עוד אין לקוח שמחובר למותג. מחברים בעמוד ״גאנט תוכן״, בגאנט של כל לקוח.';
  fill(el,
    h('h2', { id: 'mc-panel-h' }, 'חיבור Metricool'),
    h('p', { id: 'mc-state' }, line?.text || ''),
    h('ul', { class: 'tm-mc-secrets', id: 'mc-secrets', 'aria-label': 'הסודות ב־Vault' }, ...Object.entries(MC_SECRET_NAMES).map(([k, name]) => h('li', { class: s.secrets?.[k] ? 'is-ok' : 'is-missing' },
      h('code', { dir: 'ltr' }, name), s.secrets?.[k] ? ' · קיים ב־Vault' : ' · חסר ב־Vault'))),
    missing.length ? h('p', { class: 'muted', id: 'mc-missing' }, 'את הסודות יוצרים ב־SQL Editor של Supabase. ההוראות במסמך התפעול, סעיף 27.') : null,
    h('p', { class: 'muted', id: 'mc-summary' }, summary),
    checked ? h('p', { id: 'mc-result', class: checked.ok ? 'tm-mc-ok' : 'err', role: 'status' },
      checked.ok ? `החיבור תקין: ${checked.account ? `החשבון ${checked.account}, ` : ''}${checked.brands === 1 ? 'מותג אחד' : `${checked.brands} מותגים`}.` : `החיבור לא עובד. ${errorText(checked.error)}`) : null,
    h('div', { class: 'tm-wa-acts tm-mc-acts' },
      h('button', { type: 'button', class: 'btn btn-sm', id: 'mc-check', disabled: missing.length > 0, onclick: () => check(reload) }, 'בדיקת חיבור'),
      h('button', {
        type: 'button', class: 'btn btn-sm', id: 'mc-toggle', 'aria-pressed': String(!!s.enabled),
        disabled: !s.enabled && missing.length > 0, onclick: () => toggle(s, reload),
      }, s.enabled ? 'כיבוי הסנכרון' : 'הפעלת הסנכרון'),
      h('a', { class: 'btn btn-sm btn-ghost', href: 'gantt.html', id: 'mc-gantt' }, 'לגאנט תוכן')),
    h('p', { class: 'muted' }, 'הטוקן נשמר רק ב־Vault ונקרא רק בשרת. הוא לא מוצג כאן ולא מגיע לדפדפן.'));
}
