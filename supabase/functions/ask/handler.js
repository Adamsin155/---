// The ask function's work, free of Deno APIs so node tests run it whole (tests/ask.test.mjs);
// index.ts gives it the environment, the Supabase client and the Anthropic SDK. "שאלו את
// המערכת" (the owner's request of 29.10.2026; docs/ops.md, section 74):
//
//   POST { question, history? }  →  200 { answer, model, tools }
//
//   - every staff member (the owners, public.is_office() with no person, and every person from
//     public.my_person(); mayAsk in app/ask-logic.js; "תוסיף כבר לכולם וזהו", 29.10.2026): anyone
//     else 403, whatever their screen shows;
//   - "איפה…" / "איך…" about the app: the tool app_guide answers from the asker's own screens
//     (app/ask-guide.js), with the viewer the function builds from my_person() (never the page's);
//   - Claude reads the system only through ./tools.js, as the person who asked (their JWT goes
//     with every read, so row level security answers what their own screens answer); never the
//     vault or the clients' logins; money only for the owners (public.sees_money());
//   - at most MAX_ROUNDS rounds of tools, MAX_TOKENS a reply, RATE_PER_MINUTE questions a minute
//     for each person; the key is the secret ANTHROPIC_API_KEY (as contract-ai): never logged,
//     never sent back. Without it: 503 { error: 'ai_not_configured' };
//   - the Drive listing (../_shared/drive.js) only when the secret GOOGLE_DRIVE_SERVICE_ACCOUNT
//     is set; without it the drive tool answers "הדרייב עוד לא מחובר" and everything else works;
//   - nothing is kept and nothing is logged but a short code (no question, no answer, no rows).
import { mayAsk, cleanQuestion, cleanHistory } from '../_shared/app/ask-logic.js';
import { PEOPLE, scopeOf } from '../_shared/app/protocol.js';
import { serviceAccountOf, makeDrive } from '../_shared/drive.js';
import { TOOLS, runTool, guardDb } from './tools.js';
import { dayKeyIL, partsIL } from '../_shared/app/tz.js';
import { corsHeaders } from '../_shared/cors.js';

// A failed call to Claude, by the SDK's own error classes (as contract-ai).
export function failureOf(err, Errors = {}) {
  const is = (name) => typeof Errors[name] === 'function' && err instanceof Errors[name];
  if (is('APIConnectionTimeoutError')) return { status: 504, error: 'ai_timeout' };
  if (is('AuthenticationError') || is('PermissionDeniedError')) return { status: 503, error: 'ai_not_configured' };
  if (is('RateLimitError')) return { status: 503, error: 'ai_busy' };
  if (is('APIConnectionError')) return { status: 502, error: 'ai_unreachable' };
  return { status: 502, error: 'ai_failed' };
}
// A light per-person limit inside this instance (nothing is kept in the database).
export function makeLimiter(perMinute) {
  const seen = new Map();
  return (userId, at) => {
    const recent = (seen.get(userId) || []).filter((t) => at - t < 60000);
    if (recent.length >= perMinute) { seen.set(userId, recent); return false; }
    recent.push(at);
    seen.set(userId, recent);
    return true;
  };
}

// The current Sonnet, as contract-ai (the owner's choice of a cost-effective model, 25.10.2026):
// short answers over a few small tool results. Low effort: a lookup, not a puzzle.
export const MODEL = 'claude-sonnet-5-5';
export const EFFORT = 'low';
export const MAX_TOKENS = 6000;
export const MAX_ROUNDS = 6;
export const RATE_PER_MINUTE = 10;
export const TIMEOUT_MS = 40000;

const WEEKDAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

