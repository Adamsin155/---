import {
  INFLUENCERS, TIERS, PACKAGES, PAID_ADDONS, FREE_ADDONS, SPEC_ROWS, SPECS,
  VAT_RATE_PERCENT, TERM_MONTHS, DOC_TYPES, MAX_DISCOUNT, packageId,
  CUSTOM_QTY, CUSTOM_LIMITS, MONTHLY_CONTENTS,
} from './catalog.js';
import {
  emptySelection, reconcile, computeTotals, buildQuoteModel, formatILS,
  paidAddonAvailable, freeAddonAvailable,
  exceptionOf, normalizeSelection, baseQuantities,
} from './pricing.js';
import { h, renderQuoteDoc, whatsappLink } from './quote-doc.js';
import { iconSquare, headIcon, noteIcon } from './kit.js';
// The sign-in form's look and its button with the door (docs/ops.md, section 51).
import { loginDoor } from './login-ui.js';

// The look of the kit on the builder's own screen (app/kit.js; docs/ops.md, section 53):
// each section's head, each group of add-ons and the notice take an icon square. Nothing
// of the printed quote or agreement is touched (app/quote-doc.js, quote.css).
for (const [hid, name, tone] of [['s1', 'box', 'purple'], ['s2', 'star', 'green'], ['s3', 'user', 'blue']]) {
  const head = document.getElementById(hid)?.closest('.block-head');
  if (head && !head.querySelector(':scope > .k-ico')) head.querySelector('.idx')?.after(iconSquare(name, tone));
}
for (const [hid, name, tone] of [['paid-h', 'coins', 'orange'], ['free-h', 'heart', 'green'], ['disc-h', 'tag', 'teal'], ['na-h', 'lock', 'navy']]) headIcon(document.getElementById(hid), name, tone);
document.getElementById('removed-notice')?.prepend(iconSquare('info', 'blue', { size: 'sm' }));

