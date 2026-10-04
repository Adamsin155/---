// Handoff buttons on the pages (the data and the wording: app/handoffs.js).
//  - offerHandoff(): right after a handoff item is checked (client card, "המשימות שלי"),
//    a prompt at the bottom of the screen: "לשלוח לעילאי בוואטסאפ". It stays until
//    closed (× or Escape) or replaced by the next handoff.
//  - handoffLine(): the "העברות" line of a process in the client card: who the work
//    went to, and whether WhatsApp was opened for them.
// The button only opens WhatsApp with the message ready; the person sends it. The
// card records that WhatsApp was opened (`p05.handoff.ilai`, with the person it was
// opened for in the note), never that it was sent.
// `checks` may be the client's checks or a function that returns them: a page that
// reloads its data replaces the object, and the prompt must read the current one.
import { $, h, fill, toast, who, formatStamp } from './protocol-ui.js';
import { setCheck, loadStaffPhones } from './protocol-data.js';
import { handoffsFor, handoffsOf, handoffMessage, waLink, dueText, stillStands } from './handoffs.js';

// Staff WhatsApp numbers by person (staff.phone, set on the team screen), kept for a few minutes.
let phones = {};
let phonesAt = 0;
let phonesLoading = null;
export function ensurePhones(maxAge = 5 * 60e3) {
  if (Date.now() - phonesAt < maxAge) return Promise.resolve(phones);
  phonesLoading ||= loadStaffPhones()
    .then((p) => { phones = p || {}; phonesAt = Date.now(); return phones; })
    .catch(() => phones)
    .finally(() => { phonesLoading = null; });
  return phonesLoading;
}
const phoneOf = (person) => phones[person] || null;

// client.html on this site (GitHub Pages or app.astrateg.com): location.origin + path.
const clientPage = () => `${location.origin}${location.pathname.replace(/[^/]*$/, '')}client.html`;
const domId = (key) => key.replace(/\./g, '-');
const messageOf = (o) => handoffMessage(o, { page: clientPage(), now: new Date() });
const hrefOf = (o) => waLink(phoneOf(o.person), messageOf(o));

const reader = (checks) => (typeof checks === 'function' ? checks : () => checks);

// Opening WhatsApp is recorded in the card (and in its history), with the person
// it was opened for. A check that was undone in the meantime has nothing to hand off.
async function opened(e, o, ctx) {
  if (!stillStands(o, ctx.client, ctx.read())) {
    e.preventDefault();
    toast('הסימון בוטל, ולכן אין מה להעביר.');
    dropStale();
    return;
  }
  // The number may have been added since the prompt was drawn.
  e.currentTarget.href = hrefOf(o);
  say(`וואטסאפ נפתח עם ההודעה ${o.toName}. השליחה עצמה נעשית שם.`);
  try {
    const row = await setCheck(ctx.client.id, o.markKey, 'done', o.known ? o.person : null);
    const checks = ctx.read();
    if (checks) checks[o.markKey] = row;
    o.sent = row;
    // The same handoff in the prompt (when it was opened from the card's line).
    for (const x of panel?.offers || []) if (x.clientId === o.clientId && x.markKey === o.markKey) x.sent = row;
    ctx.onSent?.(o);
    refreshPanel();
  } catch {
    toast('וואטסאפ נפתח, אבל הרישום בכרטיס לא נשמר.');
  }
}

function waButton(o, ctx, { id, label, cls }) {
  return h('a', {
    class: cls, id, href: hrefOf(o), target: '_blank', rel: 'noopener noreferrer',
    onclick: (e) => opened(e, o, ctx),
  }, label, h('span', { class: 'sr-only' }, ' (נפתח בחלון חדש)'));
}

