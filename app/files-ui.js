// "תיק לקוח" in the client card (and the materials part of it in the
// characterization form on the phone): the client's files, uploaded into the system
// (Supabase Storage, the bucket client-files), never as Drive links.
//   חומרים מהלקוח  logo, photos, existing videos, a custom addition
//   תוצרים         graphics, videos, highlights, the site or landing page (a link, a
//                  file or both), "other" with its own label
// Each file: a preview (images, loaded only when on screen), play (videos), download,
// when and who uploaded, and for a deliverable the day it went up on the networks
// and the live post's link. Counts per kind. Signed URLs are made on demand, an hour
// each. The client's view-only gallery link (create, copy, WhatsApp, revoke) is here
// too, for Irit, Lior and the owner.
// Who may do what: app/files-logic.js (the database decides:
// supabase/migrations/20261003110000_client_files.sql). Uploads: app/upload.js.
// mountWorkFiles (below) is the same upload and the same tiles for one batch of work
// on the page where it is done: the round's videos in the editor's card, the graphics
// in Ilai's cards, and read-only in Ofir's quality-control dialog.
import { h } from './quote-doc.js';
import { supabase, SUPABASE_URL, SUPABASE_KEY } from './supa.js';
import { who, formatStamp, formatDay } from './protocol-ui.js';
import { dayText, timeText, waLink, groupLink } from './messages-logic.js';
import {
  BUCKET, KINDS, GROUPS, kindsOf, fileProblem, objectPath, fileNameOf, formatSize, isImage, isVideo, validLink,
  uploadKinds, canDelete, canEdit, counts, isManager, canManageGallery, galleryUrl, galleryMessage, uploadError, contentProblem,
  workFiles, uploadedText,
} from './files-logic.js';
import { uploadFile } from './upload.js';
import { tile as kTile, dressHead, headIcon, emptyRow } from './kit.js';

// The look of each kind's tile in the client card (app/kit.js; docs/ops.md, section 53).
const KIND_LOOK = {
  logo: ['star', 'purple'], image: ['image', 'green'], video_existing: ['video', 'orange'], material_other: ['file', 'purple'],
  deliverable_graphic: ['palette', 'pink'], deliverable_video: ['play', 'orange'], deliverable_highlight: ['target', 'purple'],
  deliverable_site: ['globe', 'blue'], deliverable_other: ['grid', 'navy'],
};
const filesText = (n) => (n === 1 ? 'קובץ אחד' : `${n} קבצים`);
// The "add" control of one kind: a tile in the client card, the plain button elsewhere.
function addControl(kind, { compact, tag = 'button', onclick = null }) {
  const k = KINDS[kind];
  const [name, tone] = KIND_LOOK[kind] || ['file', 'navy'];
  const node = kTile({ icon: name, tone, label: k.plural, count: filesText(0), id: `fl-add-${kind}`, cls: 'fl-add fl-tile', tag, onclick, lead: 'הוספה: ' });
  node.querySelector('.k-tile-n').dataset.tileCount = kind;
  return node;
}

const COLS = 'id, client_id, kind, label, storage_path, mime, size_bytes, posted_on, link, uploaded_by, created_at, deleted_at';
const LINK_COLS = 'id, created_at, created_by, expires_at, revoked_at, last_opened_at, open_count';
const TTL = 3600;
const THUMB = { width: 320, height: 320, resize: 'cover', quality: 70 };

// Per client: the files and the gallery link (shared by every mount of the same client).
const data = new Map();
// Per client and part: the block's element, kept across the page's re-renders so an
// upload in progress and a label being typed survive them.
const roots = new Map();
// Signed URLs already made: path (+ ':thumb') -> { url, until }.
const signed = new Map();

const missingTable = (err) => /client_files|client_gallery_links|does not exist|Could not find|schema cache/i.test(String(err?.message || err || ''));
const when = (v) => { const d = new Date(v); return `${dayText(d)} ${timeText(d)}`; };
const uuid = () => (globalThis.crypto?.randomUUID ? crypto.randomUUID()
  : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3) | 8).toString(16); }));

