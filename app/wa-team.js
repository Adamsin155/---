// WhatsApp on the team screen (team.html, stage 4): for the office, each person's
// choice (agreed or not), whether a number is set (never the number itself here:
// public.whatsapp_team_status returns yes or no), and this week's messages
// delivered and read; for the owner, the switch that turns WhatsApp on (only with
// the four Vault secrets in place: public.whatsapp_set_enabled checks, and the
// reminders function checks again before sending). Before the migration
// (20260930180000) nothing here shows.
//
// The provider (public.whatsapp_settings().provider; docs/ops.md, section 63): with
// Jako the secrets are its API key and the one its reply flows call with, the two
// flows of the reply buttons must be set too, and all that is known of a message is
// that it was sent, so the lines say "נשלחו" and nothing of delivered or read.
import { supabase } from './supa.js';
import { h, fill, toast, errorText } from './protocol-ui.js';

export const SECRET_NAMES = {
  access_token: 'whatsapp_access_token', phone_number_id: 'whatsapp_phone_number_id', app_secret: 'whatsapp_app_secret', verify_token: 'whatsapp_verify_token',
};

// { settings: { enabled, owner, secrets }, byEmail: Map } or null (not available).
export async function loadWaTeam() {
  const [s, t] = await Promise.all([supabase.rpc('whatsapp_settings'), supabase.rpc('whatsapp_team_status')]);
  if (s.error || t.error || !s.data || typeof s.data !== 'object') return null;
  return { settings: s.data, byEmail: new Map((t.data || []).map((r) => [r.email, r])) };
}

export const JAKO_SECRET_NAMES = { jako_api_key: 'whatsapp_jako_api_key', jako_hook_secret: 'whatsapp_jako_hook_secret' };
const isJako = (settings) => settings?.provider === 'jako';
// Jako's reply flows that are not set yet, by the button each belongs to.
const FLOW_BUTTONS = { done: 'המשימה בוצעה', onit: 'אני על זה' };
export const missingFlows = (settings) => (isJako(settings) ? Object.entries(FLOW_BUTTONS).filter(([k]) => !settings?.flows?.[k]).map(([, text]) => `״${text}״`) : []);

// The Vault secrets the chosen provider still lacks, by name.
export const missingSecrets = (settings) => Object.entries(isJako(settings) ? JAKO_SECRET_NAMES : SECRET_NAMES).filter(([k]) => !settings?.secrets?.[k]).map(([, name]) => name);

// One person's line in their row: the choice, a number yes or no, and this week.
export function waStatusView(wa, row) {
  if (!wa || !row) return null;
  const r = wa.byEmail.get(row.email) || {};
  const choice = !r.status ? 'עוד לא בחר/ה'
    : r.status === 'granted' ? (r.active ? 'הסכים/ה' : 'הסכים/ה למספר קודם, מחכה לאישור')
      : r.status === 'declined' ? 'בחר/ה באפליקציה בלבד' : 'הפסיק/ה';
  const parts = [choice, r.phone_set ? 'יש מספר' : 'אין מספר'];
  const failed = r.failed ? `, ${r.failed} נכשלו` : '';
  // Jako reports nothing after the send: "sent" is all there is to count.
  const week = isJako(wa.settings) ? `${r.sent || 0} נשלחו` : `${r.delivered || 0} נמסרו, ${r.read || 0} נקראו`;
  if (r.sent || r.failed) parts.push(`השבוע: ${week}${failed}`);
  return h('span', { class: 'tm-push tm-wa-status' }, h('bdi', {}, 'WhatsApp'), `: ${parts.join(' · ')}`);
}

async function toggle(wa, reload) {
  const on = !wa.settings.enabled;
  const ask = on
    ? 'להפעיל הודעות עבודה ב־WhatsApp? כל אחד בצוות יתבקש לבחור אם לקבל אותן, והפוש ממשיך כרגיל.'
    : 'לכבות את הודעות ה־WhatsApp לכל הצוות? ההתראות באפליקציה ממשיכות, וההסכמות נשמרות.';
  if (!confirm(ask)) return;
  const { error } = await supabase.rpc('whatsapp_set_enabled', { p_on: on });
  if (error) {
    const lacks = missingSecrets(wa.settings);
    toast(!/not_ready/.test(error.message || '') ? `לא נשמר. ${errorText(error)}`
      : lacks.length ? `חסרים סודות ב־Vault: ${lacks.join(', ')}.` : 'חסרה הגדרה של הזרימות ב־Jako. ההוראות במסמך התפעול, סעיף 63.');
    return;
  }
  toast(on ? 'הודעות ה־WhatsApp הופעלו. כל אחד יתבקש לבחור בכניסה הבאה.' : 'הודעות ה־WhatsApp כובו.');
  await reload();
  document.getElementById('wa-toggle')?.focus();
}

// The panel above the list (created before `before` on first use).
export function paintWaPanel(wa, before, reload) {
  let el = document.getElementById('wa-panel');
  if (!wa) { if (el) el.hidden = true; return; }
  if (!el) {
    el = h('section', { class: 'block tm-help tm-wa', id: 'wa-panel', 'aria-labelledby': 'wa-panel-h' });
    before.before(el);
  }
  el.hidden = false;
  const { settings } = wa;
  const missing = missingSecrets(settings);
  const flows = missingFlows(settings);
  const rows = [...wa.byEmail.values()];
  const agreed = rows.filter((r) => r.active).length;
  fill(el,
    h('h2', { id: 'wa-panel-h' }, 'הודעות עבודה ב־WhatsApp'),
    h('p', { id: 'wa-state' }, settings.enabled
      ? `פועל. הצלצולים והתקצירים מגיעים גם ב־WhatsApp למי שנתנו הסכמה (${agreed} מתוך ${rows.length}).`
      : 'כבוי. ההתראות יוצאות באפליקציה בלבד (Push).'),
    isJako(settings) ? h('p', { class: 'muted', id: 'wa-provider' }, 'ההודעות יוצאות דרך Jako.') : null,
    missing.length ? h('p', { class: 'muted', id: 'wa-missing' }, `חסר ב־Vault: ${missing.join(', ')}. ההוראות במסמך התפעול.`) : null,
    flows.length ? h('p', { class: 'muted', id: 'wa-flows' }, `חסרה ההגדרה של הזרימה ב־Jako לכפתור ${flows.join(' ולכפתור ')}. ההוראות במסמך התפעול, סעיף 63.`) : null,
    settings.owner ? h('div', { class: 'tm-wa-acts' }, h('button', {
      type: 'button', class: `btn btn-sm${settings.enabled ? '' : ' btn-primary'}`, id: 'wa-toggle', 'aria-pressed': String(!!settings.enabled),
      disabled: !settings.enabled && (missing.length > 0 || flows.length > 0), onclick: () => toggle(wa, reload),
    }, settings.enabled ? 'כיבוי הודעות WhatsApp' : 'הפעלת הודעות WhatsApp')) : null,
    h('p', { class: 'muted', id: 'wa-note' }, isJako(settings)
      ? 'דרך Jako ידוע רק שהודעה נשלחה, לא אם נמסרה או נקראה. המספרים לתכנון העבודה בלבד, לא להערכה ולא למשמעת.'
      : 'נמסר ונקרא מוצגים לתכנון העבודה בלבד, לא להערכה ולא למשמעת.'));
}
