// Placeholder app icons until the design pass: a gnomon (the triangle of a
// sundial) on the theme colour. Renders an SVG through Playwright's Chromium.
// Usage: node tools/make-icons.mjs
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';

const svg = (size, pad) => `
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 100 100">
  <rect width="100" height="100" fill="#1c1917"/>
  <g transform="translate(${pad} ${pad}) scale(${(100 - 2 * pad) / 100})">
    <polygon points="22,78 22,22 78,78" fill="#fafaf9"/>
    <rect x="18" y="78" width="64" height="6" fill="#fafaf9" opacity="0.6"/>
  </g>
</svg>`;

const out = new URL('../packages/app/public/icons/', import.meta.url);
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage();
for (const [name, size, pad] of [['icon-192.png', 192, 8], ['icon-512.png', 512, 8], ['icon-maskable-512.png', 512, 20], ['apple-touch-icon.png', 180, 8]]) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<style>html,body{margin:0}</style>${svg(size, pad)}`);
  writeFileSync(new URL(name, out), await page.screenshot({ clip: { x: 0, y: 0, width: size, height: size } }));
  console.log('wrote', name);
}
await browser.close();
