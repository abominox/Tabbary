/** Render the live site + deck to PNGs so the user can review without running servers. */
import { chromium } from 'playwright';
import path from 'node:path';
const b = await chromium.launch({ headless: true });
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
await p.goto('file://' + path.resolve('site/index.html'), { waitUntil: 'load' });
await p.waitForTimeout(300);
await p.screenshot({ path: path.resolve('design/assets/after.png') });
await p.setViewportSize({ width: 390, height: 844 });
await p.waitForTimeout(200);
await p.screenshot({ path: path.resolve('design/assets/after-mobile.png'), fullPage: false });
await b.close();
console.log('previews written');
