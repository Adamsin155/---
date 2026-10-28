// The whole document of the old system (astrateg-crm), word for word as its client read and
// signed it (the owner, 28.10.2026: "את כל החוזה במלואו, לא תקצירים"). The old system kept
// only the record (public.legacy_contracts.doc); its signing page (public/sign.html, with
// docView() of server.js and lib/catalog.js) wrote the text around it each time it was opened:
// "מי אנחנו", the package's lines, the team and the social media, the numbers, the add-ons,
// the price table, "דגשים", and the agreement's six clauses (or the record's own clauses).
// This module is that page's text, copied as it was, without the DOM: fullDoc(doc) returns
//   { kind: 'contract' | 'termination', title, sections: [{ title, parts }] }
// where a part is one of
//   { type: 'p', text }                    a paragraph; { lines } for a paragraph with breaks
//   { type: 'h3', text } / { type: 'h4', text }
//   { type: 'ul', items: [text] }          `star: true` on an item: the old page's ⭐ line
//   { type: 'kpis', items: [{ n, l }] }    the big numbers ("פירוט החבילה")
//   { type: 'tiles', items: [{ n, l }] }
//   { type: 'addons', items: [{ name, detail, amount, note, free }] }
//   { type: 'table', head: [..], rows: [{ cells: [..], cls, detail }] }
// and a text is a string, or a list of strings and { b: string } (the old page's bold words).
// Nothing is guessed: a field the record does not have is left out, as the old page did.

// The old system's prices (lib/catalog.js), in whole shekels a month before VAT: only what its
// page needed to draw a document made from the price list (`doc.catalog`).
const OLD = {
  vat: 18, termMonths: 12,
  tiers: { podcast: 'פודקאסט עם משפיענים', social: 'Social all in one', 'social-tv': 'Social + TV all in one' },
  packages: {
    'podcast-natali': { price: 3500, includes: ['פודקאסט עם נטלי דדון', 'ניהול רשתות חברתיות', 'ניהול קמפיינים ממומנים ברשתות', '20 סרטוני פודקאסט', '20 גרפיקות', 'יום צילום עם צלם בבית העסק, וידאו וסטילס'] },
    'podcast-simeon': { price: 3500, includes: ['פודקאסט עם דניס, מישל וסמיון', 'ניהול רשתות חברתיות', 'ניהול קמפיינים ממומנים ברשתות', '20 סרטוני פודקאסט', '20 גרפיקות', 'יום צילום עם צלם בבית העסק, וידאו וסטילס'] },
    'social-simeon': { price: 3900, includes: ['יום צילום בבית העסק עם דניס, מישל וסמיון', 'ניהול רשתות חברתיות', 'ניהול קמפיינים ממומנים ברשתות', '25 סרטונים בבית העסק', '35 גרפיקות', '2 צלמים לווידאו וסטילס בבית העסק', 'קולאב באינסטגרם אצל דניס, מישל וסמיון'] },
    'social-tv-simeon': { price: 4900, includes: ['2 ימי צילום בבית העסק עם דניס, מישל וסמיון', 'ניהול רשתות חברתיות', 'ניהול קמפיינים ממומנים ברשתות', '42 סרטונים בבית העסק', '42 גרפיקות', '2 צלמים לווידאו וסטילס בבית העסק', '3 קולאבים באינסטגרם אצל דניס, מישל וסמיון', '3 סטורי אצל דניס, מישל וסמיון', 'אייטם בערוץ 14'] },
    'social-natali': { price: 3900, includes: ['יום צילום בבית העסק עם נטלי דדון', 'ניהול רשתות חברתיות', 'ניהול קמפיינים ממומנים ברשתות', '25 סרטונים בבית העסק', '35 גרפיקות', '2 צלמים לווידאו וסטילס בבית העסק'] },
    'social-tv-natali': { price: 4900, includes: ['יום צילום בבית העסק עם נטלי דדון', 'ניהול רשתות חברתיות', 'ניהול קמפיינים ממומנים ברשתות', '42 סרטונים בבית העסק', '42 גרפיקות', '2 צלמים לווידאו וסטילס בבית העסק', 'אייטם בערוץ 14', 'סטורי אצל נטלי דדון'] },
  },
  paidAddons: [
    { id: 'photographer', price: 2000, name: 'צלם חודשי', detail: 'צלם שמגיע לבית העסק כל חודש ומייצר 8 תכנים בכל חודש' },
    { id: 'natali-reel', price: 1000, name: 'רילס אצל נטלי דדון', detail: 'רילס שעולה בעמוד של נטלי דדון' },
    { id: 'natali-story', price: 300, name: 'סטורי אצל נטלי דדון', detail: 'סטורי שעולה בעמוד של נטלי דדון' },
    { id: 'simeon-day', price: 500, name: 'יום צילום נוסף עם דניס, מישל וסמיון', detail: 'יום צילום נוסף מעבר לחבילה' },
  ],
  freeAddons: [
    { id: 'graphics', name: 'גרפיקות נוספות', unit: 'גרפיקות' },
    { id: 'simeonStories', name: 'סטורי אצל דניס, מישל וסמיון', unit: 'סטורי' },
    { id: 'simeonSoloStories', name: 'סטורי אצל סמיון', unit: 'סטורי', detail: 'סטורי בעמוד של סמיון בלבד - כשסמיון מצטרף ליום הצילום עם נטלי' },
    { id: 'simeonJoin', name: 'צירוף סמיון ליום הצילום עם נטלי', bool: true, detail: 'סמיון מגיע יחד עם נטלי ליום הצילום או להקלטת הפודקאסט. בלי קולאב. סטורי אצל סמיון מוסיפים בנפרד.' },
    { id: 'extraCh14', name: 'אייטם נוסף בערוץ 14', bool: true, detail: 'במקרים חריגים בלבד' },
  ],
};

