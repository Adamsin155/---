// Process 6 in "המשימות שלי" (app/clients.js): the check of the client's logins and the
// page setup, laid out the way Ilai's characterization-day card had it (until 28.10.2026,
// when the owner moved the whole process to Ofir: "להוריד מעילאי את כל עניין הגישות לרשתות,
// זה צריך לעבור לאופיר"). The card of 6 opens onto two short parts instead of a list of
// nine lines:
//   בדיקת הגישות  the client's logins with their statuses (never a password), "לכספת", and
//                 the check itself, new networks and Metricool;
//   סידור העמוד   the six quick checks, two a row on a wide screen.
// (Until protocol v14 the statuses in the vault checked the access by themselves. Since v14, 6 is
// one mark, p06.ok, for the check, the pages and Metricool: the statuses only say how far it is.)
// Each line is the list's own row (its tick, its guard, its undo): the caller hands it in.
import { h } from './protocol-ui.js';
import { canUseVault } from './protocol-data.js';
import { loadAccessStatusForWork } from './office-data.js';
import { ACCESS_STATUS_LABEL, NEW_STATUS } from './access-logic.js';
import { NETWORKS } from './protocol.js';
import { PAGE_KEYS, PAGE_LABELS, ACCESS_KEYS, accessChecked } from './access-check.js';

const baseKey = (key) => String(key || '').replace(/^r\d+\./, '');
const isDone = (cs, k) => ['done', 'na'].includes(cs?.[k]?.state);
const networkName = (k) => NETWORKS.find(([n]) => n === k)?.[1] || k;
const clientUrl = (id, hash = '') => `client.html?id=${encodeURIComponent(id)}${hash ? `#${hash}` : ''}`;

// A card of process 6 with something of the check or of the pages in it.
export const isAccessCard = (g) => !g.task && String(g.proc?.id || '') === 'p06'
  && g.entries.some((e) => !e.fields && [...ACCESS_KEYS, ...PAGE_KEYS].includes(baseKey(e.item?.key)));

// The logins of the clients on the list: statuses only (network, label, status), which the
// office reads without the vault flag; kept a minute, read for all the cards at once.
// Whether this person may open the passwords (staff.vault) is asked once.
const access = new Map(); // client id → rows
let vault = null; // null until known
let viaVault = false; // the statuses came from the vault's own rows (before the migration)
let loadedAt = 0;
let loadedFor = '';
let loading = null;
const wanted = new Set();
let queued = false;

function want(id, refresh) {
  wanted.add(id);
  if (queued) return;
  queued = true;
  queueMicrotask(() => {
    queued = false;
    const ids = [...wanted].sort();
    const key = ids.join(',');
    if (!ids.length || loading || (key === loadedFor && Date.now() - loadedAt < 60e3)) return;
    if (vault === null) canUseVault().then((v) => { vault = v; if (!v) refresh?.(); }).catch(() => {});
    loading = loadAccessStatusForWork(ids).then((rows) => {
      access.clear();
      viaVault = !!rows.viaVault;
      for (const r of rows) {
        if (!access.has(r.client_id)) access.set(r.client_id, []);
        access.get(r.client_id).push(r);
      }
    }).catch(() => {}).finally(() => { loadedAt = Date.now(); loadedFor = key; loading = null; refresh?.(); });
  });
}

// Reads the statuses of this card's client. (Until protocol v14 it also marked "the logins were
// checked", p06.verified, once every login in the vault had a status. Since v14, 6 is one mark,
// p06.ok, which is also the page setup and Metricool: the statuses no longer close it, they are
// shown as "כל הרשתות בכספת קיבלו סטטוס".)
export function watchAccess(g, { refresh } = {}) {
  if (!isAccessCard(g)) return;
  want(g.client.id, refresh);
}

