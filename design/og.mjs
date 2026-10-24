/** Regenerate the social card from the ledger palette. Headless. */
import { chromium } from 'playwright';
import path from 'node:path';

const INK = '#14181F', PAPER = '#F4F1E8', LIVE = '#C8402A';

function icon(size) {
  const pad = size * 0.18, bar = size * 0.105, gap = size * 0.125;
  const x = pad, w = size - pad * 2, short = w * 0.6;
  const y1 = size * 0.245, y2 = y1 + bar + gap, y3 = y2 + bar + gap;
  const r = bar / 2, dr = size * 0.105;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <rect width="${size}" height="${size}" rx="${size*0.22}" fill="${INK}"/>
    <rect x="${x}" y="${y1}" width="${w}" height="${bar}" rx="${r}" fill="${PAPER}"/>
    <rect x="${x}" y="${y2}" width="${w}" height="${bar}" rx="${r}" fill="${PAPER}"/>
    <rect x="${x}" y="${y3}" width="${short}" height="${bar}" rx="${r}" fill="${PAPER}"/>
    <circle cx="${x + short + dr + size*0.045}" cy="${y3 + bar/2}" r="${dr}" fill="${LIVE}"/>
  </svg>`;
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
await page.setContent(`<html><body style="margin:0">
<div style="width:1200px;height:630px;background:${PAPER};padding:76px 80px;box-sizing:border-box;
  font-family:-apple-system,Helvetica,Arial,sans-serif;display:flex;flex-direction:column">
  <div style="display:flex;align-items:center;gap:18px">
    ${icon(52)}
    <span style="font-family:Georgia,serif;font-size:27px;color:${INK};letter-spacing:-.01em">Windrow</span>
    <span style="font-family:monospace;font-size:12px;letter-spacing:.16em;text-transform:uppercase;color:#6A7180">v0.6 · MIT</span>
  </div>
  <div style="margin-top:auto">
    <div style="font-family:Georgia,serif;font-size:86px;line-height:.98;letter-spacing:-.035em;color:${INK}">
      Your tabs,<br><em style="color:${LIVE}">kept</em> the way you left them.
    </div>
    <div style="margin-top:26px;font-size:25px;color:#3B414D;max-width:24ch">
      A local-first tab manager for Chrome.
    </div>
  </div>
  <div style="position:absolute;left:0;right:0;bottom:0;height:6px;background:${LIVE}"></div>
</div></body></html>`);
await page.screenshot({ path: path.resolve('site/assets/og.png'), clip: { x:0,y:0,width:1200,height:630 } });
await browser.close();
console.log('og.png written');
