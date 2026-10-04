import {
  INFLUENCERS, TIERS, PACKAGES, PAID_ADDONS, FREE_ADDONS, SPEC_ROWS, SPECS,
  VAT_RATE_PERCENT, TERM_MONTHS, DOC_TYPES, MAX_DISCOUNT, packageId,
} from './catalog.js';
import {
  emptySelection, reconcile, computeTotals, buildQuoteModel, formatILS,
  paidAddonAvailable, freeAddonAvailable,
} from './pricing.js';
import { h, renderQuoteDoc, whatsappLink } from './quote-doc.js';

const $ = (id) => document.getElementById(id);
let state = emptySelection();
// Opened from a deal of the field (index.html?deal=<id>, 3.10.2026): its id, so the
// quote created here is linked to it (the deal becomes "חוזה נשלח", and "נחתם" when
// the client signs).
const DEAL_PARAM = new URLSearchParams(location.search).get('deal');
let dealId = null;

// Supabase loads lazily so the builder still works if the network is down.
let supa = null;
async function getSupa() {
  if (!supa) supa = await import('./supa.js');
  return supa;
}

/* ── Rendering ─────────────────────────────── */

const MONOGRAM = { natali: 'נד', simeon: 'סמד' };
const TIER_INDEX = { podcast: 'P', social: 'S', 'social-tv': 'S+TV' };
// Largest value of each comparison row across all packages, for the meters.
const SPEC_MAX = Object.fromEntries(SPEC_ROWS.map((r) => [r.key, Math.max(...Object.values(SPECS).map((s) => s[r.key]))]));

function renderInfluencers() {
  const box = $('influencers');
  box.replaceChildren(...Object.values(INFLUENCERS).map((inf) => {
    const id = `inf-${inf.id}`;
    const on = state.influencer === inf.id;
    return h('div', { class: 'inf' },
      h('input', {
        type: 'radio', name: 'influencer', id, value: inf.id, checked: on,
        onchange: () => update({ influencer: inf.id }, { focus: id }),
      }),
      h('label', { for: id },
        h('span', { class: 'mono', 'aria-hidden': 'true' }, MONOGRAM[inf.id]),
        h('span', { class: 'inf-text' },
          h('span', { class: 'inf-name' }, inf.name),
          h('span', { class: 'inf-sub' }, '3 חבילות זמינות'),
        ),
        h('span', { class: 'radio-dot', 'aria-hidden': 'true' }),
      ),
    );
  }));
}

function specRow(r, v) {
  const pct = SPEC_MAX[r.key] ? Math.round((v / SPEC_MAX[r.key]) * 100) : 0;
  return h('li', { class: v ? '' : 'is-none' },
    h('span', { class: 'k' }, r.label),
    h('span', { class: 'meter', 'aria-hidden': 'true' }, h('span', { style: `inline-size:${pct}%` })),
    v ? h('span', { class: 'v' }, String(v)) : h('span', { class: 'v', 'aria-label': 'לא כלול' }, '—'),
  );
}

function renderTiers() {
  const box = $('tiers');
  box.replaceChildren(...TIERS.map((tier) => {
    const pid = packageId(tier.id, state.influencer);
    const pkg = PACKAGES[pid];
    const specs = SPECS[pid];
    const id = `tier-${tier.id}`;
    return h('div', { class: 'tier' },
      h('input', {
        type: 'radio', name: 'tier', id, value: tier.id, checked: state.tier === tier.id,
        onchange: () => update({ tier: tier.id }, { focus: id }),
      }),
      h('label', { for: id },
        h('div', { class: 'tier-top' },
          h('div', { class: 'tier-row' },
            h('span', { class: 'tier-code', dir: 'ltr', 'aria-hidden': 'true' }, TIER_INDEX[tier.id]),
            h('span', { class: 'tier-name', dir: 'ltr' }, tier.short),
            h('span', { class: 'radio-dot', 'aria-hidden': 'true' }),
          ),
          h('div', { class: 'tier-price' },
            h('span', { class: 'amount', dir: 'ltr' }, formatILS(pkg.price)),
            h('span', { class: 'per' }, 'לחודש · לפני מע״מ'),
          ),
          h('div', { class: 'tier-term', dir: 'rtl' }, h('span', { dir: 'ltr' }, formatILS(pkg.price * TERM_MONTHS)), ' ל־12 חודשים'),
        ),
        h('ul', { class: 'specs' }, SPEC_ROWS.map((r) => specRow(r, specs[r.key]))),
      ),
    );
  }));
}

