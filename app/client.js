// Client-facing quote page: loads a quote by token and lets the client sign it.
import { renderQuoteDoc, formatDate } from './quote-doc.js';
import { formatILS } from './pricing.js';
import { pageToken } from './link-token.js';
import { headIcon } from './kit.js';

// The look of the kit, kept small here (app/kit.js; docs/ops.md, section 53): an icon
// square on the two headings around the document. The document itself, the legal text
// and the signature area are exactly as they were, on the screen and in print.
headIcon(document.getElementById('sign-h'), 'sign', 'purple', { size: 'md' });
headIcon(document.querySelector('#expired > h2'), 'clock', 'orange', { size: 'md' });

const $ = (id) => document.getElementById(id);
const token = pageToken(); // q.html#t=… (and ?t=… of a link sent before 6.10.2026)
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
let quote = null;
let supa = null;

function showState(title, text) {
  const box = $('state');
  const h1 = document.createElement('h1');
  h1.textContent = title;
  const p = document.createElement('p');
  p.textContent = text;
  box.replaceChildren(h1, p);
  box.hidden = false;
}

function docMeta(q) {
  return {
    number: q.number,
    createdAt: q.createdAt,
    validUntil: q.expiresAt,
    docHash: q.docHash,
    signOnline: q.status !== 'signed' && q.model.signable !== false && !q.expired,
    signature: q.status === 'signed'
      ? { name: q.signerName, signedAt: q.signedAt, png: q.signaturePng, hash: q.signatureHash, consent: q.consentText }
      : null,
  };
}

function render(q) {
  quote = q;
  const title = q.model.docTitle || 'הצעת מחיר';
  // Older quotes (before document types) were all signable.
  const signable = q.model.signable !== false;
  document.title = `${title} ${q.number} · astrateg`;
  $('cbar-title').textContent = title;
  $('doc').replaceChildren(renderQuoteDoc(q.model, docMeta(q)));
  $('doc').hidden = false;
  $('state').hidden = true;
  $('btn-print').hidden = false;
  const tot = q.model.totals;
  $('strip-month').textContent = formatILS(tot.monthlyGross);
  $('strip-sub').textContent = `${q.model.termMonths} חודשים · סה״כ ${formatILS(tot.termGross)} כולל מע״מ`;
  $('strip-go').hidden = !signable || q.status === 'signed' || q.expired;
  $('expired').hidden = !(q.expired && q.status !== 'signed');
  $('strip').hidden = false;
  if (q.consentText) $('consent-text').textContent = q.consentText;

  const status = $('status');
  status.hidden = false;
  if (q.status === 'signed') {
    status.textContent = 'נחתם';
    status.classList.add('is-signed');
    $('signbox').hidden = true;
    $('signed').hidden = false;
    $('signed-text').textContent = `נחתם על ידי ${q.signerName} ב־${formatDate(q.signedAt, true)}. אפשר להדפיס או לשמור עותק כ־PDF.`;
  } else if (q.expired) {
    status.textContent = 'פג תוקף';
    status.classList.add('is-expired');
    $('signbox').hidden = true;
    $('signed').hidden = true;
    $('expired-text').textContent = signable
      ? `המועד לחתימה על ההסכם הסתיים ב־${formatDate(q.expiresAt, true)}. כדי להתקשר, בקשו מאיש המכירות הסכם מעודכן.`
      : `תוקף ההצעה הסתיים ב־${formatDate(q.expiresAt, true)}. לקבלת הצעה מעודכנת פנו לאיש המכירות.`;
  } else if (!signable) {
    status.textContent = 'לעיון';
    $('signbox').hidden = true;
    $('signed').hidden = true;
  } else {
    status.textContent = 'ממתין לחתימה';
    $('signbox').hidden = false;
    $('signed').hidden = true;
  }
}

async function load() {
  if (!UUID.test(token)) {
    showState('הקישור אינו תקין', 'ייתכן שהקישור הועתק באופן חלקי. בקשו מאיש המכירות לשלוח אותו שוב.');
    return;
  }
  try {
    supa = await import('./supa.js');
    const { data, error } = await supa.supabase.rpc('get_quote', { p_token: token });
    if (error) throw error;
    if (!data) {
      showState('ההצעה לא נמצאה', 'ייתכן שההצעה בוטלה או שהקישור שגוי. פנו לאיש המכירות שלכם.');
      return;
    }
    render(data);
  } catch {
    showState('לא הצלחנו לטעון את ההצעה', 'בדקו את החיבור לאינטרנט ורעננו את העמוד.');
  }
}

/* ── Signature pad ─────────────────────────── */
const canvas = $('pad');
const wrap = $('pad-wrap');
const ctx = canvas.getContext('2d');
let strokes = [];
let current = null;
let typed = false;

function sizeCanvas() {
  const r = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(r.width * dpr);
  canvas.height = Math.round(r.height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  redraw();
}

function drawStroke(pts, c = ctx, w = canvas.getBoundingClientRect().width, hgt = canvas.getBoundingClientRect().height) {
  if (!pts.length) return;
  c.lineWidth = 2.4;
  c.lineCap = 'round';
  c.lineJoin = 'round';
  c.strokeStyle = '#031432';
  c.beginPath();
  c.moveTo(pts[0][0] * w, pts[0][1] * hgt);
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = ((pts[i][0] + pts[i + 1][0]) / 2) * w;
    const my = ((pts[i][1] + pts[i + 1][1]) / 2) * hgt;
    c.quadraticCurveTo(pts[i][0] * w, pts[i][1] * hgt, mx, my);
  }
  const last = pts[pts.length - 1];
  c.lineTo(last[0] * w + (pts.length === 1 ? 0.1 : 0), last[1] * hgt);
  c.stroke();
}

