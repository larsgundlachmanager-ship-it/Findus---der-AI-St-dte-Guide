import { looksLikeOutfitOrWeatherUtterance } from './planUtteranceGate';
import { classifyUtteranceFamily } from '../kernel/utteranceFamily';

function assert(c: unknown, m: string) {
  if (!c) throw new Error(m);
}

assert(looksLikeOutfitOrWeatherUtterance('Wird heute regnen?'), 'looks regnen');
assert(looksLikeOutfitOrWeatherUtterance('Regnet es heute?'), 'looks regnet');
assert(looksLikeOutfitOrWeatherUtterance('Wie wird heute das Wetter?'), 'looks wetter');
assert(
  !looksLikeOutfitOrWeatherUtterance(
    'Wo kann ich heute Abend all you can eat essen gehen?',
  ),
  'AYCE tonight is not weather',
);
assert(
  classifyUtteranceFamily(
    'Wo kann ich heute Abend all you can eat essen gehen?',
  ).family === 'pitch',
  'AYCE family pitch',
);
assert(classifyUtteranceFamily('Wird heute regnen?').family === 'weather', 'fam regnen');
assert(classifyUtteranceFamily('Regnet es heute?').family === 'weather', 'fam regnet');
console.log('weather-regnen.smoke ok');
