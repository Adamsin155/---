// "הורדת PDF": the quote or the agreement as a real .pdf file, downloaded at once, with no print
// dialog (the owner, 10.11.2026: "אנחנו שולחים הצעות מחיר בדרך כלל רק ב-PDF"; docs/ops.md, section 124).
// The document is drawn exactly as the preview (renderQuoteDoc, app/styles/quote.css): colours, logo,
// cover, signature. How:
//  1. the document goes into a hidden frame 794 px wide (A4 at 96 dpi), with the site's fonts and
//     quote.css only, so a phone draws it as a computer does (no phone layout in the file);
//  2. the pages are cut between blocks and lines (splitPages): never through a line of text, a row,
//     a box or a heading with what follows it;
//  3. each page is drawn by html2canvas (app/vendor, MIT) at twice the size and kept as a JPEG;
//  4. the pages become a PDF (jpegPdf, below: A4, one picture per page), and the browser saves it.
// Nothing leaves the device: the file is made in the browser.

const PAGE_W = 794;                                   // css px: A4's width at 96 dpi
const PAGE_H = Math.round((PAGE_W * 297) / 210);      // 1123
const MARGIN = 40;                                    // white at the top of every page but the first, and at the bottom of all
const SCALE = 2;
const JPEG_QUALITY = 0.9;
const A4_PT = [595.28, 841.89];

export const PDF_PAGE = { width: PAGE_W, height: PAGE_H, margin: MARGIN };

// ── The pages ────────────────────────────────
// total: the document's height; first/rest: how much of it fits on the first page and on the others.
// avoid: [top, bottom] of blocks not to be cut (a row, a box, a heading with its next lines);
// lines: [top, bottom] of each line of text (never cut, unless one block is taller than a page);
// forced: where a new page starts (as break-before: page).
// Returns [{ start, end }], covering 0..total with no gap.
export function splitPages(total, { first, rest }, { avoid = [], lines = [], forced = [] } = {}) {
  const pages = [];
  const inside = (y, list) => list.some(([top, bottom]) => top < y - 0.5 && y + 0.5 < bottom);
  // The lowest place in [lo, hi] that no interval in list crosses, or null.
  const best = (lo, hi, list) => {
    const cands = [hi];
    for (const [top, bottom] of list) {
      if (top - 1 >= lo && top - 1 <= hi) cands.push(top - 1);
      if (bottom >= lo && bottom <= hi) cands.push(bottom);
    }
    cands.sort((a, b) => b - a);
    return cands.find((y) => !inside(y, list)) ?? null;
  };
  const both = [...avoid, ...lines];
  const breaks = [...forced].sort((a, b) => a - b);
  let start = 0;
  while (start < total - 1 && pages.length < 200) {
    const cap = pages.length ? rest : first;
    const limit = start + cap;
    const f = breaks.find((y) => y > start + 60 && y <= limit && y < total);
    let end;
    if (f !== undefined) end = f;
    else if (limit >= total) end = total;
    else end = best(start + cap * 0.5, limit, both) ?? best(start + cap * 0.2, limit, lines) ?? limit;
    end = Math.min(total, Math.max(end, start + 1));
    pages.push({ start: Math.round(start), end: Math.round(end) });
    start = Math.round(end);
  }
  if (pages.length) pages[pages.length - 1].end = Math.max(pages[pages.length - 1].end, Math.round(total));
  return pages;
}

