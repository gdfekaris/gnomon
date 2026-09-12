// The app icons: "Titanium dial" (chosen by the maintainer 2026-09-12 from four
// rendered drafts; it replaced the one-bit "Noon" mark). A cybernetic sundial:
// a brushed titanium plate with a chamfered chrome rim and engraved ticks, a
// sculpted steel blade with a cyan light strip and a white-hot LED at its
// apex, the blade's shadow soft across the face, carbon fiber and a faint hex
// grid under everything, a vignette over it. Layered vector art with SVG
// lighting filters, so every size renders sharp from this one source; the
// maskable icon keeps the dial inside the safe zone. Renders through
// Playwright's Chromium. Usage: node tools/make-icons.mjs
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';

const S = 512;
const cx = 256, cy = 300;

const ticks = (r, n, major, len, lenMajor) => {
  let out = '';
  for (let i = 0; i < n; i++) {
    const a = (2 * Math.PI * i) / n - Math.PI / 2;
    const L = i % major === 0 ? lenMajor : len;
    const x0 = cx + (r - L) * Math.cos(a), y0 = cy + (r - L) * Math.sin(a), x1 = cx + r * Math.cos(a), y1 = cy + r * Math.sin(a);
    out += `<line x1="${x0.toFixed(1)}" y1="${y0.toFixed(1)}" x2="${x1.toFixed(1)}" y2="${y1.toFixed(1)}" stroke="#eae6da" stroke-opacity="0.9" stroke-width="${i % major ? 2 : 3}" stroke-linecap="round"/>`;
  }
  return out;
};

const defs = `
<filter id="brush" x="-5%" y="-5%" width="110%" height="110%"><feTurbulence type="fractalNoise" baseFrequency="0.012 0.9" numOctaves="4" seed="7" result="n"/><feColorMatrix in="n" type="saturate" values="0" result="g"/><feComponentTransfer in="g" result="a"><feFuncA type="linear" slope="0.55" intercept="-0.1"/></feComponentTransfer><feBlend in="SourceGraphic" in2="a" mode="multiply" result="m"/><feComposite in="m" in2="SourceGraphic" operator="in"/></filter>
<filter id="soft" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="9"/></filter>
<filter id="soft2" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="3"/></filter>
<filter id="bloom" x="-200%" y="-200%" width="500%" height="500%"><feGaussianBlur stdDeviation="14"/></filter>
<filter id="bloom2" x="-200%" y="-200%" width="500%" height="500%"><feGaussianBlur stdDeviation="5"/></filter>
<filter id="grain" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves="2" seed="11" result="n"/><feColorMatrix in="n" type="saturate" values="0" result="g"/><feComponentTransfer in="g" result="a"><feFuncA type="linear" slope="0.12" intercept="-0.02"/></feComponentTransfer><feBlend in="SourceGraphic" in2="a" mode="multiply"/></filter>
<radialGradient id="vig" cx="50%" cy="45%" r="70%"><stop offset="55%" stop-color="#000" stop-opacity="0"/><stop offset="100%" stop-color="#000" stop-opacity="0.72"/></radialGradient>
<linearGradient id="chrome" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fdfdfd"/><stop offset="0.18" stop-color="#b9bec4"/><stop offset="0.42" stop-color="#5c6268"/><stop offset="0.5" stop-color="#2a2e33"/><stop offset="0.58" stop-color="#7c8288"/><stop offset="0.85" stop-color="#d9dde1"/><stop offset="1" stop-color="#6d7378"/></linearGradient>
<linearGradient id="glass" x1="0" y1="0" x2="0.3" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="0.55"/><stop offset="0.35" stop-color="#fff" stop-opacity="0.06"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
<pattern id="carbon" width="12" height="12" patternUnits="userSpaceOnUse"><rect width="12" height="12" fill="#101214"/><rect width="6" height="6" fill="#1b1e22"/><rect x="6" y="6" width="6" height="6" fill="#1b1e22"/><rect width="6" height="1" fill="#2a2e33"/><rect x="6" y="6" width="6" height="1" fill="#2a2e33"/></pattern>
<pattern id="hex" width="28" height="48.5" patternUnits="userSpaceOnUse" patternTransform="scale(0.9)"><path d="M14 0l14 8v16l-14 8L0 24V8z M14 32l14 8v16M0 40l14-8" fill="none" stroke="#3ee6ff" stroke-opacity="0.16" stroke-width="1"/></pattern>
<radialGradient id="plate" cx="40%" cy="30%" r="80%"><stop offset="0" stop-color="#b8bcc0"/><stop offset="0.6" stop-color="#6f757b"/><stop offset="1" stop-color="#3b4046"/></radialGradient>
<linearGradient id="blade" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#e9ecef"/><stop offset="0.45" stop-color="#8b9299"/><stop offset="0.55" stop-color="#363b41"/><stop offset="1" stop-color="#6c7379"/></linearGradient>
<linearGradient id="bladeSide" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#1d2024"/><stop offset="1" stop-color="#4a5057"/></linearGradient>`;

