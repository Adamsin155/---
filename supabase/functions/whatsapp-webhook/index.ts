// Meta's WhatsApp webhook for the staff messages (stage 4; docs/ops.md, "וואטסאפ
// לצוות"). Deployed with verify_jwt=false (supabase/config.toml): Meta calls it
// without a Supabase token, so it checks every call itself (./webhook.js):
//   GET   hub.verify_token against the Vault secret 'whatsapp_verify_token'.
//   POST  X-Hub-Signature-256 against HMAC-SHA256 of the raw body with the Vault
//         secret 'whatsapp_app_secret', in constant time; anything unsigned is 401.
// The secrets are read through public.whatsapp_webhook_secrets() (service role
// only) and never logged. Replies are applied by public.whatsapp_apply (once per
// incoming message id); delivery updates by public.whatsapp_status.
import { createClient } from 'npm:@supabase/supabase-js@2';
//
// When the provider is Jako (docs/ops.md, section 63) Meta does not call here: the
// sub flows of Jako's reply buttons do, with the header x-astrateg-hook (the Vault
// secret 'whatsapp_jako_hook_secret', through public.whatsapp_jako_hook()), and get
// a sentence back for the person (./jako-hook.js has the whole contract).
import { verifySignature, verifyChallenge, parseEvents, handleEvents } from './webhook.js';
import { HOOK_HEADER, HOOK_MAX_BODY, hookGate, jakoReply } from './jako-hook.js';
import { hookAnswer } from '../_shared/app/wa-logic.js';
import { graphSend } from '../_shared/wa-graph.js';

function serviceKey(): string {
  try {
    const keys = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}');
    if (keys?.default) return keys.default;
  } catch { /* not set */ }
  return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
}
const admin = createClient(Deno.env.get('SUPABASE_URL')!, serviceKey(), {
  auth: { persistSession: false, autoRefreshToken: false },
});

type Row = Record<string, any>;
const codeOf = (e: unknown) => (e as { code?: string })?.code ?? (e as Error)?.name ?? 'error';
const MAX_BODY = 1_000_000;