// The old page's sums: '₪' and the number as Hebrew writes it (its ILS and ILS0).
const num = (v) => (typeof v === 'number' ? v : Number(String(v ?? '').replace(/[\s,₪]/g, '')) || 0);
export const ils = (n) => `₪${num(n).toLocaleString('he-IL')}`;
const ils0 = (n) => `₪${Math.round(num(n)).toLocaleString('en-US')}`;
const str = (v) => (typeof v === 'string' ? v.trim() : typeof v === 'number' && Number.isFinite(v) ? String(v) : '');
const strs = (v) => (Array.isArray(v) ? v.map((x) => (typeof x === 'string' ? x : str(x?.text ?? x?.name ?? ''))).filter((x) => x && x.trim()) : []);
const has = (v) => v !== undefined && v !== null && v !== '' && v !== 0 && v !== '0' && v !== false;
const B = (x) => ({ b: String(x) });

// lib/catalog.js catPaid / catPaidList / catLines.
function paidOf(cat) {
  const p = cat?.paid;
  const o = {};
  if (Array.isArray(p)) { for (const id of p) o[id] = (o[id] || 0) + 1; return o; }
  for (const [id, q] of Object.entries(p && typeof p === 'object' ? p : {})) if (Number(q) > 0) o[id] = Math.round(Number(q));
  return o;
}
const paidList = (cat) => Object.entries(paidOf(cat)).map(([id, qty]) => { const a = OLD.paidAddons.find((x) => x.id === id); return a && { addon: a, qty }; }).filter(Boolean);
const linesOf = (cat) => (Array.isArray(cat?.lines) ? cat.lines : []).map((l) => ({
  name: String(l?.name || '').slice(0, 120).trim(), detail: String(l?.detail || '').slice(0, 300).trim(),
  price: Math.round(Number(l?.price) || 0), kind: l?.kind === 'once' ? 'once' : 'monthly', qty: Math.max(1, Math.round(Number(l?.qty) || 1)),
}));