// ── Data ──────────────────────────────────
async function loadFiles(clientId) {
  const st = data.get(clientId);
  try {
    const { data: rows, error } = await supabase.from('client_files').select(COLS).eq('client_id', clientId)
      .is('deleted_at', null).order('created_at', { ascending: false }).limit(2000);
    if (error) throw error;
    st.files = rows || [];
    st.error = null;
  } catch (err) {
    st.files = [];
    st.error = missingTable(err) ? 'תיק הלקוח עוד לא הוקם במסד הנתונים.' : 'לא הצלחנו לטעון את הקבצים של הלקוח.';
  }
  st.loaded = true;
}
async function loadGallery(clientId, me) {
  const st = data.get(clientId);
  try {
    const { data: rows, error } = await supabase.from('client_gallery_links').select(LINK_COLS).eq('client_id', clientId)
      .order('created_at', { ascending: false }).limit(10);
    if (error) throw error;
    const active = (rows || []).find((l) => !l.revoked_at && new Date(l.expires_at) > new Date()) || null;
    let token = null;
    if (active && canManageGallery(me)) {
      const { data: t, error: e } = await supabase.rpc('gallery_link_token', { p_id: active.id });
      if (!e) token = t || null;
    }
    st.gallery = { links: rows || [], active, token, error: null };
  } catch (err) {
    st.gallery = { links: [], active: null, token: null, error: missingTable(err) ? 'הגלריה עוד לא הוקמה במסד הנתונים.' : 'לא הצלחנו לטעון את קישור הגלריה.' };
  }
}

// How many live files of a kind this client has (the characterization form asks about the logo).
export const fileCount = (clientId, kind) => (data.get(clientId)?.files || []).filter((f) => f.kind === kind).length;

async function signedUrl(path, { thumb = false, download = null } = {}) {
  const key = `${path}${thumb ? ':thumb' : ''}${download ? `:dl:${download}` : ''}`;
  const hit = signed.get(key);
  if (hit && hit.until > Date.now() + 60e3) return hit.url;
  const opts = thumb ? { transform: THUMB } : download ? { download } : undefined;
  const { data: d, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, TTL, opts);
  if (error || !d?.signedUrl) throw error || new Error('no url');
  signed.set(key, { url: d.signedUrl, until: Date.now() + TTL * 1000 });
  return d.signedUrl;
}

// Previews load when they come near the screen (a phone does not fetch a whole gallery).
let observer = null;
function lazy(img) {
  const load = async () => {
    const path = img.dataset.path;
    try {
      img.src = await signedUrl(path, { thumb: true });
    } catch {
      try { img.src = await signedUrl(path); } catch { img.alt = 'התצוגה לא נטענה'; }
    }
  };
  // Without image transformations on the project, the preview falls back to the image itself.
  img.addEventListener('error', async () => {
    if (img.dataset.full) return;
    img.dataset.full = '1';
    try { img.src = await signedUrl(img.dataset.path); } catch { /* stays empty */ }
  });
  if (!('IntersectionObserver' in window)) { load(); return; }
  observer ||= new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) { observer.unobserve(e.target); e.target.__load?.(); }
  }, { rootMargin: '200px' });
  img.__load = load;
  observer.observe(img);
}

// ── Mount ─────────────────────────────────
// opts: { client, me (staff.person; null: the owner; undefined: not known), myEmail,
//         toast, only: 'materials' | 'deliverables' | null, compact, onUploaded(kind) }
export function mountClientFiles(slot, opts) {
  if (!slot || !opts.client) return;
  const { client, only = null } = opts;
  if (!data.has(client.id)) data.set(client.id, { files: [], loaded: false, error: null, gallery: null, loading: null });
  const st = data.get(client.id);
  const key = `${client.id}:${only || 'all'}`;
  let root = roots.get(key);
  if (!root) {
    root = buildRoot(opts);
    roots.set(key, root);
  }
  root.__opts = opts;
  if (root.parentNode !== slot) slot.replaceChildren(root);
  if (!st.loaded && !st.loading) {
    st.loading = Promise.all([loadFiles(client.id), !only && opts.me !== undefined && (isManager(opts.me) || opts.me === 'ilai') ? loadGallery(client.id, opts.me) : null])
      .then(() => { st.loading = null; refreshAll(client.id); });
  }
  if (st.loaded) root.__draw();
}
function refreshAll(clientId) {
  for (const [k, r] of roots) if (k.startsWith(`${clientId}:`)) r.__draw();
}