// No number on file: WhatsApp asks whom to send to. The team page, where numbers
// are added, opens for the owner, Irit and Lior only: a link for them, words for the rest.
const noPhoneHint = (o, canTeam) => {
  if (!o.known) return ['עוד לא שויך עורך, אז בוואטסאפ בוחרים את השיחה.'];
  const why = `אין במערכת מספר וואטסאפ של ${o.name}, אז בוואטסאפ בוחרים את השיחה. `;
  return canTeam
    ? [why, h('a', { href: 'team.html' }, 'מוסיפים מספר בעמוד הצוות'), '.']
    : [why, 'עירית או ליאור מוסיפים מספרים בעמוד הצוות.'];
};

// ── The prompt ────────────────────────────
let panel = null;     // { offers, ctx }
let returnTo = null;  // where keyboard focus came from into the prompt
function root() {
  let el = $('handoff');
  if (!el) {
    el = h('aside', { id: 'handoff', class: 'handoff', 'aria-labelledby': 'handoff-h', hidden: true });
    el.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); closeHandoff(); } });
    el.addEventListener('focusin', (e) => { if (e.relatedTarget && !el.contains(e.relatedTarget)) returnTo = e.relatedTarget; });
    // The announcement region is in the page before anything is said in it.
    document.body.append(el, h('p', { id: 'handoff-say', class: 'sr-only', role: 'status', 'aria-live': 'polite' }));
    watchToast();
  }
  return el;
}
// The undo message (#toast) stays under the prompt: when it wraps to more lines on
// a phone, the prompt rises above it (--toast-room, in protocol.css).
function watchToast() {
  const t = $('toast');
  if (!t || typeof MutationObserver === 'undefined') return;
  const place = () => {
    const tall = t.classList.contains('on') ? Math.ceil(t.getBoundingClientRect().height) : 0;
    document.documentElement.style.setProperty('--toast-room', `${tall}px`);
  };
  new MutationObserver(place).observe(t, { attributes: true, attributeFilter: ['class'], childList: true, subtree: true, characterData: true });
  window.addEventListener('resize', place);
  place();
}
root();
function say(text) {
  const el = $('handoff-say');
  el.textContent = '';
  setTimeout(() => { el.textContent = text; }, 50);
}

function offerRow(o, ctx) {
  const phone = phoneOf(o.person);
  const dues = o.dues.map((d) => `${d.label}: ${dueText(d)}`).join(' · ');
  return h('div', { class: `handoff-row${o.sent ? ' is-sent' : ''}` },
    h('p', { class: 'handoff-what' }, h('strong', {}, o.point.label), ` · ${o.known ? o.name : 'העורך המשויך'}`,
      dues ? h('span', { class: 'handoff-due' }, dues) : null),
    waButton(o, ctx, {
      id: `handoff-wa-${domId(o.markKey)}`, cls: `btn btn-sm${o.sent ? '' : ' btn-primary'} handoff-wa`,
      label: o.sent ? `וואטסאפ כבר נפתח · לשלוח שוב ${o.toName}` : `לשלוח ${o.toName} בוואטסאפ`,
    }),
    phone ? null : h('p', { class: 'hint handoff-nophone' }, ...noPhoneHint(o, ctx.canTeam)));
}

function refreshPanel() {
  if (!panel) return;
  const el = root();
  const focusId = el.contains(document.activeElement) ? document.activeElement.id : null;
  fill(el,
    h('div', { class: 'handoff-head' },
      h('p', { class: 'handoff-h', id: 'handoff-h' }, `העברה הלאה · ${panel.offers[0].clientName}`),
      h('button', { type: 'button', class: 'handoff-close', id: 'handoff-close', 'aria-label': 'סגירת ההעברה', onclick: closeHandoff }, '×')),
    ...panel.offers.map((o) => offerRow(o, panel.ctx)));
  el.hidden = false;
  document.body.classList.add('has-handoff');
  if (focusId) document.getElementById(focusId)?.focus({ preventScroll: true });
}

export function closeHandoff() {
  const el = $('handoff');
  const had = el && el.contains(document.activeElement);
  panel = null;
  if (el) { el.hidden = true; fill(el); }
  document.body.classList.remove('has-handoff');
  // Keyboard focus goes back to where it came from.
  if (had && returnTo?.isConnected) returnTo.focus({ preventScroll: true });
  returnTo = null;
}

