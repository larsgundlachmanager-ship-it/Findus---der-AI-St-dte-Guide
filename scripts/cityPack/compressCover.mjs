/**
 * Cover-Kompression für Upload (schlanke JPEG, max. Kartenbreite).
 * sharp optional — fehlt es, bleibt Original.
 * Kein Bottom-Crop: Bild bleibt vollständig.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

export const COVER_UPLOAD_MAX_WIDTH = 1280;
export const COVER_UPLOAD_JPEG_QUALITY = 78;

/** @deprecated Scrim-Crop abgeschaltet — Cover 1:1 behalten. */
export const COVER_BOTTOM_SCRIM_CROP = 0;

/**
 * No-op: Unterkante nicht mehr abschneiden.
 * @returns {Promise<{ buffer: Buffer, stripped: boolean, cropPx: number }>}
 */
export async function stripCoverBottomScrim(_sharp, input) {
  return { buffer: Buffer.from(input), stripped: false, cropPx: 0 };
}

/**
 * @returns {{ buffer: Buffer, contentType: string, ext: string, compressed: boolean, bytesIn: number, bytesOut: number, scrimStripped?: boolean }}
 */
export async function compressCoverForUpload(filePath) {
  const input = fs.readFileSync(filePath);
  const bytesIn = input.length;
  const extIn = path.extname(filePath).toLowerCase();

  let sharp;
  try {
    sharp = require('sharp');
  } catch {
    const contentType =
      extIn === '.png'
        ? 'image/png'
        : extIn === '.webp'
          ? 'image/webp'
          : 'image/jpeg';
    return {
      buffer: input,
      contentType,
      ext: extIn || '.jpg',
      compressed: false,
      bytesIn,
      bytesOut: bytesIn,
    };
  }

  const buffer = await sharp(input, { failOn: 'none' })
    .rotate()
    .resize({
      width: COVER_UPLOAD_MAX_WIDTH,
      height: COVER_UPLOAD_MAX_WIDTH,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .jpeg({
      quality: COVER_UPLOAD_JPEG_QUALITY,
      mozjpeg: true,
      progressive: true,
    })
    .toBuffer();

  return {
    buffer,
    contentType: 'image/jpeg',
    ext: '.jpg',
    compressed: true,
    bytesIn,
    bytesOut: buffer.length,
    scrimStripped: false,
  };
}
