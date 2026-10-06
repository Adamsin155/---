// "כתיבת תסריטים" (scripts.html?id=<client>[&round=N]): the shoot day's scripts of
// one client, process 12. Lior and the owner, and whoever Lior granted the client to.
//   - the top: how many scripts the package needs (its video count; slot n is
//     "תסריט n"), the progress, and the client's focus points (12א and the Zoom's
//     "סיכום דגשים") next to the writing, with the form one tap away;
//   - each script: a title, the text (saved by itself as it is typed; a draft stays
//     on the phone until the database confirms, and is saved again when the network
//     is back), the inspiration links, and its status: טיוטה / מוכן / אושר;
//   - printing one script, or all of them;
//   - Lior and the owner: a read-only link for the influencers (and the client),
//     copied or sent in WhatsApp, revoked; access for another staff member; and when
//     every script is ready, marking process 12 in the protocol.
// The rules: app/scripts-logic.js; the data: app/scripts-data.js; the database:
// supabase/migrations/20261003120000_scripts.sql.
import { PEOPLE } from './protocol.js';
import { loadClient, loadChecks, setCheck, updateClient, loadDirectory, loadStaffPhones } from './protocol-data.js';
import { $, fill, h, toast, errorText, mountSession, viewerOf, directory, who, formatStamp, store } from './protocol-ui.js';
import { briefBlock } from './briefs.js';
import { loadBriefs } from './intake-data.js';
import { waLink, groupLink, dayText } from './messages-logic.js';
import {
  STATUS, STATUS_ORDER, MAX_SLOTS, MAX_LINKS, TITLE_MAX, BODY_MAX, videosOf, slotCount, slotsOf, hasText, scriptLabel,
  progressOf, progressText, parseLinks, linkName, p12Offer, draftKey, draftText, readDraft, draftWins, contentOf, sameContent,
  createSaver, saveStateText, shareUrl, shareMessage,
} from './scripts-logic.js';
import {
  loadScriptsClient, loadScripts, saveScript, loadGrants, setGrant, loadShare, createShare, revokeShare, missingSetup,
} from './scripts-data.js';

const params = new URLSearchParams(location.search);
const id = params.get('id');
let round = Math.max(1, Number(params.get('round')) || 1);
let info = null;        // public.scripts_client(): name, business, videos, rounds, manage
let card = null;        // the client row (managers: the office reads it), for its links
let checks = {};        // the protocol marks (managers)
let brief = null;       // the focus call of this round (content_briefs), when readable
let briefOk = true;
let slots = [];         // the scripts as on screen (local state)
let extra = 0;          // slots added now beyond the package
let share = null;       // { active, token, last }
let grants = [];
let phones = {};
let me = null;
let scope = 'own';
const savers = new Map();   // n -> the autosave queue
const states = new Map();   // n -> the saver's last state
const enc = encodeURIComponent;
const clean = (v) => String(v ?? '').trim();
const pre = () => (round > 1 ? `r${round}.` : '');
const manage = () => !!info?.manage;
const focusHref = () => `intake.html?id=${enc(id)}${round > 1 ? `&round=${round}` : ''}&from=scripts#focus`;
const slotOf = (n) => slots.find((s) => s.n === n);

// ── Loading ───────────────────────────────
async function load() {
  if (!id) { $('state').textContent = 'לא נבחר לקוח.'; $('app').hidden = true; return; }
  $('state').textContent = 'טוען…';
  try {
    info = await loadScriptsClient(id);
  } catch (err) {
    $('app').hidden = true;
    $('state').textContent = missingSetup(err) ? 'כתיבת התסריטים עוד לא הוקמה במסד הנתונים.' : errorText(err);
    return;
  }
  if (!info) { noAccess(); return; }
  if (!info.rounds.includes(round)) round = 1;
  let rows = [];
  try { rows = await loadScripts(id); } catch (err) { $('state').textContent = errorText(err); return; }
  const office = scope === 'office';
  const [c, ch, b, sh, gr, ph] = await Promise.all([
    manage() && office ? loadClient(id).catch(() => null) : null,
    manage() && office ? loadChecks(id).then((x) => x[id] || {}).catch(() => ({})) : {},
    loadBriefs(id).then((list) => { briefOk = true; return list; }).catch(() => { briefOk = false; return []; }),
    manage() ? loadShare(id).catch(() => null) : null,
    manage() ? loadGrants(id).catch(() => []) : [],
    manage() ? loadStaffPhones().catch(() => ({})) : {},
  ]);
  card = c;
  checks = ch;
  brief = (b || []).find((x) => x.round === round) || null;
  share = sh;
  grants = gr;
  phones = ph;
  $('state').textContent = '';
  document.title = `${info.name} · כתיבת תסריטים · astrateg`;
  if (manage() && office) { $('back').href = `client.html?id=${enc(id)}#p12`; $('back').textContent = `→ לכרטיס של ${info.name}`; }
  setRows(rows);
  renderAll();
}

