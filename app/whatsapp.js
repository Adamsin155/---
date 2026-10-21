// Work messages on WhatsApp AND the app's notifications, for each staff member: both
// are a required work channel (the owner, 21.10.2026; until then WhatsApp was a free
// choice, stage 4).
//  - the screen (promptWhatsapp, from mountSession in protocol-ui.js on every staff
//    page): the exact words come from the database (public.whatsapp_my_consent, by
//    version), one line per channel, each done ✓ or a button: "חיבור WhatsApp" and
//    "הפעלת התראות" on this device (app/push.js), and a link to the employee privacy
//    notice (staff-privacy.html). Shown only while the owner's WhatsApp switch is on,
//    on every page load until both are on (closing it is "later", not a choice);
//  - the card in "המשימות שלי" (mountWhatsappCard): the same two lines, a button for
//    whichever is missing, and no "stop".
// Connecting is recorded server-side with the time, the wording and the number
// (public.whatsapp_decide). "הסר" on WhatsApp still stops the messages (Meta's
// policy): the owners are told (rule `waRemoved`), and the screen comes back. Nothing
// here shows anyone else's number: the database returns the caller's own only.
import { supabase } from './supa.js';
import { h, fill, toast, errorText } from './protocol-ui.js';
import { formatPhone, normPhone } from './team-rules.js';

const PRIVACY_URL = new URL('../staff-privacy.html', import.meta.url).href;
let state = null;                 // the last whatsapp_my_consent()
let push = null;                  // this device's notifications (app/push.js pushHere), null before it answered
let pushHint = '';                // a line after a failed "הפעלת התראות"
let pushMod = null;
let cardEl = null;
let cardAnchor = null;
let dialogEl = null;
let busy = false;
let draftPhone = null;           // what the owner typed, kept across repaints

function styles() {
  if (document.querySelector('link[data-wa-css]')) return;
  document.head.append(h('link', { rel: 'stylesheet', href: new URL('./styles/whatsapp.css', import.meta.url).href, 'data-wa-css': '' }));
}

async function load() {
  const { data, error } = await supabase.rpc('whatsapp_my_consent');
  state = !error && data && typeof data === 'object' && data.text ? data : null;
  return state;
}

// This device's notifications, and every change after (the push card connects too).
async function loadPush() {
  try {
    pushMod ||= await import('./push.js');
    push = await pushMod.pushHere((s) => { push = s; repaint(); });
  } catch { push = null; }
  return push;
}

const pushDone = () => push === 'on' || push === 'confirm';
// Missing AND something can be done about it on this device (an old iPhone or a browser
// without notifications is said on the screen, but does not bring it back by itself).
const pushMissing = () => !!push && !pushDone() && ['ready', 'blocked', 'ios-install'].includes(push);
const waMissing = () => !!state?.enabled && !state.active && (state.owner || !!state.phone);

// A paragraph of the consent text, its lead-in ("מה יישלח:", "מתי:") in bold.
function paragraph(text) {
  const m = /^([^:.]{2,14}[:.])\s(.+)$/s.exec(text);
  return m ? h('p', {}, h('strong', {}, m[1]), ' ', m[2]) : h('p', {}, text);
}

const ERRORS = [
  [/no_phone/, 'צריך מספר נייד ישראלי, למשל 050-1234567.'],
  [/stale_text/, 'הנוסח עודכן בינתיים. הנה הנוסח החדש.'],
  [/bad_choice|required/, 'לא נקלט. נסו שוב.'],
];
const explain = (err) => ERRORS.find(([re]) => re.test(err?.message || ''))?.[1] || errorText(err);

// ── The two channels, as lines (the screen and the card) ──
const done = (id, text) => h('li', { class: 'wa-req is-done', id }, h('span', { class: 'wa-mark', 'aria-hidden': 'true' }, '✓'), h('span', {}, text));
const todo = (id, text, ...rest) => h('li', { class: 'wa-req', id }, h('span', { class: 'wa-mark', 'aria-hidden': 'true' }, '!'), h('div', { class: 'wa-req-t' }, h('span', {}, text), ...rest));
const button = (id, label, onclick) => h('button', { type: 'button', class: 'btn btn-primary wa-act', id, disabled: busy, onclick }, label);

