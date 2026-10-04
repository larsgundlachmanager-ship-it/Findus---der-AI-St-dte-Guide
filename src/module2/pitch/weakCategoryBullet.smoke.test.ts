/**
 * weakCategoryBullet — Vibe statt Kategorie-Junk.
 */
import assert from 'node:assert/strict';
import {
  filterWeakCategoryBullets,
  isWeakCategoryBullet,
} from './weakCategoryBullet';

assert.equal(isWeakCategoryBullet('Steak-Restaurant'), true);
assert.equal(isWeakCategoryBullet('Steakhaus'), true);
assert.equal(isWeakCategoryBullet('Deutsche Küche'), true);
assert.equal(isWeakCategoryBullet('kleines rustikales Restaurant'), false);
assert.equal(isWeakCategoryBullet('gemütliche Nischen · starke Fleischqualität'), false);

const cleaned = filterWeakCategoryBullets([
  'Steak-Restaurant',
  'Filetpfännchen mit Charme',
  '28 €',
]);
assert.deepEqual(cleaned, ['Filetpfännchen mit Charme', '28 €']);

console.log('weakCategoryBullet.smoke: ok');