function redraw() {
  const r = canvas.getBoundingClientRect();
  ctx.clearRect(0, 0, r.width, r.height);
  if (typed) drawTyped(ctx, r.width, r.height);
  strokes.forEach((s) => drawStroke(s));
  wrap.classList.toggle('has-ink', hasInk());
}

function hasInk() {
  return typed || strokes.some((s) => s.length > 1);
}

function point(e) {
  const r = canvas.getBoundingClientRect();
  return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height];
}

canvas.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  canvas.setPointerCapture(e.pointerId);
  current = [point(e)];
  strokes.push(current);
  clearPadError();
});
canvas.addEventListener('pointermove', (e) => {
  if (!current) return;
  current.push(point(e));
  redraw();
});
const end = () => { current = null; redraw(); };
canvas.addEventListener('pointerup', end);
canvas.addEventListener('pointercancel', end);

$('pad-clear').addEventListener('click', () => { strokes = []; typed = false; redraw(); });

function drawTyped(c, w, hgt) {
  const name = $('s-name').value.trim();
  if (!name) return;
  c.save();
  c.fillStyle = '#031432';
  c.textAlign = 'center';
  c.textBaseline = 'alphabetic';
  let size = Math.round(hgt * 0.34);
  c.font = `italic 600 ${size}px 'Rubik', sans-serif`;
  while (c.measureText(name).width > w * 0.85 && size > 12) {
    size -= 2;
    c.font = `italic 600 ${size}px 'Rubik', sans-serif`;
  }
  c.direction = 'rtl';
  c.fillText(name, w / 2, hgt * 0.72);
  c.restore();
}

// Keyboard-friendly alternative: sign with the typed name.
const typedBtn = document.createElement('button');
typedBtn.type = 'button';
typedBtn.className = 'linkbtn';
typedBtn.textContent = 'חתימה עם השם המוקלד';
typedBtn.addEventListener('click', () => {
  if (!$('s-name').value.trim()) {
    setError('s-name', 's-name-err', true);
    $('s-name').focus();
    return;
  }
  strokes = [];
  typed = true;
  redraw();
  clearPadError();
});
$('pad-clear').before(typedBtn);
$('s-name').addEventListener('input', () => {
  setError('s-name', 's-name-err', false);
  if (typed) redraw();
});

function exportSignature() {
  const r = canvas.getBoundingClientRect();
  const w = 600;
  const hgt = Math.round((w * r.height) / r.width);
  const out = document.createElement('canvas');
  out.width = w;
  out.height = hgt;
  const c = out.getContext('2d');
  if (typed) drawTyped(c, w, hgt);
  strokes.forEach((s) => drawStroke(s, c, w, hgt));
  return out.toDataURL('image/png');
}

/* ── Signing ───────────────────────────────── */
function setError(fieldId, errId, on) {
  if (fieldId) $(fieldId).setAttribute('aria-invalid', String(on));
  $(errId).hidden = !on;
}
function clearPadError() {
  wrap.classList.remove('is-invalid');
  $('pad-err').hidden = true;
}
$('s-consent').addEventListener('change', () => setError(null, 's-consent-err', false));

$('sign-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = $('s-name').value.trim();
  const nameOk = name.length >= 2;
  const inkOk = hasInk();
  const consentOk = $('s-consent').checked;
  setError('s-name', 's-name-err', !nameOk);
  wrap.classList.toggle('is-invalid', !inkOk);
  $('pad-err').hidden = inkOk;
  setError(null, 's-consent-err', !consentOk);
  $('sign-err').hidden = true;
  if (!nameOk) return $('s-name').focus();
  if (!inkOk) return typedBtn.focus();
  if (!consentOk) return $('s-consent').focus();

  const btn = $('btn-sign');
  const label = btn.textContent;
  btn.disabled = true;
  const spin = document.createElement('span');
  spin.className = 'spin';
  btn.replaceChildren(spin, 'שומר את החתימה…');
  try {
    const { data, error } = await supa.supabase.rpc('sign_quote', {
      p_token: token, p_name: name, p_signature: exportSignature(), p_consent: true,
      // Decision 26: a separate, optional choice; never a condition of signing.
      p_whatsapp: $('s-whatsapp').checked,
    });
    if (error) throw error;
    render(data);
    $('signed').focus();
    $('signed').scrollIntoView({ block: 'center', behavior: 'smooth' });
  } catch (err) {
    const msg = String(err?.message || '');
    if (/staff cannot sign/.test(msg)) {
      $('sign-err').textContent = 'את ההצעה חותם הלקוח. אתם מחוברים כאנשי צוות, לכן החתימה נחסמה. פתחו את הקישור בדפדפן שבו אינכם מחוברים.';
      $('sign-err').hidden = false;
      return;
    }
    if (/expired/.test(msg)) {
      await load();
      return;
    }
    if (/already signed/.test(msg)) {
      await load();
      return;
    }
    $('sign-err').textContent = /not found/.test(msg)
      ? 'ההצעה כבר אינה זמינה לחתימה. פנו לאיש המכירות.'
      : 'החתימה לא נשמרה. בדקו את החיבור לאינטרנט ונסו שוב — הפרטים שמילאתם נשמרו בעמוד.';
    $('sign-err').hidden = false;
  } finally {
    btn.disabled = false;
    btn.textContent = label;
  }
});

$('btn-print').addEventListener('click', () => window.print());

// "מה זה?" under the WhatsApp checkbox: one line, opened on demand.
$('wa-what').addEventListener('click', () => {
  const open = $('wa-more').hidden;
  $('wa-more').hidden = !open;
  $('wa-what').setAttribute('aria-expanded', String(open));
});

new ResizeObserver(sizeCanvas).observe(wrap);
load();