function noAccess() {
  $('app').hidden = true;
  const st = $('state');
  fill(st, h('strong', {}, 'אין לך גישה לתסריטים של הלקוח הזה.'), ' ',
    h('span', {}, 'את התסריטים כותבים ליאור והבעלים, ומי שליאור פתח לו גישה ללקוח.'), ' ',
    h('a', { class: 'btn', href: 'clients.html#mine' }, '→ המשימות שלי'));
}

// The rows of this round as local slots, with the phone's drafts that were never saved.
function setRows(rows) {
  for (const s of savers.values()) s.flush();
  savers.clear();
  states.clear();
  const mine = rows.filter((r) => r.round === round);
  const count = slotCount(round === 1 ? videosOf(info) : null, mine, extra);
  slots = slotsOf(mine, count).map((s) => {
    const saved = contentOf(s);
    const draft = readDraft(store.get(draftKey(id, round, s.n)));
    if (draftWins(draft, s.version == null ? null : s)) return { ...s, ...contentOf(draft), saved, restored: draft.at };
    return { ...s, saved };
  });
}

// ── Frame ─────────────────────────────────
function renderAll() {
  renderHead();
  renderSide();
  renderMain();
  renderSync();
  // Restored drafts are saved again at once.
  for (const s of slots) if (s.restored) { saverOf(s).touch(); }
  const first = slots.filter((s) => s.restored).length;
  if (first) toast(`${first === 1 ? 'תסריט אחד שוחזר' : `${first} תסריטים שוחזרו`} מהטלפון ונשמרים עכשיו.`);
}

function renderHead() {
  const videos = round === 1 ? videosOf(info) : null;
  const p = progressOf(slots);
  fill($('sc-head'),
    h('div', { class: 'kicker' }, 'כתיבת תסריטים'),
    h('h1', {}, info.name),
    h('p', { class: 'sc-count', id: 'sc-count' },
      videos ? `${videos} תסריטים לפי החבילה (${videos} סרטונים)` : round > 1 ? 'סבב צילום נוסף: מוסיפים תסריט לכל סרטון שסוכם.' : 'בחבילה לא רשום מספר סרטונים. מוסיפים תסריט לכל סרטון.',
      slots.length > (videos || 0) && videos ? ` · ועוד ${slots.length - videos} מעבר לחבילה` : null),
    h('p', { class: 'sc-progress', id: 'sc-progress' }, progressText(p)),
    info.rounds.length ? h('label', { class: 'ik-round' }, h('span', {}, 'סבב צילום:'),
      h('select', { class: 'input', id: 'sc-round', onchange: (e) => changeRound(Number(e.currentTarget.value)) },
        h('option', { value: '1', selected: round === 1 }, 'הצילום הראשון'),
        ...info.rounds.map((n) => h('option', { value: String(n), selected: round === n }, `סבב ${n}`)))) : null,
    h('div', { class: 'sc-tools' },
      scope === 'office' ? h('a', { class: 'btn btn-sm', id: 'sc-focus-form', href: focusHref() }, 'סיכום דגשים לקוח') : null,
      h('button', { type: 'button', class: 'btn btn-sm', id: 'sc-print-all', onclick: () => printScripts(null) }, 'הדפסת כל התסריטים'),
      manage() ? h('a', { class: 'btn btn-sm', href: '#sc-share' }, 'קישור לשיתוף') : null,
      manage() ? h('a', { class: 'btn btn-sm btn-ghost', href: '#sc-access' }, 'גישה לעובדים') : null),
    offerBlock());
}
function changeRound(n) {
  if (anyDirty()) for (const s of savers.values()) s.flush();
  round = n;
  extra = 0;
  history.replaceState(null, '', `scripts.html?id=${enc(id)}${round > 1 ? `&round=${round}` : ''}`);
  load();
}

