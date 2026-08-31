/**
 * Run: npx --yes tsx src/module2/speech/fusedTurnSpeech.smoke.test.ts
 */
import assert from 'node:assert/strict';
import { stripLeadingBridgeEcho } from './fusedTurnSpeech';
import { remainingSpeechAfterLead } from '../../services/audio/liveSentencePump';

const bridge =
  'Bei dem Wetter passt ein Steak richtig gut — ich hol zwei Orte.';
const main =
  'Bei dem Wetter passt ein Steak richtig gut — ich hol zwei Orte. Entweder Jotins oder Cabana.';

assert.match(
  remainingSpeechAfterLead(main, bridge),
  /^Entweder/,
);
assert.match(stripLeadingBridgeEcho(main, bridge), /Entweder Jotins/);
assert.doesNotMatch(
  stripLeadingBridgeEcho(main, bridge),
  /^Bei dem Wetter/,
);
assert.match(
  stripLeadingBridgeEcho(
    'Entweder Jotins in Pinneberg oder Cabana.',
    bridge,
  ),
  /Entweder Jotins/,
);

console.log('fusedTurnSpeech.smoke.test.ts ok');
