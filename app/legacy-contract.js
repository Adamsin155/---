// legacy-contract.html?id=<old id>: a signed document of the old system (astrateg-crm),
// read-only and printable (the owner's request of 25.10.2026). The office reads it
// (public.legacy_contracts: is_office); anyone else gets "not found or not yours". It is
// drawn in the look of the new system's printed agreement (app/styles/quote.css), with
// what the old record holds: the package, the money, the bullets and the custom clauses,
// the termination's details, and the signature block with the name, the time, the picture
// and the stamps. Every text goes in as text, never as markup; a picture only as a PNG
// (or a sketch's PNG/JPEG/GIF/WebP) drawn in the page.
import { supabase } from './supa.js';
import { h } from './quote-doc.js';
import {
  DOC_TITLES, typeOf, typeLabel, stampLine, longDayText, timeText, hashStamp, listOf, packageCounts,
  paymentFacts, termFacts, signersOf, historyLines, extraFacts, sketchesOf, statusOf, statusLabel, isSigned,
} from './legacy-contract-logic.js';
import { fullDoc } from './legacy-contract-full.js';

const $ = (id) => document.getElementById(id);
const id = new URLSearchParams(location.search).get('id') || '';

const PROVIDER = { name: 'אסטרטג טכנולוגיות בע״מ', companyId: '514729938', email: 'info@astrateg.com' };

function showState(title, words, link) {
  const st = $('state');
  st.replaceChildren(h('h1', {}, title), words ? h('p', {}, words) : null, link || null);
  st.hidden = false;
  $('doc').hidden = true;
}

const sectionHead = (title, aside) => h('div', { class: 'qd-sec-head' }, h('h2', {}, title), aside ? h('span', { class: 'qd-aside' }, aside) : null);
const factsList = (rows, cls = '') => h('dl', { class: `lc-facts ${cls}` }, rows.map(([k, v]) => h('div', {}, h('dt', {}, k), h('dd', {}, v))));
const section = (title, ...body) => h('section', { class: 'qd-section' }, sectionHead(title), ...body);

// The whole document as its client read it (the owner, 28.10.2026; app/legacy-contract-full.js).
// A text is a string, or strings and { b } (bold) one after the other.
const words = (t) => (Array.isArray(t) ? t.map((x) => (x && typeof x === 'object' ? h('b', {}, x.b) : x)) : t);
const withBreaks = (lines) => lines.flatMap((l, i) => (i ? [h('br'), ...[].concat(words(l))] : [].concat(words(l))));
function part(p) {
  switch (p.type) {
    case 'h3': return h('h3', { class: 'lc-h3' }, words(p.text));
    case 'h4': return h('h4', { class: 'lc-h4' }, words(p.text));
    case 'p': return h('p', { class: 'lc-p' }, p.lines ? withBreaks(p.lines) : words(p.text));
    case 'ul': return h('ul', { class: 'qd-checks' }, p.items.map((i) => h('li', { class: i.star ? 'lc-star' : null }, i.star ? '⭐ ' : null, words(i.text))));
    case 'kpis': return h('div', { class: 'qd-grid' }, p.items.map((x) => h('div', { class: 'qd-cell' }, h('div', { class: 'qd-cell-n num' }, x.n), h('div', { class: 'qd-cell-l' }, x.l))));
    case 'tiles': return h('div', { class: 'lc-tiles' }, p.items.map((x) => h('div', { class: 'lc-tile' }, h('b', { class: 'num' }, x.n), h('span', {}, x.l))));
    case 'addons': return h('div', { class: 'lc-addons' }, p.items.map((a) => h('div', { class: 'lc-addon' },
      h('div', {}, h('b', {}, a.name), a.detail ? h('i', {}, a.detail) : null),
      a.free ? h('span', { class: 'lc-free' }, 'ללא עלות') : h('div', { class: 'lc-amt' }, h('span', { class: 'num' }, a.amount), h('small', {}, a.note)))));
    case 'table': return h('div', { class: 'lc-table-wrap' }, h('table', { class: 'lc-table' },
      p.head ? h('thead', {}, h('tr', {}, p.head.map((c) => h('th', {}, c)))) : null,
      h('tbody', {}, p.rows.map((r) => h('tr', { class: r.cls || null }, r.cells.map((c, i) => h('td', { class: i ? 'num' : null }, c,
        !i && r.detail ? h('div', { class: 'lc-qd' }, r.detail) : null)))))));
    default: return null;
  }
}
function fullSections(model) {
  return model.sections.map((sec) => h('section', { class: `qd-section${sec.terms ? ' lc-terms' : ''}` },
    sec.title ? h('div', { class: 'qd-sec-head' }, h('h2', {}, words(sec.title))) : null,
    ...sec.parts.map(part)));
}