function buildRoot(opts) {
  const { client, only, compact } = opts;
  const groups = only ? [only] : ['materials', 'deliverables'];
  const hid = `fl-h-${only || 'all'}`;
  const progress = h('ul', { class: 'fl-progress', 'aria-live': 'polite' });
  const err = h('div', { class: 'fl-errs', role: 'alert' });
  const parts = Object.fromEntries(groups.map((g) => [g, { body: h('div', { class: 'fl-body' }), counts: h('p', { class: 'fl-counts' }) }]));
  const galleryPart = h('div', { class: 'fl-gallery' });
  const status = h('p', { class: 'muted fl-status', role: 'status' });
  const root = h(compact ? 'div' : 'section', { class: `${compact ? 'fl-compact' : 'block cc-side'} fl-block`, id: compact ? 'files-materials' : 'files-block', 'aria-labelledby': hid },
    h('div', { class: 'side-head fl-head' },
      h(compact ? 'h3' : 'h2', { id: hid }, compact ? 'העלאת חומרים מהלקוח' : 'תיק לקוח'),
      h('p', { class: 'muted' }, compact
        ? 'לוגו, תמונות וסרטונים מהטלפון של הלקוח או מגלריית התמונות שלך. נשמרים בתיק הלקוח.'
        : 'כל הקבצים של הלקוח נשמרים כאן, במערכת עצמה: מה שהלקוח מסר ומה שהכנו לו.')),
    status,
    err,
    progress,
    ...groups.map((g) => h('div', { class: 'fl-group', id: `fl-${g}${compact ? '-c' : ''}` },
      compact ? null : h('h3', {}, GROUPS[g].title),
      parts[g].counts,
      compact ? null : h('p', { class: 'muted fl-hint' }, GROUPS[g].hint),
      uploadBar(g, { progress, err, compact }),
      parts[g].body)),
    only ? null : galleryPart);
  dressHead(root.querySelector('.fl-head'), compact ? 'upload' : 'folder', compact ? 'green' : 'navy');
  // The upload bars need the root's current options (the viewer may change after a refresh).
  root.__draw = () => {
    const o = root.__opts;
    const st = data.get(o.client.id);
    status.textContent = !st.loaded ? 'טוען את הקבצים…' : st.error || '';
    status.hidden = st.loaded && !st.error;
    const may = uploadKinds(o.me, o.client);
    for (const bar of root.querySelectorAll('[data-kind-btn]')) bar.hidden = !may.includes(bar.dataset.kindBtn) || !!st.error;
    for (const g of groups) {
      const c = counts(st.files);
      parts[g].counts.replaceChildren(...kindsOf(g).flatMap((k, i) => [i ? ' · ' : '', h('span', { 'data-count': k }, `${KINDS[k].plural} ${c[k]}`)]));
      for (const n of root.querySelectorAll('[data-tile-count]')) n.textContent = filesText(c[n.dataset.tileCount] || 0);
      parts[g].body.replaceChildren(...(st.loaded && !st.error ? listOf(g, o) : []));
    }
    if (!only) galleryPart.replaceChildren(...galleryBlock(o));
  };
  return root;
}

