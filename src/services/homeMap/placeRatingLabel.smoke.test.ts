/**
 * Run: npx --yes --package tsx@4.19.4 tsx src/services/homeMap/placeRatingLabel.smoke.test.ts
 */
import {
  placeRatingBucket,
  placeRatingLabel,
} from './placeRatingLabel';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

assert(placeRatingBucket(4.7) === 'top', '4.7 top');
assert(placeRatingBucket(4.2) === 'gut', '4.2 gut');
assert(placeRatingBucket(3.7) === 'okay', '3.7 okay');
assert(placeRatingBucket(3.2) === 'schlechter', '3.2 schlechter');
assert(placeRatingBucket(null) === null, 'null');
assert(placeRatingLabel(4.6) === 'top bewertet', 'label top');
assert(placeRatingLabel(4.1) === 'gut bewertet', 'label gut');
assert(placeRatingLabel(3.5) === 'okay bewertet', 'label okay');
assert(placeRatingLabel(2.0) === 'schlechter bewertet', 'label schlechter');
assert(!/★|\d/.test(placeRatingLabel(4.8) || ''), 'keine Sterne/Zahlen');

console.log('placeRatingLabel.smoke.test.ts OK');
