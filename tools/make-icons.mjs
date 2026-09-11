// The app icons: "Noon" (chosen by the maintainer 2026-09-11 from four
// candidates). The gnomon's blade is the whole tile: solid black below the
// diagonal, a 50% dither above it where the light falls. One-bit, on a 32×32
// pixel grid, in the Monochrome skin's language. Renders an SVG through
// Playwright's Chromium at each size. Usage: node tools/make-icons.mjs
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';

// 32×32 pixel grid; every shape sits on whole pixels. The dither is a 2×2 checker.
const art = `
  <defs><pattern id="dither" width="2" height="2" patternUnits="userSpaceOnUse"><rect width="1" height="1" fill="#000"/><rect x="1" y="1" width="1" height="1" fill="#000"/></pattern></defs>
  <rect width="32" height="32" fill="#fff"/>
  <path d="M0 32V0l32 32z" fill="#000"/>
  <path d="M32 0v24L8 0z" fill="url(#dither)"/>`;

const svg = (size, pad, rounded) => `
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 32 32" shape-rendering="crispEdges">
  <rect width="32" height="32" fill="#fff"/>
  <g transform="translate(${pad} ${pad}) scale(${(32 - 2 * pad) / 32})">${art}</g>
</svg>`;

const out = new URL('../packages/app/public/icons/', import.meta.url);
mkdirSync(out, { recursive: true });
writeFileSync(new URL('icon.svg', out), svg(32, 0).trim() + '\n');
const browser = await chromium.launch();
const page = await browser.newPage();
for (const [name, size, pad] of [['icon-192.png', 192, 0], ['icon-512.png', 512, 0], ['icon-maskable-512.png', 512, 0], ['apple-touch-icon.png', 180, 0]]) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<style>html,body{margin:0;background:#fff}svg{display:block}</style>${svg(size, pad)}`);
  writeFileSync(new URL(name, out), await page.screenshot({ clip: { x: 0, y: 0, width: size, height: size } }));
  console.log('wrote', name);
}
await browser.close();
