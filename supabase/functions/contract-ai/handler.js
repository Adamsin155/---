// The contract-ai function's work, free of Deno APIs so node tests run it whole
// (tests/contract-ai.test.mjs); index.ts gives it the environment, the Supabase client and
// the Anthropic SDK. "הכנת חוזה עם AI" (the owner, 25.10.2026; docs/ops.md, section 68):
//
//   POST { text }  →  200 { runId, result, dropped, model }
//
//   - the office only (public.is_office(): the owner, Irit, Lior, Ofir, Ilai), from the office's
//     own site, like create-quote;
//   - the key is the secret ANTHROPIC_API_KEY: never logged and never sent back. Without it:
//     503 { error: 'ai_not_configured' } (the builder says "החיבור ל־AI עוד לא הוגדר");
//   - the text and the builder's options (generated from app/catalog.js through the shared copy,
//     ../_shared/app/contract-ai-logic.js) go to Claude, which answers in strict JSON
//     (structured outputs); the answer is checked against the catalog here (unknown keys
//     dropped, numbers clamped) before it goes back, with the list of what was dropped;
//   - every preparation is kept in public.contract_ai_runs (who, when, the words, the checked
//     result): its id is what lets create-quote send the contract without a manager's approval
//     (the owner's decision of 25.10.2026), and the owners can see later what the AI prepared;
//   - at most RATE_PER_MINUTE preparations a minute for each person; the call to Claude is
//     bounded (the SDK's timeout, one retry), and a timeout answers 504 { error: 'ai_timeout' }.
// Nothing is sent to the client and nothing is created here: Irit reviews and sends as always.
import { systemPrompt, userMessage, RESULT_SCHEMA, validateAiResult, AI_TEXT_MAX } from '../_shared/app/contract-ai-logic.js';

export const SITE_ORIGINS = ['https://adamsin155.github.io', 'https://app.astrateg.tech'];

export function allowedOrigin(origin) {
  if (!origin) return null;
  if (SITE_ORIGINS.includes(origin)) return origin;
  try {
    const u = new URL(origin);
    if (u.protocol === 'http:' && u.hostname === 'localhost' && u.origin === origin) return origin;
  } catch { /* not a URL */ }
  return null;
}

export function corsHeaders(origin) {
  const headers = {
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  };
  const ok = allowedOrigin(origin);
  if (ok) headers['Access-Control-Allow-Origin'] = ok;
  return headers;
}

// The office only (public.is_office(): the owner, Irit, Lior, Ofir and Ilai), as create-quote.
// `rpc` is the caller's own client: (name) => { data, error }. An error, or anything but a plain
// true, is a no.
export async function callerIsOffice(rpc) {
  const { data, error } = await rpc('is_office');
  return !error && data === true;
}

// The Claude model that reads the deal: the current Sonnet (the owner's choice of a cost-effective
// model for a short extraction; the skill's model table, 25.10.2026).
export const MODEL = 'claude-sonnet-5-5';
// How hard it thinks: enough to tell the packages apart from "20 במקום 25", short enough that
// Irit does not wait (adaptive thinking is on by default on this model).
export const EFFORT = 'medium';
export const RATE_PER_MINUTE = 20;
export const TIMEOUT_MS = 30000;

// The request to the Messages API (client.beta.messages.create): the system prompt is the same
// on every call and is cached; the office's words come last. Server-side fallback ("default") is
// on: a decline the model's safeguards make in error is retried on the fallback model in the
// same call.
export function buildRequest(text) {
  return {
    model: MODEL,
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: EFFORT, format: { type: 'json_schema', schema: RESULT_SCHEMA } },
    system: [{ type: 'text', text: systemPrompt(), cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: userMessage(text) }],
  };
}

// The JSON of the answer, or why there is none: { raw } | { error }.
export function readAnswer(message) {
  if (!message || typeof message !== 'object') return { error: 'ai_failed' };
  if (message.stop_reason === 'refusal') return { error: 'ai_refused' };
  if (message.stop_reason === 'max_tokens') return { error: 'ai_incomplete' };
  const block = (Array.isArray(message.content) ? message.content : []).find((b) => b?.type === 'text');
  if (!block) return { error: 'ai_failed' };
  try {
    return { raw: JSON.parse(block.text) };
  } catch {
    return { error: 'ai_failed' };
  }
}