// ── The file's name ──────────────────────────
// No characters a file system refuses, no control characters, one space between words.
export function safeFileName(s, max = 60) {
  return String(s ?? '')
    .replace(/[\\/:*?"<>|\u0000-\u001f\u007f‎‏‪-‮]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[.\s]+|[.\s]+$/g, '')
    .slice(0, max)
    .trim();
}

// "הצעת מחיר - נירו לוי - קפה נואר.pdf" ("הסכם התקשרות - …" for an agreement); the business, or the
// client's name, when given.
export function pdfFileName(model = {}) {
  const kind = model.docType === 'agreement' ? 'הסכם התקשרות' : 'הצעת מחיר';
  const pkg = model.package || {};
  const what = safeFileName(pkg.influencer || pkg.shownName || pkg.tierName);
  const c = model.client || {};
  const who = safeFileName(c.company || c.name);
  return `${[kind, what, who].filter(Boolean).join(' - ')}.pdf`;
}

// ── A PDF of JPEG pages ──────────────────────
// images: [{ bytes: Uint8Array (a JPEG), width, height }], each one filling an A4 page.
const utf16Hex = (s) => `FEFF${[...String(s)].map((ch) => {
  const code = ch.codePointAt(0);
  if (code < 0x10000) return code.toString(16).padStart(4, '0');
  const c = code - 0x10000;
  return ((0xd800 + (c >> 10)).toString(16) + (0xdc00 + (c & 0x3ff)).toString(16)).padStart(8, '0');
}).join('')}`.toUpperCase();

export function jpegPdf(images, { title = '' } = {}) {
  const enc = new TextEncoder();
  const chunks = [];
  let length = 0;
  const offsets = [];
  const push = (x) => {
    const b = typeof x === 'string' ? enc.encode(x) : x;
    chunks.push(b);
    length += b.length;
  };
  const obj = (n, ...body) => {
    offsets[n] = length;
    push(`${n} 0 obj\n`);
    body.forEach(push);
    push('\nendobj\n');
  };
  const [W, H] = A4_PT;
  const n = images.length;
  push('%PDF-1.4\n');
  push(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a])); // binary marker
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, `<< /Type /Pages /Count ${n} /Kids [${images.map((_, i) => `${4 + 3 * i} 0 R`).join(' ')}] >>`);
  obj(3, `<< /Title <${utf16Hex(title)}> /Producer (astrateg) >>`);
  images.forEach((img, i) => {
    const page = 4 + 3 * i;
    const draw = `q ${W} 0 0 ${H} 0 0 cm /Im0 Do Q`;
    obj(page, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] `
      + `/Resources << /XObject << /Im0 ${page + 2} 0 R >> /ProcSet [/PDF /ImageC] >> /Contents ${page + 1} 0 R >>`);
    obj(page + 1, `<< /Length ${draw.length} >>\nstream\n${draw}\nendstream`);
    obj(page + 2, `<< /Type /XObject /Subtype /Image /Width ${img.width} /Height ${img.height} /ColorSpace /DeviceRGB `
      + `/BitsPerComponent 8 /Filter /DCTDecode /Length ${img.bytes.length} >>\nstream\n`, img.bytes, '\nendstream');
  });
  const size = 4 + 3 * n;
  const xref = length;
  push(`xref\n0 ${size}\n0000000000 65535 f \n`);
  for (let i = 1; i < size; i += 1) push(`${String(offsets[i]).padStart(10, '0')} 00000 n \n`);
  push(`trailer\n<< /Size ${size} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  const out = new Uint8Array(length);
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.length; }
  return out;
}

// ── Drawing in the browser ───────────────────
let h2c = null;
function html2canvasLib() {
  if (window.html2canvas) return Promise.resolve(window.html2canvas);
  h2c ||= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = new URL('./vendor/html2canvas.min.js', import.meta.url).href;
    s.onload = () => (window.html2canvas ? resolve(window.html2canvas) : reject(new Error('html2canvas missing')));
    s.onerror = () => { h2c = null; reject(new Error('html2canvas did not load')); };
    document.head.append(s);
  });
  return h2c;
}

const sheet = (doc, href) => new Promise((resolve) => {
  const l = doc.createElement('link');
  l.rel = 'stylesheet';
  l.href = new URL(href, import.meta.url).href;
  l.onload = resolve;
  l.onerror = resolve;
  doc.head.append(l);
});

// Every weight of Rubik the document uses, Hebrew and Latin (app/fonts/fonts.css, linked by the page).
async function loadRubik(doc) {
  if (!doc.fonts) return;
  await Promise.all(['400', '500', '600', '700', '800'].map((w) => doc.fonts.load(`${w} 16px Rubik`, 'אבג abc 123 ₪').catch(() => {})));
  await doc.fonts.ready;
}

// The document in a frame of its own, the width of an A4 page.
async function frameFor(docEl) {
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.tabIndex = -1;
  frame.style.cssText = `position:fixed;top:0;left:-${PAGE_W * 3}px;width:${PAGE_W}px;height:${PAGE_H}px;`
    + 'border:0;pointer-events:none;opacity:0;';
  document.body.append(frame);
  const d = frame.contentDocument;
  d.documentElement.lang = 'he';
  d.documentElement.dir = 'rtl';
  await Promise.all([sheet(d, './fonts/fonts.css'), sheet(d, './styles/quote.css')]);
  const style = d.createElement('style');
  style.textContent = `html,body{margin:0;padding:0;background:#fff;width:${PAGE_W}px}`
    // Letter spacing makes html2canvas draw letter by letter, and the letters drift: none in the file.
    + '.qd{max-width:none;width:100%;margin:0}.qd,.qd *{letter-spacing:0!important}'
    // The clauses in one column: two columns side by side have no place to cut a page between lines.
    + '.qd-clauses{columns:1!important}';
  d.head.append(style);
  const article = d.importNode(docEl, true);
  d.body.append(article);
  void article.offsetHeight;
  await loadRubik(d);
  await Promise.all([...article.querySelectorAll('img')].map((img) => (img.complete ? null : img.decode().catch(() => {}))));
  frame.style.height = `${Math.ceil(article.getBoundingClientRect().height) + 4}px`;
  return { frame, article };
}

