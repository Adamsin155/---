// The three small forms of Lior's work in the client card (protocol v12; docs/ops.md, section 92):
// the campaign's details (30), the pre-shoot form (36, "11ג") and the scripts' Google Docs link
// (12). Each is drawn inside its process card; what they mean and check is app/lior-four.js.
// What is typed survives the card being drawn again (a mark elsewhere redraws it): `drafts`.
import { h } from './protocol-ui.js';
import {
  campaignProblem, campaignNote, readCampaign, campaignWords, BUDGET_MAX,
  scriptsDocProblem, scriptsDocOf, SCRIPTS_DOC_LABEL,
  INFLUENCER_CHOICES, PHOTOGRAPHER_CHOICES, DEFAULT_PHOTOGRAPHER, preShootValues, preShootProblem, preShootWords,
} from './lior-four.js';

const drafts = new Map(); // form id -> { field: value }
const editing = new Set(); // form ids opened for a change after they were saved
const safe = (s) => String(s).replace(/[^\w-]/g, '-');
const draftOf = (id, initial) => ({ ...initial, ...(drafts.get(id) || {}) });
// Kept as typed; a sentence about a missing field goes once the person types again.
const keep = (id, field, value) => {
  drafts.set(id, { ...(drafts.get(id) || {}), [field]: value });
  const err = document.getElementById(`${id}-err`);
  if (err && !err.hidden) showError(id, null);
};
export const forgetDraft = (id) => { drafts.delete(id); editing.delete(id); };

function showError(id, problem) {
  const err = document.getElementById(`${id}-err`);
  if (err) { err.textContent = problem ? problem.text || problem : ''; err.hidden = !problem; }
  for (const el of document.querySelectorAll(`#${id} [aria-invalid]`)) el.removeAttribute('aria-invalid');
  const field = problem?.field ? document.getElementById(`${id}-${problem.field}`) : null;
  if (field) { field.setAttribute('aria-invalid', 'true'); field.focus(); }
}
const errLine = (id) => h('p', { class: 'err lf-err', id: `${id}-err`, role: 'alert', hidden: true });
const field = (id, name, label, input, hint = null) => h('div', { class: 'field lf-field' },
  h('label', { for: `${id}-${name}` }, label), input, hint ? h('p', { class: 'hint lf-hint' }, hint) : null);
// A saved form, in one line, with "עריכה" (only for who may change it).
function savedLine(id, words, canEdit, redraw) {
  return h('div', { class: 'lf-saved' },
    h('span', { class: 'lf-saved-t' }, words),
    canEdit ? h('button', { type: 'button', class: 'btn-text', id: `${id}-edit`, onclick: () => { editing.add(id); redraw(`${id}-start`); } }, 'עריכה') : null);
}

// ── 1. The campaign (30): the start date and the daily budget, saved with "הקמפיין עלה" ──
export const campaignFormId = (key) => `lf-c-${safe(key)}`;
// The values typed in the campaign form of `key` (the item's "סיימתי" reads them).
export function campaignTyped(key) {
  const id = campaignFormId(key);
  const d = drafts.get(id) || {};
  return { start: document.getElementById(`${id}-start`)?.value ?? d.start ?? '', budget: document.getElementById(`${id}-budget`)?.value ?? d.budget ?? '' };
}
// { note } to save, or { problem } after showing it in the form.
export function campaignFromForm(key) {
  const id = campaignFormId(key);
  const v = campaignTyped(key);
  const problem = campaignProblem(v);
  showError(id, problem);
  return problem ? { problem: problem.text } : { note: campaignNote(v) };
}
export function campaignBox({ key, check, canEdit, onSave, redraw }) {
  const id = campaignFormId(key);
  const saved = check?.state === 'done' ? readCampaign(check.note) : null;
  if (check?.state === 'done' && !editing.has(id)) {
    return h('section', { class: 'lf-box lf-campaign', id, 'aria-label': 'פרטי הקמפיין' },
      h('h4', { class: 'lf-title' }, 'פרטי הקמפיין'),
      savedLine(id, saved ? campaignWords(saved) : 'הקמפיין עלה. התאריך והתקציב לא נרשמו.', canEdit, redraw));
  }
  if (!canEdit) return null;
  const v = draftOf(id, { start: saved?.start || '', budget: saved ? String(saved.budget) : '' });
  const save = async (btn) => {
    const r = campaignFromForm(key);
    if (r.problem) return;
    btn.disabled = true;
    const ok = await onSave(r.note);
    btn.disabled = false;
    if (ok) forgetDraft(id);
  };
  return h('section', { class: 'lf-box lf-campaign', id, 'aria-label': 'פרטי הקמפיין' },
    h('h4', { class: 'lf-title' }, 'פרטי הקמפיין'),
    h('div', { class: 'lf-row' },
      field(id, 'start', 'תאריך ההתחלה', h('input', {
        class: 'input', id: `${id}-start`, type: 'date', dir: 'ltr', value: v.start, required: true,
        oninput: (e) => keep(id, 'start', e.currentTarget.value),
      })),
      field(id, 'budget', 'תקציב יומי (₪)', h('input', {
        class: 'input', id: `${id}-budget`, type: 'text', inputmode: 'numeric', dir: 'ltr', autocomplete: 'off', maxlength: String(String(BUDGET_MAX).length + 2),
        placeholder: 'למשל 150', value: v.budget, required: true,
        oninput: (e) => keep(id, 'budget', e.currentTarget.value),
      }))),
    errLine(id),
    h('div', { class: 'lf-acts' },
      h('button', { type: 'button', class: 'btn btn-sm', id: `${id}-save`, onclick: (e) => save(e.currentTarget) }, check?.state === 'done' ? 'שמירת השינוי' : 'הקמפיין עלה · שמירה'),
      editing.has(id) ? h('button', { type: 'button', class: 'btn-text', onclick: () => { forgetDraft(id); redraw(); } }, 'ביטול') : null));
}

