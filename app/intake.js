// "אפיון ותוכן" (intake.html?id=<client>): the characterization and the content
// of one client, on the phone (docs/plan/system-plan.md, section 3: Ofir finishing
// a characterization, Lior's 12א, 12 and 13; decisions 12 and 14).
//   #end      "האפיון הסתיים": one tap with the 4 required short fields (the clocks
//             of Ilai, Ofir and Lior start at once; the access goes to the vault)
//   #form     the full form, within 60 minutes: 11 fields plus the logo link, the
//             brand colors and the materials; a draft stays on the phone meanwhile
//   #focus    Lior's focus call (12א): the 10 topics, saved for the editors
//   #scripts  the scripts link (12), the Zoom time, its recording and the client's
//             approval (13), which is never "not relevant"
// The logic is in characterization.js and briefs.js; the office writes, the database
// stamps who and when (supabase/migrations/20260930160000_intake.sql).
// Whoever makes graphics from the characterization and does not fill these forms
// (Ilai; Nirel on a client she works on: app/intake-ui.js readsChar) gets it here
// read-only, on one screen: what the meeting gave and the client's materials.
import { PEOPLE, NETWORKS, SHOOT_TYPES } from './protocol.js';
import { clientState, blockers, roundsOf, CHAR_ENDED } from './protocol-logic.js';
import {
  loadClient, loadChecks, loadTasks, setCheck, clearCheck, updateClient, addTask, loadDirectory,
  loadAccess, saveAccess, canUseVault,
} from './protocol-data.js';
import {
  $, fill, h, toast, errorText, mountSession, viewerOf, VIEWER_UNKNOWN, directory, who, formatStamp, formatWhen, store,
} from './protocol-ui.js';
import { checkMark } from './mark-guards.js';
import {
  ACCESS_STATUS, MAIN_NETWORKS, networkName, FORM_FIELDS, MATERIALS, MATERIAL_STATES, endedProblems, endedNote, endedChecks,
  endedClientFields, formProblems, isComplete, missingFields, filledCount, missingMaterials, formChecks, missingTask, blockingTask,
  MISSING_TITLE, BLOCKING_TITLE, DRAFT_KEY, readDraft, draftText, draftWins, validUrl,
} from './characterization.js';
import { FOCUS_TOPICS, MUST, MUST_NOT, briefChecks, emptyTopics, roundKey, NOT_RAISED, SUMMARY, BRIEF_KEYS } from './briefs.js';
import { loadCharacterization, saveCharacterization, loadBriefs, saveBrief, missingTable } from './intake-data.js';
// The client's logins form (6.10.2026): what the client already sent is not asked again.
import { loadAccessStatusForWork } from './office-data.js';
import { byClient, accessStatusLabel } from './access-logic.js';
import { googleCalendarUrl } from './calendar.js';
import { inputValueIL, fromInputIL } from './tz.js';
// The materials themselves (logo, photos, videos) go into the client's files from the phone.
import { mountClientFiles, fileCount } from './files-ui.js';
import { readsChar } from './intake-ui.js';

const params = new URLSearchParams(location.search);
const id = params.get('id');
const SECTIONS = [
  ['end', 'סיום אפיון'], ['form', 'טופס אפיון'], ['focus', 'דגשים לקוח'], ['scripts', 'תסריטים וזום'],
];
let client = null;
let checks = {};
let tasks = [];
let access = [];
let accessStatus = [];       // the status of each login (access_work_statuses): never a user name
let vaultOk = false;
let charRow = null;          // public.characterizations (null: not saved yet)
let charError = null;        // the table is missing, or could not be read
let briefs = [];             // public.content_briefs of this client
let me = null;
let myEmail = '';
let scope = 'office';
let section = 'end';
let round = Math.max(1, Number(params.get('round')) || 1); // a shoot round's focus call and scripts
let busy = false;
// What is being typed, kept across renders.
let endV = null;
let formV = null;
let formDraftAt = null;      // a draft restored from the phone (its time)
let briefV = null;
let briefDraftAt = null;
let formErrors = {};         // what the last save found wrong in the form
let scV = null;              // the scripts link, the Zoom time and its recording, as typed
let saveTimer = null;
let readMode = false;        // the read-only view (no tabs, nothing to save)

const clean = (v) => String(v ?? '').trim();
// The scripts page (scripts.html) is Lior's and the owner's (others by a grant there).
const writesScripts = () => me === null || me === 'lior';
const scriptsHref = () => `scripts.html?id=${encodeURIComponent(id)}${round > 1 ? `&round=${round}` : ''}`;
const fromScripts = params.get('from') === 'scripts';
const pre = () => (round > 1 ? `r${round}.` : '');
const key = (k) => `${pre()}${k}`;
const isDone = (k) => checks[k]?.state === 'done';
const stateNow = () => clientState(client, checks, new Date());
// A process of the chosen shoot round (the characterization's are the client's own).
const procState = (pid, base = false) => stateNow().states.find((s) => s.proc.id === (round > 1 && !base ? `r${round}-${pid}` : pid)) || null;
const briefRow = () => briefs.find((b) => b.round === round) || null;
// "עד מחר 12:00", or, once it passed, "באיחור: היעד היה אתמול".
const dueWords = (s) => (!s?.dueAt ? null : s.status === 'overdue' ? `באיחור: היעד היה ${formatWhen(s.dueAt)}` : `עד ${formatWhen(s.dueAt)}`);

// ── Loading ───────────────────────────────
async function load() {
  if (!id) { $('state').textContent = 'לא נבחר לקוח.'; return; }
  $('state').textContent = client ? '' : 'טוען…';
  try {
    const [c, ch, t] = await Promise.all([loadClient(id), loadChecks(id), loadTasks({ clientId: id })]);
    if (!c) { $('state').textContent = 'הלקוח לא נמצא, או שאין לך גישה אליו.'; $('app').hidden = true; return; }
    client = c;
    checks = ch[id] || {};
    tasks = t;
  } catch (err) {
    $('state').textContent = errorText(err);
    return;
  }
  vaultOk = await canUseVault(id).catch(() => false);
  [access, charRow, briefs, accessStatus] = await Promise.all([
    vaultOk ? loadAccess(id).catch(() => []) : [],
    loadCharacterization(id).then((r) => { charError = null; return r; }).catch((err) => { charError = err; return null; }),
    loadBriefs(id).catch(() => []),
    // What the vault already holds for each network, statuses only (no vault flag
    // needed): what the client filled in the logins form is not asked again.
    scope === 'office' ? loadAccessStatusForWork([id]).then((rows) => (Array.isArray(rows) ? rows : [])).catch(() => []) : [],
  ]);
  $('state').textContent = '';
  document.title = `${client.name} · אפיון ותוכן · astrateg`;
  $('back').href = fromScripts ? scriptsHref() : `client.html?id=${encodeURIComponent(id)}`;
  $('back').textContent = fromScripts ? `→ לכתיבת התסריטים של ${client.name}` : `→ לכרטיס של ${client.name}`;
  if (!roundsOf(client).some((r) => r.n === round)) round = 1;
  if (!formV) initForm();
  if (!briefV) initBrief();
  render();
}