// What a failed call to Claude answers, by the SDK's own error classes (`Errors` is the SDK's
// default export, which carries them). A missing or wrong key is "not configured" for the office.
export function failureOf(err, Errors = {}) {
  const is = (name) => typeof Errors[name] === 'function' && err instanceof Errors[name];
  if (is('APIConnectionTimeoutError')) return { status: 504, error: 'ai_timeout' };
  if (is('AuthenticationError') || is('PermissionDeniedError')) return { status: 503, error: 'ai_not_configured' };
  if (is('RateLimitError')) return { status: 503, error: 'ai_busy' };
  if (is('APIConnectionError')) return { status: 502, error: 'ai_unreachable' };
  return { status: 502, error: 'ai_failed' };
}

// A light per-person limit inside this instance, before the database's count.
export function makeLimiter(perMinute = RATE_PER_MINUTE) {
  const seen = new Map();
  return (userId, at) => {
    const recent = (seen.get(userId) || []).filter((t) => at - t < 60000);
    if (recent.length >= perMinute) { seen.set(userId, recent); return false; }
    recent.push(at);
    seen.set(userId, recent);
    return true;
  };
}

// The office's words: a string of 1 to AI_TEXT_MAX characters (after trimming).
export function cleanText(v) {
  if (typeof v !== 'string') return { error: 'text_required' };
  const text = v.replace(/\r\n?/g, '\n').trim();
  if (!text) return { error: 'text_required' };
  if (text.length > AI_TEXT_MAX) return { error: 'text_too_long' };
  return { text };
}

// deps: { env(name), serviceKey(), createClient(url, key, opts?), makeClient(apiKey), Errors,
//         now(), log(message) }
export function makeHandler(deps) {
  const now = deps.now || (() => Date.now());
  const log = deps.log || (() => {});
  const allow = makeLimiter();
  return async function handle(req) {
    const CORS = corsHeaders(req.headers.get('origin'));
    const json = (status, body) => new Response(JSON.stringify(body), {
      status,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
    if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
    if (req.method !== 'POST') return json(405, { error: 'method not allowed' });

    const url = deps.env('SUPABASE_URL');
    const userClient = deps.createClient(url, deps.env('SUPABASE_ANON_KEY'), {
      global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
    });
    const { data: userData } = await userClient.auth.getUser();
    const user = userData?.user;
    if (!user) return json(401, { error: 'not signed in' });
    // The words "not staff" become Hebrew in the builder (explainError in app/supa.js).
    if (!(await callerIsOffice((fn) => userClient.rpc(fn)))) return json(403, { error: 'not staff: contracts are prepared by the office' });

    let text;
    try {
      const body = await req.json();
      const t = cleanText(body?.text);
      if (t.error) return json(400, { error: t.error });
      text = t.text;
    } catch {
      return json(400, { error: 'text_required' });
    }

    const apiKey = deps.env('ANTHROPIC_API_KEY');
    if (!apiKey) return json(503, { error: 'ai_not_configured' });

    const at = now();
    if (!allow(user.id, at)) return json(429, { error: 'rate_limited' });
    const admin = deps.createClient(url, deps.serviceKey());
    // The same limit across instances (the database keeps every run). Without the table (the
    // migration not applied yet) only the instance's own limit holds.
    const { count, error: countError } = await admin.from('contract_ai_runs').select('id', { count: 'exact', head: true })
      .eq('user_id', user.id).gte('created_at', new Date(at - 60000).toISOString());
    if (!countError && (count ?? 0) >= RATE_PER_MINUTE) return json(429, { error: 'rate_limited' });
    const keep = async (row) => {
      const { data, error } = await admin.from('contract_ai_runs')
        .insert({ user_id: user.id, by_email: user.email ?? null, deal_text: text, model: MODEL, ...row })
        .select('id').single();
      if (error) log(`contract-ai: the run was not kept (${error.code ?? 'error'})`);
      return error ? null : data?.id ?? null;
    };

    let message;
    try {
      message = await deps.makeClient(apiKey).beta.messages.create(buildRequest(text));
    } catch (err) {
      const f = failureOf(err, deps.Errors);
      // The status only: never the key, the headers or the office's words.
      log(`contract-ai: ${f.error} (${err?.status ?? err?.name ?? 'error'})`);
      await keep({ status: 'error', result: { error: f.error } });
      return json(f.status, { error: f.error });
    }
    const answer = readAnswer(message);
    if (answer.error) {
      log(`contract-ai: ${answer.error} (${message?.stop_reason ?? 'no stop reason'})`);
      await keep({ status: 'error', result: { error: answer.error } });
      return json(502, { error: answer.error });
    }
    const { result, dropped } = validateAiResult(answer.raw);
    const runId = await keep({ status: 'ok', result, left_out: dropped });
    return json(200, { runId, result, dropped, model: message.model ?? MODEL });
  };
}