function bullets(title, list) {
  const items = listOf(list);
  if (!items.length) return null;
  return section(title, h('ul', { class: 'qd-checks' }, items.map((i) => h('li', {}, i.title ? h('b', {}, `${i.title}${i.text ? ': ' : ''}`) : null, i.text || ''))));
}

export function renderLegacyDoc(row) {
  const doc = row.doc || {};
  const type = typeOf(row.doc_type);
  const months = Number(doc.months) > 0 && !doc.noMonths ? `${doc.months} חודשים` : null;
  const valid = longDayText(doc.validUntil);
  // Not signed in the old system (27.10.2026): waiting for a signature, or a price offer.
  const status = statusOf(row.status);
  const signed = isSigned(row);

  const header = h('header', { class: 'qd-top' },
    h('div', { class: 'qd-titles' },
      h('span', { class: 'qd-type' }, signed ? typeLabel(type) : `${typeLabel(type)} · ${statusLabel(status)}`),
      h('h1', {}, status === 'quote' ? 'הצעת מחיר' : DOC_TITLES[type]),
      h('div', { class: 'qd-meta' },
        row.doc_number || doc.docNumber ? h('span', {}, 'מס׳ ', h('b', { class: 'num', dir: 'ltr' }, row.doc_number || String(doc.docNumber))) : null,
        longDayText(doc.createdAt) ? h('span', {}, longDayText(doc.createdAt)) : null,
        months ? h('span', {}, months) : null,
        valid ? h('span', {}, `לחתימה עד ${valid}`) : null,
      ),
    ),
    h('img', { class: 'qd-logo', src: 'app/assets/logo.png', alt: 'astrateg' }),
  );
  const stamp = h('p', { class: 'lc-stamp', id: 'lc-stamp' }, stampLine(row, doc));

  const parties = h('section', { class: 'qd-parties' },
    h('div', { class: 'qd-party' },
      h('div', { class: 'qd-label' }, 'מאת'),
      h('div', { class: 'qd-party-name' }, PROVIDER.name),
      h('div', {}, 'ח.פ ', h('span', { class: 'num', dir: 'ltr' }, PROVIDER.companyId)),
      h('div', { dir: 'ltr', class: 'qd-ltr' }, PROVIDER.email)),
    h('div', { class: 'qd-party' },
      h('div', { class: 'qd-label' }, 'לכבוד'),
      h('div', { class: 'qd-party-name qd-client' }, doc.clientName || row.signer_name || '—'),
      doc.business ? h('div', {}, doc.business) : null,
      // As the old document showed them (28.10.2026: everything is copied).
      doc.hp ? h('div', {}, 'ח.פ ', h('span', { class: 'num', dir: 'ltr' }, String(doc.hp))) : null,
      doc.phone ? h('div', {}, h('span', { class: 'num', dir: 'ltr' }, String(doc.phone))) : null),
  );

  const parent = doc.parentContractId !== undefined && doc.parentContractId !== null && /^\d+$/.test(String(doc.parentContractId))
    ? h('p', { class: 'lc-parent' }, type === 'termination' ? 'סיום ההתקשרות של ' : 'נספח ל', h('a', { href: `legacy-contract.html?id=${doc.parentContractId}` }, 'ההסכם המקורי'), '.')
    : null;

  // The package: its name, the counts, and the bullets (unless the document had no services).
  const counts = packageCounts(doc);
  const inf = typeof doc.influencers === 'string' && doc.influencers.trim() ? doc.influencers.trim() : null;
  const pkg = doc.packageName || counts.length || inf ? h('section', { class: 'qd-section' },
    sectionHead(doc.contentHeading || 'החבילה'),
    doc.packageName || inf ? h('div', { class: 'qd-pkg' }, h('div', {},
      doc.packageName ? h('div', { class: 'qd-pkg-name', dir: 'auto' }, doc.packageName) : null,
      inf ? h('div', { class: 'qd-pkg-inf' }, inf) : null)) : null,
    counts.length ? h('div', { class: 'qd-grid' }, counts.map(([n, label]) => h('div', { class: 'qd-cell' },
      h('div', { class: 'qd-cell-n num' }, String(n)), h('div', { class: 'qd-cell-l' }, label)))) : null,
  ) : null;
  const pkgBullets = doc.noServices ? null : bullets('מה כלול', [...listOf(doc.packageBullets), ...listOf(doc.detailBullets)]);
  const extraBullets = bullets('תוספות', doc.extraBullets);

  const pay = paymentFacts(doc, row);
  const money = pay.length || doc.paymentSummary ? section('תנאי תשלום',
    pay.length ? factsList(pay, 'lc-money') : null,
    typeof doc.paymentSummary === 'string' && doc.paymentSummary.trim() ? h('p', { class: 'qd-notes' }, doc.paymentSummary.trim()) : null,
    ...listOf(Array.isArray(doc.paymentSummary) ? doc.paymentSummary : []).map((i) => h('p', { class: 'qd-notes' }, [i.title, i.text].filter(Boolean).join(': '))),
  ) : null;

  const term = termFacts(doc.termination);
  const termination = term.length ? section('פרטי סיום ההתקשרות', factsList(term)) : null;

  const clauses = listOf(doc.customClauses);
  const custom = clauses.length ? section('סעיפים מיוחדים',
    h('ol', { class: 'lc-clauses' }, clauses.map((c) => h('li', {}, c.title ? h('h3', {}, c.title) : null, c.text ? h('p', {}, c.text) : null)))) : null;
  const special = typeof doc.specialRequest === 'string' && doc.specialRequest.trim() ? section('בקשה מיוחדת', h('p', { class: 'qd-notes' }, doc.specialRequest.trim())) : null;
  const notes = typeof doc.notes === 'string' && doc.notes.trim() ? section('הערות', h('p', { class: 'qd-notes' }, doc.notes.trim())) : null;
  const sk = sketchesOf(doc.sketches);
  const sketches = sk.pics.length || sk.words.length ? section('סקיצות',
    sk.words.length ? h('ul', { class: 'qd-checks' }, sk.words.map((w) => h('li', {}, w))) : null,
    sk.pics.length ? h('div', { class: 'lc-sketches' }, sk.pics.map((src, i) => h('img', { src, alt: `סקיצה ${i + 1}` }))) : null) : null;

  // The signatures: the client's (one or more signers) and the provider's.
  const signers = signersOf(doc, row);
  // A document that was not signed: no signature block, only that it was not signed.
  const signature = !signed ? h('section', { class: 'qd-section lc-unsigned', id: 'lc-unsigned' },
    sectionHead('חתימות הצדדים'),
    h('p', { class: 'qd-notes' }, status === 'quote' ? 'לא נחתם: הצעת מחיר מהמערכת הישנה.' : 'לא נחתם: המסמך חיכה לחתימת הלקוח במערכת הישנה ולא נחתם שם.'))
    : h('section', { class: 'qd-section qd-sign' },
    sectionHead('חתימות הצדדים'),
    h('div', { class: 'qd-sign-grid' },
      ...(signers.length ? signers : [{ name: null, png: null, at: null }]).map((s) => h('div', { class: `qd-sign-box${s.png ? ' is-signed' : ''}` },
        h('div', { class: 'qd-label' }, 'הלקוח'),
        h('div', { class: 'qd-strong' }, s.name || '—'),
        s.png ? h('img', { src: s.png, alt: `חתימה של ${s.name || 'הלקוח'}` }) : h('p', { class: 'qd-muted' }, 'אין תמונת חתימה במסמך.'),
        s.id ? h('div', { class: 'qd-muted' }, `${s.idLabel}: `, h('span', { class: 'num', dir: 'ltr' }, s.id)) : null,
        s.at ? h('div', { class: 'qd-muted' }, `נחתם ב־${s.at}`) : null,
        s.ip ? h('div', { class: 'qd-muted' }, 'IP ', h('span', { class: 'num', dir: 'ltr' }, s.ip)) : null,
        s.ua ? h('div', { class: 'qd-muted lc-ua', dir: 'ltr' }, s.ua) : null)),
      h('div', { class: 'qd-sign-box' },
        h('div', { class: 'qd-label' }, 'הספק'),
        h('div', { class: 'qd-strong' }, PROVIDER.name),
        h('div', { class: 'qd-muted' }, 'ח.פ ', h('span', { class: 'num', dir: 'ltr' }, PROVIDER.companyId))),
    ),
    typeof doc.consentText === 'string' && doc.consentText.trim() ? h('p', { class: 'qd-consent' }, `החותם אישר: ״${doc.consentText.trim()}״`) : null,
  );

  const history = historyLines(doc.signHistory);
  const extras = extraFacts(doc);
  const more = history.length || extras.length ? h('details', { class: 'lc-more' },
    h('summary', {}, 'תיעוד החתימה ושדות נוספים'),
    history.length ? h('div', {}, h('h3', {}, 'היסטוריית החתימה'), h('ol', { class: 'lc-history' }, history.map((l) => h('li', {}, l)))) : null,
    extras.length ? h('div', {}, h('h3', {}, 'שדות נוספים מהמערכת הישנה'), factsList(extras)) : null,
  ) : null;

  const docStamp = hashStamp(doc.docHash);
  const sigStamp = signed ? hashStamp(doc.signatureHash) : null;
  const foot = h('footer', { class: 'qd-foot' },
    h('span', {}, `${PROVIDER.name} · מסמך מהמערכת הישנה, לקריאה בלבד`),
    h('span', { class: 'qd-hashes' },
      docStamp ? h('span', { class: 'num', dir: 'ltr', title: 'טביעת המסמך (SHA-256)' }, `DOC ${docStamp}`) : null,
      sigStamp ? h('span', { class: 'num', dir: 'ltr', title: 'טביעת החתימה (SHA-256)' }, `SIG ${sigStamp}`) : null),
  );

  // The whole text as the old system showed it; the summary above only when it cannot be built.
  const model = fullDoc(doc);
  const pkgLine = model?.kind === 'contract' && (doc.packageName || inf) && !doc.noServices
    ? h('p', { class: 'lc-pkgline' }, doc.packageName ? h('b', {}, doc.packageName) : null, doc.packageName && inf ? ' · ' : null, inf || null) : null;
  const body = model ? [pkgLine, ...fullSections(model), termination] : [pkg, pkgBullets, extraBullets, money, termination, custom, notes];
  if (model) header.querySelector('h1').textContent = status === 'quote' ? 'הצעת מחיר' : model.title;
  // What the record holds and the document's text does not say (the payment method of a contract
  // with its own clauses, the termination's details): after the signatures, nothing lost.
  const kept = model ? pay : [];
  const record = kept.length || (model && typeof doc.paymentSummary === 'string' && doc.paymentSummary.trim())
    ? h('section', { class: 'qd-section lc-record', id: 'lc-record' }, sectionHead('פרטים מהרשומה במערכת הישנה'),
      kept.length ? factsList(kept, 'lc-money') : null,
      typeof doc.paymentSummary === 'string' && doc.paymentSummary.trim() ? h('p', { class: 'qd-notes' }, doc.paymentSummary.trim()) : null)
    : null;
  return h('article', { class: `qd qd--agreement lc-doc lc-${type}`, dir: 'rtl', lang: 'he', id: 'lc-doc' },
    header, stamp, parties, parent, ...body, special, sketches, signature, record, more, foot);
}