// ── Frame ─────────────────────────────────
function render(focusId = null) {
  renderHead();
  renderTabs();
  const body = $('ik-body');
  const view = { end: renderEnd, form: renderForm, focus: renderFocus, scripts: renderScripts }[section];
  fill(body, view());
  if (focusId) document.getElementById(focusId)?.focus();
}

function renderHead() {
  const c = client;
  const charBy = PEOPLE[c.characterizer || 'ofir']?.name;
  fill($('ik-head'),
    h('div', { class: 'kicker' }, 'אפיון ותוכן'),
    h('h1', {}, c.name),
    h('p', { class: 'muted' }, [c.business, c.char_at ? `אפיון ${formatStamp(c.char_at)}${charBy ? ` · ${charBy}` : ''}` : null,
      c.shoot_type ? SHOOT_TYPES[c.shoot_type]?.name : null].filter(Boolean).join(' · ')),
    roundsOf(c).length && (section === 'focus' || section === 'scripts') ? h('label', { class: 'ik-round' }, h('span', {}, 'סבב צילום:'),
      h('select', { class: 'input', id: 'ik-round', onchange: (e) => { round = Number(e.currentTarget.value); briefV = null; initBrief(); render('ik-round'); } },
        h('option', { value: '1', selected: round === 1 }, 'הצילום הראשון'),
        ...roundsOf(c).map((r) => h('option', { value: String(r.n), selected: round === r.n }, `סבב ${r.n}`)))) : null);
}

function renderTabs() {
  fill($('ik-tabs'), h('ul', {}, ...SECTIONS.map(([k, label]) => h('li', {},
    h('a', { href: `#${k}`, class: `ik-tab${k === section ? ' is-on' : ''}`, 'aria-current': k === section ? 'page' : null, id: `tab-${k}` }, label)))));
}

function setSection(k, focusId = null) {
  if (!SECTIONS.some(([x]) => x === k)) k = 'end';
  section = k;
  if (location.hash !== `#${k}`) history.replaceState(null, '', `#${k}`);
  render(focusId);
  if (!focusId) window.scrollTo({ top: 0 });
}
window.addEventListener('hashchange', () => { if (!readMode) setSection(location.hash.slice(1) || 'end', `tab-${location.hash.slice(1) || 'end'}`); });

// ── Small builders ────────────────────────
function field({ fid, label, hint = null, error = null, control, cls = '' }) {
  const hintId = hint ? `${fid}-hint` : null;
  const errId = `${fid}-err`;
  control.setAttribute('id', fid);
  if (error) control.setAttribute('aria-invalid', 'true'); else control.removeAttribute('aria-invalid');
  const describedBy = [hintId, error ? errId : null].filter(Boolean).join(' ');
  if (describedBy) control.setAttribute('aria-describedby', describedBy);
  return h('div', { class: `field ik-field ${cls}`.trim() },
    h('label', { for: fid }, label),
    control,
    hint ? h('p', { class: 'hint', id: hintId }, hint) : null,
    h('p', { class: 'err', id: errId, hidden: !error }, error || ''));
}
// Textareas grow with what is typed (or dictated), so nothing hides behind a scrollbar.
const grow = (el) => { el.style.height = 'auto'; el.style.height = `${el.scrollHeight + 2}px`; };
function textArea(value, onInput, rows = 3) {
  const el = h('textarea', { class: 'input ik-text', rows: String(rows), lang: 'he', dir: 'auto', spellcheck: 'true', autocomplete: 'off', maxlength: '3000' });
  el.value = value || '';
  el.addEventListener('input', () => { grow(el); onInput(el.value); });
  requestAnimationFrame(() => grow(el));
  return el;
}
function textInput(value, onInput, attrs = {}) {
  const el = h('input', { class: 'input', autocomplete: 'off', ...attrs });
  el.value = value || '';
  el.addEventListener('input', () => onInput(el.value));
  return el;
}
function radios(name, options, value, onChange, legend, { error = null, describe = null } = {}) {
  const lid = `${name}-legend`;
  return h('fieldset', { class: `ik-seg${error ? ' is-invalid' : ''}`, 'aria-describedby': [describe, error ? `${name}-err` : null].filter(Boolean).join(' ') || null },
    h('legend', { id: lid }, legend),
    h('div', { class: 'ik-seg-opts' }, ...options.map(([v, label]) => h('label', { class: 'ik-opt' },
      h('input', { type: 'radio', name, value: v, checked: value === v, id: `${name}-${v || 'none'}`, onchange: () => onChange(v) }),
      h('span', {}, label)))),
    h('p', { class: 'err', id: `${name}-err`, hidden: !error }, error || ''));
}
async function saveChecks(list) {
  for (const w of list) {
    checks[w.key] = await setCheck(id, w.key, w.state, w.note ?? null);
  }
}
function showProblems(problems, order, prefix) {
  for (const k of order) {
    const el = document.getElementById(`${prefix}${k}-err`);
    if (el) { el.textContent = problems[k] || ''; el.hidden = !problems[k]; }
    const ctl = document.getElementById(`${prefix}${k}`);
    if (ctl && ctl.tagName !== 'FIELDSET') { if (problems[k]) ctl.setAttribute('aria-invalid', 'true'); else ctl.removeAttribute('aria-invalid'); }
  }
  const first = order.find((k) => problems[k]);
  if (first) (document.getElementById(`${prefix}${first}`) || document.querySelector(`[name="${prefix}${first}"]`))?.focus();
}

