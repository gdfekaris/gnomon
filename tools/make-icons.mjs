// The app icons (Phase 3 block 4): a gnomon, the blade of a sundial, drawn as
// one-bit pixel art in the Monochrome skin's language: white paper, a black
// window border, the blade in black, its shadow in a 50% dither. Renders an
// SVG through Playwright's Chromium at each size. Usage: node tools/make-icons.mjs
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';

// 32×32 pixel grid; every shape sits on whole pixels.
const art = `
  <rect width="32" height="32" fill="#fff"/>
  <path d="M0 0h32v32H0z M2 2v28h28V2z" fill="#000" fill-rule="evenodd"/>
  <path d="M2 2h28v3H2z" fill="#000"/>
  <path d="M4 3h24v1H4z" fill="#fff"/>
  <path d="M8 26V9l14 17z" fill="#000"/>
  <path d="M8 26h18" stroke="#000" stroke-width="2"/>
  <rect x="9" y="12" width="1" height="1" fill="#fff"/>
  <g fill="#000" fill-opacity="1">
    <path d="M23 26h1v-1h-1zM25 26h1v-1h-1zM24 24h1v-1h-1zM26 24h1v-1h-1zM23 22h1v-1h-1zM25 22h1v-1h-1zM24 20h1v-1h-1zM26 20h1v-1h-1zM25 18h1v-1h-1zM26 16h1v-1h-1z"/>
  </g>`;

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
for (const [name, size, pad] of [['icon-192.png', 192, 0], ['icon-512.png', 512, 0], ['icon-maskable-512.png', 512, 5], ['apple-touch-icon.png', 180, 0]]) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<style>html,body{margin:0;background:#fff}svg{display:block}</style>${svg(size, pad)}`);
  writeFileSync(new URL(name, out), await page.screenshot({ clip: { x: 0, y: 0, width: size, height: size } }));
  console.log('wrote', name);
}
await browser.close();
