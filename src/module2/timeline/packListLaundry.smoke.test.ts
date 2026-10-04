/**
 * Packliste Laundry — Research/Refuse ohne User-Ask.
 * Run: npx --yes --package tsx@4.19.4 tsx src/module2/timeline/packListLaundry.smoke.test.ts
 */
import assert from 'node:assert/strict';
import {
  detectLaundryFromEvidence,
  looksLikeConfirmLaundry,
  looksLikeRefuseLaundry,
} from './packListLaundry';

assert.equal(
  detectLaundryFromEvidence('Guest laundry washer available on site'),
  'yes',
);
assert.equal(
  detectLaundryFromEvidence('No laundry facilities at the hotel'),
  'no',
);
assert.equal(detectLaundryFromEvidence('Pool and spa'), 'unknown');

assert.equal(looksLikeRefuseLaundry('Will nicht waschen, volle Wechselwäsche'), true);
assert.equal(looksLikeConfirmLaundry('Waschmaschine: ja — Packliste neu'), true);
assert.equal(looksLikeRefuseLaundry('Was geht heute?'), false);

console.log('packListLaundry.smoke.test.ts OK');
