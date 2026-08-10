#!/usr/bin/env node
/**
 * Publish or reject a staged blueprint review brief.
 * Usage: node scripts/blueprint-publish.mjs --id <id> [--reject]
 */
const path = require('path');
const fs = require('fs');

const args = process.argv.slice(2);
const idIdx = args.indexOf('--id');
const id = idIdx >= 0 ? args[idIdx + 1] : null;
const reject = args.includes('--reject');
const stagingDir = path.join(__dirname, '..', 'data', 'blueprints', 'staging');
const prodDir = path.join(__dirname, '..', 'data', 'blueprints', 'prod');

if (!id) {
  console.error('Usage: --id <staging-id> [--reject]');
  process.exit(1);
}

const jsonPath = path.join(stagingDir, `${id}.json`);
const reviewPath = path.join(stagingDir, `${id}.review.md`);

if (!fs.existsSync(jsonPath)) {
  console.error('Missing', jsonPath);
  process.exit(1);
}

if (reject) {
  fs.mkdirSync(path.join(stagingDir, 'rejected'), { recursive: true });
  fs.renameSync(jsonPath, path.join(stagingDir, 'rejected', `${id}.json`));
  if (fs.existsSync(reviewPath)) {
    fs.renameSync(
      reviewPath,
      path.join(stagingDir, 'rejected', `${id}.review.md`),
    );
  }
  console.log('Rejected', id);
  process.exit(0);
}

fs.mkdirSync(prodDir, { recursive: true });
fs.copyFileSync(jsonPath, path.join(prodDir, `${id}.json`));
fs.renameSync(jsonPath, path.join(stagingDir, `published_${id}.json`));
if (fs.existsSync(reviewPath)) {
  fs.renameSync(reviewPath, path.join(stagingDir, `published_${id}.review.md`));
}
console.log('Published', id, '→ data/blueprints/prod/');
