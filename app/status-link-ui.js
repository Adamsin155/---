// The client card's block for the client's side (stage 4): the status page's secret
// link (create, copy a ready WhatsApp message with it, revoke, see when it was
// opened), the client's approvals and fix requests from the page, the satisfaction
// answers (and recording one the client gave in the group), and whether the client
// agreed to WhatsApp service updates when signing. Kept here so the card changes by
// a line; the office sees it (the database: is_office()), and the link is managed by
// Irit, Lior and the owner (can_manage_status_links()).
import { h } from './quote-doc.js';
import { supabase } from './supa.js';
import { dayText, timeText, waLink, groupLink } from './messages-logic.js';
import { statusUrl, statusLinkMessage, itemText, SURVEY_TITLES, scaleOf, lowScore, severeScore, cleanName, nameOk } from './status-logic.js';
import { icon, iconSquare, dressHead, pill, emptyRow, cardHead, noticeAround } from './kit.js';

const LINK_COLS = 'id, created_at, created_by, expires_at, revoked_at, revoked_by';
const APPROVAL_COLS = 'id, item, item_key, shoot_round, decision, round, signer_name, note, wording, at';
const SURVEY_COLS = 'kind, score, respondent, source, recorded_by, at';
const CONSENT_COLS = 'given, at, phone, version, revoked_at, revoked_via';
const VIA = { whatsapp: 'השיב/ה "הסר" ב־WhatsApp', phone: 'ביקש/ה בטלפון', staff: 'אמר/ה לאחד מאיתנו' };
const MANAGERS = ['irit', 'lior'];

let cache = { id: null, loaded: false, version: 0, error: null };
let shown = { id: null, version: -1 };

const when = (v) => { const d = new Date(v); return `${dayText(d)} ${timeText(d)}`; };
async function copy(text, toast) {
  try { await navigator.clipboard.writeText(text); toast?.('הועתק.'); } catch { toast?.('ההעתקה לא הצליחה. אפשר לסמן ולהעתיק ידנית.'); }
}
const missingTables = (err) => /client_status_links|client_approvals|client_surveys|client_consents|does not exist|Could not find/i.test(String(err?.message || err || ''));

async function loadFor(client, { manage }) {
  const id = client.id;
  const rows = async (q) => { const { data, error } = await q; if (error) throw error; return data; };
  try {
    const [links, views, approvals, surveys, consent] = await Promise.all([
      rows(supabase.from('client_status_links').select(LINK_COLS).eq('client_id', id).order('created_at', { ascending: false }).limit(20)),
      rows(supabase.from('client_status_views').select('at').eq('client_id', id).order('at', { ascending: false }).limit(500)),
      rows(supabase.from('client_approvals').select(APPROVAL_COLS).eq('client_id', id).order('at', { ascending: false }).limit(30)),
      rows(supabase.from('client_surveys').select(SURVEY_COLS).eq('client_id', id).order('at', { ascending: true })),
      client.quote_id ? rows(supabase.from('client_consents').select(CONSENT_COLS).eq('quote_id', client.quote_id).eq('kind', 'whatsapp').limit(1)) : [],
    ]);
    const active = links.find((l) => !l.revoked_at && new Date(l.expires_at) > new Date()) || null;
    let token = null;
    if (active && manage) {
      const { data, error } = await supabase.rpc('status_link_token', { p_id: active.id });
      if (!error) token = data || null;
    }
    if (cache.id !== id) return;
    cache = { ...cache, loaded: true, loadedAt: Date.now(), error: null, links, views, approvals, surveys, consent: consent[0] || null, active, token, version: cache.version + 1 };
  } catch (err) {
    if (cache.id !== id) return;
    cache = { ...cache, loaded: true, loadedAt: Date.now(), error: missingTables(err) ? 'דף המצב עוד לא הוקם במסד הנתונים.' : 'לא הצלחנו לטעון את דף המצב של הלקוח.', version: cache.version + 1 };
  }
}

