// "תיקיית הדרייב" on the content Gantt (the owner's request of 15.11.2026; docs/ops.md, section 134):
// Ilai pastes the client's Drive folder next to "משיכת קישורים מהדרייב", or replaces it. Office of
// tests/flow-world.mjs (invented names), with a few Gantt rows for the client.
//   1  WebKit as an iPhone 13, Ilai, a client with no folder: the field, typed key by key with
//      Backspace; a Docs link refused; the folder saved in its one form; the pull button appears;
//      the client's other links stay. No sideways scroll.
//   2  Chromium at 1366, Ilai, a client with a folder: "פתיחה" and "החלפה"; the new folder saved,
//      the one before in drive_old; the pull button works.
//   3  Chromium at 1366: Lior sees the row; Nadia (the client's editor, no Gantt editing) sees nothing.
// Run: node <a static server> . 8797 &  then  BASE_URL=http://localhost:8797/ node tests/gantt-drive-folder-e2e.mjs
// Screenshots: SHOTS=1 SHOTS_OUT=<dir>.
import { chromium, webkit, devices } from 'playwright';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { NOW, SUPA, emailOf, flowWorld, makeFlowFake, cid } from './flow-world.mjs';
import { watchCsp } from './csp-watch.mjs';

const BASE = process.env.BASE_URL || 'http://localhost:8797/';
const SHOTS = process.env.SHOTS === '1' && !!process.env.SHOTS_OUT;
const OUT = `${String(process.env.SHOTS_OUT || '').replace(/[\/]+$/, '')}/`;
const errors = [];
const settle = async (page) => { await page.waitForLoadState('networkidle').catch(() => {}); await page.waitForTimeout(400); };
const ID = cid(12);
const ID2 = cid(13);
const FOLDER_ID = '1AbCdEfGhIjKlMnOpQrStUvWx';
const FOLDER = `https://drive.google.com/drive/folders/${FOLDER_ID}`;
const OLD = 'https://drive.google.com/drive/folders/0OldFolderOldFolder?usp=sharing';
const NEW_ID = '1NewFolderNewFolder_-9';
const WA = 'https://chat.whatsapp.com/InventedGroup';

const db = flowWorld({ landing: false, queues: false });
Object.assign(db.clients.find((c) => c.id === ID), { links: { whatsapp: WA }, editor: 'nadia' });
Object.assign(db.clients.find((c) => c.id === ID2), { links: { drive: OLD, whatsapp: WA, custom_note: 'x' } });
db.client_gantt = [];
for (const c of [ID, ID2]) {
  for (let n = 1; n <= 3; n += 1) {
    db.client_gantt.push({ id: randomUUID(), client_id: c, key: `video.${n}`, kind: 'video', num: n, title: `סרטון ${n}`,
      day: `2026-10-${String(18 + n * 3).padStart(2, '0')}`, time_il: null, link: null, state: 'planned', posted_on: null, file_id: null, note: null, moved: false, edited: false, created_at: '2026-10-11T09:00:00+03:00' });
  }
}

