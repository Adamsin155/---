// The client's files without a browser: the kinds and limits (app/files-logic.js),
// who may upload what (the same as the database's rule, tests/sql/client-files.test.mjs),
// safe paths, the gallery's words, and the uploader (app/upload.js) against a fake
// Storage: one request for a small file; for a large one the resumable protocol in
// 6 MB chunks, a dropped chunk retried from the server's offset, an upload resumed
// after the page closed, and a refusal not retried.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  KINDS, kindsOf, maxBytes, fileProblem, sniff, contentMismatch, contentProblem, safeName, objectPath, fileNameOf, uploadKinds, canDelete, canEdit, counts,
  galleryUrl, galleryMessage, downloadName, gallerySections, uploadError, formatSize, canManageGallery, validLink, GALLERY_KINDS,
} from '../app/files-logic.js';
import { uploadFile, CHUNK, RESUMABLE_OVER } from '../app/upload.js';

const MB = 1024 ** 2;
const file = (name, size, type) => ({ name, size, type, slice: (a, b) => ({ size: b - a, a, b }) });

test('the kinds: materials and deliverables, in the contract\'s names', () => {
  assert.deepEqual(kindsOf('materials'), ['logo', 'image', 'video_existing', 'material_other']);
  assert.deepEqual(kindsOf('deliverables'), ['deliverable_graphic', 'deliverable_video', 'deliverable_highlight', 'deliverable_site', 'deliverable_other']);
  assert.deepEqual(GALLERY_KINDS, kindsOf('deliverables'));
  for (const k of Object.keys(KINDS)) assert.ok(KINDS[k].label && KINDS[k].plural, k);
});

test('limits: images 20MB, everything else 2GB, with clear Hebrew errors', () => {
  assert.equal(maxBytes('logo'), 20 * MB);
  assert.equal(maxBytes('deliverable_graphic'), 20 * MB);
  assert.equal(maxBytes('deliverable_video'), 2048 * MB);
  assert.equal(fileProblem('image', file('a.jpg', 20 * MB, 'image/jpeg')), null);
  assert.equal(fileProblem('image', file('a.jpg', 20 * MB + 1, 'image/jpeg')), '"a.jpg" גדול מדי (20MB). אפשר להעלות תמונה עד 20MB.');
  assert.equal(fileProblem('deliverable_video', file('v.mp4', 2049 * MB, 'video/mp4')), '"v.mp4" גדול מדי (2GB). אפשר להעלות קובץ עד 2GB.');
  assert.equal(fileProblem('deliverable_video', file('v.mp4', 1900 * MB, 'video/mp4')), null);
  assert.equal(fileProblem('deliverable_video', file('a.jpg', 1, 'image/jpeg')), '"a.jpg" אינו סרטון.');
  assert.equal(fileProblem('image', file('v.mov', 1, 'video/quicktime')), '"v.mov" אינו תמונה.');
  assert.equal(fileProblem('deliverable_highlight', file('v.mov', 1, 'video/quicktime')), null);
  assert.equal(fileProblem('deliverable_highlight', file('a.pdf', 1, 'application/pdf')), '"a.pdf" אינו תמונה או סרטון.');
  assert.equal(fileProblem('logo', file('logo.ai', 1, '')), null);
  assert.equal(fileProblem('logo', file('logo.pdf', 1, 'application/pdf')), null);
  assert.match(fileProblem('logo', file('logo.docx', 1, 'application/msword')), /אינו קובץ לוגו/);
  assert.equal(fileProblem('material_other', file('menu.docx', 1, 'application/msword')), null);
  assert.match(fileProblem('image', file('a.jpg', 0, 'image/jpeg')), /ריק/);
  assert.equal(formatSize(1536), '2KB');
  assert.equal(formatSize(3.25 * MB), '3.3MB');
});