function renderIncluded() {
  const pid = packageId(state.tier, state.influencer);
  const pkg = PACKAGES[pid];
  const tier = TIERS.find((t) => t.id === state.tier);
  $('included').replaceChildren(
    h('div', { class: 'included-head' },
      h('span', { class: 'included-title' }, 'מה כלול ב־', h('bdi', {}, tier.short), ` · ${INFLUENCERS[state.influencer].name}`),
      h('span', { class: 'tag' }, 'כמויות לשנה'),
    ),
    h('ul', {}, pkg.includes.map((i) => h('li', {},
      h('span', { class: 'inc-qty' + (i.qty === null ? ' is-check' : '') }, i.qty === null ? '✓' : String(i.qty)),
      h('span', {}, i.label),
    ))),
  );
}

function priceBlock(monthly, sign = '+') {
  return h('span', { class: 'tile-price' },
    h('span', { class: 'm', dir: 'ltr' }, `${sign}${formatILS(monthly)}`),
    h('span', { class: 'per' }, 'לחודש'),
    h('span', { class: 'y' }, h('bdi', {}, formatILS(monthly * TERM_MONTHS)), ' ל־12 ח׳'),
  );
}

function renderPaid() {
  const available = PAID_ADDONS.filter((a) => paidAddonAvailable(a, state));
  $('paid').replaceChildren(...available.map((a) => {
    const on = state.paid.includes(a.id);
    const id = `paid-${a.id}`;
    return h('label', { class: 'tile' + (on ? ' is-on' : ''), for: id },
      h('span', { class: 'tile-head' },
        h('span', { class: 'tile-title' }, a.name),
        h('input', {
          type: 'checkbox', class: 'cbox', id, checked: on,
          onchange: (e) => togglePaid(a.id, e.target.checked),
        }),
      ),
      h('span', { class: 'tile-detail' }, a.detail),
      h('span', { class: 'tile-foot' }, priceBlock(a.price),
        a.monthlyOutput ? h('span', { class: 'tag tag-warn' }, 'תפוקה חודשית') : null),
    );
  }));
}

function stepper(key, def) {
  const value = state.free[key];
  const id = `free-${key}`;
  const set = (n, focus = id) => {
    const v = Math.max(0, Math.min(def.max, n));
    update({ free: { ...state.free, [key]: v } }, { focus });
  };
  const input = h('input', {
    id, type: 'number', inputmode: 'numeric', min: 0, max: def.max, step: 1, value: String(value),
    'aria-describedby': `${id}-limit`,
    onchange: (e) => {
      const n = Math.round(Number(e.target.value));
      set(Number.isFinite(n) ? n : 0);
    },
  });
  const pct = Math.round((value / def.max) * 100);
  return h('span', { class: 'qty-ctl' },
    h('span', { class: 'stepper', dir: 'ltr' },
      h('button', { type: 'button', id: `${id}-dec`, 'aria-label': `הפחתת ${def.name}`, disabled: value <= 0, onclick: () => set(value - 1, `${id}-dec`) }, '−'),
      input,
      h('button', { type: 'button', id: `${id}-inc`, 'aria-label': `הוספת ${def.name}`, disabled: value >= def.max, onclick: () => set(value + 1, `${id}-inc`) }, '+'),
    ),
    h('span', { class: 'gauge' },
      h('span', { class: 'meter', 'aria-hidden': 'true' }, h('span', { style: `inline-size:${pct}%` })),
      h('span', { class: 'limit' + (value >= def.max ? ' at-max' : ''), id: `${id}-limit` },
        value >= def.max ? `מקסימום ${def.max}` : `${value} מתוך ${def.max}`),
    ),
  );
}