// Fills `slot` for the office (`scope` 'office'); `me` is the viewer's person (null: the owner).
// Re-rendering the card calls it again: nothing is rebuilt unless the data changed,
// so a form being filled here is never wiped by the card's refresh.
export function mountClientStatus(slot, { client, scope = 'office', me = null, toast = null }) {
  if (!slot) return;
  if (!client || scope !== 'office') { slot.replaceChildren(); shown = { id: null, version: -1 }; return; }
  const manage = me === null || MANAGERS.includes(me);
  const redraw = () => mountClientStatus(slot, { client, scope, me, toast });
  if (cache.id !== client.id) {
    cache = { id: client.id, loaded: false, version: 0, error: null };
    slot.replaceChildren();
    loadFor(client, { manage }).then(redraw);
    return;
  }
  // What the client did on the page since: fetched again with the card's refresh, at
  // most once a minute, and not while someone works in this block.
  const working = slot.contains(document.activeElement) || !!slot.querySelector('details[open]');
  if (cache.loaded && !cache.reloading && Date.now() - cache.loadedAt > 60e3 && !working) {
    cache.reloading = true;
    loadFor(client, { manage }).then(() => { cache.reloading = false; if (!slot.contains(document.activeElement)) redraw(); });
  }
  if (!cache.loaded || (shown.id === client.id && shown.version === cache.version && slot.firstChild)) return;
  shown = { id: client.id, version: cache.version };
  const reload = async () => { await loadFor(client, { manage }); redraw(); };
  slot.replaceChildren(block(client, { manage, toast, reload }));
}

function block(client, { manage, toast, reload }) {
  const c = cache;
  const head = h('div', { class: 'side-head' },
    h('h2', { id: 'st-h' }, 'דף המצב ללקוח'),
    h('p', { class: 'muted' }, 'קישור אישי שהלקוח פותח בטלפון: איפה אנחנו עומדים, התאריכים שהבטחנו, מה צריך ממנו, אישורים ושאלת משוב.'));
  // The look of the kit (docs/ops.md, section 53): the icon square, and the link's state as a pill.
  dressHead(head, 'phone', 'blue');
  if (!c.error) {
    const last = c.links?.[0];
    head.append(c.active ? pill('קישור פעיל', 'ok', { id: 'st-pill' }) : last ? pill(last.revoked_at ? 'הקישור בוטל' : 'תוקף הקישור הסתיים', 'warn', { id: 'st-pill' }) : pill('טרם פורסם', 'plain', { id: 'st-pill' }));
  }
  if (c.error) return h('section', { class: 'block cc-side st-block', id: 'status-block', 'aria-labelledby': 'st-h' }, head, h('p', { class: 'muted', role: 'status' }, c.error));
  return h('section', { class: 'block cc-side st-block', id: 'status-block', 'aria-labelledby': 'st-h' },
    head,
    linkPart(client, { manage, toast, reload }),
    consentPart(client, { toast, reload }),
    h('div', { class: 'k-cards-2' }, approvalsPart(), surveysPart(client, { toast, reload })));
}

