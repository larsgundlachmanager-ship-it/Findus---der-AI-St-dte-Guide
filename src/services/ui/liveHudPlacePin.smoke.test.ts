/**
 * Live-HUD: Ort nur bei Karten-Pin; Klo/Wasser ≤15 Min; Meal „Hunger?“ einmal.
 * Run: npx --yes --package tsx@4.19.4 tsx src/services/ui/liveHudPlacePin.smoke.test.ts
 */

import fs from 'node:fs';
import path from 'node:path';
import { isMappedHudPlaceLabel } from './liveHudPlacePin';

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

assert(isMappedHudPlaceLabel('REWE'), 'REWE ist Karten-Ort');
assert(isMappedHudPlaceLabel('Marktkauf'), 'Marktkauf ist Karten-Ort');
assert(isMappedHudPlaceLabel('Bahnhof Prisdorf'), 'Bahnhof ist Karten-Ort');
assert(!isMappedHudPlaceLabel('der Gegend'), 'Gegend raus');
assert(!isMappedHudPlaceLabel('Hier in der Gegend'), 'Hier in der Gegend raus');
assert(!isMappedHudPlaceLabel('Heisterhoop 12'), 'Adresse raus');
assert(!isMappedHudPlaceLabel('📍 Hauptstraße 3a'), 'Adresse mit Pin raus');
assert(!isMappedHudPlaceLabel(''), 'leer raus');
assert(!isMappedHudPlaceLabel(null), 'null raus');

const dir = path.join(process.cwd(), 'src', 'services', 'ui');
const amenitySrc = fs.readFileSync(path.join(dir, 'liveHudNearbyAmenities.ts'), 'utf8');
const mealSrc = fs.readFileSync(path.join(dir, 'liveHudMealSuggestions.ts'), 'utf8');
const matrixSrc = fs.readFileSync(path.join(dir, 'contextTriggerMatrix.ts'), 'utf8');

assert(
  /export const MAX_UTILITY_WALK_MIN = 15/.test(amenitySrc),
  'Klo/Wasser max 15 Min',
);
assert(/title: 'Klo\?'/.test(amenitySrc), 'Klo-Titel konkret');
assert(/title: 'Durst\?'/.test(amenitySrc), 'Durst-Titel konkret');
assert(/walkMin > MAX_UTILITY_WALK_MIN/.test(amenitySrc), 'Walk-Cap gefiltert');

const cardsSrc = fs.readFileSync(path.join(dir, 'liveHudCards.ts'), 'utf8');
assert(/push\(dinnerCard\(nowMs\)\)/.test(cardsSrc), 'konkrete Meal-Karte im Idle-HUD');
assert(/themes\.has\('dinner'\)\) push\(dinnerCard/.test(cardsSrc), 'dinner Theme mit Cache-Treffer');
const engineSrc = fs.readFileSync(path.join(dir, 'proactiveHudEngine.ts'), 'utf8');
assert(/sudden_rain_indoor/.test(engineSrc) && /profile_burger/.test(engineSrc), 'Soft-Pitch Filter vorhanden');
assert(/Jacke mitnehmen\|Regen möglich/.test(cardsSrc), 'Jacke/Regen Soft-Filter im HUD');


assert(
  !/title: 'Klo in der Nähe\?'/.test(matrixSrc),
  'keine leere Klo-Frage in Matrix',
);
assert(
  !/title: 'Trinkwasser um die Ecke\?'/.test(matrixSrc),
  'keine leere Trinkwasser-Frage in Matrix',
);

console.log('liveHudPlacePin.smoke.test.ts ok');
