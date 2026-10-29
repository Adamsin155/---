// "שאלו את המערכת" (ask.html; the owner's request of 29.10.2026; docs/ops.md, section 74): the
// owners, Lior and Ofir write a question, the ask edge function answers from the system's data.
// The page is a box, a few example questions and the conversation of this visit (kept in this tab
// only, sessionStorage: a refresh keeps it, a new tab starts clean). Who may ask is the function's
// to decide (mayAsk in app/ask-logic.js); this page only follows. All text goes through text
// nodes; a link in an answer (a Drive file) is an https link, opened in a new tab.
import { supabase } from './supa.js';
import { $, fill, h, mountSession, viewerOf, VIEWER_UNKNOWN } from './protocol-ui.js';
import { canAsk, cleanQuestion, EXAMPLES, slotRange, errorWords, HISTORY_TURNS } from './ask-logic.js';
import { homeLink } from './shell-rules.js';
import { icon } from './kit.js';

const KEY = 'astrateg.ask.talk';
let talk = []; // [{ q, a, error }]
let asking = false;

const readTalk = () => {
  try { const v = JSON.parse(sessionStorage.getItem(KEY) || '[]'); return Array.isArray(v) ? v.slice(-20) : []; } catch { return []; }
};
const keepTalk = () => { try { sessionStorage.setItem(KEY, JSON.stringify(talk.slice(-20))); } catch { /* private mode */ } };

// The answer's text, with its https links as links.
const URL_RE = /https:\/\/[^\s<>"')]+/g;
function richText(text) {
  const out = [];
  let at = 0;
  for (const m of String(text).matchAll(URL_RE)) {
    const url = m[0].replace(/[.,;:!?]+$/, '');
    if (m.index > at) out.push(String(text).slice(at, m.index));
    out.push(h('a', { href: url, target: '_blank', rel: 'noopener noreferrer', dir: 'ltr' }, /drive\.google\.com/.test(url) ? 'פתיחה בדרייב' : url));
    at = m.index + url.length;
  }
  if (at < String(text).length) out.push(String(text).slice(at));
  return out;
}

function turnNode(t, i) {
  return h('li', { class: 'ak-turn', 'data-i': String(i) },
    h('p', { class: 'ak-q-bubble' }, t.q),
    t.pending
      ? h('p', { class: 'ak-a-bubble is-wait', 'aria-busy': 'true' }, h('span', { class: 'ak-dots', 'aria-hidden': 'true' }, h('span'), h('span'), h('span')), 'בודק במערכת…')
      : h('p', { class: `ak-a-bubble${t.error ? ' is-error' : ''}` }, ...(t.error ? [t.a] : richText(t.a))));
}
function render() {
  const list = $('ak-talk');
  fill(list, ...talk.map(turnNode));
  list.hidden = !talk.length;
  $('ak-chips').hidden = talk.length > 0 && asking;
}
const scrollDown = () => {
  const last = $('ak-talk').lastElementChild;
  last?.scrollIntoView?.({ block: 'end', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
};

function showError(text) {
  $('ak-err').textContent = text || '';
  $('ak-err').hidden = !text;
}

async function ask(text) {
  if (asking) return;
  const q = cleanQuestion(text);
  if (q.error) { showError(errorWords(q.error)); $('ak-q').focus(); return; }
  showError('');
  asking = true;
  $('ak-send').disabled = true;
  $('ak-send').setAttribute('aria-busy', 'true');
  const history = talk.filter((t) => !t.error && !t.pending).slice(-HISTORY_TURNS).map(({ q: qq, a }) => ({ q: qq, a }));
  const turn = { q: q.text, a: '', pending: true };
  talk.push(turn);
  $('ak-q').value = '';
  render();
  scrollDown();
  try {
    const call = () => supabase.functions.invoke('ask', { body: { question: q.text, history } });
    let { data, error } = await call();
    // A sign-in that went stale on this device: renew it once.
    if (error && error.context?.status === 401) {
      await supabase.auth.refreshSession().catch(() => null);
      ({ data, error } = await call());
    }
    if (error) {
      let code = '';
      try { code = String((await error.context.json()).error || ''); } catch { /* no body */ }
      Object.assign(turn, { a: errorWords(code || (error.context?.status ? 'ai_failed' : 'ai_unreachable')), error: true });
    } else if (!data?.answer) {
      Object.assign(turn, { a: errorWords('ai_failed'), error: true });
    } else {
      Object.assign(turn, { a: String(data.answer) });
    }
  } catch {
    Object.assign(turn, { a: errorWords('ai_unreachable'), error: true });
  } finally {
    delete turn.pending;
    asking = false;
    $('ak-send').disabled = false;
    $('ak-send').removeAttribute('aria-busy');
    keepTalk();
    render();
    scrollDown();
  }
}

function mountChips() {
  fill($('ak-chips'), ...EXAMPLES.map((text) => h('button', {
    type: 'button', class: 'ak-chip',
    onclick: () => {
      const box = $('ak-q');
      box.value = text;
      box.focus();
      const r = slotRange(text);
      // A chip with "<לקוח>": the name is to be typed there, so the slot is selected.
      if (r) box.setSelectionRange(r[0], r[1]);
      else ask(text);
    },
  }, text)));
}

$('ak-form').addEventListener('submit', (e) => { e.preventDefault(); ask($('ak-q').value); });
// Enter sends (a phone's "send" key too); Shift+Enter is a new line.
$('ak-q').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); ask($('ak-q').value); }
});

mountSession(async (staff) => {
  const v = await viewerOf(staff.email);
  if (v.error) { $('app').hidden = true; $('state').textContent = VIEWER_UNKNOWN; return; }
  if (!canAsk(v)) {
    $('app').hidden = true;
    const home = homeLink(v);
    $('state').classList.add('no-access');
    fill($('state'), h('strong', {}, 'אין לך גישה לעמוד הזה.'), h('a', { class: 'btn', href: home.href }, home.label));
    return;
  }
  $('ak-send').prepend(icon('send', { size: 18 }));
  mountChips();
  talk = readTalk().filter((t) => t && typeof t.q === 'string' && typeof t.a === 'string');
  render();
  if (talk.length) scrollDown();
});