// server.js docView(): the tiles, the add-ons and the price table, from the record alone.
export function docView(ct) {
  const out = {};
  if (ct.docType === 'termination' || ct.docType === 'addendum') return out;
  const pod = ct.contractType === 'podcast';
  const specs = [];
  if (has(ct.shootDays)) specs.push({ n: ct.shootDays, l: Number(ct.shootDays) === 1
    ? (pod ? 'יום הקלטה בחדר הפודקאסט' : ct.atBusiness ? 'יום צילום בבית העסק' : 'יום צילום')
    : (pod ? 'ימי הקלטה בחדר הפודקאסט' : ct.atBusiness ? 'ימי צילום בבית העסק' : 'ימי צילום') });
  if (has(ct.reels)) specs.push({ n: ct.reels, l: pod ? 'סרטוני פודקאסט' : 'סרטונים' });
  if (has(ct.sketches) && typeof ct.sketches !== 'object') specs.push({ n: ct.sketches, l: 'מערכונים' });
  if (has(ct.graphics)) specs.push({ n: ct.graphics, l: 'גרפיקות' });
  const cat = ct.catalog && typeof ct.catalog === 'object' ? ct.catalog : null;
  const pkg = cat && OLD.packages[`${cat.tier}-${cat.influencer}`];
  if (pkg) {
    for (const line of pkg.includes) {
      const m = /^(\d+)\s+(.+)$/.exec(line);
      if (m && !/סרטונ|גרפיק/.test(m[2])) specs.push({ n: Number(m[1]), l: m[2] });
    }
    out.paidAddons = paidList(cat).map(({ addon: a, qty }) => ({
      name: a.name + (qty > 1 ? ` × ${qty}` : ''), detail: a.detail || '', price: a.price * qty,
      unitNote: qty > 1 ? `${ils0(a.price)} ליחידה` : '',
    }));
    out.freeAddons = Object.entries(cat.free && typeof cat.free === 'object' ? cat.free : {}).filter(([, v]) => v).map(([fid, v]) => {
      const f = OLD.freeAddons.find((x) => x.id === fid);
      return f && { name: f.name + (f.bool ? '' : ` · ${v} ${f.unit || ''}`), detail: f.detail || '' };
    }).filter(Boolean);
    const rows = [{ label: `חבילה · ${OLD.tiers[cat.tier] || ''}`, month: pkg.price }];
    for (const a of out.paidAddons) rows.push({ label: a.name, month: a.price });
    const lines = linesOf(cat);
    for (const l of lines.filter((x) => x.kind === 'monthly')) rows.push({ label: (l.qty > 1 ? `${l.qty} × ` : '') + l.name, month: l.price * l.qty });
    if (Number(cat.discount)) rows.push({ label: 'הנחה', month: -Number(cat.discount), neg: true });
    out.priceRows = rows;
    const once = lines.filter((x) => x.kind === 'once');
    if (once.length) {
      out.onceRows = once.map((l) => ({ label: (l.qty > 1 ? `${l.qty} × ` : '') + l.name, detail: l.detail, price: l.price * l.qty }));
      const net = out.onceRows.reduce((a, r) => a + r.price, 0);
      out.onceTotals = { net, vat: Math.round(net * OLD.vat / 100), gross: Math.round(net * (1 + OLD.vat / 100)), vatPct: OLD.vat };
    }
  } else if (has(ct.retainer)) {
    out.priceRows = [{ label: `חבילה · ${str(ct.packageName) || 'ALL IN ONE'}`, month: num(ct.retainer) }];
  }
  if (out.priceRows && !has(ct.oneTimeNet)) {
    const net = out.priceRows.reduce((a, r) => a + r.month, 0);
    const months = num(ct.months) || OLD.termMonths;
    out.priceTotals = { net, vat: Math.round(net * OLD.vat / 100), gross: Math.round(net * (1 + OLD.vat / 100)), months, vatPct: OLD.vat };
  }
  out.specs = specs;
  return out;
}

// The old page's title (docHead).
export function titleOf(c) {
  if (c.docType === 'quote') return 'הצעת מחיר';
  if (c.docType === 'termination') return 'הסכם סיום התקשרות';
  if (c.docType === 'addendum') return 'נספח להסכם';
  return c.contractType === 'podcast' ? 'הסכם פודקאסט' : 'הסכם התקשרות';
}

