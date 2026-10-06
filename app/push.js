// Notifications on the phone (stage 3), in "המשימות שלי" (clients.html):
//  - the "הפעלת התראות" card: on an iPhone first "הוספה למסך הבית" (iOS 16.4+),
//    and permission is asked only from a button in the installed app; after
//    connecting, a test notification that the person confirms ("קיבלתי");
//  - "התראות": today's reminders of the signed-in person (public.reminder_log),
//    unread count on the button and the app icon, mark read, "לדחות עד…";
//  - siteWorker(): the one service worker registration of the site (sw.js), also
//    used by the "now" bar for notifications on Android.
// Pure decisions are in push-logic.js. Nothing here runs until the database has
// the push tables (the migration 20260930110000): until then it stays hidden.
import { supabase } from './supa.js';
import { VAPID_PUBLIC_KEY } from './push-config.js';
import { platformOf, pushState, keyBytes, sameKey, inboxRows, unreadCount, deliveryText, SNOOZE_CHOICES } from './push-logic.js';
import { businessDayFrom, atIL, SNOOZE } from './reminder-rules.js';
import { atTimeIL } from './tz.js';
import { $, fill, h, toast, errorText, formatStamp } from './protocol-ui.js';

// ── The service worker ────────────────────
let worker = null;
// Registered once, at the site root (sw.js controls clients.html); resolves when active (or null).
export function siteWorker() {
  if (!('serviceWorker' in navigator)) return Promise.resolve(null);
  worker ||= navigator.serviceWorker.register(new URL('../sw.js', import.meta.url), { scope: new URL('../', import.meta.url).href })
    .then((reg) => (reg.active ? reg : new Promise((resolve) => {
      const sw = reg.installing || reg.waiting;
      if (!sw) { resolve(null); return; }
      sw.addEventListener('statechange', () => {
        if (sw.state === 'activated') resolve(reg);
        else if (sw.state === 'redundant') resolve(null);
      });
    })))
    .catch(() => null);
  return worker;
}
// The stage 1 worker (app/notify-sw.js) is gone; its registration is removed.
function retireOldWorker() {
  navigator.serviceWorker?.getRegistrations?.()
    .then((regs) => regs.filter((r) => r.scope.endsWith('/app/')).forEach((r) => r.unregister()))
    .catch(() => {});
}

// ── This device ───────────────────────────
const standalone = () => window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;
const hasPush = () => 'serviceWorker' in navigator && 'PushManager' in window && typeof window.Notification === 'function';

let person = null;        // whose list ('owner' for the owner)
let live = false;         // the database has the push tables
let devices = [];         // my rows in push_subscriptions
let current = null;       // this device's PushSubscription
let state = null;
let busy = false;
let hint = '';            // a line under the card after a failed step
let rows = [];            // today's reminders
let cardEl = null;
let buttonEl = null;
let dialogEl = null;
let onChange = () => {};  // the page re-renders what depends on pushActive()
let painted = null;

export const pushActive = () => state === 'on' || state === 'confirm';

async function loadDevices() {
  const { data, error } = await supabase.from('push_subscriptions').select('endpoint, confirmed_at, last_ok_at, created_at');
  if (error) throw error;
  devices = data || [];
}

async function readDevice() {
  current = null;
  if (hasPush() && Notification.permission === 'granted') {
    const reg = await siteWorker();
    current = reg ? await reg.pushManager.getSubscription().catch(() => null) : null;
    if (current && !sameKey(current.options?.applicationServerKey, VAPID_PUBLIC_KEY)) current = null;
  }
  const mine = current && devices.find((d) => d.endpoint === current.endpoint);
  // Connected on this device but not recorded for me (another login, or new keys): record it.
  if (current && !mine) await save(current).catch(() => {});
  const row = current && devices.find((d) => d.endpoint === current.endpoint);
  state = pushState({
    ...platformOf({ userAgent: navigator.userAgent, maxTouchPoints: navigator.maxTouchPoints, standalone: standalone() }),
    hasPush: hasPush(), permission: hasPush() ? Notification.permission : 'default', subscribed: !!row, confirmed: !!row?.confirmed_at,
  });
}

async function save(sub) {
  const j = sub.toJSON();
  const { error } = await supabase.rpc('push_subscribe', {
    p_endpoint: j.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth, p_user_agent: navigator.userAgent.slice(0, 300),
  });
  if (error) throw error;
  await loadDevices();
}

