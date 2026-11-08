// "מסמך אפיון" (the owner, 8.11.2026; docs/ops.md, section 111): the whole characterization
// of one client as one document, to read, copy and download as a Word file. The form is
// filled as always (intake.html#form, or "עדכון אפיון"); the document is built from what
// was saved, every time it is opened, so it is never out of date.
//
// Pure: no DOM and no network, so node tests it; intake.html?id=<client>&doc=1 shows it.
//   charDoc({ client, char, briefs, byName, dateText })  the document: { title, meta, sections }
//   docText(doc)                                         as plain text (the "העתקה" button)
//   docWordHtml(doc)                                     as a Word file (the "הורדה" button)
//   docFileName(client)                                  "אפיון - <name>.doc"
//
// Never in it: a user name or a password of a network. Only each network's status, as
// "האפיון הסתיים" saved it in the characterization (fields.networks).
import { FORM_FIELDS, CAMPAIGN_FIELDS, campaignValue, MATERIALS, MATERIAL_STATES, ACCESS_STATUS, networkName, validUrl } from './characterization.js';
import { FOCUS_TOPICS, SUMMARY, SUMMARY_LABEL, MUST, MUST_NOT } from './briefs.js';

const clean = (v) => String(v ?? '').trim();
export const EMPTY = 'לא מולא';

// A row: { label, value } (value '' when empty: shown as EMPTY); `ltr` for a phone or a link.
const row = (label, value, extra = {}) => ({ label, value: clean(value), ...extra });

export function charDoc({ client, char = null, briefs = [], byName = '', dateText = '' } = {}) {
  const f = char?.fields || {};
  const name = clean(client?.name) || 'לקוח';
  const sections = [];
  sections.push({
    key: 'char', title: 'מה הלקוח סיפר באפיון',
    rows: FORM_FIELDS.map((x) => row(x.label, x.key === 'address' ? (f.address || client?.address) : f[x.key], x.tel ? { ltr: true } : {})),
  });
  sections.push({ key: 'ads', title: 'קמפיין ממומן', rows: CAMPAIGN_FIELDS.map((x) => row(x.label, campaignValue(f, x))) });
  const hasLogo = client?.has_logo ?? f.has_logo;
  const logo = validUrl(f.logo_url) ? clean(f.logo_url) : '';
  sections.push({
    key: 'brand', title: 'מותג וחומרים',
    rows: [
      row('לוגו', logo || (hasLogo === false ? 'אין ללקוח לוגו (מכינים לוגו חדש)' : hasLogo === true ? 'יש לוגו (בלי קישור; אם הועלה קובץ, הוא בתיק הלקוח)' : ''), logo ? { ltr: true, link: true } : {}),
      row('צבעי המותג', f.colors),
      ...MATERIALS.map((m) => row(m.label, MATERIAL_STATES.find(([k]) => k === f.materials?.[m.key])?.[1] || '')),
    ],
  });
  const nets = (Array.isArray(f.networks) ? f.networks : []).filter((n) => n && n.network && n.status);
  if (nets.length) {
    sections.push({
      key: 'nets', title: 'רשתות וגישות', note: 'רק מצב הגישה. שמות משתמש וסיסמאות נמצאים בכספת, לא במסמך.',
      rows: nets.map((n) => row(networkName(n.network), ACCESS_STATUS.find(([k]) => k === n.status)?.[1] || n.status)),
    });
  }
  for (const b of [...(briefs || [])].sort((a, z) => a.round - z.round)) {
    const bf = b?.fields || {};
    const order = [[SUMMARY, SUMMARY_LABEL], ...FOCUS_TOPICS.filter(([k]) => k === MUST || k === MUST_NOT), ...FOCUS_TOPICS.filter(([k]) => k !== MUST && k !== MUST_NOT)];
    const rows = order.filter(([k]) => clean(bf[k])).map(([k, label]) => row(label, bf[k]));
    if (rows.length) sections.push({ key: `brief-${b.round}`, title: `דגשים משיחת הדגשים${b.round > 1 ? ` · סבב ${b.round}` : ''}`, rows });
  }
  const filled = FORM_FIELDS.filter((x) => clean(x.key === 'address' ? (f.address || client?.address) : f[x.key])).length;
  const meta = [
    clean(client?.business) && clean(client.business) !== name ? clean(client.business) : null,
    dateText ? `אפיון ${dateText}${byName ? ` · ${byName}` : ''}` : byName ? `אפיון: ${byName}` : null,
    `מולאו ${filled} מתוך ${FORM_FIELDS.length} השדות`,
  ].filter(Boolean);
  return { title: `מסמך אפיון · ${name}`, name, meta, sections, saved: !!char };
}

// Plain text: a heading, then each section with its rows as "שאלה:" and the answer under it.
export function docText(doc) {
  const out = [doc.title, ...doc.meta, ''];
  for (const s of doc.sections) {
    out.push(`■ ${s.title}`);
    if (s.note) out.push(`(${s.note})`);
    for (const r of s.rows) out.push(`${r.label}:`, r.value || EMPTY, '');
    out.push('');
  }
  return `${out.join('\n').replace(/\n{3,}/g, '\n\n').trim()}\n`;
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const para = (s) => esc(s).replace(/\n/g, '<br>');

// A Word document (HTML that Word opens as a .doc), right to left, in the office's colours.
export function docWordHtml(doc) {
  const sections = doc.sections.map((s) => `
<h2>${esc(s.title)}</h2>${s.note ? `\n<p class="note">${esc(s.note)}</p>` : ''}
<table>${s.rows.map((r) => `
<tr><th>${esc(r.label)}</th><td${r.ltr ? ' dir="ltr" style="text-align:right"' : ''}${r.value ? '' : ' class="empty"'}>${r.value ? para(r.value) : EMPTY}</td></tr>`).join('')}
</table>`).join('\n');
  return `﻿<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" lang="he" dir="rtl">
<head><meta charset="utf-8"><title>${esc(doc.title)}</title>
<style>
@page { size: A4; margin: 2cm; }
body { font-family: Arial, 'Segoe UI', sans-serif; font-size: 11pt; color: #1b2340; direction: rtl; }
h1 { font-size: 20pt; color: #1b2340; margin: 0 0 4pt; }
.meta { color: #5a6280; margin: 0 0 14pt; }
h2 { font-size: 13pt; color: #6b3fd4; border-bottom: 1pt solid #d9dbe6; padding-bottom: 3pt; margin: 16pt 0 6pt; }
.note { color: #5a6280; font-size: 9.5pt; margin: 0 0 4pt; }
table { width: 100%; border-collapse: collapse; }
th, td { text-align: right; vertical-align: top; padding: 5pt 6pt; border-bottom: 0.5pt solid #e6e8f0; }
th { width: 32%; font-weight: bold; color: #1b2340; }
td.empty { color: #9aa0b4; }
</style></head>
<body dir="rtl">
<h1>${esc(doc.title)}</h1>
<p class="meta">${doc.meta.map(esc).join(' · ')}</p>
${sections}
</body></html>`;
}

export const docFileName = (client) => `אפיון - ${clean(client?.name).replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim() || 'לקוח'}.doc`;