// ── The link ──────────────────────────────
function linkPart(client, { manage, toast, reload }) {
  const c = cache;
  const views = c.active ? c.views.filter((v) => new Date(v.at) >= new Date(c.active.created_at)) : [];
  const create = async (again) => {
    if (again && !window.confirm('ליצור קישור חדש? הקישור הקודם יפסיק לעבוד, וצריך לשלוח ללקוח את החדש.')) return;
    const { error } = await supabase.rpc('status_link_create', { p_client: client.id });
    if (error) { toast?.(/not allowed/.test(error.message) ? 'רק עירית, ליאור והבעלים יוצרים קישור.' : /client not open/.test(error.message) ? 'ללקוח שהסתיים אין דף מצב.' : 'הקישור לא נוצר. נסו שוב.'); return; }
    toast?.('נוצר קישור חדש. אפשר להעתיק את ההודעה ולשלוח ללקוח.');
    await reload();
    document.getElementById('st-copy-msg')?.focus();
  };
  const revoke = async () => {
    if (!window.confirm('לבטל את הקישור? הלקוח לא יוכל לפתוח את הדף עד שיקבל קישור חדש.')) return;
    const { error } = await supabase.rpc('status_link_revoke', { p_id: c.active.id });
    if (error) { toast?.('הקישור לא בוטל. נסו שוב.'); return; }
    toast?.('הקישור בוטל.');
    await reload();
    document.getElementById('st-create')?.focus();
  };
  if (!c.active) {
    const last = c.links[0];
    return h('div', { class: 'st-link k-row' },
      iconSquare('link', 'navy'),
      h('div', { class: 'k-row-t' },
        h('p', { class: 'st-state' }, last ? (last.revoked_at ? `הקישור האחרון בוטל ב${when(last.revoked_at)}.` : `תוקף הקישור האחרון הסתיים ב${when(last.expires_at)}.`) : 'עוד לא נוצר קישור ללקוח.'),
        manage ? h('p', { class: 'k-hint' }, 'אחרי היצירה תוכלו להעתיק את הקישור ולשלוח אותו ללקוח.') : h('p', { class: 'muted' }, 'עירית, ליאור או הבעלים יוצרים את הקישור.')),
      manage ? h('button', { type: 'button', class: 'btn btn-sm k-btn-navy', id: 'st-create', onclick: () => create(false) }, icon('plus', { size: 16 }), 'יצירת קישור') : null);
  }
  const url = c.token ? statusUrl(location.href, c.token) : null;
  const msg = url ? statusLinkMessage(client, url) : null;
  return h('div', { class: 'st-link st-link-on' },
    h('p', { class: 'st-state' }, h('strong', {}, 'קישור פעיל'), ` עד ${dayText(new Date(c.active.expires_at), new Date())}`,
      ' · ', views.length ? `נפתח ${views.length === 1 ? 'פעם אחת' : `${views.length} פעמים`}, לאחרונה ${when(views[0].at)}` : 'עוד לא נפתח'),
    manage && url ? h('div', { class: 'st-acts' },
      h('button', { type: 'button', class: 'btn btn-sm k-btn-navy', id: 'st-copy-msg', onclick: () => copy(msg, toast) }, 'העתקת הודעה עם הקישור'),
      h('a', { class: 'btn btn-sm', id: 'st-wa', href: client.phone ? waLink(client.phone, msg) : groupLink(msg), target: '_blank', rel: 'noopener' }, 'שליחה ב־WhatsApp', h('span', { class: 'sr-only' }, ' (נפתח בחלון חדש)')),
      h('button', { type: 'button', class: 'btn-text', id: 'st-copy', onclick: () => copy(url, toast) }, 'העתקת הקישור'),
      h('a', { class: 'btn-text', href: url, target: '_blank', rel: 'noopener' }, 'תצוגה', h('span', { class: 'sr-only' }, ' (נפתח בחלון חדש; הצפייה שלך לא נרשמת)')),
      h('button', { type: 'button', class: 'btn-text', id: 'st-new', onclick: () => create(true) }, 'קישור חדש'),
      h('button', { type: 'button', class: 'btn-text st-danger', id: 'st-revoke', onclick: revoke }, 'ביטול הקישור')) : null,
    manage && msg ? h('details', { class: 'st-msg' }, h('summary', {}, 'ההודעה שתישלח'), h('p', { class: 'pp-msg' }, msg)) : null);
}

// ── WhatsApp updates (decision 26) ────────
function consentPart(client, { toast, reload }) {
  const k = cache.consent;
  let text;
  if (!client.quote_id) text = 'עדכוני WhatsApp: אין חתימה במערכת, ולכן אין הסכמה רשומה.';
  else if (!k) text = 'עדכוני WhatsApp: ההסכם נחתם לפני שהייתה תיבת ההסכמה. אין הסכמה רשומה.';
  else if (!k.given) text = `עדכוני WhatsApp: הלקוח לא סימן את התיבה בחתימה (${dayText(new Date(k.at))}).`;
  else if (k.revoked_at) text = `עדכוני WhatsApp: הלקוח הסכים בחתימה, וביקש להפסיק ב${when(k.revoked_at)} (${VIA[k.revoked_via] || k.revoked_via}).`;
  else text = `עדכוני WhatsApp: הלקוח הסכים בחתימה (${dayText(new Date(k.at))}).`;
  const canRevoke = k && k.given && !k.revoked_at;
  const sel = h('select', { class: 'input', id: 'st-via' }, Object.entries(VIA).map(([v, l]) => h('option', { value: v }, l)));
  const revoke = async () => {
    const { error } = await supabase.rpc('whatsapp_consent_revoke', { p_client: client.id, p_via: sel.value });
    if (error) { toast?.('לא נשמר. נסו שוב.'); return; }
    toast?.('נרשם: הלקוח ביקש להפסיק את עדכוני ה־WhatsApp.');
    await reload();
  };
  return h('div', { class: 'st-consent' },
    noticeAround(h('p', { class: `st-state${k?.given && !k.revoked_at ? ' is-ok' : ''}`, id: 'st-consent' }, text), k?.given && !k.revoked_at ? { kind: 'ok' } : { kind: 'warn', icon: k ? 'bell-off' : 'alert' }),
    canRevoke ? h('details', { class: 'st-revoke' }, h('summary', {}, 'הלקוח ביקש להפסיק'),
      h('div', { class: 'st-row' }, h('label', { for: 'st-via' }, 'איך'), sel, h('button', { type: 'button', class: 'btn btn-sm', onclick: revoke }, 'רישום'))) : null);
}

