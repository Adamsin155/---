// The demo link (app/demo/flag.js, app/demo/fake.js): …/clients.html?demo=1 opens the
// app for a guest, on the made-up office, with no sign-in. What it must keep:
//  - not one request reaches the real project (the suite routes nothing: anything that
//    went out would be seen here), on any screen of the owner's menu, on a phone and on
//    a computer;
//  - no screen fails: no page error, no "PGRST"/"permission" text, the strip on top;
//  - the guest sees the app as another member of the team from the strip, and lands on
//    that person's own first screen;
//  - a change made in the demo stays while the tab is open (another screen shows it);
//  - "יציאה" ends it: the sign-in screen, and nothing of the demo left in the tab;
//  - a real account signed in on the same device is never touched (localStorage).
// Run: npx http-server -p 8080 -s -c-1 . &  then  node tests/demo-e2e.mjs [outDir]
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { watchCsp, noCspViolations } from './csp-watch.mjs';

const BASE = process.env.BASE_URL || 'http://localhost:8080/';
const OUT = process.argv[2] || null;
if (OUT) mkdirSync(OUT, { recursive: true });
const PHONE = { width: 390, height: 844 };
const DESK = { width: 1366, height: 860 };
const REAL_KEY = 'sb-czncjzziqrqtezpwxxpz-auth-token';
const REAL_SESSION = JSON.stringify({ access_token: 'real-token', user: { id: 'real-user', email: 'real@example.com' } });

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const errors = [];
const outside = [];
let counting = true; // after "יציאה" the app is the real one again (and asks the real project)
async function open(viewport, { realAccount = false } = {}) {
  const ctx = await browser.newContext({ locale: 'he-IL', timezoneId: 'Asia/Jerusalem', viewport, isMobile: viewport.width < 700, hasTouch: viewport.width < 700 });
  ctx.on('request', (r) => { if (counting && /supabase\.co/.test(r.url())) outside.push(`${r.method()} ${r.url()}`); });
  // Out of the demo, the made-up real account is refused (nothing leaves this machine).
  await ctx.route(/supabase\.co/, (route) => route.fulfill({ status: 401, contentType: 'application/json', body: '{"message":"no"}', headers: { 'access-control-allow-origin': '*' } }));
  if (realAccount) await ctx.addInitScript(([k, v]) => { if (!localStorage.getItem(k)) localStorage.setItem(k, v); }, [REAL_KEY, REAL_SESSION]);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  watchCsp(page);
  return { ctx, page };
}
const settle = async (page) => { await page.waitForLoadState('networkidle').catch(() => {}); await page.waitForTimeout(500); };
const shot = async (page, name) => { if (OUT) await page.screenshot({ path: `${OUT}/${name}.png` }); };
const noHScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);

const SCREENS = ['clients.html#mine', 'clients.html#clients', 'owner.html', 'owner.html#shoots', 'gantt.html', 'qa.html', 'pass.html', 'decisions.html', 'insights.html',
  'year.html', 'prep.html', 'messages.html', 'shoot.html', 'calendar.html', 'index.html', 'quotes.html', 'team.html', 'landing.html',
  'client.html?id=c0000000-0000-4000-8000-000000000012', 'scripts.html?id=c0000000-0000-4000-8000-000000000007', 'gantt.html?id=c0000000-0000-4000-8000-000000000017'];

for (const [vpName, viewport] of [['phone', PHONE], ['desk', DESK]]) {
  const { ctx, page } = await open(viewport);
  await page.goto(`${BASE}clients.html?demo=1`);
  await settle(page);
  assert.equal(await page.locator('#login-block').isVisible().catch(() => false), false, `${vpName}: the demo opens with no sign-in`);
  for (const s of SCREENS) {
    await page.goto(BASE + s);
    await settle(page);
    assert.ok(await page.locator('#demo-strip').isVisible(), `${vpName} ${s}: the demo strip`);
    assert.equal(await page.locator('#login-block').isVisible().catch(() => false), false, `${vpName} ${s}: no sign-in screen`);
    const text = await page.locator('main').innerText().catch(() => '');
    assert.doesNotMatch(text, /PGRST|permission denied|NaN|undefined/, `${vpName} ${s}: no error text on the screen`);
    assert.ok(await noHScroll(page), `${vpName} ${s}: no sideways scroll`);
    await shot(page, `${vpName}-${s.replace(/[^a-z0-9]+/gi, '_')}`);
  }
  await ctx.close();
}

// Seen as another member of the team: their own first screen, their name in the strip.
{
  const { ctx, page } = await open(PHONE);
  await page.goto(`${BASE}clients.html?demo=1`);
  await settle(page);
  // Everyone's home is "המשימות שלי", the field sales' the deal page (app/shell-rules.js homeHref).
  for (const [role, home] of [['ofir', /clients\.html#mine$/], ['lior', /clients\.html#mine$/], ['nadia', /clients\.html#mine$/], ['eli', /clients\.html#mine$/], ['stav', /deal\.html$/], ['irit', /clients\.html#mine$/]]) {
    await Promise.all([page.waitForEvent('load'), page.selectOption('#demo-role', role)]);
    await settle(page);
    assert.match(page.url(), home, `${role}: their own first screen`);
    assert.equal(await page.evaluate(() => sessionStorage.getItem('astrateg.demo')), role, `${role}: the demo is seen as them`);
    assert.equal(await page.locator('#demo-role').inputValue(), role, `${role}: the strip says who the demo is seen as`);
    assert.equal(await page.locator('#login-block').isVisible().catch(() => false), false, `${role}: no sign-in screen`);
    await shot(page, `role-${role}`);
  }
  await ctx.close();
}

// A change stays while the tab is open; "יציאה" ends the demo; a real account is untouched.
{
  const { ctx, page } = await open(PHONE, { realAccount: true });
  await page.goto(`${BASE}team.html?demo=1`);
  await settle(page);
  // A task is added to the made-up office (straight through the app's own client).
  const added = await page.evaluate(async () => {
    const { supabase } = await import('./app/supa.js');
    const { error } = await supabase.from('client_tasks').insert({ client_id: 'c0000000-0000-4000-8000-000000000012', title: 'משימת בדיקה של ההדגמה', owner: 'irit', urgent: true });
    return error ? error.message : 'ok';
  });
  assert.equal(added, 'ok');
  await page.goto(`${BASE}client.html?id=c0000000-0000-4000-8000-000000000012`);
  await settle(page);
  assert.match(await page.locator('main').innerText(), /משימת בדיקה של ההדגמה/, 'what the guest changed is there on another screen');
  assert.equal(await page.evaluate((k) => localStorage.getItem(k), REAL_KEY), REAL_SESSION, 'the real account on the device is untouched');
  counting = false;
  await page.click('.demo-leave');
  await page.waitForURL(/clients\.html$/);
  const left = await page.evaluate(() => Object.keys(sessionStorage).filter((k) => /demo/.test(k)));
  assert.deepEqual(left, [], 'nothing of the demo is left in the tab');
  // (After this the app is the real one: this made-up account is refused by the route
  // above and signed out, as any session the server refuses. Not the demo's doing.)
  await ctx.close();
}

await browser.close();
assert.deepEqual(outside, [], 'not one request of the demo reached the real project');
assert.deepEqual(errors, [], 'no page errors');
noCspViolations();
console.log('demo-e2e: ok');
