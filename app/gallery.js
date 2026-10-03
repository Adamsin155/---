// The client's view-only gallery (gallery.html?t=…): the deliverables we made for
// them (graphics, videos, highlights, the site, other), for anyone they share the
// link with, without a login. Everything comes from the client-media function
// (supabase/functions/client-media), which checks the token in the database and
// signs each file for an hour: no staff names, no internal dates, no file names.
// View and download only. All text goes through text nodes, never innerHTML.
import { h } from './quote-doc.js';
import { KINDS, TOKEN, gallerySections, isImage, isVideo, formatSize } from './files-logic.js';
import { dayText } from './messages-logic.js';

const $ = (id) => document.getElementById(id);
const token = new URLSearchParams(location.search).get('t') || '';
let supa = null;
let refreshTimer = null;

export const CLOSED = {
  invalid: ['הקישור אינו תקין', 'ייתכן שהקישור הועתק באופן חלקי. בקשו מאיתנו לשלוח אותו שוב.'],
  expired: ['תוקף הקישור הסתיים', 'מטעמי אבטחה לקישור יש תוקף. בקשו מאיתנו קישור חדש, ונשלח אותו מיד.'],
  revoked: ['הקישור הזה כבר לא פעיל', 'ייתכן ששלחנו קישור חדש במקומו. בקשו מאיתנו את הקישור העדכני.'],
  closed: ['הגלריה כבר לא פעילה', 'לכל שאלה אפשר לפנות אלינו.'],
  error: ['לא הצלחנו לטעון את הדף', 'בדקו את החיבור לאינטרנט ורעננו את העמוד.'],
};

function showState(kind) {
  const [title, text] = CLOSED[kind] || CLOSED.error;
  $('page').hidden = true;
  $('state').replaceChildren(h('h1', {}, title), h('p', {}, text));
  $('state').hidden = false;
  document.title = `${title} · astrateg`;
}

async function load() {
  if (!TOKEN.test(token)) { showState('invalid'); return; }
  try {
    supa ||= await import('./supa.js');
    const { data, error } = await supa.supabase.functions.invoke('client-media', { body: { t: token, scope: 'gallery' } });
    if (error) throw error;
    if (!data || data.state !== 'ok') { showState(data?.state || 'invalid'); return; }
    render(data);
    // The signed URLs last an hour: fetch fresh ones a little before.
    clearTimeout(refreshTimer);
    // A video playing in the viewer keeps its URL (it is already streaming); the list is refreshed behind it.
    refreshTimer = setTimeout(load, Math.max(60, (data.ttl || 3600) - 300) * 1000);
  } catch {
    showState('error');
  }
}

const SECTION_ID = (kind) => `g-${kind.replace(/_/g, '-')}`;

function render(d) {
  const sections = gallerySections(d.files);
  document.title = `התוצרים של ${d.business} · astrateg`;
  $('sbar-title').textContent = `התוצרים · ${d.business}`;
  $('hello-h').textContent = `התוצרים של ${d.business}`;
  $('summary').textContent = sections.length ? sections.map((s) => `${s.title} ${s.files.length}`).join(' · ') : '';
  $('gnav').replaceChildren(...(sections.length > 1 ? sections.map((s) => h('a', { href: `#${SECTION_ID(s.kind)}`, class: 'gchip' }, `${s.title} (${s.files.length})`)) : []));
  $('empty').hidden = !!sections.length;
  $('sections').replaceChildren(...sections.map((s) => h('section', { class: 'scard gsec', id: SECTION_ID(s.kind), 'aria-labelledby': `${SECTION_ID(s.kind)}-h` },
    h('h2', { id: `${SECTION_ID(s.kind)}-h` }, `${s.title} (${s.files.length})`),
    h('ul', { class: s.kind === 'deliverable_site' || s.kind === 'deliverable_other' ? 'glist' : 'ggrid' }, s.files.map((f, i) => item(f, i, s))))));
  $('state').hidden = true;
  $('page').hidden = false;
}