// The same on every call (cached with the tools): who the office is and how to answer.
export const SYSTEM = [
  'You answer questions from the staff of Astrateg, an Israeli marketing office that makes short videos, graphics and social content for small businesses with influencers (Natali Dadon, Niro, "הצל", Denis-Michel-Semion).',
  'Answer in Hebrew, short and plain: the number or the fact first, then at most a few short lines or a short list. No tables, no markdown headings. Dates as D.M (e.g. 3.11).',
  'Use the tools to read the system; never guess a number. If the tools do not hold the answer, say so in one line and say what you can tell instead.',
  'The tools read the system with the rights of the person asking: what they cannot see is simply missing. Never mention tools, JSON, tables or databases.',
  'Passwords and the clients\' logins are never available here: if asked, say that passwords are only in the vault in the client\'s card.',
  'When the tools hold no money fields, the person does not see prices or income: if asked about money, say that money is shown to the owners only.',
  'For a list or a total over many clients of what they are still owed (videos, graphics, shoot days…: "לכל לקוח כמה תכנים הוא לא קיבל"), call content_owed once, never client_details client by client: answer with the totals and the top few owing clients (up to 10, one short line each), then offer the rest.',
  'When several clients match a name, ask which one, listing them. When a Drive file is asked for, give its link.',
  'The person asking may be an owner, a manager, Ilai (graphics), an editor, the photographer or a field sales agent: answer only from what the tools return for them, never from what others might see.',
  'Questions on where something is or how to do something in the app ("איפה…", "איך…", "מה יש ב…", "איפה רואים…"): call app_guide and answer from it only, as the way in clicks with " ← " (e.g. "בתפריט ← הצעות שנשלחו") and then the link. Never describe a screen, tab or button that is not in app_guide\'s answer: if it is not there, say in one line that it is not in their screens and that the office can help.',
  'When the screen is in app_guide\'s "manager" list, say first to switch with the "מבט מנהל" button at the top of the screen. For one client\'s card or Gantt, find the client (find_clients with its name, or client_details) and give its app_links.',
  'Words: "פעיל" = active, "מסיים התקשרות" = ending. "לקוחות פעילים" means current clients (active or ending, not archived) unless asked otherwise. A monthly client gets a fixed number of videos every month; the others get the package\'s videos over the agreement.',
].join('\n');

export function contextLine(now, { name = null, seesMoney = false } = {}) {
  const p = partsIL(now);
  return `[היום יום ${WEEKDAYS[p.weekday]} ${dayKeyIL(now)} (שעון ישראל). שואל: ${name || 'הבעלים'}. ${seesMoney ? 'רואה כספים.' : 'לא רואה כספים.'}]`;
}

// The request to the Messages API for the conversation so far.
export function buildRequest(messages) {
  const tools = TOOLS.map((t, i) => (i === TOOLS.length - 1 ? { ...t, cache_control: { type: 'ephemeral' } } : t));
  return {
    model: MODEL,
    max_tokens: MAX_TOKENS,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: EFFORT },
    system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
    tools,
    messages,
  };
}

// The first user message: the earlier turns as plain text, then the question (the API is given
// the history this way so that no earlier model reply is replayed).
export function firstMessage(question, history, ctxLine) {
  const past = history.map((t) => `שאלה: ${t.q}\nתשובה: ${t.a}`).join('\n\n');
  const text = `${ctxLine}\n${past ? `השיחה עד עכשיו:\n${past}\n\n` : ''}השאלה: ${question}`;
  return { role: 'user', content: text };
}

const textOf = (message) => (Array.isArray(message?.content) ? message.content : [])
  .filter((b) => b?.type === 'text').map((b) => b.text).join('\n').trim();