async function sendTest() {
  const { data, error } = await supabase.functions.invoke('reminders', { body: { action: 'test', endpoint: current?.endpoint || null } });
  if (!error) return data;
  let code = null;
  try { code = (await error.context.json()).error; } catch { /* no JSON body */ }
  throw Object.assign(new Error(code || error.message), { code });
}
const TEST_ERRORS = {
  too_soon: 'שלחנו התראת ניסיון לפני רגע. אפשר לנסות שוב בעוד חצי דקה.',
  no_device: 'הטלפון הזה עוד לא מחובר. לחצו שוב על "הפעלת התראות".',
  not_ready: 'שירות ההתראות עוד לא הופעל בשרת. פנו למנהל המערכת.',
};

async function enable() {
  busy = true; hint = ''; paint();
  try {
    // Asked only here, from a tap (iPhone requires it, and it is polite everywhere).
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      hint = permission === 'denied' ? '' : 'לא אושר. אפשר ללחוץ שוב בכל רגע.';
      return;
    }
    const reg = await siteWorker();
    if (!reg) throw new Error('no worker');
    let sub = await reg.pushManager.getSubscription();
    if (sub && !sameKey(sub.options?.applicationServerKey, VAPID_PUBLIC_KEY)) { await sub.unsubscribe(); sub = null; }
    sub ||= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(VAPID_PUBLIC_KEY) });
    current = sub;
    await save(sub);
    try { await sendTest(); } catch (err) { hint = TEST_ERRORS[err.code] || `התראת הניסיון לא נשלחה. ${errorText(err)}`; }
  } catch (err) {
    hint = `ההתראות לא הופעלו. ${errorText(err)}`;
  } finally {
    busy = false;
    await readDevice().catch(() => {});
    paint();
    cardEl.querySelector('button')?.focus();
  }
}

async function confirmReceived() {
  busy = true; paint();
  const { error } = await supabase.rpc('push_confirm', { p_endpoint: current?.endpoint });
  busy = false;
  if (error) { toast(`לא נשמר. ${errorText(error)}`); paint(); return; }
  await loadDevices().catch(() => {});
  await readDevice().catch(() => {});
  paint();
  toast('מעולה. ההתראות פעילות בטלפון הזה.');
  $('push-h')?.focus();
}

async function testAgain() {
  busy = true; hint = ''; paint();
  try {
    await sendTest();
    toast('נשלחה התראת ניסיון.');
    hint = state === 'confirm' ? 'לא הגיעה? בדקו שההתראות של האפליקציה מופעלות בהגדרות הטלפון, ושמצב "נא לא להפריע" או "ריכוז" כבוי.' : '';
  } catch (err) {
    hint = TEST_ERRORS[err.code] || `התראת הניסיון לא נשלחה. ${errorText(err)}`;
  }
  busy = false;
  paint();
}

async function disable() {
  if (!confirm('לכבות את ההתראות בטלפון הזה? התזכורות ימשיכו להופיע ב״התראות״ בתוך המערכת.')) return;
  busy = true; paint();
  try {
    if (current) {
      await supabase.rpc('push_unsubscribe', { p_endpoint: current.endpoint });
      await current.unsubscribe().catch(() => {});
    }
    await loadDevices();
    await readDevice();
    toast('ההתראות כובו בטלפון הזה.');
  } catch (err) {
    toast(`לא כובו. ${errorText(err)}`);
  }
  busy = false;
  paint();
}

