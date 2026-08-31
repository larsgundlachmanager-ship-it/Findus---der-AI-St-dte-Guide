/**
 * Run: npx --yes tsx src/services/navigation/navStartSpeech.smoke.test.ts
 */

import {
  buildFirstVisualDirection,
  buildNavStartSpeech,
} from './navStartSpeech';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

const far = buildFirstVisualDirection({
  turn: 'rechts',
  landmark: 'die Allee',
  roadName: 'Hauptstraße',
  distanceToFirstTurnM: 180,
});
assert(far != null, 'visueller Start');
assert(!/weiter vorne/i.test(far!), 'Opening erzählt nicht die spätere Abbiegung');
assert(!/dann rechts/i.test(far!), 'Opening kein komplettes Itinerar');
assert(/allee|geradeaus/i.test(far!), 'Blickziel oder Geradeaus');

const near = buildFirstVisualDirection({
  turn: 'links',
  landmark: null,
  roadName: null,
  distanceToFirstTurnM: 20,
});
assert(near != null && /links/i.test(near!), 'nahe Abbiegung darf gesagt werden');

const speech = buildNavStartSpeech({
  firstVisual: 'Lauf einfach geradeaus — auf die Bäume zu.',
  etaMin: 3,
});
assert(!/zwei, drei Minuten/i.test(speech), 'kurze ETA nicht extra anhängen');
assert(/los|gehen|laufen/i.test(speech), 'kurzer Opener');

const long = buildNavStartSpeech({
  firstVisual: 'Lauf einfach geradeaus.',
  etaMin: 12,
});
assert(/12|rund/i.test(long), 'längere ETA darf kurz bleiben');

console.log('navStartSpeech.smoke.test.ts OK');
