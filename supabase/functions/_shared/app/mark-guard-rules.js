// generated — edit app/ instead. Source: app/mark-guard-rules.js. Regenerate: node scripts/sync-functions.mjs
// The pure part of app/mark-guards.js (what each guard refuses, from what was read), apart so
// that the mcp function (supabase/functions/mcp/write-tools.js; a copy runs on the server,
// node scripts/sync-functions.mjs) asks the same rules without the browser's client.
// What the guards are and why: app/mark-guards.js.
import { PROCESSES } from './protocol.js';

const ITEMS = new Map(PROCESSES.flatMap((p) => p.items.map((i) => [i.key, i])));
const baseKey = (key) => String(key || '').replace(/^r\d+\./, '');
export const roundOfKey = (key) => Number(/^r(\d+)\./.exec(String(key || ''))?.[1] || 1);
export const guardOf = (key) => ITEMS.get(baseKey(key))?.guard || null;
export const formOf = (key) => ITEMS.get(baseKey(key))?.form || null;

// The one sentence each refusal says.
export const REFUSALS = {
  gantt: 'הגאנט עדיין ריק. מוסיפים בו את התכנים, ואז מסמנים.',
  scheduled: 'עוד שום תוכן לא סומן ״תוזמן״ בגאנט. מסמנים שם, ואז כאן.',
  scripts: 'עוד אין תסריט בעמוד התסריטים. כותבים שם, ואז מסמנים.',
  logoFile: 'עוד אין קובץ לוגו בתיק הלקוח. מעלים אותו שם, ואז מסמנים.',
};
// The Gantt's rows that are content (a post), not its frame.
const POST_STATES = new Set(['scheduled', 'posted']);
// "הועלתה 1 מתוך 26. לשלוח בכל זאת?"
export const graphicsAsk = (count, total) => `${count === 1 ? 'הועלתה 1' : `הועלו ${count}`} מתוך ${total}. לשלוח בכל זאת?`;

// The verdict, from what was read: null (take the mark), { refuse: sentence },
// { ask: question } or { via: 'call' }. `facts` null: nothing is known, nothing is refused.
export function guardVerdict(guard, facts) {
  if (guard === 'callSummary') return { via: 'call' };
  if (!guard || !facts) return null;
  if (guard === 'gantt') return facts.posts === 0 ? { refuse: REFUSALS.gantt } : null;
  if (guard === 'scheduled') return facts.scheduled === 0 ? { refuse: REFUSALS.scheduled } : null;
  if (guard === 'scripts') return facts.scripts === 0 ? { refuse: REFUSALS.scripts } : null;
  if (guard === 'logoFile') return facts.logos === 0 ? { refuse: REFUSALS.logoFile } : null;
  if (guard === 'graphicsCount') {
    const total = Number(facts.total);
    return Number.isInteger(facts.count) && total > 0 && facts.count < total ? { ask: graphicsAsk(facts.count, total) } : null;
  }
  return null;
}

// The Gantt's rows as numbers: { posts, scheduled }. A row is content when its kind is
// one the Gantt publishes (`isPost`), which leaves out the frame rows (the term's end).
export function ganttFacts(rows, isPost = () => true) {
  const posts = (rows || []).filter((r) => isPost(r.kind));
  return { posts: posts.length, scheduled: posts.filter((r) => POST_STATES.has(r.state)).length };
}