// The loop: Claude, its tool calls, their results, until it answers (or MAX_ROUNDS).
// Returns { answer, model, tools } or { error, status }.
export async function converse({ client, ctx, question, history, ctxLine, Errors, log = () => {} }) {
  const messages = [firstMessage(question, history, ctxLine)];
  const used = [];
  for (let round = 0; round <= MAX_ROUNDS; round += 1) {
    const req = buildRequest(messages);
    // The last round: no more tools, an answer from what was read.
    if (round === MAX_ROUNDS) req.tool_choice = { type: 'none' };
    let message;
    try {
      message = await client.beta.messages.create(req);
    } catch (err) {
      const f = failureOf(err, Errors);
      log(`ask: ${f.error} (${err?.status ?? err?.name ?? 'error'})`);
      return { status: f.status, error: f.error };
    }
    if (message?.stop_reason === 'refusal') return { status: 422, error: 'ai_refused' };
    if (message?.stop_reason === 'tool_use') {
      const calls = (message.content || []).filter((b) => b?.type === 'tool_use');
      messages.push({ role: 'assistant', content: message.content });
      const results = await Promise.all(calls.map(async (b) => {
        used.push(b.name);
        const r = await runTool(ctx, b.name, b.input);
        return { type: 'tool_result', tool_use_id: b.id, content: r.content, ...(r.isError ? { is_error: true } : {}) };
      }));
      messages.push({ role: 'user', content: results });
      continue;
    }
    if (message?.stop_reason === 'max_tokens') return { status: 502, error: 'ai_incomplete' };
    const answer = textOf(message);
    if (!answer) return { status: 502, error: 'ai_failed' };
    return { answer, model: message.model ?? MODEL, tools: used };
  }
  return { status: 502, error: 'ai_failed' };
}

// deps: { env(name), createClient(url, key, opts?), makeClient(apiKey), Errors, now(), log(message), fetch }
export function makeHandler(deps) {
  const now = deps.now || (() => Date.now());
  const log = deps.log || (() => {});
  const allow = makeLimiter(RATE_PER_MINUTE);
  return async function handle(req) {
    const CORS = corsHeaders(req.headers.get('origin'));
    const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
    if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
    if (req.method !== 'POST') return json(405, { error: 'method not allowed' });

    const userClient = deps.createClient(deps.env('SUPABASE_URL'), deps.env('SUPABASE_ANON_KEY'), {
      global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
    });
    const { data: userData } = await userClient.auth.getUser();
    const user = userData?.user;
    if (!user) return json(401, { error: 'not_signed_in' });
    // Who asks: the database decides, not the menu.
    const [office, person, money] = await Promise.all(['is_office', 'my_person', 'sees_money'].map((fn) => userClient.rpc(fn)));
    const ok = !office.error && !person.error && mayAsk({ office: office.data, person: person.data ?? null });
    if (!ok) return json(403, { error: 'not_allowed' });
    const seesMoney = !money.error && money.data === true;

    let question;
    let history;
    try {
      const body = await req.json();
      const q = cleanQuestion(body?.question);
      if (q.error) return json(400, { error: q.error });
      question = q.text;
      history = cleanHistory(body?.history);
    } catch {
      return json(400, { error: 'question_required' });
    }

    const apiKey = deps.env('ANTHROPIC_API_KEY');
    if (!apiKey) return json(503, { error: 'ai_not_configured' });
    if (!allow(user.id, now())) return json(429, { error: 'rate_limited' });

    const sa = serviceAccountOf(deps.env('GOOGLE_DRIVE_SERVICE_ACCOUNT'));
    // Who asks, for the guide: from the database's answer, never from the page.
    const me = person.data ?? null;
    const viewer = { me: me && PEOPLE[me] ? me : null, scope: scopeOf(me), error: null };
    const ctx = {
      viewer,
      db: guardDb(userClient),
      seesMoney,
      drive: sa ? makeDrive(sa, { fetch: deps.fetch || globalThis.fetch }) : null,
      now: () => new Date(now()),
    };
    const out = await converse({
      client: deps.makeClient(apiKey), ctx, question, history, Errors: deps.Errors, log,
      ctxLine: contextLine(new Date(now()), { name: PEOPLE[me]?.name || null, seesMoney }),
    });
    if (out.error) return json(out.status || 502, { error: out.error });
    return json(200, out);
  };
}
