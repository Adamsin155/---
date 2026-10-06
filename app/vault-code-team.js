// "קוד הכספת" on the team screen (team.html), for the owner only (docs/ops.md,
// section 28): whether a code exists and when it was last changed (never the code),
// setting or changing it (6 digits, typed twice), and who typed a wrong code or was
// locked out lately. Until a code is set the card says that the vault works as it
// always did. Before the migration (20261008100100) nothing here shows.
import { h, fill, toast, who, formatStamp } from './protocol-ui.js';
import { vaultCodeStatus, setVaultCode, loadVaultCodeLog } from './protocol-data.js';
import { newCodeProblem, codeStateText, setError, LOG_WORDS, CODE_LENGTH, UNLOCK_MINUTES, MAX_WRONG, LOCKOUT_MINUTES } from './vault-code.js';
import { dateWords } from './access-logic.js';

// The status and the log, or null when the card is not for this person or not built yet.
export async function loadVaultCodeCard() {
  const s = await vaultCodeStatus();
  if (!s || !s.owner) return null;
  return { ...s, log: await loadVaultCodeLog() };
}

async function save(e, s, reload) {
  e.preventDefault();
  const code = document.getElementById('vc-code');
  const again = document.getElementById('vc-again');
  const err = document.getElementById('vc-err');
  const say = (msg, el = code) => { err.textContent = msg; err.hidden = false; el.setAttribute('aria-invalid', 'true'); el.focus(); };
  err.hidden = true;
  code.removeAttribute('aria-invalid');
  again.removeAttribute('aria-invalid');
  const problem = newCodeProblem(code.value, again.value);
  if (problem) { say(problem, /לא זהים/.test(problem) ? again : code); return; }
  if (s.set && !window.confirm('להחליף את קוד הכספת? הכספת תינעל מיד לכולם, וצריך למסור את הקוד החדש למי שצריך אותו.')) return;
  try { await setVaultCode(code.value); } catch (ex) { say(setError(ex)); return; }
  code.value = '';
  again.value = '';
  toast(s.set ? 'הקוד הוחלף. הכספת ננעלה לכולם עד שיקלידו את הקוד החדש.' : 'קוד הכספת הוגדר. מעכשיו סיסמאות נפתחות רק עם הקוד.');
  await reload();
  document.getElementById('vc-state')?.focus();
}

const codeInput = (id, label) => h('div', { class: 'field' }, h('label', { for: id }, label),
  h('input', {
    class: 'input', id, type: 'password', inputmode: 'numeric', pattern: '[0-9]*', maxlength: String(CODE_LENGTH), autocomplete: 'off', dir: 'ltr', 'aria-describedby': 'vc-err',
    oninput: (e) => { e.currentTarget.value = e.currentTarget.value.replace(/\D/g, '').slice(0, CODE_LENGTH); },
  }));

// The card, above the list (created before `before` on first use).
export function paintVaultCodeCard(s, before, reload, nameOf = who) {
  let el = document.getElementById('vc-panel');
  if (!s) { if (el) el.hidden = true; return; }
  if (!el) {
    el = h('section', { class: 'block tm-help tm-wa tm-vc', id: 'vc-panel', 'aria-labelledby': 'vc-panel-h' });
    before.before(el);
  }
  el.hidden = false;
  // Typing in the card is not wiped by the page's refresh.
  if (el.dataset.at === String(s.changedAt) && el.dataset.n === String(s.log.length ? s.log[0].id : 0) && el.firstChild) return;
  el.dataset.at = String(s.changedAt);
  el.dataset.n = String(s.log.length ? s.log[0].id : 0);
  const trouble = s.log.filter((r) => r.event === 'wrong' || r.event === 'lockout');
  fill(el,
    h('h2', { id: 'vc-panel-h' }, 'קוד הכספת'),
    h('p', { id: 'vc-state', tabindex: '-1', class: s.set ? 'tm-vc-on' : '' }, codeStateText(s, dateWords)),
    h('p', { class: 'muted' }, `קוד אחד של ${CODE_LENGTH} ספרות לכל מי שפותח סיסמאות. מקלידים אותו פעם אחת, והסיסמאות נפתחות ל־${UNLOCK_MINUTES} דקות. ${MAX_WRONG} קודים שגויים נועלים את אותו אדם ל־${LOCKOUT_MINUTES} דקות. הוספת גישות וסטטוסים לא דורשות קוד.`),
    h('form', { class: 'tm-vc-form', id: 'vc-form', novalidate: true, autocomplete: 'off', onsubmit: (e) => save(e, s, reload) },
      codeInput('vc-code', s.set ? 'קוד חדש' : 'קוד'),
      codeInput('vc-again', 'שוב, לאימות'),
      h('button', { type: 'submit', class: 'btn btn-sm', id: 'vc-save' }, s.set ? 'החלפת הקוד' : 'הגדרת קוד')),
    h('p', { class: 'err', id: 'vc-err', role: 'alert', hidden: true }),
    h('p', { class: 'muted' }, 'הקוד לא מוצג כאן ולא נשמר כמו שהוא: נשמרת רק טביעה מוצפנת שלו. כשמישהו עוזב, מחליפים את הקוד ומוסרים את החדש למי שנשאר.'),
    s.set ? h('details', { class: 'tm-vc-log', id: 'vc-log' },
      h('summary', {}, trouble.length ? `קודים שגויים ונעילות (${trouble.length})` : 'קודים שגויים ונעילות: אין'),
      h('ol', { class: 'hlist' }, ...(s.log.length ? s.log.map((r) => h('li', {}, h('span', { class: 'num muted' }, formatStamp(r.at)), ' ', h('strong', {}, nameOf(r.email)), ` ${LOG_WORDS[r.event] || r.event}`))
        : [h('li', { class: 'empty' }, 'אין עדיין.')]))) : null);
}
