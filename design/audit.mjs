/**
 * Geometry audit for the v2 proposal. Headless; prints measurements only.
 * Run: node design/audit.mjs
 */

import { chromium } from 'playwright';
import path from 'node:path';

const root = path.resolve('.');
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

await page.goto('file://' + path.join(root, 'design/v2/index.html'), { waitUntil: 'load' });
await page.waitForTimeout(300);

async function audit(width, height) {
  await page.setViewportSize({ width, height });
  await page.waitForTimeout(200);

  return page.evaluate(`(() => {
    const de = document.documentElement;
    const rect = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
    };

    // Elements whose content spills their own box.
    const spill = [];
    document.querySelectorAll('h1,h2,h3,p,li,dd,dt,.ledger-row,.fact,.status-card,.surface-list li,.btn,pre').forEach((el) => {
      const cs = getComputedStyle(el);
      if (cs.overflowX === 'hidden' || cs.overflowX === 'auto' || cs.overflowX === 'scroll') return;
      if (el.scrollWidth > el.clientWidth + 2 && el.clientWidth > 0) {
        spill.push({
          tag: el.tagName.toLowerCase(),
          cls: (el.className || '').toString().slice(0, 24),
          text: (el.textContent || '').trim().slice(0, 30),
          sw: el.scrollWidth,
          cw: el.clientWidth,
        });
      }
    });

    // Any element wider than the viewport.
    const tooWide = [];
    document.querySelectorAll('body *').forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width > de.clientWidth + 2) {
        tooWide.push({ tag: el.tagName.toLowerCase(), cls: (el.className||'').toString().slice(0,20), w: Math.round(r.width) });
      }
    });

    return {
      width: de.clientWidth,
      docHeight: de.scrollHeight,
      overflowX: de.scrollWidth - de.clientWidth,
      hero: rect('.hero-grid'),
      status: rect('.status-card'),
      ledger: rect('.ledger'),
      surfaces: rect('.surfaces'),
      facts: rect('.facts'),
      install: rect('.install-grid'),
      spill: spill.slice(0, 6),
      tooWide: tooWide.slice(0, 6),
      h1Size: getComputedStyle(document.querySelector('h1')).fontSize,
      font: getComputedStyle(document.querySelector('h1')).fontFamily.split(',')[0],
    };
  })()`);
}

for (const [w, h] of [[1440, 900], [1024, 800], [390, 844]]) {
  console.log(JSON.stringify(await audit(w, h), null, 1));
}

await browser.close();
