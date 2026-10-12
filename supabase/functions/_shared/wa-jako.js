// The staff WhatsApp messages through Jako (my.jako.co.il), the owner's provider,
// instead of Meta's Cloud API directly (docs/ops.md, section 63). Hand-written (not
// a copy of app/), no Deno APIs: the caller passes `fetch`, so the reminders function
// and the node tests share it, as with ./wa-graph.js.
//
// What Jako's API gives, and what it does not:
//   POST /subscriber/send-whatsapp-template-by-user-id   one template to one number.
//        The answer is { status: 'ok' } or 400 { message }: no message id, and no
//        delivery or read status later. So a message is 'sent' or 'failed', no more.
//   POST /whatsapp-template/list                         each template's namespace
//        (the send needs it) and whether Meta approved it.
//   GET  /subscriber/chat-messages                       a contact's chat: what they
//        wrote (the only way to hear "הסר": there is no webhook to register), the
//        buttons they pressed (a row of msg_type 'postback' whose payload.reply_to_mid
//        names the message it answers), and, with include_bot=1, what went out to
//        them, each with its `mid`: that is how a sent message's id is learned.
// A quick reply is a sub flow in Jako that calls us back (the whatsapp-webhook
// function, jako-hook.js); here it is only the flow's ns in the message's params.
//
// The API key goes only into the Authorization header: it is never logged and never
// part of a returned error. An error is a short code ('jako 400', 'jako timeout',
// 'jako no_template'): Jako's own message is not kept, as it may name the number.
import { WA_LANG } from './app/wa-templates.js';

export const JAKO_BASE = 'https://my.jako.co.il/api';
// One call waits this long; a tick's calls together, this long (begin() starts the
// count). Past it every call fails at once ('jako budget') instead of waiting, so a
// slow provider costs a tick a bounded time and never holds up the next ones.
export const JAKO_TIMEOUT = 8000;
export const JAKO_BUDGET = 40000;
const RETRY_PAUSE = 300;
// The list is asked again for a template it did not have (or had unapproved) at most
// this often: an approval arrives within minutes to a day, not within a tick.
export const LIST_AGAIN = 5 * 6e4;
const LIST_FAILED_AGAIN = 30e3;
// Reading a sent message's id back: how far before the send the chat is read from
// (seconds; the two clocks may differ a little), and the pause before a second look.
const LEARN_BACK = 5;
export const LEARN_PAUSE = 1000;
const LIST_PAGE = 100;
const LIST_PAGES = 5;

