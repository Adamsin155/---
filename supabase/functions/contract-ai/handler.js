// The contract-ai function's work, free of Deno APIs so node tests run it whole
// (tests/contract-ai.test.mjs); index.ts gives it the environment, the Supabase client and
// the Anthropic SDK. "הכנת חוזה עם AI" (the owner, 25.10.2026; docs/ops.md, section 68):
//
//   POST { text }  →  200 { runId, result, dropped, model }
//   POST { text, mode: 'free' }  →  200 { mode: 'free', runId, runIds, result: { drafts, questions,
//     notes }, dropped, model }: "בדיוק כמו שכתבתי (חוזה חופשי)" (the owner, 29.10.2026; docs/ops.md,
//     section 79): the text as one or more custom contracts exactly as written, nothing mapped
//     onto a package. Each draft is kept as its own run (runIds, in the drafts' order), so each
//     contract made from it carries its own "הוכן ע״י AI";
//
//   POST { mode: 'read', fileId }  →  200 { mode: 'read', runId, clientId, fileId, result, dropped,
//     model }: "קריאת חוזה חתום" (5.11.2026; docs/ops.md, section 104): a signed contract uploaded by
//     hand (public.client_files, "חוזה חתום") is read from storage here (only for a caller who may
//     add files to that client) and its details come back for the uploader to confirm;
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
//     result): its id marks the contract made from it "הוכן ע״י AI" (create-quote), and the
//     owners can see later what the AI prepared (no contract waits for a manager since 29.10.2026);
//   - at most RATE_PER_MINUTE preparations a minute for each person; the call to Claude is
//     bounded (the SDK's timeout, one retry), and a timeout answers 504 { error: 'ai_timeout' }.
// Nothing is sent to the client and nothing is created here: Irit reviews and sends as always.
import {
  systemPrompt, userMessage, RESULT_SCHEMA, validateAiResult, AI_TEXT_MAX,
  freeSystemPrompt, FREE_SCHEMA, validateFreeResult,
} from '../_shared/app/contract-ai-logic.js';
import { isOAuthToken } from '../_shared/oauth-token.js';
import {
  READ_SCHEMA, readSystemPrompt, READ_USER_TEXT, validateReadResult, readMediaOf, readTooBig,
} from '../_shared/app/contract-read-logic.js';
import { isContractFile } from '../_shared/app/contract-file.js';

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
export const MODES = ['catalog', 'free', 'read'];
export function buildRequest(text, mode = 'catalog') {
  const free = mode === 'free';
  return {
    model: MODEL,
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: EFFORT, format: { type: 'json_schema', schema: free ? FREE_SCHEMA : RESULT_SCHEMA } },
    system: [{ type: 'text', text: free ? freeSystemPrompt() : systemPrompt(), cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: userMessage(text) }],
  };
}

// "קריאת חוזה חתום" (5.11.2026; docs/ops.md, section 104): the signed contract's file itself goes to
// the model (a PDF as a document, a picture as an image), with the strict schema of
// app/contract-read-logic.js. The file's bytes are never logged.
export function buildReadRequest(media, base64) {
  const source = { type: 'base64', media_type: media.mime, data: base64 };
  return {
    model: MODEL,
    max_tokens: 4000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'low', format: { type: 'json_schema', schema: READ_SCHEMA } },
    system: [{ type: 'text', text: readSystemPrompt(), cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: [{ type: media.kind, source }, { type: 'text', text: READ_USER_TEXT }] }],
  };
}