const $ = (id) => document.getElementById(id);
let state = emptySelection();
// Opened from a deal of the field (index.html?deal=<id>, 3.10.2026): its id, so the
// quote created here is linked to it (the deal becomes "חוזה נשלח", and "נחתם" when
// the client signs).
const DEAL_PARAM = new URLSearchParams(location.search).get('deal');
let dealId = null;
// A contract that went for a manager's approval, opened again to be corrected
// (index.html?revise=<quote id>, 6.10.2026): what is sent replaces it as a new version.
const REVISE_PARAM = new URLSearchParams(location.search).get('revise');
let reviseId = null;
// "חוזה מותאם אישית" is the office's (the server refuses it from anyone else).
let office = false;
// The builder is for whoever builds a contract (canBuildQuote in app/manager-rules.js: the
// owners, Irit, Lior, Ofir). A signed-in member of staff who is not one of them gets
// "אין לך גישה לעמוד הזה" with the way back to their own screen, and nothing of the builder.
let denied = false;
function deny(link) {
  denied = true;
  const box = $('no-access');
  for (const el of $('main').children) el.hidden = el !== box;
  $('mobilebar').hidden = true;
  for (const d of document.querySelectorAll('dialog[open]')) d.close();
  const a = $('na-home');
  a.href = link.href;
  a.textContent = link.label;
}

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
      h('span', { class: 'included-title' }, h('span', { class: 'nw' }, 'מה כלול ב־', h('bdi', {}, tier.short)), h('span', { class: 'k-sep' }, ' · '), h('span', { class: 'of' }, INFLUENCERS[state.influencer].name)),
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
  const model = currentModel();
  const t = model.totals;
  const tier = TIERS.find((x) => x.id === state.tier);
  $('sum-pkg').textContent = tier.name;
  $('sum-inf').textContent = INFLUENCERS[state.influencer].name;

  const line = (name, val, cls = '') => h('li', { class: cls },
    h('span', { class: 'name' }, name), h('span', { class: 'lead', 'aria-hidden': 'true' }), val);
  const lines = [
    line('חבילה', h('span', { class: 'val', dir: 'ltr' }, formatILS(model.package.monthly))),
    ...model.paid.map((p) => line(p.name, h('span', { class: 'val', dir: 'ltr' }, `+${formatILS(p.monthly)}`))),
    ...(model.extraLines || []).filter((l) => l.monthly).map((l) => line(l.label, h('span', { class: 'val', dir: 'ltr' }, `+${formatILS(l.monthly)}`))),
    t.discount ? line('הנחה', h('span', { class: 'val is-discount', dir: 'ltr' }, `−${formatILS(t.discount)}`)) : null,
  ].filter(Boolean);
  const free = model.free.map((f) => line(f.qty ? `${f.name} × ${f.qty}` : f.name, h('span', { class: 'free' }, '0 ₪'), 'is-free'));

  // Composition of the monthly price: package vs. paid add-ons.
  const pkgPct = t.monthlyList ? (model.package.monthly / t.monthlyList) * 100 : 100;
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
  // The term in words: 12 months unless the contract was changed by hand.
  const months = model.termMonths;
  const monthsText = months === 1 ? 'חודש אחד' : `${months} חודשים`;
  $('t-ynet-label').textContent = `${monthsText}, לפני מע״מ`;
  $('t-ygross-label').textContent = `${monthsText}, כולל מע״מ`;
  $('fact-term').textContent = monthsText;
  const perMonth = model.selection.custom?.qty?.monthly ?? MONTHLY_CONTENTS;
  if (months === TERM_MONTHS && perMonth === MONTHLY_CONTENTS) {
    $('term-note').textContent = state.paid.includes('photographer')
      ? 'התחייבות ל־12 חודשים. הכמויות שנתיות, למעט הצלם החודשי: 8 תכנים בכל חודש.'
      : 'התחייבות ל־12 חודשים. כל הכמויות בחבילה ובתוספות הן לשנה.';
  } else {
    $('term-note').textContent = state.paid.includes('photographer')
      ? `התחייבות ל־${monthsText}. הכמויות לכל התקופה, למעט הצלם החודשי: ${perMonth} תכנים בכל חודש.`
      : `התחייבות ל־${monthsText}. כל הכמויות בחבילה ובתוספות הן לכל התקופה.`;
  }
  const diff = exceptionOf(model.selection);
  $('sum-diff').hidden = !diff.length;
  $('sum-diff').replaceChildren(...(diff.length ? [h('strong', {}, 'חוזה חריג'), ` · ${diff.length === 1 ? 'שינוי אחד' : `${diff.length} שינויים`} מהחבילה · נשלח לאישור מנהל לפני הלקוח`] : []));
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
  // A contract that differs from the built-in rules goes to a manager first: no link yet.
  const exceptional = exceptionOf(selectionToSend()).length > 0;
  $('btn-link').textContent = exceptional ? 'שליחה לאישור' : signable ? 'יצירת קישור לחתימה' : 'יצירת קישור לצפייה';
  $('act-hint').textContent = exceptional
    ? 'חוזה חריג: נשלח לאישור של אדם, אופיר או ליאור · הקישור ללקוח נוצר אחרי האישור'
    : signable
      ? 'הלקוח קורא את ההסכם וחותם אונליין · נשמר ב״הצעות שנשלחו״'
      : 'הלקוח צופה בהצעה, בלי חתימה · נשמר ב״הצעות שנשלחו״';
  document.querySelectorAll('#doc-switch [data-doc]').forEach((b) => {
    b.setAttribute('aria-checked', String(b.dataset.doc === state.docType));
  });
}

/* ── Custom contract ("חוזה מותאם אישית") ──────
   The office changes the contract by hand on top of the chosen package: the
   package's own quantities, its monthly price, the term, a discount of any size,
   added lines and special terms (state.custom; the rules and the limits are in
   app/pricing.js and app/catalog.js). The panel "מה שונה מהחבילה" lists the
   deviations as the server will see them. Any deviation: the contract goes to a
   manager's approval, and the client's link is made only after it. */
const customOn = () => !!state.custom;
const clampInt = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.round(Number(v))));