// ── 3. The scripts (12): one Google Docs link ──
export const scriptsFormId = (clientId) => `lf-s-${safe(clientId)}`;
export function scriptsDocBox({ client, canEdit, onSave, redraw }) {
  const id = scriptsFormId(client.id);
  const url = scriptsDocOf(client);
  const open = url ? h('a', { class: 'plink', href: url, target: '_blank', rel: 'noopener', id: `${id}-open` }, 'פתיחת קובץ התסריטים') : null;
  if (url && !editing.has(id)) {
    return h('section', { class: 'lf-box lf-scripts', id, 'aria-label': SCRIPTS_DOC_LABEL },
      h('h4', { class: 'lf-title' }, SCRIPTS_DOC_LABEL),
      h('div', { class: 'lf-saved' }, open,
        canEdit ? h('button', { type: 'button', class: 'btn-text', id: `${id}-edit`, onclick: () => { editing.add(id); redraw(`${id}-url`); } }, 'החלפת הקישור') : null));
  }
  if (!canEdit) return null;
  const v = draftOf(id, { url: url || '' });
  const save = async (btn) => {
    const value = document.getElementById(`${id}-url`)?.value.trim() || '';
    const problem = scriptsDocProblem(value);
    showError(id, problem ? { field: 'url', text: problem } : null);
    if (problem) return;
    btn.disabled = true;
    const ok = await onSave(value);
    btn.disabled = false;
    if (ok) forgetDraft(id);
  };
  return h('section', { class: 'lf-box lf-scripts', id, 'aria-label': SCRIPTS_DOC_LABEL },
    h('h4', { class: 'lf-title' }, SCRIPTS_DOC_LABEL),
    field(id, 'url', 'הקישור לקובץ, עם כל התסריטים', h('input', {
      class: 'input', id: `${id}-url`, type: 'url', dir: 'ltr', inputmode: 'url', autocomplete: 'off', spellcheck: 'false',
      placeholder: 'https://docs.google.com/document/d/…', value: v.url,
      oninput: (e) => keep(id, 'url', e.currentTarget.value),
      onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); save(document.getElementById(`${id}-save`)); } },
    }), 'כשהקישור נשמר, פריט התסריטים נסגר לבד.'),
    errLine(id),
    h('div', { class: 'lf-acts' },
      h('button', { type: 'button', class: 'btn btn-sm', id: `${id}-save`, onclick: (e) => save(e.currentTarget) }, 'שמירת הקישור'),
      editing.has(id) ? h('button', { type: 'button', class: 'btn-text', onclick: () => { forgetDraft(id); redraw(); } }, 'ביטול') : null));
}