// ── The protocol: process 12 ──────────────
function offerBlock() {
  if (!manage() || scope !== 'office') return null;
  const approved = checks[`${pre()}p13.approved`]?.state === 'done';
  const offer = p12Offer({ slots, checks, round });
  const p = progressOf(slots);
  const parts = [];
  if (approved) parts.push(h('p', { class: 'ok-line', id: 'sc-approved' }, `הלקוח אישר את התסריטים (13)${p.allApproved ? '.' : '. תסריט שהיה "מוכן" סומן "אושר"; טיוטות נשארו טיוטות.'}`));
  if (offer) {
    parts.push(h('div', { class: 'sc-offer', id: 'sc-offer' },
      h('p', {}, h('strong', {}, `כל ${offer.count} התסריטים מוכנים.`), ' אפשר לסמן בפרוטוקול שהתסריטים נכתבו וממוספרים (12).'),
      offer.blockedBy.length
        ? h('p', { class: 'hint' }, 'קודם שיחת הדגשים (12א) צריכה להסתיים. ', h('a', { href: focusHref() }, 'לטופס שיחת הדגשים'))
        : h('button', { type: 'button', class: 'btn btn-primary', id: 'sc-mark12', onclick: () => markP12(offer.keys) }, 'סימון: התסריטים נכתבו (12)')));
  } else if (checks[`${pre()}p12.scripts`]?.state === 'done' && !approved) {
    parts.push(h('p', { class: 'muted', id: 'sc-marked' }, `סומן בפרוטוקול שהתסריטים נכתבו (${who(checks[`${pre()}p12.scripts`].by_email)}). הבא: לשתף את הקישור ולתאם זום (13).`));
  }
  return parts.length ? h('div', { class: 'sc-proto' }, ...parts) : null;
}
async function markP12(keys) {
  const btn = $('sc-mark12');
  if (btn) btn.disabled = true;
  try {
    for (const k of keys) checks[k] = await setCheck(id, k, 'done', null);
    toast('סומן בתהליך 12. הבא: קישור לשיתוף וזום לאישור (13).');
  } catch (err) { toast(`הסימון לא נשמר. ${errorText(err)}`); }
  renderHead();
  document.getElementById('sc-marked')?.setAttribute('tabindex', '-1');
  document.getElementById('sc-marked')?.focus();
}

// ── The side: focus points and the jump list ──
function renderSide() {
  const block = brief ? briefBlock(brief, { id: 'sc-brief', heading: `משיחת הדגשים ומהזום${round > 1 ? ` · סבב ${round}` : ''}` }) : null;
  fill($('sc-side'),
    h('details', { class: 'sc-panel sc-focus', id: 'sc-focus', open: matchMedia('(min-width: 1000px)').matches },
      h('summary', {}, 'דגשי הלקוח'),
      block || h('p', { class: 'muted' }, briefOk ? 'עוד לא נשמרו דגשים משיחת הדגשים או מהזום.' : 'הדגשים פתוחים למי שעובד על הלקוח.'),
      scope === 'office' ? h('a', { class: 'btn btn-sm', id: 'sc-focus-edit', href: focusHref() }, block ? 'עדכון סיכום הדגשים' : 'מילוי סיכום הדגשים') : null),
    h('details', { class: 'sc-panel sc-jump', id: 'sc-jump-box', open: matchMedia('(min-width: 1000px)').matches },
      h('summary', {}, 'מעבר לתסריט'),
      h('nav', { 'aria-label': 'מעבר לתסריט' }, h('ol', { id: 'sc-jump' }, ...slots.map((s) => jumpItem(s))))));
}
const jumpItem = (s) => h('li', {}, h('a', {
  href: `#s-${s.n}`, class: `sc-jumpl is-${s.status}${hasText(s) ? ' has-text' : ''}`, id: `j-${s.n}`,
  'aria-label': `${scriptLabel(s.n)}: ${STATUS[s.status]}${hasText(s) ? '' : ', ריק'}`,
}, String(s.n)));
function refreshJump(s) {
  const old = document.getElementById(`j-${s.n}`)?.parentElement;
  if (old) old.replaceWith(jumpItem(s));
}

// ── The scripts ───────────────────────────
function renderMain() {
  fill($('sc-main'),
    slots.length ? null : h('p', { class: 'ik-note' }, 'עוד אין תסריטים. מוסיפים את הראשון:'),
    h('ol', { class: 'sc-list', id: 'sc-list' }, ...slots.map((s) => h('li', {}, slotCard(s)))),
    slots.length < MAX_SLOTS ? h('button', { type: 'button', class: 'btn sc-add', id: 'sc-add', onclick: addSlot }, 'הוספת תסריט') : null,
    manage() ? sharePart() : null,
    manage() ? accessPart() : null);
}

