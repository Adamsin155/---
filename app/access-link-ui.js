// The client card's part for the client's logins form (the owner's request of
// 6.10.2026), inside the vault's block: "קישור ללקוח למילוי פרטי הכניסה". The
// state (not created / waiting for the client since / filled on / expired), and for
// the owner, Irit, Lior and Ofir: making the link, copying a ready WhatsApp message
// with it, making a new one (the one before stops working) and revoking it. Once the
// client filled it: which platforms and what was chosen for each (never a user name
// or a password: those are the vault's rows below, behind the vault flag), and the
// client's notes with their date. The office sees it (the database: is_office()).
import { h } from './quote-doc.js';
import { waLink, groupLink } from './messages-logic.js';
import { accessUrl, accessLinkMessage, linkState, linkStateText, currentLink, summaryText, dateWords } from './access-logic.js';
import { loadAccessLinks, accessLinkToken, createAccessLink, revokeAccessLink, createError, canManageAccessLinks, seesAccessLinks } from './access-data.js';

let cache = { id: null, loaded: false, version: 0 };
let shown = { id: null, version: -1 };

async function copy(text, toast) {
  try { await navigator.clipboard.writeText(text); toast?.('הועתק.'); } catch { toast?.('ההעתקה לא הצליחה. אפשר לסמן ולהעתיק ידנית.'); }
}

async function loadFor(client, { manage }) {
  const id = client.id;
  try {
    const links = await loadAccessLinks(id);
    if (cache.id !== id) return;
    if (links === null) { cache = { ...cache, loaded: true, loadedAt: Date.now(), off: true, version: cache.version + 1 }; return; }
    const link = currentLink(links, new Date());
    const state = linkState(link, new Date());
    const token = manage && state === 'waiting' ? await accessLinkToken(link.id) : null;
    if (cache.id !== id) return;
    cache = { ...cache, loaded: true, loadedAt: Date.now(), off: false, error: null, links, link, state, token, version: cache.version + 1 };
  } catch {
    if (cache.id !== id) return;
    cache = { ...cache, loaded: true, loadedAt: Date.now(), off: false, error: 'לא הצלחנו לטעון את הקישור של טופס פרטי הכניסה.', version: cache.version + 1 };
  }
}

// Fills `slot` for the office. `viewer`: { me, scope, error }. `onFilled()` is called
// when the client's submission is first seen here (the card then reads the vault again).
// Re-rendering the card calls it again: nothing is rebuilt unless the data changed.
export function mountAccessLink(slot, { client, viewer, toast = null, onFilled = null, onDraw = null }) {
  if (!slot) return;
  if (!client || !seesAccessLinks(viewer || {})) { slot.replaceChildren(); shown = { id: null, version: -1 }; return; }
  const manage = canManageAccessLinks(viewer);
  const redraw = () => mountAccessLink(slot, { client, viewer, toast, onFilled, onDraw });
  const reload = async () => {
    const before = cache.state;
    await loadFor(client, { manage });
    if (cache.id === client.id && cache.state === 'filled' && before && before !== 'filled') onFilled?.();
    redraw();
  };
  if (cache.id !== client.id) {
    cache = { id: client.id, loaded: false, version: 0 };
    slot.replaceChildren();
    loadFor(client, { manage }).then(redraw);
    return;
  }
  // What the client did since: read again with the card's refresh, at most once a
  // minute, and not while someone works in this block.
  const working = slot.contains(document.activeElement);
  if (cache.loaded && !cache.reloading && Date.now() - cache.loadedAt > 60e3 && !working) {
    cache.reloading = true;
    reload().finally(() => { cache.reloading = false; });
  }
  if (!cache.loaded || (shown.id === client.id && shown.version === cache.version && slot.firstChild)) return;
  shown = { id: client.id, version: cache.version };
  slot.replaceChildren(...[block(client, { manage, toast, reload })].filter(Boolean));
  onDraw?.(); // the card shows the vault's block to whoever has no vault flag only when there is something here
}