test('the path: <client>/<kind>/<uuid>-<ASCII name>', () => {
  assert.equal(safeName('תמונה של דנה.JPG'), 'file.jpg');
  assert.equal(safeName('Front Photo (2).heic'), 'Front-Photo-2.heic');
  assert.equal(safeName('../../etc/passwd'), 'passwd');
  assert.equal(safeName('a'.repeat(200) + '.mp4').length, 74);
  const p = objectPath('c1', 'image', '0b0e8a5c-1d2e-4f3a-8b9c-0d1e2f3a4b5c', 'Logo final.PNG');
  assert.equal(p, 'c1/image/0b0e8a5c-1d2e-4f3a-8b9c-0d1e2f3a4b5c-Logo-final.png');
  assert.equal(fileNameOf(p), 'Logo-final.png');
});

test('who uploads what: managers all, Ilai three, an editor only videos of an assigned client', () => {
  const dana = { editor: 'nadia', rounds: [{ n: 2, editor: 'yariv' }] };
  for (const me of [null, 'irit', 'lior', 'ofir']) assert.deepEqual(uploadKinds(me, dana), Object.keys(KINDS), String(me));
  assert.deepEqual(uploadKinds('ilai', dana), ['deliverable_graphic', 'deliverable_highlight', 'deliverable_site']);
  assert.deepEqual(uploadKinds('nadia', dana), ['deliverable_video']);
  assert.deepEqual(uploadKinds('yariv', dana), ['deliverable_video']); // a round's editor
  assert.deepEqual(uploadKinds('anna', dana), []);
  assert.deepEqual(uploadKinds('nirel', { editor: 'anna', shoot_type: 'natali' }), []);
  assert.deepEqual(uploadKinds('eli', dana), []);
  assert.deepEqual(uploadKinds(undefined, dana), []); // not known: nothing
  const f = { kind: 'deliverable_graphic', uploaded_by: 'irit@x' };
  assert.equal(canDelete('ilai', f, 'ilai@x'), false);
  assert.equal(canDelete('ilai', { ...f, uploaded_by: 'ilai@x' }, 'ilai@x'), true);
  assert.equal(canDelete('ofir', f, 'ofir@x'), true);
  assert.equal(canEdit('ilai', { kind: 'deliverable_video', uploaded_by: 'nadia@x' }, 'ilai@x', dana), true);
  assert.equal(canEdit('nadia', f, 'nadia@x', dana), false);
  assert.equal(canManageGallery(null) && canManageGallery('irit') && canManageGallery('lior'), true);
  assert.equal(canManageGallery('ofir') || canManageGallery('ilai'), false);
});

test('counts, the gallery, and its words', () => {
  const files = [{ kind: 'image' }, { kind: 'image' }, { kind: 'image', deleted_at: 'x' }, { kind: 'deliverable_video' }];
  const c = counts(files);
  assert.equal(c.image, 2);
  assert.equal(c.deliverable_video, 1);
  assert.equal(c.logo, 0);
  assert.equal(galleryUrl('https://x.test/a/client.html?id=1', 'T'.repeat(43)), `https://x.test/a/gallery.html#t=${'T'.repeat(43)}`);
  assert.equal(galleryMessage({ name: 'דנה' }, 'https://g'), 'היי דנה, כאן אפשר לראות את כל התוצרים שהכנו לכם:\nhttps://g\nגרפיקות, סרטונים, Highlights והאתר, במקום אחד. אפשר לצפות ולהוריד.');
  assert.equal(downloadName({ kind: 'deliverable_video', path: 'c/deliverable_video/0b0e8a5c-1d2e-4f3a-8b9c-0d1e2f3a4b5c-nadia-final-v3.mp4', at: '2026-10-01T10:00:00Z' }), 'astrateg-video-2026-10-01.mp4');
  assert.deepEqual(gallerySections([{ kind: 'deliverable_video' }, { kind: 'deliverable_graphic' }]).map((s) => s.title), ['גרפיקות', 'סרטונים']);
  assert.equal(validLink('https://site.co.il/landing'), true);
  assert.equal(validLink('http://site.co.il'), false);
  assert.equal(validLink('javascript:alert(1)'), false);
});