function slotCard(s) {
  const n = s.n;
  const sid = `s-${n}`;
  const title = h('input', { class: 'input sc-title', id: `${sid}-title`, maxlength: String(TITLE_MAX), autocomplete: 'off', lang: 'he', dir: 'auto', enterkeyhint: 'next' });
  title.value = s.title;
  const body = h('textarea', { class: 'input sc-body', id: `${sid}-body`, rows: '6', lang: 'he', dir: 'auto', spellcheck: 'true', maxlength: String(BODY_MAX), 'aria-describedby': `${sid}-save` });
  body.value = s.body;
  title.addEventListener('input', () => { s.title = title.value; changed(s); });
  body.addEventListener('input', () => { grow(body); s.body = body.value; changed(s); });
  requestAnimationFrame(() => grow(body));
  const st = states.get(n) || (s.restored ? 'dirty' : s.version != null ? 'saved' : null);
  return h('article', { class: `sc-slot is-${s.status}`, id: sid, 'aria-labelledby': `${sid}-h`, tabindex: '-1' },
    h('header', { class: 'sc-slot-h' },
      h('h2', { id: `${sid}-h` }, scriptLabel(n)),
      h('span', { class: `sc-chip is-${s.status}`, id: `${sid}-chip` }, STATUS[s.status]),
      h('button', { type: 'button', class: 'btn btn-sm btn-ghost sc-print-one', id: `${sid}-print`, 'aria-label': `הדפסת ${scriptLabel(n)}`, onclick: () => printScripts([n]) }, 'הדפסה')),
    s.restored ? h('p', { class: 'ik-draft', role: 'status' }, `שוחזרה טיוטה מהטלפון מ־${formatStamp(s.restored)}.`) : null,
    h('div', { class: 'field sc-field' }, h('label', { for: `${sid}-title` }, 'כותרת'), title),
    h('div', { class: 'field sc-field' }, h('label', { for: `${sid}-body` }, 'התסריט'), body),
    h('p', { class: `sc-save is-${st || 'none'}`, id: `${sid}-save` }, saveLine(s, st)),
    h('div', { class: 'sc-conflict', id: `${sid}-conflict`, hidden: true, role: 'alert' }),
    linksPart(s),
    statusPart(s));
}
const grow = (el) => { el.style.height = 'auto'; el.style.height = `${Math.max(el.scrollHeight + 2, 140)}px`; };
const saveLine = (s, st) => (st ? saveStateText(st, st === 'saved' && s.at ? new Intl.DateTimeFormat('he-IL', { timeZone: 'Asia/Jerusalem', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(s.at)) : null) : 'עוד לא נכתב');

// ── Inspiration links ─────────────────────
function linksPart(s) {
  const sid = `s-${s.n}`;
  const input = h('input', { class: 'input', id: `${sid}-link`, type: 'url', inputmode: 'url', dir: 'ltr', autocomplete: 'off', placeholder: 'https://', 'aria-describedby': `${sid}-link-err` });
  const add = () => {
    const { links, bad } = parseLinks(input.value, s.links);
    const err = $(`${sid}-link-err`);
    if (bad.length || (!links.length && clean(input.value))) {
      err.textContent = 'זה לא נראה כמו קישור. מדביקים כתובת של סרטון, למשל https://www.instagram.com/reel/…';
      err.hidden = false; input.setAttribute('aria-invalid', 'true'); input.focus();
      return;
    }
    if (!links.length) { input.focus(); return; }
    if (s.links.length + links.length > MAX_LINKS) { err.textContent = `עד ${MAX_LINKS} קישורים לתסריט.`; err.hidden = false; return; }
    err.hidden = true; input.removeAttribute('aria-invalid');
    s.links = [...s.links, ...links];
    input.value = '';
    redrawLinks(s);
    changed(s, true);
    $(`${sid}-link`)?.focus();
  };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
  return h('div', { class: 'sc-links', id: `${sid}-links` },
    h('h3', { id: `${sid}-links-h` }, 'קישור להשראה'),
    linkList(s),
    h('div', { class: 'sc-link-add' },
      h('label', { class: 'sr-only', for: `${sid}-link` }, `קישור להשראה ל${scriptLabel(s.n)}`),
      input,
      h('button', { type: 'button', class: 'btn btn-sm', id: `${sid}-link-add`, onclick: add }, 'הוספה')),
    h('p', { class: 'err', id: `${sid}-link-err`, hidden: true }));
}
function linkList(s) {
  const sid = `s-${s.n}`;
  if (!s.links.length) return h('p', { class: 'muted sc-nolinks', id: `${sid}-linklist` }, 'אין עדיין. אפשר להדביק כמה קישורים בבת אחת.');
  return h('ul', { class: 'sc-linklist', id: `${sid}-linklist` }, ...s.links.map((url, i) => h('li', {},
    h('a', { href: url, target: '_blank', rel: 'noopener noreferrer', dir: 'ltr' }, linkName(url), h('span', { class: 'sr-only' }, ' (נפתח בחלון חדש)')),
    h('button', { type: 'button', class: 'btn-text sc-unlink', 'aria-label': `הסרת הקישור ${linkName(url)}`, onclick: () => {
      s.links = s.links.filter((_, j) => j !== i);
      redrawLinks(s);
      changed(s, true);
      $(`s-${s.n}-link`)?.focus();
    } }, 'הסרה'))));
}
const redrawLinks = (s) => $(`s-${s.n}-linklist`)?.replaceWith(linkList(s));

// ── Status ────────────────────────────────
function statusPart(s) {
  const name = `s-${s.n}-status`;
  return h('fieldset', { class: 'ik-seg sc-status' },
    h('legend', {}, 'מצב התסריט'),
    h('div', { class: 'ik-seg-opts' }, ...STATUS_ORDER.map((v) => h('label', { class: 'ik-opt' },
      h('input', {
        type: 'radio', name, value: v, id: `${name}-${v}`, checked: s.status === v,
        disabled: v === 'approved' && !manage() ? true : (s.status === 'approved' && !manage()),
        onchange: () => setStatus(s, v),
      }),
      h('span', {}, STATUS[v])))),
    !manage() ? h('p', { class: 'hint' }, '"אושר" מסמנים ליאור או הבעלים, או שהלקוח מאשר בדף המצב.') : null);
}
function setStatus(s, v) {
  s.status = v;
  const el = $(`s-${s.n}`);
  if (el) el.className = `sc-slot is-${v}`;
  const chip = $(`s-${s.n}-chip`);
  if (chip) { chip.className = `sc-chip is-${v}`; chip.textContent = STATUS[v]; }
  changed(s, true);
  refreshProgress();
}
function refreshProgress() {
  const p = $('sc-progress');
  if (p) p.textContent = progressText(progressOf(slots));
  // The protocol offer appears (or goes) with the statuses.
  const old = document.querySelector('.sc-proto');
  const next = offerBlock();
  if (old && next) old.replaceWith(next); else if (old) old.remove(); else if (next) $('sc-head').append(next);
}

// ── Saving ────────────────────────────────
// Every change: the draft on the phone at once, the database a moment after typing
// stops (`now`: a status or a link, saved right away).
const draftTimers = new Map();
function changed(s, now = false) {
  clearTimeout(draftTimers.get(s.n));
  draftTimers.set(s.n, setTimeout(() => store.set(draftKey(id, round, s.n), draftText(s)), 250));
  const saver = saverOf(s);
  saver.touch();
  if (now) saver.flush();
  refreshJump(s);
}
function saverOf(s) {
  if (savers.has(s.n)) return savers.get(s.n);
  const saver = createSaver({
    delay: 1200,
    onState: (st, err) => onState(s, st, err),
    write: async () => {
      const content = contentOf(s);
      const row = await saveScript(id, round, s.n, content, s.version, (cur) => sameContent(cur, content));
      s.version = row.version;
      s.at = row.at;
      s.saved = contentOf(row);
      // Nothing typed since: the phone's draft is no longer needed.
      if (sameContent(s, row)) { clearTimeout(draftTimers.get(s.n)); store.set(draftKey(id, round, s.n), ''); }
    },
  });
  savers.set(s.n, saver);
  return saver;
}
function onState(s, st, err) {
  states.set(s.n, st);
  const line = $(`s-${s.n}-save`);
  if (line) { line.className = `sc-save is-${st}`; line.textContent = saveLine(s, st); }
  const box = $(`s-${s.n}-conflict`);
  if (box && st !== 'conflict' && st !== 'error') { box.hidden = true; box.replaceChildren(); }
  if (st === 'conflict') showConflict(s, err.current);
  if (st === 'error' && box) {
    box.hidden = false;
    fill(box, h('p', {}, err?.refused ? 'אין לך הרשאה לשמור את התסריט הזה (ייתכן שהגישה הוסרה, או שרק ליאור מסמן "אושר"). מה שכתבת נשמר בטלפון.' : `לא נשמר. ${errorText(err)} מה שכתבת נשמר בטלפון.`),
      h('button', { type: 'button', class: 'btn btn-sm', onclick: () => saverOf(s).flush() }, 'לנסות שוב'));
  }
  renderSync();
}
// Another device saved this script since it was opened here: keep what is here, or
// take the saved one. Nothing is overwritten without asking.
function showConflict(s, current) {
  const box = $(`s-${s.n}-conflict`);
  if (!box) return;
  box.hidden = false;
  fill(box,
    h('p', {}, h('strong', {}, 'התסריט נשמר בינתיים ממקום אחר'), ` (${who(current.by_email)}, ${formatStamp(current.at)}). מה לשמור?`),
    h('details', {}, h('summary', {}, 'מה שנשמר שם'), h('p', { class: 'sc-theirs' }, [current.title, current.body].filter(Boolean).join('\n\n') || '(ריק)')),
    h('div', { class: 'ik-row' },
      h('button', { type: 'button', class: 'btn btn-sm btn-primary', id: `s-${s.n}-keep`, onclick: () => { s.version = current.version; saverOf(s).flush(); } }, 'לשמור את מה שכתוב כאן'),
      h('button', { type: 'button', class: 'btn btn-sm', id: `s-${s.n}-take`, onclick: () => takeSaved(s, current) }, 'לקחת את מה שנשמר שם')));
}
function takeSaved(s, current) {
  Object.assign(s, { ...contentOf(current), version: current.version, at: current.at, saved: contentOf(current), restored: null });
  store.set(draftKey(id, round, s.n), '');
  states.set(s.n, 'saved');
  savers.delete(s.n);
  $(`s-${s.n}`).parentElement.replaceChildren(slotCard(s));
  refreshJump(s);
  refreshProgress();
  renderSync();
  $(`s-${s.n}-body`)?.focus();
}
const anyDirty = () => [...savers.values()].some((x) => x.dirty);
// One line for the whole page: all saved, saving, or waiting for the network.
function renderSync() {
  const vals = [...states.values()];
  const off = vals.filter((x) => x === 'offline').length;
  const bad = vals.filter((x) => x === 'conflict' || x === 'error').length;
  const busy = vals.some((x) => x === 'saving' || x === 'dirty');
  const el = $('sc-sync');
  const text = bad ? `${bad === 1 ? 'תסריט אחד לא נשמר' : `${bad} תסריטים לא נשמרו`}: ההסבר מתחת לתסריט.`
    : off ? 'אין חיבור. מה שכתבת נשמר בטלפון, ויישמר לבד כשהחיבור יחזור.'
      : busy ? 'שומר…' : vals.length ? 'כל השינויים נשמרו.' : '';
  if (el.textContent !== text) el.textContent = text;
  el.className = `sc-sync${bad ? ' is-bad' : off ? ' is-off' : ''}`;
}
function addSlot() {
  extra += 1;
  const n = slots.length + 1;
  const s = { ...slotsOf([], n)[n - 1], saved: contentOf({}) };
  slots.push(s);
  $('sc-list').append(h('li', {}, slotCard(s)));
  $('sc-jump').append(jumpItem(s));
  renderHead();
  $(`s-${n}-title`).focus();
}
// Back online, leaving the page, or the phone switching apps: save now.
const flushAll = () => { for (const s of savers.values()) if (s.dirty) s.flush(); };
window.addEventListener('online', flushAll);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushAll(); });
window.addEventListener('beforeunload', (e) => { if (anyDirty()) { flushAll(); e.preventDefault(); e.returnValue = ''; } });

