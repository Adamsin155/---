// Reminder rules for the client's side (stage 4; docs/plan/system-plan.md, section 7;
// decisions 24 and 28), in the shape of app/reminder-rules.js, which appends them to
// RULES. They follow the tasks the database opens (supabase/migrations/
// 20260930170000_client_status.sql), so a task closed stops its ladder:
//   clientFix    the client asked for a fix on the status page (source 'client_fix'):
//                whoever fixes hears at once, ringing once. For the videos' first round
//                the protocol's own ladder rings the editor (clientFixes, on p27.notes,
//                which the same request marked), so this one stays quiet there. A day
//                after the due day: the owner of the task (in the app) and Lior's list.
//   clientScore  a low satisfaction score (source 'survey'): Lior rings once to call
//                within a business day; 2 or less of 5 (4 or less of 10) rings the owner
//                too (decision 24, owner case 3); still open a business day after the
//                due day, the owner's screen.
// The generic "משימה רגילה" rule leaves these sources to them (STATUS_SOURCES).
// Pure: no DOM, no network, Israel time (tz.js), shared with the edge function.
import { PEOPLE } from './protocol.js';
import { parseDate } from './protocol-logic.js';
import { dayFromKeyIL, partsIL } from './tz.js';

export const CLIENT_FIX = 'client_fix';
export const SURVEY = 'survey';
export const STATUS_SOURCES = new Set([CLIENT_FIX, SURVEY]);

const WEEKDAY = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];
const dayWord = (d) => { const p = partsIL(d); return `${WEEKDAY[p.weekday]} ${p.day}.${p.month}`; };
const nameOf = (k) => PEOPLE[k]?.name || k;
const taskUrl = (cid) => `client.html?id=${encodeURIComponent(cid)}#tasks`;
const short = (s, n = 160) => { const t = String(s || '').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
const SURVEY_WORD = { shoot: 'יום הצילום', delivery: 'הסרטונים', nps: 'המלצה' };
const scoreText = (b) => `${b?.score} מתוך ${b?.kind === 'nps' ? 10 : 5}`;

function casesOf(env, source) {
  return env.tasks.filter((t) => t.source === source && !t.done_at && env.clientById.has(t.client_id) && parseDate(t.created_at)).map((t) => {
    const c = env.clientById.get(t.client_id);
    return {
      id: t.id, cid: c.id, client: c, name: c.name, task: t, who: t.owner, brief: t.brief || {}, url: taskUrl(c.id),
      anchors: { event: parseDate(t.created_at), due: t.due_on ? dayFromKeyIL(t.due_on) : null },
    };
  });
}

export const STATUS_RULES = [
  {
    id: 'clientFix', event: 'הלקוח ביקש תיקון בדף המצב', procs: [],
    instances: (env) => casesOf(env, CLIENT_FIX),
    steps: [
      {
        id: 'now', to: (i) => i.who, level: 'ring', when: (i) => !i.brief.notes_marked,
        title: (i) => (i.brief.extra ? `הלקוח ביקש סבב תיקונים נוסף: ${i.name}` : `הלקוח ביקש תיקון: ${i.name}`),
        body: (i) => `${i.task.title}. ${i.brief.problem ? `הערות: ${short(i.brief.problem)}` : ''}${i.task.due_on ? ` עד ${dayWord(dayFromKeyIL(i.task.due_on))}.` : ''}`.trim(),
      },
      { id: 'late', from: 'due', businessDays: 1, at: '08:30', to: (i) => i.who, level: 'quiet', overdue: true, title: (i) => `תיקון ללקוח באיחור: ${i.name}`, body: (i) => i.task.title },
      { id: 'lior', from: 'due', businessDays: 1, at: '08:30', to: 'lior', level: 'digest', list: true, overdue: true, when: (i) => i.who !== 'lior', title: (i) => `תיקון ללקוח באיחור: ${i.name} · ${nameOf(i.who)}`, body: (i) => i.task.title },
    ],
  },
  {
    id: 'clientScore', event: 'ציון נמוך מהלקוח', procs: [],
    instances: (env) => casesOf(env, SURVEY),
    steps: [
      {
        id: 'now', to: (i) => i.who, level: 'ring',
        title: (i) => `ציון ${scoreText(i.brief)} מהלקוח: ${i.name}`,
        body: (i) => `לשאלה על ${SURVEY_WORD[i.brief.kind] || 'השירות'}. להתקשר ללקוח${i.task.due_on ? ` עד ${dayWord(dayFromKeyIL(i.task.due_on))}` : ' תוך יום עסקים'}.`,
      },
      {
        id: 'owner', to: 'owner', level: 'ring', when: (i) => !!i.brief.owner_alert,
        title: (i) => `ציון ${scoreText(i.brief)} מהלקוח: ${i.name}`,
        body: (i) => `לשאלה על ${SURVEY_WORD[i.brief.kind] || 'השירות'}. ${nameOf(i.who)} קיבל משימה להתקשר תוך יום עסקים.`,
      },
      { id: 'board', from: 'due', businessDays: 1, at: '08:30', to: 'owner', level: 'board', overdue: true, title: (i) => `לא התקשרו אחרי ציון נמוך: ${i.name}`, body: (i) => i.task.title },
    ],
  },
];