test('errors, in Hebrew', () => {
  assert.match(uploadError({ status: 413 }), /גדול מהמותר בשרת/);
  assert.match(uploadError({ status: 403, message: 'new row violates row-level security policy' }), /אין לך הרשאה/);
  assert.match(uploadError({ status: 0 }), /החיבור נקטע/);
  assert.match(uploadError({ name: 'AbortError' }), /בוטלה/);
});

// ── The uploader against a fake Storage ───
function fakeStorage({ dropPatch = [], refuse = null } = {}) {
  const uploads = new Map();
  const calls = [];
  let n = 0;
  const transport = async ({ method, url, headers, body, onProgress }) => {
    calls.push({ method, url: url.replace('https://p.test', ''), headers });
    if (refuse) return { status: 400, header: () => null, text: JSON.stringify({ statusCode: '403', error: 'Unauthorized', message: refuse }) };
    if (method === 'POST' && url.endsWith('/storage/v1/upload/resumable')) {
      const id = `u${++n}`;
      uploads.set(id, { offset: 0, length: Number(headers['upload-length']), meta: headers['upload-metadata'] });
      return { status: 201, header: (h) => (h === 'location' ? `https://p.test/storage/v1/upload/resumable/${id}` : null), text: '' };
    }
    if (method === 'POST') { onProgress?.(body.size); return { status: 200, header: () => null, text: '{"Key":"x"}' }; }
    const id = url.split('/').pop();
    const u = uploads.get(id);
    if (!u) return { status: 404, header: () => null, text: '' };
    if (method === 'HEAD') return { status: 200, header: (h) => (h === 'upload-offset' ? String(u.offset) : null), text: '' };
    if (method === 'PATCH') {
      assert.equal(Number(headers['upload-offset']), u.offset, 'chunks in order');
      if (dropPatch.length && dropPatch[0] === calls.filter((c) => c.method === 'PATCH').length) {
        dropPatch.shift();
        u.offset += Math.floor(body.size / 2); // the server kept half of it
        return { status: 0, header: () => null, text: '' };
      }
      onProgress?.(body.size);
      u.offset += body.size;
      return { status: 204, header: (h) => (h === 'upload-offset' ? String(u.offset) : null), text: '' };
    }
    return { status: 405, header: () => null, text: '' };
  };
  return { transport, uploads, calls };
}
const base = { url: 'https://p.test', apikey: 'k', token: 't', bucket: 'client-files', delays: [1, 1, 1] };

test('a small file: one standard upload, no resumable session', async () => {
  const s = fakeStorage();
  const seen = [];
  const r = await uploadFile({ ...base, path: 'c/image/u-a.jpg', file: file('a.jpg', RESUMABLE_OVER, 'image/jpeg'), transport: s.transport, onProgress: (a, b) => seen.push([a, b]) });
  assert.equal(r.path, 'c/image/u-a.jpg');
  assert.deepEqual(s.calls.map((c) => `${c.method} ${c.url}`), ['POST /storage/v1/object/client-files/c/image/u-a.jpg']);
  assert.equal(s.calls[0].headers['x-upsert'], 'false');
  assert.equal(s.calls[0].headers.authorization, 'Bearer t');
  assert.deepEqual(seen.at(-1), [RESUMABLE_OVER, RESUMABLE_OVER]);
});

test('a large video: resumable, 6 MB chunks, the metadata Supabase reads', async () => {
  const s = fakeStorage();
  const size = 2 * CHUNK + 123;
  const seen = [];
  await uploadFile({ ...base, path: 'c/deliverable_video/u-v.mp4', file: file('v.mp4', size, 'video/mp4'), transport: s.transport, store: null, onProgress: (a) => seen.push(a) });
  assert.deepEqual(s.calls.map((c) => c.method), ['POST', 'PATCH', 'PATCH', 'PATCH']);
  const meta = Object.fromEntries(s.calls[0].headers['upload-metadata'].split(',').map((p) => { const [k, v] = p.split(' '); return [k, Buffer.from(v, 'base64').toString()]; }));
  assert.deepEqual(meta, { bucketName: 'client-files', objectName: 'c/deliverable_video/u-v.mp4', contentType: 'video/mp4', cacheControl: '3600' });
  assert.equal(s.calls[0].headers['upload-length'], String(size));
  assert.equal(s.calls[0].headers['tus-resumable'], '1.0.0');
  assert.equal(s.uploads.get('u1').offset, size);
  assert.equal(seen.at(-1), size);
  assert.ok(seen.every((v, i) => i === 0 || v >= seen[i - 1]), 'progress only grows');
});

