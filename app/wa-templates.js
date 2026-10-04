// The staff WhatsApp messages (stage 4, docs/plan/system-plan.md: "6–8 תבניות
// הודעה בעברית") as data: the exact text of each template, ready to submit to Meta
// for approval (metaDefinition; docs/ops.md "וואטסאפ לצוות" has the steps), which
// template each reminder goes out with (templateFor), and the Cloud API message
// that fills one in (templateMessage). Pure, no DOM and no network: the reminders
// function (supabase/functions/reminders) sends with it, and the unit tests read it.
//
// Meta's rules this follows: a message the system starts is an approved template
// (category UTILITY, no promotion); a variable is never the first or the last
// thing in the body; a variable holds no line breaks, tabs or more than four
// spaces in a row, and the body is at most 1024 characters; a button's text is at
// most 25 characters, a footer at most 60; quick replies come before the link.
import { RULE_BY_ID, stepOfKey } from './reminder-rules.js';

export const WA_LANG = 'he';
// The site the "פתיחה במערכת" button opens (the variable is the page, e.g.
// client.html?id=…). The base is part of the approved template: moving the site
// to app.astrateg.tech (docs/ops.md, section 8) means submitting the templates again.
export const SITE_URL = 'https://adamsin155.github.io/---/';
export const OPEN_BUTTON = 'פתיחה במערכת';
export const FOOTER = 'אסטרטג · הודעת עבודה. להפסקה: השב/י הסר';
// Quick replies (the plan: "אני על זה" and "צריך עזרה"; "בוצע" only on simple items;
// approvals and quality control always open the app).
export const BUTTONS = { onit: 'אני על זה', help: 'צריך עזרה', done: 'בוצע' };
const ANSWER = 'אפשר לענות כאן בכפתור, או לפתוח במערכת.';

// {{1}} is the reminder's title (it names the client), {{2}} its details.
export const TEMPLATES = {
  digest: {
    name: 'astrateg_digest', label: 'תקציר',
    body: 'תקציר מהמערכת: {{1}}\n\n{{2}}\n\nהפירוט המלא ב״המשימות שלי״ במערכת.',
    example: ['תקציר בוקר', 'באיחור: פיצה · תסריטים · היום (2): בורגר, סושי'],
    replies: [],
  },
  new_task: {
    name: 'astrateg_new_task', label: 'משימה חדשה',
    body: `משימה חדשה בשבילך: {{1}}\n{{2}}\n\n${ANSWER}`,
    example: ['משימה דחופה: פיצה', 'להחליף את הלוגו בגרפיקה של השבוע. ללחוץ "התחלתי".'],
    replies: ['onit', 'help', 'done'],
  },
  due: {
    name: 'astrateg_due', label: 'מועד',
    body: `תזכורת מהמערכת: {{1}}\n{{2}}\n\n${ANSWER}`,
    example: ['לשייך עורך: פיצה', 'יום הצילום הסתיים. לשייך עורך עד מחר 12:00.'],
    replies: ['onit', 'help'],
  },
  late: {
    name: 'astrateg_late', label: 'איחור',
    body: `באיחור: {{1}}\n{{2}}\n\n${ANSWER}`,
    example: ['עוד לא התחלת: פיצה', 'עברו שעתיים עבודה מאז שהכונן נמסר.'],
    replies: ['onit', 'help'],
  },
  exception: {
    name: 'astrateg_exception', label: 'חריגה',
    body: 'חריגה: {{1}}\n{{2}}\n\nהפרטים והטיפול במערכת.',
    example: ['משימה דחופה לא התחילה: פיצה', 'עילאי: להחליף את הלוגו. עברו 30 דקות עבודה.'],
    replies: ['onit'],
  },
  shoot_day: {
    name: 'astrateg_shoot_day', label: 'יום צילום',
    body: `יום צילום: {{1}}\n{{2}}\n\n${ANSWER}`,
    example: ['בדיקת יום לפני: פיצה', 'לוודא שהתזכורות נשלחו ושהלקוח זוכר.'],
    replies: ['onit', 'help'],
  },
  editor_assigned: {
    name: 'astrateg_editor_assigned', label: 'עורך שויך',
    body: `עבודה חדשה בעריכה: {{1}}\n{{2}}\n\n${ANSWER}`,
    example: ['לקוח חדש בעריכה אצלך: פיצה', 'בדרייב ואצל אופיר עד ה׳ 8.10 18:00'],
    replies: ['onit', 'help'],
  },
  owner_digest: {
    name: 'astrateg_owner_digest', label: 'תקציר בעלים',
    body: 'תקציר לבעלים: {{1}}\n\n{{2}}\n\nהפירוט המלא במסך הבעלים.',
    example: ['חריגות היום ודוח שבועי', 'הכול לפי התוכנית. · דוח שבועי: · צלצולים השבוע: עירית 12, ליאור 9'],
    replies: [],
  },
  // Approvals and quality control are done in the app only: no quick replies.
  review: {
    name: 'astrateg_review', label: 'לבדיקה ולאישור',
    body: 'לבדיקה או לאישור: {{1}}\n{{2}}\n\nאישורים ובקרת איכות נעשים רק במערכת.',
    example: ['מוכן לבדיקה: פיצה', 'הסרטונים בדרייב. בקרה עד היום 15:00.'],
    replies: [],
  },
};

