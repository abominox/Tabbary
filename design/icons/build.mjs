/**
 * Windrow icon set.
 *
 * One glyph, five optical sizes. The mark is three tab rows with the live tab
 * marked — the product in one shape: rows of tabs, one of them active.
 *
 * Rendered to PNG headlessly with Chromium and packed into the extension.
 *   node design/icons/build.mjs
 */

import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const OUT = path.resolve('public/icons');
const PREVIEW = path.resolve('design/assets');
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(PREVIEW, { recursive: true });

const INK = '#14181F';
const PAPER = '#F4F1E8';
const LIVE = '#C8402A';

/**
 * @param size       pixel size
 * @param opts.radius corner radius in px (scaled)
 * @param opts.detail drop fine detail at small sizes
 */
function svg(size, { radius = 0.22, detail = true, bg = INK, fg = PAPER, live = LIVE } = {}) {
  const r = size * radius;
  // Geometry is proportionally tuned per size below 32px.
  const pad = size * (size <= 16 ? 0.16 : 0.18);
  const barH = size * (size <= 16 ? 0.12 : 0.105);
  const gap = size * (size <= 16 ? 0.115 : 0.125);
  const x0 = pad;
  // Top two rows shorten on the right so the "live" dot has room.
  const rowW = size - pad * 2;
  const shortW = rowW * (size <= 16 ? 0.62 : 0.6);
  const top = size * (size <= 16 ? 0.24 : 0.245);
  const y1 = top;
  const y2 = top + barH + gap;
  const y3 = top + (barH + gap) * 2;
  const dotR = size * (size <= 16 ? 0.115 : 0.105);
  const dotX = x0 + shortW + dotR + size * 0.045;
  const dotY = y3 + barH / 2;

  const rows = `
    <rect x="${x0}" y="${y1}" width="${rowW}" height="${barH}" rx="${barH / 2}" fill="${fg}"/>
    <rect x="${x0}" y="${y2}" width="${rowW}" height="${barH}" rx="${barH / 2}" fill="${fg}"/>
    <rect x="${x0}" y="${y3}" width="${shortW}" height="${barH}" rx="${barH / 2}" fill="${fg}"/>
  `;

  // At 16px the dot would be sub-pixel mush; use a solid square end instead.
  const marker = size <= 16
    ? `<rect x="${dotX - dotR}" y="${dotY - dotR}" width="${dotR * 2}" height="${dotR * 2}" rx="${dotR * 0.6}" fill="${live}"/>`
    : detail
      ? `<circle cx="${dotX}" cy="${dotY}" r="${dotR}" fill="${live}"/>`
      : '';

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" rx="${r}" fill="${bg}"/>
  ${rows}
  ${marker}
</svg>`;
}

const browser = await chromium.launch({ headless: true });

async function render(markup, size, file) {
  const page = await browser.newPage({
    viewport: { width: size, height: size },
    deviceScaleFactor: 1,
  });
  await page.setContent(
    `<html><body style="margin:0;background:transparent">${markup}</body></html>`,
  );
  await page.screenshot({
    path: file,
    omitBackground: true,
    clip: { x: 0, y: 0, width: size, height: size },
  });
  await page.close();
}

// ── Extension icons ─────────────────────────────────────
const sizes = [16, 32, 48, 128];
for (const size of sizes) {
  const file = path.join(OUT, `icon${size}.png`);
  await render(svg(size), size, file);
  console.log('wrote', path.basename(file), fs.statSync(file).size + 'B');
}

// ── SVG sources (for the site and docs) ─────────────────
fs.writeFileSync(path.join(OUT, 'mark.svg'), svg(128));
fs.writeFileSync(path.join(OUT, 'mark-small.svg'), svg(16));
console.log('wrote mark.svg + mark-small.svg');

// ── Store / marketing renders ───────────────────────────
// 1280x800 promo tile and a 440x280 small tile, which the dashboard accepts.
const tiles = [
  { w: 1280, h: 800, name: 'promo-1280x800.png', icon: 220 },
  { w: 440, h: 280, name: 'promo-440x280.png', icon: 96 },
];

for (const t of tiles) {
  const page = await browser.newPage({
    viewport: { width: t.w, height: t.h },
    deviceScaleFactor: 1,
  });
  const iconSvg = svg(t.icon);
  const headline = t.w > 600 ? 76 : 34;
  const sub = t.w > 600 ? 30 : 15;
  await page.setContent(`<html><body style="margin:0">
    <div style="width:${t.w}px;height:${t.h}px;background:${PAPER};display:flex;
      align-items:center;gap:${t.w > 600 ? 56 : 22}px;padding:${t.w > 600 ? 96 : 32}px;
      box-sizing:border-box;font-family:-apple-system,Helvetica,Arial,sans-serif">
      <div style="flex:none">${iconSvg}</div>
      <div>
        <div style="font-family:Georgia,serif;font-size:${headline}px;line-height:1.02;
          letter-spacing:-0.03em;color:${INK}">Rows of tabs,<br>quietly kept.</div>
        <div style="margin-top:${t.w > 600 ? 22 : 10}px;font-size:${sub}px;color:#3B414D">
          A local-first tab manager for Chrome.
        </div>
      </div>
    </div></body></html>`);
  await page.screenshot({ path: path.join(PREVIEW, t.name) });
  await page.close();
  console.log('wrote', t.name);
}

// ── Contact sheet for review ────────────────────────────
const sheet = await browser.newPage({ viewport: { width: 720, height: 300 } });
const cells = [
  { size: 16, label: '16 toolbar' },
  { size: 32, label: '32 Windows' },
  { size: 48, label: '48 management' },
  { size: 128, label: '128 store' },
  { size: 128, label: '128 light' },
];
await sheet.setContent(`<html><body style="margin:0;background:${PAPER};
  font-family:-apple-system,Helvetica,Arial,sans-serif">
  <div style="display:flex;align-items:flex-end;gap:44px;padding:44px 40px">
    ${cells
      .map(
        (c) => `<div style="text-align:center">
        <div style="display:inline-block">${svg(c.size, c.label.includes('light')
          ? { bg: '#FFFFFF', fg: INK }
          : {})}</div>
        <div style="margin-top:12px;font-family:monospace;font-size:10px;
          letter-spacing:.1em;text-transform:uppercase;color:#6A7180">${c.label}</div>
      </div>`,
      )
      .join('')}
  </div></body></html>`);
await sheet.screenshot({ path: path.join(PREVIEW, 'icon-sheet.png') });
await sheet.close();
console.log('wrote icon-sheet.png');

await browser.close();