test('a dropped chunk: ask the server where it stands, continue from there', async () => {
  const s = fakeStorage({ dropPatch: [2] });
  const size = 3 * CHUNK;
  await uploadFile({ ...base, path: 'c/deliverable_video/u-v.mp4', file: file('v.mp4', size, 'video/mp4'), transport: s.transport, store: null });
  assert.deepEqual(s.calls.map((c) => c.method), ['POST', 'PATCH', 'PATCH', 'HEAD', 'PATCH', 'PATCH']);
  assert.equal(s.uploads.get('u1').offset, size);
  assert.equal(Number(s.calls[4].headers['upload-offset']), CHUNK + CHUNK / 2);
});

test('closed mid-upload: the same file on the same device continues, keeping its path', async () => {
  const s = fakeStorage();
  const mem = new Map();
  const store = { get: (k) => mem.get(k) ?? null, set: (k, v) => mem.set(k, v), remove: (k) => mem.delete(k) };
  const ctl = new AbortController();
  const size = 3 * CHUNK;
  const first = uploadFile({
    ...base, path: 'c/deliverable_video/first-v.mp4', file: file('v.mp4', size, 'video/mp4'), store, resumeKey: 'k1', signal: ctl.signal,
    transport: async (req) => { const r = await s.transport(req); if (req.method === 'PATCH' && s.uploads.get('u1').offset >= CHUNK) throw Object.assign(new Error('aborted'), { name: 'AbortError' }); return r; },
  });
  await assert.rejects(first, /aborted/);
  assert.ok(mem.get('k1'));
  const r = await uploadFile({ ...base, path: 'c/deliverable_video/second-v.mp4', file: file('v.mp4', size, 'video/mp4'), store, resumeKey: 'k1', transport: s.transport });
  assert.equal(r.path, 'c/deliverable_video/first-v.mp4');
  assert.equal(s.uploads.size, 1);
  assert.equal(s.uploads.get('u1').offset, size);
  assert.equal(mem.has('k1'), false);
});

test('a refusal is not retried, and carries the reason', async () => {
  const s = fakeStorage({ refuse: 'new row violates row-level security policy' });
  await assert.rejects(uploadFile({ ...base, path: 'c/logo/u-l.png', file: file('l.png', 10, 'image/png'), transport: s.transport }),
    (e) => e.status === 403 && /row-level security/.test(e.message));
  assert.equal(s.calls.length, 1);
});

