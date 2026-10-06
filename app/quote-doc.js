// Renders the client-facing quote document from a quote model.
// All user-provided text goes through text nodes, never innerHTML.

import { formatILS, termsText } from './pricing.js';

// An address that may go into an attribute the browser follows or loads. A stored
// value (a client's link, a notification's page) must never run as script: anything
// with a scheme outside this list (javascript:, vbscript:, data: in a link…) is left
// out, and the element is built without the attribute. A relative address has no
// scheme and passes. Browsers ignore control characters and spaces inside a scheme
// ("java\tscript:"), so they are taken out before looking.
const URL_ATTRS = new Set(['href', 'src', 'action', 'formaction', 'poster', 'xlink:href']);
const URL_SCHEMES = new Set(['http', 'https', 'mailto', 'tel', 'sms', 'blob', 'webcal', 'whatsapp']);
export function safeUrlAttr(name, value) {
  const s = String(value ?? '').replace(/[\u0000-\u0020\u007f-\u009f\u200b-\u200f\u2028\u2029\ufeff]+/g, '');
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(s)?.[1].toLowerCase();
  if (!scheme || URL_SCHEMES.has(scheme)) return true;
  // A picture or a video made in the page itself (the signature, a preview).
  return scheme === 'data' && (name === 'src' || name === 'poster') && /^data:(image\/(png|jpeg|gif|webp)|video\/(mp4|webm))[;,]/i.test(s);
}

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === false || v === null || v === undefined) continue;
    if (URL_ATTRS.has(k) && !safeUrlAttr(k, v)) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

const dateFmt = new Intl.DateTimeFormat('he-IL', { day: 'numeric', month: 'long', year: 'numeric' });
const dateTimeFmt = new Intl.DateTimeFormat('he-IL', {
  day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
});

export function formatDate(value, withTime = false) {
  const d = value ? new Date(value) : new Date();
  return (withTime ? dateTimeFmt : dateFmt).format(d);
}

// WhatsApp link, straight to the client's chat when the phone number is usable.
export function whatsappLink(phone, text) {
  let d = String(phone || '').replace(/\D/g, '');
  if (d.startsWith('0')) d = `972${d.slice(1)}`;
  const to = d.length >= 11 && d.length <= 15 ? d : '';
  return `https://wa.me/${to}?text=${encodeURIComponent(text)}`;
}

const money = (agorot) => h('span', { class: 'num', dir: 'ltr' }, formatILS(agorot));

// Provider details for documents saved before they were stored in the model.
const PROVIDER_FALLBACK = {
  name: 'אסטרטג טכנולוגיות בע״מ', companyId: '514729938',
  addresses: ['הבונים 5, רמת גן', 'האורזים 23, נתניה'], email: 'info@astrateg.com',
};

function party(label, lines) {
  return h('div', { class: 'qd-party' },
    h('div', { class: 'qd-label' }, label),
    lines.filter(Boolean),
  );
}

function sectionHead(title, aside) {
  return h('div', { class: 'qd-sec-head' }, h('h2', {}, title), aside ? h('span', { class: 'qd-aside' }, aside) : null);
}

