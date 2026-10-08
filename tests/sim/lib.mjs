// '
// The machinery of the full-flow simulation (docs/design/full-flow/report.md): one new
// client from the field deal to the renewal window, every step done by its role in the
// real pages, against an in-memory fake of Supabase, with a clock the script moves and
// the real reminder tick (supabase/functions/reminders/tick.js) run over the same data.
// Nothing here touches the live site or the Supabase project; names are invented.
//
// The fake is the office of tests/roles-world.mjs (makeFake: sign-in per role, generic
// tables, the row filters per role) plus what this scenario needs of the server logic,
// each part ported from the suite that already fakes it (named next to each part).
// (This file uses double quotes only: the tool that wrote it could not carry single ones.)
import http from "node:http";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { chromium } from "playwright";
import { SUPA, ROLES, emailOf } from "../roles-world.mjs";
import { makeFlowFake } from "../flow-world.mjs";
import { validateSelection, buildQuoteModel } from "../../app/pricing.js";
import { packageDeliverables, clientState } from "../../app/protocol-logic.js";
import { runTick } from "../../supabase/functions/reminders/tick.js";
import { partsIL, dateIL } from "../../app/tz.js";
import { serveMore, triggers } from "./server.mjs";

export { SUPA, ROLES, emailOf };
export const ROOT = fileURLToPath(new URL("../../", import.meta.url));
// A rerun that must not write over the recorded run (the screenshots and the step table the
// report's findings point at, and the saved state) goes somewhere else:
//   SIM_OUT=<folder> SIM_STATE=<folder> node tests/sim/run.mjs
const dir = (v, fallback) => (v ? join(resolve(v), "/") : join(ROOT, fallback));
export const OUT = dir(process.env.SIM_OUT, "docs/design/full-flow/");
export const STATE = dir(process.env.SIM_STATE, "tests/sim/state/");
mkdirSync(OUT, { recursive: true });
export const IL = (y, m, d, h = 0, mi = 0) => dateIL(y, m, d, h, mi);
export const hhmm = (d) => { const p = partsIL(new Date(d)); return `${p.day}.${p.month} ${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`; };
const DAYS = ["א", "ב", "ג", "ד", "ה", "ו", "שבת"];
export const stamp = (d) => { const x = new Date(d); const p = partsIL(x); return `יום ${DAYS[new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay()]} ${hhmm(x)}`; };
const MIN = 6e4;
const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*", "access-control-expose-headers": "*" };
// '
// '
// ── A static server of the repository (no cache), on a free port ──
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".webmanifest": "application/manifest+json", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".woff2": "font/woff2", ".ico": "image/x-icon" };
export function startServer() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
      if (p.endsWith("/")) p += "index.html";
      const file = normalize(join(ROOT, p));
      if (!file.startsWith(normalize(ROOT)) || !existsSync(file)) { res.writeHead(404); res.end("not found"); return; }
      try {
        const body = readFileSync(file);
        res.writeHead(200, { "content-type": MIME[extname(file)] || "application/octet-stream", "cache-control": "no-store" });
        res.end(body);
      } catch { res.writeHead(404); res.end("not found"); }
    });
    srv.listen(0, "127.0.0.1", () => resolve({ base: `http://127.0.0.1:${srv.address().port}/`, close: () => srv.close() }));
  });
}

// ── The office: the team, and every table empty ──
const OFFICE = new Set([null, "irit", "lior", "ofir", "ilai"]);
export const TABLES = ["clients", "protocol_checks", "protocol_log", "client_tasks", "deal_requests", "client_scripts", "script_grants", "script_share_links", "client_files",
  "client_landing_marks", "client_landing_done", "quotes", "change_requests", "client_access", "client_access_links", "client_access_log", "client_messages", "message_templates", "office_reviews",
  "photographer_months", "photographer_changes", "client_status_links", "client_status_views", "client_approvals", "client_surveys", "client_consents", "client_status_notes",
  "client_questions", "client_date_changes", "reminder_log", "push_subscriptions", "characterizations", "content_briefs", "client_month_marks", "client_gantt", "staff_tasks", "task_decisions"];