// The record's own clauses ({ title, body }; the new system's import kept `text` too).
const clausesOf = (v) => (Array.isArray(v) ? v : []).filter((c) => typeof c === 'string' || (c && typeof c === 'object'))
  .map((c) => (typeof c === 'string' ? { title: '', body: c } : { title: str(c.title), body: typeof c.body === 'string' ? c.body : typeof c.text === 'string' ? c.text : '' }))
  .filter((c) => c.title || c.body.trim());
const clauseParts = (list) => list.flatMap((c) => [c.title ? { type: 'h4', text: c.title } : null, c.body.trim() ? { type: 'p', lines: c.body.split('\n') } : null].filter(Boolean));

// sign.html defaultTerms(): the agreement's six clauses.
export function defaultTerms(c, months) {
  const once = has(c.oneTimeNet);
  const pay = str(c.paymentMethod);
  return [
    { type: 'h4', text: '1. תקופת ההסכם' },
    { type: 'p', lines: [
      `1.1 ההתקשרות הינה לתקופה קצובה של ${months} חודשים מיום החתימה על הצעת המחיר/ההסכם (להלן: "תקופת ההתקשרות").`,
      `1.2 אין אפשרות לסיים את ההתקשרות לפני תום ${months} החודשים, מכל סיבה שהיא, וזאת מאחר שאסטרטג מתחילה בהעלאת התכנים לרשתות החברתיות עד 30 ימי עסקים מיום הצילום, בכפוף לאמור בסעיף 3 להלן.`] },
    { type: 'h4', text: '2. התמורה ותנאי תשלום' },
    once
      ? { type: 'p', lines: [
        `2.1 התמורה עבור החבילה, לכל ${months} חודשי ההתקשרות, הינה ${ils(c.oneTimeNet)} + מע״מ כחוק${has(c.totalAmount) ? ` (${ils(c.totalAmount)} כולל מע״מ)` : ''}.`,
        `2.2 התמורה תשולם בתשלום חד פעמי${pay ? `, באמצעות ${pay}` : ''}, עם חתימת ההסכם.`,
        '2.3 התמורה משולמת עבור כל תקופת ההתקשרות ולא תוחזר, גם אם הלקוח יבחר להפסיק את פעילותו העסקית או את השימוש בתוצרים בטרם עת.'] }
      : { type: 'p', lines: [
        `2.1 התמורה עבור החבילה הינה ${has(c.retainer) ? `${ils(c.retainer)} לחודש + מע״מ כחוק, למשך ${months} חודשים` : `${ils(c.totalAmount)} כולל מע״מ`}.`,
        `2.2 התשלום יתבצע ${pay ? `באמצעות ${pay}` : 'בחיוב חודשי שוטף'}, ללא תפיסת מסגרת.`,
        `2.3 הלקוח מתחייב בזאת לתשלום מלוא ${months} התשלומים החודשיים, גם אם יבחר להפסיק את פעילותו העסקית או את השימוש בתוצרים בטרם עת. אי עמידה באחד התשלומים תעמיד את מלוא יתרת החוב לפירעון מיידי.`] },
    { type: 'h4', text: '3. לוחות זמנים ותכני הלקוח' },
    { type: 'p', lines: [
      '3.1 הלקוח מתחייב לספק לאסטרטג את כל המידע, התכנים, הלוגואים, ההנחיות והחומרים הנדרשים לצורך ההפקה, תוך 14 ימי עסקים מיום חתימת ההסכם.',
      '3.2 איחור מצד הלקוח במסירת התכנים עלול לגרום לעיכוב בהפקת התוצרים; במקרה כזה, המועד של 30 ימי העסקים לתחילת העלאת התכנים לא יחייב את אסטרטג, והעיכוב לא ייחשב כהפרה מצד אסטרטג.',
      '3.3 אסטרטג מתחייבת להתחיל בהעלאת התכנים לרשתות החברתיות עד 30 ימי עסקים מיום הצילום, בכפוף לעמידת הלקוח בחובותיו לפי סעיף 3.1.'] },
    { type: 'h4', text: '4. תיקונים ואישורים' },
    { type: 'p', lines: [
      '4.1 לכל תוצר כלול סבב תיקון אחד.',
      '4.2 כל תיקון נוסף (מעבר לסבב האחד) יוגדר כעבודה נוספת בתשלום, על פי הצעת מחיר שתימסר ללקוח מראש.',
      '4.3 אי מתן מענה/אישור מסודר מצד הלקוח בתוך זמן סביר (עד 7 ימי עסקים מקבלת התוצרים) ייחשב כאישור התוצר, ואסטרטג תהיה רשאית להמשיך הלאה בתהליך ההפקה.'] },
    { type: 'h4', text: '5. אחריות ותוצאות פרסומיות' },
    { type: 'p', lines: [
      '5.1 אסטרטג אחראית על הפקת התוצרים לפי ההסכמה המקצועית בין הצדדים, אך אינה מתחייבת לכמות לידים, מכירות, פניות, צפיות, חשיפות או כל תוצאה עסקית/כספית אחרת.',
      '5.2 הלקוח מודע לכך שתוצאות פרסום מושפעות מפרמטרים רבים שאינם בשליטת אסטרטג (שוק, תחרות, תקציב מדיה, אלגוריתמים של פלטפורמות וכו׳).'] },
    { type: 'h4', text: '6. שונות' },
    { type: 'p', lines: [
      '6.1 כל שינוי או תוספת להסכם זה יהיה בתוקף רק אם נעשה בכתב ונחתם על ידי שני הצדדים.',
      '6.2 הדין החל על ההתקשרות הוא הדין הישראלי בלבד.'] },
  ];
}

