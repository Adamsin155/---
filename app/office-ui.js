// Shared view pieces of the office's screens (qa.html, pass.html,
// decisions.html, Ilai's part of "מה עליי" and the client card): the first
// screen each person lands on, the "התחלתי" button of an urgent task, the list
// of fixes returned by Ofir with "תוקן" / "סמן הכול תוקן", and the quality-control
// line of a process in the client card. The logic is app/office-marks.js.
import { PEOPLE } from './protocol.js';
import { setCheck, setChecksBulk, setTaskStarted } from './protocol-data.js';
import {
  h, toast, errorText, formatStamp, formatWhen, who, TAB_FRESH, firstLanded, markFirstLanded,
} from './protocol-ui.js';
import { isOwnerView } from './team-rules.js';
import {
  QA_KINDS, qaState, fixedKey, fixedItemKey, qaDue,
} from './office-marks.js';

// ── The first screen ────────────────────────
// One landing rule for everyone (sections 3 and 6): the owner lands on "מה דורש
// אותי" (owner.html), Ofir on the quality-control queue, Lior on "החלטות", the
// editors and Nirel on their editing page, Eli on his shoot days. Irit and Ilai
// stay on "מה עליי". Only when the tab opens on clients.html without a view (#…),
// and once per tab (the installed app, a sign-in, a new tab; this tab's session
// storage); after that every link opens where it points, and "מה עליי" is always
// clients.html#mine. Each role also has a shortcut to its screen on that page.
export const FIRST_SCREEN = { ofir: 'qa.html', lior: 'decisions.html', eli: 'shoot.html' };
export const EDITOR_SCREEN = 'editor.html';
export const OWNER_SCREEN = 'owner.html';
export function firstScreenOf(me, viewer = null) {
  if (!me) return isOwnerView(viewer) ? OWNER_SCREEN : null;
  if (PEOPLE[me]?.editor) return EDITOR_SCREEN;
  return FIRST_SCREEN[me] || null;
}
// Where clients.html sends this person now, or null: `arrived` is the hash the page
// was opened with (a sign-in link, #mine, #control…). Marks the landing.
export function landingNow({ me, viewer, arrived = '', fresh = TAB_FRESH }) {
  if (!fresh || arrived || firstLanded()) return null;
  const page = firstScreenOf(me, viewer);
  if (page) markFirstLanded();
  return page;
}
export { firstLanded, markFirstLanded };

// The office screens in the page head, one row in one order on every page that
// shows it (clients.html, qa, pass, decisions, year, insights): Ofir's two, Lior's
// decisions (and the assignment, which he takes when Ofir cannot), all three for the
// owner; the monthly insights for the owner and Lior; the package year for the
// office and Ilai (app/month-ui.js worksCycle). The page itself is left out.
export function officeLinks(viewer, current = '') {
  const me = viewer?.me || null;
  const ok = !!viewer && !viewer.error;
  const owner = ok && !me && viewer.scope === 'office';
  const list = [
    ['qa', 'qa.html', 'בקרה ושיוך', me === 'ofir' || me === 'lior' || owner],
    ['pass', 'pass.html', 'מעבר על הלקוחות', me === 'ofir' || owner],
    ['decisions', 'decisions.html', 'החלטות', me === 'lior' || me === 'ofir' || owner],
    ['insights', 'insights.html', 'תובנות', ok && (me === 'lior' || owner)],
    ['year', 'year.html', 'שנת החבילה', ok && (viewer.scope === 'office' || me === 'ilai')],
  ].filter(([, href, , show]) => show && href !== current);
  return list.map(([id, href, label]) => h('a', { class: 'btn btn-sm office-link', id: `cta-${id}`, href }, label));
}

// ── "התחלתי" on an urgent task (decision 9) ─
export function startControl(t, me, onStarted) {
  if (!t?.urgent || t.done_at || !('started_at' in t)) return null;
  if (t.started_at) return h('p', { class: 'task-start' }, `${t.owner === me ? 'התחלת' : `${PEOPLE[t.owner]?.name || ''} התחיל/ה`} ${formatStamp(t.started_at)}`);
  if (t.owner !== me) return h('p', { class: 'task-start muted' }, `מחכה ל״התחלתי״ של ${PEOPLE[t.owner]?.name || t.owner}`);
  return h('p', { class: 'task-start' },
    h('button', {
      type: 'button', class: 'btn btn-sm btn-primary start-btn',
      onclick: async (ev) => {
        const btn = ev.currentTarget;
        btn.disabled = true;
        try {
          Object.assign(t, await setTaskStarted(t.id, true));
        } catch (err) {
          btn.disabled = false;
          toast(`הסימון לא נשמר. ${errorText(err)}`);
          return;
        }
        toast(`נרשם שהתחלת: ${t.title}`);
        onStarted?.(t);
      },
    }, 'התחלתי'),
    h('span', { class: 'hint' }, 'בלי ״התחלתי״ תוך 30 דקות עבודה, המשימה חוזרת לליאור.'));
}

// ── Fixes returned by Ofir ──────────────────
// Who may mark them: the one who fixes (the editor, Ilai), or the office on their
// behalf (decision 23: the owner, Irit, Lior and Ofir, recorded as theirs).
const ON_BEHALF = new Set(['irit', 'lior', 'ofir']);
export const mayFix = (fixer, me, viewer) => me === fixer || ON_BEHALF.has(me) || (!me && viewer?.scope === 'office' && !viewer?.error);