function block(client, { manage, toast, reload }) {
  const c = cache;
  if (c.off) return null; // the form is not set up in the database yet
  const head = h('h3', { id: 'al-h' }, 'קישור ללקוח למילוי פרטי הכניסה');
  if (c.error) return manage ? h('div', { class: 'al-block', id: 'access-link', role: 'group', 'aria-labelledby': 'al-h' }, head, h('p', { class: 'muted', role: 'status' }, c.error)) : null;
  const now = new Date();
  const l = c.link;
  const state = c.state;
  // Whoever cannot make a link has nothing to see here until one exists.
  if (!manage && state === 'none') return null;

  const create = async (again) => {
    const ask = state === 'waiting' ? 'ליצור קישור חדש? הקישור הקודם יפסיק לעבוד, וצריך לשלוח ללקוח את החדש.'
      : state === 'filled' ? 'הלקוח כבר מילא את הטופס. ליצור קישור נוסף? מה שימלא יעדכן את אותן רשתות בכספת.' : null;
    if (again && ask && !window.confirm(ask)) return;
    try { await createAccessLink(client.id); } catch (err) { toast?.(createError(err)); return; }
    toast?.('נוצר קישור. אפשר להעתיק את ההודעה ולשלוח ללקוח.');
    await reload();
    document.getElementById('al-copy-msg')?.focus();
  };
  const revoke = async () => {
    if (!window.confirm('לבטל את הקישור? הלקוח לא יוכל למלא את הטופס עד שיקבל קישור חדש.')) return;
    try { await revokeAccessLink(l.id); } catch { toast?.('הקישור לא בוטל. נסו שוב.'); return; }
    toast?.('הקישור בוטל.');
    await reload();
    document.getElementById('al-create')?.focus();
  };

  const url = c.token ? accessUrl(location.href, c.token) : null;
  const msg = url ? accessLinkMessage(client, url) : null;
  const stateLine = h('p', { class: `st-state al-state is-${state}`, id: 'al-state' },
    h('strong', {}, { none: 'לא נוצר', waiting: 'ממתין ללקוח', filled: 'מולא', expired: 'פג תוקף', revoked: 'בוטל', locked: 'ננעל' }[state]), ' · ', linkStateText(l, now));
  const filled = state === 'filled' ? [
    h('p', { class: 'al-summary', id: 'al-summary' }, summaryText(l.summary) || 'הפרטים בכספת.'),
    l.client_note ? h('p', { class: 'al-note', id: 'al-note' }, h('strong', {}, `הערת הלקוח (${dateWords(l.submitted_at)}): `), l.client_note) : null,
  ] : [];
  const who = h('p', { class: 'muted' }, 'הבעלים, עירית, ליאור או אופיר יוצרים את הקישור.');
  let acts = null;
  if (state === 'waiting') {
    acts = manage && url ? h('div', { class: 'st-acts' },
      h('button', { type: 'button', class: 'btn btn-sm', id: 'al-copy-msg', onclick: () => copy(msg, toast) }, 'העתקת הודעה עם הקישור'),
      h('a', { class: 'btn btn-sm', id: 'al-wa', href: client.phone ? waLink(client.phone, msg) : groupLink(msg), target: '_blank', rel: 'noopener noreferrer' }, 'שליחה ב־WhatsApp', h('span', { class: 'sr-only' }, ' (נפתח בחלון חדש)')),
      h('button', { type: 'button', class: 'btn-text', id: 'al-copy', onclick: () => copy(url, toast) }, 'העתקת הקישור'),
      h('a', { class: 'btn-text', id: 'al-view', href: url, target: '_blank', rel: 'noopener noreferrer' }, 'תצוגה', h('span', { class: 'sr-only' }, ' (נפתח בחלון חדש; רק הלקוח שולח את הטופס)')),
      h('button', { type: 'button', class: 'btn-text', id: 'al-new', onclick: () => create(true) }, 'קישור חדש'),
      h('button', { type: 'button', class: 'btn-text st-danger', id: 'al-revoke', onclick: revoke }, 'ביטול הקישור')) : manage ? null : who;
  } else {
    acts = manage ? h('div', { class: 'st-acts' },
      h('button', { type: 'button', class: state === 'filled' ? 'btn-text' : 'btn btn-sm', id: 'al-create', onclick: () => create(state === 'filled') }, state === 'none' ? 'יצירת קישור' : state === 'filled' ? 'קישור נוסף' : 'יצירת קישור חדש')) : (state === 'filled' ? null : who);
  }
  return h('div', { class: 'al-block', id: 'access-link', role: 'group', 'aria-labelledby': 'al-h' },
    head,
    h('p', { class: 'muted al-what' }, 'הלקוח ממלא בעצמו את שמות המשתמש והסיסמאות, והם נכנסים לכאן מוצפנים. הקישור תקף ל־14 יום ולשליחה אחת.'),
    stateLine, ...filled, acts,
    state === 'waiting' && manage && msg ? h('details', { class: 'st-msg' }, h('summary', {}, 'ההודעה שתישלח'), h('p', { class: 'pp-msg' }, msg)) : null);
}