// What goes to the server (and into every preview): the selection with the changes
// made by hand, without anything that equals the package.
function selectionToSend() {
  const { custom: c, ...rest } = state;
  if (!c) return rest;
  const custom = { discount: rest.discount || 0 };
  const qty = Object.fromEntries(Object.entries(c.qty || {}).filter(([k, v]) => {
    const def = CUSTOM_QTY.find((q) => q.key === k);
    return def && Number.isInteger(v) && (!def.addon || rest.paid.includes(def.addon));
  }));
  if (Object.keys(qty).length) custom.qty = qty;
  if (Number.isInteger(c.price)) custom.price = c.price;
  if (Number.isInteger(c.termMonths)) custom.termMonths = c.termMonths;
  const lines = (c.lines || []).filter((l) => String(l.label || '').trim()).map((l) => ({
    label: String(l.label).trim().slice(0, CUSTOM_LIMITS.lineLabel),
    ...(Number.isInteger(l.qty) && l.qty > 0 ? { qty: l.qty } : {}),
    ...(Number.isInteger(l.monthly) && l.monthly > 0 ? { monthly: l.monthly } : {}),
  }));
  if (lines.length) custom.lines = lines;
  if (String(c.terms || '').trim()) custom.terms = c.terms;
  return normalizeSelection({ ...rest, discount: 0, custom });
}
// The most the discount field takes: 200 ₪, or the whole monthly price in a custom contract.
function discountMax() {
  if (!customOn()) return MAX_DISCOUNT / 100;
  return Math.floor(computeTotals(selectionToSend()).monthlyList / 100);
}

function customStepper(q, base) {
  const id = `cq-${q.key}`;
  const min = q.min || 0;
  const value = Number.isInteger(state.custom.qty?.[q.key]) ? state.custom.qty[q.key] : base;
  const set = (n, focus = id) => {
    const v = clampInt(Number.isFinite(Number(n)) ? n : base, min, q.max);
    const qty = { ...(state.custom.qty || {}) };
    if (v === base) delete qty[q.key]; else qty[q.key] = v;
    update({ custom: { ...state.custom, qty } }, { focus });
  };
  return h('div', { class: 'custom-q' + (value !== base ? ' is-changed' : '') },
    h('label', { for: id }, q.name),
    h('span', { class: 'stepper', dir: 'ltr' },
      h('button', { type: 'button', id: `${id}-dec`, 'aria-label': `הפחתת ${q.name}`, disabled: value <= min, onclick: () => set(value - 1, `${id}-dec`) }, '−'),
      h('input', {
        id, type: 'number', inputmode: 'numeric', min, max: q.max, step: 1, value: String(value), 'aria-describedby': `${id}-was`,
        onchange: (e) => set(e.target.value === '' ? base : e.target.value),
      }),
      h('button', { type: 'button', id: `${id}-inc`, 'aria-label': `הוספת ${q.name}`, disabled: value >= q.max, onclick: () => set(value + 1, `${id}-inc`) }, '+'),
    ),
    h('span', { class: 'was', id: `${id}-was` }, value !== base ? `בחבילה: ${base} · שונה` : `בחבילה: ${base}`),
  );
}

