/**
 * Run: npx --yes --package tsx@4.19.4 tsx src/services/navigation/navStartSpeech.smoke.test.ts
 */

import {
  arriveHmFromEtaMin,
  buildExplicitNavBridgeSpeech,
  buildExplicitNavCommitSpeech,
  buildExplicitNavEtaSpeech,
  buildFirstVisualDirection,
  buildNavStartSpeech,
} from './navStartSpeech';
import { readFileSync } from 'fs';
import { join } from 'path';

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

const bridge = buildExplicitNavBridgeSpeech('Tennis-Club Prisdorf TCP');
assert(/navigiere dich zu/i.test(bridge), 'Call1 navigiert zum Ziel');
assert(/Alles klar/i.test(bridge), 'Call1 erkennt Ziel klar');
assert(/Tennis-Club Prisdorf/i.test(bridge), 'Call1 nennt Ziel');
assert(!/Timeline|Tagesplan|Kalender/i.test(bridge), 'keine Timeline-Speech');

const shortEta = buildExplicitNavEtaSpeech({ etaMin: 16, mode: 'foot' });
assert(/^Dauert etwa 16 Minuten/i.test(shortEta), 'Call2 nur Dauer');
assert(!/Ankunft|23:|läufst|radelst/i.test(shortEta), 'keine Ankunft unter 60 Min');

const longEta = buildExplicitNavEtaSpeech({
  etaMin: 75,
  mode: 'foot',
  arriveHm: '23:10',
});
assert(/Ankunft gegen 23:10/i.test(longEta), 'Ankunft nur >60 Min');

const commit = buildExplicitNavCommitSpeech({
  destName: 'Tennis-Club Prisdorf TCP',
  etaMin: 16,
  mode: 'foot',
});
assert(/navigiere dich zu/i.test(commit), 'commit Call1');
assert(/Dauert etwa 16 Minuten/i.test(commit), 'commit Call2');
assert(!/PACK|SICHTBARKEIT|TOPIC-LOCK|Getränk/i.test(commit), 'kein Meta');

const call2Only = buildExplicitNavCommitSpeech({
  destName: 'Tennis-Club Prisdorf TCP',
  etaMin: 16,
  mode: 'foot',
  bridgeAlreadySpoken: true,
});
assert(
  !/navigiere dich|Alles klar/i.test(call2Only),
  'nur Call2 wenn Bridge schon da',
);
assert(/^Dauert etwa 16 Minuten/i.test(call2Only), 'Call2 Dauer');

assert(arriveHmFromEtaMin(16) != null, 'arrive helper');

const speech = buildNavStartSpeech({
  firstVisual: null,
  etaMin: 16,
  destName: 'Tennis-Club Prisdorf TCP',
  mode: 'foot',
});
assert(/Navigation|navigiere|Minuten/i.test(speech) && /16/i.test(speech), 'coach opening knapp');

const scrubSrc = readFileSync(
  join(process.cwd(), 'src/module2/reboot/synthesizeReboot.ts'),
  'utf8',
);
assert(/SICHTBARKEIT/i.test(scrubSrc), 'scrub strips Sichtbarkeit');
assert(/User sieht den Ort/i.test(scrubSrc), 'scrub strips visibility prompt');

console.log('navStartSpeech.smoke.test.ts OK');