// ── #end: "האפיון הסתיים" ────────────────────
function initEnd() {
  const inVault = new Map(access.map((a) => [a.network, a]));
  // The status each network has now ('other' rows are platforms by name: not here).
  const known = new Map(accessStatus.filter((a) => a.network !== 'other').map((a) => [a.network, a]));
  const nets = [...new Set([...MAIN_NETWORKS, ...access.map((a) => a.network), ...known.keys()])].filter((n) => n !== 'other' || inVault.has(n));
  endV = {
    address: client.address || charRow?.fields?.address || '',
    phone: charRow?.fields?.phone || '',
    has_logo: client.has_logo === true || client.has_logo === false ? client.has_logo : null,
    // `fromClient`: the status the client's own form gave this network, still as the
    // client left it. Such a network is shown as received and asked only on "לשנות".
    nets: Object.fromEntries(nets.map((n) => [n, {
      status: '', username: '', password: '', existing: inVault.get(n) || null,
      known: known.get(n)?.status || null, fromClient: byClient(known.get(n)) ? known.get(n).status : null, open: false,
    }])),
  };
}
const endValue = () => ({
  address: endV.address, phone: endV.phone, has_logo: endV.has_logo,
  networks: Object.entries(endV.nets).map(([network, n]) => ({ network, status: n.status || null, username: n.username, password: n.password, existing: n.existing, fromClient: n.fromClient })),
});

function renderEnd() {
  const ended = checks[CHAR_ENDED];
  if (ended?.state === 'done') {
    const p4 = procState('p04', true);
    const mins = (Date.now() - new Date(ended.at)) / 6e4;
    return h('section', { class: 'ik-card ik-done', 'aria-labelledby': 'end-h' },
      h('h2', { id: 'end-h', tabindex: '-1' }, 'האפיון הסתיים'),
      h('p', {}, `סומן ${formatStamp(ended.at)} · ${who(ended.by_email)}`),
      h('p', {}, 'השעונים התחילו: עילאי (גישות, 9 גרפיקות וגאנט), אופיר (Highlights) וליאור (Meta).'),
      ended.note ? h('p', { class: 'muted' }, ended.note.replace(/^האפיון הסתיים · /, '')) : null,
      p4?.complete ? h('p', { class: 'ok-line' }, 'טופס האפיון המלא נשמר.')
        : h('a', { class: 'btn btn-primary ik-big', href: '#form', id: 'to-form' }, `לטופס המלא${p4?.dueAt ? ` · ${dueWords(p4)}` : ''}`),
      mins < 10 && !p4?.complete ? h('button', { type: 'button', class: 'btn-text', id: 'end-undo', onclick: undoEnded }, 'סימנתי בטעות: ביטול') : null);
  }
  if (!endV) initEnd();
  const problems = endV.problems || {};
  const netRow = (n) => {
    const v = endV.nets[n];
    const name = `end-net-${n}`;
    const showLogin = vaultOk && (v.status === 'ok' || v.status === 'broken');
    // The client already filled this network in the logins form: its status only
    // (never the login), and nothing to ask unless Ofir chooses to change it.
    if (v.fromClient && !v.open) {
      return h('div', { class: 'ik-net ik-net-got', id: `${name}-got` },
        h('p', { class: 'ik-got' }, h('strong', {}, networkName(n)), h('span', { class: 'tag' }, `הלקוח כבר מילא: ${accessStatusLabel(v.fromClient)}`)),
        h('button', { type: 'button', class: 'btn-text', id: `${name}-change`, onclick: () => { v.open = true; renderEndKeep(`${name}-none`); } },
          'לשנות', h('span', { class: 'sr-only' }, ` את ${networkName(n)}`)));
    }
    return h('div', { class: 'ik-net' },
      radios(name, [['', v.fromClient ? 'בלי שינוי' : 'לא נבדק'], ...ACCESS_STATUS], v.status || '', (s) => { v.status = s; renderEndKeep(`${name}-${s || 'none'}`); },
        [networkName(n), v.fromClient ? h('span', { class: 'tag' }, `מהלקוח: ${accessStatusLabel(v.fromClient)}`)
          : v.existing || v.known ? h('span', { class: 'tag' }, v.known ? `כבר בכספת: ${accessStatusLabel(v.known)}` : 'כבר בכספת') : null]),
      showLogin ? h('div', { class: 'ik-login' },
        field({ fid: `${name}-user`, label: 'שם משתמש', control: textInput(v.username || v.existing?.username || '', (x) => { v.username = x; }, { dir: 'ltr', autocapitalize: 'off', spellcheck: 'false' }) }),
        field({ fid: `${name}-pass`, label: v.existing?.has_secret ? 'סיסמה חדשה (לא חובה)' : 'סיסמה', control: textInput(v.password, (x) => { v.password = x; }, { type: 'password', dir: 'ltr', autocomplete: 'new-password' }) })) : null);
  };
  const others = NETWORKS.map(([k]) => k).filter((k) => !endV.nets[k]);
  return h('form', { class: 'ik-card', id: 'end-form', novalidate: true, 'aria-labelledby': 'end-h', onsubmit: (e) => { e.preventDefault(); submitEnd(); } },
    h('h2', { id: 'end-h' }, 'האפיון הסתיים'),
    h('p', { class: 'muted' }, 'ארבעה פרטים קצרים, ומיד מתחילים השעונים של עילאי, אופיר וליאור. את שאר הטופס ממלאים עד שעה אחרי זה.'),
    field({ fid: 'end-address', label: 'כתובת העסק', error: problems.address, control: textInput(endV.address, (x) => { endV.address = x; }, { enterkeyhint: 'next' }) }),
    field({ fid: 'end-phone', label: 'טלפון העסק', hint: 'המספר שיופיע בסגיר של הסרטונים. לא הטלפון הפרטי של הלקוח.', error: problems.phone,
      control: textInput(endV.phone, (x) => { endV.phone = x; }, { type: 'tel', inputmode: 'tel', dir: 'ltr', enterkeyhint: 'next' }) }),
    radios('end-has_logo', [['yes', 'יש לוגו'], ['no', 'אין לוגו (עילאי מכין)']], endV.has_logo === true ? 'yes' : endV.has_logo === false ? 'no' : null,
      (v) => { endV.has_logo = v === 'yes'; }, 'יש ללקוח לוגו?', { error: problems.has_logo }),
    h('fieldset', { class: `ik-nets${problems.networks ? ' is-invalid' : ''}`, 'aria-describedby': 'end-networks-hint end-networks-err' },
      h('legend', { id: 'end-networks' }, 'גישה לכל רשת'),
      h('p', { class: 'hint', id: 'end-networks-hint' }, vaultOk
        ? 'כל רשת עם הסטטוס שלה. הגישות נכנסות ישר לכספת, מוצפנות.'
        : 'אין לך הרשאה לכספת: הסטטוסים נשמרים, ועירית מכניסה את הגישות עצמן.'),
      Object.values(endV.nets).some((v) => v.fromClient) ? h('p', { class: 'hint', id: 'end-networks-client' },
        'מה שהלקוח כבר מילא בטופס פרטי הכניסה מסומן כאן, ואין צורך לבקש אותו שוב. משלימים רק את מה שחסר.') : null,
      ...Object.keys(endV.nets).map(netRow),
      others.length ? h('label', { class: 'ik-more' }, h('span', {}, 'עוד רשת:'),
        h('select', { class: 'input', id: 'end-more', onchange: (e) => { const k = e.currentTarget.value; if (!k) return; endV.nets[k] = { status: '', username: '', password: '', existing: null }; renderEndKeep(`end-net-${k}-none`); } },
          h('option', { value: '' }, 'בחירה…'), ...others.map((k) => h('option', { value: k }, networkName(k))))) : null,
      h('p', { class: 'err', id: 'end-networks-err', hidden: !problems.networks }, problems.networks || '')),
    h('div', { class: 'ik-actions' },
      h('button', { type: 'submit', class: 'btn btn-primary ik-big', id: 'end-submit', disabled: busy }, busy ? 'שומר…' : 'האפיון הסתיים')));
}
function renderEndKeep(focusId) { render(focusId); }