function renderLines() {
  const lines = state.custom?.lines || [];
  const setLine = (i, patch) => {
    // The lines as they are now (typing in one field never rebuilds the others).
    const next = (state.custom?.lines || []).map((l, j) => (j === i ? { ...l, ...patch } : l));
    update({ custom: { ...state.custom, lines: next } });
  };
  const num = (v, max) => (v === '' || !Number.isFinite(Number(v)) || Number(v) <= 0 ? null : clampInt(v, 1, max));
  $('custom-lines').replaceChildren(...lines.map((l, i) => h('div', { class: 'custom-line' },
    h('label', { class: 'l-label' }, 'מה כלול',
      h('input', { class: 'input', id: `cl-label-${i}`, maxlength: CUSTOM_LIMITS.lineLabel, value: l.label || '', oninput: (e) => setLine(i, { label: e.target.value }) })),
    h('label', {}, 'כמות',
      h('input', { class: 'input', id: `cl-qty-${i}`, type: 'number', inputmode: 'numeric', min: 1, max: CUSTOM_LIMITS.lineQtyMax, step: 1, dir: 'ltr', value: l.qty ?? '', oninput: (e) => setLine(i, { qty: num(e.target.value, CUSTOM_LIMITS.lineQtyMax) }) })),
    h('label', {}, '₪ לחודש',
      h('input', { class: 'input', id: `cl-price-${i}`, type: 'number', inputmode: 'numeric', min: 0, max: CUSTOM_LIMITS.linePriceMax / 100, step: 1, dir: 'ltr', value: l.monthly ? l.monthly / 100 : '', oninput: (e) => { const v = num(e.target.value, CUSTOM_LIMITS.linePriceMax / 100); setLine(i, { monthly: v === null ? null : v * 100 }); } })),
    h('button', {
      type: 'button', class: 'x', id: `cl-del-${i}`, 'aria-label': `הסרת השורה ${l.label || i + 1}`,
      onclick: () => {
        state = { ...state, custom: { ...state.custom, lines: (state.custom?.lines || []).filter((_, j) => j !== i) } };
        renderLines();
        update({});
        $('custom-add-line').focus();
      },
    }, '×'),
  )));
  $('custom-add-line').disabled = lines.length >= CUSTOM_LIMITS.lines;
}

// The text fields keep their own DOM (typing never rebuilds them); called when the
// state was replaced as a whole: a draft, a deal, a contract opened for correction.
function syncCustomInputs() {
  $('custom-terms').value = state.custom?.terms || '';
  renderLines();
}

function renderCustom() {
  const group = $('custom-group');
  group.hidden = !office;
  const on = customOn();
  group.classList.toggle('is-on', on);
  $('custom-on').checked = on;
  $('custom-body').hidden = !on;
  $('disc-meta').textContent = on ? 'בחוזה מותאם: כל סכום · מעל 200 ₪ נדרש אישור מנהל' : 'עד 200 ₪ לחודש · לפני מע״מ';
  $('discount').max = String(discountMax());
  if (!on) return;
  // The price went under the discount: the discount follows it down.
  if ((state.discount || 0) > discountMax() * 100) {
    state = { ...state, discount: discountMax() * 100 };
    $('discount').value = String(state.discount / 100);
  }
  const pkg = PACKAGES[packageId(state.tier, state.influencer)];
  const base = baseQuantities(state);
  $('custom-qty').replaceChildren(...CUSTOM_QTY
    .filter((q) => !q.addon || state.paid.includes(q.addon))
    .map((q) => customStepper(q, base[q.key])));
  const active = document.activeElement;
  if (active !== $('custom-price')) $('custom-price').value = String((Number.isInteger(state.custom.price) ? state.custom.price : pkg.price) / 100);
  if (active !== $('custom-term')) $('custom-term').value = String(Number.isInteger(state.custom.termMonths) ? state.custom.termMonths : TERM_MONTHS);
  $('custom-price-was').textContent = `בחבילה: ${formatILS(pkg.price)}`;
  const diff = exceptionOf(selectionToSend());
  $('custom-diff').replaceChildren(
    h('h4', {}, 'מה שונה מהחבילה'),
    diff.length
      ? h('ul', { id: 'custom-diff-list' }, diff.map((d) => h('li', {}, d.text)))
      : h('p', {}, 'אין שינוי מהחבילה: זה חוזה רגיל, והוא נשלח ללקוח בלי אישור.'),
    // (replaceChildren would print a null as the word 'null'.)
    ...(diff.length ? [h('p', { class: 'needs' }, 'נדרש אישור של אדם, אופיר או ליאור לפני שהלקוח מקבל את החוזה.')] : []),
  );
}

