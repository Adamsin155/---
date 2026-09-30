// Work messages on WhatsApp (stage 4), for each staff member:
//  - the one-time consent screen (promptWhatsapp, from mountSession in
//    protocol-ui.js on every staff page): the exact words come from the database
//    (public.whatsapp_my_consent, by version), two equal buttons, push as the
//    alternative, and a link to the employee privacy notice (staff-privacy.html).
//    Shown only when the owner turned WhatsApp on, until the person chose (or again
//    when the number they agreed to was changed);
//  - the card in "מה עליי" (mountWhatsappCard): on or off, stop at any time, or
//    agree later.
// The choice is recorded server-side with the time, the wording and the number
// (public.whatsapp_decide / whatsapp_withdraw). Nothing here shows anyone else's
// number: the database returns the caller's own only. Until the migration
// (20260930180000) or while WhatsApp is off, nothing here shows.
import { supabase } from './supa.js';
import { h, fill, toast, errorText } from './protocol-ui.js';
import { formatPhone, normPhone } from './team-rules.js';

const PRIVACY_URL = new URL('../staff-privacy.html', import.meta.url).href;
const LATER = 'wa-consent-later'; // the screen was closed without a choice: not again in this tab
let state = null;                 // the last whatsapp_my_consent()
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

const later = () => { try { return sessionStorage.getItem(LATER) === '1'; } catch { return false; } };
const setLater = () => { try { sessionStorage.setItem(LATER, '1'); } catch { /* private mode */ } };

// A paragraph of the consent text, its lead-in ("מה יישלח:", "זו בחירה שלך.") in bold.
function paragraph(text) {
  const m = /^([^:.]{2,14}[:.])\s(.+)$/s.exec(text);
  return m ? h('p', {}, h('strong', {}, m[1]), ' ', m[2]) : h('p', {}, text);
}

const ERRORS = [
  [/no_phone/, 'צריך מספר נייד ישראלי, למשל 050-1234567.'],
  [/stale_text/, 'הנוסח עודכן בינתיים. הנה הנוסח החדש.'],
  [/bad_choice/, 'הבחירה לא נקלטה. נסו שוב.'],
];
const explain = (err) => ERRORS.find(([re]) => re.test(err?.message || ''))?.[1] || errorText(err);

// ── The consent screen ─────────────────────
function dialog() {
  if (dialogEl) return dialogEl;
  dialogEl = h('dialog', { class: 'wa-dlg', id: 'dlg-wa', 'aria-labelledby': 'wa-h', 'aria-describedby': 'wa-text' });
  dialogEl.addEventListener('cancel', () => setLater());
  document.body.append(dialogEl);
  return dialogEl;
}

function paintDialog(note = '') {
  const s = state;
  const t = s.text;
  const ownerPhone = s.owner ? h('div', { class: 'field wa-phone' },
    h('label', { for: 'wa-phone' }, 'המספר שלך'),
    h('input', { class: 'input', id: 'wa-phone', type: 'tel', dir: 'ltr', inputmode: 'tel', autocomplete: 'tel', placeholder: '050-1234567', value: draftPhone ?? formatPhone(s.phone), 'aria-describedby': 'wa-phone-h', 'aria-invalid': note && draftPhone !== null && !normPhone(draftPhone) ? 'true' : null }),
    h('span', { class: 'hint', id: 'wa-phone-h' }, 'נייד ישראלי. נשמר רק אצלך ובמערכת, לא ברשימת הצוות.')) : null;
  const choice = (label, value) => h('button', { type: 'button', class: 'btn wa-choice', id: `wa-${value}`, disabled: busy, onclick: () => decide(value) }, label);
  fill(dialogEl,
    h('div', { class: 'dlg-head' }, h('h2', { id: 'wa-h', tabindex: '-1' }, t.title),
      // Closing is "later" (asked again in the next tab), not a choice.
      h('button', { type: 'button', class: 'close', id: 'wa-later', 'aria-label': 'סגירה: להחליט אחר כך', onclick: () => { setLater(); dialogEl.close(); } }, '×')),
    h('div', { class: 'dlg-body' },
      h('div', { class: 'wa-text', id: 'wa-text' }, ...String(t.body).split(/\n{2,}/).map(paragraph)),
      s.owner ? ownerPhone : h('p', { class: 'hint wa-fix' }, 'המספר לא נכון? עירית או ליאור מתקנים אותו בעמוד הצוות.'),
      h('p', { class: 'wa-privacy' }, h('a', { href: PRIVACY_URL, target: '_blank', rel: 'noopener' }, 'הודעת הפרטיות לעובדים')),
      note ? h('p', { class: 'wa-note', role: 'alert' }, note) : null),
    h('div', { class: 'dlg-foot wa-choices' }, choice(t.yes, 'whatsapp'), choice(t.no, 'push')));
}