// Secrets, read from Vault once in a while (never logged).
let cache: { at: number; secrets: Row | null; config: Row | null; hook: Row | null } | null = null;
async function settings() {
  if (cache && Date.now() - cache.at < 5 * 60e3) return cache;
  const [s, c, h] = await Promise.all([admin.rpc('whatsapp_webhook_secrets'), admin.rpc('whatsapp_config'), admin.rpc('whatsapp_jako_hook')]);
  if (s.error) throw s.error;
  if (c.error) throw c.error;
  // Before migration 20261025100000 there is no second provider: Meta only.
  if (h.error && h.error.code !== 'PGRST202') throw h.error;
  const one = (d: unknown) => (Array.isArray(d) ? d[0] : d) as Row | null;
  cache = { at: Date.now(), secrets: one(s.data), config: one(c.data), hook: h.error ? null : one(h.data) };
  return cache;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const db = {
  async status(s: Row) {
    const { data, error } = await admin.rpc('whatsapp_status', { p_wa_id: s.id, p_status: s.status, p_at: s.at ? s.at.toISOString() : null, p_error: s.error });
    if (error) throw error;
    return data === true;
  },
  async messageByWaId(id: string) {
    const { data, error } = await admin.from('whatsapp_messages').select('id, log_id, person, email, phone, template').eq('wa_message_id', id).maybeSingle();
    if (error) throw error;
    return data;
  },
  async logRow(id: number) {
    const { data, error } = await admin.from('reminder_log').select('id, key, rule, person, level, client_id, ref, title').eq('id', id).maybeSingle();
    if (error) throw error;
    return data;
  },
  async task(id: string) {
    if (!UUID.test(id)) return null;
    const { data, error } = await admin.from('client_tasks').select('id, owner, done_at, started_at, source, brief, result').eq('id', id).maybeSingle();
    if (error) throw error;
    return data;
  },
  async client(id: string) {
    if (!UUID.test(id)) return null;
    const { data, error } = await admin.from('clients').select('id, editor, rounds, shoot_type, shoot_at, char_at').eq('id', id).is('archived_at', null).maybeSingle();
    if (error) throw error;
    return data;
  },
  async apply({ inbound, message, from, plan }: Row) {
    const { data, error } = await admin.rpc('whatsapp_apply', { p_inbound: inbound, p_message: message, p_from: from, p_plan: plan });
    if (error) throw error;
    return data as string;
  },
};

// A reply through Jako (./jako-hook.js): the last message with that button, its
// reminder and item, and the database function that applies it once.
const hookDb = {
  async last({ phones, templates, since }: Row) {
    const { data, error } = await admin.from('whatsapp_messages').select('id, log_id, person, email, phone, template')
      .eq('provider', 'jako').eq('status', 'sent').in('phone', phones).in('template', templates).gte('sent_at', since.toISOString())
      .order('id', { ascending: false }).limit(1);
    if (error) throw error;
    return data?.[0] ?? null;
  },
  logRow: db.logRow,
  task: db.task,
  client: db.client,
  async nag(id: string) {
    if (!UUID.test(id)) return null;
    const { data, error } = await admin.from('staff_tasks').select('id, assignee, status, body').eq('id', id).maybeSingle();
    if (error) throw error;
    return data;
  },
  async answered(inbound: string) {
    const { data, error } = await admin.from('whatsapp_inbound').select('id').eq('id', inbound).maybeSingle();
    if (error) throw error;
    return !!data;
  },
  async apply({ inbound, message, from, plan }: Row) {
    const { data, error } = await admin.rpc('whatsapp_jako_reply', { p_inbound: inbound, p_message: message, p_from: from, p_plan: plan });
    if (error) throw error;
    return data as string;
  },
};

Deno.serve(async (req) => {
  const text = (status: number, body = '') => new Response(body, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });
  let conf;
  try {
    conf = await settings();
  } catch (e) {
    console.error('whatsapp-webhook: settings failed', codeOf(e));
    return text(500);
  }
  const secrets = conf.secrets ?? {};

  // Jako's sub flows (a call that carries their header, or any call while the provider is Jako).
  const given = req.headers.get(HOOK_HEADER);
  if (given !== null || conf.hook?.provider === 'jako') {
    const stop = hookGate({ provider: conf.hook?.provider, secret: conf.hook?.hook_secret, given, method: req.method });
    if (stop) return text(stop.status, stop.body);
    const answer = (out: { ok: boolean; text: string }) => new Response(JSON.stringify({ ok: out.ok, text: out.text }), {
      status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
    });
    if (Number(req.headers.get('content-length') || 0) > HOOK_MAX_BODY) return text(413);
    const raw = new Uint8Array(await req.arrayBuffer());
    if (raw.length > HOOK_MAX_BODY) return text(413);
    let body = null;
    try { body = JSON.parse(new TextDecoder().decode(raw)); } catch { /* answered as not understood */ }
    try {
      return answer(await jakoReply({ db: hookDb, body }));
    } catch (e) {
      console.error('whatsapp-webhook: a reply was not applied', codeOf(e));
      return answer(hookAnswer('error'));
    }
  }

  if (req.method === 'GET') {
    if (!secrets.verify_token) return text(503, 'not ready');
    const r = verifyChallenge(new URL(req.url).searchParams, secrets.verify_token);
    return text(r.status, r.body);
  }
  if (req.method !== 'POST') return text(405);
  if (!secrets.app_secret) return text(503, 'not ready');
  if (Number(req.headers.get('content-length') || 0) > MAX_BODY) return text(413);
  const raw = new Uint8Array(await req.arrayBuffer());
  if (raw.length > MAX_BODY) return text(413);
  if (!(await verifySignature({ secret: secrets.app_secret, body: raw, header: req.headers.get('x-hub-signature-256') }))) return text(401);
  let payload;
  try { payload = JSON.parse(new TextDecoder().decode(raw)); } catch { return text(400); }

  const cfg = conf.config;
  const send = cfg?.enabled && cfg.access_token && cfg.phone_number_id
    ? (message: Row) => graphSend({ fetch, token: cfg.access_token, phoneNumberId: cfg.phone_number_id, message })
    : null;
  try {
    await handleEvents({ db, events: parseEvents(payload, secrets.phone_number_id), send });
    return text(200, 'ok');
  } catch (e) {
    // Meta sends it again later; every step is safe to repeat.
    console.error('whatsapp-webhook: not applied', codeOf(e));
    return text(500);
  }
});