// The panel of the card: the two parts, then whatever else of 6 is on it (Lior's
// recovered logins, on the owners' view of the whole team). `row(e, label)` is the list's
// row of one entry, with a shorter label where one is given.
export function accessPanel(g, { checks, row }) {
  if (!isAccessCard(g)) return null;
  const c = g.client;
  const cs = checks || {};
  const entries = g.entries.filter((e) => !e.fields);
  const of = (keys) => keys.map((k) => entries.find((e) => baseKey(e.item.key) === k)).filter(Boolean);
  const checksPart = of(ACCESS_KEYS);
  const pagePart = of(PAGE_KEYS);
  const rest = entries.filter((e) => !checksPart.includes(e) && !pagePart.includes(e));
  const rows = access.get(c.id) || [];
  const known = loadedFor.split(',').includes(c.id);
  const waiting = !['p05.access', 'p05.got'].some((k) => cs[k]?.state === 'done');
  const pageDone = PAGE_KEYS.filter((k) => isDone(cs, k)).length;
  const verified = isDone(cs, 'p06.ok') || isDone(cs, 'p06.verified');
  const firstAccess = ['p05.access', 'p05.got'].map((k) => cs[k]).filter((x) => x?.state === 'done').map((x) => x.at).sort()[0];
  const allSet = !verified && known && accessChecked(rows, firstAccess);
  return h('div', { class: 'ac-panel' },
    checksPart.length || verified ? h('div', { class: 'il-part ac-part ac-access' },
      h('h4', {}, 'בדיקת הגישות',
        verified ? h('span', { class: 'sbadge s-done' }, h('span', { class: 'sicon', 'aria-hidden': 'true' }), 'נבדק') : null),
      waiting ? h('p', { class: 'hint' }, 'מחכה לגישות מהאפיון.') : [
        rows.length ? h('ul', { class: 'il-net ac-net', 'aria-label': `הגישות של ${c.name} בכספת` }, ...rows.map((a) => h('li', { class: `tag${a.status === 'broken' || a.status === NEW_STATUS ? ' tag-warn' : ''}` },
          // The network's name is isolated, so a Latin name reads right to left with its status.
          h('bdi', {}, `${a.network === 'other' && a.label ? a.label : networkName(a.network)}${a.label && a.network !== 'other' ? ` (${a.label})` : ''}`), `: ${ACCESS_STATUS_LABEL[a.status] || a.status}`)))
          : !known || (vault === false && viaVault) ? null : h('p', { class: 'hint' }, 'אין עדיין רשתות בכספת.'),
        rows.some((a) => a.status === NEW_STATUS)
          ? h('p', { class: 'hint ac-fromclient' }, 'יש גישות שהלקוח מילא בעצמו ועוד לא נבדקו: מנסים להיכנס, ומעדכנים בכספת ״תקינה״ או ״לא עובדת״.')
          : null,
        verified ? null : h('p', { class: 'hint' }, allSet ? 'כל הרשתות בכספת קיבלו סטטוס. נשאר לסדר את העמודים ולחבר ל־Metricool, ולסמן.'
          : 'בודקים כל רשת מהכספת ומעדכנים לה סטטוס, מסדרים את העמודים (שם, Bio, פרטים, טלפון, כתובת, מראה) ומחברים ל־Metricool. אין עמוד? פותחים אותו באותו חלון זמן.'),
        vault === false
          ? h('p', { class: 'hint ac-novault' }, 'אין לך גישה לסיסמאות בכספת. בעל המשרד מפעיל אותה בעמוד הצוות.')
          : h('div', { class: 'of-acts' }, h('a', { class: 'btn btn-sm ac-vault', href: clientUrl(c.id, 'access') }, 'לכספת', h('span', { class: 'sr-only' }, ` של ${c.name}`))),
      ],
      checksPart.length ? h('ul', { class: 'wlist ac-list' }, ...checksPart.map((e) => row(e))) : null) : null,
    pagePart.length ? h('div', { class: 'il-part ac-part ac-page' },
      h('h4', {}, 'סידור העמוד', h('span', { class: 'muted ac-count' }, h('bdi', { dir: 'ltr', class: 'num' }, `${pageDone}/${PAGE_KEYS.length}`))),
      h('ul', { class: 'wlist ac-list ac-grid' }, ...pagePart.map((e) => row(e, PAGE_LABELS[baseKey(e.item.key)])))) : null,
    rest.length ? h('ul', { class: 'wlist' }, ...rest.map((e) => row(e))) : null);
}