// sign.html terminationHtml(): the parties, the recitals, the money and the clauses.
function termination(c) {
  const t = (c.termination && typeof c.termination === 'object' ? c.termination : null) || (c.doc && typeof c.doc === 'object' ? c.doc : {});
  const signers = Array.isArray(c.signers) ? c.signers.map((s) => str(s?.name)).filter(Boolean) : [];
  const client = signers.length ? signers.join(', ') : str(c.clientName) + (str(c.business) ? `, ${str(c.business)}` : '');
  const sections = [{ title: null, parts: [{ type: 'p', lines: [
    ['בין: ', B(str(t.companyName) || 'אסטרטג טכנולוגיות בע״מ'), ' (להלן: "אסטרטג")'],
    ['לבין: ', B(client), ' (להלן: "הלקוח")'],
  ] }] }];
  const recitals = strs(t.recitals);
  if (recitals.length) sections.push({ title: null, parts: [...recitals.map((r) => ({ type: 'p', text: r })), ...(t.noWhereas ? [] : [{ type: 'p', text: [B('לפיכך הוסכם והותנה בין הצדדים כדלקמן:')] }])] });
  const rows = (Array.isArray(t.rows) ? t.rows : []).filter((r) => r && typeof r === 'object');
  if (rows.length) sections.push({ title: 'סיכום כספי', parts: [{ type: 'table', head: null, rows: rows.map((r) => ({ cells: [str(r.label), str(r.value)], cls: r.total ? 'total' : '' })) }] });
  const clauses = clausesOf(c.customClauses);
  if (clauses.length) sections.push({ title: null, terms: true, parts: clauseParts(clauses) });
  return { kind: 'termination', title: titleOf(c), sections };
}

