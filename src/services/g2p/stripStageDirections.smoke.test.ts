/**
 * Run: npx --yes tsx src/services/g2p/stripStageDirections.smoke.test.ts
 */
import assert from 'node:assert/strict';
import { stripStageDirections } from './germanTtsProsodyRules';

assert.equal(
  stripStageDirections('*kichern* Jotins hat ein gutes Steak.'),
  'Jotins hat ein gutes Steak.',
);
assert.equal(
  stripStageDirections('(kichert) Die Terrasse ist offen.'),
  'Die Terrasse ist offen.',
);
assert.equal(
  stripStageDirections('Kichern. Hier ist BEKUN in der Nähe.'),
  'Hier ist BEKUN in der Nähe.',
);
assert.equal(
  stripStageDirections('kichern: mega Plan für heute Abend.'),
  'mega Plan für heute Abend.',
);
assert.equal(
  stripStageDirections('*flüstert*: der Turm ist älter.'),
  'der Turm ist älter.',
);
assert.ok(
  !/kicher|hihi/i.test(stripStageDirections('Hihi. Das Wetter hält.')),
);

console.log('stripStageDirections.smoke.test.ts ok');
