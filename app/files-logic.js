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

// The content types the bucket takes (its allowed_mime_types, set in
// supabase/migrations/20261014100000_security_hardening.sql; a database test keeps
// the two lists the same). Everything the kinds above ask for, and for the free
// kinds ("תוספת", "אחר") documents, fonts, archives and plain text. A file the
// browser cannot name goes up as application/octet-stream (.ai, .eps, .psd). Not on
// the list, and refused by Storage: a web page, a script, XML.
export const UPLOAD_TYPES = [
  'image/*', 'video/*', 'audio/*', 'font/*',
  'application/pdf', 'application/postscript', 'application/illustrator', 'application/eps', 'application/x-eps',
  'application/octet-stream', 'application/zip', 'application/x-zip-compressed',
  'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.ms-fontobject', 'application/x-font-ttf', 'application/x-font-otf', 'application/font-woff',
  'text/plain', 'text/csv',
  // A link kept in place of a file ("אתר / דף נחיתה": app/files-ui.js stores a small text/uri-list object).
  'text/uri-list',
];
// The type a file is uploaded with (app/upload.js): what the browser reports, or "unknown binary".
export const uploadTypeOf = (file) => String(file?.type || '').toLowerCase().split(';')[0].trim() || 'application/octet-stream';
export const uploadTypeAllowed = (mime) => {
  const m = String(mime || '').toLowerCase().split(';')[0].trim() || 'application/octet-stream';
  return UPLOAD_TYPES.some((t) => (t.endsWith('/*') ? m.startsWith(t.slice(0, -1)) && m.length > t.length - 1 : m === t));
};

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
  if (!uploadTypeAllowed(mime)) return `אי אפשר להעלות את "${name}": סוג הקובץ הזה (${mime}) לא נשמר בתיק הלקוח. אפשר תמונה, סרטון, PDF, מסמך, גופן או קובץ ZIP.`;
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

// ── What a file really is: its first bytes ──
// Found live (6.10.2026): a 2 KB text file named .mp4 went up as a video and showed in
// the client's gallery. The name and the type the browser reports come from the
// extension; the first bytes do not lie. `sniff` names the format, or null:
//   images     jpeg, png, gif, webp, svg, and the phone's heic / avif
//   documents  pdf, ps (a logo in PDF, AI or EPS)
//   videos     mp4 (also m4v and 3gp: the same container), mov, webm
export const SNIFF_BYTES = 4096;
const HEIF_BRANDS = /^(heic|heix|hevc|hevx|heim|heis|mif1|msf1|avif|avis)$/;
const AUDIO_BRANDS = /^(M4A |M4B |M4P )$/;
const ascii = (b, from, to) => String.fromCharCode(...b.subarray(from, Math.min(to, b.length)));
export function sniff(input) {
  const b = input instanceof Uint8Array ? input : new Uint8Array(input || []);
  if (b.length < 4) return null;
  const starts = (...sig) => sig.every((v, i) => b[i] === v);
  if (starts(0xff, 0xd8, 0xff)) return 'jpeg';
  if (starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'png';
  if (/^GIF8[79]a/.test(ascii(b, 0, 6))) return 'gif';
  if (ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 12) === 'WEBP') return 'webp';
  if (ascii(b, 0, 5) === '%PDF-') return 'pdf';
  if (ascii(b, 0, 4) === '%!PS' || starts(0xc5, 0xd0, 0xd3, 0xc6)) return 'ps';
  if (starts(0x1a, 0x45, 0xdf, 0xa3)) return 'webm';
  const box = ascii(b, 4, 8);
  if (box === 'ftyp') {
    const brand = ascii(b, 8, 12);
    if (HEIF_BRANDS.test(brand)) return brand.startsWith('avi') ? 'avif' : 'heic';
    if (AUDIO_BRANDS.test(brand)) return null;
    return brand === 'qt  ' ? 'mov' : 'mp4';
  }
  // An older QuickTime file starts with one of its atoms, without ftyp.
  if (['moov', 'mdat', 'wide', 'free', 'skip', 'pnot'].includes(box)) return 'mov';
  // SVG is text: an <svg> element near the top (after a BOM, an XML header, a comment).
  const text = ascii(b, 0, SNIFF_BYTES).replace(/^\u00ef\u00bb\u00bf/, '').trimStart();
  if (text.startsWith('<') && /<svg[\s>]/i.test(text)) return 'svg';
  return null;
}
const FORMATS = {
  image: ['jpeg', 'png', 'gif', 'webp', 'svg', 'heic', 'avif'],
  video: ['mp4', 'mov', 'webm'],
  logo: ['pdf', 'ps'],
};
// Why this file's content does not fit this kind (in Hebrew), or null. Kinds without
// a type rule (a custom addition, "other", the site) take any content.
export function contentMismatch(kind, name, bytes) {
  const types = KINDS[kind]?.types;
  if (!types) return null;
  const format = sniff(bytes);
  if (format && types.some((t) => FORMATS[t].includes(format))) return null;
  const n = String(name || 'הקובץ');
  if (types.includes('logo')) return `"${n}" אינו קובץ לוגו תקין: התוכן שלו לא תואם לסוג הקובץ. אפשר תמונה (JPG, PNG, WebP, GIF, SVG), PDF, AI או EPS.`;
  if (types.length === 2) return `"${n}" אינו תמונה או סרטון: התוכן שלו לא תואם לסוג הקובץ. אפשר JPG, PNG, WebP, GIF, או סרטון MP4, MOV, WebM, M4V.`;
  return types[0] === 'video'
    ? `"${n}" אינו סרטון: התוכן שלו לא תואם לסוג הקובץ. אפשר להעלות MP4, MOV, WebM או M4V.`
    : `"${n}" אינו תמונה: התוכן שלו לא תואם לסוג הקובץ. אפשר להעלות JPG, PNG, WebP, GIF או SVG.`;
}
// The same, reading the file's first bytes in the browser. A file that cannot be
// read at all is refused too (it could not be uploaded either).
export async function contentProblem(kind, file) {
  if (!KINDS[kind]?.types) return null;
  let bytes;
  try {
    bytes = new Uint8Array(await file.slice(0, SNIFF_BYTES).arrayBuffer());
  } catch {
    return `לא הצלחנו לקרוא את "${String(file?.name || 'הקובץ')}". בחרו אותו שוב.`;
  }
  return contentMismatch(kind, file?.name, bytes);
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
// The token rides in the fragment (app/link-token.js): it reaches no log of the host.
export const galleryUrl = (base, token) => `${new URL('gallery.html', base).href}#t=${encodeURIComponent(token)}`;
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
