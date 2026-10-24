/**
 * Render the current site and the v2 proposal to PNGs for the approval deck.
 * Headless only — this must never open a visible window.
 *
 * Run: npx tsx design/shoot.mjs   (or node design/shoot.mjs)
 */

import { chromium } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';

const root = path.resolve('.');
const out = path.join(root, 'design', 'assets');
fs.mkdirSync(out, { recursive: true });

const targets = [
  { file: 'site/index.html', name: 'before.png' },
  { file: 'design/v2/index.html', name: 'after.png' },
];

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });

for (const t of targets) {
  const url = 'file://' + path.join(root, t.file);
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForTimeout(300);
  // Capture the first viewport only: the deck compares above-the-fold composition.
  await page.screenshot({ path: path.join(out, t.name), type: 'png' });
  console.log('wrote', t.name);
}

await browser.close();