function setCustom(on) {
  if (on) {
    state = { ...state, custom: state.custom || {} };
  } else {
    const { custom, ...rest } = state;
    state = { ...rest, discount: Math.min(rest.discount || 0, MAX_DISCOUNT) };
    $('discount').value = String(state.discount / 100);
  }
  syncCustomInputs();
  update({}, { focus: 'custom-on' });
}
$('custom-on').addEventListener('change', (e) => setCustom(e.target.checked));
$('custom-price').addEventListener('input', (e) => {
  const pkg = PACKAGES[packageId(state.tier, state.influencer)];
  const raw = e.target.value;
  const price = raw === '' || !Number.isFinite(Number(raw)) ? pkg.price : clampInt(raw, 0, CUSTOM_LIMITS.priceMax / 100) * 100;
  const custom = { ...state.custom };
  if (price === pkg.price) delete custom.price; else custom.price = price;
  update({ custom }, { focus: 'custom-price' });
});
$('custom-term').addEventListener('input', (e) => {
  const raw = e.target.value;
  const term = raw === '' || !Number.isFinite(Number(raw)) ? TERM_MONTHS : clampInt(raw, CUSTOM_LIMITS.termMin, CUSTOM_LIMITS.termMax);
  const custom = { ...state.custom };
  if (term === TERM_MONTHS) delete custom.termMonths; else custom.termMonths = term;
  update({ custom }, { focus: 'custom-term' });
});
for (const id of ['custom-price', 'custom-term']) $(id).addEventListener('change', () => { $(id).blur(); renderCustom(); });
$('custom-terms').addEventListener('input', (e) => update({ custom: { ...state.custom, terms: e.target.value } }, { focus: 'custom-terms' }));
$('custom-add-line').addEventListener('click', () => {
  const lines = [...(state.custom.lines || []), { label: '' }];
  state = { ...state, custom: { ...state.custom, lines } };
  renderLines();
  update({});
  $(`cl-label-${lines.length - 1}`).focus();
});