async function submitEnd() {
  if (busy) return;
  const v = endValue();
  const problems = endedProblems(v);
  endV.problems = problems;
  if (Object.keys(problems).length) {
    render();
    const first = ['address', 'phone', 'has_logo', 'networks'].find((k) => problems[k]);
    const target = first === 'has_logo' ? document.querySelector('input[name="end-has_logo"]') : first === 'networks' ? document.querySelector('.ik-net input') : $(`end-${first}`);
    target?.focus();
    toast('חסרים פרטים. הם מסומנים בטופס.');
    return;
  }
  busy = true;
  render();
  const failed = [];
  // 1. The mark itself: the clocks start now.
  try {
    checks[CHAR_ENDED] = await setCheck(id, CHAR_ENDED, 'done', endedNote(v));
  } catch (err) {
    busy = false;
    render();
    toast(`לא נשמר. ${errorText(err)}`);
    return;
  }
  // 2. The client's address and logo; 3. the characterization's first fields.
  try { client = await updateClient(id, endedClientFields(v)); } catch { failed.push('הכתובת והלוגו בכרטיס'); }
  try {
    charRow = await saveCharacterization(id, { ...(charRow?.fields || {}), address: clean(v.address), phone: clean(v.phone), has_logo: v.has_logo,
      networks: v.networks.filter((n) => n.status).map(({ network, status }) => ({ network, status })) }, !!charRow?.completed_at);
  } catch (err) { if (!missingTable(err)) failed.push('פרטי האפיון'); }
  // 4. The vault, each network with its own status.
  let inVault = vaultOk;
  if (vaultOk) {
    for (const n of v.networks.filter((x) => x.status)) {
      const ex = n.existing;
      try {
        await saveAccess(id, { id: ex?.id || null, network: n.network, label: ex?.label || null, username: clean(n.username) || ex?.username || null, password: n.password || null, status: n.status, note: ex?.note || null });
      } catch { inVault = false; failed.push(`הגישה ל־${networkName(n.network)}`); }
    }
    access = await loadAccess(id).catch(() => access);
  }
  // 5. Process 5: the access was received (and is in the vault); no logo.
  try { await saveChecks(endedChecks(v, { inVault }).filter((w) => !checks[w.key])); } catch { failed.push('הסימון בתהליך 5'); }
  for (const n of Object.values(endV.nets)) n.password = '';
  busy = false;
  formV = null;
  initForm();
  if (failed.length) toast(`האפיון סומן והשעונים התחילו, אבל לא נשמרו: ${failed.join(', ')}. לנסות שוב מהכרטיס.`);
  else toast('האפיון הסתיים. השעונים של עילאי, אופיר וליאור התחילו.');
  setSection('form', firstEmptyId());
}

async function undoEnded() {
  if (!confirm('לבטל את הסימון "האפיון הסתיים"? השעונים של עילאי, אופיר וליאור ייעצרו.')) return;
  try {
    await clearCheck(id, CHAR_ENDED);
    delete checks[CHAR_ENDED];
    endV = null;
    render('end-address');
    toast('הסימון בוטל.');
  } catch (err) { toast(errorText(err)); }
}

// ── #form: the full characterization ─────
function initForm() {
  const saved = charRow?.fields || {};
  const raw = store.get(DRAFT_KEY(id));
  const draft = readDraft(raw);
  formV = { materials: {}, ...saved, materials: { ...(saved.materials || {}) } };
  formDraftAt = null;
  if (draftWins(draft, charRow)) {
    formV = { ...formV, ...draft.fields, materials: { ...formV.materials, ...(draft.fields.materials || {}) } };
    formDraftAt = draft.at;
  }
  if (!clean(formV.address) && client.address) formV.address = client.address;
}
function writeDraft() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    store.set(DRAFT_KEY(id), draftText(formV));
    const s = document.getElementById('form-draft');
    if (s) s.textContent = `טיוטה נשמרה בטלפון · ${formatStamp(new Date())}`;
  }, 400);
}
const firstEmptyId = () => { const m = missingFields(formV || {})[0]; return m ? `form-${m.key}` : 'form-logo_url'; };
function progressText() {
  const n = filledCount(formV);
  return n === FORM_FIELDS.length ? 'כל 11 השדות מולאו.' : `מולאו ${n} מתוך ${FORM_FIELDS.length} שדות.`;
}
// The client's materials, uploaded from the phone at the meeting (the camera roll or
// the camera) into the client's files. A photo or a video marks that material as
// received in the form (saved with the form, as a tap on "התקבל" would be).
function filesSlot() {
  const slot = h('div', { class: 'ik-files' });
  mountClientFiles(slot, {
    client, me, myEmail, toast, only: 'materials', compact: true,
    onUploaded: (kind) => {
      const mat = kind === 'image' ? 'photos' : kind === 'video_existing' ? 'videos' : null;
      if (!mat || formV.materials?.[mat] === 'got') return;
      formV.materials = { ...formV.materials, [mat]: 'got' };
      writeDraft();
      render();
    },
  });
  return slot;
}

