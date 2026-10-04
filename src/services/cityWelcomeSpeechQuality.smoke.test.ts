/**
 * Run: npx --yes tsx src/services/cityWelcomeSpeechQuality.smoke.test.ts
 */
import assert from 'node:assert/strict';
import {
  isWelcomeSpeechContaminated,
  looksLikeLexiconWelcomeDump,
  shouldRejectBakedWelcomeSpeech,
} from './cityWelcomeSpeechQuality';

const dry =
  'Pinneberg (1351 „Pinnenberghe“) wuchs um Burg/Renaissanceschloss; 1640 Aussterben → dänische Herrschaft. 1695 Poststation.';
assert(looksLikeLexiconWelcomeDump(dry), 'lexicon dump');
assert(
  isWelcomeSpeechContaminated(
    'Mach ein Selfie aus Potsdam am Schloss.',
    'pinneberg',
    'Pinneberg',
  ),
  'potsdam selfie',
);
assert(
  !isWelcomeSpeechContaminated(
    'Pinneberg vor den Toren Hamburgs.',
    'pinneberg',
    'Pinneberg',
  ),
  'hamburg metropol ok when not in foreign list',
);
assert(
  shouldRejectBakedWelcomeSpeech(dry, 'pinneberg', 'Pinneberg'),
  'reject dry bake',
);
const scenic =
  'Mitte des 14. Jahrhunderts stand hier die Burg der Schauenburger. Heute spürst du die Kreisstadt vor Hamburg. Was wollen wir als Erstes entdecken?';
assert(!shouldRejectBakedWelcomeSpeech(scenic, 'pinneberg', 'Pinneberg'));

console.log('cityWelcomeSpeechQuality.smoke.test.ts ok');
