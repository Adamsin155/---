// A closer look at a part of one screenshot: node docs/design/kit-office/crop.mjs <png> <y> <height> <out.png>
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const [file, y = '0', hgt = '1200', out = 'crop.png'] = process.argv.slice(2);
const data = readFileSync(file).toString('base64');
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await page.setContent(`<body style="margin:0"><img src="data:image/png;base64,${data}"></body>`);
const size = await page.evaluate(() => { const i = document.images[0]; return [i.naturalWidth, i.naturalHeight]; });
await page.screenshot({ path: out, fullPage: true, clip: { x: 0, y: +y, width: size[0], height: Math.min(+hgt, size[1] - +y) } });
await browser.close();