// Where the document may and may not be cut, measured in the frame.
const KEEP = [
  '.qd-cover', '.qd-top', '.qd-parties', '.qd-hero', '.qd-pkg', '.qd-cell', '.qd-row', 'tr', 'li', 'p',
  'h1', 'h2', 'h3', '.qd-sec-head', '.qd-sign-box', '.qd-closing', '.qd-foot', '.qd-terms', '.qd-meta',
].join(',');
export function measure(article) {
  const top0 = article.getBoundingClientRect().top;
  const span = (r) => [r.top - top0, r.bottom - top0];
  const avoid = [...article.querySelectorAll(KEEP)].map((el) => span(el.getBoundingClientRect()));
  // A heading stays with the start of what follows it.
  for (const head of article.querySelectorAll('.qd-sec-head, .qd-words-h, .qd-clauses h3')) {
    const next = head.nextElementSibling;
    if (!next) continue;
    const a = head.getBoundingClientRect();
    const b = next.getBoundingClientRect();
    avoid.push([a.top - top0, Math.min(b.bottom, b.top + 70) - top0]);
  }
  const lines = [];
  const walker = article.ownerDocument.createTreeWalker(article, NodeFilter.SHOW_TEXT);
  const range = article.ownerDocument.createRange();
  for (let t = walker.nextNode(); t; t = walker.nextNode()) {
    if (!t.textContent.trim()) continue;
    range.selectNodeContents(t);
    for (const r of range.getClientRects()) if (r.height > 0) lines.push(span(r));
  }
  // No forced new page: the file runs on as the preview does (the print's new page before "מי
  // אנחנו" left most of the first page empty).
  return { total: article.getBoundingClientRect().height, avoid, lines, forced: [] };
}

// html2canvas draws each word where the page put it. Its words come from Intl.Segmenter, which
// cuts "(קמפיין", "18%" or "info@astrateg.com" into pieces; drawn one by one, right to left, the
// pieces come out turned or spaced. While a page is drawn, a word is everything between two
// spaces, and the canvas lays out each such word the way the page does.
async function wholeWords(fn) {
  const Native = typeof Intl !== 'undefined' ? Intl.Segmenter : undefined;
  if (!Native) return fn();
  class BySpaces {
    constructor(locale, options = {}) {
      this.words = options.granularity === 'word';
      this.native = new Native(locale, options);
    }
    segment(text) {
      if (!this.words) return this.native.segment(text);
      return String(text).split(/(\s+)/).filter(Boolean).map((segment) => ({ segment }));
    }
  }
  Intl.Segmenter = BySpaces;
  try { return await fn(); } finally { Intl.Segmenter = Native; }
}

const toJpeg = (canvas) => new Promise((resolve, reject) => {
  canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/jpeg', JPEG_QUALITY);
});

// docEl: the document as renderQuoteDoc made it. Returns a Blob (application/pdf).
export async function makePdf(docEl, { title = '' } = {}) {
  // html2canvas writes the letters on a canvas of this page, so the document's font (Rubik, every
  // weight it uses) must be loaded here too, not only in the frame (else the words are drawn in
  // another font and run into each other).
  const [html2canvas] = await Promise.all([html2canvasLib(), loadRubik(document)]);
  const { frame, article } = await frameFor(docEl);
  try {
    const m = measure(article);
    const pages = splitPages(m.total, { first: PAGE_H - MARGIN, rest: PAGE_H - 2 * MARGIN }, m);
    const images = [];
    for (const [i, p] of pages.entries()) {
      const part = await wholeWords(() => html2canvas(article, {
        x: 0, y: p.start, width: PAGE_W, height: p.end - p.start, scale: SCALE,
        backgroundColor: '#ffffff', logging: false, useCORS: true,
        windowWidth: PAGE_W, windowHeight: frame.offsetHeight, scrollX: 0, scrollY: 0,
      }));
      const page = document.createElement('canvas');
      page.width = PAGE_W * SCALE;
      page.height = PAGE_H * SCALE;
      const ctx = page.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, page.width, page.height);
      ctx.drawImage(part, 0, (i ? MARGIN : 0) * SCALE);
      const blob = await toJpeg(page);
      images.push({ bytes: new Uint8Array(await blob.arrayBuffer()), width: page.width, height: page.height });
      // Free the memory at once (an iPhone keeps little for canvases).
      part.width = 0; part.height = 0; page.width = 0; page.height = 0;
    }
    return new Blob([jpegPdf(images, { title })], { type: 'application/pdf' });
  } finally {
    frame.remove();
  }
}

// Saves the file: a download on a computer and on Android; on an iPhone Safari offers to open or
// keep it (an <a download> to a blob, the way it accepts).
export function saveFile(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

// The button's whole job: "מכין PDF…" while the file is made, then the download, or onError.
export async function downloadPdf(button, docEl, name, { onError } = {}) {
  if (button?.dataset.busy === '1') return false;
  const label = button?.textContent;
  if (button) {
    button.dataset.busy = '1';
    button.setAttribute('aria-busy', 'true');
    button.textContent = 'מכין PDF…';
  }
  try {
    const blob = await makePdf(docEl, { title: name.replace(/\.pdf$/, '') });
    saveFile(blob, name);
    return true;
  } catch (err) {
    console.warn('pdf', err);
    onError?.(err);
    return false;
  } finally {
    if (button) {
      button.textContent = label;
      button.removeAttribute('aria-busy');
      delete button.dataset.busy;
    }
  }
}