async function main() {
  if (!/^\d{1,15}$/.test(id)) { showState('לא נבחר מסמך.', 'פתחו את המסמך מכרטיס הלקוח.', h('a', { class: 'cbtn cbtn-primary', href: 'clients.html#clients' }, 'לרשימת הלקוחות')); return; }
  const session = (await supabase.auth.getSession()).data?.session;
  if (!session) { showState('צריך להתחבר.', 'המסמכים מהמערכת הישנה פתוחים למשרד בלבד. התחברו, וחזרו לכאן מכרטיס הלקוח.', h('a', { class: 'cbtn cbtn-primary', href: 'clients.html#clients' }, 'כניסה למערכת')); return; }
  const { data: row, error } = await supabase.from('legacy_contracts').select('*').eq('id', id).maybeSingle();
  if (error || !row) { showState('המסמך לא נמצא.', 'ייתכן שהקישור שגוי, או שאין לך הרשאה: המסמכים מהמערכת הישנה פתוחים למשרד בלבד.', h('a', { class: 'cbtn cbtn-primary', href: 'clients.html#clients' }, 'לרשימת הלקוחות')); return; }
  const name = row.doc?.clientName || '';
  document.title = `${typeLabel(row.doc_type)}${row.doc_number ? ` ${row.doc_number}` : ''}${name ? ` · ${name}` : ''} · astrateg`;
  $('lc-back').href = `client.html?id=${encodeURIComponent(row.client_id)}`;
  const kind = $('lc-kind');
  const signed = isSigned(row);
  kind.textContent = !signed ? statusLabel(row.status) : row.signed_at ? `נחתם ${longDayText(row.signed_at)}` : typeLabel(row.doc_type);
  kind.classList.toggle('is-signed', signed && !!row.signed_at);
  kind.hidden = false;
  kind.title = timeText(row.signed_at) || '';
  $('doc').replaceChildren(renderLegacyDoc(row));
  $('doc').hidden = false;
  $('state').hidden = true;
  const print = $('btn-print');
  print.hidden = false;
  print.addEventListener('click', () => window.print());
  // On paper the signing record is printed open.
  window.addEventListener('beforeprint', () => { const more = document.querySelector('.lc-more'); if (more) more.open = true; });
}

main().catch(() => showState('לא הצלחנו לטעון את המסמך.', 'בדקו את החיבור ורעננו את הדף.'));
