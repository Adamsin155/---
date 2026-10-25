// "פגישה חדשה" on the calendar page (the owner, 21.10.2026): the dialog. The rules (who,
// what is missing, the invitation) are app/new-meeting-logic.js; the write of a meeting or
// a shoot day is app/date-set.js, the same one the "קביעת מועד" dialogs and the Google
// suggestions use, with the same questions (the photographer's day, the usual order).
// After saving, Google Calendar opens with the invitation (as "שליחת זימון"); where the
// browser holds the new tab back, the dialog offers the link to tap instead.
import { h, fill, toast, errorText, formatWhen } from './protocol-ui.js';
// "מי מצלם" (25.10.2026): with influencers, or Lior and one photographer (app/shoot-crew.js).
import { crewOptions, choiceOf, soloOf, timeLabel } from './shoot-crew.js';
import { fromInputIL } from './tz.js';
import { icon } from './kit.js';
import { guestNames } from './calendar-view.js';
import { KINDS, MEET_PEOPLE, searchClients, checkMeeting, meetingInvite, kindLabel, personName } from './new-meeting-logic.js';
import { saveMeeting, saveShootDay } from './date-set.js';

let ctx = null; // { viewer, clients(), emails(), clientMail(), site(), checksOf(id), onSaved(row, mark) }
let dlg = null;
let picked = null; // the chosen client
let busy = false;
let hint = null;   // the photographer's line under a shoot day's time

const el = (id) => dlg.querySelector(`#${id}`);
const kindNow = () => dlg.querySelector('input[name="nm-kind"]:checked')?.value || 'char';

function build() {
  const kinds = h('fieldset', { class: 'nm-kinds' }, h('legend', {}, 'איזו פגישה?'),
    KINDS.map((k, i) => h('label', { class: 'nm-kind' },
      h('input', { type: 'radio', name: 'nm-kind', value: k.key, checked: i === 0, onchange: shape }), h('span', {}, k.label))));
  dlg = h('dialog', { class: 'nm-dlg', id: 'dlg-new-meeting', 'aria-labelledby': 'nm-h' },
    h('form', { id: 'nm-form', novalidate: true, onsubmit: submit, oninput: () => { el('nm-err').hidden = true; }, onchange: () => { el('nm-err').hidden = true; } },
      h('div', { class: 'dlg-head' }, h('h2', { id: 'nm-h' }, 'פגישה חדשה'),
        h('button', { type: 'button', class: 'close', 'aria-label': 'סגירה', onclick: () => dlg.close() }, '×')),
      h('div', { class: 'dlg-body nm-body', id: 'nm-step1' },
        kinds,
        h('div', { class: 'field nm-client' },
          h('label', { for: 'nm-client', id: 'nm-client-l' }, 'לקוח'),
          h('div', { class: 'nm-picked', id: 'nm-picked', hidden: true }),
          h('input', { class: 'input', id: 'nm-client', type: 'search', autocomplete: 'off', placeholder: 'שם העסק או שם הלקוח', 'aria-controls': 'nm-results', oninput: results }),
          h('ul', { class: 'nm-results', id: 'nm-results', 'aria-label': 'לקוחות מתאימים' })),
        h('div', { class: 'field', id: 'nm-title-f', hidden: true },
          h('label', { for: 'nm-title' }, 'במה מדובר?'),
          h('input', { class: 'input', id: 'nm-title', maxlength: 120, autocomplete: 'off', placeholder: 'למשל: שיחת היכרות' })),
        h('div', { class: 'nm-row' },
          h('div', { class: 'field' }, h('label', { for: 'nm-at', id: 'nm-at-l' }, 'מתי הפגישה?'),
            h('input', { class: 'input', id: 'nm-at', type: 'datetime-local', dir: 'ltr', required: true, onchange: guests })),
          h('div', { class: 'field', id: 'nm-who-f' }, h('label', { for: 'nm-who' }, 'מי מבצע את האפיון?'),
            h('select', { class: 'input', id: 'nm-who', onchange: guests }, MEET_PEOPLE.map((p) => h('option', { value: p }, p === 'lior' ? 'ליאור (רק כשאין אחר)' : personName(p))))),
          h('div', { class: 'field', id: 'nm-type-f', hidden: true }, h('label', { for: 'nm-type' }, 'מי מצלם?'),
            h('select', { class: 'input', id: 'nm-type', onchange: () => { atLabel(); guests(); } }, crewOptions(h, '', { empty: 'לבחור' })))),
        h('div', { id: 'nm-avail' }),
        h('p', { class: 'hint', id: 'nm-guests' }),
        h('p', { class: 'err', id: 'nm-err', role: 'alert', hidden: true })),
      h('div', { class: 'dlg-body nm-body', id: 'nm-step2', hidden: true }),
      h('div', { class: 'dlg-foot', id: 'nm-foot' },
        h('button', { type: 'submit', class: 'btn btn-primary', id: 'nm-save' }, icon('send', { size: 16 }), h('span', { id: 'nm-save-t' }, 'שמירה ושליחת זימון')),
        h('button', { type: 'button', class: 'btn btn-ghost', onclick: () => dlg.close() }, 'ביטול'))));
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
  document.body.append(dlg);
}