async function signedIn(engine, opts, who, clientId) {
  const fake = makeFlowFake(db);
  const ctx = await engine.newContext({ ...opts, locale: 'he-IL', timezoneId: 'Asia/Jerusalem' });
  await ctx.clock.install({ time: NOW });
  await ctx.route(`${SUPA}/**`, (r) => (new URL(r.request().url()).pathname === '/functions/v1/drive' && r.request().method() === 'POST'
    ? r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ files: [] }) })
    : fake.route(r)));
  const page = await ctx.newPage();
  watchCsp(page);
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  await page.goto(`${BASE}gantt.html?id=${clientId}`);
  await page.fill('#lg-email', emailOf(who));
  await page.fill('#lg-pass', 'correct-horse');
  await page.click('#lg-submit');
  await page.waitForSelector('#gt-title');
  await page.waitForFunction(() => !document.getElementById('gt-hero').hidden);
  // The sign-in "door" lifts off the page (app/login-ui.js): gone before anything is looked at.
  await page.waitForFunction(() => !('door' in document.documentElement.dataset) && document.getElementById('login-block').hidden, null, { timeout: 15000 });
  await settle(page);
  return { page, ctx, fake };
}
const linksOf = (id) => db.clients.find((c) => c.id === id).links;
const noSideways = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
// Real typing: key by key, then Backspace.
async function typeKeys(input, text) { await input.pressSequentially(text, { delay: 15 }); }
async function backspace(page, n) { for (let i = 0; i < n; i += 1) await page.keyboard.press('Backspace'); }
const shot = async (loc, name) => {
  if (!SHOTS) return;
  const page = loc.page();
  await page.waitForFunction(() => !('door' in document.documentElement.dataset) && document.getElementById('login-block').hidden);
  assert.ok(await loc.isVisible(), `${name}: the Gantt's head is on screen`);
  await loc.screenshot({ path: `${OUT}drive-link-${name}.png` });
};

let passed = 0;
async function step(name, fn) { try { await fn(); passed += 1; console.log(`ok - ${name}`); } catch (e) { console.log(`not ok - ${name}`); throw e; } }

await step('1  iPhone (WebKit), Ilai: paste the first folder, key by key', async () => {
  const wk = await webkit.launch();
  const { page, ctx } = await signedIn(wk, devices['iPhone 13'], 'ilai', ID);
  const input = page.locator('#gt-folder-input');
  await input.waitFor();
  assert.equal(await page.locator('#btn-drive').count(), 0, 'no pull button before a folder');
  assert.equal(await input.getAttribute('dir'), 'ltr');
  assert.ok(await noSideways(page), 'no sideways scroll');
  await shot(page.locator('#gt-hero'), 'empty-390');
  // A Docs link: refused, in Hebrew.
  await input.tap();
  await typeKeys(input, 'https://docs.google.com/document/d/1AbCdEfGhIjKl/edit');
  await page.locator('#gt-folder-save').tap();
  await page.waitForFunction(() => document.getElementById('gt-folder-msg').textContent.length > 0);
  assert.match(await page.locator('#gt-folder-msg').innerText(), /לא קישור לתיקייה/);
  assert.equal(await input.getAttribute('aria-invalid'), 'true');
  assert.equal(linksOf(ID).drive, undefined, 'nothing saved');
  await shot(page.locator('#gt-hero'), 'error-390');
  // Delete it all with Backspace: the message goes as soon as he types.
  await input.focus();
  await page.keyboard.press('End');
  await backspace(page, 'https://docs.google.com/document/d/1AbCdEfGhIjKl/edit'.length);
  assert.equal(await input.inputValue(), '');
  assert.equal(await page.locator('#gt-folder-msg').innerText(), '');
  // The folder with a typo at the end, fixed with Backspace, and Drive's "?usp=sharing".
  await typeKeys(input, `${FOLDER}?usp=sharingzz`);
  await backspace(page, 2);
  assert.equal(await input.inputValue(), `${FOLDER}?usp=sharing`);
  await page.locator('#gt-folder-save').tap();
  await page.locator('#gt-folder-open').waitFor();
  assert.equal(await page.locator('#gt-folder-open').getAttribute('href'), FOLDER);
  assert.match(await page.locator('#toast').innerText(), /נשמר/);
  assert.deepEqual(linksOf(ID), { whatsapp: WA, drive: FOLDER }, 'only drive was added');
  // The pull button is there now.
  await page.locator('#btn-drive').waitFor();
  assert.ok(await noSideways(page), 'no sideways scroll after the save');
  await page.waitForTimeout(300);
  await shot(page.locator('#gt-hero'), 'saved-390');
  // Replace on the phone: the field opens with "ביטול".
  await page.locator('#gt-folder-change').tap();
  await page.locator('#gt-folder-cancel').waitFor();
  assert.ok(await noSideways(page), 'no sideways scroll in the replace');
  await page.evaluate(() => document.getElementById('toast').classList.remove('on'));
  await page.waitForTimeout(400);
  await shot(page.locator('#gt-hero'), 'replace-390');
  await page.locator('#gt-folder-cancel').tap();
  await page.locator('#gt-folder-open').waitFor();
  assert.deepEqual(linksOf(ID), { whatsapp: WA, drive: FOLDER }, 'cancel changes nothing');
  await ctx.close(); await wk.close();
});