export function emptyOffice() {
  const staff = Object.entries(ROLES).map(([k, person]) => ({ email: emailOf(k), person, vault: OFFICE.has(person), phone: null }));
  const db = { staff };
  for (const t of TABLES) db[t] = [];
  return db;
}

export class Sim {
  constructor({ base, stage }) {
    this.base = base; this.stage = stage; this.now = null; this.db = null; this.records = []; this.lastTick = null; this.unmocked = []; this.nudges = []; this.shots = 0;
    this.secrets = { status: {}, access: {} }; // the Vault of the fake: link id -> token
  }
  static async start(stage, from = null) {
    const srv = await startServer();
    const sim = new Sim({ base: srv.base, stage });
    sim.srv = srv;
    if (from) sim.load(from); else { sim.db = emptyOffice(); }
    for (const t of TABLES) sim.db[t] ||= [];
    sim.browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
    sim.fake = sim.makeFake();
    return sim;
  }
  load(name) {
    const s = JSON.parse(readFileSync(join(STATE, `${name}.json`), "utf8"));
    this.db = s.db; this.now = new Date(s.now); this.records = s.records; this.lastTick = s.lastTick ? new Date(s.lastTick) : null; this.secrets = s.secrets; this.nudges = s.nudges || []; this.shots = s.shots || 0;
  }
  save(name = this.stage) {
    mkdirSync(STATE, { recursive: true });
    writeFileSync(join(STATE, `${name}.json`), JSON.stringify({ now: this.now.toISOString(), lastTick: this.lastTick?.toISOString() || null, db: this.db, records: this.records, secrets: this.secrets, nudges: this.nudges, shots: this.shots }, null, 1));
    if (this.unmocked.length && !name.endsWith("-wip")) console.log("unanswered by the fake:", [...new Set(this.unmocked)].join(", "));
  }
  async stop() { await this.browser.close(); this.srv.close(); }
  iso() { return this.now.toISOString(); }
  setNow(d) { if (d < this.now) throw new Error(`the clock cannot go back: ${hhmm(d)} < ${hhmm(this.now)}`); this.now = new Date(d); }
  advance(minutes) { this.now = new Date(this.now.getTime() + minutes * MIN); }
  client() { return this.db.clients[0]; }
  checkOf(key) { const c = this.client(); return this.db.protocol_checks.find((x) => x.client_id === c?.id && x.item_key === key) || null; }
  done(key) { return ["done", "na"].includes(this.checkOf(key)?.state); }
  // The protocol's state of the client at the simulated moment (the same computation the screens use).
  state() { const c = this.client(); return clientState(c, Object.fromEntries(this.db.protocol_checks.filter((x) => x.client_id === c.id).map((x) => [x.item_key, x])), new Date(this.now)); }
  // A data nudge: something no screen of the role could do. Always recorded.
  nudge(what, fn) { this.nudges.push({ at: this.iso(), what }); console.log(`  NUDGE: ${what}`); return fn?.(this.db); }
  rec(r) { const row = { n: this.records.length + 1, at: this.iso(), ...r }; this.records.push(row); console.log(`#${row.n} ${stamp(this.now)} ${r.step}`); this.save(`${this.stage}-wip`); return row; }
// '
// '
  // ── The fake Supabase ──────────────────────
  makeFake() {
    const db = this.db;
    const inner = makeFlowFake(db, { now: () => this.iso() });
    const personOfEmail = (email) => db.staff.find((s) => s.email === email);
    const who = (headers) => {
      const token = /^Bearer (.+)$/.exec(headers.authorization || "")?.[1] || "";
      try { const email = JSON.parse(Buffer.from(token.split(".")[1] || "", "base64url").toString("utf8"))?.email || null; return email ? personOfEmail(email) : null; } catch { return null; }
    };
    const route = async (r) => {
      const req = r.request();
      const url = new URL(req.url());
      const p = url.pathname;
      if (req.method() === "OPTIONS") return inner.route(r);
      let body = null;
      try { body = req.postData() ? JSON.parse(req.postData()) : null; } catch { body = null; }
      const me = who(req.headers());
      triggers(this);
      const json = (status, data) => r.fulfill({ status, contentType: "application/json", body: JSON.stringify(data), headers: CORS });
      const single = (req.headers().accept || "").includes("vnd.pgrst.object");
      try {
        const out = await this.serve({ p, url, body, me, method: req.method(), single });
        if (out) return json(out[0], out[1]);
      } catch (e) { console.log("  fake error", p, e.stack); return json(500, { message: String(e.message) }); }
      // What nothing answers is written down (it is how the missing parts of the fake are found).
      if ((p.startsWith("/rest/v1/rpc/") || p.startsWith("/functions/v1/")) && !KNOWN_INNER.has(p)) this.unmocked.push(`${req.method()} ${p}`);
      return inner.route(r);
    };
    return { route, calls: inner.calls };
  }