// ── Printing ──────────────────────────────
// A clean page: the client, the script's number and title, the text, the links.
function printScripts(ns) {
  const list = ns ? slots.filter((s) => ns.includes(s.n)) : slots.filter(hasText);
  if (!list.length) { toast('אין עדיין תסריט כתוב להדפסה.'); return; }
  fill($('sc-print'),
    h('header', { class: 'scp-head' }, h('p', { class: 'scp-client' }, info.business || info.name),
      h('p', { class: 'scp-sub' }, `${ns ? scriptLabel(list[0].n) : `תסריטים ליום הצילום · ${list.length}`}${round > 1 ? ` · סבב ${round}` : ''}`)),
    ...list.map((s) => h('section', { class: 'scp-script' },
      h('h2', {}, `${scriptLabel(s.n)}${clean(s.title) ? `: ${clean(s.title)}` : ''}`),
      h('div', { class: 'scp-body' }, s.body || ' '),
      s.links.length ? h('div', { class: 'scp-links' }, h('p', {}, 'קישור להשראה:'), h('ul', {}, ...s.links.map((l) => h('li', { dir: 'ltr' }, l)))) : null)));
  document.body.classList.add('is-printing');
  window.print();
}
// Ctrl+P without the buttons prints the page as it is.
window.addEventListener('afterprint', () => document.body.classList.remove('is-printing'));

