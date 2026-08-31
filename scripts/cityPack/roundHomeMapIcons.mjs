#!/usr/bin/env node
/**
 * Maskiert place-*.png als runde Badges (transparent außerhalb des Kreises).
 *   node scripts/cityPack/roundHomeMapIcons.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { ROOT } from './lib.mjs';

const DIR = path.join(ROOT, 'src', 'assets', 'homeMap');

async function roundOne(file) {
  const inPath = path.join(DIR, file);
  const meta = await sharp(inPath).metadata();
  const size = Math.min(meta.width || 128, meta.height || 128, 128);
  const r = size / 2;
  const svg = Buffer.from(
    `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
      <circle cx="${r}" cy="${r}" r="${r}" fill="#fff"/>
    </svg>`,
  );
  const resized = await sharp(inPath)
    .resize(size, size, { fit: 'cover' })
    .ensureAlpha()
    .png()
    .toBuffer();
  await sharp(resized)
    .composite([{ input: svg, blend: 'dest-in' }])
    .png({ compressionLevel: 9 })
    .toFile(inPath + '.tmp');
  fs.renameSync(inPath + '.tmp', inPath);
  console.log('round', file);
}

async function main() {
  const files = fs
    .readdirSync(DIR)
    .filter((f) => f.startsWith('place-') && f.endsWith('.png'));
  for (const f of files) await roundOne(f);
  console.log('done', files.length);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