// The open round's issues with "תוקן" each and "סמן הכול תוקן". The last one
// fixed sends the work back to Ofir (the round's `fixed` mark).
//   ctx: { client, checks (the client's, kept current), kind, pre, fixer, me, viewer, onChange }
export function fixList(ctx) {
  const { client, kind, pre } = ctx;
  const q = qaState(ctx.checks, pre, kind);
  if (q.stage !== 'fixing') return null;
  const k = QA_KINDS[kind];
  const r = q.open;
  const can = mayFix(ctx.fixer, ctx.me, ctx.viewer);
  const idBase = `fx-${client.id}-${pre.replace(/\W/g, '')}${k.base}-${r.n}`;
  const save = async (keys, btn, done) => {
    btn.disabled = true;
    try {
      const rows = keys.length === 1 ? [await setCheck(client.id, keys[0], 'done')] : await setChecksBulk(client.id, keys, 'done');
      for (const row of rows) ctx.checks[row.item_key] = row;
    } catch (err) {
      btn.disabled = false;
      toast(`הסימון לא נשמר. ${errorText(err)}`);
      return;
    }
    toast(done);
    ctx.onChange?.();
  };
  const left = r.issues.map((_, i) => i).filter((i) => !r.fixed.has(i));
  const all = [...left.map((i) => fixedItemKey(pre, kind, r.n, i)), fixedKey(pre, kind, r.n)];
  return h('div', { class: 'fix-list', role: 'group', 'aria-labelledby': `${idBase}-h` },
    h('p', { class: 'fix-h', id: `${idBase}-h` },
      h('strong', {}, `הוחזר לתיקון · סבב ${r.n}`),
      ` · ${who(r.by) || 'אופיר'} · ${formatStamp(r.at)}`,
      r.due ? h('span', { class: `fix-due${r.due < new Date() ? ' late' : ''}` }, ` · לתקן עד ${formatWhen(r.due)}`) : null),
    h('ol', { class: 'fix-items' }, ...r.issues.map((x, i) => {
      const fixed = r.fixed.has(i);
      const last = !fixed && left.length === 1;
      return h('li', { class: `fix-item${fixed ? ' is-fixed' : ''}` },
        h('span', { class: 'fix-text' }, x.ref ? h('strong', {}, `${k.unit} ${x.ref}: `) : null, x.text),
        fixed ? h('span', { class: 'sbadge s-done' }, h('span', { class: 'sicon', 'aria-hidden': 'true' }), 'תוקן')
          : can ? h('button', {
            type: 'button', class: 'btn btn-sm fix-btn', id: `${idBase}-${i}`,
            'aria-label': `תוקן: ${x.ref ? `${k.unit} ${x.ref}, ` : ''}${x.text}`,
            onclick: (ev) => save(last ? [fixedItemKey(pre, kind, r.n, i), fixedKey(pre, kind, r.n)] : [fixedItemKey(pre, kind, r.n, i)], ev.currentTarget,
              last ? 'כל התיקונים סומנו. העבודה חזרה לבדיקה של אופיר.' : 'סומן שתוקן.'),
          }, 'תוקן') : null);
    })),
    can && left.length > 1 ? h('button', {
      type: 'button', class: 'btn btn-sm btn-primary fix-all', id: `${idBase}-all`,
      onclick: (ev) => save(all, ev.currentTarget, 'כל התיקונים סומנו. העבודה חזרה לבדיקה של אופיר.'),
    }, 'סמן הכול תוקן · חזרה לאופיר') : null);
}

// The quality-control line of process 23 or 25 in the client card: with Ofir
// since when and until when ("אופיר באפיון, בקרה עד HH:MM" while he is in a
// meeting), returned and what to fix, or approved after N rounds; the earlier rounds folded.
export function qaLine({ client, checks, kind, pre, ctx, me, viewer, meetings = null, onChange }) {
  const q = qaState(checks, pre, kind);
  if (q.stage === 'none' && !q.returns) return null;
  const k = QA_KINDS[kind];
  const now = new Date();
  let head = null;
  if (q.stage === 'ofir') {
    const due = qaDue(meetings || [], q.readyAt, 60);
    const busy = (meetings || []).some(([a, b]) => +now >= a && +now < b);
    head = h('p', { class: 'qa-now' }, h('strong', {}, q.round > 1 ? `אצל אופיר לבדיקה חוזרת (אחרי סבב ${q.round - 1})` : 'אצל אופיר לבקרה'),
      meetings ? ` · ${busy ? 'אופיר באפיון, ' : ''}בקרה עד ${formatWhen(due, now)}` : ` · מאז ${formatStamp(q.readyAt)}`);
  } else if (q.stage === 'approved') {
    head = h('p', { class: 'qa-now' }, h('strong', {}, 'אופיר אישר'), q.returns ? ` אחרי ${q.returns === 1 ? 'סבב תיקונים אחד' : `${q.returns} סבבי תיקונים`}` : '');
  }
  const fixer = k.fixer(ctx || client);
  const earlier = q.rounds.filter((r) => !r.open);
  return h('div', { class: 'qa-line' },
    head,
    q.stage === 'fixing' ? fixList({ client, checks, kind, pre, fixer, me, viewer, onChange }) : null,
    earlier.length ? h('details', { class: 'qa-hist' }, h('summary', {}, `סבבי תיקונים קודמים (${earlier.length})`),
      h('ol', {}, ...earlier.map((r) => h('li', {},
        `סבב ${r.n} · ${formatStamp(r.at)} · ${r.issues.length === 1 ? 'בעיה אחת' : `${r.issues.length} בעיות`}${r.fixedAt ? ` · תוקן ${formatStamp(r.fixedAt)}` : ''}`,
        h('ul', {}, ...r.issues.map((x) => h('li', {}, x.ref ? `${k.unit} ${x.ref}: ${x.text}` : x.text))))))) : null);
}

// Waze on a phone, with the address as typed in the card.
export const navLink = (address) => (address ? `https://waze.com/ul?q=${encodeURIComponent(address)}&navigate=yes` : null);
