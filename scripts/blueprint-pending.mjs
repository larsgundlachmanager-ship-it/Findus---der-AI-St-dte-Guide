#!/usr/bin/env node
/**
 * List pending unclear blueprint reviews + weekly digest text.
 */
const path = require('path');
const fs = require('fs');

const stagingDir = path.join(__dirname, '..', 'data', 'blueprints', 'staging');

function main() {
  if (!fs.existsSync(stagingDir)) {
    console.log('Keine offenen Blueprint-Reviews (staging leer).');
    console.log('Digest: Keine offenen Blueprint-Reviews.');
    return;
  }
  const files = fs
    .readdirSync(stagingDir)
    .filter((f) => f.endsWith('.review.md'));
  if (!files.length) {
    console.log('Keine offenen Blueprint-Reviews.');
    return;
  }
  console.log(`${files.length} Blaupausen warten auf OK:`);
  for (const f of files) {
    console.log(`- ${f}`);
  }
}

main();