// ── The card ──────────────────────────────
const btn = (label, onclick, primary = false) => h('button', { type: 'button', class: `btn ${primary ? 'btn-primary' : ''}`.trim(), disabled: busy, onclick }, label);
function cardBody() {
  const head = (text) => h('h2', { class: 'push-h', id: 'push-h', tabindex: '-1' }, text);
  switch (state) {
    case 'ios-update':
      return [head('התראות לטלפון'), h('p', {}, 'כדי לקבל התראות באייפון צריך iOS 16.4 ומעלה. עדכנו את האייפון (הגדרות ← כללי ← עדכון תוכנה), ואז חזרו לכאן.')];
    case 'ios-install':
      return [head('הפעלת התראות באייפון'),
        h('p', {}, 'באייפון ההתראות עובדות רק מהאפליקציה שבמסך הבית. פעם אחת:'),
        h('ol', { class: 'push-steps' },
          h('li', {}, 'לוחצים על כפתור השיתוף של Safari (ריבוע עם חץ למעלה).'),
          h('li', {}, 'בוחרים ״הוספה למסך הבית״, ואז ״הוספה״.'),
          h('li', {}, 'פותחים את ״אסטרטג לקוחות״ ממסך הבית, נכנסים, ולוחצים כאן ״הפעלת התראות״.'))];
    case 'unsupported':
      return [head('התראות לטלפון'), h('p', {}, 'הדפדפן הזה לא מקבל התראות. בטלפון אנדרואיד או במחשב פתחו את המערכת ב־Chrome. באייפון: Safari, ואז הוספה למסך הבית.')];
    case 'blocked':
      return [head('ההתראות חסומות'), h('p', {}, 'ההתראות של האתר נחסמו בטלפון הזה. כדי לפתוח: בהגדרות הדפדפן ← הגדרות אתרים ← התראות ← לאפשר. באייפון: הגדרות ← התראות ← אסטרטג לקוחות.')];
    case 'confirm':
      return [head('הגיעה התראת ניסיון?'),
        h('p', {}, 'שלחנו התראת ניסיון לטלפון הזה. אם הגיעה, לחצו ״קיבלתי״.'),
        h('div', { class: 'push-acts' }, btn('קיבלתי', confirmReceived, true), btn('לא הגיעה, לשלוח שוב', testAgain))];
    case 'on':
      return [h('p', { class: 'push-on' }, h('span', { class: 'push-h', id: 'push-h', tabindex: '-1' }, 'ההתראות פעילות בטלפון הזה.'), ' ',
        h('button', { type: 'button', class: 'btn-text', disabled: busy, onclick: testAgain }, 'שליחת ניסיון'),
        h('button', { type: 'button', class: 'btn-text', disabled: busy, onclick: disable }, 'כיבוי'))];
    default: // ready
      return [head('הפעלת התראות'),
        h('p', {}, 'תזכורות לפי הפרוטוקול יגיעו לטלפון, גם כשהמערכת סגורה. מחוץ לשעות העבודה הן נאספות לתקציר של 08:30.'),
        h('div', { class: 'push-acts' }, btn(busy ? 'מפעילים…' : 'הפעלת התראות', enable, true))];
  }
}
function paint() {
  if (!cardEl) return;
  if (painted !== state) { painted = state; onChange(); }
  if (!live || !state) { cardEl.hidden = true; return; }
  cardEl.hidden = false;
  cardEl.dataset.state = state;
  fill(cardEl, cardBody(), hint ? h('p', { class: 'push-hint', role: 'status' }, hint) : null);
}

// ── Today's reminders ─────────────────────
async function loadRows() {
  const { data, error } = await supabase.from('reminder_log')
    .select('id, key, rule, level, channel, status, reason, title, body, url, ref, client_id, created_at, sent_at, read_at')
    .eq('person', person).gte('created_at', atTimeIL(new Date(), 0).toISOString())
    .order('created_at', { ascending: false }).limit(1000); // room for the 10-minute repeats of a task (one row is shown)
  if (error) throw error;
  rows = inboxRows(data || []);
}

function paintButton() {
  if (!buttonEl) return;
  buttonEl.hidden = !live;
  const n = unreadCount(rows);
  fill(buttonEl, 'התראות', n ? h('span', { class: 'n' }, String(n)) : null);
  buttonEl.setAttribute('aria-label', n ? `התראות, ${n} חדשות` : 'התראות');
  // A number on the app icon (principle 4, "שקט"), where the phone supports it.
  try { if (n) navigator.setAppBadge?.(n); else navigator.clearAppBadge?.(); } catch { /* not supported */ }
}

async function markRead(ids) {
  const { error } = await supabase.rpc('reminders_mark_read', { p_ids: ids });
  if (error) { toast(`לא נשמר. ${errorText(error)}`); return false; }
  const at = new Date().toISOString();
  for (const r of rows) if (!ids || ids.includes(r.id)) r.read_at ||= at;
  paintButton();
  return true;
}

async function snooze(r, choice) {
  const now = new Date();
  const until = choice === 'hour' ? new Date(now.getTime() + 36e5) : atIL(businessDayFrom(now, 1), '09:00');
  const { error } = await supabase.from('protocol_checks')
    .upsert({ client_id: r.client_id, item_key: SNOOZE(r.ref), state: 'done', note: until.toISOString() }, { onConflict: 'client_id,item_key' });
  if (error) { toast(`לא נדחה. ${errorText(error)}`); return; }
  await markRead([r.id]);
  toast(`נדחה עד ${formatStamp(until)}. התזכורת תחזור אז, אם עוד רלוונטית.`);
  paintInbox();
}

