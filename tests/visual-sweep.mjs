#!/usr/bin/env node
// The visual sweep (docs/ops.md, section 55): every page, for every role, on phone, tablet and
// desktop, against the invented offices of tests/late-world.mjs and tests/worst-world.mjs
// (a fake Supabase in the browser: nothing here touches the live site or the real project).
// For each page x role x size x world it measures 14 kinds of visual faults (see `audit`
// below), takes screenshots OUTSIDE the repository, and walks the main flows on a phone.
//
//   node tests/visual-sweep.mjs                       the whole matrix
//   node tests/visual-sweep.mjs --quick               390 and 1280 only, normal + worst worlds
//   node tests/visual-sweep.mjs --page qa.html --role ofir --size 390 --world worst
//   node tests/visual-sweep.mjs --flows               only the end-to-end flows on the phone
//   --out <dir>  where the screenshots and findings.json go (default: the system temp dir)
//   --jobs <n>   browser contexts at once (default 5)
// Exit code: 1 when a blocker or a high finding exists, else 0.
import { chromium } from "playwright";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { NOW, SUPA, ROLES, emailOf, lateWorld, makeFlowFake, cid } from "./late-world.mjs";
import { worstWorld, emptyWorld, oneWorld } from "./worst-world.mjs";
import { menuOf, profileMenu } from "../app/shell-rules.js";
import { scopeOf } from "../app/protocol.js";