function waLine(where) {
  const s = state;
  if (s.active) return done(`${where}-wa`, h('span', {}, 'WhatsApp מחובר, למספר ', h('bdi', { dir: 'ltr' }, formatPhone(s.phone)), '.'));
  if (!s.owner && !s.phone) return todo(`${where}-wa`, 'WhatsApp: אין מספר נייד שמור במערכת. עירית או ליאור מוסיפים אותו בעמוד הצוות.');
  const changed = s.status === 'granted';
  const label = changed ? 'אישור המספר החדש' : 'חיבור WhatsApp';
  const text = changed ? 'WhatsApp: המספר שלך השתנה. צריך לאשר את החדש.'
    : s.status === 'withdrawn' && s.via === 'whatsapp' ? 'WhatsApp: נותק בתשובה ״הסר״. צריך לחבר שוב.' : 'WhatsApp: עוד לא מחובר.';
  if (where === 'wa-card') return todo(`${where}-wa`, text, button('wa-card-on', label, () => openDialog()));
  return todo(`${where}-wa`, text, button('wa-whatsapp', label, connect));
}

function pushLine(where) {
  const id = `${where}-push`;
  if (pushDone()) return done(id, 'ההתראות באפליקציה פעילות בטלפון הזה.');
  const hint = pushHint ? h('p', { class: 'wa-hint', role: 'status' }, pushHint) : null;
  switch (push) {
    case 'ready': return todo(id, 'התראות באפליקציה: עוד לא פעילות בטלפון הזה.', button(where === 'wa-card' ? 'wa-card-push' : 'wa-push-on', busy ? 'מפעילים…' : 'הפעלת התראות', enablePush), hint);
    case 'blocked': return todo(id, 'התראות באפליקציה: חסומות בטלפון הזה.', h('p', { class: 'wa-hint' }, pushMod?.UNBLOCK || ''));
    case 'ios-install': return todo(id, 'התראות באייפון: פותחים את המערכת מהמסך הראשי.', h('p', { class: 'wa-hint' }, 'ב־Safari: כפתור השיתוף ← ״הוספה למסך הבית״. אחר כך נכנסים מהאייקון ולוחצים ״הפעלת התראות״.'));
    case 'ios-update': return todo(id, 'התראות באייפון: צריך iOS 16.4 ומעלה. עדכנו את האייפון וחזרו לכאן.');
    case 'unsupported': return todo(id, 'התראות: הדפדפן הזה לא מקבל אותן. בטלפון: Chrome באנדרואיד, או Safari ומסך הבית באייפון.');
    default: return null;
  }
}

// ── The screen ─────────────────────────────
function dialog() {
  if (dialogEl) return dialogEl;
  dialogEl = h('dialog', { class: 'wa-dlg', id: 'dlg-wa', 'aria-labelledby': 'wa-h', 'aria-describedby': 'wa-text' });
  document.body.append(dialogEl);
  return dialogEl;
}

function paintDialog(note = '') {
  const s = state;
  const t = s.text;
  const ownerPhone = s.owner && !s.active ? h('div', { class: 'field wa-phone' },
    h('label', { for: 'wa-phone' }, 'המספר שלך'),
    h('input', { class: 'input', id: 'wa-phone', type: 'tel', dir: 'ltr', inputmode: 'tel', autocomplete: 'tel', placeholder: '050-1234567', value: draftPhone ?? formatPhone(s.phone), 'aria-describedby': 'wa-phone-h', 'aria-invalid': note && draftPhone !== null && !normPhone(draftPhone) ? 'true' : null }),
    h('span', { class: 'hint', id: 'wa-phone-h' }, 'נייד ישראלי. נשמר רק אצלך ובמערכת, לא ברשימת הצוות.')) : null;
  fill(dialogEl,
    h('div', { class: 'dlg-head' }, h('h2', { id: 'wa-h', tabindex: '-1' }, t.title),
      // Closing is "later": the screen comes back on the next page until both are on.
      h('button', { type: 'button', class: 'close', id: 'wa-later', 'aria-label': 'סגירה: אחר כך', onclick: () => dialogEl.close() }, '×')),
    h('div', { class: 'dlg-body' },
      h('div', { class: 'wa-text', id: 'wa-text' }, ...String(t.body).split(/\n{2,}/).map(paragraph)),
      h('ul', { class: 'wa-reqs', 'aria-label': 'מה צריך לחבר' }, waLine('wa-dlg'), pushLine('wa-dlg')),
      ownerPhone,
      !s.owner && s.phone && !s.active ? h('p', { class: 'hint wa-fix' }, 'המספר לא נכון? עירית או ליאור מתקנים אותו בעמוד הצוות.') : null,
      h('p', { class: 'wa-privacy' }, h('a', { href: PRIVACY_URL, target: '_blank', rel: 'noopener' }, 'הודעת הפרטיות לעובדים')),
      note ? h('p', { class: 'wa-note', role: 'alert' }, note) : null));
}