function toggleTile(key, def, badge) {
  const id = `free-${key}`;
  const on = state.free[key];
  return h('label', { class: 'tile' + (on ? ' is-on' : ''), for: id },
    h('span', { class: 'tile-head' },
      h('span', { class: 'tile-title' }, def.name, badge ? h('span', { class: 'tag tag-warn' }, badge) : null),
      h('span', { class: 'switch' },
        h('input', {
          type: 'checkbox', role: 'switch', id, checked: on,
          onchange: (e) => update({ free: { ...state.free, [key]: e.target.checked } }, { focus: id }),
        }),
        h('span', { 'aria-hidden': 'true' }),
      ),
    ),
    h('span', { class: 'tile-detail' }, def.detail),
    h('span', { class: 'tile-foot' },
      h('span', { class: 'tag tag-free' }, 'ללא עלות'),
      h('span', { class: 'state-label', 'aria-hidden': 'true' }, on ? 'נבחר' : 'לא נבחר'),
    ),
  );
}

function quantityTile(key, def, detail) {
  return h('div', { class: 'tile' + (state.free[key] > 0 ? ' is-on' : '') },
    h('span', { class: 'tile-head' },
      h('label', { class: 'tile-title', for: `free-${key}` }, def.name),
      h('span', { class: 'tag tag-free' }, 'ללא עלות'),
    ),
    h('span', { class: 'tile-detail' }, detail),
    h('span', { class: 'tile-foot' }, stepper(key, def)),
  );
}

function renderFree() {
  const tiles = [quantityTile('graphics', FREE_ADDONS.graphics, 'בנוסף לגרפיקות שבחבילה · לשנה')];
  if (freeAddonAvailable('simeonJoin', state)) tiles.push(toggleTile('simeonJoin', FREE_ADDONS.simeonJoin));
  if (freeAddonAvailable('simeonStories', state)) {
    tiles.push(quantityTile('simeonStories', FREE_ADDONS.simeonStories,
      state.influencer === 'natali' ? 'זמין כי סמיון צורף לחבילה · לשנה' : 'בנוסף למה שכלול בחבילה · לשנה'));
  }
  tiles.push(toggleTile('extraCh14', FREE_ADDONS.extraCh14, 'חריג'));
  $('free').replaceChildren(...tiles);
}

function renderSummary() {
  const model = buildQuoteModel(state, readClient());
  const t = model.totals;
  const tier = TIERS.find((x) => x.id === state.tier);
  $('sum-pkg').textContent = tier.name;
  $('sum-inf').textContent = INFLUENCERS[state.influencer].name;

  const line = (name, val, cls = '') => h('li', { class: cls },
    h('span', { class: 'name' }, name), h('span', { class: 'lead', 'aria-hidden': 'true' }), val);
  const lines = [
    line('חבילה', h('span', { class: 'val', dir: 'ltr' }, formatILS(model.package.monthly))),
    ...model.paid.map((p) => line(p.name, h('span', { class: 'val', dir: 'ltr' }, `+${formatILS(p.monthly)}`))),
    t.discount ? line('הנחה', h('span', { class: 'val is-discount', dir: 'ltr' }, `−${formatILS(t.discount)}`)) : null,
  ].filter(Boolean);
  const free = model.free.map((f) => line(f.qty ? `${f.name} × ${f.qty}` : f.name, h('span', { class: 'free' }, '0 ₪'), 'is-free'));

  // Composition of the monthly price: package vs. paid add-ons.
  const pkgPct = (model.package.monthly / t.monthlyList) * 100;
  const bar = h('div', { class: 'compo', role: 'img', 'aria-label': `חבילה ${Math.round(pkgPct)}% מהמחיר החודשי` },
    h('span', { class: 'compo-pkg', style: `inline-size:${pkgPct}%` }),
    h('span', { class: 'compo-add', style: `inline-size:${100 - pkgPct}%` }),
  );
  $('sum-lines').replaceChildren(...[
    bar,
    h('div', { class: 'compo-legend' },
      h('span', {}, h('i', { class: 'dot-pkg' }), 'חבילה'),
      h('span', {}, h('i', { class: 'dot-add' }), `תוספות · ${model.paid.length}`),
      h('span', {}, h('i', { class: 'dot-free' }), `הטבות · ${model.free.length}`),
    ),
    h('ul', { class: 'lines' }, lines, free),
  ]);

  const set = (id, v) => { $(id).textContent = formatILS(v); $(id).setAttribute('dir', 'ltr'); };
  set('t-mnet', t.monthlyNet);
  set('t-mvat', t.monthlyVat);
  set('t-mgross', t.monthlyGross);
  set('t-ynet', t.termNet);
  set('t-ygross', t.termGross);
  $('t-vat-label').textContent = `מע״מ ${VAT_RATE_PERCENT}%`;
  $('mb-total').textContent = formatILS(t.monthlyGross);
  $('mb-net').textContent = formatILS(t.monthlyNet);
  $('term-note').textContent = state.paid.includes('photographer')
    ? 'התחייבות ל־12 חודשים. הכמויות שנתיות, למעט הצלם החודשי: 8 תכנים בכל חודש.'
    : 'התחייבות ל־12 חודשים. כל הכמויות בחבילה ובתוספות הן לשנה.';
  return t;
}

