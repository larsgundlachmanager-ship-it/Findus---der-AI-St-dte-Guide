/**
 * Cruise STT-Repair + Cruise-Center Nav-Ziel.
 * Run: npx --yes --package tsx@4.19.4 tsx src/services/stt/cruiseVoiceRepair.smoke.test.ts
 */
import assert from 'node:assert/strict';
import {
  cruiseTerminalPin,
  extractCruiseCenterNavDest,
  looksLikeCruiseCenterNavAsk,
  repairCruiseVoiceText,
  cruisePortCityFromText,
} from './cruiseVoiceRepair';

const raw =
  'ich fahre ja mit meinen Schiff das muss doch irgendwo so ein Crew Center nach Kiel oder';

const fixed = repairCruiseVoiceText(raw);
assert.match(fixed, /Mein Schiff/i);
assert.match(fixed, /Cruise Center/i);
assert.doesNotMatch(fixed, /Crew Center/i);
assert.doesNotMatch(fixed, /meinen Schiff/i);

assert.equal(repairCruiseVoiceText('Trag Adidia Programm in die Timeline'), 'Trag AIDA Programm in die Timeline');
assert.equal(repairCruiseVoiceText('Aidia Check-in Kiel'), 'AIDA Check-in Kiel');

assert.equal(cruisePortCityFromText(raw), 'Kiel');
assert.equal(
  extractCruiseCenterNavDest(raw),
  'Cruise Center Kiel',
);

const spoken =
  'Ich wurde gerade zum Cruise Center in Kiel gesagt, Cruise Center Hinterher in Kiel damit. Damit wir mit mein Schiff fahren können.';
assert.equal(looksLikeCruiseCenterNavAsk(spoken), true);
assert.equal(extractCruiseCenterNavDest(spoken), 'Cruise Center Kiel');
assert.doesNotMatch(extractCruiseCenterNavDest(spoken) || '', /hinterher|damit/i);

assert.equal(
  extractCruiseCenterNavDest('Bring mich zum Cruise Center in Hamburg'),
  'Cruise Center Hamburg',
);

assert.equal(
  looksLikeCruiseCenterNavAsk('Was kostet die Kreuzfahrt?'),
  false,
);

const droppedCenter =
  'Cruise hinterher in Kiel damit wir mit mein Schiff fahren können';
assert.equal(extractCruiseCenterNavDest(droppedCenter), 'Cruise Center Kiel');
assert.doesNotMatch(extractCruiseCenterNavDest(droppedCenter) || '', /hinterher|damit|Schiff/i);

const pin = cruiseTerminalPin(droppedCenter);
assert.ok(pin, 'Ostseekai-Pin');
assert.equal(pin?.name, 'Cruise Terminal Ostseekai, Kiel');
assert.ok(Math.abs((pin?.lat ?? 0) - 54.32487) < 0.01, 'Ostseekai lat');
assert.equal(cruiseTerminalPin('Was kostet die Kreuzfahrt?'), null);

console.log('cruiseVoiceRepair.smoke.test.ts OK');