function renderForm() {
  const ended = isDone(CHAR_ENDED);
  const p4 = procState('p04', true);
  const problems = formErrors;
  const onField = (k) => (x) => {
    formV[k] = x;
    writeDraft();
    const p = document.getElementById('form-progress');
    if (p && p.textContent !== progressText()) p.textContent = progressText(); // announced only when it changes
    const btn = document.getElementById('form-save');
    if (btn && !busy) btn.textContent = saveLabel();
  };
  const hasLogo = client.has_logo !== false;
  return h('form', { class: 'ik-card', id: 'form-form', novalidate: true, 'aria-labelledby': 'form-h', onsubmit: (e) => { e.preventDefault(); submitForm(); } },
    h('h2', { id: 'form-h' }, 'טופס האפיון'),
    ended ? null : h('p', { class: 'ik-note' }, 'עוד לא סומן "האפיון הסתיים". ', h('a', { href: '#end' }, 'קודם ארבעת הפרטים הקצרים'), ', כדי שהשעונים של כולם יתחילו.'),
    h('p', { class: 'muted' }, p4?.complete ? `נשמר במלואו${charRow?.completed_at ? ` ${formatStamp(charRow.completed_at)}` : ''}. אפשר לעדכן.`
      : `${p4?.dueAt && ended ? `${dueWords(p4)}. ` : ''}אפשר להקליד בקול: במקלדת של הטלפון לוחצים על המיקרופון.`),
    formDraftAt ? h('div', { class: 'ik-draft', role: 'status' },
      h('span', {}, `שוחזרה טיוטה מהטלפון מ־${formatStamp(formDraftAt)} שעוד לא נשמרה.`),
      h('button', { type: 'button', class: 'btn-text', id: 'draft-drop', onclick: dropDraft }, 'לבטל את הטיוטה')) : null,
    h('p', { class: 'ik-progress', id: 'form-progress', 'aria-live': 'polite' }, progressText()),
    ...FORM_FIELDS.map((f) => field({
      fid: `form-${f.key}`, label: f.label, hint: f.hint || null, error: problems[f.key],
      control: f.short ? textInput(formV[f.key], onField(f.key), f.tel ? { type: 'tel', inputmode: 'tel', dir: 'ltr' } : {}) : textArea(formV[f.key], onField(f.key)),
    })),
    h('fieldset', { class: 'ik-group' },
      h('legend', {}, 'מיתוג וחומרים'),
      hasLogo ? field({ fid: 'form-logo_url', label: 'קישור ללוגו', hint: 'קישור לקובץ, בלי סיסמה בקישור. אפשר במקום זה להעלות את הקובץ עצמו למטה.', error: problems.logo_url,
        control: textInput(formV.logo_url, onField('logo_url'), { type: 'url', inputmode: 'url', dir: 'ltr' }) }) : h('p', { class: 'muted' }, 'אין ללקוח לוגו: עילאי מכין לוגו חדש.'),
      field({ fid: 'form-colors', label: 'צבעי המותג', control: textInput(formV.colors, onField('colors')) }),
      ...MATERIALS.map((m) => radios(`form-mat-${m.key}`, MATERIAL_STATES, formV.materials?.[m.key] || null,
        (v) => { formV.materials = { ...formV.materials, [m.key]: v }; writeDraft(); }, m.label)),
      filesSlot()),
    h('fieldset', { class: 'ik-group' },
      h('legend', {}, 'משהו חסר שחוסם עבודה היום?'),
      h('label', { class: 'ik-check' },
        h('input', { type: 'checkbox', id: 'form-blocking', checked: !!formV.blocking, onchange: (e) => { formV.blocking = e.currentTarget.checked; writeDraft(); render('form-blocking'); } }),
        h('span', {}, 'כן, חסר מידע או חומר שבלעדיו אי אפשר לעבוד היום (ליאור יקבל הודעה מיד)')),
      formV.blocking ? field({ fid: 'form-blocking_what', label: 'מה חסר ולמי זה חוסם', control: textInput(formV.blocking_what, onField('blocking_what')) }) : null),
    h('div', { class: 'ik-actions ik-sticky' },
      h('span', { class: 'hint', id: 'form-draft', 'aria-live': 'off' }),
      h('button', { type: 'submit', class: 'btn btn-primary ik-big', id: 'form-save', disabled: busy }, busy ? 'שומר…' : saveLabel())));
}
function saveLabel() {
  const left = FORM_FIELDS.length - filledCount(formV);
  return left ? `שמירה (חסרים ${left} שדות)` : 'שמירת טופס האפיון';
}
function dropDraft() {
  store.set(DRAFT_KEY(id), '');
  initForm();
  render('form-h');
  toast('הטיוטה בוטלה. מוצג מה שנשמר.');
}

async function submitForm() {
  if (busy) return;
  const f = { ...formV };
  const problems = formProblems(f);
  formErrors = problems;
  if (Object.keys(problems).length) { render(); showProblems(problems, ['phone', 'logo_url'], 'form-'); return; }
  const complete = isComplete(f);
  busy = true;
  render();
  try {
    charRow = await saveCharacterization(id, f, complete);
  } catch (err) {
    busy = false;
    render();
    toast(missingTable(err) ? 'טבלת האפיון עוד לא הוקמה במסד הנתונים. הטיוטה נשמרת בטלפון.' : `לא נשמר. ${errorText(err)} הטיוטה נשמרת בטלפון.`);
    return;
  }
  const notes = [];
  // A logo uploaded to the client's files counts as received, like a link to it.
  const logoFile = client.has_logo !== false && fileCount(id, 'logo') > 0;
  const want = formChecks(f, checks, { hasLogo: client.has_logo });
  if (logoFile && !want.some((w) => w.key === 'p05.logo') && !['done', 'na'].includes(checks['p05.logo']?.state)) want.push({ key: 'p05.logo', state: 'done', note: null });
  try { await saveChecks(want); } catch (err) { notes.push(`הסימונים בפרוטוקול לא נשמרו (${errorText(err)})`); }
  // Missing material: one task for Irit; blocking today's work: Lior at once.
  const open = (prefix) => tasks.some((t) => !t.done_at && t.title.startsWith(prefix));
  const missing = missingMaterials(f, client.has_logo).filter((m) => !(logoFile && m === 'לוגו'));
  try {
    if (missing.length && !open(MISSING_TITLE)) { tasks.push(await addTask(missingTask(client, missing))); notes.push('נפתחה משימה לעירית להשלים מהלקוח'); }
    if (f.blocking && !open(BLOCKING_TITLE)) { tasks.push(await addTask(blockingTask(client, f.blocking_what, missing))); notes.push('ליאור קיבל הודעה שחסר מידע שחוסם עבודה היום'); }
  } catch (err) { notes.push(`המשימה לא נפתחה (${errorText(err)})`); }
  store.set(DRAFT_KEY(id), '');
  formDraftAt = null;
  busy = false;
  render();
  const head = complete ? 'טופס האפיון נשמר במלואו. המעקב של עירית נסגר.' : `נשמר. חסרים עוד ${missingFields(f).length} שדות.`;
  toast([head, ...notes].join(' · '));
  document.getElementById(complete ? 'form-h' : firstEmptyId())?.focus();
}