// ── Approvals and fix requests from the page ──
function approvalsPart() {
  const list = cache.approvals;
  return h('div', { class: 'st-approvals k-card' },
    cardHead({ icon: 'check-circle', tone: 'green', title: 'אישורים ובקשות תיקון מהדף', count: list.length }),
    list.length ? h('ol', { class: 'hlist st-list' }, list.map((a) => h('li', {},
      h('span', { class: a.decision === 'approve' ? 'st-ok' : 'st-fix' }, a.decision === 'approve' ? 'אישר/ה' : 'ביקש/ה תיקון'),
      ` · ${itemText(a.item, a.shoot_round)} · סבב ${a.round} · ${a.signer_name} · ${when(a.at)}`,
      a.note ? h('span', { class: 'st-note' }, a.note) : null,
      h('details', {}, h('summary', {}, 'הנוסח שהלקוח ראה'), h('p', { class: 'st-note' }, a.wording)))))
      : emptyRow({ text: 'עוד אין אישורים או בקשות.' }));
}

// ── Satisfaction (decision 28) ────────────
function surveysPart(client, { toast, reload }) {
  const list = cache.surveys;
  const answered = new Set(list.map((s) => s.kind));
  const open = Object.keys(SURVEY_TITLES).filter((k) => !answered.has(k));
  const kindSel = h('select', { class: 'input', id: 'st-sv-kind' }, open.map((k) => h('option', { value: k }, SURVEY_TITLES[k])));
  const score = h('input', { class: 'input', id: 'st-sv-score', type: 'number', inputmode: 'numeric', min: '0', max: '10', required: true });
  const who = h('input', { class: 'input', id: 'st-sv-name', autocomplete: 'off', value: client.name || '', maxlength: '120' });
  const err = h('p', { class: 'err', id: 'st-sv-err', role: 'alert', hidden: true });
  const record = async (e) => {
    e.preventDefault();
    const kind = kindSel.value;
    const n = Number(score.value);
    err.hidden = true;
    if (score.value === '' || !scaleOf(kind).includes(n)) { err.textContent = kind === 'nps' ? 'ציון מ־0 עד 10.' : 'ציון מ־1 עד 5.'; err.hidden = false; score.focus(); return; }
    if (!nameOk(who.value)) { err.textContent = 'מי ענה?'; err.hidden = false; who.focus(); return; }
    const { error } = await supabase.rpc('survey_record', { p_client: client.id, p_kind: kind, p_score: n, p_name: cleanName(who.value) });
    if (error) { err.textContent = /client_surveys_once|duplicate/.test(error.message) ? 'כבר נרשמה תשובה לשאלה הזו.' : 'לא נשמר. נסו שוב.'; err.hidden = false; return; }
    toast?.(lowScore(kind, n) ? 'נרשם. נפתחה לליאור משימה להתקשר ללקוח.' : 'נרשם. תודה!');
    await reload();
  };
  return h('div', { class: 'st-surveys k-card' },
    cardHead({ icon: 'smile', tone: 'orange', title: 'שביעות רצון', count: list.length }),
    list.length ? h('ul', { class: 'st-list' }, list.map((s) => h('li', {},
      h('strong', {}, `${SURVEY_TITLES[s.kind]}: ${s.score} מתוך ${s.kind === 'nps' ? 10 : 5}`),
      severeScore(s.kind, s.score) ? h('span', { class: 'st-low' }, ' · נמוך מאוד: ליאור והבעלים') : lowScore(s.kind, s.score) ? h('span', { class: 'st-low' }, ' · נמוך: ליאור מתקשר') : null,
      ` · ${s.respondent} · ${when(s.at)} · ${s.source === 'page' ? 'בדף המצב' : 'מהקבוצה'}`)))
      : emptyRow({ icon: 'chat', text: 'עוד אין תשובות.' }),
    open.length ? h('details', { class: 'st-record' }, h('summary', { class: 'k-with-ico' }, icon('chat', { size: 16 }), 'רישום תשובה שהלקוח נתן בקבוצה'),
      h('form', { class: 'st-form', novalidate: true, onsubmit: record },
        h('div', { class: 'field' }, h('label', { for: 'st-sv-kind' }, 'השאלה'), kindSel),
        h('div', { class: 'field' }, h('label', { for: 'st-sv-score' }, 'הציון'), score),
        h('div', { class: 'field' }, h('label', { for: 'st-sv-name' }, 'מי ענה'), who),
        err,
        h('button', { type: 'submit', class: 'btn btn-sm' }, 'רישום'))) : null);
}
