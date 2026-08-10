/**
 * Cover-Kompression für Upload (schlanke JPEG, max. Kartenbreite).
 * sharp optional — fehlt es, bleibt Original.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

export const COVER_UPLOAD_MAX_WIDTH = 1280;
export const COVER_UPLOAD_JPEG_QUALITY = 78;

/**
 * @returns {{ buffer: Buffer, contentType: string, ext: string, compressed: boolean, bytesIn: number, bytesOut: number }}
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

  const buffer = await sharp(input)
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
  };
}
