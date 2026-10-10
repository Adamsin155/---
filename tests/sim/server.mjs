// '
// The rest of the server logic the scenario needs (see lib.mjs): each part is ported
// from the browser suite that fakes the same migration, and says which. What is not
// here is not simulated (the report lists it).
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { wordingFor, QUESTIONS, lowScore, severeScore, MARKS } from "../../app/status-logic.js";
import { payloadProblem, summaryOf, STATUS_OF, CLIENT_BY, MAX_ATTEMPTS, platformName } from "../../app/access-logic.js";
import { GIVERS, ASSIGNEES, BODY_MAX } from "../../app/staff-tasks-logic.js";
import { dayKeyIL, partsIL } from "../../app/tz.js";
import { addBusinessDays, isBusinessDay } from "../../app/protocol-logic.js";

const hash = (t) => createHash("sha256").update(t).digest("hex");
const MANAGERS = new Set([null, "irit", "lior", "ofir"]);

// The triggers of the database that move the flow (run after every write and before every tick).
export function triggers(sim) {
  const db = sim.db;
  const now = sim.iso();
  const done = (cid, key) => db.protocol_checks.some((x) => x.client_id === cid && x.item_key === key && ["done", "na"].includes(x.state));
  // client_messages_stamp: who sent a message to the client, and when.
  for (const m of db.client_messages) { if (!m.sent_at) { m.sent_at = m.created_at || now; m.sent_by_email ||= m.by_email || null; } }
  // client_questions_stamp: who asked and when; who answered and when.
  for (const q of db.client_questions || []) {
    if (!q.asked_at) { q.asked_at = q.created_at || now; q.asked_by ||= q.created_by_email || q.by_email || null; }
    if (q.answer && !q.answered_at) { q.answered_at = now; q.answered_by ||= db.staff.find((s) => s.person === q.to_person)?.email || null; }
  }
  // client_fix_tasks_close (20260930170000_client_status.sql): the fix task closes with the approval, or with the fixes of the videos.
  for (const t of db.client_tasks) {
    if (t.source !== "client_fix" || t.done_at) continue;
    const key = t.brief?.item_key;
    if (!key) continue;
    if (done(t.client_id, key)) t.done_at = now;
    else if (key === "p27.approved" && !t.brief?.extra) {
      const at = db.protocol_checks.find((x) => x.client_id === t.client_id && ["p27.fixes", "p27.final"].includes(x.item_key) && x.state === "done" && x.at >= t.created_at);
      if (at) t.done_at = now;
    }
  }
}

export function serveMore(sim, ctx) {
  const rpc = /^\/rest\/v1\/rpc\/(\w+)$/.exec(ctx.p)?.[1];
  if (!rpc) return null;
  return small(sim, rpc, ctx) || access(sim, rpc, ctx) || statusPage(sim, rpc, ctx) || staffTasks(sim, rpc, ctx);
}
const helpers = (sim, now) => {
  const db = sim.db;
  const clientOf = (id) => db.clients.find((c) => c.id === id);
  const checkOf = (c, key) => db.protocol_checks.find((x) => x.client_id === c.id && x.item_key === key) || null;
  const doneOf = (c, key) => ["done", "na"].includes(checkOf(c, key)?.state);
  const setCheck = (c, key, note, by = "system") => {
    const old = checkOf(c, key);
    if (old?.state === "done") return;
    if (old) db.protocol_checks.splice(db.protocol_checks.indexOf(old), 1);
    db.protocol_checks.push({ client_id: c.id, item_key: key, state: "done", note, by_email: by, at: now });
  };
  return { db, clientOf, checkOf, doneOf, setCheck };
};

