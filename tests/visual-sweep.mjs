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
    if (el.id) return `${t}#${norm(el.id).replace(/\d+/g, "N")}`;
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
  const all0 = [...scope.querySelectorAll("*")].filter((el) => !(el instanceof SVGElement && el.tagName.toLowerCase() !== "svg") && !el.closest("[data-vs-skip]") && vis(el));
  // what sits inside a 1px clipped box is for screen readers only
  const tiny = [...scope.querySelectorAll("*")].filter((el) => { const r = R(el); return el.children.length && (r.width <= 1.5 || r.height <= 1.5) && getComputedStyle(el).overflow !== "visible"; });
  const all = all0.filter((el) => !tiny.some((c) => c !== el && c.contains(el)));
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
      if (cs(a).display === "inline" || cs(b).display === "inline") continue; // a line that wraps
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
      add(inline ? "05-inline-link-small" : "05-tap-target-small", inline ? "low" : Math.min(w, h) < 24 && !el.matches("a") ? "high" : "medium", el, "tap target smaller than 44×44", `${px(w)}×${px(h)}`);
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
  if (o.light) { /* a sheet is open over the page: the page is not scrolled */ } else if (!o.scope) {
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
  for (const el of o.light ? [] : fields.slice(0, 40)) {
    try { el.focus(); } catch (e) { continue; }
    const f = coveredBy(el);
    if (f) add("06-focused-field-covered", "medium", el, `covered by ${selOf(f)} while it has the focus`, `field ${px(R(el).top)}–${px(R(el).bottom)}, layer ${px(R(f).top)}–${px(R(f).bottom)}`);
  }
  if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
  scrollTo(0, y0);

  // 7. the safe-area insets of an installed iPhone app
  if (o.safeTop && !o.scope && !o.light) {
    scrollTo(0, 0);
    const under = [];
    for (const el of all) {
      if (!(el.matches(INTER) || ownText(el))) continue;
      const r = R(el); const fx = fixedAnc(el);
      if (r.top < o.safeTop - 0.5 && r.bottom > 0 && el.matches(INTER)) under.push(el);
      if (fx && cs(fx).position === "fixed" && r.bottom > vh - o.safeBottom + 0.5 && r.top < vh) add("07-in-home-indicator-zone", "medium", el, "inside the home-indicator inset", `bottom ${px(r.bottom)} > ${vh - o.safeBottom}`);
    }
    if (under.length) add("07-under-status-bar", "medium", under[0], "controls sit inside the status-bar inset at the top of the page (it matters when the installed app draws under the status bar)", `${under.length} controls; the first at top ${px(R(under[0]).top)} < inset ${o.safeTop}`);
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
  const pinks = btns.filter((el) => o.hot.includes(fillOf(el)) && !el.matches("[role=tab], .tab"));
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
    add(kind === "text" ? "10-contrast-text" : kind === "icon" ? "10-contrast-icon" : "10-contrast-placeholder", bgs.length > 1 ? "low" : kind === "text" && need > 4 && worst < 3 ? "high" : kind === "placeholder" && worst >= 3 ? "low" : "medium", el, `${kind} contrast under ${need}:1`, `${worst.toFixed(2)}:1, ${hex(over(fg, wb))} on ${hex(wb)}${bgs.length > 1 ? " (worst stop of a gradient)" : ""}, ${cs(el).fontSize} ${cs(el).fontWeight}`);
  };
  for (const el of all) {
    if (el.closest("[disabled], [aria-disabled=true], option")) continue;
    const s = cs(el);
    if (el.tagName.toLowerCase() === "svg") { const col = s.stroke !== "none" ? s.stroke : s.fill !== "none" ? s.fill : s.color; contrast(el, /^(rgb|color)/.test(col) ? col : s.color, 3, "icon"); continue; }
    if (el.matches("input, textarea") && el.placeholder && !el.value) contrast(el, getComputedStyle(el, "::placeholder").color, 4.5, "placeholder");
    if (!ownText(el) && !(fields.includes(el) && el.value)) continue;
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
      const back = /חזרה|חזור|קודם|אחורה/.test(t) || !!p.closest(".back, #back, [class*=back]"); const fwd = /הבא|המשך|מעבר|פתיחת|לעמוד/.test(t);
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


// ── The matrix ───────────────────────────────────────────────────────────────────────
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const argv = process.argv.slice(2);
const arg = (name) => { const i = argv.indexOf(`--${name}`); if (i < 0) return null; const v = argv[i + 1]; return v && !v.startsWith("--") ? v : "1"; };
const pick = (name) => (arg(name) ? arg(name).split(",") : null);
const OUT = path.resolve(arg("out") || path.join(os.tmpdir(), "astrateg-visual-sweep"));
const JOBS = Number(arg("jobs") || 5);
// `safe`: an installed iPhone app. The insets are real env(safe-area-inset-*) values (CDP
// Emulation.setSafeAreaInsetsOverride); "standalone" is answered by matchMedia and
// navigator.standalone (the app reads it only from script, never from CSS).
const SIZES = {
  "390pwa": { w: 390, h: 844, phone: true, safe: [59, 34] },
  "1280": { w: 1280, h: 800 },
  "360": { w: 360, h: 740, phone: true },
  "390": { w: 390, h: 844, phone: true },
  "393pwa": { w: 393, h: 852, phone: true, safe: [59, 34] },
  "820": { w: 820, h: 1180, touch: true },
  "1440": { w: 1440, h: 900 },
};
const WORLDS = { normal: () => lateWorld(), worst: () => worstWorld(), empty: () => emptyWorld(), one: () => oneWorld() };
// world -> sizes. The default is the pre-publish pass; --full is everything.
const PLAN = arg("full")
  ? { normal: ["390pwa", "1280", "360", "390", "393pwa", "820", "1440"], worst: ["360", "390pwa", "1280"], empty: ["390pwa", "1280"], one: ["390pwa"] }
  : arg("quick") ? { normal: ["390pwa"] } : { normal: ["390pwa", "1280"] };
const HOT = ["rgb(248, 34, 114)", "rgb(255, 61, 133)"];   // --ds-hot, --ds-hot-hover
const NAVY = ["rgb(7, 20, 51)", "rgb(28, 47, 107)"];      // --ds-navy, --ds-navy-2
const SEV = ["blocker", "high", "medium", "low"];
const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*", "access-control-expose-headers": "*" };
const TOKEN = "t".repeat(43);                      // the links a client gets (status, access form, scripts, Gantt)
const QID = (n) => `00000000-0000-4000-8000-00000000000${n}`;
const PROFILED = ["owner", "irit", "lior", "ofir"];

// Findings that were looked at and are meant to be so: [check, selector or text, why].
const ACCEPTED = [
];

// Every screen of one role: its menu (both profiles for whoever has two), each client page
// it may open, and one page it may not ("אין לך גישה").
function targetsOf(role) {
  const me = ROLES[role];
  const viewer = { me, scope: scopeOf(me), error: null };
  const out = [];
  const seen = new Set();
  const push = (t) => { const k = `${t.profile || ""}|${t.path}`; if (!seen.has(k)) { seen.add(k); out.push({ kind: "staff", role, ...t }); } };
  const tabbed = new Set();
  for (const profile of PROFILED.includes(role) ? ["mine", "manager"] : [null]) {
    for (const it of profileMenu(viewer, profile || "mine")) {
      if (it.id === "payouts") continue; // another app, with its own gate
      const file = it.href.split(/[?#]/)[0];
      if (file === "clients.html" || file === "owner.html") {
        // one target per file and profile: its tabs are walked one by one
        const k = `${profile}|${file}`;
        if (tabbed.has(k)) continue;
        tabbed.add(k);
        push({ profile, path: it.href, name: `${file.replace(".html", "")}${profile === "manager" ? "-manager" : ""}`, tabs: true });
      } else push({ profile, path: it.href, name: it.id });
    }
  }
  const office = viewer.scope === "office";
  const card = { owner: [4, 12], irit: [4, 12], lior: [7], ofir: [12], ilai: [17], nirel: [15], nadia: [12], eli: [7] }[role] || [];
  for (const n of card) push({ profile: PROFILED.includes(role) ? "mine" : null, path: `client.html?id=${cid(n)}`, name: `client-${n}` });
  if (["owner", "irit", "lior", "ofir"].includes(role)) push({ profile: null, path: `intake.html?id=${cid(7)}`, name: "intake" });
  if (["owner", "lior"].includes(role)) push({ profile: null, path: `scripts.html?id=${cid(7)}`, name: "scripts" });
  if (["owner", "ilai", "irit"].includes(role)) push({ profile: null, path: `gantt.html?id=${cid(12)}`, name: "gantt-client" });
  if (role !== "stav") push({ profile: null, path: "landing.html", name: "landing" });
  if (role === "owner") push({ profile: null, path: "deal.html", name: "deal" });
  const mine = new Set([...menuOf(viewer).map((i) => i.href.split(/[?#]/)[0]), ...out.map((t) => t.path.split(/[?#]/)[0])]);
  const closed = ["qa.html", "index.html", "decisions.html", "team.html", "quotes.html", "landing.html", "owner.html"].find((f) => !mine.has(f));
  if (closed) push({ profile: null, path: closed, name: `no-access-${closed.replace(".html", "")}` });
  return out;
}
// The pages a client opens from a link, and the sign-in screen: no session.
const PUBLIC_TARGETS = [
  { kind: "public", role: "client", path: `q.html?t=${QID(1)}`, name: "q-quote" },
  { kind: "public", role: "client", path: `q.html?t=${QID(2)}`, name: "q-agreement" },
  { kind: "public", role: "client", path: `q.html?t=${QID(3)}`, name: "q-signed" },
  { kind: "public", role: "client", path: `q.html?t=${QID(4)}`, name: "q-expired" },
  { kind: "public", role: "client", path: `q.html?t=${QID(9)}`, name: "q-not-found" },
  { kind: "public", role: "client", path: `status.html#t=${TOKEN}`, name: "status" },
  { kind: "public", role: "client", path: `status.html#t=${"x".repeat(43)}`, name: "status-invalid" },
  { kind: "public", role: "client", path: `gallery.html?t=${"g".repeat(43)}`, name: "gallery" },
  { kind: "public", role: "client", path: `access.html#t=${TOKEN}`, name: "access" },
  { kind: "public", role: "client", path: `scripts-view.html#t=${TOKEN}`, name: "scripts-view" },
  { kind: "public", role: "client", path: `gantt.html?t=${TOKEN}`, name: "gantt-share" },
  { kind: "login", role: "anon", path: "clients.html", name: "sign-in" },
  { kind: "login", role: "anon", path: "index.html", name: "builder-signed-out" },
];
function allTargets() {
  const roles = pick("role") || [...Object.keys(ROLES).filter((r) => !["yariv", "anna"].includes(r)), "client", "anon"];
  const pages = pick("page");
  const list = [];
  for (const r of roles) list.push(...(r === "client" || r === "anon" ? PUBLIC_TARGETS.filter((t) => t.role === r) : targetsOf(r)));
  return pages ? list.filter((t) => pages.some((p) => t.path.startsWith(p) || t.name === p)) : list;
}


// ── The server and the fake database ─────────────────────────────────────────────────
import { buildQuoteModel, emptySelection } from "../app/pricing.js";

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".png": "image/png", ".svg": "image/svg+xml", ".json": "application/json", ".webmanifest": "application/manifest+json", ".woff2": "font/woff2", ".woff": "font/woff", ".ico": "image/x-icon", ".jpg": "image/jpeg", ".webp": "image/webp" };
function serve() {
  return new Promise((done) => {
    const srv = http.createServer(async (req, rsp) => {
      try {
        let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
        if (p.endsWith("/")) p += "index.html";
        const file = path.join(ROOT, p);
        if (!file.startsWith(ROOT)) throw new Error("outside");
        const body = await readFile(file);
        rsp.writeHead(200, { "content-type": TYPES[path.extname(file)] || "application/octet-stream", "cache-control": "no-store" });
        rsp.end(body);
      } catch (e) { rsp.writeHead(404); rsp.end("not found"); }
    });
    srv.listen(0, () => done(srv));
  });
}

// What the client pages ask for (as the suites of each page answer it), on top of the office fake.
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
function quoteView(n, worst) {
  const client = worst
    ? { name: "אלכסנדרה־מרגריטה ויינשטיין־בן־אברהם דה לה פואנטה", company: "המרכז הבינתחומי לרפואה משלימה, פיזיותרפיה ושיקום ספורטיבי בע״מ", phone: "+972-50-1234567" }
    : { name: "דנה לוי", company: "קפה דנה", phone: "050-1234567" };
  const docType = n === 1 ? "quote" : "agreement";
  const model = buildQuoteModel({ ...emptySelection(), docType, discount: n === 2 ? 20000 : 0 }, client);
  const created = new Date(NOW.getTime() - (n === 4 ? 200 : 2) * 3600e3).toISOString();
  const expires = new Date(Date.parse(created) + model.validHours * 3600e3).toISOString();
  model.validUntil = expires;
  const signed = n === 3;
  return { number: `AST-2026-000${n}`, createdAt: created, model, docHash: "ab".repeat(32), expiresAt: expires, expired: n === 4,
    consentText: `קראתי ואני מאשר/ת את ${docType === "quote" ? "הצעת המחיר" : "ההסכם"} AST-2026-000${n}`, signatureHash: signed ? "cd".repeat(32) : null,
    status: signed ? "signed" : "sent", signerName: signed ? client.name : null, signedAt: signed ? NOW.toISOString() : null, signaturePng: signed ? PNG : null };
}
function publicAnswer(p, body, db, worst) {
  const c = db.clients.find((x) => x.id === cid(12)) || db.clients[0] || { name: "לקוח", business: "עסק", status: "active", links: {} };
  const ok = body.p_token === TOKEN;
  const far = "2027-10-11T09:00:00Z";
  if (p === "/rest/v1/rpc/get_quote") return [1, 2, 3, 4].map(QID).includes(body.p_token) ? quoteView(Number(body.p_token.slice(-1)), worst) : null;
  if (p === "/rest/v1/rpc/get_status") {
    if (!ok) return { state: "invalid" };
    const it = (item, key, state) => ({ item, key, shootRound: 1, state, round: 1, included: 1, sentAt: "2026-10-18T09:00:00+03:00", approvedAt: null, link: item === "scripts" ? null : "https://drive.example.com/folder" });
    return { state: "ok", preview: false, expiresAt: far,
      client: { name: c.name, business: c.business, status: c.status, shootType: c.shoot_type, charAt: c.char_at, shootAt: c.shoot_at, contractEnd: c.contract_end, rounds: [] },
      marks: Object.fromEntries(db.protocol_checks.filter((x) => x.client_id === c.id).map((x) => [x.item_key, { s: x.state, at: null }])),
      links: { drive: "https://drive.example.com/folder" },
      items: [it("graphics9", "p07.approved", "approved"), it("scripts", "p13.approved", "approved"), it("graphics", "p23.approved", "waiting"), it("videos", "p27.approved", "waiting")],
      approvals: [{ item: "graphics9", key: "p07.approved", shootRound: 1, decision: "approve", round: 1, name: c.name, note: null, at: "2026-10-01T09:00:00+03:00" }],
      thursday: { body: "שלום, השבוע סיימנו את עריכת הסרטונים והם אצל אופיר לבדיקה. בשבוע הבא נשלח אותם אליכם לאישור.", at: "2026-10-15T16:00:00+03:00" },
      surveys: { due: c.shoot_at ? ["shoot"] : [], answered: [] } };
  }
  if (p === "/rest/v1/rpc/access_form_info") return ok ? { state: "ok", business: c.business, preview: false } : { state: "invalid" };
  if (p === "/rest/v1/rpc/get_scripts") {
    if (!ok) return { state: "invalid" };
    const src = db.clients.find((x) => x.id === cid(7)) || c;
    return { state: "ok", preview: false, expiresAt: far, client: { name: src.name, business: src.business || src.name },
      scripts: db.client_scripts.map((s) => ({ round: s.round, n: s.n, title: s.title, body: s.body, links: s.links, status: s.status, at: s.at })) };
  }
  if (p === "/rest/v1/rpc/get_gantt") {
    if (!ok) return { state: "invalid" };
    const e = (key, kind, title, day, state) => ({ key, kind, title, day, time: "18:00", num: 1, state, postedOn: state === "posted" ? day : null, link: null });
    return { state: "ok", preview: false, expiresAt: far, client: { business: c.business || c.name, dealAt: c.deal_at, contractEnd: c.contract_end },
      entries: [e("a1", "video", "סרטון 1: פתיחת העונה", "2026-10-12", "posted"), e("a2", "graphic", "גרפיקה 3", "2026-10-22", "scheduled"), e("a3", "video", "סרטון 2", "2026-10-29", "planned"), e("a4", "story", "סטורי", "2026-11-03", "planned")] };
  }
  return undefined;
}
function routeFor(db, worst) {
  const fake = makeFlowFake(db);
  return async (r) => {
    const req = r.request();
    const p = new URL(req.url()).pathname;
    if (req.method() === "POST") {
      let body = {};
      try { body = JSON.parse(req.postData() || "{}"); } catch (e) { body = {}; }
      const out = publicAnswer(p, body, db, worst);
      if (out !== undefined) return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(out), headers: CORS });
    }
    return fake.route(r);
  };
}


// ── One page, one role, one size, one world ──────────────────────────────────────────
function initScript(o) {
  window.__vs = { cls: 0, shifts: [] };
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        if (e.hadRecentInput) continue;
        window.__vs.cls += e.value;
        window.__vs.shifts.push({ v: Math.round(e.value * 1000) / 1000, t: Math.round(e.startTime), n: (e.sources || []).slice(0, 3).map((s) => (s.node && s.node.nodeType === 1 ? (s.node.id ? `#${s.node.id}` : `${s.node.tagName.toLowerCase()}.${s.node.className}`) : "")).join(", ") });
      }
    }).observe({ type: "layout-shift", buffered: true });
  } catch (e) { /* no layout-shift entries here */ }
  if (o.standalone) {
    const mm = window.matchMedia.bind(window);
    window.matchMedia = (q) => (/display-mode:\s*standalone/.test(q) ? { matches: true, media: q, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false; } } : mm(q));
    try { Object.defineProperty(navigator, "standalone", { get: () => true }); } catch (e) { /* fixed */ }
  }
}
const settle = async (page, ms = 450) => { await page.waitForLoadState("networkidle", { timeout: 6000 }).catch(() => {}); await page.waitForTimeout(ms); };
async function signIn(page, base, t) {
  await page.goto(`${base}clients.webmanifest`);
  return page.evaluate(async ({ supa, email, profile }) => {
    const r = await fetch(`${supa}/auth/v1/token?grant_type=password`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password: "correct-horse" }) });
    if (!r.ok) return false;
    localStorage.setItem("sb-czncjzziqrqtezpwxxpz-auth-token", JSON.stringify(await r.json()));
    if (profile) localStorage.setItem("astrateg.profile", profile);
    return true;
  }, { supa: SUPA, email: emailOf(t.role), profile: t.profile || null });
}
async function ready(page, t) {
  if (t.kind === "login") { await page.waitForSelector("#lg-email", { state: "visible", timeout: 10000 }).catch(() => {}); await settle(page, 700); return; }
  await page.waitForFunction(() => !document.documentElement.hasAttribute("data-boot"), null, { timeout: 12000 }).catch(() => {});
  await settle(page);
  if (t.kind === "staff" && await page.locator("#lg-email").isVisible().catch(() => false)) {
    // the session did not take: go in through the form
    await page.fill("#lg-email", emailOf(t.role)); await page.fill("#lg-pass", "correct-horse"); await page.click("#lg-submit");
    await page.waitForFunction(() => !document.documentElement.hasAttribute("data-boot") && !document.documentElement.hasAttribute("data-door"), null, { timeout: 12000 }).catch(() => {});
    await settle(page, 1500);
  }
}
// Screenshots as a person sees the page: the viewport at the top, then scrolled, then at the
// very end (so the bars are where they are on the device). At most `cap` pictures.
async function shoot(page, file, size, whole) {
  const files = [];
  if (!whole) { await page.screenshot({ path: `${file}.png` }).catch(() => {}); return [`${file}.png`]; }
  const m = await page.evaluate(() => { scrollTo(0, 0); return { h: document.documentElement.scrollHeight, vh: innerHeight }; });
  const max = Math.max(0, m.h - m.vh);
  const step = m.vh - (size.phone ? 150 : 100);
  const cap = size.phone ? 6 : 3;
  const ys = [];
  for (let y = 0; y < max && ys.length < cap - 1; y += step) ys.push(y);
  ys.push(max);
  for (let i = 0; i < ys.length; i += 1) {
    await page.evaluate((y) => scrollTo(0, y), ys[i]);
    await page.waitForTimeout(70);
    const f = `${file}-${i + 1}.png`;
    await page.screenshot({ path: f }).catch(() => {});
    files.push(f);
  }
  await page.evaluate(() => scrollTo(0, 0));
  return files;
}
// 13. Tab through the page: every control reached, a visible ring, never behind a bar.
async function focusPass(page) {
  const n = await page.evaluate(() => {
    const sel = "a[href], button, input:not([type=hidden]), select, textarea, summary, [tabindex]:not([tabindex=\"-1\"])";
    const els = [...document.querySelectorAll(sel)].filter((el) => !el.disabled && el.checkVisibility({ checkVisibilityCSS: true }) && el.getBoundingClientRect().width > 0 && !el.closest("[inert]"));
    const snap = (el) => { const s = getComputedStyle(el); return [s.outlineStyle, s.outlineWidth, s.outlineColor, s.boxShadow, s.borderTopColor, s.backgroundColor, s.textDecorationLine].join("|"); };
    window.__vsSnap = snap;
    window.__vsF = els.map((el) => ({ el, base: snap(el), wrap: el.parentElement ? snap(el.parentElement) : "", seen: false }));
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    scrollTo(0, 0);
    return els.length;
  });
  const res = { n, visited: 0, noRing: [], hidden: [], lost: 0, unreached: [], whole: false };
  let lastLost = false;
  for (let i = 0; i < Math.min(n + 8, 130); i += 1) {
    await page.keyboard.press("Tab");
    const r = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return { lost: true };
      const rec = window.__vsF.find((x) => x.el === el);
      const label = `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : el.classList.length ? `.${[...el.classList].slice(0, 2).join(".")}` : ""}`.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, "{id}");
      const text = String(el.innerText || el.getAttribute("aria-label") || el.placeholder || "").replace(/\s+/g, " ").trim().slice(0, 40);
      if (!rec) return { other: true, label, text };
      if (rec.seen) return { again: true };
      rec.seen = true;
      const s = getComputedStyle(el);
      const ring = (s.outlineStyle !== "none" && parseFloat(s.outlineWidth) > 0) || window.__vsSnap(el) !== rec.base || (el.parentElement ? window.__vsSnap(el.parentElement) : "") !== rec.wrap;
      const b = el.getBoundingClientRect();
      const x = Math.min(innerWidth - 2, Math.max(2, b.left + b.width / 2)); const y = b.top + b.height / 2;
      let hid = null;
      if (y < 0 || y >= innerHeight) hid = "outside the viewport";
      else {
        const h = document.elementFromPoint(x, y);
        if (h && h !== el && !el.contains(h) && !h.contains(el)) {
          let f = null;
          for (let q = h; q && q.nodeType === 1; q = q.parentElement) { const p = getComputedStyle(q).position; if (p === "fixed" || p === "sticky") { f = q; break; } }
          if (f && !f.contains(el)) hid = `${f.tagName.toLowerCase()}${f.id ? `#${f.id}` : `.${f.className}`}`;
        }
      }
      return { ring, hid, label, text };
    });
    if (r.again) { if (lastLost) res.lost -= 1; res.whole = true; break; }
    lastLost = !!r.lost;
    if (r.lost) { res.lost += 1; continue; }
    if (r.other) continue;
    res.visited += 1;
    if (!r.ring) res.noRing.push(r);
    if (r.hid) res.hidden.push(r);
  }
  if (res.whole) res.unreached = await page.evaluate(() => window.__vsF.filter((x) => !x.seen && x.el.checkVisibility({ checkVisibilityCSS: true })).slice(0, 6).map((x) => ({ label: `${x.el.tagName.toLowerCase()}${x.el.id ? `#${x.el.id}` : `.${x.el.className}`}`, text: String(x.el.innerText || x.el.getAttribute("aria-label") || "").trim().slice(0, 40) })));
  await page.evaluate(() => { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); scrollTo(0, 0); });
  return res;
}


async function runJob(browser, base, job, sink) {
  const { t, sizeKey, worldKey } = job;
  const size = SIZES[sizeKey];
  const where = { page: t.path.split(/[?#]/)[0], target: t.name, role: t.role, profile: t.profile || "", size: sizeKey, world: worldKey };
  const dir = path.join(OUT, "shots", worldKey, sizeKey);
  await mkdir(dir, { recursive: true });
  const slug = `${t.role}${t.profile === "manager" ? "+mgr" : ""}--${t.name}`;
  const note = (check, sev, what, nums = "", extra = {}) => sink.push({ check, sev, sel: "", text: "", what, nums, y: 0, state: "default", shot: "", ...where, ...extra });
  const ctx = await browser.newContext({ locale: "he-IL", timezoneId: "Asia/Jerusalem", viewport: { width: size.w, height: size.h }, isMobile: !!size.phone, hasTouch: !!(size.phone || size.touch), deviceScaleFactor: 1 });
  try {
    await ctx.clock.install({ time: NOW });
    await ctx.route(`${SUPA}/**`, routeFor(WORLDS[worldKey](), worldKey === "worst"));
    await ctx.addInitScript(initScript, { standalone: !!size.safe });
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e).slice(0, 220)));
    page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text().slice(0, 220)); });
    if (size.safe) {
      const cdp = await ctx.newCDPSession(page);
      await cdp.send("Emulation.setSafeAreaInsetsOverride", { insets: { top: size.safe[0], bottom: size.safe[1], left: 0, right: 0 } }).catch(() => note("00-no-safe-area-emulation", "low", "this Chromium cannot emulate the safe-area insets: checks 7 did not run"));
    }
    const rec = async (state, opts = {}) => {
      const res = await page.evaluate(audit, { phone: !!size.phone, safeTop: size.safe ? size.safe[0] : 0, safeBottom: size.safe ? size.safe[1] : 0, scope: opts.scope || null, light: !!opts.one, staff: t.kind === "staff", hot: HOT, navy: NAVY })
        .catch((e) => ({ findings: [{ check: "00-audit-failed", sev: "low", sel: "", text: "", what: String(e).slice(0, 200), nums: "", y: 0 }], more: {}, meta: {} }));
      const shots = arg("no-shots") ? [] : await shoot(page, path.join(dir, `${slug}--${state}`), size, !opts.scope && !opts.one);
      for (const f of res.findings) {
        if (opts.forced && /^11-(empty|field)/.test(f.check)) continue; // a dialog opened by the sweep, not by its button: its text is not filled in
        sink.push({ ...f, ...where, state, shot: shots[0] ? path.relative(OUT, shots[0]).split(path.sep).join("/") : "", more: res.more[f.check] > 10 ? res.more[f.check] : 0 });
      }
      return res;
    };
    await runStates(page, base, t, size, rec, note, dir, slug);
    for (const e of [...new Set(errors)].slice(0, 4)) note("00-page-error", "high", "an error in the browser console", e);
  } catch (e) {
    note("00-sweep-failed", "low", "the sweep itself failed on this page", String(e).slice(0, 200));
  } finally {
    await ctx.close().catch(() => {});
  }
}