function render({ focus } = {}) {
  renderDocType();
  renderInfluencers();
  renderTiers();
  renderIncluded();
  renderPaid();
  renderFree();
  renderCustom();
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
  // A phone: the price bar steps aside while the summary's own buttons are on screen
  // (it would cover them, and its one button leads here).
  const acts = document.querySelector('#summary .actions');
  if (acts) new IntersectionObserver(([en]) => document.body.classList.toggle('at-summary', en.isIntersecting), { rootMargin: '0px 0px -80px 0px' }).observe(acts);
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
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ state, client, dealId, reviseId }));
  } catch { /* storage unavailable */ }
}
function restoreDraft(forDeal = null, forRevise = null) {
  try {
    const draft = JSON.parse(sessionStorage.getItem(DRAFT_KEY) || 'null');
    if (!draft?.state || !DOC_TYPES[draft.state.docType]) return false;
    // Opened from a deal: only that deal's own draft (a refresh), never another one.
    if (forDeal && draft.dealId !== forDeal) return false;
    // The same for a contract opened for correction; and its draft never leaks into a new one.
    if ((forRevise || draft.reviseId) && draft.reviseId !== forRevise) return false;
    const { selection } = reconcile({ ...emptySelection(), ...draft.state, free: { ...emptySelection().free, ...draft.state.free } });
    state = selection;
    if (state.custom === null || typeof state.custom !== 'object') delete state.custom;
    for (const id of CLIENT_FIELDS) if (typeof draft.client?.[id] === 'string') $(id).value = draft.client[id];
    $('discount').value = String((state.discount || 0) / 100);
    syncCustomInputs();
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
  return Number.isFinite(v) ? Math.min(Math.max(v, 0), discountMax()) : 0;
}
$('discount').addEventListener('input', () => update({ discount: readDiscount() * 100 }, { focus: 'discount' }));
$('discount').addEventListener('change', () => { $('discount').value = String(readDiscount()); });

/* ── Output: preview, print, HTML file ─────── */

function currentModel() {
  return buildQuoteModel(selectionToSend(), readClient());
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
    // The app shell: the menu of this person's screens, with the managers' switch (app/shell.js).
    if (staff?.isStaff) {
      // Who this is decides whether the page is theirs: answered before anything goes on.
      try {
        const [m, rules, menu] = await Promise.all([import('./shell.js'), import('./manager-rules.js'), import('./shell-rules.js')]);
        m.mountShell(staff.email);
        const v = await m.viewerFor(staff.email);
        if (!v.error && !rules.canBuildQuote(v)) { deny(menu.homeLink(v)); return staff; }
        // "חוזה מותאם אישית" is offered to the office only.
        const was = office;
        office = !v.error && v.scope === 'office';
        if (office !== was) render();
      } catch { /* the menu could not be drawn; the server still decides who creates a quote */ }
    } else if (office) { office = false; render(); }
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
      // The door on the button says "מתחברים…" for as long as the server is asked.
      btn.disabled = true;
      loginDoor.signing();
      try {
        const s = await getSupa();
        const { error } = await s.supabase.auth.signInWithPassword({
          email: s.cleanEmail($('lg-email').value), password: $('lg-pass').value,
        });
        if (error) throw error;
        const staff = await refreshSession();
        if (!staff?.isStaff) throw new Error('not staff');
        if (denied) return; // not their page: deny() closed the dialog, and nothing is created
        // A fresh sign-in starts in the personal profile (app/manager-rules.js).
        import('./manager-rules.js').then((m) => m.resetMode()).catch(() => {});
        form.removeEventListener('submit', onSubmit);
        await loginDoor.success(); // the figure walks in and the button turns green; then the dialog closes
        dlg.close();
        resolve(true);
      } catch (err) {
        const s = await getSupa().catch(() => null);
        $('lg-err').textContent = s ? s.explainError(err) : 'אין חיבור לשרת.';
        $('lg-err').hidden = false;
        loginDoor.failed();
      } finally {
        btn.disabled = false;
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
    if (denied) return;
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
      body: { selection: selectionToSend(), client: readClient(), ...(reviseId ? { revise: reviseId } : {}) },
    });
    if (error) {
      let detail = error;
      try { detail = new Error((await error.context.json()).error); } catch { /* keep original */ }
      throw detail;
    }
    // An exceptional contract: stored, waiting for a manager. There is no link yet.
    if (data.approval === 'pending') {
      if (dealId) {
        try {
          const { linkQuote } = await import('./deal-data.js');
          await linkQuote(dealId, data.id);
        } catch { /* the deal keeps waiting; Irit can mark it from her tasks */ }
      }
      $('pd-number').textContent = data.number;
      $('pd-list').replaceChildren(...exceptionOf(selectionToSend()).map((d) => h('li', {}, d.text)));
      openDialog($('dlg-pending'), btn);
      $('dlg-pending').querySelector('.close').focus();
      return;
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
      ? `שלום ${name}, מצורף הסכם ההתקשרות מאסטרטג (${data.number}) ${currentModel().termMonths === 1 ? 'לחודש אחד' : `ל־${currentModel().termMonths} חודשים`}. אפשר לעיין ולחתום כאן בתוך ${hours} שעות:\n${link}`
      : `שלום ${name}, מצורפת הצעת המחיר מאסטרטג (${data.number}), בתוקף ל־${hours} שעות. לצפייה:\n${link}`;
    $('sh-wa').href = whatsappLink(readClient().phone, text);
    $('sh-mail').href = `mailto:${encodeURIComponent(readClient().email.trim())}?subject=${encodeURIComponent(`${DOC_TYPES[state.docType].name} ${data.number} · astrateg`)}&body=${encodeURIComponent(text)}`;
    openDialog($('dlg-share'), btn);
    $('sh-link').select();
  } catch (err) {
    const s = await getSupa().catch(() => null);
    const msg = String(err?.message || err || '');
    toast(/custom contracts are prepared by the office/.test(msg) ? 'חוזה מותאם אישית מכינים במשרד בלבד.'
      : /can no longer be changed/.test(msg) ? 'אי אפשר לשנות את החוזה הזה יותר (נחתם או בוטל).'
        : s ? s.explainError(err) : 'אין חיבור לשרת.');
  } finally {
    busy(btn, false);
    renderDocType();
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
  if (denied) return;
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
      syncCustomInputs();
    }
    document.body.classList.remove('is-choosing');
    $('start').hidden = true;
    render();
    saveDraft();
    toast(state.custom
      ? `${contractTitle(d)}: הצעה אחרת מהשטח. נפתח חוזה מותאם אישית עם מה שנכתב; לבחור חבילת בסיס, לבדוק, ולשלוח לאישור.`
      : `${contractTitle(d)}: הפרטים מהעסקה נטענו. לבדוק ולהשלים, ואז ליצור קישור.`);
  } catch (err) {
    const s = await getSupa().catch(() => null);
    toast(`העסקה לא נטענה. ${s ? s.explainError(err) : ''}`.trim());
  }
}

