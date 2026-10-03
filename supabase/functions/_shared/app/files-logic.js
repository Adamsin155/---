// generated — edit app/ instead. Source: app/files-logic.js. Regenerate: node scripts/sync-functions.mjs
// The client's files ("תיק לקוח"), without the DOM: the kinds and their words, the
// size and type limits, the object's path, who may upload or change what (the same
// rule as supabase/migrations/20261003110000_client_files.sql; the database decides,
// this only shapes the screen), and the client's view-only gallery link.
// Used by the client card and the characterization form (app/files-ui.js), the
// gallery (app/gallery.js) and the status page (app/status.js).

export const BUCKET = 'client-files';
export const MB = 1024 ** 2;
export const IMAGE_LIMIT = 20 * MB;
export const BIG_LIMIT = 2 * 1024 * MB;

// Every kind, in the order the card shows them. group: 'materials' (from the client)
// or 'deliverables' (what we made). accept: the file picker's filter (on a phone,
// image/* and video/* open the camera roll and the camera). needsLabel: a custom
// label is required. link: a link may stand in for a file.
export const KINDS = {
  logo: { group: 'materials', label: 'לוגו', plural: 'לוגו', accept: 'image/*,.pdf,.svg,.ai,.eps', types: ['image', 'logo'] },
  image: { group: 'materials', label: 'תמונה', plural: 'תמונות', accept: 'image/*', types: ['image'] },
  video_existing: { group: 'materials', label: 'סרטון קיים', plural: 'סרטונים קיימים', accept: 'video/*', types: ['video'] },
  material_other: { group: 'materials', label: 'תוספת', plural: 'תוספת מותאמת אישית', accept: '', needsLabel: true },
  deliverable_graphic: { group: 'deliverables', label: 'גרפיקה', plural: 'גרפיקות', accept: 'image/*', types: ['image'] },
  deliverable_video: { group: 'deliverables', label: 'סרטון', plural: 'סרטונים', accept: 'video/*', types: ['video'] },
  deliverable_highlight: { group: 'deliverables', label: 'Highlight', plural: 'Highlights', accept: 'image/*,video/*', types: ['image', 'video'] },
  deliverable_site: { group: 'deliverables', label: 'אתר / דף נחיתה', plural: 'אתר / דף נחיתה', accept: '', link: true },
  deliverable_other: { group: 'deliverables', label: 'אחר', plural: 'אחר', accept: '', needsLabel: true },
};
export const GROUPS = {
  materials: { title: 'חומרים מהלקוח', hint: 'מה שהלקוח מסר: לוגו, תמונות, סרטונים קיימים וכל דבר נוסף.' },
  deliverables: { title: 'תוצרים', hint: 'מה שהכנו ללקוח. גרפיקות, סרטונים, Highlights ואתר מופיעים גם בגלריה של הלקוח.' },
};
export const kindsOf = (group) => Object.keys(KINDS).filter((k) => KINDS[k].group === group);
// What the client's gallery shows.
export const GALLERY_KINDS = kindsOf('deliverables');

// Images (the logo, photos, graphics) up to 20 MB; everything else up to 2 GB
// (the table's client_files_size and the bucket's limit).
export const maxBytes = (kind) => (['logo', 'image', 'deliverable_graphic'].includes(kind) ? IMAGE_LIMIT : BIG_LIMIT);

export function formatSize(bytes) {
  const n = Number(bytes) || 0;
  if (n >= 1024 * MB) return `${(n / (1024 * MB)).toFixed(1).replace(/\.0$/, '')}GB`;
  if (n >= MB) return `${(n / MB).toFixed(1).replace(/\.0$/, '')}MB`;
  if (n >= 1024) return `${Math.round(n / 1024)}KB`;
  return `${n} בתים`;
}

export const isImage = (mime) => /^image\//.test(String(mime || ''));
export const isVideo = (mime) => /^video\//.test(String(mime || ''));
const LOGO_TYPES = /^(application\/(pdf|postscript|illustrator|eps)|image\/)/;
const LOGO_EXT = /\.(pdf|svg|ai|eps)$/i;

// Why this file cannot go into this kind (in Hebrew), or null.
export function fileProblem(kind, file) {
  const k = KINDS[kind];
  if (!k) return 'סוג קובץ לא מוכר.';
  const name = String(file?.name || 'הקובץ');
  const size = Number(file?.size) || 0;
  const mime = String(file?.type || '');
  if (size <= 0) return `"${name}" ריק. בחרו קובץ אחר.`;
  if (size > maxBytes(kind)) {
    return maxBytes(kind) === IMAGE_LIMIT
      ? `"${name}" גדול מדי (${formatSize(size)}). אפשר להעלות תמונה עד 20MB.`
      : `"${name}" גדול מדי (${formatSize(size)}). אפשר להעלות קובץ עד 2GB.`;
  }
  const types = k.types;
  if (types) {
    const ok = (types.includes('image') && isImage(mime)) || (types.includes('video') && isVideo(mime))
      || (types.includes('logo') && (LOGO_TYPES.test(mime) || LOGO_EXT.test(name)));
    if (!ok) {
      if (types.includes('logo')) return `"${name}" אינו קובץ לוגו. אפשר תמונה, PDF, SVG, AI או EPS.`;
      if (types.length === 2) return `"${name}" אינו תמונה או סרטון.`;
      return types[0] === 'video' ? `"${name}" אינו סרטון.` : `"${name}" אינו תמונה.`;
    }
  }
  return null;
}