await step('2  Chromium 1366, Ilai: replace the folder; the one before is kept; the pull works', async () => {
  const br = await chromium.launch();
  const { page, ctx } = await signedIn(br, { viewport: { width: 1366, height: 900 } }, 'ilai', ID2);
  await page.locator('#gt-folder-open').waitFor();
  assert.equal(await page.locator('#gt-folder-open').getAttribute('href'), OLD);
  assert.equal(await page.locator('#gt-folder-open').getAttribute('target'), '_blank');
  await page.locator('#btn-drive').waitFor();
  await shot(page.locator('#gt-hero'), 'has-1366');
  await page.click('#gt-folder-change');
  const input = page.locator('#gt-folder-input');
  await input.waitFor();
  assert.ok(await input.evaluate((el) => el === document.activeElement), 'the field has the focus');
  // A link with a password in it: refused.
  await typeKeys(input, 'https://example.com/folder?token=abc');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.getElementById('gt-folder-msg').textContent.length > 0);
  assert.match(await page.locator('#gt-folder-msg').innerText(), /סיסמאות/);
  await backspace(page, 'https://example.com/folder?token=abc'.length);
  assert.equal(await input.inputValue(), '');
  await typeKeys(input, `https://drive.google.com/drive/u/0/folders/${NEW_ID}?resourcekey=0-AbCx`);
  await backspace(page, 1);
  await shot(page.locator('#gt-hero'), 'replace-1366');
  await page.click('#gt-folder-save');
  await page.waitForFunction((id) => document.getElementById('gt-folder-open')?.getAttribute('href')?.endsWith(id), NEW_ID);
  assert.deepEqual(linksOf(ID2), { drive: `https://drive.google.com/drive/folders/${NEW_ID}`, drive_old: OLD, whatsapp: WA, custom_note: 'x' });
  assert.match(await page.locator('#toast').innerText(), /הוחלף/);
  await page.waitForTimeout(300);
  await shot(page.locator('#gt-hero'), 'replaced-1366');
  // The pull button: the (fake) folder answers with no files.
  await page.click('#btn-drive');
  await page.locator('#gt-drive:not([hidden])').waitFor();
  assert.match(await page.locator('#gt-drive').innerText(), /קישורים מהדרייב/);
  assert.ok(await noSideways(page));
  await ctx.close(); await br.close();
});

await step('3  Chromium 1366: Lior sees the row; Nadia (an editor) sees nothing new', async () => {
  const br = await chromium.launch();
  {
    const { page, ctx } = await signedIn(br, { viewport: { width: 1366, height: 900 } }, 'lior', ID2);
    await page.locator('#gt-folder-change').waitFor();
    await ctx.close();
  }
  {
    const { page, ctx } = await signedIn(br, { viewport: { width: 1366, height: 900 } }, 'nadia', ID);
    await page.waitForTimeout(500);
    assert.equal(await page.locator('#gt-folder').count(), 0, 'no folder row');
    assert.equal(await page.locator('#gt-folder-input').count(), 0, 'no field');
    assert.ok(await page.locator('#gt-folder-slot').evaluate((el) => el.hidden));
    assert.equal(await page.locator('#btn-drive').count(), 0);
    await shot(page.locator('#gt-hero'), 'editor-1366');
    await ctx.close();
  }
  await br.close();
});

assert.deepEqual(errors, [], `errors in the page: ${errors.join(' | ')}`);
console.log(`\n${passed} passed`);