// ── #focus: the focus call (12א) ──────────
function initBrief() {
  const saved = briefRow()?.fields || {};
  const draft = readDraft(store.get(`brief.${id}.${round}`));
  briefV = { ...saved };
  briefDraftAt = null;
  if (draftWins(draft, briefRow())) { briefV = { ...briefV, ...draft.fields }; briefDraftAt = draft.at; }
}
function renderFocus() {
  const s = procState('p12a');
  const cf = charRow?.fields || {};
  const onTopic = (k) => (x) => {
    briefV[k] = x;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => store.set(`brief.${id}.${round}`, draftText(briefV)), 400);
  };
  const order = [...FOCUS_TOPICS.filter(([k]) => k === MUST || k === MUST_NOT), ...FOCUS_TOPICS.filter(([k]) => k !== MUST && k !== MUST_NOT)];
  const context = FORM_FIELDS.filter((f) => !f.short && clean(cf[f.key]));
  const called = isDone(key('p12a.call'));
  return h('form', { class: 'ik-card', id: 'focus-form', novalidate: true, 'aria-labelledby': 'focus-h', onsubmit: (e) => { e.preventDefault(); submitBrief(false); } },
    h('h2', { id: 'focus-h' }, `סיכום דגשים לקוח · שיחת דגשים (12א)${round > 1 ? ` · סבב ${round}` : ''}`),
    h('p', { class: 'muted' }, [s?.complete ? null : dueWords(s), called ? 'השיחה סומנה כהסתיימה.' : null,
      'התשובות נשמרות בכרטיס הלקוח. העורכים, אופיר (בבקרה) וניראל רואים אותן.'].filter(Boolean).join(' · ')),
    writesScripts() ? h('a', { class: 'btn btn-sm ik-go', id: 'focus-to-scripts', href: scriptsHref() }, 'לכתיבת התסריטים') : null,
    briefDraftAt ? h('p', { class: 'ik-draft', role: 'status' }, `שוחזרה טיוטה מהטלפון מ־${formatStamp(briefDraftAt)}.`) : null,
    context.length ? h('details', { class: 'ik-context' }, h('summary', {}, 'מה נאמר באפיון'),
      h('dl', {}, ...context.flatMap((f) => [h('dt', {}, f.label), h('dd', {}, cf[f.key])]))) : null,
    // During the Zoom (13) too: what the client stressed, in Lior's words, first for the editors.
    field({
      fid: `focus-${SUMMARY}`, label: 'סיכום דגשים', cls: 'is-key',
      hint: 'מה הלקוח הדגיש, במילים שלך. אפשר למלא גם בזמן הזום. העורכים רואים את זה ראשון.',
      control: textArea(briefV[SUMMARY], onTopic(SUMMARY), 4),
    }),
    h('label', { class: 'ik-check' },
      h('input', { type: 'checkbox', id: 'focus-read', checked: isDone(key('p12a.read')), disabled: isDone(key('p12a.read')) }),
      h('span', {}, 'קראתי את האפיון לעומק')),
    ...order.map(([k, label]) => field({
      fid: `focus-${k}`, label: k === MUST ? `${label} (חייבים להגיד)` : k === MUST_NOT ? `${label} (אסור להגיד)` : label,
      cls: k === MUST || k === MUST_NOT ? 'is-key' : '',
      control: textArea(briefV[k], onTopic(k), 2),
      hint: checks[key(`p12a.t.${k}`)]?.state === 'na' ? NOT_RAISED : null,
    })),
    h('div', { class: 'ik-actions ik-sticky' },
      h('button', { type: 'submit', class: 'btn ik-big', id: 'focus-save', disabled: busy }, 'שמירה'),
      called ? null : h('button', { type: 'button', class: 'btn btn-primary ik-big', id: 'focus-done', disabled: busy, onclick: () => submitBrief(true) }, 'השיחה הסתיימה')));
}
async function submitBrief(done) {
  if (busy) return;
  const read = $('focus-read') ? $('focus-read').checked : false;
  const fields = Object.fromEntries(BRIEF_KEYS.map((k) => [k, clean(briefV[k])]).filter(([, v]) => v));
  if (done) {
    const empty = emptyTopics(fields);
    if (empty.length && !confirm(`${empty.length === 1 ? 'נושא אחד ריק ויסומן' : `${empty.length} נושאים ריקים ויסומנו`} "${NOT_RAISED}". להמשיך?`)) return;
  }
  busy = true;
  render();
  try {
    const row = await saveBrief(id, round, fields);
    briefs = [...briefs.filter((b) => b.round !== round), row];
    await saveChecks(briefChecks(fields, checks, { round, read: read && !isDone(key('p12a.read')), done }));
    store.set(`brief.${id}.${round}`, '');
    briefDraftAt = null;
    toast(done ? 'שיחת הדגשים נשמרה והסתיימה. הדגשים מופיעים לעורכים.' : 'נשמר.');
  } catch (err) {
    toast(missingTable(err) ? 'טבלת הדגשים עוד לא הוקמה במסד הנתונים. הטיוטה נשמרת בטלפון.' : `לא נשמר. ${errorText(err)}`);
  }
  busy = false;
  render(done ? 'focus-h' : 'focus-save');
}

