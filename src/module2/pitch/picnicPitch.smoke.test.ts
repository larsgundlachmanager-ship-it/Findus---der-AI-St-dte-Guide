/**
 * Run: npx --yes --package tsx@4.19.3 tsx src/module2/pitch/picnicPitch.smoke.test.ts
 */
import { detectPitchKind, parseWishesFromText } from './parentBrief';
import { shouldHandoffToPitchModule } from './shouldHandoffPitch';
import {
  looksLikePicnicQuery,
  isPicnicUnsuitableVenue,
  looksLikePicnicOutdoorVenue,
} from './picnicIntent';
import { shouldHandoffToTourModule } from '../tour/shouldHandoffTour';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

const q = 'dann lass uns ein Picknick machen';
assert(looksLikePicnicQuery(q), 'picnic query');
assert(detectPitchKind(q) === 'sight', 'picnic is sight pitch');
assert(shouldHandoffToPitchModule(q), 'picnic → pitch module');
assert(!shouldHandoffToTourModule(q), 'picnic is not a heritage tour');
assert(
  parseWishesFromText(q).some(
    (w) => w.kind === 'amenity' && /picknick/i.test(w.text),
  ),
  'picnic amenity wish',
);

assert(isPicnicUnsuitableVenue('Kriegerehrenmal'), 'memorial out');
assert(isPicnicUnsuitableVenue('Heimatverein'), 'verein out');
assert(isPicnicUnsuitableVenue('St. Johannis Kirche', 'church'), 'church out');
assert(!isPicnicUnsuitableVenue('Feuerlöschteich', 'see park'), 'pond in');
assert(looksLikePicnicOutdoorVenue('Stadtpark', 'park wiese'), 'park outdoor');

console.log('picnicPitch.smoke.test.ts OK');
