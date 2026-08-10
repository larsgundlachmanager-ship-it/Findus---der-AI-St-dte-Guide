#!/usr/bin/env node
/**
 * Merkt ein User-Cover-Bild vor der Stadt-Erstellung.
 *
 *   npm run city:cover:queue -- --id laboe --image ./foto.jpg
 *   npm run city:cover:queue -- --city "Laboe" --image "C:/Users/.../bild.png"
 *   npm run city:cover:queue -- --list
 */
import path from 'node:path';
import { arg, hasFlag, slugify } from './lib.mjs';
import {
  listPending,
  loadManifest,
  queueCoverImage,
} from './pendingCovers.mjs';

function main() {
  if (hasFlag('list')) {
    const items = listPending();
    if (!items.length) {
      console.log('[pending-cover] queue empty');
      return;
    }
    for (const it of items) {
      console.log(
        `- ${it.id} (${it.status}) source=${it.source}${it.stylized ? ` stylized=${it.stylized}` : ''}`,
      );
    }
    return;
  }

  const cityName = arg('city') || '';
  const id = (arg('id') || slugify(cityName) || '').toLowerCase();
  const image = arg('image') || arg('from') || '';
  const note = arg('note') || '';

  if (!id || !image) {
    console.error(
      'Usage: npm run city:cover:queue -- --id <slug> --image <path> [--city Name] [--note "..."]\n' +
        '       npm run city:cover:queue -- --list',
    );
    process.exit(1);
  }

  const { item, created } = queueCoverImage({
    cityId: id,
    cityName: cityName || id,
    imagePath: path.resolve(image),
    note,
  });

  console.log(
    `[pending-cover] ${created ? 'queued' : 'updated'} ${item.id} → ${item.source}`,
  );
  console.log(
    '[pending-cover] After city pack exists: Cover-Agent stylize → city:cover:apply',
  );
  const m = loadManifest();
  console.log(`[pending-cover] queue size=${m.items.length}`);
}

main();
