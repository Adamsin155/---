// The characterization of the old system (astrateg-crm), in the new one (the owner's request
// of 26.10.2026; public.legacy_characterizations, 20261109100000_legacy_characterizations.sql).
// What the client card and the editors' page show, without the DOM: the texts as readable
// parts, the raw answers and the dates (Israel time on every device).
//
// The old texts are free text the old system kept as it was typed: lines such as "שם העסק: …",
// headings such as "רקע על העסק", lists, and paragraphs. charBlocks() reads them into
//   { type: 'h', text }            a heading (bold)
//   { type: 'dl', items: [[k, v]] } lines "key: value" one after the other (a definition list)
//   { type: 'ul', items: [text] }  a list of "- …" / "• …" lines
//   { type: 'p', text }            the other lines (their line breaks kept)
// Nothing is dropped or changed: every word of the text is in one of the parts, in order.
import { dayText } from './legacy-contract-logic.js';

export { dayText };

const LETTER = /\p{L}/u;
const words = (s) => s.split(/\s+/).filter(Boolean).length;
// A list line's marker: a dash or a star with a space after it, or a bullet sign.
const BULLET = /^(?:[-–—*]\s+|[•·▪◦●○✓✔➤►➢]\s*)(\S.*)$/u;
// A line of signs only (a separator).
const SEPARATOR = /^[\s=\-–—_*~.•·#]{3,}$/u;
// "## כותרת"; "**כותרת**"; "=== כותרת ===" / "--- כותרת ---".
const MD_HEADING = /^#{1,6}\s+(.+?)\s*#*$/u;
const BOLD_LINE = /^\*\*([^*]+?)\*\*\s*:?\s*$/u;
const DECORATED = /^[=\-–—_~*]{2,}\s*(.+?)\s*[=\-–—_~*]{2,}$/u;
// "key: value". The colon is not one between two digits (10:30); the key is short (60 at
// most, 10 words), has a letter, no sentence inside it (". " or "!"), and is not a link's
// "https".
const PAIR = /^(.{1,60}?)\s*(?<!\d)[:：](?!\d)\s*(.*)$/u;

function pairOf(line) {
  const m = PAIR.exec(line);
  if (!m) return null;
  const key = m[1].trim();
  if (!key || !LETTER.test(key) || words(key) > 10 || /!|\.\s/.test(key) || /^https?$/i.test(key) || /^\/\//.test(m[2])) return null;
  return { key, value: m[2].trim() };
}
// A short line that can be a heading: 40 characters and 6 words at most, a letter, no colon
// at its end and no sentence's end (. ! ? , ; …), not a link.
const headingShaped = (s) => s.length <= 40 && words(s) <= 6 && LETTER.test(s) && !/[.!?,;…:]$/u.test(s) && !/https?:\/\//i.test(s);

function classify(rawLine) {
  const line = rawLine.trim();
  if (!line) return { kind: 'blank' };
  let m = MD_HEADING.exec(line) || BOLD_LINE.exec(line);
  if (m) return { kind: 'h', text: m[1].replace(/[:：]\s*$/, '').trim() };
  if (SEPARATOR.test(line)) return { kind: 'sep' };
  m = DECORATED.exec(line);
  if (m && LETTER.test(m[1])) return { kind: 'h', text: m[1].replace(/[:：]\s*$/, '').trim() };
  m = BULLET.exec(line);
  if (m) return { kind: 'bullet', text: m[1].trim(), line };
  const plain = line.replace(/\*\*(.+?)\*\*/g, '$1');
  const pair = pairOf(plain);
  if (pair) return { kind: 'pair', ...pair, line: plain };
  return { kind: 'plain', text: plain, line: plain, shape: headingShaped(plain) };
}

const breaks = (c) => !c || c.kind === 'blank' || c.kind === 'sep';

export function charBlocks(text) {
  const lines = String(text ?? '').replace(/\r\n?/g, '\n').split('\n').map(classify);
  const out = [];
  let dl = null;
  let p = null;
  let ul = null;
  let last = null; // the last "key: value" item, which the lines right under it continue
  const close = () => { dl = null; p = null; ul = null; last = null; };
  const pair = (k, v) => {
    if (!dl) { close(); dl = { type: 'dl', items: [] }; out.push(dl); }
    dl.items.push([k, v]);
    return dl.items.at(-1);
  };
  for (let i = 0; i < lines.length; i += 1) {
    const c = lines[i];
    const next = lines[i + 1];
    if (c.kind === 'blank' || c.kind === 'sep') { close(); continue; }
    if (c.kind === 'h') { close(); out.push({ type: 'h', text: c.text }); continue; }
    if (c.kind === 'pair' && !c.value) {
      // "key:" alone: a heading when what follows is another part (a blank line, a heading,
      // a "key: value"); else the key of the lines under it, up to a blank line or the next key.
      if (breaks(next) || next.kind === 'h' || next.kind === 'pair') { close(); out.push({ type: 'h', text: c.key }); continue; }
      const value = [];
      let j = i + 1;
      const ends = (x, after) => breaks(x) || x.kind === 'h' || x.kind === 'pair' || (value.length > 0 && x.kind === 'plain' && x.shape && after?.kind === 'pair');
      for (; j < lines.length && !ends(lines[j], lines[j + 1]); j += 1) value.push(lines[j].line);
      pair(c.key, value.join('\n'));
      last = null;
      i = j - 1;
      continue;
    }
    if (c.kind === 'pair') { last = pair(c.key, c.value); continue; }
    // A short line right before a "key: value" opens a part (a heading), even under another value.
    const opens = c.kind === 'plain' && c.shape && !breaks(next) && (next.kind === 'pair' || (breaks(lines[i - 1]) && !last));
    if (last && !opens) { last[1] += `\n${c.line}`; continue; }
    if (opens) { close(); out.push({ type: 'h', text: c.text }); continue; }
    if (c.kind === 'bullet') {
      if (!ul) { close(); ul = { type: 'ul', items: [] }; out.push(ul); }
      ul.items.push(c.text);
      continue;
    }
    if (!p) { close(); p = { type: 'p', text: c.text }; out.push(p); } else p.text += `\n${c.text}`;
  }
  return out;
}

// ── The raw answers (question id → answer; the questions themselves were not kept) ──
function answerText(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'boolean') return v ? 'כן' : 'לא';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
  if (Array.isArray(v)) return v.map(answerText).filter(Boolean).join(' · ');
  if (typeof v === 'object') return Object.entries(v).map(([k, x]) => { const t = answerText(x); return t ? `${k}: ${t}` : ''; }).filter(Boolean).join(' · ');
  return '';
}
// [[id, answer]], by the question's number (ids that are not numbers after them); empty ones left out.
export function answerRows(answers) {
  if (!answers || typeof answers !== 'object' || Array.isArray(answers)) return [];
  const num = (k) => (/^\d+$/.test(k) ? Number(k) : Infinity);
  return Object.entries(answers).map(([k, v]) => [k, answerText(v)]).filter(([, v]) => v)
    .sort(([a], [b]) => num(a) - num(b) || (a < b ? -1 : a > b ? 1 : 0));
}

// ── The whole row, as the card shows it (null: nothing to show) ──
const textOf = (s) => (typeof s === 'string' && s.trim() ? s : null);
export function legacyCharView(row) {
  if (!row || typeof row !== 'object') return null;
  const filled = textOf(row.filled_text);
  const brief = textOf(row.brief_text);
  const script = textOf(row.script_text);
  const summary = textOf(row.summary_text);
  const answers = answerRows(row.answers);
  if (!filled && !brief && !script && !summary && !answers.length) return null;
  const at = (v, word) => { const d = dayText(v); return d ? `${word} ב־${d}` : null; };
  return {
    filled: filled ? { blocks: charBlocks(filled), stamp: at(row.filled_at, 'מולא') } : null,
    brief: brief ? { blocks: charBlocks(brief), stamp: at(row.brief_at, 'עודכן') } : null,
    script: script ? { blocks: charBlocks(script), stamp: at(row.script_at, 'נכתבו') } : null,
    summary: summary ? { blocks: charBlocks(summary) } : null,
    answers,
  };
}

// The closed row's few words: "מולא ב־1.3.2025 · בריף · תסריטים".
export function legacyCharSum(view) {
  if (!view) return null;
  return [view.filled ? view.filled.stamp || 'אפיון ממולא' : null, view.brief ? 'בריף' : null, view.script ? 'תסריטים' : null,
    !view.filled && !view.brief && !view.script && view.summary ? 'סיכום' : null,
    !view.filled && !view.brief && !view.script && !view.summary && view.answers.length ? `${view.answers.length} תשובות` : null]
    .filter(Boolean).join(' · ');
}