  // The server logic this scenario needs. Returns [status, data] or null (the generic fake answers).
  async serve({ p, url, body, me, method, single }) {
    const db = this.db;
    const now = this.iso();
    const office = !!me && OFFICE.has(me.person);
    // ── The field deals (tests/deal-e2e.mjs; supabase/migrations/20261003100000_sales_deals.sql) ──
    if (p === "/rest/v1/deal_requests" && method === "POST") {
      if (!["stav", "amos"].includes(me?.person)) return [403, { code: "42501", message: "new row violates row-level security policy" }];
      const d = { ...body, id: randomUUID(), created_at: now, created_by_email: me.email, seller: me.person, status: "pending", quote_id: null, sent_at: null, signed_at: null, status_by_email: null, cancelled_at: null };
      db.deal_requests.push(d);
      return [201, single ? d : [d]];
    }
    if (p === "/rest/v1/deal_requests" && method === "PATCH") {
      if (!office) return [200, []];
      const id = url.searchParams.get("id")?.replace(/^eq\./, "");
      const rows = db.deal_requests.filter((d) => !id || d.id === id);
      for (const d of rows) {
        Object.assign(d, body, { status_by_email: me.email });
        if (body.quote_id && d.status === "pending") d.status = "sent";
        if (d.status === "sent") d.sent_at ||= now;
      }
      return [200, single ? rows[0] : rows];
    }
    // ── The agreement (tests/e2e.mjs; supabase/functions/create-quote) ──
    if (p === "/functions/v1/create-quote") {
      if (!me) return [401, { error: "not signed in" }];
      try { validateSelection(body.selection); } catch (e) { return [400, { error: e.message }]; }
      if (!body.client?.name?.trim()) return [400, { error: "client name required" }];
      const n = db.quotes.length + 1;
      const q = { id: randomUUID(), token: randomUUID(), number: `AST-2026-${String(n).padStart(4, "0")}`, created_at: now, created_by_email: me.email, model: buildQuoteModel(body.selection, body.client), status: "sent", approval: "none", signed_at: null, signer_name: null };
      q.expires_at = new Date(Date.parse(now) + q.model.validHours * 3600e3).toISOString();
      q.model.validUntil = q.expires_at;
      q.client_name = q.model.client.name;
      q.monthly_gross_agorot = q.model.totals.monthlyGross;
      Object.assign(q, { tier: q.model.package.tierName, influencer: q.model.package.influencer, doc: q.model.docTitle, signable: String(q.model.signable), phone: q.model.client.phone, valid: String(q.model.validHours), company: q.model.client.company || null });
      db.quotes.push(q);
      return [200, { id: q.id, token: q.token, number: q.number, created_at: q.created_at }];
    }
    const quoteView = (q) => ({ number: q.number, createdAt: q.created_at, model: q.model, docHash: "ab".repeat(32), expiresAt: q.expires_at, expired: q.status !== "signed" && new Date(q.expires_at) < this.now,
      consentText: `קראתי ואני מאשר/ת את ההסכם ${q.number}`, signatureHash: q.signature_png ? "cd".repeat(32) : null, status: q.status, signerName: q.signer_name, signedAt: q.signed_at, signaturePng: q.signature_png });
    if (p === "/rest/v1/rpc/get_quote") {
      const q = db.quotes.find((x) => x.token === body.p_token);
      if (!q || q.status === "cancelled") return [200, null];
      q.first_viewed_at ||= now;
      return [200, quoteView(q)];
    }
    if (p === "/rest/v1/rpc/sign_quote") {
      const q = db.quotes.find((x) => x.token === body.p_token);
      if (!q) return [404, { code: "P0002", message: "quote not found" }];
      if (q.status === "signed") return [409, { code: "23505", message: "quote already signed" }];
      if (!body.p_consent) return [400, { code: "22023", message: "consent required" }];
      Object.assign(q, { status: "signed", signer_name: body.p_name.trim(), signed_at: now, signature_png: body.p_signature, whatsapp: body.p_whatsapp });
      // Trigger quotes_open_client (20260929160000_client_protocol_batch2.sql): the client opens by itself.
      const m = q.model;
      const months = Math.round(Number(m.termMonths ?? 12));
      const pi = partsIL(this.now);
      const end = new Date(Date.UTC(pi.year, pi.month - 1 + months, pi.day)).toISOString().slice(0, 10);
      const c = { id: randomUUID(), name: (m.client?.name || "").trim() || q.client_name, business: (m.client?.company || "").trim() || null, address: null, phone: (m.client?.phone || "").trim() || null,
        package_name: [m.package?.tierName, m.package?.influencer].filter(Boolean).join(" · "), shoot_type: { natali: "natali", simeon: "dms" }[m.selection?.influencer] || null, characterizer: null, has_logo: null,
        editor_name: null, editor: null, deal_at: now, char_at: null, shoot_at: null, contract_end: end, status: "active", notes: null, quote_id: q.id, created_at: now, created_by_email: "system", links: {},
        deliverables: packageDeliverables(m), rounds: [], verified_at: null, verified_by: null, closed_reason: null, archived_at: null, archived_by: null, landing: false, landed_at: null, landed_by: null, landing_slot: null };
      db.clients.push(c);
      for (const k of ["p01.prepared", "p01.sent", "p01.signed"]) db.protocol_checks.push({ client_id: c.id, item_key: k, state: "done", note: `נחתם במערכת: ${q.number}`, by_email: "system", at: now });
      // Trigger quotes_deal_signed (20261003100000_sales_deals.sql).
      for (const d of db.deal_requests) if (d.quote_id === q.id && d.status !== "signed") Object.assign(d, { status: "signed", signed_at: now });
      if (body.p_whatsapp) db.client_consents.push({ quote_id: q.id, kind: "whatsapp", given: true, at: now, phone: c.phone, version: "whatsapp-v1", revoked_at: null, revoked_via: null });
      return [200, quoteView(q)];
    }
    // client_messages_stamp: the row comes back with who sent it and when.
    if (p === "/rest/v1/client_messages" && method === "POST" && me) {
      const row = { id: randomUUID(), created_at: now, ...body, sent_at: now, sent_by_email: me.email };
      db.client_messages.push(row);
      return [201, single ? row : [row]];
    }
    // Storage (tests/package1-e2e.mjs): an upload is accepted; the row of the file is written by the page itself.
    if (p.startsWith("/storage/v1/object/client-files/") && method === "POST") return me ? [200, { Key: p.replace("/storage/v1/object/", "") }] : [400, { message: "not allowed" }];
    if (p === "/storage/v1/object/client-files" && method === "DELETE") return [200, []];
    return serveMore(this, { p, url, body, me, method, single, office, now });
  }
// '
// '
  // ── The browser ────────────────────────────
  // A page of `role` (null: nobody signed in, the public pages of the client) at the simulated moment.
  async open(role, path = "clients.html#mine", { phone = true, wait = null } = {}) {
    // The clipboard is allowed, as on a phone that was asked once: "העתקת הקישור" (5ב, 7א) copies the ready message.
    const ctx = await this.browser.newContext({ locale: "he-IL", timezoneId: "Asia/Jerusalem", viewport: phone ? { width: 390, height: 844 } : { width: 1280, height: 900 }, isMobile: phone, hasTouch: phone, permissions: ["clipboard-read", "clipboard-write"] });
    await ctx.clock.install({ time: this.now });
    await ctx.route(`${SUPA}/**`, this.fake.route);
    // Nothing leaves the machine: WhatsApp, Drive, Metricool and every other outside address is refused.
    await ctx.route((u) => !["127.0.0.1", new URL(SUPA).hostname].includes(u.hostname) && /^https?:$/.test(u.protocol), (r) => { this.blocked = (this.blocked || 0) + 1; return r.abort(); });
    const page = await ctx.newPage();
    page.setDefaultTimeout(10000);
    page.errors = [];
    page.on("pageerror", (e) => page.errors.push(String(e)));
    // A question of the browser (confirm) is answered yes, and what it asked is kept for the record.
    page.dialogs = [];
    page.on("dialog", (d) => { page.dialogs.push(d.message()); return d.accept(); });
    await page.goto(`${this.base}${path}`);
    if (role) {
      await page.waitForSelector("#lg-email", { state: "visible" });
      await page.fill("#lg-email", emailOf(role));
      await page.fill("#lg-pass", "correct-horse");
      await page.click("#lg-submit");
      await page.waitForSelector(wait || "#app-side", { state: "attached" });
    }
    await settle(page);
    return { page, ctx };
  }
  // Moves to another page inside the same session.
  async go(page, path) { await page.goto(`${this.base}${path}`); await settle(page); }