// Found live (6.10.2026): a 2 KB text file named .mp4 was accepted as a video.
test('uploads are checked by their first bytes: the formats we accept, and a mismatch refused in Hebrew', async () => {
  const hex = (s, pad = 64) => new Uint8Array([...Buffer.from(s, 'hex'), ...new Uint8Array(pad)]);
  const txt = (s) => new Uint8Array(Buffer.from(s));
  const SAMPLES = {
    jpeg: hex('ffd8ffe000104a464946'), png: hex('89504e470d0a1a0a'), gif: txt('GIF89a\u0001\u0000'),
    webp: new Uint8Array([...Buffer.from('RIFF'), 1, 2, 3, 4, ...Buffer.from('WEBPVP8 ')]),
    svg: txt('<?xml version="1.0"?>\n<!-- logo -->\n<svg xmlns="http://www.w3.org/2000/svg"></svg>'),
    pdf: txt('%PDF-1.7\n'), ps: txt('%!PS-Adobe-3.0 EPSF-3.0\n'),
    mp4: hex('000000186674797069736f6d'), m4v: hex('00000020667479704d345620'), mov: hex('0000001466747970717420200000'),
    oldMov: hex('000008006d6f6f76'), webm: hex('1a45dfa3'), heic: hex('0000001866747970686569630000'),
  };
  assert.deepEqual(Object.fromEntries(Object.entries(SAMPLES).map(([k, b]) => [k, sniff(b)])), {
    jpeg: 'jpeg', png: 'png', gif: 'gif', webp: 'webp', svg: 'svg', pdf: 'pdf', ps: 'ps', mp4: 'mp4', m4v: 'mp4', mov: 'mov', oldMov: 'mov', webm: 'webm', heic: 'heic',
  });
  for (const junk of [txt('this is plain text, not a video'), txt('<html><body>x</body></html>'), new Uint8Array(100), new Uint8Array(2), hex('00000020667479704d344120') /* m4a: audio */]) assert.equal(sniff(junk), null);
  // What each kind takes.
  for (const f of ['jpeg', 'png', 'gif', 'webp', 'svg', 'heic']) {
    assert.equal(contentMismatch('image', 'a', SAMPLES[f]), null, f);
    assert.equal(contentMismatch('deliverable_graphic', 'a', SAMPLES[f]), null, f);
    assert.equal(contentMismatch('logo', 'a', SAMPLES[f]), null, f);
    assert.match(contentMismatch('deliverable_video', 'a.mp4', SAMPLES[f]), /אינו סרטון/, f);
  }
  for (const f of ['mp4', 'm4v', 'mov', 'oldMov', 'webm']) {
    for (const k of ['video_existing', 'deliverable_video', 'deliverable_highlight']) assert.equal(contentMismatch(k, 'v', SAMPLES[f]), null, `${k} ${f}`);
    assert.match(contentMismatch('image', 'v.jpg', SAMPLES[f]), /אינו תמונה/, f);
  }
  for (const f of ['pdf', 'ps']) {
    assert.equal(contentMismatch('logo', 'logo.ai', SAMPLES[f]), null, f);
    assert.match(contentMismatch('image', 'x.png', SAMPLES[f]), /אינו תמונה/, f);
  }
  // The live case, with its message; kinds without a type rule take anything.
  const fake = txt('just some text\n'.repeat(130));
  assert.equal(contentMismatch('deliverable_video', 'clip.mp4', fake), '"clip.mp4" אינו סרטון: התוכן שלו לא תואם לסוג הקובץ. אפשר להעלות MP4, MOV, WebM או M4V.');
  assert.equal(contentMismatch('deliverable_graphic', 'g.png', fake), '"g.png" אינו תמונה: התוכן שלו לא תואם לסוג הקובץ. אפשר להעלות JPG, PNG, WebP, GIF או SVG.');
  assert.match(contentMismatch('logo', 'logo.pdf', fake), /אינו קובץ לוגו תקין/);
  assert.match(contentMismatch('deliverable_highlight', 'h.mp4', fake), /אינו תמונה או סרטון/);
  for (const k of ['material_other', 'deliverable_other', 'deliverable_site']) assert.equal(contentMismatch(k, 'x', fake), null, k);
  // In the browser: only the first bytes are read; the size limits are still fileProblem's.
  let read = null;
  const asFile = (name, bytes) => ({ name, size: bytes.length, slice: (a, b) => { read = [a, b]; return { arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset + a, bytes.byteOffset + Math.min(b, bytes.length)) }; } });
  assert.equal(await contentProblem('deliverable_video', asFile('ok.mp4', SAMPLES.mp4)), null);
  assert.deepEqual(read, [0, 4096]);
  assert.match(await contentProblem('deliverable_video', asFile('clip.mp4', fake)), /^"clip\.mp4" אינו סרטון/);
  assert.match(await contentProblem('image', { name: 'x.jpg', slice: () => { throw new Error('gone'); } }), /לא הצלחנו לקרוא את "x\.jpg"/);
  assert.equal(await contentProblem('material_other', { name: 'x' }), null);
});
