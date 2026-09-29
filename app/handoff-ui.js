// Handoff buttons on the pages (the data and the wording: app/handoffs.js).
//  - offerHandoff(): right after a handoff item is checked (client card, "מה עליי"),
//    a prompt at the bottom of the screen: "לשלוח לעילאי בוואטסאפ". It stays until
//    closed (× or Escape) or replaced by the next handoff.
//  - handoffLine(): the "העברות" line of a process in the client card: who the work
//    went to, and whether WhatsApp was opened for them.
// The button only opens WhatsApp with the message ready; the person sends it. The
// card records that WhatsApp was opened (`p05.handoff.ilai`), never that it was sent.
import { $, h, fill, toast, who, formatStamp } from './protocol-ui.js';
import { setCheck, loadStaffPhones } from './protocol-data.js';
import { handoffsFor, handoffsOf, handoffMessage, waLink, dueText } from './handoffs.js';

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

// Opening WhatsApp is recorded in the card (and in its history). A trigger that
// was undone in the meantime has nothing to hand off.
async function opened(e, o, ctx) {
  if (o.triggerKey && ctx.checks?.[o.triggerKey]?.state !== 'done') {
    e.preventDefault();
    toast('הסימון בוטל, ולכן אין מה להעביר.');
    closeHandoff();
    return;
  }
  // The number may have been added since the prompt was drawn.
  e.currentTarget.href = hrefOf(o);
  say(`וואטסאפ נפתח עם ההודעה ${o.toName}. השליחה עצמה נעשית שם.`);
  try {
    const row = await setCheck(ctx.client.id, o.markKey, 'done', null);
    if (ctx.checks) ctx.checks[o.markKey] = row;
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

const noPhoneHint = (o) => (o.known
  ? [`אין במערכת מספר וואטסאפ של ${o.name}, אז בוואטסאפ בוחרים את השיחה. `, h('a', { href: 'team.html' }, 'מוסיפים מספר בעמוד הצוות'), '.']
  : ['עוד לא שויך עורך, אז בוואטסאפ בוחרים את השיחה.']);

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
  }
  return el;
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
      label: o.sent ? `נפתח. לשלוח שוב ${o.toName}` : `לשלוח ${o.toName} בוואטסאפ`,
    }),
    phone ? null : h('p', { class: 'hint handoff-nophone' }, ...noPhoneHint(o)));
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
// is the client's checks, with the new one; `me` is who checked (no message to
// themselves); `onSent` runs after WhatsApp was opened and recorded.
export async function offerHandoff({ client, key = null, keys = null, checks, me = null, onSent = null }) {
  const list = (keys || [key]).filter(Boolean);
  if (!client || !checks || !list.length) return;
  const now = new Date();
  const seen = new Set();
  const offers = list.flatMap((k) => handoffsFor(client, checks, k, { now, from: me }))
    .filter((o) => !seen.has(o.markKey) && seen.add(o.markKey));
  if (!offers.length) return;
  await ensurePhones();
  panel = { offers, ctx: { client, checks, onSent } };
  refreshPanel();
  const names = offers.map((o) => o.toName).join(' ו');
  say(`אפשר לשלוח ${names} בוואטסאפ. הכפתור בתחתית המסך.`);
}

// A check undone: its prompt goes away.
export function dropHandoff(key) {
  if (panel?.offers.some((o) => o.triggerKey === key)) closeHandoff();
}

// ── The "העברות" line of a process in the client card ──
export function handoffLine({ client, checks, state, x, me = null, onSent = null }) {
  const list = handoffsOf(client, checks, state, x);
  if (!list.length) return null;
  const ctx = { client, checks, onSent };
  return h('div', { class: 'handoff-line', role: 'group', 'aria-label': `העברות מתהליך ${x.proc.num}` },
    h('span', { class: 'me-label' }, 'העברות:'),
    h('ul', { class: 'handoff-list' }, ...list.map((o) => h('li', {},
      h('span', {}, `${o.point.label} → ${o.known ? o.name : 'העורך המשויך'}`),
      o.sent
        ? h('span', { class: 'muted' }, `וואטסאפ נפתח · ${who(o.sent.by_email)} · ${formatStamp(o.sent.at)}`)
        : h('span', { class: 'muted' }, 'וואטסאפ עוד לא נפתח'),
      o.person === me ? null : waButton(o, ctx, {
        id: `hl-${domId(o.markKey)}`, cls: 'btn-text handoff-send',
        label: o.sent ? `לשלוח שוב ${o.toName}` : `לשלוח ${o.toName} בוואטסאפ`,
      }),
      o.person === me || phoneOf(o.person) ? null : h('span', { class: 'hint' }, o.known ? 'אין מספר במערכת' : 'עוד לא שויך עורך')))));
}