const tokenOf = (page, email) => page.evaluate(async ({ supa, mail }) => {
  const r = await fetch(`${supa}/auth/v1/token?grant_type=password`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: mail, password: "correct-horse" }) });
  return (await r.json()).access_token;
}, { supa: SUPA, mail: email });

async function runStates(page, base, t, size, rec, note, dir, slug) {
  if (t.kind === "staff") await signIn(page, base, t);
  if (t.name === "set-password") {
    await page.goto(`${base}clients.webmanifest`);
    const tok = await tokenOf(page, emailOf("irit"));
    await page.goto(`${base}quotes.html#access_token=${tok}&expires_in=3600&refresh_token=r&token_type=bearer&type=recovery`);
    const open = await page.waitForSelector("#dlg-password[open]", { timeout: 8000 }).catch(() => null);
    await settle(page, 600);
    if (!open) { note("00-set-password-not-shown", "medium", "the choose-a-password dialog did not open from a recovery link in the fake"); return null; }
    await rec("empty", { scope: "#dlg-password" });
    await page.fill("#pw-new", "short").catch(() => {});
    await page.fill("#pw-again", "different-one").catch(() => {});
    await page.click("#pw-submit").catch(() => {});
    await page.waitForTimeout(400);
    await rec("error", { scope: "#dlg-password" });
    return null;
  }
  await page.goto(base + t.path);
  await ready(page, t);
  if (await page.evaluate(() => document.documentElement.hasAttribute("data-boot")).catch(() => false)) note("00-page-never-shown", "blocker", "the page is still hidden behind its loading skeleton after 12 seconds");
  if (size.safe) {
    // the two insets, tinted, so that a picture shows what sits under them
    await page.evaluate(([top, bottom]) => {
      for (const [side, h] of [["top", top], ["bottom", bottom]]) {
        const d = document.createElement("div");
        d.setAttribute("data-vs-skip", "");
        d.style.cssText = `position:fixed;left:0;right:0;${side}:0;height:${h}px;background:rgba(255,0,0,.14);outline:1px solid rgba(255,0,0,.45);pointer-events:none;z-index:2147483647`;
        document.documentElement.append(d);
      }
    }, size.safe);
  }
  const first = await rec("default");
  await motionAndFocus(page, note);
  if (t.kind === "login" && t.name === "sign-in") return signInStates(page, size, rec, dir, slug);
  if (size.phone && await page.locator("#side-more").isVisible().catch(() => false)) {
    await page.click("#side-more").catch(() => {});
    await page.waitForTimeout(350);
    await rec("more-sheet", { one: true });
    await page.keyboard.press("Escape");
    await page.waitForTimeout(150);
  }
  if (first.meta.noAccess) return null;
  return openEverything(page, t, rec);
}