// sign.html contractHtml(): the whole contract (or price offer).
export function fullDoc(c) {
  if (!c || typeof c !== 'object') return null;
  if (c.docType === 'termination' || c.docType === 'addendum') return termination(c);
  const v = docView(c);
  const months = num(c.months) || 12;
  const isQuote = c.docType === 'quote';
  const inf = str(c.influencers);
  const withInf = inf ? [' עם ', B(inf)] : [];
  const pod = c.contractType === 'podcast';
  const room = c.atBusiness ? ' בבית העסק' : pod ? ' בחדר פודקאסט' : '';
  const list = [];
  const pb = strs(c.packageBullets);
  if (pb.length) list.push(...pb);
  else {
    if (Number(c.shootDays) === 1) list.push([`יום צילום מקצועי ומרוכז${room}`, ...withInf]);
    else if (has(c.shootDays)) list.push([B(c.shootDays), ` ימי צילום מקצועיים ומרוכזים${room}`, ...withInf]);
    else if (inf) list.push([`יום צילום מקצועי ומרוכז${room}`, ...withInf]);
    if (has(c.contentTotal)) list.push([`${Number(c.shootDays) > 1 ? 'בימי הצילום' : 'ביום הצילום'} יופקו `, B(c.contentTotal), ' תכנים חדשים', ...(inf ? [' בהשתתפות ', B(inf)] : [])]);
    if (has(c.reels)) list.push(pod ? ['מתוכם ', B(c.reels), ' סרטוני פודקאסט מקצועיים'] : ['מתוכם ', B(c.reels), ' סרטוני רילס מקוריים וטרנדיים לרשתות החברתיות']);
    if (has(c.sketches) && typeof c.sketches !== 'object') list.push(['מתוכם ', B(c.sketches), ' מערכונים קריאייטיביים בתסריט ובהפקה מלאה']);
    if (has(c.graphics)) list.push(['מתוכם ', B(c.graphics), ' גרפיקות בהתאמה אישית עם עיצוב מקצועי וממיר']);
  }
  const items = list.map((text) => ({ text }));
  for (const eb of strs(c.extraBullets)) items.push({ text: eb, star: true });
  const extraTeam = strs(c.extraTeam);
  const extraSocial = strs(c.extraSocial);

  const sections = [];
  sections.push({ title: ['מי אנחנו - ', B('אסטרטג+')], parts: [{ type: 'p', text: 'אסטרטג היא חברת פרסום ושיווק דיגיטלי המתמחה בליווי עסקים - מהעצמאיים והעסקים הקטנים ועד חברות גדולות ומותגים מובילים. אנחנו משלבים חשיבה אסטרטגית, קריאייטיב חד ותפעול שוטף של התוכן ברשתות החברתיות, מתוך מטרה אחת: להפוך נוכחות דיגיטלית לתוצאות עסקיות.' }] });
  const pkgParts = [{ type: 'h3', text: str(c.contentHeading) || 'הפקת תוכן וידאו מקיפה:' }, { type: 'ul', items }];
  if (!c.noServices) {
    pkgParts.push({ type: 'h3', text: 'צוות הפקה וקריאייטיב:' }, { type: 'ul', items: [
      'כתיבת תוכן וקריאייטיב לכלל הסרטונים',
      'צלמי וידאו מקצועיים עם ציוד הפקה וצילום מהמתקדמים שיש',
      'עריכת וידאו מקצועית (כולל סבב תיקונים אחד לכל תוצר)',
      ...(pod && !extraTeam.length ? ['חדר פודקאסט מקצועי המעוצב לצילומים ברמה גבוהה'] : []),
      ...extraTeam,
    ].map((text) => ({ text })) });
    pkgParts.push({ type: 'h3', text: 'ניהול סושיאל מדיה:' }, { type: 'ul', items: [
      'מנהל תיק לקוחות הכולל קשר יום-יומי ומענה לכל שאלה',
      'ניהול סושיאל מקצועי בדפים העסקיים של בית העסק (אינסטגרם, פייסבוק וטיקטוק)',
      'העלאת התכנים מימי הצילום לדפים העסקיים',
      'ניהול פרסום ממומן של בית העסק ברשתות החברתיות',
      'שיפור הנראות של העמודים העסקיים',
      ...(pod && !extraSocial.length ? ['ניהול קידום ממומן בגוגל'] : []),
      ...extraSocial,
    ].map((text) => ({ text })) });
  }
  sections.push({ title: 'מה כוללת החבילה', parts: pkgParts });

  const kpis = [];
  if (has(c.oneTimeNet)) kpis.push({ n: ils(c.oneTimeNet), l: isQuote ? 'סה״כ + מע״מ' : 'תשלום חד פעמי + מע״מ' });
  else if (has(c.retainer)) kpis.push({ n: ils(c.retainer), l: 'לחודש + מע״מ' });
  if (has(c.totalAmount)) kpis.push({ n: ils(c.totalAmount), l: 'סה״כ כולל מע״מ' });
  if (!c.noMonths) kpis.push({ n: String(months), l: 'חודשי התקשרות' });
  if (v.onceTotals) kpis.push({ n: ils(v.onceTotals.net), l: 'תשלום חד פעמי + מע״מ' });
  if (has(c.contentTotal)) kpis.push({ n: String(c.contentTotal), l: 'תכנים' });
  sections.push({ title: 'פירוט החבילה', parts: [{ type: 'kpis', items: kpis }, ...(v.specs?.length ? [{ type: 'tiles', items: v.specs.map((x) => ({ n: String(x.n), l: x.l })) }] : [])] });

  if (v.paidAddons?.length) sections.push({ title: 'תוספות בתשלום', parts: [{ type: 'addons', items: v.paidAddons.map((a) => ({ name: a.name, detail: a.detail, amount: ils(a.price), note: a.unitNote ? `${a.unitNote} · לחודש` : 'לחודש' })) }] });
  if (v.freeAddons?.length) sections.push({ title: 'הטבות ללא עלות', parts: [{ type: 'addons', items: v.freeAddons.map((a) => ({ name: a.name, detail: a.detail, free: true })) }] });

  if (v.priceTotals && v.priceRows?.length) {
    const t = v.priceTotals;
    const m = t.months;
    const money = (x) => (x < 0 ? `−${ils(-x)}` : ils(x));
    const row = (label, month, cls = '') => ({ cells: [label, money(month), money(month * m)], cls });
    sections.push({ title: 'פירוט מחיר', parts: [{ type: 'table', head: ['פריט', 'לחודש', `ל-${m} חודשים`], rows: [
      ...v.priceRows.map((r) => row(r.label, r.month, r.neg ? 'neg' : '')),
      row('סה״כ לפני מע״מ', t.net, 'sub'), row(`מע״מ ${t.vatPct}%`, t.vat), row('סה״כ כולל מע״מ', t.gross, 'tot'),
    ] }] });
  }
  if (v.onceRows?.length) {
    const t = v.onceTotals;
    sections.push({ title: 'תשלום חד פעמי', parts: [{ type: 'table', head: ['פריט', 'סכום'], rows: [
      ...v.onceRows.map((r) => ({ cells: [r.label, ils(r.price)], detail: r.detail || '' })),
      { cells: ['סה״כ לפני מע״מ', ils(t.net)], cls: 'sub' }, { cells: [`מע״מ ${t.vatPct}%`, ils(t.vat)] }, { cells: ['סה״כ כולל מע״מ', ils(t.gross)], cls: 'tot' },
    ] }] });
  }

  const db = strs(c.detailBullets);
  const summary = str(c.paymentSummary);
  sections.push({ title: isQuote ? 'תנאי ההצעה' : 'דגשים', parts: [{ type: 'ul', items: (db.length ? db : [
    summary || (has(c.oneTimeNet) ? `תשלום חד פעמי של ${ils(c.oneTimeNet)} + מע״מ, עבור כל תקופת ההתקשרות.` : 'התשלום הוא חודשי, למשך כל תקופת ההתחייבות.'),
    'תחילת העלאת התכנים לרשתות החברתיות - עד 30 ימי עסקים מיום הצילום.',
    'לכל תוצר כלול סבב תיקון אחד במסגרת המחיר.',
  ]).map((text) => ({ text })) }] });

  const clauses = clausesOf(c.customClauses);
  const notes = str(c.notes);
  sections.push({ title: isQuote ? 'תנאי ההצעה' : 'הסכם התקשרות ותנאים', terms: true, parts: [
    ...(clauses.length ? clauseParts(clauses) : defaultTerms(c, months)),
    ...(notes ? [{ type: 'h4', text: 'הערות נוספות' }, { type: 'p', lines: notes.split('\n') }] : []),
  ] });
  return { kind: 'contract', title: titleOf(c), sections };
}