// Small answers every page asks for.
function small(sim, rpc, { body, now }) {
  const db = sim.db;
  if (["whatsapp_my_consent", "calendar_feed_status", "landing_done_for", "metricool_settings"].includes(rpc)) return [200, null];
  if (["quote_facts", "access_link_notes", "calendar_feeds_team", "whatsapp_team_status"].includes(rpc)) return [200, []];
  if (rpc === "vault_code_status") return [200, { set: false, unlocked: true }];
  if (rpc === "reminders_mark_read") { for (const r of db.reminder_log) if (!r.read_at && (!body?.p_ids || body.p_ids.includes(r.id))) r.read_at = now; return [200, null]; }
  // tests/office-flows-e2e.mjs
  if (rpc === "ofir_meetings") {
    return [200, db.clients.filter((c) => c.char_at && (c.characterizer || "ofir") === "ofir").map((c) => {
      // The meeting ends when he marks it ("האפיון הסתיים", or the form saved), as public.ofir_meetings answers.
      const saved = db.protocol_checks.filter((x) => x.client_id === c.id && ["p04.ended", "p04.saved"].includes(x.item_key) && x.state === "done" && x.at > c.char_at).map((x) => x.at).sort()[0];
      return { starts_at: c.char_at, ends_at: saved || new Date(new Date(c.char_at).getTime() + 2 * 36e5).toISOString() };
    })];
  }
  return null;
}