// Bytes to base64, in chunks (no Buffer in Deno; btoa is in both).
export function toBase64(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(out);
}
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
    // A connected app's token is for the mcp function alone (docs/ops.md, section 84).
    if (isOAuthToken(req.headers.get('authorization'))) return json(403, { error: 'not_allowed' });

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
    let mode = 'catalog';
    let fileId = null;
    let body;
    try {
      body = await req.json();
    } catch {
      return json(400, { error: 'text_required' });
    }
    if (body?.mode === 'read') {
      // "קריאת חוזה חתום": the file's id, not words.
      if (typeof body.fileId !== 'string' || !UUID.test(body.fileId)) return json(400, { error: 'file_required' });
      mode = 'read';
      fileId = body.fileId.toLowerCase();
      text = `קריאת חוזה חתום: ${fileId}`;
    } else {
      const t = cleanText(body?.text);
      if (t.error) return json(400, { error: t.error });
      text = t.text;
      if (body?.mode !== undefined && body?.mode !== null) {
        if (!MODES.includes(body.mode)) return json(400, { error: 'mode_unknown' });
        mode = body.mode;
      }
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

    let request;
    let readFile = null;
    if (mode === 'read') {
      // The file: a signed contract of a client the caller may add files to (as the upload itself).
      const { data: f, error: fe } = await admin.from('client_files')
        .select('id, client_id, kind, label, storage_path, mime, size_bytes, deleted_at').eq('id', fileId).maybeSingle();
      if (fe || !f || !isContractFile(f)) return json(404, { error: 'file_not_found' });
      const { data: may, error: me } = await userClient.rpc('can_upload_client_file', { p_client: f.client_id, p_kind: 'material_other' });
      if (me || may !== true) return json(403, { error: 'not_allowed' });
      const media = readMediaOf(f.mime, f.storage_path);
      if (media.error) return json(415, { error: media.error });
      if (readTooBig(media, f.size_bytes)) return json(413, { error: 'read_too_big' });
      const { data: blob, error: de } = await admin.storage.from('client-files').download(f.storage_path);
      if (de || !blob) {
        log(`contract-ai: read: the file did not download (${de?.name ?? 'error'})`);
        return json(502, { error: 'file_unreadable' });
      }
      const bytes = new Uint8Array(await blob.arrayBuffer());
      if (readTooBig(media, bytes.length)) return json(413, { error: 'read_too_big' });
      readFile = f;
      request = buildReadRequest(media, toBase64(bytes));
    } else {
      request = buildRequest(text, mode);
    }
    let message;
    try {
      message = await deps.makeClient(apiKey).beta.messages.create(request);
    } catch (err) {
      const f = failureOf(err, deps.Errors);
      // The status only: never the key, the headers or the office's words.
      log(`contract-ai: ${f.error} (${err?.status ?? err?.name ?? 'error'})`);
      // What the API said (its status, type and message: never the key or the office's words), for the office to see why.
      const api = err?.error?.error || {};
      await keep({ status: 'error', result: { error: f.error, http: err?.status ?? null, type: api.type ?? err?.name ?? null, why: String(api.message ?? err?.message ?? '').slice(0, 300) } });
      return json(f.status, { error: f.error });
    }
    const answer = readAnswer(message);
    if (answer.error) {
      log(`contract-ai: ${answer.error} (${message?.stop_reason ?? 'no stop reason'})`);
      await keep({ status: 'error', result: { error: answer.error, stop: message?.stop_reason ?? null, blocks: (message?.content || []).map((x) => x?.type) } });
      return json(502, { error: answer.error });
    }
    if (mode === 'read') {
      const { result, dropped } = validateReadResult(answer.raw, new Date(at));
      const runId = await keep({ status: 'ok', result: { mode: 'read', fileId, clientId: readFile.client_id, value: result }, left_out: dropped });
      return json(200, { mode: 'read', runId, clientId: readFile.client_id, fileId, result, dropped, model: message.model ?? MODEL });
    }
    if (mode === 'free') {
      const { result, dropped } = validateFreeResult(answer.raw);
      const runIds = [];
      // One run for each draft (each makes one contract); a text with no draft still leaves its run.
      for (const [i, draft] of (result.drafts.length ? result.drafts : [null]).entries()) {
        runIds.push(await keep({ status: 'ok', result: { mode: 'free', draft: i + 1, of: result.drafts.length, ...(draft ? { value: draft } : {}), questions: result.questions, notes: result.notes }, left_out: dropped }));
      }
      return json(200, { mode: 'free', runId: runIds[0] ?? null, runIds: result.drafts.length ? runIds : [], result, dropped, model: message.model ?? MODEL });
    }
    const { result, dropped } = validateAiResult(answer.raw);
    const runId = await keep({ status: 'ok', result, left_out: dropped });
    return json(200, { runId, result, dropped, model: message.model ?? MODEL });
  };
}