async function openDialog(note = '') {
  styles();
  dialog();
  paintDialog(note);
  if (!dialogEl.open) dialogEl.showModal();
  dialogEl.querySelector('#wa-h')?.focus();
}

// Both on: the screen closes by itself.
function allSet() {
  if (!dialogEl?.open || waMissing() || pushMissing()) return false;
  dialogEl.close();
  toast('הכול מחובר: הודעות העבודה יגיעו ב־WhatsApp ובאפליקציה.');
  return true;
}

function repaint() {
  if (dialogEl?.open && state && !allSet()) paintDialog();
  paintCard();
}

async function connect() {
  if (busy || !state) return;
  let phone = null;
  if (state.owner) {
    draftPhone = dialogEl.querySelector('#wa-phone')?.value.trim() || '';
    phone = draftPhone ? normPhone(draftPhone) : null;
    if (!phone) {
      // Said inside the screen (a toast would sit behind it).
      paintDialog('צריך מספר נייד ישראלי, למשל 050-1234567.');
      dialogEl.querySelector('#wa-phone')?.focus();
      return;
    }
  }
  busy = true;
  paintDialog();
  const { data, error } = await supabase.rpc('whatsapp_decide', {
    p_choice: 'whatsapp', p_version: state.text.version, p_phone: phone, p_user_agent: navigator.userAgent.slice(0, 300),
  });
  busy = false;
  if (error) {
    if (/stale_text/.test(error.message || '')) await load();
    paintDialog(explain(error));
    document.getElementById('wa-whatsapp')?.focus();
    return;
  }
  state = data?.text ? data : state;
  draftPhone = null;
  paintCard();
  if (allSet()) return;
  toast('WhatsApp מחובר. נשארו ההתראות באפליקציה.');
  paintDialog();
  (dialogEl.querySelector('#wa-push-on') || dialogEl.querySelector('#wa-h'))?.focus();
}

async function enablePush() {
  if (busy || !pushMod) return;
  busy = true; pushHint = '';
  repaint();
  const out = await pushMod.enablePushHere().catch((err) => ({ state: push, hint: errorText(err) }));
  busy = false;
  push = out.state;
  pushHint = pushDone() ? '' : out.hint || '';
  if (dialogEl?.open && allSet()) { paintCard(); return; }
  repaint();
  if (pushDone()) toast('ההתראות באפליקציה פעילות.');
}

// On every staff page: while WhatsApp is on and either channel is still missing.
export async function promptWhatsapp() {
  if (document.querySelector('dialog[open]')) return;
  if (!(await load())?.enabled) return;
  await loadPush();
  if (!waMissing() && !pushMissing()) return;
  if (document.querySelector('dialog[open]')) return; // another screen opened meanwhile
  await openDialog();
}

// ── "המשימות שלי" ──────────────────────────────
function paintCard() {
  if (!cardEl) return;
  const s = state;
  if (!s?.enabled) { cardEl.hidden = true; return; }
  styles();
  if (!cardEl.isConnected) cardAnchor?.after(cardEl); // a page without its own place for it
  cardEl.hidden = false;
  cardEl.dataset.state = s.active ? 'on' : !s.owner && !s.phone ? 'none' : 'off';
  cardEl.dataset.push = push || '';
  cardEl.classList.toggle('is-done', !waMissing() && !pushMissing() && s.active);
  fill(cardEl,
    h('h2', { class: 'push-h', id: 'wa-card-h', tabindex: '-1' }, 'חובה: גם WhatsApp וגם התראות באפליקציה'),
    h('ul', { class: 'wa-reqs' }, waLine('wa-card'), pushLine('wa-card')));
}

// The card: the page's own #wa-card (clients.html keeps its place in "המשימות שלי"),
// else right after `anchor` (the notifications card). Shown only while WhatsApp is on.
export async function mountWhatsappCard(anchor) {
  if (!anchor) return;
  cardAnchor = anchor;
  cardEl = document.getElementById('wa-card') || h('section', { class: 'push-card wa-card', id: 'wa-card', 'aria-labelledby': 'wa-card-h', hidden: true });
  if (!state) await load().catch(() => null);
  if (state?.enabled && !push) await loadPush();
  paintCard();
}