  // "המשימות שלי" of a role as it is on the phone: every card, counted line and group.
  async mine(role, { shot = null, keep = false } = {}) {
    const { page, ctx } = await this.open(role);
    const u = new URL(page.url());
    const landed = u.pathname.split("/").pop() + u.hash;
    let snap = { landed, groups: [], lines: [], cards: [], top: [], empty: null };
    if (/clients\.html/.test(page.url())) snap = { landed, ...(await page.evaluate(scrapeMine)) };
    else snap.other = await page.evaluate(() => String(document.querySelector("main")?.innerText || "").replace(/\s+/g, " ").trim().slice(0, 400));
    if (shot) {
      this.shots += 1;
      const name = `${String(this.shots).padStart(2, "0")}-${role}-${shot}.png`;
      const height = Math.min(2000, await page.evaluate(() => document.documentElement.scrollHeight));
      await page.screenshot({ path: join(OUT, name), fullPage: true, clip: { x: 0, y: 0, width: 390, height } }).catch(async () => { await page.screenshot({ path: join(OUT, name) }); });
      snap.shot = name;
    }
    if (keep) return { snap, page, ctx };
    await ctx.close();
    return snap;
  }
// '
// '
  // ── The reminders: the tick of the server, minute by minute, over the same data ──
  tickDb(now) {
    const db = this.db;
    const iso = now.toISOString();
    const since2 = new Date(now.getTime() - 2 * 864e5).toISOString();
    const nameOf = (id) => { const c = db.clients.find((x) => x.id === id); if (!c) return null; const n = (c.name || "").trim(); const b = (c.business || "").trim(); return !b || b === n ? n : n ? `${b} · ${n}` : b; };
    const named = (rows) => rows.map((r) => ({ ...r, client_name: nameOf(r.client_id) }));
    const pIL = partsIL(now);
    const today = dateIL(pIL.year, pIL.month, pIL.day, 0, 0).toISOString();
    return {
      load: async () => ({
        clients: db.clients.filter((c) => ["active", "ending"].includes(c.status) && !c.archived_at && !c.landing),
        checks: db.protocol_checks.map((r) => ({ ...r })),
        tasks: db.client_tasks.filter((t) => !t.done_at || t.done_at >= since2),
        staff: db.staff.map((s) => ({ email: s.email, person: s.person })),
        access: db.client_access.filter((a) => ["broken", "new"].includes(a.status)),
        reviews: db.office_reviews, statusNotes: db.client_status_notes,
        messages: db.client_messages.filter((m) => m.sent_at >= today),
        // Every person has one device, so a ring is a push (and is recorded as sent).
        subscriptions: db.staff.map((s, i) => ({ id: `s${i}`, email: s.email, endpoint: `https://push.invalid/${i}`, p256dh: "k", auth: "a", fail_count: 0 })),
        monthMarks: db.client_month_marks,
        deals: db.deal_requests.filter((d) => d.status === "pending" || (d.signed_at && d.signed_at >= since2) || (d.sent_at && d.sent_at >= since2) || (d.cancelled_at && d.cancelled_at >= since2)),
        accessLinks: db.client_access_links.map(({ token_hash, client_note_private, ...l }) => l),
        ganttFailures: db.client_gantt.filter((g) => g.mc_status === "error"),
        approvals: db.quotes.filter((q) => q.approval && q.approval !== "none" && q.status !== "cancelled"),
        // The contracts still out for signature, each with the seller of its deal (loadUnsigned in supabase/functions/reminders/index.ts).
        unsigned: db.quotes.filter((q) => q.status === "sent" && (!q.expires_at || q.expires_at >= since2)).map((q) => ({ ...q, business: q.model?.client?.company || null, valid: q.model?.validHours ?? null, seller_email: db.deal_requests.find((d) => d.quote_id === q.id)?.created_by_email ?? null })),
        staffTasks: db.staff_tasks.filter((t) => t.status === "open" || (t.done_at && t.done_at >= since2)),
        availability: { months: db.photographer_months, changes: db.photographer_changes },
        shootTold: db.reminder_log.filter((r) => r.rule === "shootSet"),
        questions: named(db.client_questions.filter((q) => !q.answer || (q.answered_at && q.answered_at >= since2))),
        changeRequests: named(db.change_requests.filter((q) => !q.decided_at || q.decided_at >= since2)),
        decisions: db.task_decisions.filter((d) => d.at >= since2),
        log: db.reminder_log.filter((r) => r.rule !== "nag").map((r) => ({ ...r })),
      }),
      known: async (keys) => { const set = new Set(keys); return new Set(db.reminder_log.map((r) => r.key).filter((k) => set.has(k))); },
      siblings: async (prefixes) => db.reminder_log.filter((r) => prefixes.some((px) => r.key.startsWith(`${px}@`))).map((r) => ({ id: r.id, key: r.key, person: r.person })).reverse(),
      insertLog: async (rows) => {
        const out = [];
        for (const r of rows) {
          if (db.reminder_log.some((x) => x.key === r.key)) continue;
          const row = { id: db.reminder_log.length + 1, created_at: iso, claimed_at: iso, attempts: 0, read_at: null, digest_key: null, ...r };
          db.reminder_log.push(row); out.push({ ...row });
        }
        return out;
      },
      reclaim: async () => [],
      updateLog: async (ids, patch) => { for (const r of db.reminder_log) if (ids.includes(r.id)) Object.assign(r, patch); },
      subscriptionOk: async () => null, subscriptionFailed: async () => null, removeSubscription: async () => null,
      // supabase/functions/reminders/index.ts db.autoAssign, as written there.
      autoAssign: async (a) => {
        if (a.patch) {
          const c = db.clients.find((x) => x.id === a.clientId);
          if (!c || (!a.n && c.editor)) return false;
          Object.assign(c, a.patch);
        }
        for (const x of [...a.checks, a.reason]) {
          if (db.protocol_checks.some((r) => r.client_id === a.clientId && r.item_key === x.key)) continue;
          db.protocol_checks.push({ client_id: a.clientId, item_key: x.key, state: "done", note: x.note, by_email: null, at: iso });
        }
        if (a.task) db.client_tasks.push({ id: randomUUID(), done_at: null, created_at: iso, urgent: false, started_at: null, source: null, due_on: null, ...a.task, created_by_email: null });
        this.autoAssigned = { at: iso, plan: a };
        return true;
      },
    };
  }
  // Runs the tick for every minute up to `until` (default: the simulated now). Returns the new rows of the log.
  async tick(until = this.now, { step = 1 } = {}) {
    const from = this.lastTick ? new Date(this.lastTick.getTime() + MIN) : new Date(until);
    const before = this.db.reminder_log.length;
    const push = async () => ({ ok: true, status: 201 });
    const quiet = console.error; console.error = () => null;
    triggers(this);
    try {
      let last = null;
      for (let t = from.getTime(); t <= until.getTime(); t += step * MIN) { last = t; await runTick({ db: this.tickDb(new Date(t)), push, now: new Date(t) }); }
      if (last !== until.getTime()) await runTick({ db: this.tickDb(new Date(until)), push, now: new Date(until) });
    } finally { console.error = quiet; }
    this.lastTick = new Date(until);
    return this.db.reminder_log.slice(before);
  }
  // Jumps over months with no tick in between (the renewal window): said in the report, never silent.
  jump(to, why) { this.setNow(to); this.lastTick = new Date(to.getTime() - MIN); this.nudges.push({ at: this.iso(), what: `השעון קפץ ל־${stamp(to)} בלי להריץ את התזכורות בדרך: ${why}` }); }
  // Moves the clock to `to`, ticking on the way (so nothing that was due in between is skipped).
  async until(to, opts) { this.setNow(to); return this.tick(this.now, opts); }
}
// '
// '
const KNOWN_INNER = new Set(["/rest/v1/rpc/is_staff", "/rest/v1/rpc/can_use_vault", "/rest/v1/rpc/can_use_client_vault", "/rest/v1/rpc/manager_client_finance", "/rest/v1/rpc/archived_clients", "/rest/v1/rpc/push_status", "/rest/v1/rpc/scripts_client", "/rest/v1/rpc/can_write_scripts", "/rest/v1/rpc/photographer_taken", "/rest/v1/rpc/clients_private", "/functions/v1/client-media"]);