let lastAnnounced = null;
function announce(t) {
  if (lastAnnounced === t.monthlyGross) return;
  lastAnnounced = t.monthlyGross;
  $('live-total').textContent = `סה״כ לחודש כולל מע״מ: ${formatILS(t.monthlyGross)}`;
}

function renderDocType() {
  const doc = DOC_TYPES[state.docType];
  const signable = doc.signable;
  $('page-h1').textContent = signable ? 'הסכם התקשרות חדש' : 'הצעת מחיר חדשה';
  document.title = `${signable ? 'הסכם התקשרות' : 'הצעת מחיר'} · astrateg`;
  $('sum-doc').textContent = doc.name;
  $('btn-link').textContent = signable ? 'יצירת קישור לחתימה' : 'יצירת קישור לצפייה';
  $('act-hint').textContent = signable
    ? 'הלקוח קורא את ההסכם וחותם אונליין · נשמר ב״הצעות שנשלחו״'
    : 'הלקוח צופה בהצעה, בלי חתימה · נשמר ב״הצעות שנשלחו״';
  document.querySelectorAll('#doc-switch [data-doc]').forEach((b) => {
    b.setAttribute('aria-checked', String(b.dataset.doc === state.docType));
  });
}

function render({ focus } = {}) {
  renderDocType();
  renderInfluencers();
  renderTiers();
  renderIncluded();
  renderPaid();
  renderFree();
  const t = renderSummary();
  announce(t);
  if (focus) {
    const el = $(focus);
    if (el && !el.disabled) el.focus();
    else $(focus.replace(/-(inc|dec)$/, ''))?.focus();
  }
}

/* ── Section navigation ────────────────────── */
function setupSectionNav() {
  // The summary is always on screen (sticky), so only the three work sections drive the state.
  const links = [...document.querySelectorAll('.stepnav a')].filter((a) => a.getAttribute('href') !== '#summary');
  const sections = links.map((a) => document.querySelector(a.getAttribute('href')));
  const obs = new IntersectionObserver((entries) => {
    for (const en of entries) {
      if (!en.isIntersecting) continue;
      const i = sections.indexOf(en.target);
      links.forEach((a, j) => {
        a.classList.toggle('is-active', j === i);
        a.classList.toggle('is-done', j < i);
        if (j === i) a.setAttribute('aria-current', 'step'); else a.removeAttribute('aria-current');
      });
    }
  }, { rootMargin: '-35% 0px -55% 0px' });
  sections.forEach((s) => s && obs.observe(s));
}

/* ── State changes ─────────────────────────── */

function showRemoved(names) {
  if (!names.length) {
    $('removed-notice').hidden = true;
    return;
  }
  $('removed-notice').hidden = false;
  $('removed-text').textContent = `הוסרו כי אינם זמינים בחבילה שנבחרה: ${names.join(', ')}.`;
}

/* ── Draft: survives a refresh or a visit to another page in this tab ── */
const DRAFT_KEY = 'astrateg-draft';
const CLIENT_FIELDS = ['c-name', 'c-company', 'c-companyid', 'c-phone', 'c-email', 'c-notes'];
function saveDraft() {
  if (document.body.classList.contains('is-choosing')) return;
  try {
    const client = Object.fromEntries(CLIENT_FIELDS.map((id) => [id, $(id).value]));
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ state, client, dealId }));
  } catch { /* storage unavailable */ }
}
function restoreDraft(forDeal = null) {
  try {
    const draft = JSON.parse(sessionStorage.getItem(DRAFT_KEY) || 'null');
    if (!draft?.state || !DOC_TYPES[draft.state.docType]) return false;
    // Opened from a deal: only that deal's own draft (a refresh), never another one.
    if (forDeal && draft.dealId !== forDeal) return false;
    const { selection } = reconcile({ ...emptySelection(), ...draft.state, free: { ...emptySelection().free, ...draft.state.free } });
    state = selection;
    for (const id of CLIENT_FIELDS) if (typeof draft.client?.[id] === 'string') $(id).value = draft.client[id];
    $('discount').value = String((state.discount || 0) / 100);
    return true;
  } catch {
    return false;
  }
}

