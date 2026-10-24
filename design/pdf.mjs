/** Render the approval deck to PDF (headless). */
import { chromium } from 'playwright';
import path from 'node:path';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 800 } });
await page.goto('file://' + path.resolve('design/deck.html'), { waitUntil: 'load' });
await page.emulateMedia({ media: 'print' });
await page.pdf({
  path: path.resolve('design/assets/windrow-redesign-deck.pdf'),
  width: '1400px',
  height: '800px',
  printBackground: true,
});
await browser.close();
console.log('pdf written');