// ── Lior: the share link ──────────────────
function sharePart() {
  const sh = share;
  const url = sh?.token ? shareUrl(location.href, sh.token) : null;
  const msg = url ? shareMessage(info, url) : null;
  const isClientLink = url && card?.links?.scripts === url;
  const body = [];
  if (!sh) body.push(h('p', { class: 'muted' }, 'הקישור לא נטען. רעננו את הדף.'));
  else if (!sh.active) {
    body.push(h('p', {}, sh.last ? (sh.last.revoked_at ? `הקישור האחרון בוטל ב${dayText(new Date(sh.last.revoked_at))}.` : 'תוקף הקישור האחרון הסתיים.') : 'עוד לא נוצר קישור.'),
      h('button', { type: 'button', class: 'btn btn-primary', id: 'sh-create', onclick: () => makeShare(false) }, 'יצירת קישור לשיתוף'));
  } else {
    body.push(h('p', {}, h('strong', {}, 'קישור פעיל'), ` עד ${dayText(new Date(sh.active.expires_at), new Date())}.`),
      url ? h('p', { class: 'sc-url', dir: 'ltr' }, h('a', { href: url, target: '_blank', rel: 'noopener', id: 'sh-open' }, url)) : null,
      url ? h('div', { class: 'ik-row' },
        h('button', { type: 'button', class: 'btn btn-sm', id: 'sh-copy', onclick: () => copy(url) }, 'העתקת הקישור'),
        h('a', { class: 'btn btn-sm', id: 'sh-wa', href: groupLink(msg), target: '_blank', rel: 'noopener' }, 'שליחה ב־WhatsApp', h('span', { class: 'sr-only' }, ' (נפתח בחלון חדש)')),
        h('button', { type: 'button', class: 'btn-text', id: 'sh-new', onclick: () => makeShare(true) }, 'קישור חדש'),
        h('button', { type: 'button', class: 'btn-text st-danger', id: 'sh-revoke', onclick: dropShare }, 'ביטול הקישור')) : null,
      url && round === 1 && card ? (isClientLink
        ? h('p', { class: 'ok-line', id: 'sh-is-client' }, 'זה קישור התסריטים של הלקוח: בכרטיס, ובדף המצב לאישור.')
        : h('div', { class: 'sc-asclient' },
          h('button', { type: 'button', class: 'btn btn-sm', id: 'sh-as-client', onclick: () => useForClient(url) }, 'להשתמש בו כקישור התסריטים של הלקוח'),
          h('p', { class: 'hint' }, 'הלקוח יראה אותו בדף המצב ויאשר שם את התסריטים. מסמן גם "מסודרים לפי סדר הצילום" (12).'))) : null);
  }
  return h('section', { class: 'sc-panel sc-share', id: 'sc-share', 'aria-labelledby': 'sh-h', tabindex: '-1' },
    h('h2', { id: 'sh-h' }, 'קישור לשיתוף'),
    h('p', { class: 'muted' }, 'דף לקריאה בלבד עם התסריטים וקישורי ההשראה, למשפיענים (ואם רוצים, ללקוח). בלי שום מידע פנימי. תסריט ריק לא מוצג.'),
    ...body);
}
async function copy(text) {
  try { await navigator.clipboard.writeText(text); toast('הועתק.'); } catch { toast('ההעתקה לא הצליחה. אפשר לסמן ולהעתיק ידנית.'); }
}
async function makeShare(again) {
  if (again && !confirm('ליצור קישור חדש? הקישור הקודם יפסיק לעבוד.')) return;
  try {
    await createShare(id);
    share = await loadShare(id);
    toast('נוצר קישור. אפשר להעתיק או לשלוח ב־WhatsApp.');
  } catch (err) { toast(/client not open/.test(err?.message) ? 'ללקוח שהסתיים אין קישור.' : `הקישור לא נוצר. ${errorText(err)}`); }
  redrawShare('sh-copy');
}
async function dropShare() {
  if (!confirm('לבטל את הקישור? מי שקיבל אותו לא יוכל לפתוח את התסריטים.')) return;
  try {
    await revokeShare(share.active.id);
    share = await loadShare(id);
    toast('הקישור בוטל.');
  } catch (err) { toast(`הקישור לא בוטל. ${errorText(err)}`); }
  redrawShare('sh-create');
}
async function useForClient(url) {
  try {
    card = await updateClient(id, { links: { ...(card.links || {}), scripts: url } });
    checks[`${pre()}p12.docs`] = await setCheck(id, `${pre()}p12.docs`, 'done', url);
    toast('נשמר כקישור התסריטים של הלקוח.');
  } catch (err) { toast(`לא נשמר. ${errorText(err)}`); }
  redrawShare('sh-copy');
  renderHead();
}
function redrawShare(focusId) {
  $('sc-share')?.replaceWith(sharePart());
  (document.getElementById(focusId) || $('sc-share'))?.focus();
}