// meta: { number, createdAt, validUntil, docHash, logoSrc, signOnline,
//         signature: { name, signedAt, png, hash, consent } }
export function renderQuoteDoc(model, meta = {}) {
  const t = model.totals;
  const c = model.client;
  const pkg = model.package;
  const number = meta.number || model.number;
  const createdAt = meta.createdAt || model.createdAt;
  const title = model.docTitle || 'הצעת מחיר';
  const isAgreement = model.docType === 'agreement';
  const provider = model.provider || PROVIDER_FALLBACK;
  const validUntil = meta.validUntil || model.validUntil;
  const validity = validUntil
    ? `${isAgreement ? 'לחתימה עד' : 'בתוקף עד'} ${formatDate(validUntil, true)}`
    : model.validHours ? `${isAgreement ? 'לחתימה בתוך' : 'בתוקף'} ${model.validHours} שעות מההפקה` : null;

  const header = h('header', { class: 'qd-top' },
    h('div', { class: 'qd-titles' },
      h('span', { class: 'qd-type' }, isAgreement ? 'מסמך לחתימה' : 'לעיון'),
      h('h1', {}, title),
      h('div', { class: 'qd-meta' },
        h('span', {}, 'מס׳ ', h('b', { class: 'num', dir: 'ltr' }, number || 'טיוטה')),
        h('span', {}, formatDate(createdAt)),
        h('span', {}, `${model.termMonths} חודשים`),
        validity ? h('span', { class: 'qd-valid' }, validity) : null,
      ),
    ),
    h('img', { class: 'qd-logo', src: meta.logoSrc || 'app/assets/logo.png', alt: 'astrateg' }),
  );

  const parties = h('section', { class: 'qd-parties' },
    party('מאת', [
      h('div', { class: 'qd-party-name' }, provider.name),
      h('div', {}, 'ח.פ ', h('span', { class: 'num', dir: 'ltr' }, provider.companyId)),
      h('div', {}, provider.addresses.join(' · ')),
      h('div', { dir: 'ltr', class: 'qd-ltr' }, provider.email),
    ]),
    party('לכבוד', [
      h('div', { class: 'qd-party-name qd-client' }, c.name || '—'),
      c.company ? h('div', {}, c.company) : null,
      c.companyId ? h('div', {}, 'ח.פ ', h('span', { class: 'num', dir: 'ltr' }, c.companyId)) : null,
      c.phone ? h('div', { dir: 'ltr', class: 'qd-ltr num' }, c.phone) : null,
      c.email ? h('div', { dir: 'ltr', class: 'qd-ltr' }, c.email) : null,
    ]),
  );

  const stat = (label, value, sub, cls = '') => h('div', { class: `qd-stat ${cls}` },
    h('div', { class: 'qd-stat-label' }, label), h('div', { class: 'qd-stat-value' }, money(value)),
    sub ? h('div', { class: 'qd-stat-sub' }, sub) : null);
  const hero = h('section', { class: 'qd-hero' },
    stat('לחודש', t.monthlyNet, '+ מע״מ', 'is-main'),
    stat('לחודש כולל מע״מ', t.monthlyGross, `מע״מ ${model.vatRate}%`),
    stat(`סה״כ ל־${model.termMonths} חודשים`, t.termGross, 'כולל מע״מ'),
  );

  const counted = pkg.includes.filter((i) => i.qty !== null);
  const services = pkg.includes.filter((i) => i.qty === null);
  const pkgSection = h('section', { class: 'qd-section' },
    sectionHead('החבילה', model.termMonths === 12 ? 'כמויות לשנה' : 'כמויות לכל התקופה'),
    h('div', { class: 'qd-pkg' },
      h('div', {},
        h('div', { class: 'qd-pkg-name', dir: 'auto' }, pkg.tierName),
        h('div', { class: 'qd-pkg-inf' }, pkg.influencer),
      ),
      h('div', { class: 'qd-pkg-price' }, money(pkg.monthly), h('small', {}, 'לחודש · לפני מע״מ')),
    ),
    h('div', { class: 'qd-grid' }, counted.map((i) => h('div', { class: 'qd-cell' },
      h('div', { class: 'qd-cell-n num' }, String(i.qty)),
      h('div', { class: 'qd-cell-l' }, i.label),
    ))),
    services.length ? h('ul', { class: 'qd-checks' }, services.map((i) => h('li', {}, i.label))) : null,
  );

  const paidSection = model.paid.length ? h('section', { class: 'qd-section' },
    sectionHead('תוספות בתשלום', 'לפני מע״מ'),
    h('div', { class: 'qd-rows' }, model.paid.map((p) => h('div', { class: 'qd-row' },
      h('div', {}, h('div', { class: 'qd-strong' }, p.name), h('div', { class: 'qd-muted' }, p.detail)),
      h('div', { class: 'qd-row-price' }, money(p.monthly), h('small', {}, 'לחודש')),
    ))),
  ) : null;

  const freeSection = model.free.length ? h('section', { class: 'qd-section' },
    sectionHead('הטבות ללא עלות'),
    h('div', { class: 'qd-rows' }, model.free.map((f) => h('div', { class: 'qd-row' },
      h('div', {},
        h('div', { class: 'qd-strong' }, f.qty ? `${f.name} · ${f.qty}` : f.name),
        f.detail ? h('div', { class: 'qd-muted' }, f.detail) : null,
      ),
      h('span', { class: 'qd-tag' }, 'ללא עלות'),
    ))),
  ) : null;

  const priceRow = (label, m, cls = '') => h('tr', { class: cls },
    h('th', { scope: 'row' }, label),
    h('td', { class: 'amt' }, money(m)),
    h('td', { class: 'amt' }, money(m * model.termMonths)),
  );
  const pricing = h('section', { class: 'qd-section qd-pricing' },
    sectionHead('פירוט מחיר'),
    h('table', { class: 'qd-table' },
      h('thead', {}, h('tr', {},
        h('th', { scope: 'col' }, 'פריט'),
        h('th', { scope: 'col', class: 'amt' }, 'לחודש'),
        h('th', { scope: 'col', class: 'amt' }, `ל־${model.termMonths} חודשים`),
      )),
      h('tbody', {},
        priceRow(`חבילה · ${pkg.tierName}`, pkg.monthly),
        model.paid.map((p) => priceRow(p.name, p.monthly)),
        // A contract changed by hand: the added lines that carry a price.
        (model.extraLines || []).filter((l) => l.monthly).map((l) => priceRow(l.label, l.monthly)),
        t.discount ? h('tr', { class: 'discount' },
          h('th', { scope: 'row' }, 'הנחה'),
          h('td', { class: 'amt' }, h('span', { class: 'num', dir: 'ltr' }, `−${formatILS(t.discount)}`)),
          h('td', { class: 'amt' }, h('span', { class: 'num', dir: 'ltr' }, `−${formatILS(t.discount * model.termMonths)}`)),
        ) : null,
        priceRow('סה״כ לפני מע״מ', t.monthlyNet, 'sub'),
        priceRow(`מע״מ ${model.vatRate}%`, t.monthlyVat),
        priceRow('סה״כ כולל מע״מ', t.monthlyGross, 'total'),
      ),
    ),
    h('p', { class: 'qd-terms' }, model.terms || termsText(model.selection)),
    isAgreement ? null : h('p', { class: 'qd-disclaimer' },
      'מסמך זה הוא הצעת מחיר לעיון בלבד, ואינו הצעה לכריתת חוזה. ההתקשרות תיכנס לתוקף רק בחתימה על הסכם ההתקשרות של אסטרטג. '
      + `ההצעה בתוקף ${model.validHours || 48} שעות ממועד הפקתה, וזמינות המשפיענים כפופה לאישור במועד החתימה.`),
  );

  const notes = c.notes ? h('section', { class: 'qd-section' },
    sectionHead('הערות'),
    h('p', { class: 'qd-notes' }, c.notes),
  ) : null;

  // Special terms of a contract changed by hand. In an agreement they are its last chapter.
  const special = !isAgreement && model.specialTerms ? h('section', { class: 'qd-section' },
    sectionHead('תנאים מיוחדים'),
    h('p', { class: 'qd-notes' }, model.specialTerms),
  ) : null;

  const legal = isAgreement && model.legal ? h('section', { class: 'qd-section qd-legal' },
    sectionHead('תנאי ההסכם'),
    h('ol', { class: 'qd-clauses' }, model.legal.map((sec, i) => h('li', {},
      h('h3', {}, h('span', { class: 'num qd-cl-h' }, `${i + 1}.`), sec.title),
      h('ol', {}, sec.items.map((item, j) => h('li', {},
        h('span', { class: 'qd-cl-n num' }, `${i + 1}.${j + 1}`), h('span', {}, item),
      ))),
    ))),
  ) : null;

  const sig = meta.signature;
  const clientSign = sig
    ? h('div', { class: 'qd-sign-box is-signed' },
      h('div', { class: 'qd-label' }, 'הלקוח'),
      h('div', { class: 'qd-strong' }, sig.name),
      h('img', { src: sig.png, alt: `חתימה של ${sig.name}` }),
      h('div', { class: 'qd-muted' }, `נחתם ב־${formatDate(sig.signedAt, true)}`),
      sig.consent ? h('p', { class: 'qd-consent' }, `החותם אישר: ״${sig.consent}״`) : null,
    )
    : h('div', { class: 'qd-sign-box' },
      h('div', { class: 'qd-label' }, 'הלקוח'),
      meta.signOnline
        ? h('p', { class: 'qd-muted' }, 'החתימה מתבצעת אונליין, בטופס שבהמשך העמוד.')
        : [h('div', { class: 'qd-line' }), h('div', { class: 'qd-muted' }, 'שם, חתימה ותאריך')],
    );
  const signature = isAgreement ? h('section', { class: 'qd-section qd-sign' },
    sectionHead('חתימות הצדדים'),
    h('div', { class: 'qd-sign-grid' },
      clientSign,
      h('div', { class: 'qd-sign-box' },
        h('div', { class: 'qd-label' }, 'הספק'),
        h('div', { class: 'qd-strong' }, provider.name),
        h('div', { class: 'qd-muted' }, 'ח.פ ', h('span', { class: 'num', dir: 'ltr' }, provider.companyId)),
      ),
    ),
  ) : null;

  const foot = h('footer', { class: 'qd-foot' },
    h('span', {}, `${provider.name} · ${provider.email}`),
    h('span', { class: 'qd-hashes' },
      meta.docHash ? h('span', { class: 'num', dir: 'ltr', title: 'טביעת המסמך (SHA-256)' }, `DOC ${meta.docHash.slice(0, 12)}`) : null,
      meta.signature?.hash ? h('span', { class: 'num', dir: 'ltr', title: 'טביעת החתימה (SHA-256)' }, `SIG ${meta.signature.hash.slice(0, 12)}`) : null,
    ),
  );

  return h('article', { class: `qd qd--${isAgreement ? 'agreement' : 'quote'}`, dir: 'rtl', lang: 'he' },
    header, parties, hero, pkgSection, paidSection, freeSection, pricing, special, notes, legal, signature, foot);
}