function update(patch, opts = {}) {
  const active = document.activeElement;
  const focusId = opts.focus || (active && active.id) || null;
  const focusName = !focusId && active && active.name ? active.name : null;
  const { selection, removed } = reconcile({ ...state, ...patch });
  state = selection;
  showRemoved(removed);
  render({ focus: focusId });
  saveDraft();
  if (focusName) document.querySelector(`input[name="${focusName}"]:checked`)?.focus();
}

function togglePaid(id, on) {
  const paid = on ? [...new Set([...state.paid, id])] : state.paid.filter((x) => x !== id);
  // keep catalog order so the quote lists items consistently
  update({ paid: PAID_ADDONS.map((a) => a.id).filter((x) => paid.includes(x)) }, { focus: `paid-${id}` });
}

$('removed-close').addEventListener('click', () => { $('removed-notice').hidden = true; });

/* ── Client details ────────────────────────── */

function readClient() {
  return {
    name: $('c-name').value,
    company: $('c-company').value,
    phone: $('c-phone').value,
    email: $('c-email').value,
    companyId: $('c-companyid').value,
    notes: $('c-notes').value,
  };
}

function validateClient() {
  const name = $('c-name');
  const email = $('c-email');
  const cid = $('c-companyid');
  const nameOk = name.value.trim().length > 0;
  const emailOk = !email.value.trim() || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value.trim());
  const cidOk = !cid.value.trim() || /^[0-9][0-9-]{3,18}$/.test(cid.value.trim());
  cid.setAttribute('aria-invalid', String(!cidOk));
  $('c-companyid-err').hidden = cidOk;
  name.setAttribute('aria-invalid', String(!nameOk));
  $('c-name-err').hidden = nameOk;
  email.setAttribute('aria-invalid', String(!emailOk));
  $('c-email-err').hidden = emailOk;
  if (!nameOk || !emailOk || !cidOk) {
    const target = !nameOk ? name : !cidOk ? cid : email;
    target.scrollIntoView({ block: 'center', behavior: 'smooth' });
    target.focus({ preventScroll: true });
    return false;
  }
  return true;
}

['c-name', 'c-email', 'c-companyid'].forEach((id) => $(id).addEventListener('input', () => {
  if ($(id).getAttribute('aria-invalid') === 'true') {
    const ok = id === 'c-name' ? $(id).value.trim().length > 0 : true;
    if (ok) { $(id).setAttribute('aria-invalid', 'false'); $(`${id}-err`).hidden = true; }
  }
}));
$('client-form').addEventListener('submit', (e) => e.preventDefault());
CLIENT_FIELDS.forEach((id) => $(id).addEventListener('input', saveDraft));

/* ── Discount ──────────────────────────────── */
function readDiscount() {
  const v = Math.round(Number($('discount').value));
  return Number.isFinite(v) ? Math.min(Math.max(v, 0), MAX_DISCOUNT / 100) : 0;
}
$('discount').addEventListener('input', () => update({ discount: readDiscount() * 100 }, { focus: 'discount' }));
$('discount').addEventListener('change', () => { $('discount').value = String(readDiscount()); });

/* ── Output: preview, print, HTML file ─────── */

function currentModel() {
  return buildQuoteModel(state, readClient());
}

function openDialog(dlg, returnTo) {
  dlg._returnTo = returnTo || document.activeElement;
  dlg.showModal();
}
document.querySelectorAll('dialog').forEach((dlg) => {
  dlg.addEventListener('close', () => dlg._returnTo?.focus?.());
  dlg.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) dlg.close();
    else if (e.target === dlg) dlg.close();
  });
});