// ── The tasks given on the spot (tests/staff-tasks-e2e.mjs; 20261011100000_staff_tasks.sql) ──
function staffTasks(sim, rpc, { body, me, now }) {
  if (!rpc.startsWith("staff_task_")) return null;
  const { db, clientOf } = helpers(sim, now);
  const pk = me ? (me.person ?? "owner") : null;
  if (!pk) return [403, { code: "42501", message: "not allowed" }];
  if (rpc === "staff_task_create") {
    if (!GIVERS.includes(pk)) return [403, { code: "42501", message: "not allowed" }];
    if (!ASSIGNEES().some((a) => a.key === body.p_assignee)) return [400, { code: "22023", message: "unknown assignee" }];
    const text = String(body.p_body || "").trim();
    if (!text || text.length > BODY_MAX) return [400, { code: "22023", message: "the task text is required" }];
    const c = body.p_client ? clientOf(body.p_client) : null;
    const t = { id: randomUUID(), created_at: now, created_by: pk, created_by_email: me.email, assignee: body.p_assignee, body: text, client_id: c?.id || null, client_name: c ? (c.business && c.business !== c.name ? `${c.business} · ${c.name}` : c.name) : null, status: "open", done_at: null, done_by_email: null, cancelled_at: null, cancelled_by_email: null };
    db.staff_tasks.push(t);
    return [200, t.id];
  }
  const t = db.staff_tasks.find((x) => x.id === body.p_id);
  if (!t) return [404, { code: "P0002", message: "task not found" }];
  if (rpc === "staff_task_done") { if (t.assignee !== pk) return [403, { code: "42501", message: "only the assignee" }]; Object.assign(t, { status: "done", done_at: now, done_by_email: me.email }); }
  else Object.assign(t, { status: "cancelled", cancelled_at: now, cancelled_by_email: me.email });
  return [200, t];
}
// '
// '
// ── The access vault and the logins form of the client (tests/intake-e2e.mjs, tests/access-form-e2e.mjs) ──
function access(sim, rpc, { body, me, office, now }) {
  const { db, clientOf, setCheck } = helpers(sim, now);
  const workStatuses = (ids) => db.client_access.filter((a) => !ids || ids.includes(a.client_id)).map((a) => ({ client_id: a.client_id, network: a.network, label: a.label, status: a.status, updated_at: a.updated_at, by_client: a.updated_by === CLIENT_BY }));
  if (["access_status_for_work", "access_work_statuses", "access_status_overview"].includes(rpc)) return [200, office ? workStatuses(body?.p_clients || null) : []];
  if (rpc === "access_save") {
    if (!office) return [400, { message: "not allowed" }];
    let a = db.client_access.find((x) => x.id === body.p_id);
    const fields = { network: body.p_network ?? a?.network, label: body.p_label ?? a?.label ?? null, username: body.p_username ?? a?.username ?? null, status: body.p_status || "ok", note: body.p_note || null, updated_by: me.email, updated_at: now };
    if (a) Object.assign(a, fields); else { a = { id: randomUUID(), client_id: body.p_client, has_secret: null, created_at: now, broken_since: null, ...fields }; db.client_access.push(a); }
    a.broken_since = a.status === "broken" ? (a.broken_since || now) : null;
    if (body.p_password) a.has_secret = randomUUID();
    return [200, a.id];
  }
  if (rpc === "access_reveal") return [200, "Secret-123"];
  const linkReason = (l) => {
    if (!l) return "invalid";
    if (l.revoked_at) return "revoked";
    if (l.submitted_at) return "done";
    if (l.attempts >= MAX_ATTEMPTS) return "locked";
    if (new Date(l.expires_at) <= sim.now) return "expired";
    const c = clientOf(l.client_id);
    if (!c || !["active", "ending"].includes(c.status)) return "closed";
    return null;
  };
  const byToken = (t) => db.client_access_links.find((x) => x.token_hash === hash(String(t || ""))) || null;
  if (rpc === "access_form_info") {
    const l = byToken(body.p_token);
    const reason = linkReason(l);
    if (reason) return [200, { state: reason }];
    const c = clientOf(l.client_id);
    return [200, { state: "ok", business: c.business || c.name, preview: !!me }];
  }
  if (rpc === "access_form_submit") {
    if (me) return [403, { code: "42501", message: "staff cannot send the form for the client" }];
    const l = byToken(body.p_token);
    const reason = linkReason(l);
    if (reason) return [200, { state: reason }];
    const payload = body.p_payload;
    if (payloadProblem(payload) !== null) { l.attempts += 1; return [200, { state: l.attempts >= MAX_ATTEMPTS ? "locked" : "refused", left: Math.max(0, MAX_ATTEMPTS - l.attempts) }]; }
    const c = clientOf(l.client_id);
    const names = [];
    const open = [];
    for (const e of payload.entries) {
      const label = String(e.label ?? "").trim() || null;
      const user = String(e.username ?? "").trim() || null;
      const status = STATUS_OF[e.choice];
      const same = (x) => x.client_id === c.id && x.network === e.network && (e.network !== "other" || String(x.label || "").trim().toLowerCase() === String(label || "").toLowerCase());
      let a = db.client_access.find(same);
      // A login the office saved or checked is never touched: the one of the client goes into a row beside it.
      const beside = !!a && !!a.has_secret && (a.status === "ok" || a.updated_by !== CLIENT_BY);
      if (beside) { const officeRow = a; a = db.client_access.find((x) => same(x) && x !== officeRow && x.updated_by === CLIENT_BY && x.status !== "ok"); }
      const fresh = !a;
      const was = a?.status;
      const note = (e.choice === "have" ? "מהלקוח, בטופס פרטי הכניסה. עוד לא נבדק." : e.choice === "none" ? "מהלקוח, בטופס פרטי הכניסה: אין כיום, צריך לפתוח." : "מהלקוח, בטופס פרטי הכניסה: יש, וצריך לחדש סיסמה.") + (beside ? " הפרטים שכבר היו בכספת נשארו בשורה נפרדת: לבדוק איזו נכונה." : "");
      const rowLabel = beside && e.network !== "other" ? `מהלקוח, ${dayKeyIL(sim.now)}` : label;
      if (fresh) { a = { id: randomUUID(), client_id: c.id, network: e.network, label: rowLabel, username: user, has_secret: null, status, note, updated_by: CLIENT_BY, updated_at: now, created_at: now, broken_since: null }; db.client_access.push(a); }
      else Object.assign(a, { username: e.choice === "have" || (e.choice === "reset" && user) ? user : a.username, label: beside ? rowLabel : a.label, status, note, updated_by: CLIENT_BY, updated_at: now });
      a.broken_since = status === "broken" ? (a.broken_since || now) : null;
      if (e.choice === "have") a.has_secret ||= randomUUID();
      names.push(platformName(e.network, label));
      if (e.choice === "none" && (fresh || was !== "missing")) open.push(platformName(e.network, label));
    }
    Object.assign(l, { submitted_at: now, summary: summaryOf(payload), client_note: null, client_note_private: String(payload.notes ?? "").trim() || null });
    setCheck(c, "p05.access", `מהלקוח, בטופס פרטי הכניסה: ${names.join(", ")}`);
    setCheck(c, "p05.vault", "נכנס לכספת מטופס פרטי הכניסה של הלקוח");
    // Trigger client_access_links_filled (20261022100000_flow_fixes_v8.sql): the moment the link gets its
    // submitted_at closes Irit's "send the client the link" (5ב) and answers "are there other networks".
    // A mark that is already done keeps its time and its words; one in another state is set to done.
    for (const [key, note] of [["p05b.sent", "נסגר לבד: הלקוח מילא את טופס פרטי הכניסה"], ["p05.allnets", "נסגר לבד: הלקוח מילא בטופס את הרשתות שלו"]]) {
      const old = db.protocol_checks.find((x) => x.client_id === c.id && x.item_key === key);
      if (!old) db.protocol_checks.push({ client_id: c.id, item_key: key, state: "done", note, by_email: null, at: now });
      else if (old.state !== "done") Object.assign(old, { state: "done", note });
    }
    if (open.length) db.client_tasks.push({ id: randomUUID(), client_id: c.id, title: `לפתוח ללקוח ${open.join(", ")} ולהכניס את הגישה לכספת (הלקוח סימן בטופס: אין כיום)`, owner: "ilai", urgent: true, due_on: null, done_at: null, done_by_email: null, source: null, brief: null, started_at: null, created_by_email: "", created_at: now });
    return [200, { state: "done" }];
  }
  if (rpc === "access_link_create") {
    if (!office) return [403, { code: "42501", message: "not allowed" }];
    for (const l of db.client_access_links) if (l.client_id === body.p_client && !l.revoked_at && !l.submitted_at) { l.revoked_at = now; l.revoked_by = me.email; }
    const token = randomBytes(32).toString("base64url");
    const id = randomUUID();
    const expires = new Date(sim.now.getTime() + 14 * 864e5).toISOString();
    db.client_access_links.push({ id, client_id: body.p_client, token_hash: hash(token), created_at: now, created_by: me.email, expires_at: expires, revoked_at: null, revoked_by: null, submitted_at: null, attempts: 0, summary: null, client_note: null });
    sim.secrets.access[id] = token;
    return [200, { id, token, expiresAt: expires }];
  }
  if (rpc === "access_link_token") { const l = db.client_access_links.find((x) => x.id === body.p_id); return [200, l && !linkReason(l) ? sim.secrets.access[l.id] || null : null]; }
  return null;
}
// '
// '
// ── The status page of the client (tests/status-e2e.mjs; 20260930170000_client_status.sql) ──
const SPECS = [["graphics9", "p07.sent", "p07.approved"], ["scripts", null, "p13.approved"], ["graphics", "p23.sent", "p23.approved"], ["videos", "p26.sent", "p27.approved"]];
const ITEM_LABEL = { graphics9: "9 הגרפיקות הראשונות", scripts: "התסריטים", graphics: "יתרת הגרפיקות", videos: "הסרטונים" };
function statusTools(sim, now) {
  const { db, clientOf, checkOf, doneOf } = helpers(sim, now);
  const itemsOf = (c) => {
    const out = [];
    for (const [item, sent, key] of SPECS) {
      const sentAt = sent ? (checkOf(c, sent)?.state === "done" ? checkOf(c, sent).at : null) : (["p12.scripts", "p12.numbered", "p12.docs"].every((k) => doneOf(c, k)) ? checkOf(c, "p12.docs").at : null);
      if (!doneOf(c, key) && !sentAt) continue;
      let used = db.client_approvals.filter((a) => a.client_id === c.id && a.item_key === key && a.decision === "fix").length;
      let fixing = db.client_tasks.some((t) => t.client_id === c.id && t.source === "client_fix" && !t.done_at && t.brief?.item_key === key);
      if (item === "videos") {
        const notes = checkOf(c, "p27.notes");
        const fixed = doneOf(c, "p27.fixes") || checkOf(c, "p27.final")?.state === "done";
        if (notes && notes.note !== "ייבוא" && !String(notes.note).includes("status")) used += 1;
        fixing ||= !!notes && !fixed;
      }
      out.push({ item, key, shootRound: 1, state: doneOf(c, key) ? "approved" : fixing ? "fixing" : "waiting", round: used + 1, included: 1, sentAt, approvedAt: null, link: item === "scripts" ? null : c.links?.drive || null, editor: c.editor });
    }
    return out;
  };
  const surveysDue = (c) => { const due = []; if (c.shoot_at && dayKeyIL(new Date(c.shoot_at)) < dayKeyIL(sim.now)) due.push("shoot"); return due.filter((k) => !db.client_surveys.some((s) => s.client_id === c.id && s.kind === k)); };
  const payload = (l, preview) => {
    const c = clientOf(l.client_id);
    const recent = db.client_status_views.some((v) => v.link_id === l.id && sim.now.getTime() - new Date(v.at).getTime() < 300000);
    if (!preview && !recent) db.client_status_views.push({ id: db.client_status_views.length + 1, link_id: l.id, client_id: c.id, at: now });
    const lastThursday = db.client_messages.filter((x) => x.client_id === c.id && x.kind === "thursday").at(-1);
    return {
      state: "ok", preview, expiresAt: l.expires_at,
      client: { name: c.name, business: c.business, status: c.status, shootType: c.shoot_type, charAt: c.char_at, shootAt: c.shoot_at, contractEnd: c.contract_end, rounds: [] },
      marks: Object.fromEntries(db.protocol_checks.filter((x) => x.client_id === c.id && MARKS.test(x.item_key)).map((x) => [x.item_key, { s: x.state, at: x.note === "ייבוא" ? null : x.at }])),
      links: Object.fromEntries(["drive", "scripts", "gantt"].filter((k) => String(c.links?.[k] || "").startsWith("https://")).map((k) => [k, c.links[k]])),
      items: itemsOf(c).map(({ editor, ...rest }) => rest),
      approvals: [...db.client_approvals].filter((a) => a.client_id === c.id).reverse().slice(0, 20).map((a) => ({ item: a.item, key: a.item_key, shootRound: a.shoot_round, decision: a.decision, round: a.round, name: a.signer_name, note: a.note, at: a.at })),
      thursday: lastThursday ? { body: lastThursday.body, at: lastThursday.sent_at } : null,
      surveys: { due: surveysDue(c), answered: db.client_surveys.filter((s) => s.client_id === c.id).map((s) => ({ kind: s.kind, score: s.score, at: s.at })) },
    };
  };
  const linkOf = (token) => {
    const l = db.client_status_links.find((x) => x.token_hash === hash(String(token || "")));
    if (!l) return { reason: "invalid" };
    if (l.revoked_at) return { reason: "revoked" };
    if (new Date(l.expires_at) <= sim.now) return { reason: "expired" };
    if (!["active", "ending"].includes(clientOf(l.client_id)?.status)) return { reason: "closed" };
    return { link: l };
  };
  return { db, clientOf, checkOf, itemsOf, surveysDue, payload, linkOf };
}
// '
// '
function statusPage(sim, rpc, { body, me, now }) {
  const { db, clientOf, checkOf, itemsOf, surveysDue, payload, linkOf } = statusTools(sim, now);
  const manager = !!me && (MANAGERS.has(me.person) || me.person === "ilai");
  if (rpc === "status_link_create") {
    if (!manager) return [403, { code: "42501", message: "not allowed" }];
    for (const l of db.client_status_links) if (l.client_id === body.p_client && !l.revoked_at) { l.revoked_at = now; l.revoked_by = me.email; }
    const token = randomBytes(32).toString("base64url");
    const id = randomUUID();
    const expires = new Date(sim.now.getTime() + 180 * 864e5).toISOString();
    db.client_status_links.push({ id, client_id: body.p_client, token_hash: hash(token), created_at: now, created_by: me.email, expires_at: expires, revoked_at: null, revoked_by: null });
    sim.secrets.status[id] = token;
    return [200, { id, token, expiresAt: expires }];
  }
  if (rpc === "status_link_token") { const l = db.client_status_links.find((x) => x.id === body.p_id && !x.revoked_at); return [200, l ? sim.secrets.status[l.id] : null]; }
  if (!["get_status", "approve_item", "request_fix", "answer_survey"].includes(rpc)) return null;
  const got = linkOf(body.p_token);
  if (rpc === "get_status") return [200, got.reason ? { state: got.reason } : payload(got.link, !!me)];
  if (me) return [403, { code: "42501", message: "staff cannot act for the client" }];
  if (got.reason) return [404, { code: "P0002", message: `status link ${got.reason}` }];
  const l = got.link;
  const c = clientOf(l.client_id);
  const name2 = String(body.p_name || "").trim().replace(/\s+/g, " ");
  if (name2.length < 2) return [400, { code: "22023", message: "invalid name" }];
  if (rpc === "answer_survey") {
    if (!surveysDue(c).includes(body.p_kind)) return [400, { code: "22023", message: "survey not open" }];
    const s = { id: randomUUID(), client_id: c.id, kind: body.p_kind, score: body.p_score, respondent: name2, question: QUESTIONS[body.p_kind], source: "page", recorded_by: "client", at: now, task_id: null };
    if (lowScore(s.kind, s.score)) {
      s.task_id = randomUUID();
      db.client_tasks.push({ id: s.task_id, client_id: c.id, title: `להתקשר ללקוח: ציון ${s.score} מתוך 5 בשאלה על יום הצילום`, owner: "lior", due_on: dayKeyIL(addBusinessDays(sim.now, 1)), done_at: null, done_by_email: null, source: "survey", brief: { survey: s.id, kind: s.kind, score: s.score, owner_alert: severeScore(s.kind, s.score) }, urgent: false, started_at: null, created_by_email: "", created_at: now });
    }
    db.client_surveys.push(s);
    return [200, payload(l, false)];
  }
  const it = itemsOf(c).find((x) => x.key === body.p_key);
  if (!it || it.state !== "waiting") return [400, { code: "22023", message: "not awaiting approval" }];
  const decision = rpc === "approve_item" ? "approve" : "fix";
  const wording = wordingFor(decision, { name: body.p_name, business: c.business, item: it.item, shootRound: 1, round: it.round, included: 1 });
  if (body.p_wording !== wording) return [400, { code: "22023", message: "wording changed" }];
  const a = { id: randomUUID(), client_id: c.id, link_id: l.id, item: it.item, item_key: it.key, shoot_round: 1, decision, round: it.round, signer_name: name2, note: body.p_note || null, wording, file_ref: it.link, version: it.sentAt, at: now, task_id: null };
  if (decision === "approve") {
    const old = checkOf(c, it.key);
    if (old) db.protocol_checks.splice(db.protocol_checks.indexOf(old), 1);
    db.protocol_checks.push({ client_id: c.id, item_key: it.key, state: "done", note: `אושר בדף המצב על ידי ${name2}`, by_email: "system", at: now });
  } else {
    if (String(body.p_note || "").trim().length < 2) return [400, { code: "22023", message: "note required" }];
    const extra = it.round > 1;
    const owner = extra ? "lior" : it.item === "scripts" ? "lior" : it.item === "videos" ? (it.editor || "ofir") : "ilai";
    // The due day (the migration): scripts and an extra round the next working day; else today for notes by 13:00.
    const late = extra || it.item === "scripts" || !isBusinessDay(sim.now) || partsIL(sim.now).hour >= 13;
    const due = dayKeyIL(late ? addBusinessDays(sim.now, 1) : sim.now);
    let marked = false;
    if (it.item === "videos" && !extra && !checkOf(c, "p27.notes")) { db.protocol_checks.push({ client_id: c.id, item_key: "p27.notes", state: "done", note: JSON.stringify({ text: body.p_note, via: "status" }), by_email: "system", at: now }); marked = true; }
    a.task_id = randomUUID();
    db.client_tasks.push({ id: a.task_id, client_id: c.id, title: extra ? `הלקוח ביקש סבב תיקונים נוסף: ${ITEM_LABEL[it.item]} (להחליט ולחזור ללקוח)` : `תיקון לבקשת הלקוח: ${ITEM_LABEL[it.item]} · סבב ${it.round}`, owner, due_on: due, done_at: null, done_by_email: null, source: "client_fix",
      brief: { problem: body.p_note, from: "status", item: it.item, item_key: it.key, round: it.round, extra, notes_marked: marked, by: name2 }, urgent: false, started_at: null, created_by_email: "", created_at: now });
  }
  db.client_approvals.push(a);
  return [200, payload(l, false)];
}
// '