// ── Which template ─────────────────────────
// Rules whose case is a task (the key's case id is the task's id).
export const TASK_RULES = new Set(['urgent', 'exception', 'task', 'tell', 'briefDone']);
// Approvals and quality control: open the app, no quick replies.
export const REVIEW_RULES = new Set(['qa', 'qaReturn', 'graphicsRest', 'graphics9', 'approval', 'approved', 'finalReady', 'clientFixes']);
const SHOOT_RULES = new Set(['eve', 'briefing', 'shoot', 'broll', 'shootOpen']);
// Rings that say something was not done in time.
const LATE_STEPS = new Set(['editing.nostart', 'char.end', 'charForm.form', 'charForm.irit', 'assign.stop12']);

// The case id of a reminder key (`rule:client:case:step@person`; the case may hold ':').
export const caseOfKey = (key) => String(key).split(':').slice(2, -1).join(':');
export const taskIdOf = (row) => (TASK_RULES.has(row?.rule) ? caseOfKey(row.key) : null);
// A step's definition, when the rule lists its steps (not when they are computed).
export function stepDefOf(row) {
  const rule = RULE_BY_ID.get(row?.rule);
  const id = stepOfKey(row?.key || '').split('.').slice(1).join('.');
  return Array.isArray(rule?.steps) ? rule.steps.find((s) => s.id === id) || null : null;
}
// A task "בוצע" can close from WhatsApp: no brief (its form is in the app), and not
// an exception, a paused edit or a client's request.
export const simpleTask = (t) => !!t && !t.brief && !t.result && (t.source == null || ['p31', 'p33', 'status', 'followup'].includes(t.source));

// The template a log row goes out with (row: reminder_log; task: its task, if any).
export function templateFor(row, task = null) {
  if (row.rule === 'digest') return row.person === 'owner' ? 'owner_digest' : 'digest';
  if (REVIEW_RULES.has(row.rule)) return 'review';
  const step = stepOfKey(row.key);
  if (step === 'editing.assigned') return 'editor_assigned';
  if (step === 'urgent.now') {
    if (task?.source === 'escalation') return 'exception';
    return simpleTask(task) ? 'new_task' : 'due';
  }
  if (row.rule === 'urgent' || row.rule === 'exception') return 'exception';
  const def = stepDefOf(row);
  if (SHOOT_RULES.has(row.rule) || def?.shoot) return 'shoot_day';
  if (def?.overdue || LATE_STEPS.has(step) || row.rule === 'late') return 'late';
  return 'due';
}

// ── The message ────────────────────────────
// A variable's text: one line (Meta refuses line breaks, tabs and long runs of
// spaces in a variable), at most `max` characters, never empty.
export function cleanParam(text, max = 700, empty = 'הפרטים במערכת.') {
  let s = String(text ?? '').replace(/\s*\n+\s*/g, ' · ').replace(/[\t\r\v\f]+/g, ' ').replace(/ {2,}/g, ' ').trim();
  if (s.length > max) s = `${s.slice(0, max - 1).trimEnd()}…`;
  return s || empty;
}
// The page the "פתיחה במערכת" button opens, relative to SITE_URL, without the part
// after '#' (the button adds its text to the approved address as it is).
export function pagePath(url) {
  const s = String(url || '').split('#')[0].replace(/^\/+/, '');
  return /^[a-z][a-z0-9-]*\.html(\?[A-Za-z0-9_=&%.-]*)?$/.test(s) ? s : 'clients.html';
}
// A quick reply's payload: which button, on which reminder.
export const payloadOf = (action, logId) => `wa1:${action}:${logId}`;
export function parsePayload(payload) {
  const m = /^wa1:(onit|help|done):(\d{1,18})$/.exec(String(payload || ''));
  return m ? { action: m[1], logId: Number(m[2]) } : null;
}
// The button a reply pressed, when the payload is gone: by its text.
export const actionOfText = (text) => Object.entries(BUTTONS).find(([, t]) => t === String(text || '').trim())?.[0] || null;

// The variables of a template for a log row.
export const paramsOf = (row) => [cleanParam(row.title, 200, 'תזכורת'), cleanParam(row.body)];

// The Cloud API body (POST /{phone-number-id}/messages) for one log row.
export function templateMessage({ template, to, row }) {
  const t = TEMPLATES[template];
  if (!t) throw new Error(`unknown template ${template}`);
  const components = [{ type: 'body', parameters: paramsOf(row).map((text) => ({ type: 'text', text })) }];
  t.replies.forEach((r, i) => components.push({ type: 'button', sub_type: 'quick_reply', index: String(i), parameters: [{ type: 'payload', payload: payloadOf(r, row.id) }] }));
  components.push({ type: 'button', sub_type: 'url', index: String(t.replies.length), parameters: [{ type: 'text', text: pagePath(row.url) }] });
  return {
    messaging_product: 'whatsapp', recipient_type: 'individual', to, type: 'template',
    template: { name: t.name, language: { code: WA_LANG }, components },
  };
}

// A reply inside the 24 hours after the person wrote (Meta's service window): plain text.
export const textMessage = ({ to, text }) => ({ messaging_product: 'whatsapp', recipient_type: 'individual', to, type: 'text', text: { body: String(text).slice(0, 1000) } });

// What to submit to Meta for approval (WhatsApp Manager, or POST
// /{whatsapp-business-account-id}/message_templates with this body).
export function metaDefinition(key) {
  const t = TEMPLATES[key];
  return {
    name: t.name, language: WA_LANG, category: 'UTILITY',
    components: [
      { type: 'BODY', text: t.body, example: { body_text: [t.example] } },
      { type: 'FOOTER', text: FOOTER },
      {
        type: 'BUTTONS',
        buttons: [
          ...t.replies.map((r) => ({ type: 'QUICK_REPLY', text: BUTTONS[r] })),
          { type: 'URL', text: OPEN_BUTTON, url: `${SITE_URL}{{1}}`, example: [`${SITE_URL}clients.html`] },
        ],
      },
    ],
  };
}
