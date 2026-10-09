// The worst-case offices of tests/visual-sweep.mjs (docs/ops.md, section 55), on top of
// tests/late-world.mjs (same Tuesday, 20.10.2026, 10:00 in Israel; every name is invented):
//   worstWorld  very long Hebrew business and contact names, a long unbroken URL and email,
//               one line that mixes Hebrew, English, digits and signs, big numbers, 60+ tasks
//               for one person, 45 more clients, and a client with every flag at once
//               (new, urgent, late; once in landing and once with a clock);
//   emptyWorld  the staff and nothing else (0 clients, 0 tasks, 0 deals);
//   oneWorld    one client, one task.
import { NOW, SUPA, ROLES, emailOf, lateWorld, makeFlowFake, cid } from "./late-world.mjs";

export { NOW, SUPA, ROLES, emailOf, makeFlowFake, cid };

export const LONG_BUSINESS = "המרכז הבינתחומי לרפואה משלימה, פיזיותרפיה ושיקום ספורטיבי בע״מ, סניף קריית־שמונה והגליל העליון (לשעבר ״בריאות פלוס 24/7״)";
export const LONG_NAME = "אלכסנדרה־מרגריטה ויינשטיין־בן־אברהם דה לה פואנטה";
export const UNBROKEN = "Supercalifragilisticexpialidocious_Unbroken_Business_Name_1234567890_ABCDEFGHIJKLMNOP";
export const LONG_URL = "https://www.example-very-long-domain-name-for-testing.co.il/path/to/a/very/long/resource/that/never/breaks?utm_source=newsletter&utm_campaign=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
export const LONG_EMAIL = "alexandra.margarita.weinstein-ben-avraham.de.la.fuente@very-long-subdomain.example-company-name.co.il";
export const MIXED = "קמפיין Black Friday 2026 ל-iPhone 17 Pro Max (50%-) עד 23:59, מק״ט #A-1029/B, טל׳ +972-50-1234567";
export const EVERY_FLAG = cid(91);          // new, urgent and late, with a clock
export const EVERY_FLAG_LANDING = cid(90);  // the same, still in landing
const TITLES = [
  "לשלוח ללקוח את קובץ הכתוביות",
  `לבדוק עם הלקוח את ${MIXED}`,
  `להעלות את הקבצים ל־${LONG_URL}`,
  "קצר",
  `לתאם שיחה עם ${LONG_NAME} בנושא החידוש, כולל מעבר על כל התוצרים של השנה האחרונה, ההערות הפתוחות, לוח הפרסום לרבעון הבא והצעת המחיר המעודכנת`,
];

