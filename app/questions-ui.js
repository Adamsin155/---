// Questions to me, at the top of "המשימות שלי" (clients.html): the owner (or the
// office) asked the one person responsible from screen 1 (owner.html). Each is
// answered right here; the answer goes back to the owner's row. Open questions
// only; an answered one leaves the list. Nothing shows when there are none, or
// when the table is not there yet.
import { PEOPLE } from './protocol.js';
import { clientLabel } from './protocol-logic.js';
import { loadQuestions, answerQuestion } from './owner-data.js';
import { h, fill, toast, errorText, who, formatStamp, directory } from './protocol-ui.js';

let list = [];
// Only the office asks; the one of them without a person in the protocol is the owner.
const askerName = (email) => (directory[String(email || '').toLowerCase()] ? who(email) : 'הבעלים');
let box = null;
let clientsById = new Map();

// `el`: the section; `me`: the signed-in person (the owner has none, and no block).
export async function refreshQuestions(el, me, clients = []) {
  box = el;
  clientsById = new Map(clients.map((c) => [c.id, c]));
  if (!me || !PEOPLE[me]) { el.hidden = true; return; }
  try {
    list = (await loadQuestions({ toPerson: me, openOnly: true })).sort((a, b) => new Date(a.asked_at) - new Date(b.asked_at));
  } catch {
    list = [];
  }
  render();
}

// A refresh keeps an answer being typed, and the focus in it.
function render() {
  const typed = new Map([...box.querySelectorAll('textarea')].map((t) => [t.id, t.value]));
  const focus = box.contains(document.activeElement) ? document.activeElement.id : null;
  box.hidden = !list.length;
  if (!list.length) { fill(box); return; }
  fill(box,
    h('h2', { class: 'myq-h', id: 'myq-h' }, list.length === 1 ? 'שאלה אליך' : 'שאלות אליך', h('span', { class: 'n' }, String(list.length))),
    h('ul', { class: 'myq-list', 'aria-labelledby': 'myq-h' }, ...list.map(item)));
  for (const [id, v] of typed) { const t = document.getElementById(id); if (t && v) t.value = v; }
  if (focus) document.getElementById(focus)?.focus({ preventScroll: true });
}

function item(q) {
  const c = q.client_id ? clientsById.get(q.client_id) : null;
  const id = `myq-${q.id}`;
  return h('li', { class: 'myq-item', 'data-id': q.id },
    h('p', { class: 'myq-meta' },
      c ? h('a', { class: 'wclient', href: `client.html?id=${encodeURIComponent(c.id)}` }, clientLabel(c)) : h('span', { class: 'wclient' }, q.client_id ? 'לקוח' : 'המשרד'),
      ` · ${askerName(q.asked_by)} · ${formatStamp(q.asked_at)}`, q.context ? ` · על: ${q.context}` : ''),
    h('p', { class: 'myq-text' }, `״${q.question}״`),
    h('form', { class: 'myq-form', novalidate: true, onsubmit: (e) => { e.preventDefault(); answer(q, e.currentTarget); } },
      h('div', { class: 'field' },
        h('label', { for: id }, 'התשובה שלך'),
        h('textarea', { class: 'input', id, rows: '2', maxlength: '2000', required: true })),
      h('button', { type: 'submit', class: 'btn btn-sm btn-primary', id: `${id}-send` }, 'שליחת תשובה')));
}

async function answer(q, form) {
  const input = form.querySelector('textarea');
  const text = input.value.trim();
  input.setAttribute('aria-invalid', String(!text));
  if (!text) { toast('כתבו תשובה קצרה.'); input.focus(); return; }
  const btn = form.querySelector('button');
  btn.disabled = true;
  try {
    await answerQuestion(q.id, text);
  } catch (err) {
    btn.disabled = false;
    toast(`התשובה לא נשמרה. ${errorText(err)}`);
    return;
  }
  const i = list.findIndex((x) => x.id === q.id);
  list = list.filter((x) => x.id !== q.id);
  render();
  // Focus: the next question's answer, else the list below.
  const next = list[Math.min(i, list.length - 1)];
  (next ? document.getElementById(`myq-${next.id}`) : document.querySelector('#mine-list .cbx:not(:disabled), #tab-mine'))?.focus();
  toast('התשובה נשלחה. היא מופיעה אצל מי ששאל.');
}