// ── Uploading ─────────────────────────────
// One button per kind the viewer may upload (hidden otherwise). A kind with a custom
// label, or the site (a link), opens a small form first.
function uploadBar(group, { progress, err, compact = false }) {
  const bar = h('div', { class: `fl-bar k-tiles${compact ? ' fl-tiles-sm' : ''}` });
  for (const kind of kindsOf(group)) {
    const k = KINDS[kind];
    const input = h('input', { type: 'file', class: 'sr-only', id: `fl-in-${kind}-${Math.random().toString(36).slice(2, 7)}`, accept: k.accept || null, multiple: k.needsLabel || k.link || kind === 'logo' ? null : true, tabindex: '-1', 'aria-hidden': 'true' });
    const run = (files, extra = {}) => startUploads(bar, kind, files, { progress, err, ...extra });
    if (!k.needsLabel && !k.link) {
      input.addEventListener('change', () => { const files = [...input.files]; input.value = ''; run(files); });
      bar.append(h('span', { 'data-kind-btn': kind, hidden: true },
        addControl(kind, { compact, onclick: () => input.click() }), input));
      continue;
    }
    // The custom addition, "other", and the site: a label (and a link) first.
    const fid = `fl-${kind}-${Math.random().toString(36).slice(2, 7)}`;
    const label = h('input', { class: 'input', id: `${fid}-label`, maxlength: '120', autocomplete: 'off', enterkeyhint: 'done' });
    const link = k.link ? h('input', { class: 'input', id: `${fid}-link`, type: 'url', inputmode: 'url', dir: 'ltr', placeholder: 'https://', maxlength: '2000' }) : null;
    const fErr = h('p', { class: 'err', id: `${fid}-err`, hidden: true });
    const chosen = h('span', { class: 'muted fl-chosen' });
    let picked = [];
    input.addEventListener('change', () => { picked = [...input.files]; input.value = ''; chosen.textContent = picked.length ? picked[0].name : ''; });
    const stopEnter = (e) => { if (e.key === 'Enter') { e.preventDefault(); save(); } };
    label.addEventListener('keydown', stopEnter);
    link?.addEventListener('keydown', stopEnter);
    const box = h('details', { class: 'fl-form', 'data-kind-btn': kind, hidden: true },
      addControl(kind, { compact, tag: 'summary' }),
      h('div', { class: 'fl-form-body' },
        h('div', { class: 'field' }, h('label', { for: label.id }, k.link ? 'שם (לא חובה)' : 'מה זה? (חובה)'), label),
        link ? h('div', { class: 'field' }, h('label', { for: link.id }, 'קישור לאתר או לדף הנחיתה'), link) : null,
        h('div', { class: 'fl-row' },
          h('button', { type: 'button', class: 'btn btn-sm btn-ghost', onclick: () => input.click() }, k.link ? 'צירוף קובץ (לא חובה)' : 'בחירת קובץ'),
          chosen, input),
        fErr,
        h('button', { type: 'button', class: 'btn btn-sm btn-primary', id: `${fid}-save`, onclick: () => save() }, 'שמירה')));
    async function save() {
      fErr.hidden = true;
      const lbl = label.value.trim();
      const url = link ? link.value.trim() : '';
      const fail = (msg, el) => { fErr.textContent = msg; fErr.hidden = false; el?.focus(); };
      if (k.needsLabel && !lbl) return fail('כתבו מה זה, כדי שכולם יבינו.', label);
      if (k.link && !url && !picked.length) return fail('הוסיפו קישור או קובץ.', link);
      if (url && !validLink(url)) return fail('הקישור צריך להתחיל ב־https://', link);
      if (!k.link && !picked.length) return fail('בחרו קובץ.', null);
      const files = picked.length ? picked : [linkFile(url)];
      const ok = await run(files, { label: lbl || null, link: url || null });
      if (ok) { label.value = ''; if (link) link.value = ''; picked = []; chosen.textContent = ''; box.open = false; }
    }
    bar.append(box);
  }
  return bar;
}
// A site given only as a link is kept as a small text file holding the link, so
// every row has a real object (the contract: storage_path is never empty).
function linkFile(url) {
  const blob = new Blob([`${url}\n`], { type: 'text/uri-list' });
  try { return new File([blob], 'link.url', { type: 'text/uri-list' }); } catch { blob.name = 'link.url'; return blob; }
}

async function startUploads(bar, kind, files, { progress, err, label = null, link = null }) {
  const root = bar.closest('.fl-block');
  const o = root.__opts;
  const st = data.get(o.client.id);
  err.replaceChildren();
  // The size and the declared type first; then the first bytes, so a text file renamed
  // .mp4 is refused here and never reaches the gallery.
  const problems = await Promise.all(files.map(async (f) => [f, fileProblem(kind, f) || await contentProblem(kind, f)]));
  const bad = problems.filter(([, p]) => p);
  if (bad.length) err.replaceChildren(...bad.map(([, p]) => h('p', { class: 'err' }, p)));
  let all = !bad.length;
  for (const [file, p] of problems) {
    if (p) continue;
    const ok = await uploadOne(o, st, kind, file, { progress, err, label, link });
    all = all && ok;
  }
  root.__draw();
  return all;
}

async function uploadOne(o, st, kind, file, { progress, err, label, link }) {
  const ctl = new AbortController();
  const bar = h('progress', { max: '100', value: '0', 'aria-label': `העלאה: ${file.name}` });
  const pct = h('span', { class: 'fl-pct' }, '0%');
  const cancel = h('button', { type: 'button', class: 'btn-text', onclick: () => ctl.abort() }, 'ביטול');
  const row = h('li', {}, h('span', { class: 'fl-pname' }, `${KINDS[kind].label}: ${file.name}`), bar, pct, cancel);
  progress.append(row);
  const path = objectPath(o.client.id, kind, uuid(), file.name || 'file');
  try {
    const { data: s } = await supabase.auth.getSession();
    const token = s?.session?.access_token;
    if (!token) throw Object.assign(new Error('not signed in'), { status: 403 });
    const res = await uploadFile({
      url: SUPABASE_URL, apikey: SUPABASE_KEY, token, bucket: BUCKET, path, file, signal: ctl.signal,
      contentType: file.type || undefined,
      resumeKey: `upload:${o.client.id}:${kind}:${file.name}:${file.size}:${file.lastModified || 0}`,
      onProgress: (sent, total) => { const v = total ? Math.floor((sent / total) * 100) : 0; bar.value = v; pct.textContent = `${v}%`; },
    });
    const { data: rowData, error } = await supabase.from('client_files').insert({
      client_id: o.client.id, kind, label, storage_path: res.path, mime: file.type || null, size_bytes: file.size, link,
    }).select(COLS).single();
    if (error) {
      // The file went up but its row was refused: take it out of the bucket again.
      await supabase.storage.from(BUCKET).remove([res.path]).catch(() => {});
      throw Object.assign(new Error(error.message), { status: /row-level security|permission/.test(error.message) ? 403 : 500 });
    }
    st.files = [rowData, ...st.files];
    row.remove();
    o.toast?.(`הועלה: ${KINDS[kind].label}${file.name && file.name !== 'link.url' ? ` (${file.name})` : ''}.`);
    o.onUploaded?.(kind, rowData);
    return true;
  } catch (e) {
    row.remove();
    // Where the work stops on a failed upload, the page says what to do next (failHelp).
    err.append(h('p', { class: 'err' }, `${file.name}: ${uploadError(e)}${o.failHelp && e?.name !== 'AbortError' ? ` ${o.failHelp}` : ''}`));
    return false;
  }
}