// ── #scripts: scripts and the Zoom (12, 13) ─
function itemCheck(k, label, { note = null, hint = null } = {}) {
  const full = key(k);
  const s = stateNow();
  const it = s.states.flatMap((x) => x.proc.items.map((i) => ({ i, ctx: x.proc.ctx || client }))).find((x) => x.i.key === full);
  const block = it && !isDone(full) ? blockers(it.i, it.ctx, checks) : null;
  const cid = `chk-${full.replace(/\./g, '-')}`;
  return h('div', { class: 'ik-item' },
    h('label', { class: 'ik-check' },
      h('input', { type: 'checkbox', id: cid, checked: isDone(full), disabled: !!block || busy, 'aria-describedby': block || hint ? `${cid}-d` : null,
        onchange: (e) => toggle(full, e.currentTarget.checked, cid, note) }),
      h('span', {}, label)),
    block || hint ? h('p', { class: 'hint', id: `${cid}-d` }, block ? 'קודם שיחת הדגשים (12א) צריכה להסתיים.' : hint) : null);
}
async function toggle(k, on, focusId, note = null) {
  busy = true;
  try {
    if (on) checks[k] = await setCheck(id, k, 'done', note);
    else { await clearCheck(id, k); delete checks[k]; }
  } catch (err) { toast(`הסימון לא נשמר. ${errorText(err)}`); }
  busy = false;
  render(focusId);
}
function renderScripts() {
  const p12 = procState('p12');
  const p13 = procState('p13');
  const link = (round === 1 ? client.links?.scripts : null) || checks[key('p12.docs')]?.note || '';
  const zoomAt = checks[key('p13.zoomat')]?.state === 'done' ? new Date(checks[key('p13.zoomat')].note) : null;
  const rec = checks[key('p13.zoom')]?.note || '';
  if (!scV || scV.round !== round) scV = { round, link, at: zoomAt && !Number.isNaN(zoomAt.getTime()) ? inputValueIL(zoomAt) : '', rec };
  const approved = isDone(key('p13.approved'));
  const videos = client.deliverables?.videos;
  const zoomEvent = zoomAt && !Number.isNaN(zoomAt.getTime()) ? googleCalendarUrl({ title: `זום לאישור התסריטים · ${client.name}`, start: zoomAt, minutes: 60, details: link ? `תסריטים: ${link}` : '' }) : null;
  return h('div', { class: 'ik-stack' },
    h('section', { class: 'ik-card', 'aria-labelledby': 'sc-h' },
      h('h2', { id: 'sc-h' }, `תסריטים (12)${round > 1 ? ` · סבב ${round}` : ''}`),
      h('p', { class: 'muted' }, p12?.complete ? 'התסריטים מוכנים.' : `${dueWords(p12) || 'עד סוף יום העסקים השני מהאפיון'}. היעד: סוף יום העסקים השני, כדי שהזום ייכנס ביום השלישי.`),
      writesScripts() ? h('a', { class: 'btn btn-sm ik-go', id: 'sc-write', href: scriptsHref() }, 'כתיבת התסריטים') : null,
      field({ fid: 'sc-link', label: 'קישור לתסריטים (הקישור לשיתוף מעמוד התסריטים)', hint: 'הקישור נשמר בקישורים של הלקוח.',
        control: textInput(scV.link, (x) => { scV.link = x; }, { type: 'url', inputmode: 'url', dir: 'ltr' }) }),
      h('button', { type: 'button', class: 'btn', id: 'sc-save', disabled: busy, onclick: saveScriptsLink }, link ? 'עדכון הקישור' : 'שמירת הקישור'),
      itemCheck('p12.scripts', `התסריטים הוכנו לפי החבילה${videos ? ` (${videos} סרטונים)` : ''}, תסריט לכל סרטון`),
      itemCheck('p12.numbered', 'לכל סרטון מספר ברור')),
    h('section', { class: 'ik-card', 'aria-labelledby': 'zm-h' },
      h('h2', { id: 'zm-h' }, 'זום לאישור התוכן (13)'),
      h('p', { class: 'muted' }, approved ? 'הלקוח אישר את התסריטים.' : `${dueWords(p13) || 'עד יום העסקים השלישי מהאפיון'}.`),
      link ? null : h('p', { class: 'ik-note' }, 'כשמדביקים את קישור התסריטים, מתאמים זום.'),
      h('a', { class: 'btn btn-sm ik-go', id: 'zm-focus', href: '#focus' }, 'סיכום דגשים לקוח (גם בזמן הזום)'),
      field({ fid: 'zm-at', label: 'מועד הזום', control: textInput(scV.at, (x) => { scV.at = x; }, { type: 'datetime-local', dir: 'ltr' }) }),
      h('div', { class: 'ik-row' },
        h('button', { type: 'button', class: 'btn', id: 'zm-save', disabled: busy, onclick: saveZoomAt }, zoomAt ? 'עדכון המועד' : 'קביעת הזום'),
        zoomEvent ? h('a', { class: 'btn btn-ghost', href: zoomEvent, target: '_blank', rel: 'noopener' }, 'הוספה ליומן', h('span', { class: 'sr-only' }, ' (נפתח בחלון חדש)')) : null),
      zoomAt ? h('p', { class: 'hint' }, `הזום: ${formatStamp(zoomAt)}`) : null,
      field({ fid: 'zm-rec', label: 'קישור להקלטת הזום', control: textInput(scV.rec, (x) => { scV.rec = x; }, { type: 'url', inputmode: 'url', dir: 'ltr' }) }),
      h('button', { type: 'button', class: 'btn', id: 'zm-rec-save', disabled: busy, onclick: saveRecording }, rec ? 'עדכון ההקלטה' : 'שמירת ההקלטה'),
      h('div', { class: 'ik-approve' },
        approved ? h('p', { class: 'ok-line' }, `הלקוח אישר · ${who(checks[key('p13.approved')].by_email)} · ${formatStamp(checks[key('p13.approved')].at)}`)
          : h('button', { type: 'button', class: 'btn btn-primary ik-big', id: 'zm-approved', disabled: busy || !isDone(key('p13.zoom')), 'aria-describedby': 'zm-approved-d', onclick: () => toggle(key('p13.approved'), true, 'zm-approved') }, 'הלקוח אישר את התסריטים'),
        h('p', { class: 'hint', id: 'zm-approved-d' }, isDone(key('p13.zoom')) ? 'אישור לקוח הוא אישור אמיתי: אי אפשר לסמן אותו "לא רלוונטי". לא מצלמים תוכן שלא אושר.' : 'אחרי שהזום התקיים ונשמרה ההקלטה.')),
      itemCheck('p13.fixes', 'תיקונים שנשארו אחרי הזום עודכנו בעמוד התסריטים', { hint: 'אם היו. עד יום עסקים אחד אחרי הזום.' })));
}
async function saveScriptsLink() {
  const v = clean($('sc-link').value);
  if (!validUrl(v)) { $('sc-link').setAttribute('aria-invalid', 'true'); $('sc-link-err').textContent = 'קישור שמתחיל ב־https://, בלי סיסמה.'; $('sc-link-err').hidden = false; $('sc-link').focus(); return; }
  busy = true;
  try {
    if (round === 1) client = await updateClient(id, { links: { ...(client.links || {}), scripts: v } });
    // The link is kept; "the scripts are on the scripts page" is marked with it only when
    // there is a script there for this round (protocol v8, app/mark-guards.js).
    const verdict = await checkMark(id, key('p12.docs'));
    if (verdict?.refuse) toast(`הקישור נשמר. ${verdict.refuse}`);
    else {
      checks[key('p12.docs')] = await setCheck(id, key('p12.docs'), 'done', v);
      toast('הקישור נשמר. עכשיו לתאם זום.');
    }
  } catch (err) { toast(`לא נשמר. ${errorText(err)}`); }
  busy = false;
  render('zm-at');
}
async function saveZoomAt() {
  const d = fromInputIL($('zm-at').value);
  if (!d) { $('zm-at').setAttribute('aria-invalid', 'true'); $('zm-at-err').textContent = 'לבחור תאריך ושעה.'; $('zm-at-err').hidden = false; $('zm-at').focus(); return; }
  busy = true;
  try {
    checks[key('p13.zoomat')] = await setCheck(id, key('p13.zoomat'), 'done', d.toISOString());
    toast(`הזום נקבע ל־${formatStamp(d)}.`);
  } catch (err) { toast(`לא נשמר. ${errorText(err)}`); }
  busy = false;
  render('zm-save');
}
async function saveRecording() {
  const v = clean($('zm-rec').value);
  if (!validUrl(v)) { $('zm-rec').setAttribute('aria-invalid', 'true'); $('zm-rec-err').textContent = 'קישור שמתחיל ב־https://, בלי סיסמה.'; $('zm-rec-err').hidden = false; $('zm-rec').focus(); return; }
  busy = true;
  try {
    checks[key('p13.zoom')] = await setCheck(id, key('p13.zoom'), 'done', v);
    toast('ההקלטה נשמרה. הזום סומן כהתקיים.');
  } catch (err) { toast(`לא נשמר. ${errorText(err)}`); }
  busy = false;
  render('zm-approved');
}

