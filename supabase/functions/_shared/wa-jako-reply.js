// A reply button of the staff WhatsApp messages when the provider is Jako
// (docs/ops.md, section 63), applied to the message it belongs to. Hand-written, no
// Deno APIs: the whatsapp-webhook function (the call from Jako's sub flow) and the
// reminders function (the chat poll, for a press no call reported) both run it,
// and the node tests fake `db`.
//
// A press appears in the person's chat at Jako as a row whose `reply_to_mid` is the
// id of the message whose button it was, and that id is on our row
// (whatsapp_messages.wa_message_id, read back after the send; ./wa-jako.js). So a
// press means one message, exactly, and through it one task. Each press is applied
// once, whichever of the two paths sees it first: its own id is the key in
// public.whatsapp_inbound.
//
// `db`: logRow(id), task(id), client(id), nag(id), answered(inbound) → boolean,
//       byWaId(mid) → the Jako message with that id, or null,
//       apply({ inbound, message, from, plan }) → result (public.whatsapp_jako_reply)
import { hookAction, nagIdOf, jakoOpen, jakoReplyPlan, jakoTitle } from './app/wa-logic.js';
import { taskIdOf } from './app/wa-templates.js';

/**
 * One button on one message of ours. `inbound`: what makes this reply one (the
 * press's own id); `match`: 'exact', or 'last' when the message was only assumed
 * (kept with the result). → { result, title }: the title names the task, for the answer.
 */
export async function applyReply({ db, action, message, inbound, match = 'exact' }) {
  const log = message ? await db.logRow(message.log_id) : null;
  // A reminder that is not this person's is not theirs to answer.
  if (!message || !log || log.person !== message.person) return { result: 'nothing', title: '' };
  if (await db.answered(inbound)) return { result: 'duplicate', title: '' };
  const taskId = taskIdOf(log);
  const task = taskId ? await db.task(taskId) : null;
  const nag = nagIdOf(log) ? await db.nag(nagIdOf(log)) : null;
  const title = jakoTitle({ log, nag });
  if (!jakoOpen({ action, log, task, nag })) return { result: 'closed', title };
  const client = action === 'onit' && log.ref && log.client_id ? await db.client(log.client_id) : null;
  const plan = { ...jakoReplyPlan({ action, log, message, task, client, nag }), ...(match === 'last' ? { match } : {}) };
  const result = await db.apply({ inbound, message: message.id, from: message.phone, plan });
  return { result, title };
}

/**
 * A press read from the chat ({ mid, replyTo, title }), for one of these numbers.
 * → { result, title }, or null when it is not one of our buttons or the message it
 * answers is not known (its id was never learned): the caller decides what then.
 */
export async function applyPress({ db, press, phones }) {
  const action = hookAction(press?.title);
  if (!action || !press.mid) return null;
  if (await db.answered(press.mid)) return { result: 'duplicate', title: '' };
  const message = press.replyTo ? await db.byWaId(press.replyTo) : null;
  if (!message || !phones.includes(message.phone)) return null;
  return applyReply({ db, action, message, inbound: press.mid });
}