async function openDialog(note = '') {
  styles();
  dialog();
  paintDialog(note);
  if (!dialogEl.open) dialogEl.showModal();
  dialogEl.querySelector('#wa-h')?.focus();
}

async function decide(choice) {
  if (busy || !state) return;
  let phone = null;
  if (state.owner) {
    draftPhone = dialogEl.querySelector('#wa-phone')?.value.trim() || '';
    phone = draftPhone ? normPhone(draftPhone) : null;
    if (choice === 'whatsapp' && !phone) {
      // Said inside the screen (a toast would sit behind it).
      paintDialog('צריך מספר נייד ישראלי, למשל 050-1234567.');
      dialogEl.querySelector('#wa-phone')?.focus();
      return;
    }
  }
  busy = true;
  paintDialog();
  const { data, error } = await supabase.rpc('whatsapp_decide', {
    p_choice: choice, p_version: state.text.version, p_phone: phone, p_user_agent: navigator.userAgent.slice(0, 300),
  });
  busy = false;
  if (error) {
    if (/stale_text/.test(error.message || '')) await load();
    paintDialog(explain(error));
    document.getElementById(`wa-${choice}`)?.focus();
    return;
  }
  state = data?.text ? data : state;
  draftPhone = null;
  dialogEl.close();
  toast(choice === 'whatsapp' ? 'נרשם. הודעות העבודה יגיעו גם ב־WhatsApp.' : 'נרשם. ההתראות ימשיכו להגיע באפליקציה בלבד.');
  paintCard();
}

// Once, on any staff page: when WhatsApp is on and this person has not chosen yet.
export async function promptWhatsapp() {
  if (later() || document.querySelector('dialog[open]')) return;
  if (!(await load())?.prompt) return;
  if (document.querySelector('dialog[open]')) return; // another screen opened meanwhile
  await openDialog();
}

// ── "מה עליי" ──────────────────────────────
async function withdraw() {
  if (busy || !confirm('להפסיק את הודעות העבודה ב־WhatsApp? ההתראות באפליקציה ימשיכו כרגיל.')) return;
  busy = true;
  paintCard();
  const { data, error } = await supabase.rpc('whatsapp_withdraw', { p_user_agent: navigator.userAgent.slice(0, 300) });
  busy = false;
  if (error) { toast(`לא נשמר. ${explain(error)}`); paintCard(); return; }
  state = data?.text ? data : state;
  toast('הודעות ה־WhatsApp הופסקו. ההתראות באפליקציה ממשיכות.');
  paintCard();
  cardEl?.querySelector('#wa-card-on')?.focus();
}

function paintCard() {
  if (!cardEl) return;
  const s = state;
  if (!s?.enabled) { cardEl.hidden = true; return; }
  styles();
  if (!cardEl.isConnected) cardAnchor?.after(cardEl); // a page without its own place for it
  cardEl.hidden = false;
  const head = h('h2', { class: 'push-h', id: 'wa-card-h', tabindex: '-1' }, 'הודעות ב־WhatsApp');
  const act = (id, label, onclick) => h('button', { type: 'button', class: 'btn-text', id, disabled: busy, onclick }, label);
  let body;
  if (s.active) {
    cardEl.dataset.state = 'on';
    body = [h('p', {}, 'הודעות העבודה מגיעות גם ב־WhatsApp, למספר ', h('bdi', { dir: 'ltr' }, formatPhone(s.phone)), '.'),
      h('div', { class: 'push-acts' }, act('wa-card-off', 'הפסקת הודעות ב־WhatsApp', withdraw))];
  } else if (!s.owner && !s.phone) {
    cardEl.dataset.state = 'none';
    body = [h('p', {}, 'אין מספר נייד שמור במערכת, ולכן ההתראות מגיעות באפליקציה בלבד. עירית או ליאור מוסיפים אותו בעמוד הצוות.')];
  } else {
    cardEl.dataset.state = 'off';
    const changed = s.status === 'granted';
    body = [h('p', {}, changed ? 'המספר שלך השתנה. כדי לקבל הודעות ב־WhatsApp צריך לאשר את המספר החדש.' : 'ההתראות מגיעות באפליקציה בלבד. אפשר לקבל אותן גם ב־WhatsApp.'),
      h('div', { class: 'push-acts' }, act('wa-card-on', changed ? 'אישור המספר החדש' : 'קבלת הודעות ב־WhatsApp', () => openDialog()))];
  }
  fill(cardEl, head, ...body);
}

// The card: the page's own #wa-card (clients.html keeps its place in "מה עליי"),
// else right after `anchor` (the notifications card). Shown only while WhatsApp is on.
export async function mountWhatsappCard(anchor) {
  if (!anchor) return;
  cardAnchor = anchor;
  cardEl = document.getElementById('wa-card') || h('section', { class: 'push-card wa-card', id: 'wa-card', 'aria-labelledby': 'wa-card-h', hidden: true });
  if (!state) await load().catch(() => null);
  paintCard();
}