// ── What runs in the page: the 14 checks ─────────────────────────────────────────────
// Returns { findings: [{ check, sev, sel, text, what, nums, y }], more: { check: n }, meta }.
// `o`: { phone, safeTop, safeBottom, scope (a selector: only inside it, for an open dialog),
//        staff, hot: [pink fills], navy: [navy fills] }.
function audit(o) {
  const out = [];
  const more = {};
  const de = document.documentElement;
  const vw = de.clientWidth;
  const vh = window.innerHeight;
  const scope = (o.scope && document.querySelector(o.scope)) || document.body;
  const norm = (s) => String(s || "").replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, "{id}").replace(/\d{2,}/g, "N");
  const one = (el) => {
    if (!el || !el.tagName) return "";
    const t = el.tagName.toLowerCase();
    if (el.id) return `${t}#${norm(el.id)}`;
    const c = [...el.classList].filter((x) => !/^(ds-rise|is-|has-)/.test(x)).slice(0, 2).join(".");
    return c ? `${t}.${norm(c)}` : t;
  };
  const selOf = (el) => { const parts = []; let n = el; while (n && n !== document.body && parts.length < 3) { parts.unshift(one(n)); if (n.id) break; n = n.parentElement; } return parts.join(" > "); };
  const textOf = (el) => String(el.innerText || el.value || (el.getAttribute && el.getAttribute("aria-label")) || el.placeholder || "").replace(/\s+/g, " ").trim().slice(0, 70);
  const add = (check, sev, el, what, nums) => {
    more[check] = (more[check] || 0) + 1;
    if (more[check] > 10) return;
    out.push({ check, sev, sel: el ? selOf(el) : "", text: el ? textOf(el) : "", what, nums: nums || "", y: el ? Math.round(el.getBoundingClientRect().top + scrollY) : 0 });
  };
  const R = (el) => el.getBoundingClientRect();
  const px = (n) => Math.round(n * 10) / 10;
  const clampX = (x) => Math.min(vw - 2, Math.max(2, x));
  const vis = (el) => { if (!el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false; const r = R(el); return r.width > 1 && r.height > 1; };
  const all = [...scope.querySelectorAll("*")].filter((el) => !(el instanceof SVGElement && el.tagName.toLowerCase() !== "svg") && !el.closest("[data-vs-skip]") && vis(el));
  const visSet = new Set(all);
  const CS = new Map();
  const cs = (el) => { let s = CS.get(el); if (!s) { s = getComputedStyle(el); CS.set(el, s); } return s; };
  const FX = new Map();
  const fixedAnc = (el) => { if (FX.has(el)) return FX.get(el); let f = null; for (let n = el; n && n.nodeType === 1; n = n.parentElement) { const p = cs(n).position; if (p === "fixed" || p === "sticky") { f = n; break; } } FX.set(el, f); return f; };
  const inScroller = (el) => { for (let n = el.parentElement; n && n !== document.body && n !== de; n = n.parentElement) { const x = cs(n).overflowX; if ((x === "auto" || x === "scroll") && n.scrollWidth > n.clientWidth + 1) return n; } return null; };
  const ownText = (el) => { for (const n of el.childNodes) if (n.nodeType === 3 && n.nodeValue.trim()) return true; return false; };
  const textRects = (el) => {
    const rects = []; const tw = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); let count = 0;
    for (let n = tw.nextNode(); n && count < 40; n = tw.nextNode()) {
      if (!n.nodeValue.trim()) continue;
      const p = n.parentElement; if (!p || !visSet.has(p)) continue;
      let abs = false; for (let q = p; q && q !== el; q = q.parentElement) { const ps = cs(q).position; if (ps === "absolute" || ps === "fixed") { abs = true; break; } }
      if (abs) continue;
      const rg = document.createRange(); rg.selectNodeContents(n); count += 1;
      for (const r of rg.getClientRects()) if (r.width > 0.5 && r.height > 0.5) rects.push(r);
    }
    return rects;
  };
  const INTER = "a[href], button, input:not([type=hidden]), select, textarea, summary, [role=tab], [role=button], [tabindex]:not([tabindex=\"-1\"])";
  const inter = all.filter((el) => el.matches(INTER) && !el.disabled);
  const labelOf = (el) => (el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`)) || el.closest("label");
  const spread = (a) => Math.max(...a) - Math.min(...a);
  const y0 = scrollY;
  const maxY = Math.max(0, de.scrollHeight - vh);


  // 1. the page scrolls sideways; something is wider than the viewport
  const hs = de.scrollWidth - de.clientWidth;
  if (!o.scope && hs > 1) add("01-page-scrolls-sideways", o.phone ? "high" : "medium", null, "the page scrolls sideways", `scrollWidth ${de.scrollWidth} > viewport ${de.clientWidth}`);
  const wide = new Set();
  for (const el of all) { const r = R(el); if (((r.right > vw + 1 && r.left < vw) || (r.left < -1 && r.right > 0)) && !inScroller(el)) wide.add(el); }
  for (const el of wide) {
    if (wide.has(el.parentElement)) continue;
    const r = R(el);
    add("01-wider-than-viewport", o.phone ? "high" : "medium", el, hs > 1 ? "sticks out of the viewport and makes the page scroll sideways" : "cut by the edge of the viewport", `left ${px(r.left)} right ${px(r.right)} viewport ${vw}`);
  }
  for (const el of all) { const x = cs(el).overflowX; if ((x === "auto" || x === "scroll") && el.scrollWidth > el.clientWidth + 1 && el !== de && el !== document.body) add("01-inner-sideways-scroll", "low", el, "a part of the page scrolls sideways inside it", `scrollWidth ${el.scrollWidth} > ${el.clientWidth}`); }

  // 2. text clipped by its box, or drawn outside it
  const BOXED = "button, .btn, [role=tab], .tab, .k-pill, .chip, .tag, td, th, .k-tile, .k-num, .k-count, .k-go, .side-link";
  for (const el of all) {
    if (!el.textContent.trim() || el.matches("select, option, input, textarea")) continue;
    const s = cs(el); const er = R(el);
    const ctl = el.matches(BOXED) || !!el.closest("button, [role=tab], .btn, .k-pill, .chip, .tag");
    const hx = s.overflowX === "hidden" || s.overflowX === "clip"; const hy = s.overflowY === "hidden" || s.overflowY === "clip";
    if (hx && el.scrollWidth > el.clientWidth + 1) {
      if (s.textOverflow === "ellipsis") add("02-text-ellipsis", "low", el, "text cut with an ellipsis", `scrollWidth ${el.scrollWidth} > ${el.clientWidth}`);
      else if (textRects(el).some((r) => r.right > er.right + 1 || r.left < er.left - 1)) add("02-text-clipped", ctl ? "high" : "medium", el, "text is clipped by its own box", `scrollWidth ${el.scrollWidth} > clientWidth ${el.clientWidth}`);
    } else if (hy && el.scrollHeight > el.clientHeight + 2 && !/^\d+$/.test(s.getPropertyValue("-webkit-line-clamp")) && textRects(el).some((r) => r.bottom > er.bottom + 2 || r.top < er.top - 2)) {
      add("02-text-clipped", ctl ? "high" : "medium", el, "text is clipped by the height of its box", `scrollHeight ${el.scrollHeight} > clientHeight ${el.clientHeight}`);
    } else if (!hx && el.matches(BOXED) && s.display !== "inline" && s.display !== "contents") {
      const bad = textRects(el).find((r) => r.right > er.right + 2 || r.left < er.left - 2 || r.bottom > er.bottom + 4 || r.top < er.top - 4);
      if (bad) add("02-text-outside-its-box", "high", el, "text is drawn outside its box", `text ${px(bad.left)}–${px(bad.right)} × ${px(bad.top)}–${px(bad.bottom)}, box ${px(er.left)}–${px(er.right)} × ${px(er.top)}–${px(er.bottom)}`);
    }
  }

  // 3. controls that overlap, and siblings drawn on one another
  const cut = (a, b) => { const x = Math.min(a.right, b.right) - Math.max(a.left, b.left); const y = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top); return x > 2 && y > 2 ? [x, y] : null; };
  const isField = (x) => x.matches("input, textarea, select");
  const ir = inter.slice(0, 500).map((el) => [el, R(el)]);
  for (let i = 0; i < ir.length; i += 1) for (let j = i + 1; j < ir.length; j += 1) {
    const [a, ra] = ir[i]; const [b, rb] = ir[j];
    const c = cut(ra, rb); if (!c) continue;
    if (a.contains(b) || b.contains(a) || fixedAnc(a) !== fixedAnc(b)) continue;
    if (isField(a) !== isField(b)) continue; // a control drawn inside a field (the eye of a password)
    const la = labelOf(a); const lb = labelOf(b); if ((la && la.contains(b)) || (lb && lb.contains(a))) continue;
    const mx = clampX(Math.max(ra.left, rb.left) + c[0] / 2); const my = Math.max(ra.top, rb.top) + c[1] / 2;
    if (my >= 0 && my < vh) { const h = document.elementFromPoint(mx, my); if (h && !a.contains(h) && !b.contains(h) && !h.contains(a)) continue; } // clipped away there
    add("03-controls-overlap", "high", b, `overlaps ${selOf(a)} "${textOf(a).slice(0, 30)}"`, `${px(c[0])}×${px(c[1])}px`);
  }
  for (const p of all) {
    const kids = [...p.children].filter((k) => visSet.has(k) && /^(static|relative)$/.test(cs(k).position));
    if (kids.length < 2 || kids.length > 24) continue;
    for (let i = 0; i < kids.length; i += 1) for (let j = i + 1; j < kids.length; j += 1) {
      const a = kids[i]; const b = kids[j]; const c = cut(R(a), R(b)); if (!c || c[0] < 4 || c[1] < 4) continue;
      const neg = (k) => ["marginTop", "marginBottom", "marginLeft", "marginRight"].some((m) => parseFloat(cs(k)[m]) < 0);
      if (neg(a) || neg(b)) continue;
      const has = (k) => !!k.textContent.trim() || !!k.querySelector("svg, img") || k.matches("svg, img, input, button");
      if (!has(a) || !has(b)) continue;
      add("03-siblings-overlap", "medium", b, `drawn over its sibling ${one(a)} "${textOf(a).slice(0, 24)}"`, `${px(c[0])}×${px(c[1])}px`);
    }
  }


  // 4. form rows: inputs of one row on one line and one height, labels on one line
  const fields = all.filter((el) => el.matches("input:not([type=checkbox]):not([type=radio]):not([type=hidden]):not([type=file]):not([type=range]):not([type=color]), select, textarea"));
  const boxOf = (el) => el.closest("form, fieldset, dialog, .k-card, .card, section, .block") || document.body;
  const used = new Set();
  for (const a of fields) {
    if (used.has(a)) continue;
    const ra = R(a); const row = [a];
    for (const b of fields) {
      if (b === a || used.has(b) || boxOf(b) !== boxOf(a)) continue;
      const rb = R(b); const ov = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top); const hx = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
      if (ov > 0.5 * Math.min(ra.height, rb.height) && hx <= 0) row.push(b);
    }
    if (row.length < 2) continue;
    for (const x of row) used.add(x);
    const single = row.filter((x) => x.tagName !== "TEXTAREA");
    if (single.length >= 2) {
      const hsz = single.map((x) => px(R(x).height)); const tops = single.map((x) => px(R(x).top));
      if (spread(hsz) > 1.5) add("04-row-inputs-differ-in-height", "medium", single[0], "inputs of one row have different heights", hsz.join(" / "));
      else if (spread(tops) > 1.5) add("04-row-inputs-not-on-one-line", "medium", single[0], "inputs of one row do not sit on one line", `tops ${tops.join(" / ")}`);
    }
    const labs = row.map((x) => x.id && document.querySelector(`label[for="${CSS.escape(x.id)}"]`)).filter((l) => l && visSet.has(l));
    if (labs.length >= 2) { const lt = labs.map((l) => px(R(l).top)); const lh = labs.map((l) => px(R(l).height)); if (spread(lt) > 1.5 || spread(lh) > 1.5) add("04-row-labels-not-on-one-line", "medium", labs[0], "labels of one form row are not on one baseline", `tops ${lt.join(" / ")}, heights ${lh.join(" / ")}`); }
  }

  // 5. tap targets under 44×44 (phone sizes)
  if (o.phone) {
    for (const el of inter) {
      let r = R(el);
      const lab = isField(el) ? labelOf(el) : null;
      let w = r.width; let h = r.height;
      if (el.matches("input[type=checkbox], input[type=radio]") && lab && visSet.has(lab)) { const lr = R(lab); w = Math.max(r.right, lr.right) - Math.min(r.left, lr.left); h = Math.max(r.bottom, lr.bottom) - Math.min(r.top, lr.top); }
      if (w >= 43.5 && h >= 43.5) continue;
      const s = cs(el);
      const inline = s.display === "inline" && el.parentElement && el.parentElement.innerText.trim().length > String(el.innerText || "").trim().length + 8;
      el.scrollIntoView({ block: "center", inline: "nearest", behavior: "instant" });
      r = R(el); const cx = r.left + r.width / 2; const cy = r.top + r.height / 2;
      const hit = (x, y) => { const e = document.elementFromPoint(clampX(x), Math.min(vh - 1, Math.max(0, y))); return !!e && (e === el || el.contains(e) || (!!lab && lab.contains(e))); };
      if (!hit(cx, cy)) continue;
      if (w < 43.5 && hit(cx - 21.5, cy) && hit(cx + 21.5, cy)) w = 44;
      if (h < 43.5 && hit(cx, cy - 21.5) && hit(cx, cy + 21.5)) h = 44;
      if (w >= 43.5 && h >= 43.5) continue;
      add(inline ? "05-inline-link-small" : "05-tap-target-small", inline ? "low" : Math.min(w, h) < 24 ? "high" : "medium", el, "tap target smaller than 44×44", `${px(w)}×${px(h)}`);
    }
    scrollTo(0, y0);
  }

  // 6. content under fixed layers: the end and the top of the page, a focused field, a dialog taller than the screen
  const coveredBy = (el) => {
    const r = R(el); const x = clampX(r.left + r.width / 2);
    for (const y of [r.top + r.height / 2, r.bottom - Math.min(6, r.height / 4)]) {
      if (y < 0 || y >= vh) continue;
      const h = document.elementFromPoint(x, y);
      if (!h || h === el || el.contains(h) || h.contains(el)) continue;
      const f = fixedAnc(h);
      if (f && f !== fixedAnc(el) && !f.contains(el)) return f;
    }
    return null;
  };
  const leaves = all.filter((el) => (el.matches(INTER) || ownText(el)) && !fixedAnc(el));
  if (!o.scope) {
    for (const [where, y, test] of [["end", maxY, (f) => R(f).top > vh / 2], ["top", 0, (f) => R(f).bottom < vh / 2]]) {
      scrollTo(0, y);
      const hidden = [];
      for (const el of leaves) { const f = coveredBy(el); if (f && test(f)) hidden.push([el, f]); }
      for (const [el, f] of hidden.filter(([el]) => !hidden.some(([x]) => x !== el && el.contains(x))).slice(-3)) {
        add(`06-covered-at-page-${where}`, "high", el, `covered by ${selOf(f)} when the page is scrolled to its ${where}`, `element ${px(R(el).top)}–${px(R(el).bottom)}, layer ${px(R(f).top)}–${px(R(f).bottom)}, viewport ${vh}`);
      }
    }
    scrollTo(0, y0);
  } else {
    const r = R(scope);
    if (r.bottom > vh + 1 || r.top < -1 || r.right > vw + 1 || r.left < -1) add("06-dialog-outside-screen", "high", scope, "the dialog is larger than the screen", `dialog ${px(r.left)}–${px(r.right)} × ${px(r.top)}–${px(r.bottom)}, screen ${vw}×${vh}`);
  }
  for (const el of fields.slice(0, 40)) {
    try { el.focus(); } catch (e) { continue; }
    const f = coveredBy(el);
    if (f) add("06-focused-field-covered", "high", el, `covered by ${selOf(f)} while it has the focus`, `field ${px(R(el).top)}–${px(R(el).bottom)}, layer ${px(R(f).top)}–${px(R(f).bottom)}`);
  }
  if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
  scrollTo(0, y0);

  // 7. the safe-area insets of an installed iPhone app
  if (o.safeTop && !o.scope) {
    scrollTo(0, 0);
    for (const el of all) {
      if (!(el.matches(INTER) || ownText(el))) continue;
      const r = R(el); const fx = fixedAnc(el);
      if (r.top < o.safeTop - 0.5 && r.bottom > 0) add("07-under-status-bar", el.matches(INTER) ? "high" : "medium", el, fx ? "a fixed layer puts this under the status-bar inset" : "under the status-bar inset at the top of the page", `top ${px(r.top)} < inset ${o.safeTop}`);
      if (fx && r.bottom > vh - o.safeBottom + 0.5 && r.top < vh) add("07-in-home-indicator-zone", "medium", el, "inside the home-indicator inset", `bottom ${px(r.bottom)} > ${vh - o.safeBottom}`);
    }
    if (maxY > 120) {
      scrollTo(0, Math.min(maxY, 300));
      const h = document.elementFromPoint(vw / 2, o.safeTop / 2);
      if (!h || !fixedAnc(h)) add("07-content-through-status-bar", "medium", null, "while scrolling, content passes under the status bar: nothing opaque covers the top inset", `inset ${o.safeTop}px`);
    }
    scrollTo(0, y0);
  }


  // 8. leftovers of the old style
  for (const el of all) {
    const s = cs(el);
    const dashed = ["Top", "Right", "Bottom", "Left"].some((k) => /dashed|dotted/.test(s[`border${k}Style`]) && parseFloat(s[`border${k}Width`]) > 0) || (/dashed|dotted/.test(s.outlineStyle) && parseFloat(s.outlineWidth) > 0);
    if (dashed) add("08-dashed-outline", "medium", el, "a dashed or dotted outline (the old style)", `${s.borderTopStyle} ${s.borderTopWidth}`);
  }
  const lists = new Map();
  for (const el of all) { if (el.tagName !== "LI") continue; const s = cs(el); if (s.display === "list-item" && s.listStyleType !== "none") lists.set(el.parentElement, [(lists.get(el.parentElement) || [0])[0] + 1, s.listStyleType]); }
  for (const [ul, [n, type]] of lists) add("08-plain-bullet-list", "low", ul, "a plain bullet list of items", `${n} items, ${type}`);
  const heads = all.filter((el) => el.matches("h2, h3"));
  const hasIco = (h) => !!(h.querySelector(".k-ico") || (h.previousElementSibling && h.previousElementSibling.matches(".k-ico")) || (h.parentElement && h.parentElement.matches(".k-head, .k-sidehead, .k-cardhead, .k-with-ico, .k-beside, .k-sec, .k-row, .k-notice, .k-head-t") && (h.parentElement.querySelector(".k-ico") || (h.parentElement.parentElement && h.parentElement.parentElement.querySelector(":scope > .k-ico")))));
  for (const tag of ["H2", "H3"]) {
    const g = heads.filter((h) => h.tagName === tag); const bare = g.filter((h) => !hasIco(h));
    if (bare.length && bare.length < g.length) for (const h of bare) add("08-heading-without-icon", "medium", h, `a ${tag.toLowerCase()} without the icon square, on a screen where ${g.length - bare.length} of ${g.length} have it`, "");
  }
  if (o.staff && !o.scope && heads.length && !all.some((el) => el.matches(".k-ico"))) add("08-screen-not-dressed", "low", heads[0], "no icon square anywhere on this screen", `${heads.length} headings`);
  const oldTags = all.filter((el) => el.matches(".tag")); const pills = all.filter((el) => el.matches(".k-pill"));
  if (oldTags.length && pills.length) add("08-old-tag-beside-kit-pill", "medium", oldTags[0], "the old .tag beside kit pills on one screen", `${oldTags.length} .tag, ${pills.length} .k-pill`);
  const fillOf = (el) => cs(el).backgroundColor;
  const btns = all.filter((el) => el.matches("button, a, input[type=submit], [role=button]"));
  const pinks = btns.filter((el) => o.hot.includes(fillOf(el)));
  const navies = btns.filter((el) => o.navy.includes(fillOf(el)) && !fixedAnc(el));
  if (!o.scope) {
    scrollTo(0, 0);
    const first = pinks.filter((el) => { const r = R(el); return r.top < vh && r.bottom > 0 && !fixedAnc(el); });
    if (first.length > 1) add("08-pink-primaries-on-one-screen", "medium", first[1], "more than one pink primary button on the first screen", `${first.length} on the first screen, ${pinks.length} on the page: ${first.slice(0, 4).map((e) => textOf(e).slice(0, 18)).join(" | ")}`);
    scrollTo(0, y0);
  }
  const AREA = "li, tr, .k-card, .card, form, dialog, .k-row, .k-line, article, section, .block";
  const areas = new Map();
  for (const el of pinks) { const a = el.closest(AREA); if (a) areas.set(a, [...(areas.get(a) || []), el]); }
  for (const [a, list] of areas) {
    if (list.length > 1) add("08-two-pinks-in-one-area", "medium", a, "two pink primary buttons in one area", list.slice(0, 3).map((e) => textOf(e).slice(0, 20)).join(" | "));
    const rival = navies.find((n) => n.closest(AREA) === a);
    if (rival) add("08-two-primaries-compete", "low", a, "a pink and a navy filled button compete in one area", `${textOf(list[0]).slice(0, 20)} | ${textOf(rival).slice(0, 20)}`);
  }

  // 9. inconsistent sizes among siblings
  for (const p of all) {
    const s = cs(p);
    const flexRow = s.display.includes("flex") && !s.flexDirection.startsWith("column");
    if (!flexRow && !s.display.includes("grid")) continue;
    const kids = [...p.children].filter((k) => visSet.has(k) && !/^(absolute|fixed)$/.test(cs(k).position));
    if (kids.length < 2) continue;
    const rows = [];
    for (const k of kids) {
      const r = R(k);
      const row = rows.find((g) => Math.min(g.r.bottom, r.bottom) - Math.max(g.r.top, r.top) > 0.5 * Math.min(g.r.height, r.height));
      if (row) row.items.push(k); else rows.push({ r, items: [k] });
    }
    for (const g of rows) {
      if (g.items.length < 2) continue;
      const ctls = g.items.filter((k) => k.matches("button, .btn, input[type=submit], select, input:not([type=checkbox]):not([type=radio]):not([type=hidden])"));
      if (ctls.length >= 2) { const hz = ctls.map((k) => px(R(k).height)); if (spread(hz) > 1.5) add("09-controls-of-one-row-differ", "medium", p, "controls of one row have different heights", hz.join(" / ")); }
      const cards = g.items.filter((k) => { const c = cs(k); const bg = c.backgroundColor; return R(k).height >= 48 && !k.matches("button, .btn, a, input, select, textarea") && ((bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent") || parseFloat(c.borderTopWidth) > 0 || c.boxShadow !== "none"); });
      if (cards.length >= 2 && cards.length === g.items.length) { const hz = cards.map((k) => px(R(k).height)); if (spread(hz) > 2) add("09-cards-of-one-row-ragged", "medium", p, "cards of one row have different heights", hz.join(" / ")); }
    }
  }
  for (const p of all) {
    const kids = [...p.children].filter((k) => visSet.has(k));
    if (kids.length < 3 || !kids.every((k) => k.tagName === kids[0].tagName && k.classList[0] === kids[0].classList[0])) continue;
    const sizes = [];
    for (const k of kids) { const ic = k.querySelector(".k-ico, svg, img"); if (ic && visSet.has(ic)) { const r = R(ic); sizes.push(`${Math.round(r.width)}×${Math.round(r.height)}`); } }
    const u = [...new Set(sizes)];
    if (sizes.length >= 3 && u.length > 1) add("09-icons-of-one-list-differ", "low", p, "the leading icons of one list have different sizes", u.join(" / "));
  }


  // 10. text contrast, from computed styles (4.5:1; 3:1 for large text and icon glyphs)
  const RX = /rgba?\([^)]+\)|color\(srgb [^)]+\)/g;
  const parse = (c) => {
    if (!c) return null;
    let m = c.match(/^rgba?\(([^)]+)\)/);
    if (m) { const p = m[1].split(/[,\s\/]+/).filter(Boolean).map(Number); return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1]; }
    m = c.match(/^color\(srgb ([^)]+)\)/);
    if (m) { const p = m[1].split(/[\s\/]+/).filter(Boolean).map(Number); return [p[0] * 255, p[1] * 255, p[2] * 255, p.length > 3 ? p[3] : 1]; }
    return null;
  };
  const over = (f, b) => [0, 1, 2].map((i) => f[i] * f[3] + b[i] * (1 - f[3])).concat(1);
  const lum = (c) => { const v = [0, 1, 2].map((i) => { const x = c[i] / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }); return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]; };
  const ratio = (a, b) => { const x = lum(a); const y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const hex = (c) => `#${[0, 1, 2].map((i) => Math.round(c[i]).toString(16).padStart(2, "0")).join("")}`;
  const bgsOf = (el) => {
    const layers = []; let grads = null;
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      const s = cs(n); const bi = s.backgroundImage;
      if (bi && bi !== "none") { if (bi.includes("url(")) return null; const g = (bi.match(RX) || []).map(parse).filter((x) => x && x[3] > 0.5); if (g.length) { grads = g; break; } }
      const b = parse(s.backgroundColor);
      if (b && b[3] > 0) { layers.push(b); if (b[3] >= 0.999) break; }
    }
    return (grads || [[255, 255, 255, 1]]).map((base) => layers.reduceRight((acc, l) => over(l, acc), base));
  };
  const opacityOf = (el) => { let v = 1; for (let n = el; n && n.nodeType === 1; n = n.parentElement) v *= parseFloat(cs(n).opacity); return v; };
  const seenC = new Set();
  const contrast = (el, color, need, kind) => {
    const fg = parse(color); const bgs = bgsOf(el);
    if (!fg || !bgs || fg[3] === 0) return;
    fg[3] *= opacityOf(el);
    let worst = 99; let wb = bgs[0];
    for (const b of bgs) { const v = ratio(over(fg, b), b); if (v < worst) { worst = v; wb = b; } }
    if (worst >= need - 0.005) return;
    const key = `${hex(over(fg, wb))}|${hex(wb)}|${one(el)}|${kind}`;
    if (seenC.has(key)) return; seenC.add(key);
    add(kind === "text" ? "10-contrast-text" : kind === "icon" ? "10-contrast-icon" : "10-contrast-placeholder", kind === "text" && need > 4 && worst < 3 ? "high" : kind === "placeholder" && worst >= 3 ? "low" : "medium", el, `${kind} contrast under ${need}:1`, `${worst.toFixed(2)}:1, ${hex(over(fg, wb))} on ${hex(wb)}${bgs.length > 1 ? " (worst stop of a gradient)" : ""}, ${cs(el).fontSize} ${cs(el).fontWeight}`);
  };
  for (const el of all) {
    if (el.closest("[disabled], [aria-disabled=true], option")) continue;
    const s = cs(el);
    if (el.tagName.toLowerCase() === "svg") { const col = s.stroke !== "none" ? s.stroke : s.fill !== "none" ? s.fill : s.color; contrast(el, /^(rgb|color)/.test(col) ? col : s.color, 3, "icon"); continue; }
    if (el.matches("input, textarea") && el.placeholder && !el.value) contrast(el, getComputedStyle(el, "::placeholder").color, 4.5, "placeholder");
    if (!ownText(el) && !(el.matches("input, textarea, select") && el.value)) continue;
    const size = parseFloat(s.fontSize); const large = size >= 24 || (size >= 18.66 && Number(s.fontWeight) >= 700);
    contrast(el, s.color, large ? 3 : 4.5, "text");
  }


  // 11. empty or broken content; 12. RTL mistakes in text
  const badRx = /(^|[^A-Za-z0-9_.])(undefined|NaN|null|Infinity)($|[^A-Za-z0-9_])|\[object [A-Za-z]+\]|Invalid Date|\{\{|\$\{/;
  const keyRx = /(^|\s)(p\d\d[a-z]?\.[a-z0-9_.]+|[a-z]{2,}(_[a-z0-9]+)+)(\s|$)/;
  const tw = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
  for (let n = tw.nextNode(); n; n = tw.nextNode()) {
    const t = n.nodeValue.replace(/\s+/g, " ").trim(); if (!t) continue;
    const p = n.parentElement; if (!p || !visSet.has(p) || p.closest("script, style, textarea, code, pre")) continue;
    if (badRx.test(t)) add("11-broken-text", "high", p, "a broken value in the text", t.slice(0, 80));
    else if (keyRx.test(t) && !/@|:\/\//.test(t)) add("11-raw-key", "medium", p, "looks like a raw key instead of words", t.slice(0, 80));
    if (cs(p).direction !== "rtl") continue;
    if (/[←→]/.test(t)) {
      const back = /חזרה|חזור|קודם|אחורה/.test(t); const fwd = /הבא|המשך|מעבר|לכרטיס|פתיחת|לעמוד|כל ה/.test(t);
      if ((t.includes("→") && fwd && !back) || (t.includes("←") && back && !fwd)) add("12-arrow-wrong-way", "medium", p, "the arrow points against the reading direction", t.slice(0, 60));
      else add("12-arrow-glyph", "low", p, "an arrow glyph inside RTL text: check its direction by eye", t.slice(0, 60));
    }
    if (/(^|\s)([+\-]\d|[@#][A-Za-z])/.test(t) && cs(p).unicodeBidi === "normal" && !p.closest("bdi, bdo")) add("12-sign-jumps-side", "medium", p, "a sign before a number or a Latin word lands on its other side in RTL (no dir=ltr or bdi around it)", t.slice(0, 80));
  }
  for (const el of fields) {
    if (/^(undefined|NaN|null|\[object)/.test(el.value || "")) add("11-broken-text", "high", el, "a broken value in a field", el.value.slice(0, 40));
    if (el.matches("input[type=email], input[type=url], input[type=tel], input[type=number], input[inputmode=numeric], input[inputmode=decimal], input[inputmode=tel]") && cs(el).direction === "rtl") add("12-ltr-field-in-rtl", "low", el, "a field of left-to-right content (email, phone, number, link) is laid out right-to-left", el.type);
  }
  for (const el of all) { if (ownText(el) && cs(el).direction === "rtl" && cs(el).textAlign === "left" && /[֐-׿]/.test(el.textContent)) add("12-text-align-left", "medium", el, "Hebrew text aligned to the left by a physical text-align", ""); }
  for (const el of inter) {
    if (isField(el)) {
      if (!(el.getAttribute("aria-label") || el.getAttribute("aria-labelledby") || labelOf(el) || el.title)) add("11-field-without-label", "medium", el, "a field with no label", el.placeholder ? `placeholder only: ${el.placeholder}` : "");
      continue;
    }
    const name = String(el.innerText || "").trim() || el.getAttribute("aria-label") || el.getAttribute("aria-labelledby") || el.title || (el.querySelector("img[alt]") && el.querySelector("img[alt]").alt);
    if (!name) add(el.querySelector("svg, img") || cs(el).backgroundImage !== "none" ? "11-icon-control-without-name" : "11-empty-control", el.querySelector("svg, img") ? "medium" : "high", el, "a control with no text and no name", el.outerHTML.slice(0, 80));
  }
  for (const img of scope.querySelectorAll("img")) { if (img.getAttribute("src") && img.complete && img.naturalWidth === 0 && img.parentElement && img.parentElement.checkVisibility()) add("11-image-failed", "high", img.parentElement, "an image failed to load", img.getAttribute("src").slice(0, 80)); }
  for (const h of scope.querySelectorAll("h1, h2, h3, h4")) { if (h.checkVisibility() && !h.textContent.trim() && !h.closest("[data-vs-skip]")) add("11-empty-heading", "medium", h, "a heading with no text", ""); }
  for (const el of all) {
    if (el.children.length || el.textContent.trim() || el.matches("input, textarea, select, img, svg, canvas, video, iframe, hr, progress, meter, br, button, a")) continue;
    const r = R(el); if (r.height < 32 || r.width < 120) continue;
    const s = cs(el);
    if (getComputedStyle(el, "::before").content !== "none" || getComputedStyle(el, "::after").content !== "none" || s.backgroundImage !== "none") continue;
    const bg = s.backgroundColor;
    if ((bg !== "rgba(0, 0, 0, 0)" && bg !== (el.parentElement ? cs(el.parentElement).backgroundColor : "")) || parseFloat(s.borderTopWidth) > 0) add("11-empty-box", "low", el, "an empty box is drawn", `${px(r.width)}×${px(r.height)}`);
  }

  // 13. (the part that needs no keyboard) something clickable that the keyboard cannot reach
  for (const el of all) {
    if (cs(el).cursor !== "pointer" || el.closest(`${INTER}, label`) || el.querySelector(INTER)) continue;
    if (el.parentElement && cs(el.parentElement).cursor === "pointer") continue;
    add("13-clickable-not-focusable", "medium", el, "looks clickable (pointer cursor) but is not a control the keyboard can reach", "");
  }
  return { findings: out, more, meta: { h: de.scrollHeight, vh, hs, pinks: pinks.length, noAccess: !!document.querySelector("#state.no-access, .no-access") } };
}