function posted(f) {
  return f.postedOn ? h('span', { class: 'gposted' }, `עלה לרשתות ${dayText(new Date(`${f.postedOn}T12:00:00`))}`) : null;
}
function downloadLink(f, name) {
  return h('a', { class: 'gdl', href: f.download, rel: 'noopener', 'aria-label': `הורדה: ${name}` }, 'הורדה');
}

function item(f, i, s) {
  const kindLabel = KINDS[f.kind]?.label || 'קובץ';
  const name = f.label || `${kindLabel} ${i + 1}`;
  const postLink = f.link && f.kind !== 'deliverable_site'
    ? h('a', { class: 'gpost', href: f.link, target: '_blank', rel: 'noopener noreferrer' }, 'לפוסט ברשת', h('span', { class: 'sr-only' }, ' (נפתח בחלון חדש)')) : null;
  if (f.kind === 'deliverable_site' || f.kind === 'deliverable_other' || (!isImage(f.mime) && !isVideo(f.mime))) {
    const linkOnly = f.mime === 'text/uri-list';
    return h('li', { class: 'grow' },
      h('div', { class: 'gtext' }, h('strong', {}, f.label || (f.kind === 'deliverable_site' ? 'האתר שלכם' : name)),
        f.size && !linkOnly ? h('span', { class: 'muted' }, ` · ${formatSize(f.size)}`) : null, posted(f)),
      h('div', { class: 'gacts' },
        f.kind === 'deliverable_site' && f.link ? h('a', { class: 'sbtn sbtn-ok gopen', href: f.link, target: '_blank', rel: 'noopener noreferrer' }, 'פתיחת האתר', h('span', { class: 'sr-only' }, ' (נפתח בחלון חדש)')) : null,
        linkOnly ? null : downloadLink(f, name), postLink));
  }
  const total = s.files.length;
  const alt = f.label || `${kindLabel} ${i + 1} מתוך ${total}`;
  let media;
  if (isImage(f.mime)) {
    media = h('button', { type: 'button', class: 'gthumb', 'aria-label': `הגדלה: ${alt}`, onclick: () => view(f, alt) },
      h('img', { src: f.thumb || f.url, alt, loading: 'lazy', decoding: 'async', width: '240', height: '240',
        onerror: (e) => { if (f.thumb && e.currentTarget.src !== f.url) e.currentTarget.src = f.url; } }));
  } else {
    media = h('button', { type: 'button', class: 'gthumb gvideo', 'aria-label': `צפייה: ${alt}`, onclick: () => view(f, alt) },
      h('span', { class: 'gplay', 'aria-hidden': 'true' }, '▶'), h('span', { class: 'gvlabel' }, 'צפייה'));
  }
  return h('li', { class: 'gitem' }, media,
    h('div', { class: 'gmeta' }, f.label ? h('span', { class: 'gname' }, f.label) : null, posted(f),
      h('div', { class: 'gacts' }, downloadLink(f, alt), postLink)));
}

// Full size in a dialog: the image, or the video with its controls.
function view(f, alt) {
  const dlg = $('viewer');
  const body = $('viewer-body');
  $('viewer-h').textContent = alt;
  body.replaceChildren(isVideo(f.mime)
    ? h('video', { src: f.url, controls: true, playsinline: true, autoplay: true, preload: 'metadata', class: 'gfull' })
    : h('img', { src: f.url, alt, class: 'gfull' }));
  if (typeof dlg.showModal === 'function') dlg.showModal(); else window.open(f.url, '_blank', 'noopener');
}
$('viewer-close').addEventListener('click', () => $('viewer').close());
$('viewer').addEventListener('close', () => $('viewer-body').replaceChildren());
$('viewer').addEventListener('click', (e) => { if (e.target === $('viewer')) $('viewer').close(); });

load();