$('btn-preview').addEventListener('click', (e) => {
  if (!validateClient()) return;
  $('preview-body').replaceChildren(renderQuoteDoc(currentModel()));
  openDialog($('dlg-preview'), e.currentTarget);
  $('dlg-preview').querySelector('.close').focus();
});

$('btn-print').addEventListener('click', async () => {
  if (!validateClient()) return;
  const doc = renderQuoteDoc(currentModel());
  $('print-root').replaceChildren(doc);
  await Promise.all([...doc.querySelectorAll('img')].map((img) => img.decode().catch(() => {})));
  window.print();
});

// Ctrl+P prints the current quote too, never a stale or empty page.
window.addEventListener('beforeprint', () => {
  const name = $('c-name').value.trim();
  $('print-root').replaceChildren(name
    ? renderQuoteDoc(currentModel())
    : h('p', { style: 'font: 16px sans-serif; padding: 40px' }, 'כדי להדפיס הצעת מחיר יש למלא את שם הלקוח.'));
});

function localStamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

async function toDataUrl(url) {
  const blob = await (await fetch(url)).blob();
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}

$('btn-html').addEventListener('click', async () => {
  if (!validateClient()) return;
  try {
    const fontFiles = [
      ['Rubik', 'rubik-hebrew', 'U+0590-05FF,U+200C-2010,U+20AA,U+25CC,U+FB1D-FB4F'],
      ['Rubik', 'rubik-latin', 'U+0000-00FF,U+2000-206F'],
    ];
    const [css, logo, ...fonts] = await Promise.all([
      fetch('app/styles/quote.css').then((r) => r.text()),
      toDataUrl('app/assets/logo.png'),
      ...fontFiles.map(([, f]) => toDataUrl(`app/fonts/${f}.woff2`)),
    ]);
    const fontCss = fontFiles.map(([family, f, range], i) => `@font-face{font-family:'${family}';font-weight:300 900;`
      + `src:url(${fonts[i].replace('application/octet-stream', 'font/woff2')}) format('woff2');unicode-range:${range};}`).join('');
    const model = currentModel();
    const doc = renderQuoteDoc(model, { logoSrc: logo });
    const safeTitle = `${model.docTitle} · ${model.client.name}`.replace(/[<>&"]/g, '');
    const html = `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8">`
      + `<meta name="viewport" content="width=device-width, initial-scale=1"><title>${safeTitle}</title>`
      + `<style>${fontCss}body{margin:0;background:#fff}@page{size:A4;margin:14mm 12mm}${css}</style></head>`
      + `<body>${doc.outerHTML}</body></html>`;
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const a = h('a', {
      href: URL.createObjectURL(blob),
      download: `astrateg-quote-${localStamp()}.html`,
    });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    toast('קובץ HTML נוצר. הדפדפן יוריד אותו או יבקש אישור.');
  } catch {
    toast('לא הצלחנו ליצור את הקובץ. נסו שוב.');
  }
});

/* ── Share link ────────────────────────────── */

// Quotes created in this session, to warn about duplicates for the same client.
const created = [];

let toastTimer;
function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 3600);
}

function busy(btn, on, label) {
  btn.disabled = on;
  if (on) {
    btn.dataset.label = btn.textContent;
    btn.replaceChildren(h('span', { class: 'spin', 'aria-hidden': 'true' }), label);
  } else if (btn.dataset.label) {
    btn.textContent = btn.dataset.label;
  }
}

async function refreshSession() {
  try {
    const s = await getSupa();
    const staff = await s.currentStaff();
    $('session-dot').classList.toggle('on', !!staff?.isStaff);
    $('session-who').textContent = staff ? staff.email : 'לא מחובר';
    // The managers' switch, "המשימות שלי" / "מבט מנהל" (app/manager-ui.js).
    if (staff?.isStaff) import('./manager-ui.js').then((m) => m.mountModeSwitch(staff.email)).catch(() => {});
    return staff;
  } catch {
    return null;
  }
}