export function worstWorld(opts) {
  const db = lateWorld(opts);
  const c = (n) => db.clients.find((x) => x.id === cid(n));
  const at = (min) => new Date(NOW.getTime() - min * 60e3).toISOString();
  Object.assign(c(4), { business: LONG_BUSINESS, name: LONG_NAME, address: `רחוב ${LONG_NAME} 1234, קומה 17, כניסה ב׳, ${LONG_BUSINESS}`, phone: "+972-50-1234567",
    notes: `${LONG_URL} ${LONG_EMAIL} ${MIXED}`, links: { drive: LONG_URL, scripts: LONG_URL, gantt: LONG_URL },
    package_name: "Social + TV all in one · סמיון, מישל ודניס · כולל 3 ימי צילום נוספים, 12 סטוריז, ליווי קמפיינים ועמוד נחיתה", deliverables: { videos: 12345, graphics: 987654, shoot_days: 365 } });
  Object.assign(c(12), { business: UNBROKEN, name: MIXED, notes: LONG_EMAIL, links: { drive: LONG_URL } });
  Object.assign(c(7), { business: MIXED, name: LONG_NAME, address: LONG_URL });
  Object.assign(c(17), { business: `${LONG_BUSINESS} ${UNBROKEN}`, name: LONG_NAME });
  Object.assign(c(15), { business: LONG_BUSINESS, name: LONG_NAME });
  const base = c(12);
  const copyChecks = (from, to) => { for (const k of db.protocol_checks.filter((x) => x.client_id === from)) db.protocol_checks.push({ ...k, client_id: to }); };
  // Every flag at once: made ten minutes ago, an urgent task that is days late; in landing and not.
  for (const [id, landing] of [[EVERY_FLAG, false], [EVERY_FLAG_LANDING, true]]) {
    db.clients.push({ ...base, id, business: `${LONG_BUSINESS} (כל הדגלים${landing ? ", בקליטה" : ""})`, name: LONG_NAME, editor: "nadia", landing,
      created_at: at(10), deal_at: at(10), created_by_email: landing ? "system" : emailOf("irit"), rounds: [], links: { drive: LONG_URL }, notes: MIXED });
    copyChecks(base.id, id);
  }
  // 45 more clients: the list of an office person passes 60 rows.
  for (let i = 0; i < 45; i += 1) {
    const src = db.clients[i % 21];
    const id = cid(100 + i);
    db.clients.push({ ...src, id, business: i % 3 === 0 ? `${LONG_BUSINESS} ${i}` : i % 3 === 1 ? `${MIXED} ${i}` : `לקוח ${i}`, name: i % 2 ? LONG_NAME : `איש קשר ${i}`, rounds: [], links: {} });
    copyChecks(src.id, id);
  }
  // 64 open tasks for each of the people who have a list, of every length and age.
  let n = 500;
  const people = ["irit", "lior", "ofir", "ilai", "nadia", "nirel"];
  for (const owner of people) {
    for (let i = 0; i < 64; i += 1) {
      n += 1;
      const client = owner === "nadia" ? [cid(12), cid(13), EVERY_FLAG][i % 3] : owner === "nirel" ? cid(15) : [EVERY_FLAG, EVERY_FLAG_LANDING, cid(4), cid(12), cid(7), cid(17)][i % 6];
      db.client_tasks.push({ id: `d0000000-0000-4000-8000-${String(n).padStart(12, "0")}`, client_id: client, title: `${TITLES[i % TITLES.length]} (${i + 1})`, owner,
        due_on: i % 4 === 0 ? "2026-10-12" : i % 4 === 1 ? "2026-10-20" : i % 4 === 2 ? "2026-10-21" : null, done_at: null, created_at: at(60 * (i + 1)),
        created_by_email: emailOf("irit"), source: i % 16 === 5 ? "escalation" : null, urgent: i % 8 === 0, started_at: null });
    }
  }
  for (let i = 0; i < 6; i += 1) {
    db.deal_requests.push({ ...db.deal_requests[0], id: `e0000000-0000-4000-8000-${String(900 + i).padStart(12, "0")}`, business_name: i % 2 ? LONG_BUSINESS : UNBROKEN, contact_name: LONG_NAME,
      phone: "+972-50-1234567", discount_agorot: 99999999900, notes: `${LONG_URL} ${MIXED}`, created_at: at(5 + i), status: i < 4 ? "pending" : "sent", sent_at: i < 4 ? null : at(3) });
  }
  for (const s of db.client_scripts) Object.assign(s, { title: `${MIXED} ${LONG_NAME}`, body: `${s.body}\n${LONG_URL}\n${LONG_EMAIL}`, links: [LONG_URL, LONG_URL] });
  for (const f of db.client_files) f.label = `${f.label} ${UNBROKEN}`;
  for (const a of db.client_access) Object.assign(a, { username: LONG_EMAIL, note: `${MIXED} ${LONG_URL}` });
  for (const r of db.change_requests) Object.assign(r, { problem: `${LONG_BUSINESS}: ${MIXED}`, why: LONG_URL, proposal: `${LONG_NAME} ${LONG_EMAIL}` });
  return db;
}

export function emptyWorld(opts) {
  const db = lateWorld(opts);
  for (const k of Object.keys(db)) if (k !== "staff") db[k] = [];
  return db;
}

export function oneWorld(opts) {
  const db = lateWorld(opts);
  const keep = cid(12);
  for (const k of Object.keys(db)) {
    if (k === "staff") continue;
    if (k === "clients") db[k] = db[k].filter((x) => x.id === keep);
    else if (k === "protocol_checks" || k === "client_files") db[k] = db[k].filter((x) => x.client_id === keep);
    else if (k === "client_tasks") db[k] = db[k].filter((x) => x.client_id === keep).slice(0, 1);
    else db[k] = [];
  }
  return db;
}