// The dial and its blade, on the carbon ground; `pad` scales the object toward the center for the maskable icon.
const art = (pad) => `
<rect width="${S}" height="${S}" fill="url(#carbon)"/>
<rect width="${S}" height="${S}" fill="url(#hex)" opacity="0.6"/>
<g transform="translate(${pad} ${pad}) scale(${(S - 2 * pad) / S})">
<ellipse cx="${cx}" cy="${cy + 40}" rx="230" ry="110" fill="#000" opacity="0.55" filter="url(#soft)"/>
<ellipse cx="${cx}" cy="${cy}" rx="228" ry="126" fill="url(#chrome)"/>
<ellipse cx="${cx}" cy="${cy}" rx="214" ry="114" fill="#1a1d21"/>
<ellipse cx="${cx}" cy="${cy}" rx="208" ry="108" fill="url(#plate)" filter="url(#brush)"/>
<ellipse cx="${cx}" cy="${cy}" rx="208" ry="108" fill="url(#glass)" opacity="0.5"/>
<g transform="translate(${cx} ${cy}) scale(1 0.52) translate(${-cx} ${-cy})">${ticks(196, 60, 5, 10, 18)}</g>
<path d="M${cx} ${cy} L52 ${cy - 8} Q40 ${cy + 30} 70 ${cy + 62} Z" fill="#000" opacity="0.62" filter="url(#soft2)"/>
<path d="M${cx - 10} ${cy + 4} L${cx + 16} ${cy + 4} L${cx + 16} 66 Z" fill="url(#bladeSide)"/>
<path d="M${cx - 64} ${cy + 4} L${cx + 8} ${cy + 4} L${cx + 8} 60 Z" fill="url(#blade)"/>
<path d="M${cx - 58} ${cy - 2} L${cx + 2} 72" stroke="#3ee6ff" stroke-width="10" stroke-linecap="round" opacity="0.9" filter="url(#bloom2)"/>
<path d="M${cx - 58} ${cy - 2} L${cx + 2} 72" stroke="#dffbff" stroke-width="3" stroke-linecap="round"/>
<circle cx="${cx + 9}" cy="58" r="28" fill="#3ee6ff" opacity="0.9" filter="url(#bloom)"/>
<circle cx="${cx + 9}" cy="58" r="10" fill="#fff"/>
<circle cx="${cx + 9}" cy="58" r="5" fill="#e8ffff"/>
<ellipse cx="${cx - 120}" cy="${cy - 60}" rx="120" ry="26" fill="#fff" opacity="0.14" filter="url(#soft)"/>
</g>
<rect width="${S}" height="${S}" fill="url(#vig)"/>
<rect width="${S}" height="${S}" fill="#808080" opacity="0.06" filter="url(#grain)"/>`;

const svg = (size, pad) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${S} ${S}"><defs>${defs}</defs>${art(pad)}</svg>`;

const out = new URL('../packages/app/public/icons/', import.meta.url);
mkdirSync(out, { recursive: true });
writeFileSync(new URL('icon.svg', out), svg(S, 0).replace(/\n/g, '') + '\n');
const browser = await chromium.launch();
const page = await browser.newPage();
for (const [name, size, pad] of [['icon-192.png', 192, 0], ['icon-512.png', 512, 0], ['icon-maskable-512.png', 512, 44], ['apple-touch-icon.png', 180, 0]]) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<style>html,body{margin:0;background:#101214}svg{display:block}</style>${svg(size, pad)}`);
  await page.waitForTimeout(100);
  writeFileSync(new URL(name, out), await page.screenshot({ clip: { x: 0, y: 0, width: size, height: size } }));
  console.log('wrote', name);
}
await browser.close();