// 14. layout shift while loading, what still moves under prefers-reduced-motion; 13. the keyboard
async function motionAndFocus(page, note) {
  const vsd = await page.evaluate(() => window.__vs).catch(() => null);
  if (vsd && vsd.cls > 0.02) note("14-layout-shift", vsd.cls > 0.25 ? "high" : vsd.cls > 0.1 ? "medium" : "low", "the layout shifts while the page loads (CLS)", `CLS ${vsd.cls.toFixed(3)}; ${vsd.shifts.slice(0, 3).map((s) => `${s.v} at ${s.t}ms: ${s.n}`).join(" ; ")}`);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.waitForTimeout(350);
  const anims = await page.evaluate(() => document.getAnimations().filter((a) => a.playState === "running").map((a) => {
    const e = a.effect;
    const tm = e && e.getComputedTiming ? e.getComputedTiming() : {};
    const props = e && e.getKeyframes ? [...new Set(e.getKeyframes().flatMap((k) => Object.keys(k)))].filter((k) => !["offset", "easing", "composite", "computedOffset"].includes(k)) : [];
    const el = e && e.target;
    return { name: a.animationName || a.transitionProperty || "", it: String(tm.iterations), dur: tm.duration, props: props.join(","), el: el ? `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : `.${el.className}`}` : "" };
  })).catch(() => []);
  for (const a of anims.filter((x) => x.it === "Infinity" || /transform|top|left|right|bottom|width|height|margin|padding|inset|translate|scale|rotate/.test(x.props)).slice(0, 4)) {
    note("14-moves-under-reduced-motion", "medium", `still animating with prefers-reduced-motion: ${a.el} (${a.name})`, `${a.props}; iterations ${a.it}; ${a.dur}ms`, { sel: a.el });
  }
  await page.emulateMedia({ reducedMotion: "no-preference" });
  if (arg("no-focus")) return;
  const fp = await focusPass(page).catch(() => null);
  if (!fp) return;
  for (const r of fp.noRing.slice(0, 5)) note("13-no-focus-ring", "medium", "no visible focus ring when the keyboard reaches this control", `${fp.noRing.length} of ${fp.visited} controls on the page`, { sel: r.label, text: r.text });
  for (const r of fp.hidden.slice(0, 5)) note("13-focus-hidden", "medium", `the keyboard focus lands here while it is behind ${r.hid}`, "", { sel: r.label, text: r.text });
  if (fp.lost > 0) note("13-focus-lost", "medium", "the focus falls back to the page body in the middle of the tab order", `${fp.lost} times in ${fp.visited} stops`);
  for (const r of fp.unreached) note("13-unreachable-by-keyboard", "medium", "Tab never reaches this control", `${fp.unreached.length} or more of ${fp.n}`, { sel: r.label, text: r.text });
}
// Every block opened, every dialog of the page shown, every tab.
async function openEverything(page, t, rec) {
  const opened = await page.evaluate(() => {
    let n = 0;
    for (const d of document.querySelectorAll("details:not([open])")) if (d.checkVisibility()) { d.open = true; n += 1; }
    for (const b of document.querySelectorAll("main [aria-expanded=false]")) {
      if (n > 60) break;
      if (!b.checkVisibility() || b.getAttribute("aria-haspopup") || b.closest("dialog, .side, #app-side")) continue;
      b.click(); n += 1;
    }
    return n;
  }).catch(() => 0);
  if (opened) { await settle(page, 350); await rec("expanded"); }
  const dialogs = await page.evaluate(() => [...document.querySelectorAll("dialog")].map((d, i) => { if (!d.id) d.id = `vs-dlg-${i}`; return d.id; })).catch(() => []);
  for (const id of dialogs) {
    const ok = await page.evaluate((i) => { const d = document.getElementById(i); if (!d || d.open) return false; try { d.showModal(); return true; } catch (e) { return false; } }, id).catch(() => false);
    if (!ok) continue;
    await page.waitForTimeout(280);
    await rec(`dialog-${id}`, { scope: `#${id}`, forced: true });
    await page.evaluate((i) => { const d = document.getElementById(i); if (d && d.open) d.close(); }, id).catch(() => {});
  }
  if (!t.tabs) return null;
  const tabs = await page.evaluate(() => [...document.querySelectorAll("[role=tab]")].filter((x) => x.checkVisibility() && x.id && x.getAttribute("aria-selected") !== "true").map((x) => x.id)).catch(() => []);
  for (const id of tabs) {
    await page.click(`#${id}`).catch(() => {});
    await settle(page, 400);
    await rec(`tab-${id.replace(/^tab-/, "")}`);
  }
  return null;
}
// The sign-in screen: focus, filled, a short viewport (as when a keyboard is open), error, forgot, success.
async function signInStates(page, size, rec, dir, slug) {
  const short = async (on) => { await page.setViewportSize({ width: size.w, height: on ? 330 : size.h }); await page.waitForTimeout(350); };
  await page.focus("#lg-email"); await page.waitForTimeout(250);
  await rec("focus", { one: true });
  await page.fill("#lg-email", "someone@astrateg.test"); await page.fill("#lg-pass", "wrong-password");
  await rec("filled", { one: true });
  await short(true); await rec("keyboard-open", { one: true }); await short(false);
  await page.click("#lg-submit");
  await page.waitForSelector("#lg-err:not([hidden])", { timeout: 6000 }).catch(() => {});
  await page.waitForTimeout(800);
  await rec("error", { one: true });
  await short(true); await rec("error-keyboard-open", { one: true }); await short(false);
  await page.click("#lg-forgot").catch(() => {}); await page.waitForTimeout(900);
  await rec("forgot", { one: true });
  await page.fill("#lg-email", emailOf("irit")); await page.fill("#lg-pass", "correct-horse");
  await page.click("#lg-submit"); await page.waitForTimeout(650);
  if (!arg("no-shots")) await page.screenshot({ path: path.join(dir, `${slug}--success.png`) }).catch(() => {});
  return null;
}


