// Meta's WhatsApp webhook (stage 4), without Deno APIs so node tests it
// (tests/whatsapp.test.mjs); ./index.ts is the server.
//   GET   the subscription check: hub.verify_token must equal the Vault secret
//         'whatsapp_verify_token'; the answer is hub.challenge.
//   POST  X-Hub-Signature-256 = sha256=HMAC-SHA256(app secret, the raw body),
//         compared in constant time; then delivery updates (sent, delivered, read,
//         failed) and replies: a quick reply button on one of our messages, or
//         "הסר" (stop). Each incoming message is applied once (its id).
// Nothing of what people write is stored: only which button, on which reminder.
import { parsePayload, actionOfText, taskIdOf, textMessage } from '../_shared/app/wa-templates.js';
import { replyPlan, isStop, ackText } from '../_shared/app/wa-logic.js';

const enc = new TextEncoder();
const bytes = (x) => (typeof x === 'string' ? enc.encode(x) : x instanceof Uint8Array ? x : new Uint8Array(x));

// Equal strings, in a time that does not depend on where they differ.
export function timingSafeEqual(a, b) {
  const x = enc.encode(String(a ?? ''));
  const y = enc.encode(String(b ?? ''));
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i += 1) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

export async function hmacSha256Hex(secret, body) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, bytes(body)));
  return [...sig].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Whether the X-Hub-Signature-256 header signs this raw body with the app secret.
export async function verifySignature({ secret, body, header }) {
  if (!secret || typeof header !== 'string') return false;
  const m = /^sha256=([0-9a-fA-F]{64})$/.exec(header.trim());
  if (!m) return false;
  return timingSafeEqual(await hmacSha256Hex(secret, body), m[1].toLowerCase());
}

// Meta's subscription check (GET). The challenge is echoed only when it looks like one.
export function verifyChallenge(params, token) {
  const mode = params.get('hub.mode');
  const given = params.get('hub.verify_token');
  const challenge = params.get('hub.challenge') || '';
  if (mode === 'subscribe' && token && given && timingSafeEqual(given, token) && /^[A-Za-z0-9_-]{1,200}$/.test(challenge)) {
    return { status: 200, body: challenge };
  }
  return { status: 403, body: 'forbidden' };
}

const list = (x) => (Array.isArray(x) ? x : []);
const phoneOf = (x) => (/^\d{8,15}$/.test(String(x || '')) ? String(x) : null);
const idOf = (x) => (typeof x === 'string' && x.length >= 1 && x.length <= 200 ? x : null);
const timeOf = (ts) => (/^\d{9,11}$/.test(String(ts || '')) ? new Date(Number(ts) * 1000) : null);
export const STATUSES = new Set(['sent', 'delivered', 'read', 'failed']);

// The events of one POST, for our number only (another number of the same
// business account is not ours to handle).
//   statuses: [{ id, status, at, error }]            delivery of our messages
//   replies:  [{ id, from, context, action, logId }] a button on one of our messages
//   stops:    [{ id, from }]                          "הסר" and the like
export function parseEvents(payload, phoneNumberId) {
  const out = { statuses: [], replies: [], stops: [] };
  if (payload?.object !== 'whatsapp_business_account') return out;
  for (const entry of list(payload.entry)) {
    for (const change of list(entry?.changes)) {
      const v = change?.value;
      if (change?.field !== 'messages' || !v) continue;
      if (!phoneNumberId || String(v.metadata?.phone_number_id ?? '') !== String(phoneNumberId)) continue;
      for (const s of list(v.statuses)) {
        const id = idOf(s?.id);
        if (!id || !STATUSES.has(s.status)) continue;
        const code = s.errors?.[0]?.code;
        out.statuses.push({ id, status: s.status, at: timeOf(s.timestamp), error: s.status === 'failed' ? `meta${Number.isInteger(code) ? ` #${code}` : ''}` : null });
      }
      for (const m of list(v.messages)) {
        const id = idOf(m?.id);
        const from = phoneOf(m?.from);
        if (!id || !from) continue;
        let payloadText = null;
        let label = null;
        if (m.type === 'button') { payloadText = m.button?.payload; label = m.button?.text; }
        else if (m.type === 'interactive' && m.interactive?.type === 'button_reply') { payloadText = m.interactive.button_reply?.id; label = m.interactive.button_reply?.title; }
        if (payloadText != null || label != null) {
          const p = parsePayload(payloadText);
          out.replies.push({ id, from, context: idOf(m.context?.id), action: p?.action || actionOfText(label), logId: p?.logId ?? null });
        } else if (m.type === 'text' && isStop(m.text?.body)) {
          out.stops.push({ id, from });
        }
      }
    }
  }
  return out;
}

/**
 * Applies the events. `db`: { status(s), messageByWaId(id), logRow(id), task(id),
 * client(id), apply({ inbound, message, from, plan }) → result }. `send(message)` answers a
 * reply (null while WhatsApp is off).
 */
export async function handleEvents({ db, events, send = null }) {
  const done = { statuses: 0, replies: [], stops: [] };
  for (const s of events.statuses) if (await db.status(s)) done.statuses += 1;
  const answer = async (to, result) => {
    const text = result === 'unknown' ? null : ackText(result);
    if (text && send) await send(textMessage({ to, text })).catch(() => null);
  };
  for (const r of events.replies) {
    const message = r.context ? await db.messageByWaId(r.context) : null;
    // A payload names its reminder: a reply that names another is not applied.
    const same = !message || !r.logId || Number(message.log_id) === r.logId;
    const log = message && same ? await db.logRow(message.log_id) : null;
    const taskId = log ? taskIdOf(log) : null;
    const task = taskId ? await db.task(taskId) : null;
    const client = log?.ref && log.client_id && r.action === 'onit' ? await db.client(log.client_id) : null;
    const plan = !r.action ? { op: 'none', why: 'no_button' } : !same ? { op: 'none', why: 'mismatch' } : replyPlan({ action: r.action, log, message, task, client });
    const result = await db.apply({ inbound: r.id, message: message?.id ?? null, from: r.from, plan });
    done.replies.push({ id: r.id, op: plan.op, result });
    await answer(r.from, result);
  }
  for (const s of events.stops) {
    const result = await db.apply({ inbound: s.id, message: null, from: s.from, plan: { op: 'withdraw' } });
    done.stops.push({ id: s.id, result });
    await answer(s.from, result);
  }
  return done;
}