function askLogin() {
  return new Promise((resolve) => {
    const dlg = $('dlg-login');
    const form = $('login-form');
    $('lg-err').hidden = true;
    $('lg-msg').hidden = true;
    const onSubmit = async (e) => {
      e.preventDefault();
      const btn = $('lg-submit');
      busy(btn, true, 'מתחבר…');
      try {
        const s = await getSupa();
        const { error } = await s.supabase.auth.signInWithPassword({
          email: s.cleanEmail($('lg-email').value), password: $('lg-pass').value,
        });
        if (error) throw error;
        const staff = await refreshSession();
        if (!staff?.isStaff) throw new Error('not staff');
        form.removeEventListener('submit', onSubmit);
        dlg.close();
        resolve(true);
      } catch (err) {
        const s = await getSupa().catch(() => null);
        $('lg-err').textContent = s ? s.explainError(err) : 'אין חיבור לשרת.';
        $('lg-err').hidden = false;
      } finally {
        busy(btn, false);
      }
    };
    form.addEventListener('submit', onSubmit);
    dlg.addEventListener('close', () => { form.removeEventListener('submit', onSubmit); resolve(false); }, { once: true });
    openDialog(dlg, $('btn-link'));
    $('lg-email').focus();
  });
}

$('lg-forgot').addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  const err = $('lg-err');
  const msg = $('lg-msg');
  err.hidden = true;
  msg.hidden = true;
  btn.disabled = true;
  try {
    const s = await getSupa();
    const email = s.cleanEmail($('lg-email').value);
    if (!s.looksLikeEmail(email)) {
      err.textContent = s.RESET_NEEDS_EMAIL;
      err.hidden = false;
      $('lg-email').focus();
      return;
    }
    await s.sendPasswordReset(email);
    msg.textContent = s.RESET_SENT;
    msg.hidden = false;
  } catch (e2) {
    const s = await getSupa().catch(() => null);
    err.textContent = s ? s.explainError(e2) : 'אין חיבור לשרת.';
    err.hidden = false;
  } finally {
    btn.disabled = false;
  }
});

let creating = false;
$('btn-link').addEventListener('click', async (e) => {
  if (creating || !validateClient()) return;
  const btn = e.currentTarget;
  creating = true;
  try {
    const staff = await refreshSession();
    if (!staff?.isStaff && !(await askLogin())) return;
    await createLink(btn);
  } finally {
    creating = false;
  }
});

async function createLink(btn) {
  busy(btn, true, 'יוצר קישור…');
  try {
    const s = await getSupa();
    const { data, error } = await s.supabase.functions.invoke('create-quote', {
      body: { selection: state, client: readClient() },
    });
    if (error) {
      let detail = error;
      try { detail = new Error((await error.context.json()).error); } catch { /* keep original */ }
      throw detail;
    }
    const link = s.quoteLink(data.token);
    if (dealId) {
      // The deal's contract is out: linked, Irit's clock stops and Stav sees "חוזה נשלח".
      try {
        const { linkQuote } = await import('./deal-data.js');
        await linkQuote(dealId, data.id);
        toast('החוזה קושר לעסקה של השטח: הסטטוס עודכן ל״חוזה נשלח״.');
      } catch {
        toast('הקישור נוצר, אבל לא קושר לעסקה. לסמן ״החוזה נשלח״ במשימות שלי.');
      }
    }
    const clientName = readClient().name.trim();
    const prev = created.filter((c) => c.clientName === clientName && !c.cancelled);
    created.push({ id: data.id, number: data.number, clientName, gross: currentModel().totals.monthlyGross });
    renderPrevQuotes(prev);
    $('sh-number').textContent = data.number;
    const signable = DOC_TYPES[state.docType].signable;
    $('sh-doc').textContent = signable ? 'ההסכם' : 'ההצעה';
    $('sh-what').textContent = signable
      ? 'שלחו אותו ללקוח, והוא יוכל לקרוא את ההסכם ולחתום עליו.'
      : 'שלחו אותו ללקוח, והוא יוכל לצפות בהצעה (ללא חתימה).';
    $('sh-status').textContent = signable ? 'ממתין לחתימה' : 'נשלח לצפייה';
    $('sh-link').value = link;
    $('sh-open').href = link;
    const name = readClient().name.trim();
    const hours = DOC_TYPES[state.docType].validHours;
    const text = signable
      ? `שלום ${name}, מצורף הסכם ההתקשרות מאסטרטג (${data.number}) ל־12 חודשים. אפשר לעיין ולחתום כאן בתוך ${hours} שעות:\n${link}`
      : `שלום ${name}, מצורפת הצעת המחיר מאסטרטג (${data.number}), בתוקף ל־${hours} שעות. לצפייה:\n${link}`;
    $('sh-wa').href = whatsappLink(readClient().phone, text);
    $('sh-mail').href = `mailto:${encodeURIComponent(readClient().email.trim())}?subject=${encodeURIComponent(`${DOC_TYPES[state.docType].name} ${data.number} · astrateg`)}&body=${encodeURIComponent(text)}`;
    openDialog($('dlg-share'), btn);
    $('sh-link').select();
  } catch (err) {
    const s = await getSupa().catch(() => null);
    toast(s ? s.explainError(err) : 'אין חיבור לשרת.');
  } finally {
    busy(btn, false);
  }
}

