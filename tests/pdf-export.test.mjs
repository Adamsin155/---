// "הורדת PDF" (app/pdf-export.js; docs/ops.md, section 124): where the pages are cut, the file's
// name, and the PDF written around the JPEG pages.
// Run: node --test tests/pdf-export.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitPages, safeFileName, pdfFileName, jpegPdf, PDF_PAGE } from '../app/pdf-export.js';

const covers = (pages, total) => {
  assert.equal(pages[0].start, 0);
  for (let i = 1; i < pages.length; i += 1) assert.equal(pages[i].start, pages[i - 1].end, 'no gap, no overlap');
  assert.equal(pages.at(-1).end, total);
};

test('a short document is one page', () => {
  const pages = splitPages(800, { first: 1000, rest: 900 });
  assert.deepEqual(pages, [{ start: 0, end: 800 }]);
});

test('pages fit and cover the whole document', () => {
  const pages = splitPages(5000, { first: 1083, rest: 1043 });
  covers(pages, 5000);
  assert.ok(pages[0].end - pages[0].start <= 1083);
  for (const p of pages.slice(1)) assert.ok(p.end - p.start <= 1043);
  assert.equal(pages.length, 5);
});

test('never through a line of text or a block', () => {
  // Lines of 22px every 24px; a box 900..1100 must not be cut.
  const lines = [];
  for (let y = 10; y < 2400; y += 24) lines.push([y, y + 22]);
  const avoid = [[900, 1100]];
  const pages = splitPages(2400, { first: 1000, rest: 1000 }, { avoid, lines });
  covers(pages, 2400);
  for (const p of pages.slice(0, -1)) {
    for (const [t, b] of [...lines, ...avoid]) assert.ok(!(t < p.end - 0.5 && p.end + 0.5 < b), `cut at ${p.end} crosses ${t}..${b}`);
  }
  assert.ok(pages[0].end <= 900, 'the box goes whole to the next page');
});

test('a block taller than half a page: cut between its lines instead', () => {
  const lines = [];
  for (let y = 0; y < 3000; y += 20) lines.push([y, y + 18]);
  const pages = splitPages(3000, { first: 1000, rest: 1000 }, { avoid: [[100, 2900]], lines });
  covers(pages, 3000);
  assert.ok(pages[0].end > 900, 'the page is filled');
  for (const [t, b] of lines) assert.ok(!(t < pages[0].end - 0.5 && pages[0].end + 0.5 < b));
});

test('a forced break starts a new page; one too near the top is ignored', () => {
  const pages = splitPages(3000, { first: 1000, rest: 1000 }, { forced: [30, 600] });
  covers(pages, 3000);
  assert.equal(pages[0].end, 600);
});

test('nothing to cut at: the page is cut at its full height', () => {
  const pages = splitPages(2500, { first: 1000, rest: 1000 }, { avoid: [[0, 2500]], lines: [[0, 2500]] });
  covers(pages, 2500);
  assert.equal(pages[0].end, 1000);
});

test('the A4 page in css pixels', () => {
  assert.equal(PDF_PAGE.width, 794);
  assert.equal(PDF_PAGE.height, 1123);
});

test('file names: no characters a file system refuses', () => {
  assert.equal(safeFileName('a/b\\c:d*e?f"g<h>i|j'), 'a b c d e f g h i j');
  assert.equal(safeFileName('  ..שם\n\tעם  רווחים..  '), 'שם עם רווחים');
  assert.equal(safeFileName(undefined), '');
  assert.equal(safeFileName('x'.repeat(100)).length, 60);
});

test('the name of the file: kind, influencer or package, business or client', () => {
  const pkg = { influencer: 'נירו לוי', tierName: 'Social all in one' };
  assert.equal(pdfFileName({ docType: 'quote', package: pkg, client: {} }), 'הצעת מחיר - נירו לוי.pdf');
  assert.equal(pdfFileName({ docType: 'quote', package: pkg, client: { name: 'דנה', company: 'קפה "נואר" בע״מ' } }),
    'הצעת מחיר - נירו לוי - קפה נואר בע״מ.pdf');
  assert.equal(pdfFileName({ docType: 'agreement', package: pkg, client: { name: 'דנה כהן' } }), 'הסכם התקשרות - נירו לוי - דנה כהן.pdf');
  assert.equal(pdfFileName({ docType: 'quote', package: { tierName: 'Podcast' }, client: { name: ' ' } }), 'הצעת מחיר - Podcast.pdf');
  assert.equal(pdfFileName({}), 'הצעת מחיר.pdf');
});

test('the PDF: header, one A4 page per picture, a valid xref', () => {
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9]);
  const bytes = jpegPdf([{ bytes: jpeg, width: 10, height: 14 }, { bytes: jpeg, width: 10, height: 14 }], { title: 'הצעת מחיר' });
  const text = Buffer.from(bytes).toString('latin1');
  assert.ok(text.startsWith('%PDF-1.4\n'));
  assert.ok(text.trimEnd().endsWith('%%EOF'));
  assert.equal((text.match(/\/Type \/Page\b(?!s)/g) || []).length, 2);
  assert.match(text, /\/Count 2/);
  assert.match(text, /\/MediaBox \[0 0 595.28 841.89\]/);
  assert.match(text, /\/Title <FEFF05D405E605E2/);
  // Every offset in the xref points at its object.
  const xref = Number(/startxref\n(\d+)/.exec(text)[1]);
  assert.ok(text.slice(xref).startsWith('xref'));
  const rows = text.slice(xref).split('\n').slice(3).filter((l) => / n $/.test(l));
  rows.forEach((row, i) => assert.ok(text.slice(Number(row.slice(0, 10))).startsWith(`${i + 1} 0 obj`), `object ${i + 1}`));
  // The picture's bytes are inside, as they are.
  assert.ok(Buffer.from(bytes).includes(Buffer.from(jpeg)));
});