PUBLIC_TARGETS.push(
  { kind: "login", role: "anon", path: "quotes.html", name: "set-password" },
  { kind: "login", role: "anon", path: "quotes.html#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired", name: "link-expired" },
);

// ── The report ───────────────────────────────────────────────────────────────────────
const accepted = (f) => ACCEPTED.find(([check, pat]) => f.check.startsWith(check) && (!pat || `${f.sel} ${f.text} ${f.what} ${f.page}`.includes(pat)));
function group(sink) {
  const map = new Map();
  for (const f of sink) {
    // one row per fault and element, whatever the page: a shared component is one finding
    const key = [f.check, f.sel.split(" > ").slice(-2).join(" > "), f.what.replace(/\d+(\.\d+)?/g, "N").replace(/#[\w{}-]+/g, "#x")].join("|");
    let g = map.get(key);
    if (!g) { g = { sev: f.sev, check: f.check, page: f.page, sel: f.sel, what: f.what, text: f.text, nums: f.nums, shot: f.shot, pages: new Set(), roles: new Set(), sizes: new Set(), worlds: new Set(), states: new Set(), n: 0, accepted: (accepted(f) || [])[2] || "" }; map.set(key, g); }
    if (SEV.indexOf(f.sev) < SEV.indexOf(g.sev)) g.sev = f.sev;
    g.pages.add(f.page); g.roles.add(`${f.role}${f.profile === "manager" ? "+mgr" : ""}`); g.sizes.add(f.size); g.worlds.add(f.world); g.states.add(f.state); g.n += 1;
  }
  return [...map.values()].map((g) => ({ ...g, pages: [...g.pages].sort(), page: [...g.pages].sort().join(", "), roles: [...g.roles], sizes: [...g.sizes], worlds: [...g.worlds], states: [...g.states] }))
    .sort((a, b) => SEV.indexOf(a.sev) - SEV.indexOf(b.sev) || a.check.localeCompare(b.check) || a.page.localeCompare(b.page));
}
async function report(sink, jobs, seconds) {
  const groups = group(sink);
  const open = groups.filter((g) => !g.accepted);
  const cell = (s) => String(s || "").replace(/\|/g, "/").replace(/\s+/g, " ");
  const short = (a, n = 4) => (a.length > n ? `${a.slice(0, n).join(", ")} +${a.length - n}` : a.join(", "));
  const count = (list, sev) => list.filter((g) => g.sev === sev).length;
  const lines = [`# Visual sweep`, "", `${jobs.length} page loads (page x role x size x world), ${sink.length} raw findings, ${open.length} distinct (${SEV.map((s) => `${count(open, s)} ${s}`).join(", ")}), ${groups.length - open.length} accepted. ${Math.round(seconds)} seconds.`, "",
    "| severity | check | page | roles | sizes | worlds | states | what | element | text | numbers | times | screenshot |", "|---|---|---|---|---|---|---|---|---|---|---|---|---|"];
  for (const g of open) lines.push(`| ${g.sev} | ${g.check} | ${g.page} | ${short(g.roles)} | ${g.sizes.join(", ")} | ${g.worlds.join(", ")} | ${short(g.states, 3)} | ${cell(g.what)} | \`${cell(g.sel)}\` | ${cell(g.text)} | ${cell(g.nums)} | ${g.n} | ${g.shot} |`);
  lines.push("", "## Per page", "");
  const pages = [...new Set(jobs.map((j) => j.t.path.split(/[?#]/)[0]))].sort();
  for (const p of pages) { const mine = open.filter((g) => g.pages.includes(p)); lines.push(`- ${p}: ${mine.length ? SEV.filter((s) => count(mine, s)).map((s) => `${count(mine, s)} ${s}`).join(", ") : "clean"}`); }
  await writeFile(path.join(OUT, "findings.json"), JSON.stringify({ at: new Date().toISOString(), jobs: jobs.length, seconds, groups }, null, 1));
  await writeFile(path.join(OUT, "summary.md"), `${lines.join("\n")}\n`);
  console.log(`\n${jobs.length} page loads, ${open.length} distinct findings: ${SEV.map((s) => `${count(open, s)} ${s}`).join(", ")} (${groups.length - open.length} accepted). ${Math.round(seconds)}s`);
  const byCheck = {};
  for (const g of open) byCheck[`${g.sev} ${g.check}`] = (byCheck[`${g.sev} ${g.check}`] || 0) + 1;
  for (const [k, v] of Object.entries(byCheck).sort((a, b) => SEV.indexOf(a[0].split(" ")[0]) - SEV.indexOf(b[0].split(" ")[0]) || a[0].localeCompare(b[0]))) console.log(`  ${String(v).padStart(4)}  ${k}`);
  console.log(`\nfindings: ${path.join(OUT, "findings.json")}\nsummary:  ${path.join(OUT, "summary.md")}\npictures: ${path.join(OUT, "shots")}`);
  return open.some((g) => g.sev === "blocker" || g.sev === "high");
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const srv = await serve();
  const base = `http://localhost:${srv.address().port}/`;
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  const targets = allTargets();
  const sizes = pick("size");
  const worlds = pick("world");
  const plan = worlds ? Object.fromEntries(worlds.map((w) => [w, PLAN[w] || PLAN.normal])) : PLAN;
  const jobs = [];
  for (const [w, list] of Object.entries(plan)) for (const s of sizes || list) for (const t of targets) jobs.push({ t, sizeKey: s, worldKey: w });
  if (arg("list")) { for (const j of jobs) console.log(`${j.worldKey} ${j.sizeKey} ${j.t.role}${j.t.profile === "manager" ? "+mgr" : ""} ${j.t.name} ${j.t.path}`); await browser.close(); srv.close(); return; }
  console.log(`${jobs.length} page loads (${targets.length} screens), ${JOBS} at a time, pictures to ${OUT}`);
  const queue = [...jobs];
  const sink = [];
  const t0 = Date.now();
  let done = 0;
  const worker = async () => {
    for (;;) {
      const j = queue.shift();
      if (!j) return;
      await runJob(browser, base, j, sink);
      done += 1;
      if (done % 20 === 0) console.log(`  ${done} done, ${queue.length} left, ${Math.round((Date.now() - t0) / 1000)}s`);
    }
  };
  await Promise.all(Array.from({ length: JOBS }, worker));
  await browser.close();
  srv.close();
  const bad = await report(sink, jobs, (Date.now() - t0) / 1000);
  process.exitCode = bad ? 1 : 0;
}
await main();

