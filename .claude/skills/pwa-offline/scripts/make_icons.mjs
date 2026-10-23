#!/usr/bin/env node
// Usage : node make_icons.mjs <icon.svg> <dossier-de-sortie>
// Produit icon-192.png et icon-512.png (installation Chrome) et apple-touch-icon.png (180 px, iOS).
// L'SVG doit être carré, à fond plein, avec le motif dans les 64 % centraux : Android applique
// un masque circulaire et rogne les bords.
import fs from 'node:fs';
import path from 'node:path';
import { openSession } from './_browser.mjs';

const [svgPath, outDir] = process.argv.slice(2);
if (!svgPath || !outDir) {
  console.error('Usage : node make_icons.mjs <icon.svg> <dossier-de-sortie>');
  process.exit(2);
}

const svg = fs.readFileSync(svgPath, 'utf8').replace(/^<\?xml[^>]*\?>/, '');
fs.mkdirSync(outDir, { recursive: true });

const session = await openSession();
try {
  for (const [name, size] of [['icon-192.png', 192], ['icon-512.png', 512], ['apple-touch-icon.png', 180]]) {
    const page = await session.ctx.newPage();
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(`<style>html,body{margin:0}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`);
    await page.screenshot({ path: path.join(outDir, name) });
    await page.close();
    console.log(`ok  ${path.join(outDir, name)} (${size}x${size})`);
  }
} finally {
  await session.close();
}