// The fields of the kind chosen.
function shape() {
  const kind = kindNow();
  el('nm-title-f').hidden = kind !== 'other';
  el('nm-who-f').hidden = kind !== 'char';
  el('nm-type-f').hidden = kind !== 'shoot';
  atLabel(kind);
  el('nm-client-l').textContent = kind === 'other' ? 'לקוח (לא חובה)' : 'לקוח';
  el('nm-save-t').textContent = kind === 'other' ? 'פתיחת הזימון ב־Google' : 'שמירה ושליחת זימון';
  el('nm-avail').hidden = kind !== 'shoot';
  guests();
}

function results() {
  const list = searchClients(ctx.clients(), el('nm-client').value);
  fill(el('nm-results'), list.map((c) => h('li', {}, h('button', {
    type: 'button', class: 'nm-pick', 'data-id': c.id, onclick: () => pick(c),
  }, h('strong', {}, c.business || c.name), c.business && c.name ? h('span', { class: 'muted' }, ` · ${c.name}`) : null))));
  if (!list.length && el('nm-client').value.trim()) fill(el('nm-results'), h('li', { class: 'muted nm-none' }, 'אין לקוח כזה.'));
}

function pick(c) {
  picked = c;
  el('nm-client').value = '';
  el('nm-client').hidden = true;
  fill(el('nm-results'));
  const box = el('nm-picked');
  fill(box, h('span', { class: 'nm-picked-n' }, h('strong', {}, c.business || c.name), c.business && c.name ? ` · ${c.name}` : ''),
    h('button', { type: 'button', class: 'btn-text', id: 'nm-change', onclick: unpick }, 'החלפה'));
  box.hidden = false;
  el('nm-who').value = MEET_PEOPLE.includes(c.characterizer) ? c.characterizer : 'ofir';
  el('nm-type').value = choiceOf(c);
  atLabel();
  guests();
  el('nm-change').focus();
}
function unpick() {
  picked = null;
  el('nm-picked').hidden = true;
  el('nm-client').hidden = false;
  guests();
  el('nm-client').focus();
}

// The time's words: a day without influencers asks for the shoot's own time.
function atLabel(kind = kindNow()) {
  const solo = !!soloOf(el('nm-type').value);
  el('nm-at-l').textContent = kind === 'shoot' ? (solo ? `מתי? (${timeLabel(el('nm-type').value)})` : 'מתי מגיעים המשפיענים?') : kind === 'char' ? 'מתי הפגישה?' : 'מתי?';
}
const values = () => ({
  kind: kindNow(), client: picked, at: fromInputIL(el('nm-at').value), title: el('nm-title').value,
  type: el('nm-type').value || null, person: el('nm-who').value,
});
const inviteOf = (v) => meetingInvite({ ...v, emails: ctx.emails(), clientEmail: v.client ? ctx.clientMail()[v.client.id] || null : null, site: ctx.site() });

