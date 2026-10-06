// The scripts, read-only, for the influencers (and the client if Lior sends it):
// scripts-view.html?t=<token>, opened from WhatsApp on a phone, no password.
// Everything comes from one database function that checks the token
// (public.get_scripts; supabase/migrations/20261003120000_scripts.sql): the
// business's name and the scripts that have text, with their inspiration links.
// Nothing internal. The client approves the scripts on the status page, as before.
// All text goes through text nodes, never innerHTML.
import { h } from './quote-doc.js';
import { TOKEN, STATUS, scriptLabel, linkName } from './scripts-logic.js';
import { CLOSED_TEXT } from './status-logic.js';
import { pageToken } from './link-token.js';

const $ = (id) => document.getElementById(id);
const fill = (el, ...kids) => el.replaceChildren(...kids.flat().filter((k) => k !== null && k !== undefined && k !== false));
const token = pageToken(); // scripts-view.html#t=… (and ?t=… of a link sent before 6.10.2026)

function showState(kind) {
  const [title, text] = CLOSED_TEXT[kind] || CLOSED_TEXT.error;
  $('page').hidden = true;
  fill($('state'), h('h1', {}, title), h('p', {}, kind === 'closed' ? 'התסריטים כבר לא זמינים בקישור הזה.' : text.replace('דף המצב', 'הדף')));
  $('state').hidden = false;
  document.title = `${title} · astrateg`;
}

async function load() {
  if (!TOKEN.test(token)) { showState('invalid'); return; }
  try {
    const { supabase } = await import('./supa.js');
    const { data, error } = await supabase.rpc('get_scripts', { p_token: token });
    if (error) throw error;
    if (!data || data.state !== 'ok') { showState(data?.state || 'invalid'); return; }
    render(data);
  } catch {
    showState('error');
  }
}

function render(d) {
  const biz = d.client.business || d.client.name;
  document.title = `התסריטים · ${biz} · astrateg`;
  $('sbar-title').textContent = `התסריטים · ${biz}`;
  $('hello-h').textContent = `התסריטים ליום הצילום של ${biz}`;
  $('preview').hidden = !d.preview;
  const list = d.scripts || [];
  const rounds = new Set(list.map((s) => s.round)).size > 1;
  $('summary').textContent = list.length
    ? `${list.length === 1 ? 'תסריט אחד' : `${list.length} תסריטים`}. לכל תסריט מספר: כך מסמנים אותו ביום הצילום.`
    : 'עוד אין כאן תסריטים. הם יופיעו כאן כשייכתבו.';
  const idOf = (s) => `t-${s.round}-${s.n}`;
  const label = (s) => `${scriptLabel(s.n)}${rounds ? ` · סבב ${s.round}` : ''}`;
  $('jump-sec').hidden = list.length < 4;
  fill($('jump'), list.map((s) => h('li', {}, h('a', { href: `#${idOf(s)}`, 'aria-label': label(s) }, String(s.n)))));
  fill($('scripts'), list.map((s) => h('li', {},
    h('article', { class: 'sitem vscript', id: idOf(s), 'aria-labelledby': `${idOf(s)}-h` },
      h('header', { class: 'vhead' },
        h('h2', { id: `${idOf(s)}-h` }, label(s), s.title ? h('span', { class: 'vtitle' }, s.title) : null),
        s.status === 'draft' ? h('span', { class: 'vtag' }, `${STATUS.draft}: עוד יכול להשתנות`) : null),
      s.body ? h('p', { class: 'vbody' }, s.body) : null,
      s.links?.length ? h('div', { class: 'vlinks' }, h('h3', {}, 'קישור להשראה'),
        h('ul', {}, s.links.map((l) => h('li', {}, h('a', { href: l, target: '_blank', rel: 'noopener noreferrer', dir: 'ltr' }, linkName(l), h('span', { class: 'sr-only' }, ' (נפתח בחלון חדש)')))))) : null))));
  $('state').hidden = true;
  $('page').hidden = false;
}

$('print-all').addEventListener('click', () => window.print());
load();
