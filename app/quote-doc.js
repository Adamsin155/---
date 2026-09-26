// Renders the client-facing quote document from a quote model.
// All user-provided text goes through text nodes, never innerHTML.

import { formatILS, termsText } from './pricing.js';

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === false || v === null || v === undefined) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
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

const money = (agorot) => h('span', { class: 'num', dir: 'ltr' }, formatILS(agorot));

// meta: { number, createdAt, docHash, logoSrc, signature: { name, signedAt, png } }
export function renderQuoteDoc(model, meta = {}) {
  const t = model.totals;
  const c = model.client;
  const number = meta.number || model.number;

  const header = h('header', { class: 'qd-head' },
    h('img', { class: 'qd-logo', src: meta.logoSrc || 'app/assets/logo.png', alt: 'astrateg' }),
    h('dl', { class: 'qd-meta' },
      h('div', {}, h('dt', {}, 'הצעת מחיר'), h('dd', { class: 'num', dir: 'ltr' }, number || 'טיוטה')),
      h('div', {}, h('dt', {}, 'תאריך'), h('dd', {}, formatDate(meta.createdAt || model.createdAt))),
      h('div', {}, h('dt', {}, 'תקופה'), h('dd', {}, `${model.termMonths} חודשים`)),
    ),
  );

  const clientLines = [
    c.company && h('div', {}, c.company),
    c.phone && h('div', { class: 'num', dir: 'ltr' }, c.phone),
    c.email && h('div', { dir: 'ltr' }, c.email),
  ];
  const to = h('section', { class: 'qd-to' },
    h('div', { class: 'qd-label' }, 'לכבוד'),
    h('div', { class: 'qd-client' }, c.name || '—'),
    ...clientLines,
  );

  const pkg = model.package;
  const includes = h('table', { class: 'qd-table qd-includes' },
    h('caption', {}, 'מה כלול בחבילה · כמויות לשנה'),
    h('thead', {}, h('tr', {}, h('th', { scope: 'col', class: 'qty' }, 'כמות'), h('th', { scope: 'col' }, 'פריט'))),
    h('tbody', {}, pkg.includes.map((i) => h('tr', {},
      h('td', { class: 'qty num' }, i.qty === null ? '✓' : String(i.qty)),
      h('td', {}, i.label),
    ))),
  );

  const pkgSection = h('section', { class: 'qd-section' },
    h('h2', {}, 'החבילה'),
    h('div', { class: 'qd-pkg' },
      h('div', {},
        h('div', { class: 'qd-pkg-name', dir: 'auto' }, pkg.tierName),
        h('div', { class: 'qd-pkg-inf' }, pkg.influencer),
      ),
      h('div', { class: 'qd-pkg-price' }, money(pkg.monthly), h('small', {}, 'לחודש · לפני מע״מ')),
    ),
    includes,
  );

  const paidSection = model.paid.length ? h('section', { class: 'qd-section' },
    h('h2', {}, 'תוספות בתשלום'),
    h('table', { class: 'qd-table' },
      h('thead', {}, h('tr', {},
        h('th', { scope: 'col' }, 'תוספת'),
        h('th', { scope: 'col', class: 'amt' }, 'לחודש'),
        h('th', { scope: 'col', class: 'amt' }, `ל־${model.termMonths} חודשים`),
      )),
      h('tbody', {}, model.paid.map((p) => h('tr', {},
        h('td', {}, h('div', { class: 'qd-strong' }, p.name), h('div', { class: 'qd-muted' }, p.detail)),
        h('td', { class: 'amt' }, money(p.monthly)),
        h('td', { class: 'amt' }, money(p.term)),
      ))),
    ),
    h('p', { class: 'qd-note' }, 'המחירים לפני מע״מ.'),
  ) : null;

  const freeSection = model.free.length ? h('section', { class: 'qd-section' },
    h('h2', {}, 'הטבות ללא עלות'),
    h('ul', { class: 'qd-free' }, model.free.map((f) => h('li', {},
      h('span', {},
        f.qty ? h('span', { class: 'num qd-qty' }, String(f.qty)) : null,
        h('span', { class: 'qd-strong' }, f.name),
        f.detail ? h('span', { class: 'qd-muted' }, ` · ${f.detail}`) : null,
      ),
      h('span', { class: 'qd-tag' }, 'ללא עלות'),
    ))),
  ) : null;

  const row = (label, value, cls = '') => h('tr', { class: cls },
    h('th', { scope: 'row' }, label), h('td', { class: 'amt' }, money(value)));

  const pricing = h('section', { class: 'qd-section qd-pricing' },
    h('h2', {}, 'סיכום מחיר'),
    h('div', { class: 'qd-price-grid' },
      h('table', { class: 'qd-table qd-sum' },
        h('caption', {}, 'תשלום חודשי'),
        h('tbody', {},
          row('חבילה', pkg.monthly),
          model.paid.map((p) => row(p.name, p.monthly)),
          row('סה״כ לחודש לפני מע״מ', t.monthlyNet, 'sub'),
          row(`מע״מ ${model.vatRate}%`, t.monthlyVat),
          row('סה״כ לחודש כולל מע״מ', t.monthlyGross, 'total'),
        ),
      ),
      h('table', { class: 'qd-table qd-sum' },
        h('caption', {}, `סה״כ ל־${model.termMonths} חודשים`),
        h('tbody', {},
          row('לפני מע״מ', t.termNet),
          row(`מע״מ ${model.vatRate}%`, t.termVat),
          row('כולל מע״מ', t.termGross, 'total'),
        ),
      ),
    ),
    h('p', { class: 'qd-terms' }, model.terms || termsText(model.selection)),
  );

  const notes = c.notes ? h('section', { class: 'qd-section' },
    h('h2', {}, 'הערות'),
    h('p', { class: 'qd-notes' }, c.notes),
  ) : null;

  const sig = meta.signature;
  const signature = h('section', { class: 'qd-section qd-sign' + (sig ? ' is-signed' : '') },
    h('h2', {}, 'אישור הלקוח'),
    sig
      ? h('div', { class: 'qd-sign-grid' },
        h('div', {}, h('div', { class: 'qd-label' }, 'שם החותם/ת'), h('div', { class: 'qd-strong' }, sig.name)),
        h('div', {}, h('div', { class: 'qd-label' }, 'נחתם בתאריך'), h('div', {}, formatDate(sig.signedAt, true))),
        h('div', { class: 'qd-sign-img' }, h('div', { class: 'qd-label' }, 'חתימה'), h('img', { src: sig.png, alt: `חתימה של ${sig.name}` })),
      )
      : meta.signOnline
        ? h('p', { class: 'qd-note' }, 'החתימה מתבצעת אונליין, בטופס שבהמשך העמוד.')
        : h('div', { class: 'qd-sign-grid' },
        h('div', {}, h('div', { class: 'qd-label' }, 'שם'), h('div', { class: 'qd-line' })),
        h('div', {}, h('div', { class: 'qd-label' }, 'תאריך'), h('div', { class: 'qd-line' })),
        h('div', {}, h('div', { class: 'qd-label' }, 'חתימה'), h('div', { class: 'qd-line' })),
      ),
  );

  const foot = h('footer', { class: 'qd-foot' },
    h('span', {}, 'astrateg · ONE STEP AHEAD'),
    meta.docHash ? h('span', { class: 'num', dir: 'ltr', title: 'טביעת המסמך (SHA-256)' }, `DOC ${meta.docHash.slice(0, 16)}`) : null,
    meta.signature?.hash ? h('span', { class: 'num', dir: 'ltr', title: 'טביעת החתימה (SHA-256)' }, `SIG ${meta.signature.hash.slice(0, 16)}`) : null,
  );

  return h('article', { class: 'qd', dir: 'rtl', lang: 'he' },
    header, to, pkgSection, paidSection, freeSection, pricing, notes, signature, foot);
}