// After a check: offer the handoffs it triggers (none: nothing happens). `checks`
// is the client's checks with the new one, or a function that returns them; `me`
// is who checked (no message to themselves); `canTeam` whether they can open the
// team page; `onSent` runs after WhatsApp was opened and recorded.
let waiting = null;   // the latest offer, while the numbers load
export async function offerHandoff({ client, key = null, keys = null, checks, me = null, canTeam = false, onSent = null }) {
  const list = (keys || [key]).filter(Boolean);
  const read = reader(checks);
  if (!client || !read() || !list.length) return;
  const now = new Date();
  const seen = new Set();
  const offers = list.flatMap((k) => handoffsFor(client, read(), k, { now, from: me }))
    .filter((o) => !seen.has(o.markKey) && seen.add(o.markKey));
  if (!offers.length) return;
  const mine = {};
  waiting = mine;
  await ensurePhones();
  // A later check has its own prompt; a check undone meanwhile has nothing to hand off.
  if (waiting !== mine) return;
  waiting = null;
  const live = offers.filter((o) => stillStands(o, client, read()));
  if (!live.length) return;
  panel = { offers: live, ctx: { client, read, onSent, canTeam } };
  refreshPanel();
  const names = live.map((o) => o.toName).join(' ו');
  say(`אפשר לשלוח ${names} בוואטסאפ. הכפתור בתחתית המסך.`);
}

// A check undone (called once the page's checks no longer have it): what it offered
// leaves the prompt, as does any offer whose check no longer stands (an item of a
// completed process unchecked). With nothing left, the prompt closes.
export function dropHandoff(key = null) {
  if (!panel) return;
  const before = panel.offers.length;
  panel.offers = panel.offers.filter((o) => o.triggerKey !== key && stillStands(o, panel.ctx.client, panel.ctx.read()));
  if (!panel.offers.length) closeHandoff();
  else if (panel.offers.length < before) refreshPanel();
}
const dropStale = () => dropHandoff(null);

// ── The "העברות" line of a process in the client card ──
// What is still to hand over, with a button, and what was opened in WhatsApp (a
// record; its button to send again stays only while the handoff is still open).
export function handoffLine({ client, checks, state, x, me = null, canTeam = false, onSent = null }) {
  const read = reader(checks);
  const list = handoffsOf(client, read() || {}, state, x);
  if (!list.length) return null;
  const ctx = { client, read, onSent, canTeam };
  return h('div', { class: 'handoff-line', role: 'group', 'aria-label': `העברות מתהליך ${x.proc.num}` },
    h('span', { class: 'me-label' }, 'העברות:'),
    h('ul', { class: 'handoff-list' }, ...list.map((o) => {
      // Opened for someone other than who is next now (the editor was changed since).
      const sentTo = o.sentTo && o.sentTo !== o.name ? ` ל${o.sentTo}` : '';
      const button = o.live && o.person !== me;
      return h('li', {},
        h('span', {}, `${o.point.label} → ${o.known ? o.name : 'העורך המשויך'}`),
        o.sent
          ? h('span', { class: 'muted' }, `וואטסאפ נפתח${sentTo} · ${who(o.sent.by_email)} · ${formatStamp(o.sent.at)}`)
          : h('span', { class: 'muted' }, 'וואטסאפ עוד לא נפתח'),
        button ? waButton(o, ctx, {
          id: `hl-${domId(o.markKey)}`, cls: 'btn-text handoff-send',
          label: o.sent ? `לשלוח שוב ${o.toName}` : `לשלוח ${o.toName} בוואטסאפ`,
        }) : null,
        !button || phoneOf(o.person) ? null : h('span', { class: 'hint' }, o.known ? 'אין מספר במערכת' : 'עוד לא שויך עורך'));
    })));
}