function rowView(r) {
  const id = `inbox-${r.id}`;
  const open = r.url ? new URL(r.url, new URL('../', import.meta.url)).href : null;
  return h('li', { class: `inbox-row${r.read_at ? '' : ' is-new'}`, id },
    h('div', { class: 'inbox-top' },
      h('span', { class: 'num muted' }, formatStamp(r.created_at).split(' ').at(-1)),
      r.read_at ? null : h('span', { class: 'tag inbox-new' }, 'חדש'),
      h('strong', { class: 'inbox-title' }, r.title)),
    r.body ? h('p', { class: 'inbox-body' }, r.body) : null,
    h('p', { class: 'inbox-meta muted' }, deliveryText(r)),
    h('div', { class: 'inbox-acts' },
      open ? h('a', {
        class: 'btn btn-sm', href: open,
        onclick: () => { if (!r.read_at) supabase.rpc('reminders_mark_read', { p_ids: [r.id] }).then(() => {}, () => {}); },
      }, 'פתיחה') : null,
      r.read_at ? null : h('button', { type: 'button', class: 'btn-text', onclick: async () => { if (await markRead([r.id])) { paintInbox(); document.getElementById(id)?.querySelector('a, button')?.focus(); } } }, 'סימון כנקרא'),
      r.ref && r.client_id && r.level !== 'digest' ? h('label', { class: 'inbox-snooze' },
        h('span', { class: 'sr-only' }, `לדחות את התזכורת: ${r.title}`),
        h('select', {
          class: 'input',
          onchange: (ev) => { const v = ev.currentTarget.value; ev.currentTarget.value = ''; if (v) snooze(r, v); },
        }, h('option', { value: '' }, 'לדחות…'), ...SNOOZE_CHOICES.map(([v, label]) => h('option', { value: v }, label)))) : null));
}

function paintInbox() {
  if (!dialogEl?.open) return;
  const list = dialogEl.querySelector('#inbox-list');
  const n = unreadCount(rows);
  fill(dialogEl.querySelector('#inbox-sum'), rows.length ? `${rows.length} היום${n ? `, ${n} חדשות` : ''}.` : '');
  dialogEl.querySelector('#inbox-read').hidden = !n;
  fill(list, rows.length ? rows.map(rowView) : h('li', { class: 'empty' }, 'אין התראות היום.'));
}

async function openInbox() {
  try { await loadRows(); } catch (err) { toast(`ההתראות לא נטענו. ${errorText(err)}`); return; }
  dialogEl.showModal();
  paintInbox();
  paintButton();
  dialogEl.querySelector('#inbox-h')?.focus();
}

// ── Start ─────────────────────────────────
export async function refreshPush() {
  if (!live) return;
  try { await loadRows(); } catch { /* keep the last list */ }
  paintButton();
  paintInbox();
}

// Mounts the card, the button and the list for the signed-in person
// ('owner' for the owner). Stays hidden when the push tables are not there yet.
export async function mountPush({ who, card, button, dialog, changed = () => {} }) {
  person = who;
  onChange = changed;
  cardEl = card;
  buttonEl = button;
  dialogEl = dialog;
  if (!person) return;
  try {
    await Promise.all([loadDevices(), loadRows()]);
    live = true;
  } catch {
    live = false;
    paint();
    paintButton();
    return;
  }
  retireOldWorker();
  await readDevice().catch(() => { state = 'unsupported'; });
  paint();
  paintButton();
  buttonEl.addEventListener('click', openInbox);
  dialogEl.addEventListener('click', (e) => { if (e.target.closest('[data-close]') || e.target === dialogEl) dialogEl.close(); });
  dialogEl.querySelector('#inbox-read').addEventListener('click', async () => {
    if (await markRead(null)) { paintInbox(); dialogEl.querySelector('#inbox-h')?.focus(); toast('כל ההתראות סומנו כנקראו.'); }
  });
  // New reminders come every minute on the server: the count follows while the page is open.
  setInterval(() => { if (!document.hidden) refreshPush(); }, 60e3);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshPush(); });
}