// ── Lior: access for another staff member ──
function accessPart() {
  const people = [...new Set(Object.values(directory))].filter((p) => p !== 'lior' && PEOPLE[p] && !grants.some((g) => g.person === p));
  const sel = h('select', { class: 'input', id: 'ac-person' }, h('option', { value: '' }, 'בחירה…'), ...people.map((p) => h('option', { value: p }, PEOPLE[p].name)));
  const pageUrl = new URL(`scripts.html?id=${enc(id)}`, location.href).href;
  const inviteOf = (p) => `היי ${PEOPLE[p]?.name || ''}, פתחתי לך גישה לכתיבת התסריטים של ${info.name}:\n${pageUrl}`;
  return h('section', { class: 'sc-panel sc-access', id: 'sc-access', 'aria-labelledby': 'ac-h', tabindex: '-1' },
    h('h2', { id: 'ac-h' }, 'גישה לעובדים'),
    h('p', { class: 'muted' }, 'ליאור והבעלים כותבים תמיד. כאן פותחים לעובד נוסף את התסריטים של הלקוח הזה בלבד. "אושר" נשאר אצלכם.'),
    grants.length ? h('ul', { class: 'sc-grants' }, ...grants.map((g) => h('li', {},
      h('span', {}, PEOPLE[g.person]?.name || g.person),
      h('a', { class: 'btn btn-sm', href: phones[g.person] ? waLink(phones[g.person], inviteOf(g.person)) : groupLink(inviteOf(g.person)), target: '_blank', rel: 'noopener' }, 'שליחת הקישור בוואטסאפ', h('span', { class: 'sr-only' }, ' (נפתח בחלון חדש)')),
      h('button', { type: 'button', class: 'btn-text st-danger', id: `ac-rm-${g.person}`, onclick: () => grant(g.person, false) }, 'הסרת הגישה'))))
      : h('p', {}, 'אין גישה לעובדים נוספים.'),
    people.length ? h('div', { class: 'ik-row' },
      h('label', { for: 'ac-person' }, 'עובד/ת'), sel,
      h('button', { type: 'button', class: 'btn btn-sm', id: 'ac-add', onclick: () => sel.value && grant(sel.value, true) }, 'מתן גישה')) : null);
}
async function grant(person, on) {
  try {
    await setGrant(id, person, on);
    grants = await loadGrants(id);
    toast(on ? `ל${PEOPLE[person]?.name || person} יש עכשיו גישה. אפשר לשלוח לו/ה את הקישור.` : 'הגישה הוסרה.');
  } catch (err) { toast(`לא נשמר. ${errorText(err)}`); }
  $('sc-access')?.replaceWith(accessPart());
  $('sc-access')?.focus();
}

// ── Start ─────────────────────────────────
mountSession(async (staff) => {
  const v = await viewerOf(staff.email);
  me = v.me;
  scope = v.error ? 'own' : v.scope;
  Object.assign(directory, await loadDirectory());
  await load();
  if (location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView();
});