// Who will be invited, said before saving.
function guests() {
  const v = values();
  const line = el('nm-guests');
  if (v.kind !== 'other' && !v.client) { line.textContent = ''; return; }
  const inv = inviteOf({ ...v, at: v.at || new Date() });
  const names = guestNames(inv);
  line.textContent = names ? `בזימון: ${names}.` : 'אין כתובות מייל: מוסיפים מוזמנים ב־Google.';
  if (v.kind === 'shoot' && hint) hint.refresh();
}

async function submit(ev) {
  ev.preventDefault();
  if (busy) return;
  const v = values();
  const err = el('nm-err');
  const problem = checkMeeting(v);
  if (problem) { err.textContent = problem; err.hidden = false; return; }
  err.hidden = true;
  busy = true;
  el('nm-save').disabled = true;
  try {
    let saved = null;
    if (v.kind === 'char') saved = await saveMeeting(v.client, { at: v.at, person: v.person }, { checks: ctx.checksOf(v.client.id) });
    if (v.kind === 'shoot') {
      saved = await saveShootDay(v.client, { at: v.at, type: v.type }, { me: ctx.viewer?.me ?? null });
      if (!saved.ok) return;
    }
    if (saved) ctx.onSaved(saved.row, saved.marked || null);
    const inv = inviteOf(v);
    const what = v.kind === 'other' ? null : `${kindLabel(v.kind)} של ${v.client.business || v.client.name} נשמר: ${formatWhen(v.at)}.`;
    const tab = window.open(inv.url, '_blank');
    if (tab) {
      try { tab.opener = null; } catch { /* another origin already */ }
      dlg.close();
      toast(`${what ? `${what} ` : ''}Google Calendar נפתח: לוחצים שם ״שמירה״ והזימון נשלח.`);
      return;
    }
    // The browser held the new tab back: the link, to tap.
    el('nm-step1').hidden = true;
    el('nm-foot').hidden = true;
    const step2 = el('nm-step2');
    fill(step2, what ? h('p', { class: 'nm-done' }, what) : null,
      h('a', { class: 'btn btn-primary', id: 'nm-open', href: inv.url, target: '_blank', rel: 'noopener', onclick: () => setTimeout(() => dlg.close(), 300) },
        icon('send', { size: 16 }), 'פתיחת הזימון ב־Google'),
      h('p', { class: 'hint' }, 'ב־Google לוחצים ״שמירה״, והזימון נשלח לכולם.'));
    step2.hidden = false;
    el('nm-open').focus();
  } catch (e) {
    err.textContent = e?.rule ? e.message : `לא נשמר. ${errorText(e)}`;
    err.hidden = false;
  } finally {
    busy = false;
    el('nm-save').disabled = false;
  }
}

export function initNewMeeting(options) { ctx = options; }

export async function openNewMeeting() {
  if (!dlg) build();
  dlg.querySelector('form').reset();
  picked = null;
  el('nm-picked').hidden = true;
  el('nm-client').hidden = false;
  fill(el('nm-results'));
  el('nm-step1').hidden = false;
  el('nm-step2').hidden = true;
  el('nm-foot').hidden = false;
  el('nm-err').hidden = true;
  shape();
  dlg.showModal();
  el('nm-client').focus();
  // The photographer's free and taken days under a shoot day's time (as the shoot dialog shows).
  if (!hint) {
    try {
      const A = await import('./availability-ui.js');
      hint = A.shootDayHint(el('nm-at'), { me: () => ctx.viewer?.me ?? null, own: () => picked?.shoot_at || null, who: () => soloOf(el('nm-type').value) || 'eli' });
      fill(el('nm-avail'), hint);
    } catch { /* the date can still be chosen */ }
  }
}