// A file name the bucket accepts (Storage keys are ASCII): the extension kept, other
// characters (Hebrew, spaces, slashes) dropped, at most 80 characters.
export function safeName(name) {
  const raw = String(name || '').normalize('NFKC').split(/[\\/]/).pop();
  const dot = raw.lastIndexOf('.');
  const ext = dot > 0 ? raw.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8) : '';
  const base = (dot > 0 ? raw.slice(0, dot) : raw).replace(/[^A-Za-z0-9._-]+/g, '-').replace(/[-.]{2,}/g, '-').replace(/^[-._]+|[-._]+$/g, '').slice(0, 70);
  return `${base || 'file'}${ext ? `.${ext}` : ''}`;
}
// <client_id>/<kind>/<uuid>-<safe file name> (the table's client_files_path_shape).
export const objectPath = (clientId, kind, uuid, name) => `${clientId}/${kind}/${uuid}-${safeName(name)}`;
// The name a file is saved under when downloaded: the original, read back from the path.
export const fileNameOf = (path) => String(path || '').split('/').pop().replace(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-/, '');

export const validLink = (v) => /^https:\/\/[^\s"<>]+$/.test(String(v || '').trim()) && String(v).trim().length <= 2000;

// ── Who ───────────────────────────────────
// `me` is staff.person (null: the owner). The managers upload every kind, edit and
// delete anything; Ilai uploads graphics, highlights and the site and edits every
// deliverable (he posts them); an editor uploads videos for a client assigned to
// them (the database also counts a task someone opened for them).
export const MANAGERS = ['irit', 'lior', 'ofir'];
export const isManager = (me) => me === null || MANAGERS.includes(me);
export const EDITORS = ['nadia', 'yariv', 'anna', 'nirel'];
export const ILAI_KINDS = ['deliverable_graphic', 'deliverable_highlight', 'deliverable_site'];
export const assignedTo = (client, me) => !!me && (client?.editor === me || (client?.rounds || []).some((r) => r?.editor === me));

export function uploadKinds(me, client) {
  if (me === undefined) return [];
  if (isManager(me)) return Object.keys(KINDS);
  if (me === 'ilai') return [...ILAI_KINDS];
  if (EDITORS.includes(me) && assignedTo(client, me)) return ['deliverable_video'];
  return [];
}
export const canDelete = (me, file, myEmail) => isManager(me) || (!!myEmail && file?.uploaded_by === myEmail);
export const canEdit = (me, file, myEmail, client) => canDelete(me, file, myEmail)
  || (me === 'ilai' && KINDS[file?.kind]?.group === 'deliverables') || uploadKinds(me, client).includes(file?.kind);

// Live files per kind.
export function counts(files) {
  const out = Object.fromEntries(Object.keys(KINDS).map((k) => [k, 0]));
  for (const f of files || []) if (!f.deleted_at && f.kind in out) out[f.kind] += 1;
  return out;
}

// ── The client's gallery link ─────────────
// Irit, Lior and the owner make it (public.can_manage_status_links()).
export const LINK_MANAGERS = ['irit', 'lior'];
export const canManageGallery = (me) => me === null || LINK_MANAGERS.includes(me);
export const TOKEN = /^[A-Za-z0-9_-]{43}$/;
export const galleryUrl = (base, token) => new URL(`gallery.html?t=${encodeURIComponent(token)}`, base).href;
export const GALLERY_TEMPLATE = `היי {לקוח}, כאן אפשר לראות את כל התוצרים שהכנו לכם:
{קישור}
גרפיקות, סרטונים, Highlights והאתר, במקום אחד. אפשר לצפות ולהוריד.`;
export const galleryMessage = (client, url) => GALLERY_TEMPLATE.replace('{לקוח}', client?.name || '').replace('{קישור}', url);

// The name a file is saved under on the client's side: the kind and the day, never
// the file's own name (it may carry an internal note or a staff name).
const SLUG = { deliverable_graphic: 'graphic', deliverable_video: 'video', deliverable_highlight: 'highlight', deliverable_site: 'site', deliverable_other: 'file' };
export function downloadName(file, index = 0) {
  const ext = (/\.([a-z0-9]{1,8})$/.exec(fileNameOf(file?.path || '')) || [])[1] || '';
  const day = String(file?.at || '').slice(0, 10) || 'file';
  return `astrateg-${SLUG[file?.kind] || 'file'}-${day}${index ? `-${index}` : ''}${ext ? `.${ext}` : ''}`;
}

// The gallery's sections, in order, with what they hold.
export function gallerySections(files) {
  return GALLERY_KINDS.map((kind) => ({ kind, title: KINDS[kind].plural, files: (files || []).filter((f) => f.kind === kind) }))
    .filter((s) => s.files.length);
}

// A failed upload, in Hebrew.
export function uploadError(err) {
  const status = Number(err?.status) || 0;
  const msg = String(err?.message || err || '');
  if (err?.name === 'AbortError' || /aborted/i.test(msg)) return 'ההעלאה בוטלה.';
  if (status === 413 || /too large|maximum allowed size|exceeded/i.test(msg)) return 'הקובץ גדול מהמותר בשרת. אפשר עד 20MB לתמונה ועד 2GB לסרטון.';
  if (status === 403 || /row-level security|not allowed|Unauthorized/i.test(msg)) return 'אין לך הרשאה להעלות כאן קובץ מהסוג הזה.';
  if (status === 409 || /Duplicate|already exists/i.test(msg)) return 'קובץ בשם הזה כבר הועלה. נסו שוב.';
  if (status === 0 || /network|Failed to fetch|Load failed/i.test(msg)) return 'החיבור נקטע. בדקו את האינטרנט ונסו שוב; סרטון גדול ימשיך מהמקום שבו נעצר.';
  return 'ההעלאה לא הצליחה. נסו שוב.';
}