// A contract that went for approval, opened to be corrected: the same selection and
// client, in custom mode, with the manager's note on top. Sending stores a new version
// of the same quote (the create-quote function, `revise`).
async function openForRevise(id) {
  const staff = await refreshSession();
  if (!staff?.isStaff && !(await askLogin())) return;
  if (denied) return;
  try {
    const s = await getSupa();
    const { data: q, error } = await s.supabase.from('quotes')
      .select('id, number, status, approval, approval_note, model').eq('id', id).maybeSingle();
    if (error) throw error;
    if (!q || q.status !== 'sent' || !q.approval || q.approval === 'none') {
      toast('אי אפשר לתקן את החוזה הזה: הוא לא נמצא, נחתם, בוטל, או שלא נשלח לאישור.');
      return;
    }
    reviseId = q.id;
    if (!restoreDraft(null, q.id)) {
      const sel = q.model?.selection || {};
      const { custom: c = {}, ...rest } = sel;
      const { discount, ...custom } = JSON.parse(JSON.stringify(c || {}));
      state = reconcile({ ...emptySelection(), ...rest, free: { ...emptySelection().free, ...rest.free }, custom }).selection;
      if (Number.isInteger(discount)) state.discount = discount;
      const cl = q.model?.client || {};
      const map = { 'c-name': cl.name, 'c-company': cl.company, 'c-companyid': cl.companyId, 'c-phone': cl.phone, 'c-email': cl.email, 'c-notes': cl.notes };
      for (const [fid, v] of Object.entries(map)) $(fid).value = v || '';
      $('discount').value = String((state.discount || 0) / 100);
      syncCustomInputs();
    }
    const note = $('revise-note');
    note.hidden = false;
    note.classList.toggle('is-plain', q.approval !== 'rejected');
    note.replaceChildren(h('span', {}, h('strong', {}, 'תיקון חוזה ', h('bdi', { class: 'num', dir: 'ltr' }, q.number), ' · '),
      q.approval === 'rejected' ? `לא אושר: ${q.approval_note || ''}`
        : q.approval === 'approved' ? 'החוזה כבר אושר. כל שינוי בו מחזיר אותו לאישור, והקישור שנשלח ללקוח מפסיק לעבוד עד האישור החדש.'
          : 'החוזה ממתין לאישור. אפשר לתקן ולשלוח שוב.'));
    // The strip of the kit: a small icon square, the tone of what happened (app/kit.js).
    noteIcon(note, q.approval === 'rejected' ? 'late' : 'warn');
    document.body.classList.remove('is-choosing');
    $('start').hidden = true;
    office = true; // only the office reads the quote above
    render();
    saveDraft();
  } catch (err) {
    const s = await getSupa().catch(() => null);
    toast(`החוזה לא נטען. ${s ? s.explainError(err) : ''}`.trim());
  }
}

if (!DEAL_PARAM && !REVISE_PARAM && restoreDraft()) {
  document.body.classList.remove('is-choosing');
  $('start').hidden = true;
}
render();
setupSectionNav();
if (DEAL_PARAM) openFromDeal(DEAL_PARAM);
else if (REVISE_PARAM) openForRevise(REVISE_PARAM);
else refreshSession();
