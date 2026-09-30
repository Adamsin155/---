// Web Push on this device and the notifications list, without the DOM (the page
// is app/push.js; tests/push-logic.test.mjs tests this). Plan: section 3 ("כולם"),
// appendix ב (iPhone: iOS 16.4 and up, installed to the home screen, permission
// asked from a button inside the installed app).
import { dayKeyIL } from './tz.js';

// Which kind of device, from what the browser tells about itself.
export function platformOf({ userAgent = '', maxTouchPoints = 0, standalone = false } = {}) {
  // iPadOS says "Macintosh" but has a touch screen.
  const ios = /iPhone|iPad|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && maxTouchPoints > 1);
  const m = /OS (\d+)[_.](\d+)/.exec(userAgent) || /Version\/(\d+)\.(\d+)/.exec(userAgent);
  return { ios, iosVersion: ios && m ? [Number(m[1]), Number(m[2])] : null, standalone: !!standalone };
}

// Where this device stands, as the card in "מה עליי" shows it:
//   unsupported  this browser has no Web Push
//   ios-update   an iPhone older than iOS 16.4
//   ios-install  an iPhone, not opened from the home screen yet: add it there first
//   blocked      notifications were refused in the browser's settings
//   ready        can be switched on (a button asks for permission)
//   confirm      connected; waiting for "קיבלתי" on the test notification
//   on           connected and confirmed
export function pushState({ ios = false, iosVersion = null, standalone = false, hasPush = false, permission = 'default', subscribed = false, confirmed = false }) {
  if (ios) {
    if (iosVersion && (iosVersion[0] < 16 || (iosVersion[0] === 16 && iosVersion[1] < 4))) return 'ios-update';
    if (!standalone) return 'ios-install';
  }
  if (!hasPush) return 'unsupported';
  if (permission === 'denied') return 'blocked';
  if (permission === 'granted' && subscribed) return confirmed ? 'on' : 'confirm';
  return 'ready';
}

// The VAPID key as PushManager.subscribe wants it.
export function keyBytes(base64url) {
  const s = String(base64url).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(s + '='.repeat((4 - (s.length % 4)) % 4));
  return Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
}
// Whether a subscription was made with this key (after a key change, subscribe again).
export function sameKey(buffer, base64url) {
  if (!buffer) return false;
  const a = new Uint8Array(buffer);
  const b = keyBytes(base64url);
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

// The notifications list: today's rows of the log (Israel day), newest first.
// Queued digest lines are not rows of their own (they arrive inside a digest), and
// suppressed ones were never sent.
export function inboxRows(rows = [], now = new Date()) {
  const today = dayKeyIL(now);
  return rows
    .filter((r) => r.status !== 'suppressed' && !(r.level === 'digest' && r.channel === 'digest') && dayKeyIL(new Date(r.created_at)) === today)
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at) || (b.id - a.id));
}
export const unreadCount = (rows) => rows.filter((r) => !r.read_at).length;

// How a row reached the person, in words (never by colour alone).
export function deliveryText(r) {
  if (r.status === 'failed') return 'לא נשלח לטלפון: תקלה. מופיע כאן.';
  if (r.status === 'pending') return 'נשלח עכשיו לטלפון';
  if (r.status === 'queued') return r.reason === 'shoot_mode' ? 'יגיע בסיכום אחרי יום הצילום' : 'יגיע בתקציר הבא';
  if (r.channel === 'digest') return 'נכלל בתקציר';
  if (r.channel === 'push') return r.level === 'digest' ? 'תקציר, נשלח לטלפון' : 'נשלח לטלפון';
  if (r.reason === 'no_device') return 'בתוך המערכת (אין טלפון מחובר)';
  return 'בתוך המערכת, בלי צליל';
}

// "לדחות עד…": in an hour, or 09:00 on the next business day (Israel time).
export const SNOOZE_CHOICES = [['hour', 'בעוד שעה'], ['morning', 'ביום העבודה הבא ב־09:00']];