export const settle = async (page, ms = 450) => { await page.waitForLoadState("networkidle").catch(() => null); await page.waitForTimeout(ms); };
// One line per reminder row: when, rule, to whom, level, how it went out, title.
export const fmtLog = (rows) => rows.map((r) => `${hhmm(r.created_at)} ${r.rule} -> ${r.person} [${r.level}/${r.channel}/${r.status}${r.reason ? `:${r.reason}` : ""}] ${r.title}`);

// What a person sees on "המשימות שלי" (runs in the page).
export function scrapeMine() {
  const vis = (el) => !!el && !el.hidden && el.getClientRects().length > 0;
  const t = (el) => String(el?.innerText ?? el?.textContent ?? "").replace(/\s+/g, " ").trim();
  const groupOf = (el) => {
    const g = el.closest(".wgroup");
    if (!g) return el.closest("#land-line") ? "קליטה" : "?";
    const h2 = g.querySelector(".wgroup-h");
    return [...(h2?.childNodes || [])].filter((n) => n.nodeType === 3 || !n.classList?.contains("n")).map((n) => n.textContent).join("").replace(/\s+/g, " ").trim() || [...g.classList].join(".");
  };
  const cards = [...document.querySelectorAll("#mine-list .wproc")].map((li) => ({
    key: li.dataset.key || (li.dataset.flow ? `flow:${li.dataset.flow}` : null),
    group: groupOf(li),
    status: [...li.classList].find((c) => c.startsWith("s-"))?.slice(2) || null,
    client: t(li.querySelector(".wclient")),
    when: t(li.querySelector(".wc-when")) || t(li.querySelector(".sbadge")) || null,
    due: li.querySelector(".wc-due")?.textContent || null,
    title: t(li.querySelector(".wc-title")) || t(li.querySelector(".wtitle")) || null,
    need: t(li.querySelector(".wneed span")) || null,
    go: [...li.querySelectorAll("a.ik-go, a.wc-go, a.btn")].map((a) => `${t(a) || a.textContent} -> ${a.getAttribute("href")}`),
    buttons: [...li.querySelectorAll("button")].map((b) => b.textContent.trim()).filter(Boolean),
    items: [...li.querySelectorAll(".witem")].map((it) => ({ label: it.querySelector(".wlabel")?.textContent || "", disabled: !!it.querySelector("input")?.disabled, via: [...it.children].filter((x) => !x.matches("label")).map((x) => x.textContent.replace(/\s+/g, " ").trim()).join(" | ") || null, id: it.querySelector("input")?.id || null })),
    text: (t(li) || li.textContent.replace(/\s+/g, " ").trim()).slice(0, 260),
    shown: vis(li),
  }));
  const top = ["#now-bar", "#staff-tasks-card", "#deals-card", "#approvals-card", "#my-questions", "#my-months", "#land-line", "#intake-card", "#auto-note", "#new-auto"].filter((s) => vis(document.querySelector(s))).map((s) => `${s}: ${t(document.querySelector(s)).slice(0, 320)}`);
  return {
    lines: [...document.querySelectorAll("a[id]")].filter((a) => a.id.startsWith("flow-")).map((a) => `[${groupOf(a)}] ${t(a)} -> ${a.getAttribute("href")}`),
    top,
    groups: [...document.querySelectorAll("#mine-list .wgroup")].map((g) => t(g.querySelector(".wgroup-h"))),
    cards,
    empty: vis(document.querySelector("#mine-list .empty")) ? t(document.querySelector("#mine-list .empty")) : null,
    extra: [...(document.querySelector("#view-mine")?.children || [])].filter(vis).map((s) => `${s.tagName.toLowerCase()}#${s.id || ""}.${s.className || ""}: ${t(s).slice(0, 200)}`),
  };
}
// The interactive things of a page, for finding the way (used while writing the scenario).
export function scrapeControls() {
  const vis = (el) => !!el && !el.hidden && el.getClientRects().length > 0;
  const t = (el) => String(el?.innerText ?? "").replace(/\s+/g, " ").trim();
  return {
    url: location.pathname.split("/").pop() + location.search + location.hash,
    h: [...document.querySelectorAll("h1, h2, h3")].filter(vis).map((e) => `${e.tagName} ${e.id ? `#${e.id} ` : ""}${t(e).slice(0, 80)}`),
    buttons: [...document.querySelectorAll("button, a.btn, a.chip, summary")].filter(vis).map((e) => `${e.tagName.toLowerCase()}${e.id ? `#${e.id}` : ""}${e.className ? `.${String(e.className).split(" ").join(".")}` : ""} "${t(e).slice(0, 60)}"${e.disabled ? " [disabled]" : ""}${e.getAttribute("href") ? ` -> ${e.getAttribute("href")}` : ""}`),
    inputs: [...document.querySelectorAll("input, select, textarea")].filter(vis).map((e) => `${e.tagName.toLowerCase()}#${e.id}[${e.type || ""}] name=${e.name || ""} ${e.checked ? "checked" : ""} ${e.disabled ? "disabled" : ""} label="${t(e.labels?.[0]).slice(0, 70)}"`),
    text: t(document.querySelector("main") || document.body).slice(0, 1500),
  };
}
// '