function renderPrevQuotes(prev) {
  const box = $('sh-prev');
  box.replaceChildren(...prev.map((p) => h('div', { class: 'prev-quote' },
    h('span', {}, 'ללקוח זה קיימת הצעה פתוחה ', h('strong', { class: 'num', dir: 'ltr' }, p.number),
      ' (', h('span', { dir: 'ltr' }, formatILS(p.gross)), ' לחודש). הלקוח יכול לחתום על שתיהן.'),
    h('button', {
      type: 'button', class: 'btn btn-sm',
      onclick: async (e) => {
        const btn = e.currentTarget;
        btn.disabled = true;
        const s = await getSupa();
        const { error } = await s.supabase.rpc('cancel_quote', { p_id: p.id });
        if (error) { btn.disabled = false; toast(s.explainError(error)); return; }
        p.cancelled = true;
        btn.closest('.prev-quote').replaceChildren(`הצעה ${p.number} בוטלה. הקישור הקודם כבר לא פעיל.`);
      },
    }, `ביטול ${p.number}`),
  )));
}

$('sh-copy').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText($('sh-link').value);
    toast('הקישור הועתק.');
  } catch {
    $('sh-link').select();
    toast('סמנו את הקישור והעתיקו ידנית.');
  }
});

/* ── Boot ──────────────────────────────────── */
/* ── Document type ─────────────────────────── */
function chooseDoc(type, focusTarget) {
  update({ docType: type });
  document.body.classList.remove('is-choosing');
  $('start').hidden = true;
  saveDraft();
  if (focusTarget) focusTarget.focus();
}
document.querySelectorAll('.start-card').forEach((b) => b.addEventListener('click', () => {
  chooseDoc(b.dataset.doc);
  window.scrollTo({ top: 0 });
  $('page-h1').setAttribute('tabindex', '-1');
  $('page-h1').focus();
}));
document.querySelectorAll('#doc-switch [data-doc]').forEach((b) => b.addEventListener('click', () => chooseDoc(b.dataset.doc, b)));

// From a deal of the field: an agreement prefilled with what was sold (the package,
// the influencers, the add-ons, the discount) and the client's details. A refresh
// keeps what was already edited here (that deal's draft).
async function openFromDeal(id) {
  const staff = await refreshSession();
  if (!staff?.isStaff && !(await askLogin())) return;
  try {
    const [{ loadDeal }, { prefillFromDeal, contractTitle }] = await Promise.all([import('./deal-data.js'), import('./deal-logic.js')]);
    const d = await loadDeal(id);
    if (!d) { toast('העסקה לא נמצאה, או שאין לך גישה אליה.'); return; }
    dealId = d.id;
    if (!restoreDraft(d.id)) {
      const { selection, client } = prefillFromDeal(d);
      state = selection;
      for (const [fid, v] of Object.entries(client)) $(fid).value = v;
      $('discount').value = String((state.discount || 0) / 100);
    }
    document.body.classList.remove('is-choosing');
    $('start').hidden = true;
    render();
    saveDraft();
    toast(`${contractTitle(d)}: הפרטים מהעסקה נטענו. לבדוק ולהשלים, ואז ליצור קישור.`);
  } catch (err) {
    const s = await getSupa().catch(() => null);
    toast(`העסקה לא נטענה. ${s ? s.explainError(err) : ''}`.trim());
  }
}

if (!DEAL_PARAM && restoreDraft()) {
  document.body.classList.remove('is-choosing');
  $('start').hidden = true;
}
render();
setupSectionNav();
if (DEAL_PARAM) openFromDeal(DEAL_PARAM);
else refreshSession();
