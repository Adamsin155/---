// Process 6 in "המשימות שלי" (app/clients.js): the check of the client's logins and the
// page setup, laid out the way Ilai's characterization-day card had it (until 28.10.2026,
// when the owner moved the whole process to Ofir: "להוריד מעילאי את כל עניין הגישות לרשתות,
// זה צריך לעבור לאופיר"). The card of 6 opens onto two short parts instead of a list of
// nine lines:
//   בדיקת הגישות  the client's logins with their statuses (never a password), "לכספת", and
//                 the check itself, new networks and Metricool;
//   סידור העמוד   the six quick checks, two a row on a wide screen.
// The statuses in the vault check the access by themselves (AUTO_ACCESS_NOTE), as the
// client card's vault does: once every login has a status set after the access came in.
// Each line is the list's own row (its tick, its guard, its undo): the caller hands it in.
import { h, toast } from './protocol-ui.js';
import { setCheck, canUseVault } from './protocol-data.js';
import { loadAccessStatusForWork } from './office-data.js';
import { ACCESS_STATUS_LABEL, NEW_STATUS } from './access-logic.js';
import { NETWORKS } from './protocol.js';
import { PAGE_KEYS, PAGE_LABELS, ACCESS_KEYS, AUTO_ACCESS_NOTE, accessChecked } from './access-check.js';

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
const autoTried = new Set();

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

// Reads the statuses of this card's client, and marks the check when the vault says it is
// done. `mayMark`: whoever may write process 6 (the office; Ilai and the editors never get
// here). `onMarked(row)`: the list keeps the new mark and draws again.
export function watchAccess(g, { checks, mayMark, onMarked, refresh }) {
  if (!isAccessCard(g)) return;
  const c = g.client;
  want(c.id, refresh);
  const cs = checks || {};
  const got = cs['p05.access'];
  if (!mayMark || isDone(cs, 'p06.verified') || got?.state !== 'done' || autoTried.has(c.id)) return;
  if (!loadedFor.split(',').includes(c.id) || !accessChecked(access.get(c.id) || [], got.at)) return;
  autoTried.add(c.id);
  setCheck(c.id, 'p06.verified', 'done', AUTO_ACCESS_NOTE).then((row) => {
    toast(`הגישות של ${c.name} סומנו כנבדקו, לפי הסטטוסים בכספת.`);
    onMarked?.(row);
  }).catch(() => { /* the check stays to be marked by hand */ });
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
  const waiting = cs['p05.access']?.state !== 'done';
  const pageDone = PAGE_KEYS.filter((k) => isDone(cs, k)).length;
  const verified = isDone(cs, 'p06.verified');
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
        verified ? null : h('p', { class: 'hint' }, 'הסטטוס של כל רשת בכספת מסמן את הבדיקה לבד. אין עמוד? פותחים אותו באותו חלון זמן.'),
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