// ── 2. The pre-shoot form (36, "11ג") ──
export const preShootFormId = (key) => `lf-p-${safe(key)}`;
export function preShootBox({ client, round, key, done, canEdit, onSave, redraw }) {
  const id = preShootFormId(key);
  if (done && !editing.has(id)) {
    const words = preShootWords(client, round);
    return h('section', { class: 'lf-box lf-preshoot', id, 'aria-label': 'טופס מקדים ליום צילום' },
      h('h4', { class: 'lf-title' }, 'טופס מקדים ליום צילום'),
      savedLine(id, words || 'הטופס מולא.', canEdit, redraw));
  }
  if (!canEdit) return null;
  const v = draftOf(id, preShootValues(client, round));
  const box = h('section', { class: 'lf-box lf-preshoot', id, 'aria-label': 'טופס מקדים ליום צילום' });
  const read = () => ({
    at: document.getElementById(`${id}-at`)?.value || '',
    address: document.getElementById(`${id}-address`)?.value || '',
    influencers: box.querySelector(`input[name="${id}-inf"]:checked`)?.value || '',
    influencer: document.getElementById(`${id}-influencer`)?.value || '',
    photographer: document.getElementById(`${id}-photographer`)?.value || DEFAULT_PHOTOGRAPHER,
  });
  // With influencers the day is filmed by Eli (the shoot's photographer is chosen only on a day
  // without them: app/protocol.js crewOf), so the choice of who films waits for "לא".
  const sync = () => {
    const yes = box.querySelector(`input[name="${id}-inf"]:checked`)?.value === 'yes';
    const which = document.getElementById(`${id}-which`);
    const ph = document.getElementById(`${id}-photographer`);
    const note = document.getElementById(`${id}-ph-note`);
    if (which) which.hidden = !yes;
    if (ph) { ph.disabled = yes; if (yes) ph.value = DEFAULT_PHOTOGRAPHER; }
    if (note) note.hidden = !yes;
  };
  const save = async (btn) => {
    const values = read();
    const problem = preShootProblem(values);
    showError(id, problem && problem.field === 'influencers' ? { ...problem, field: 'inf-yes' } : problem);
    if (problem) return;
    btn.disabled = true;
    const ok = await onSave(values);
    btn.disabled = false;
    if (ok) forgetDraft(id);
  };
  const radio = (value, label) => h('label', { class: 'lf-radio', for: `${id}-inf-${value}` },
    h('input', { type: 'radio', name: `${id}-inf`, id: `${id}-inf-${value}`, value, checked: v.influencers === value,
      onchange: () => { keep(id, 'influencers', value); sync(); } }), label);
  box.append(
    h('h4', { class: 'lf-title' }, 'טופס מקדים ליום צילום'),
    h('div', { class: 'lf-row' },
      field(id, 'at', 'תאריך ושעה', h('input', { class: 'input', id: `${id}-at`, type: 'datetime-local', dir: 'ltr', value: v.at, oninput: (e) => keep(id, 'at', e.currentTarget.value) })),
      field(id, 'address', 'כתובת', h('input', { class: 'input', id: `${id}-address`, type: 'text', autocomplete: 'off', maxlength: '300', value: v.address, oninput: (e) => keep(id, 'address', e.currentTarget.value) }))),
    h('fieldset', { class: 'lf-fieldset' },
      h('legend', {}, 'יש משפיענים ביום הצילום?'),
      h('div', { class: 'lf-radios' }, radio('yes', 'כן'), radio('no', 'לא'))),
    h('div', { class: 'lf-row' },
      h('div', { class: 'field lf-field', id: `${id}-which`, hidden: v.influencers !== 'yes' },
        h('label', { for: `${id}-influencer` }, 'אילו משפיענים'),
        h('select', { class: 'input', id: `${id}-influencer`, onchange: (e) => keep(id, 'influencer', e.currentTarget.value) },
          h('option', { value: '', selected: !v.influencer }, 'בחירה'),
          ...INFLUENCER_CHOICES.map(([k, name]) => h('option', { value: k, selected: v.influencer === k }, name)))),
      h('div', { class: 'field lf-field' },
        h('label', { for: `${id}-photographer` }, 'מי מצלם'),
        h('select', { class: 'input', id: `${id}-photographer`, disabled: v.influencers === 'yes', onchange: (e) => keep(id, 'photographer', e.currentTarget.value) },
          ...PHOTOGRAPHER_CHOICES.map(([k, name]) => h('option', { value: k, selected: (v.influencers === 'yes' ? DEFAULT_PHOTOGRAPHER : v.photographer) === k }, name))),
        h('p', { class: 'hint lf-hint', id: `${id}-ph-note`, hidden: v.influencers !== 'yes' }, 'ביום עם משפיענים מצלם אלי.'))),
    errLine(id),
    h('div', { class: 'lf-acts' },
      h('button', { type: 'button', class: 'btn btn-sm', id: `${id}-save`, onclick: (e) => save(e.currentTarget) }, 'שמירת הטופס'),
      editing.has(id) ? h('button', { type: 'button', class: 'btn-text', onclick: () => { forgetDraft(id); redraw(); } }, 'ביטול') : null));
  return box;
}
