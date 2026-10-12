// The reply buttons of the staff WhatsApp messages when the provider is Jako
// (docs/ops.md, section 63), without Deno APIs so node tests it
// (tests/whatsapp.test.mjs); ./index.ts is the server.
//
// Jako has no outgoing webhook: each button starts a sub flow in Jako, and the sub
// flow's "external request" calls this function:
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
// Which reminder a reply means (the owner's rule of 13.10.2026: every reply counts
// for its own task only). The call says who pressed and which button, not on which
// message; but the press itself is in that person's chat at Jako, with the id of the
// message it answers. So the chat is read (the last few minutes), the newest press of
// that button not yet handled is taken, and it is matched to our message by that id:
// the exact message, and its task (../_shared/wa-jako-reply.js).
// Only when that cannot be done (the chat could not be read, the press is not there
// yet, or the message's id was never learned) the reply counts for the LAST message
// sent to that person in the last 24 hours that had that button, and the stored
// result says so. Either way the answer names the task it acted on, so a wrong match
// is seen at once. Nothing of the request is stored but which button, on which
// message, and the result (public.whatsapp_inbound).
import { timingSafeEqual } from './webhook.js';
import { applyReply, applyPress } from '../_shared/wa-jako-reply.js';
import { hookPhone, hookAction, hookAnswer } from '../_shared/app/wa-logic.js';
import { JAKO_TEMPLATES } from '../_shared/app/wa-templates.js';

export const HOOK_HEADER = 'x-astrateg-hook';
export const HOOK_MAX_BODY = 4096;
// The fallback looks this far back for the last message; the chat, this far for the press.
export const HOOK_WINDOW = 24 * 3600e3;
export const PRESS_WINDOW = 10 * 6e4;

// The secret a call carries: the header, or (Jako's editor has no place for a header of
// our own) the body's "secret". The header wins when both are there.
export const hookSecretOf = (header, body) => (typeof header === 'string' && header ? header
  : body && typeof body === 'object' && !Array.isArray(body) && typeof body.secret === 'string' ? body.secret.trim() : null);

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
 * Applies one reply. `db`: as ../_shared/wa-jako-reply.js, and
 *   last({ phones, templates, since }) → the newest Jako message sent to one of these numbers
 *        since then with one of these templates: { id, log_id, person, email, phone, template } or null
 * `chat({ userId, since, until })`: Jako's chat of a contact (../_shared/wa-jako.js `incoming`);
 * null when there is no API key to read it with.
 * @returns {Promise<{ ok: boolean, text: string, result: string, match?: string }>}
 */
export async function jakoReply({ db, chat = null, body, now = new Date() }) {
  const answer = (result, title = '', match = undefined) => ({ ...hookAnswer(result, title), result, ...(match ? { match } : {}) });
  const req = parseHook(body);
  if (!req) return answer('bad');
  const { action, phones } = req;

  // The press itself, from the person's chat: the newest of this button not handled yet.
  let pressed = null;
  if (chat) {
    let seen = 0;
    let handled = 0;
    for (const userId of phones) {
      const res = await chat({ userId, since: new Date(now.getTime() - PRESS_WINDOW), until: now }).catch(() => null);
      for (const press of res?.ok ? res.presses : []) {
        if (hookAction(press.title) !== action) continue;
        seen += 1;
        if (await db.answered(press.mid)) { handled += 1; continue; }
        if (!pressed || press.at > pressed.at) pressed = press;
      }
    }
    if (pressed) {
      const exact = await applyPress({ db, press: pressed, phones });
      if (exact) return answer(exact.result, exact.title, 'exact');
    } else if (seen && handled === seen) {
      // Every press of this button was already applied (by an earlier call, or by the
      // reminders function reading the chat): said, and nothing changes.
      return answer('duplicate');
    }
  }

  // The fallback: the last message with this button. The press, when it was seen, is
  // what makes the reply one; else the button on that message.
  const templates = Object.entries(JAKO_TEMPLATES).filter(([, t]) => t.replies.includes(action)).map(([key]) => key);
  const message = await db.last({ phones, templates, since: new Date(now.getTime() - HOOK_WINDOW) });
  if (!message) return answer('nothing');
  const out = await applyReply({ db, action, message, inbound: pressed?.mid || `jako:${action}:${message.id}`, match: 'last' });
  return answer(out.result, out.title, 'last');
}