// ── The list ──────────────────────────────
function listOf(group, o) {
  const st = data.get(o.client.id);
  const out = [];
  for (const kind of kindsOf(group)) {
    const files = st.files.filter((f) => f.kind === kind);
    if (!files.length) continue;
    out.push(h('div', { class: 'fl-kind', 'data-kind': kind },
      h('h4', {}, `${KINDS[kind].plural} (${files.length})`),
      h('ul', { class: 'fl-grid' }, files.map((f) => tile(f, o)))));
  }
  if (!out.length) {
    const words = group === 'materials' ? 'עוד לא הועלו חומרים.' : 'עוד לא הועלו תוצרים.';
    const may = uploadKinds(o.me, o.client).some((k) => KINDS[k].group === group);
    out.push(emptyRow({ icon: 'upload', text: may ? `${words} ${group === 'materials' ? 'בחרו סוג קובץ למעלה כדי להתחיל.' : 'בחרו סוג תוצר למעלה כדי להתחיל.'}` : words }));
  }
  return out;
}

function tile(f, o) {
  const name = f.label || (f.kind === 'deliverable_site' && f.link ? f.link.replace(/^https:\/\//, '') : fileNameOf(f.storage_path));
  const isLinkOnly = f.mime === 'text/uri-list';
  let media;
  if (isImage(f.mime)) {
    const img = h('img', { alt: f.label || KINDS[f.kind].label, 'data-path': f.storage_path, width: '160', height: '160', decoding: 'async' });
    lazy(img);
    media = h('div', { class: 'fl-media' }, img);
  } else if (isVideo(f.mime)) {
    const play = h('button', { type: 'button', class: 'fl-play', 'aria-label': `הפעלת הסרטון ${name}` }, h('span', { 'aria-hidden': 'true' }, '▶'), ' הפעלה');
    media = h('div', { class: 'fl-media fl-video' }, play);
    play.addEventListener('click', async () => {
      play.disabled = true;
      try {
        const v = h('video', { controls: true, playsinline: true, preload: 'metadata', src: await signedUrl(f.storage_path) });
        media.replaceChildren(v);
        v.play?.().catch(() => {});
      } catch { play.disabled = false; o.toast?.('הסרטון לא נטען. נסו שוב.'); }
    });
  } else {
    media = h('div', { class: 'fl-media fl-doc', 'aria-hidden': 'true' }, isLinkOnly ? 'קישור' : (/\.([a-z0-9]{1,8})$/.exec(f.storage_path)?.[1] || 'קובץ').toUpperCase());
  }
  const group = KINDS[f.kind].group;
  const editable = canEdit(o.me, f, o.myEmail, o.client);
  const meta = h('div', { class: 'fl-meta' },
    h('strong', { class: 'fl-name' }, name),
    h('span', { class: 'fl-sub' }, `${formatStamp(f.created_at)} · ${who(f.uploaded_by) || 'לא ידוע'}${f.size_bytes && !isLinkOnly ? ` · ${formatSize(f.size_bytes)}` : ''}`));
  if (f.link) meta.append(h('a', { class: 'fl-link', href: f.link, target: '_blank', rel: 'noopener noreferrer', dir: 'ltr' }, f.kind === 'deliverable_site' ? 'פתיחת האתר' : 'הפוסט ברשת', h('span', { class: 'sr-only' }, ' (נפתח בחלון חדש)')));
  // postedPart is null for a reader with nothing to show: append(null) would print the word "null".
  const posted = group === 'deliverables' && !o.plain ? postedPart(f, o, editable) : null;
  if (posted) meta.append(posted);
  const acts = h('div', { class: 'fl-acts' },
    isLinkOnly ? null : h('button', {
      type: 'button', class: 'btn-text', 'aria-label': `הורדה: ${name}`,
      onclick: async () => {
        try {
          const a = h('a', { href: await signedUrl(f.storage_path, { download: fileNameOf(f.storage_path) }), download: fileNameOf(f.storage_path), rel: 'noopener' });
          document.body.append(a); a.click(); a.remove();
        } catch { o.toast?.('ההורדה לא התחילה. נסו שוב.'); }
      },
    }, 'הורדה'),
    !o.readOnly && canDelete(o.me, f, o.myEmail) ? h('button', { type: 'button', class: 'btn-text fl-del', 'aria-label': `מחיקה: ${name}`, onclick: () => remove(f, o) }, 'מחיקה') : null);
  return h('li', { class: 'fl-item', 'data-id': f.id }, media, meta, acts);
}

// "עלה לרשתות בתאריך" and the post's link: saved as they change.
function postedPart(f, o, editable) {
  if (!editable) {
    return f.posted_on ? h('span', { class: 'fl-posted' }, `עלה לרשתות ${formatDay(f.posted_on)}`) : null;
  }
  const did = `fl-posted-${f.id}`;
  const lid = `fl-plink-${f.id}`;
  const date = h('input', { class: 'input fl-date', type: 'date', id: did, dir: 'ltr', value: f.posted_on || '' });
  const link = h('input', { class: 'input', type: 'url', id: lid, dir: 'ltr', inputmode: 'url', placeholder: 'https://', value: f.link || '', maxlength: '2000' });
  const save = async (patch, el) => {
    const { error } = await supabase.from('client_files').update(patch).eq('id', f.id).select('id').single();
    if (error) { o.toast?.('לא נשמר. נסו שוב.'); el.focus(); return; }
    Object.assign(f, patch);
    o.toast?.(patch.posted_on !== undefined ? (patch.posted_on ? `נשמר: עלה לרשתות ${formatDay(patch.posted_on)}.` : 'התאריך נמחק.') : 'הקישור נשמר.');
  };
  date.addEventListener('change', () => save({ posted_on: date.value || null }, date));
  const saveLink = () => {
    const v = link.value.trim();
    if (v === (f.link || '')) return;
    if (v && !validLink(v)) { o.toast?.('הקישור צריך להתחיל ב־https://'); link.focus(); return; }
    save({ link: v || null }, link);
  };
  link.addEventListener('change', saveLink);
  link.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); saveLink(); } });
  return h('details', { class: 'fl-post', open: !!f.posted_on || null },
    h('summary', {}, f.posted_on ? `עלה לרשתות ${formatDay(f.posted_on)}` : 'עלה לרשתות בתאריך…'),
    h('div', { class: 'field' }, h('label', { for: did }, 'עלה לרשתות בתאריך'), date),
    f.kind === 'deliverable_site' ? null : h('div', { class: 'field' }, h('label', { for: lid }, 'קישור לפוסט (לא חובה)'), link));
}

