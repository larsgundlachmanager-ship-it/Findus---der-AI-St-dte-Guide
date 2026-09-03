import { looksLikeOutfitOrWeatherUtterance } from './planUtteranceGate';
import { classifyUtteranceFamily } from '../kernel/utteranceFamily';

function assert(c: unknown, m: string) {
  if (!c) throw new Error(m);
}

assert(looksLikeOutfitOrWeatherUtterance('Wird heute regnen?'), 'looks regnen');
assert(looksLikeOutfitOrWeatherUtterance('Regnet es heute?'), 'looks regnet');
assert(looksLikeOutfitOrWeatherUtterance('Wie wird heute das Wetter?'), 'looks wetter');
assert(classifyUtteranceFamily('Wird heute regnen?').family === 'weather', 'fam regnen');
assert(classifyUtteranceFamily('Regnet es heute?').family === 'weather', 'fam regnet');
console.log('weather-regnen.smoke ok');
