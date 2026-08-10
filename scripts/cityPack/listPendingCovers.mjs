#!/usr/bin/env node
/**
 * Status der Cover-Queue (für Agent nach city:auto).
 *
 *   npm run city:cover:pending
 *   npm run city:cover:pending -- --id laboe
 */
import path from 'node:path';
import { ROOT, arg, slugify } from './lib.mjs';
import {
  STYLE_REFS,
  findPending,
  listPending,
} from './pendingCovers.mjs';

function main() {
  const idArg = arg('id') || arg('city') || '';
  const id = idArg ? slugify(idArg).toLowerCase() : '';

  const items = id ? [findPending(id)].filter(Boolean) : listPending();
  if (!items.length) {
    console.log(
      id
        ? `[pending-cover] none for ${id}`
        : '[pending-cover] queue empty',
    );
    process.exit(0);
  }

  console.log('[pending-cover] style refs:');
  for (const r of STYLE_REFS) {
    console.log(`  - ${path.relative(ROOT, r)}`);
  }
  console.log('');

  for (const it of items) {
    console.log(JSON.stringify(it, null, 2));
    if (it.status === 'queued' || it.status === 'stylized') {
      console.log(`\n→ Next for ${it.id}:`);
      console.log(
        `  1. GenerateImage (refs: source + persona portraits), 16:9`,
      );
      console.log(
        `  2. npm run city:cover:apply -- --id ${it.id} --from <generated.png>`,
      );
    }
    console.log('---');
  }
}

main();