async function remove(f, o) {
  const name = f.label || KINDS[f.kind].label;
  if (!window.confirm(`למחוק את "${name}" מתיק הלקוח?`)) return;
  const { error } = await supabase.from('client_files').update({ deleted_at: new Date().toISOString() }).eq('id', f.id).select('id').single();
  if (error) { o.toast?.(/only the office|row-level|permission/i.test(error.message) ? 'רק המשרד או מי שהעלה מוחקים קובץ.' : 'לא נמחק. נסו שוב.'); return; }
  const st = data.get(o.client.id);
  st.files = st.files.filter((x) => x.id !== f.id);
  o.toast?.(`נמחק: ${name}.`);
  refreshAll(o.client.id);
  o.onChange?.();
}

// ── One batch of work, on the page where it is done ──
// The files of one kind inside a window (app/files-logic.js workFiles): how many are
// up against the package, the tiles (a video plays in place), and, for whoever may
// upload that kind for this client, one upload button. Returns the block's element;
// it is kept per client and `idp`, so a page that rebuilds its cards gets the same
// element back and an upload in progress survives.
// opts: { client, kind, window, me, myEmail, idp, title, total, readOnly, hideEmpty, failHelp,
//         toast, onChange() (the list changed, or finished loading) }
export function workFilesState(clientId) {
  const st = data.get(clientId);
  return { loaded: !!st?.loaded, error: st?.error || null, files: st?.files || [] };
}
// Reads a client's files before anything is drawn, so a page's lock is right on its
// first paint (the editor's page). Never throws: a failed read is the state's error.
export function readFiles(clientId) {
  if (!data.has(clientId)) data.set(clientId, { files: [], loaded: false, error: null, gallery: null, loading: null });
  const st = data.get(clientId);
  if (st.loaded) return Promise.resolve();
  st.loading ||= loadFiles(clientId).then(() => { st.loading = null; refreshAll(clientId); });
  return st.loading;
}
// The next mount of this client reads its files again (a page's "רענון").
export function forgetFiles(clientId) {
  const st = data.get(clientId);
  if (st && !st.loading) st.loaded = false;
}
export function mountWorkFiles(opts) {
  const { client, idp } = opts;
  if (!data.has(client.id)) data.set(client.id, { files: [], loaded: false, error: null, gallery: null, loading: null });
  const st = data.get(client.id);
  const key = `${client.id}:work:${idp}`;
  let root = roots.get(key);
  if (!root) {
    root = buildWork(opts);
    roots.set(key, root);
  }
  // uploadOne and tile read these: no "עלה לרשתות" fields here, and the page hears a change.
  root.__opts = { ...opts, plain: true, onUploaded: () => root.__opts.onChange?.() };
  if (!st.loaded && !st.loading) {
    st.loading = loadFiles(client.id).then(() => { st.loading = null; refreshAll(client.id); root.__opts.onChange?.(); });
  }
  root.__draw();
  return root;
}
function buildWork(opts) {
  const { kind, idp } = opts;
  const k = KINDS[kind];
  const head = h('p', { class: 'fl-work-h' });
  const status = h('p', { class: 'muted fl-status', role: 'status' });
  const err = h('div', { class: 'fl-errs', role: 'alert' });
  const progress = h('ul', { class: 'fl-progress', 'aria-live': 'polite' });
  const list = h('ul', { class: 'fl-grid' });
  const input = h('input', { type: 'file', class: 'sr-only', id: `${idp}-in`, accept: k.accept || null, multiple: true, tabindex: '-1', 'aria-hidden': 'true' });
  // The kit's "add" tile (docs/ops.md, section 54): the square of the kind, a plus at the
  // corner, the name and how many are up. The same button, the same id.
  const [tileIcon, tileTone] = KIND_LOOK[kind] || ['file', 'navy'];
  const add = kTile({ icon: tileIcon, tone: tileTone, label: `העלאת ${k.plural}`, count: filesText(0), id: `${idp}-add`, cls: 'fl-add fl-tile fl-work-add', onclick: () => input.click() });
  const addCount = add.querySelector('.k-tile-n');
  const empty = emptyRow({ icon: 'upload', text: '' });
  empty.classList.add('fl-work-empty');
  const bar = h('div', { class: 'fl-bar fl-work-bar' }, add, input, empty);
  input.addEventListener('change', () => { const files = [...input.files]; input.value = ''; startUploads(bar, kind, files, { progress, err }); });
  const root = h('div', { class: 'fl-block fl-work', id: `${idp}-files`, 'data-kind': kind }, head, status, err, progress, bar, list);
  root.__draw = () => {
    const o = root.__opts;
    const st = data.get(o.client.id);
    const files = workFiles(st.files, kind, o.window);
    head.replaceChildren(h('strong', {}, o.title || k.plural), ` · ${uploadedText(files.length, o.total)}`);
    status.textContent = !st.loaded ? 'טוען את הקבצים…' : st.error || '';
    status.hidden = st.loaded && !st.error;
    bar.hidden = !!o.readOnly || !!st.error || !uploadKinds(o.me, o.client).includes(kind);
    addCount.textContent = o.total ? `${files.length} מתוך ${o.total}` : filesText(files.length);
    empty.hidden = !st.loaded || !!files.length;
    empty.querySelector('p').textContent = `עוד לא הועלו ${k.plural}. בוחרים קבצים מהמחשב או מהטלפון.`;
    // The same tiles while nothing changed: a video that is playing keeps playing.
    const sig = `${o.myEmail || ''}|${files.map((f) => f.id).join()}`;
    if (list.dataset.sig !== sig) { list.dataset.sig = sig; list.replaceChildren(...files.map((f) => tile(f, o))); }
    list.hidden = !files.length;
    // hideEmpty: a read-only list with nothing in it is not drawn at all.
    root.hidden = !!o.hideEmpty && st.loaded && !st.error && !files.length;
  };
  return root;
}