const pause = (ms) => new Promise((done) => setTimeout(done, ms));
// Meta's error number, when Jako's message quotes one as "(#131026)". At most six
// digits, so never a phone number.
const metaCode = (message) => { const m = /\(#(\d{3,6})\)/.exec(String(message || '')); return m ? ` #${m[1]}` : ''; };

/**
 * @param {{ fetch: typeof fetch, apiKey: string, base?: string, timeoutMs?: number, budgetMs?: number,
 *   clock?: () => number, wait?: (ms: number) => Promise<void> }} args
 */
export function makeJako({ fetch, apiKey, base = JAKO_BASE, timeoutMs = JAKO_TIMEOUT, budgetMs = JAKO_BUDGET, clock = Date.now, wait = pause }) {
  let deadline = Infinity;
  const left = () => deadline - clock();

  // One request. → { ok, status, data } or { ok: false, status, error }. A network
  // error or a 5xx is tried once more; a 4xx never (the same request would fail the
  // same way), and a timeout never (the request may have gone through: sending it
  // again could deliver a message twice, and doubles the wait on a slow provider).
  async function call(method, path, { query = null, body = null, retry = true, timeout = timeoutMs } = {}) {
    if (!apiKey || String(apiKey).length < 20) return { ok: false, status: 0, error: 'not_configured' };
    const url = `${base}${path}${query ? `?${new URLSearchParams(query)}` : ''}`;
    for (let attempt = 1; ; attempt += 1) {
      const ms = Math.min(timeout, left());
      if (ms <= 0) return { ok: false, status: 0, error: 'jako budget' };
      let res = null;
      let error = null;
      try {
        res = await fetch(url, {
          method,
          headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
          body: body ? JSON.stringify(body) : undefined,
          signal: typeof AbortSignal?.timeout === 'function' ? AbortSignal.timeout(ms) : undefined,
        });
      } catch (err) {
        error = err?.name === 'TimeoutError' || err?.name === 'AbortError' ? 'timeout' : 'network';
      }
      const again = retry && attempt === 1 && (error === 'network' || (res && res.status >= 500));
      if (again && left() > RETRY_PAUSE) { await wait(RETRY_PAUSE); continue; }
      if (error) return { ok: false, status: 0, error: `jako ${error}` };
      let data = null;
      try { data = await res.json(); } catch { /* not JSON */ }
      if (res.ok) return { ok: true, status: res.status, data };
      return { ok: false, status: res.status, error: `jako ${res.status}${metaCode(data?.message)}` };
    }
  }

  // ── The templates' namespaces ──────────────
  // Approved templates are remembered for the life of the instance (a namespace does
  // not change); the list is read again only for one that is missing or not approved.
  const approved = new Map(); // name → namespace
  const refused = new Map();  // name → why, as of the last list
  let listedAt = -Infinity;
  let listError = null;
  let listing = null;
  async function readList() {
    const seen = new Map();
    for (let page = 1; page <= LIST_PAGES; page += 1) {
      const res = await call('POST', '/whatsapp-template/list', { query: { limit: String(LIST_PAGE), page: String(page) } });
      if (!res.ok) return res;
      const rows = Array.isArray(res.data?.data) ? res.data.data : [];
      for (const r of rows) {
        const name = typeof r?.name === 'string' ? r.name : null;
        if (!name || (r.lang ?? r.language ?? WA_LANG) !== WA_LANG) continue;
        // A list without a status column is taken as it is: Jako then refuses the send itself.
        const ok = r.status == null || String(r.status).toUpperCase() === 'APPROVED';
        const ns = typeof r.namespace === 'string' && r.namespace.length <= 200 ? r.namespace : null;
        seen.set(name, ok && ns ? { namespace: ns } : { why: ok ? 'no_namespace' : 'not_approved' });
      }
      if (rows.length < LIST_PAGE) break;
    }
    return { ok: true, seen };
  }
  async function namespaceOf(name) {
    if (approved.has(name)) return { namespace: approved.get(name) };
    if (clock() - listedAt >= LIST_AGAIN) {
      // Sends run side by side: they share one reading of the list.
      listing ||= readList().then((res) => {
        // A list that could not be read is asked again sooner: until then no send is tried.
        listedAt = res.ok ? clock() : clock() - LIST_AGAIN + LIST_FAILED_AGAIN;
        listError = res.ok ? null : res.error.replace(/^jako /, 'jako list ');
        if (res.ok) {
          refused.clear();
          for (const [n, t] of res.seen) (t.namespace ? approved.set(n, t.namespace) : refused.set(n, t.why));
        }
      }).finally(() => { listing = null; });
      await listing;
    }
    if (approved.has(name)) return { namespace: approved.get(name) };
    return { error: listError || `jako ${refused.get(name) || 'no_template'}` };
  }
  // ── The id of a message that went out ──────
  // The send answers only "ok". The message's own id (Meta's `mid`) is what a button
  // press later names (`reply_to_mid`), so it is read back from the contact's chat:
  // the newest outgoing row from the moment of the send on. Sends to one contact go
  // one after the other, and an id is given to one message only, so two messages to
  // the same person in one tick cannot take each other's. One more look a second
  // later if it is not there yet; an id that cannot be learned is left empty (a reply
  // is then matched to the last message; whatsapp-webhook, jako-hook.js).
  const given = new Set();
  const queues = new Map();
  const midOf = (m) => (typeof m?.mid === 'string' && m.mid.length >= 1 && m.mid.length <= 200 ? m.mid : null);
  async function learn(userId, at) {
    const from = Math.floor(at / 1000) - LEARN_BACK;
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const res = await call('GET', '/subscriber/chat-messages', {
        query: { user_id: userId, include_bot: '1', start_time: String(from), limit: '10' }, retry: false, timeout: Math.min(timeoutMs, 4000),
      });
      const rows = res.ok && Array.isArray(res.data?.data) ? res.data.data : [];
      const out = rows.filter((m) => m?.type === 'out' && midOf(m) && Number(m.ts) >= from && !given.has(m.mid))
        .sort((a, b) => Number(b.ts) - Number(a.ts) || Number(b.id || 0) - Number(a.id || 0));
      if (out.length) {
        if (given.size >= 2000) given.clear();
        given.add(out[0].mid);
        return out[0].mid;
      }
      if (attempt === 1) {
        if (left() <= LEARN_PAUSE) break;
        await wait(LEARN_PAUSE);
      }
    }
    return null;
  }
  async function sendOne(message) {
    const t = await namespaceOf(message.content.name);
    if (!t.namespace) return { ok: false, status: 0, error: t.error };
    const at = clock();
    const res = await call('POST', '/subscriber/send-whatsapp-template-by-user-id', { body: { ...message, content: { namespace: t.namespace, ...message.content } } });
    if (!res.ok) return { ok: false, status: res.status, error: res.error };
    // A 200 that does not say ok was not sent, as far as anyone can know.
    if (res.data?.status !== 'ok') return { ok: false, status: res.status, error: `jako ${res.status} not_ok` };
    const id = await learn(message.user_id, at).catch(() => null);
    return id ? { ok: true, id } : { ok: true };
  }

  // The rows of a contact's chat between two moments (seconds), as what we need of them:
  //   messages  what the person typed: [{ id, at, text }]
  //   presses   the buttons they pressed: [{ mid, replyTo, title, at }], newest first.
  //             `replyTo` is the id of the message whose button it was.
  function readChat(rows, from, to) {
    const messages = [];
    const presses = [];
    for (const m of rows) {
      const ts = Number(m?.ts);
      // The window is checked here too, should the API not apply it.
      if (m?.type !== 'in' || !Number.isFinite(ts) || ts < from || ts > to) continue;
      if (m.msg_type === 'postback') {
        const title = typeof m.payload?.title === 'string' ? m.payload.title : typeof m.content === 'string' ? m.content : null;
        const reply = m.payload?.reply_to_mid;
        if (midOf(m) && title) presses.push({ mid: m.mid, replyTo: typeof reply === 'string' && reply.length <= 200 ? reply : null, title: title.slice(0, 100), at: new Date(ts * 1000) });
        continue;
      }
      if (m.msg_type != null && m.msg_type !== 'text') continue;
      const text = typeof m.content === 'string' ? m.content : typeof m.payload?.text === 'string' ? m.payload.text : null;
      if (text == null) continue;
      messages.push({ id: Number.isSafeInteger(m.id) || /^\d{1,18}$/.test(String(m.id ?? '')) ? String(m.id) : `t${ts}`, at: new Date(ts * 1000), text });
    }
    presses.sort((a, b) => b.at - a.at);
    return { messages, presses };
  }

  return {
    // The start of a tick's work: its calls together get `budgetMs` from now.
    begin() { deadline = clock() + budgetMs; },

    /**
     * One template (app/wa-templates.js jakoMessage). `id`: the message's own id, when
     * it could be learned. @returns {Promise<{ ok: true, id?: string } | { ok: false, status: number, error: string }>}
     */
    async send(message) {
      const userId = String(message?.user_id || '');
      if (!/^\d{8,15}$/.test(userId) || typeof message?.content?.name !== 'string') return { ok: false, status: 0, error: 'not_configured' };
      // A quick reply goes out with the sub flow it starts: without it the button would do nothing.
      if (Object.entries(message.content.params || {}).some(([k, v]) => /^QUICK_REPLY_\d+$/.test(k) && !v)) return { ok: false, status: 0, error: 'jako no_flow' };
      const run = (queues.get(userId) || Promise.resolve()).then(() => sendOne(message));
      const tail = run.catch(() => null);
      queues.set(userId, tail);
      try { return await run; } finally { if (queues.get(userId) === tail) queues.delete(userId); }
    },

    /**
     * What one contact wrote and pressed between two moments (readChat above).
     * `missing`: Jako does not know the contact (nobody wrote, nothing was sent).
     * Not tried again and with a short wait: it runs every few minutes anyway.
     */
    async incoming({ userId, since, until }) {
      if (!/^\d{8,15}$/.test(String(userId || ''))) return { ok: false, status: 0, error: 'not_configured' };
      const from = Math.floor(since.getTime() / 1000);
      const to = Math.ceil(until.getTime() / 1000);
      const res = await call('GET', '/subscriber/chat-messages', {
        query: { user_id: String(userId), start_time: String(from), end_time: String(to), limit: '100' }, retry: false, timeout: Math.min(timeoutMs, 5000),
      });
      if (!res.ok) return res.status === 400 || res.status === 404 ? { ok: true, missing: true, messages: [], presses: [], full: false } : { ok: false, status: res.status, error: res.error };
      const rows = Array.isArray(res.data?.data) ? res.data.data : [];
      return { ok: true, missing: false, ...readChat(rows, from, to), full: rows.length >= 100 };
    },
  };
}
