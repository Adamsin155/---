// The reply buttons of the staff WhatsApp messages when the provider is Jako
// (docs/ops.md, section 63), without Deno APIs so node tests it
// (tests/whatsapp.test.mjs); ./index.ts is the server.
//
// Jako has no outgoing webhook, and a quick reply there does not come back with its
// message: each button starts a sub flow in Jako, and the sub flow's "external
// request" calls this function:
//   POST, header x-astrateg-hook: <the Vault secret 'whatsapp_jako_hook_secret'>
//   { "action": "done" | "onit" (or the button's own text),
//     "user_id": "<the person's WhatsApp id: the number in digits>", "phone": "<their phone>" }
// and sends the answer's `text` back to the person:
//   200 { "ok": true | false, "text": "<one short sentence>" }   for the right secret, always
//   401, no body                                                   a wrong or missing secret
//   503 "not ready"                                                the provider is not Jako, or no secret in Vault
//
// (Other fields, such as a "ref" or "task" the provider may add, are ignored: nothing
// in the request but the number and the button is trusted.)
//
// Which reminder a reply means (the owner's rule of 13.10.2026): the task of the LAST
// message sent to that person through Jako, in the last 24 hours, that had that
// button, if it is still open. Nothing older and nothing else. So a press on an older
// message, while a newer one with the same button exists, counts for the newer one:
// that is why the answer names the task it acted on. Each button is applied once per
// message, in the person's name. Nothing of the request is stored but which button,
// on which message, and the result (public.whatsapp_inbound).
import { timingSafeEqual } from './webhook.js';
import { hookPhone, hookAction, hookAnswer, nagIdOf, jakoOpen, jakoReplyPlan, jakoTitle } from '../_shared/app/wa-logic.js';
import { JAKO_TEMPLATES, taskIdOf } from '../_shared/app/wa-templates.js';

export const HOOK_HEADER = 'x-astrateg-hook';
export const HOOK_MAX_BODY = 4096;
export const HOOK_WINDOW = 24 * 3600e3;

// Whether the call may be answered at all. → null (go on) or { status, body }.
export function hookGate({ provider, secret, given, method }) {
  if (provider !== 'jako' || !secret || String(secret).length < 16) return { status: 503, body: 'not ready' };
  if (!given || !timingSafeEqual(given, secret)) return { status: 401, body: '' };
  if (method !== 'POST') return { status: 405, body: '' };
  return null;
}

// The request's JSON → { action, phones } (the numbers it may mean: user_id, phone), or null.
export function parseHook(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const action = hookAction(body.action);
  const phones = [...new Set([hookPhone(body.user_id), hookPhone(body.phone)].filter(Boolean))];
  return action && phones.length ? { action, phones } : null;
}

/**
 * Applies one reply. `db`:
 *   last({ phones, templates, since }) → the newest Jako message sent to one of these numbers
 *        since then with one of these templates: { id, log_id, person, email, phone, template } or null
 *   logRow(id), task(id), client(id), nag(id), answered(inbound) → boolean
 *   apply({ inbound, message, from, plan }) → result
 * @returns {Promise<{ ok: boolean, text: string, result: string }>}
 */
export async function jakoReply({ db, body, now = new Date() }) {
  const answer = (result, title = '') => ({ ...hookAnswer(result, title), result });
  const req = parseHook(body);
  if (!req) return answer('bad');
  const { action } = req;
  // The templates that carry this button; the last message with one of them is the one meant.
  const templates = Object.entries(JAKO_TEMPLATES).filter(([, t]) => t.replies.includes(action)).map(([key]) => key);
  const message = await db.last({ phones: req.phones, templates, since: new Date(now.getTime() - HOOK_WINDOW) });
  const log = message ? await db.logRow(message.log_id) : null;
  // A reminder that is not this person's is not theirs to answer.
  if (!message || !log || log.person !== message.person) return answer('nothing');
  const inbound = `jako:${action}:${message.id}`;
  // The same button on the same message again: said, and nothing changes.
  if (await db.answered(inbound)) return answer('duplicate');
  const taskId = taskIdOf(log);
  const task = taskId ? await db.task(taskId) : null;
  const nag = nagIdOf(log) ? await db.nag(nagIdOf(log)) : null;
  if (!jakoOpen({ action, log, task, nag })) return answer('closed');
  const client = action === 'onit' && log.ref && log.client_id ? await db.client(log.client_id) : null;
  const plan = jakoReplyPlan({ action, log, message, task, client, nag });
  const result = await db.apply({ inbound, message: message.id, from: message.phone, plan });
  return answer(result, jakoTitle({ log, nag }));
}