// ── The client's gallery link ─────────────
function galleryBlock(o) {
  const st = data.get(o.client.id);
  if (o.me === undefined || !(isManager(o.me) || o.me === 'ilai')) return [];
  const head = [headIcon(h('h3', { id: 'fl-gal-h' }, 'גלריה ללקוח (צפייה בלבד)'), 'image', 'teal'),
    h('p', { class: 'muted' }, 'קישור שאפשר לשלוח ללקוח או לצוות שלו: הגרפיקות, הסרטונים, ה־Highlights והאתר. בלי שמות עובדים, בלי מועדים פנימיים, בלי אפשרות לשנות.')];
  const g = st.gallery;
  if (!g) return [...head, h('p', { class: 'muted' }, 'טוען…')];
  if (g.error) return [...head, h('p', { class: 'muted', role: 'status' }, g.error)];
  const manage = canManageGallery(o.me);
  const reload = async (focusId) => { await loadGallery(o.client.id, o.me); refreshAll(o.client.id); document.getElementById(focusId)?.focus(); };
  const create = async (again) => {
    if (again && !window.confirm('ליצור קישור חדש? הקישור הקודם יפסיק לעבוד.')) return;
    const { error } = await supabase.rpc('gallery_link_create', { p_client: o.client.id });
    if (error) { o.toast?.(/not allowed/.test(error.message) ? 'רק עירית, ליאור והבעלים יוצרים קישור.' : /client not open/.test(error.message) ? 'ללקוח שבוטל אין גלריה.' : 'הקישור לא נוצר. נסו שוב.'); return; }
    o.toast?.('נוצר קישור לגלריה. אפשר להעתיק ולשלוח ללקוח.');
    await reload('fl-gal-copy-msg');
  };
  const revoke = async () => {
    if (!window.confirm('לבטל את קישור הגלריה? מי שיש לו את הקישור לא יוכל לפתוח אותו.')) return;
    const { error } = await supabase.rpc('gallery_link_revoke', { p_id: g.active.id });
    if (error) { o.toast?.('הקישור לא בוטל. נסו שוב.'); return; }
    o.toast?.('קישור הגלריה בוטל.');
    await reload('fl-gal-create');
  };
  const copy = async (text) => {
    try { await navigator.clipboard.writeText(text); o.toast?.('הועתק.'); } catch { o.toast?.('ההעתקה לא הצליחה. אפשר לסמן ולהעתיק ידנית.'); }
  };
  if (!g.active) {
    const last = g.links[0];
    return [...head,
      h('p', { class: 'st-state' }, last ? (last.revoked_at ? `הקישור האחרון בוטל ב${when(last.revoked_at)}.` : `תוקף הקישור האחרון הסתיים ב${when(last.expires_at)}.`) : 'עוד לא נוצר קישור לגלריה.'),
      manage ? h('button', { type: 'button', class: 'btn btn-sm k-btn-navy', id: 'fl-gal-create', onclick: () => create(false) }, 'יצירת קישור לגלריה')
        : h('p', { class: 'muted' }, 'עירית, ליאור או הבעלים יוצרים את הקישור.')];
  }
  const url = g.token ? galleryUrl(location.href, g.token) : null;
  const msg = url ? galleryMessage(o.client, url) : null;
  const a = g.active;
  return [...head,
    h('p', { class: 'st-state', id: 'fl-gal-state' }, h('strong', {}, 'קישור פעיל'), ` עד ${dayText(new Date(a.expires_at), new Date())} · `,
      a.open_count ? `נפתח ${a.open_count === 1 ? 'פעם אחת' : `${a.open_count} פעמים`}, לאחרונה ${when(a.last_opened_at)}` : 'עוד לא נפתח'),
    manage && url ? h('div', { class: 'st-acts' },
      h('button', { type: 'button', class: 'btn btn-sm k-btn-navy', id: 'fl-gal-copy-msg', onclick: () => copy(msg) }, 'העתקת הודעה עם הקישור'),
      h('a', { class: 'btn btn-sm', id: 'fl-gal-wa', href: o.client.phone ? waLink(o.client.phone, msg) : groupLink(msg), target: '_blank', rel: 'noopener' }, 'שליחה ב־WhatsApp', h('span', { class: 'sr-only' }, ' (נפתח בחלון חדש)')),
      h('button', { type: 'button', class: 'btn-text', id: 'fl-gal-copy', onclick: () => copy(url) }, 'העתקת הקישור'),
      h('a', { class: 'btn-text', id: 'fl-gal-open', href: url, target: '_blank', rel: 'noopener' }, 'פתיחה', h('span', { class: 'sr-only' }, ' (נפתח בחלון חדש)')),
      h('button', { type: 'button', class: 'btn-text', id: 'fl-gal-new', onclick: () => create(true) }, 'קישור חדש'),
      h('button', { type: 'button', class: 'btn-text st-danger', id: 'fl-gal-revoke', onclick: revoke }, 'ביטול הקישור')) : null];
}