// ── The characterization, read-only ────────
// Everything the meeting gave, as text: the 11 fields, the brand's colours and logo
// link, what was received, and the client's materials from the client's files (no
// upload here: the viewer may not add materials, so no button is drawn). Which
// clients they may read is the database's (characterizations: can_see_client).
async function showRead() {
  readMode = true;
  $('ik-tabs').hidden = true;
  if (!id) { $('state').textContent = 'לא נבחר לקוח.'; return; }
  $('state').textContent = 'טוען…';
  try {
    client = await loadClient(id);
  } catch (err) { $('state').textContent = errorText(err); return; }
  if (!client) { $('state').textContent = 'הלקוח לא נמצא, או שאין לך גישה אליו.'; $('app').hidden = true; return; }
  charRow = await loadCharacterization(id).then((r) => { charError = null; return r; }).catch((err) => { charError = err; return null; });
  $('state').textContent = '';
  document.title = `${client.name} · האפיון · astrateg`;
  $('back').href = me === 'nirel' ? 'editor.html' : 'clients.html#mine';
  $('back').textContent = me === 'nirel' ? '→ העריכה והבריפים שלי' : '→ המשימות שלי';
  const f = charRow?.fields || {};
  const charBy = PEOPLE[client.characterizer || 'ofir']?.name;
  fill($('ik-head'),
    h('div', { class: 'kicker' }, 'האפיון של הלקוח · לקריאה'),
    h('h1', { id: 'rd-h', tabindex: '-1' }, client.name),
    h('p', { class: 'muted' }, [client.business, client.char_at ? `אפיון ${formatStamp(client.char_at)}${charBy ? ` · ${charBy}` : ''}` : null].filter(Boolean).join(' · ')),
    h('a', { class: 'btn btn-sm btn-ghost', id: 'rd-card', href: `client.html?id=${encodeURIComponent(id)}` }, 'לכרטיס הלקוח'));
  const row = (label, value, { ltr = false } = {}) => [h('dt', {}, label),
    h('dd', { class: clean(value) ? '' : 'muted' }, clean(value) ? (ltr ? h('bdi', { dir: 'ltr', class: 'num' }, clean(value)) : clean(value)) : 'לא מולא')];
  const filled = FORM_FIELDS.filter((x) => clean(f[x.key])).length;
  const slot = h('div', { id: 'rd-files' });
  fill($('ik-body'), h('div', { class: 'ik-stack' },
    h('section', { class: 'ik-card', 'aria-labelledby': 'rd-char-h' },
      h('h2', { id: 'rd-char-h' }, 'מה הלקוח סיפר באפיון'),
      !charRow ? h('p', { class: 'ik-note', id: 'rd-none' }, charError && !missingTable(charError) ? 'לא הצלחנו לטעון את האפיון. רעננו את הדף.' : 'האפיון עוד לא נשמר במערכת. כשהוא יישמר, הוא יופיע כאן.')
        : [filled < FORM_FIELDS.length ? h('p', { class: 'muted' }, `מולאו ${filled} מתוך ${FORM_FIELDS.length} השדות. מה שחסר: לשאול את ${charBy || 'אופיר'}.`) : null,
          h('dl', { class: 'ik-read', id: 'rd-fields' }, ...FORM_FIELDS.flatMap((x) => row(x.label, f[x.key], { ltr: !!x.tel })))]),
    charRow ? h('section', { class: 'ik-card', 'aria-labelledby': 'rd-brand-h' },
      h('h2', { id: 'rd-brand-h' }, 'מותג וחומרים'),
      h('dl', { class: 'ik-read', id: 'rd-brand' },
        ...row('צבעי המותג', f.colors),
        h('dt', {}, 'לוגו'), h('dd', {}, validUrl(f.logo_url) ? h('a', { href: clean(f.logo_url), target: '_blank', rel: 'noopener noreferrer' }, 'פתיחת הלוגו', h('span', { class: 'sr-only' }, ' (נפתח בחלון חדש)'))
          : client.has_logo === false ? 'אין ללקוח לוגו (מכינים לוגו חדש)' : 'אין קישור. אם הועלה קובץ, הוא למטה.'),
        ...MATERIALS.flatMap((m) => [h('dt', {}, m.label), h('dd', {}, MATERIAL_STATES.find(([k]) => k === f.materials?.[m.key])?.[1] || 'לא סומן')]))) : null,
    slot));
  mountClientFiles(slot, { client, me, myEmail, toast, only: 'materials' });
  $('rd-h').focus({ preventScroll: true });
}

// ── Start ─────────────────────────────────
mountSession(async (staff) => {
  const v = await viewerOf(staff.email);
  myEmail = staff.email;
  me = v.me;
  scope = v.scope;
  Object.assign(directory, await loadDirectory());
  if (v.error) { $('state').textContent = VIEWER_UNKNOWN; $('app').hidden = true; return; }
  if (scope !== 'office' && readsChar(me)) { await showRead(); return; }
  if (scope !== 'office') {
    $('app').hidden = true;
    $('state').textContent = 'האפיון ושיחת הדגשים פתוחים לצוות המשרד. הדגשים עצמם מופיעים בכרטיס הלקוח.';
    return;
  }
  const asked = SECTIONS.some(([k]) => k === location.hash.slice(1)) ? location.hash.slice(1) : null;
  if (asked) section = asked;
  await load();
  if (client && !asked) {
    // Where the work is: the end of the meeting, then the form, then the content.
    const p4 = procState('p04', true);
    setSection(!isDone(CHAR_ENDED) && !p4?.complete ? 'end' : !p4?.complete ? 'form' : 'focus');
  }
});
