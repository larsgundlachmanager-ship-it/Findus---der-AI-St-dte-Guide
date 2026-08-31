/**
 * Quick check: adaptive Live-Chat endpoint delays.
 * Run: npx --yes tsx src/services/handsFree/liveChatEndpoint.test.ts
 */

import {
  computeEndpointDelayMs,
  looksLikeFinishedUtterance,
  ENDPOINT_BASE_MS,
  ENDPOINT_FAST_MS,
  ENDPOINT_SLOW_MS,
} from './liveChatEndpoint';

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

assert(computeEndpointDelayMs('Wetter?') === ENDPOINT_FAST_MS, 'short q');
assert(computeEndpointDelayMs('Ja.') === ENDPOINT_FAST_MS, 'ack');
assert(computeEndpointDelayMs('Ich würde gerne und') === ENDPOINT_SLOW_MS, 'open');
assert(
  computeEndpointDelayMs('Wo gibt es gutes Essen in der Nähe') === ENDPOINT_FAST_MS,
  'unpunctuated fast',
);
assert(looksLikeFinishedUtterance('Wetter?') === true, 'finished ?');
assert(looksLikeFinishedUtterance('Ja.') === true, 'finished ack');
assert(looksLikeFinishedUtterance('Ich würde gerne und') === false, 'open not finished');
assert(
  looksLikeFinishedUtterance('Bring mich bitte zum Holstentor.') === true,
  'finished period',
);
assert(
  looksLikeFinishedUtterance('Wo gibt es gutes Essen in der Nähe') === true,
  'unpunctuated q',
);
assert(looksLikeFinishedUtterance('20:10') === true, 'bare clock');
assert(looksLikeFinishedUtterance('um 20 Uhr') === true, 'um clock');
assert(looksLikeFinishedUtterance('20:10 Uhr') === true, 'clock uhr');
assert(looksLikeFinishedUtterance('Handgepäck') === true, 'carry bag');
assert(looksLikeFinishedUtterance('Nur Handgepäck') === true, 'nur carry');
assert(looksLikeFinishedUtterance('Aufgabegepäck') === true, 'checked bag');
assert(looksLikeFinishedUtterance('Mit Aufgabegepäck') === true, 'mit checked');
assert(looksLikeFinishedUtterance('ÖPNV') === true, 'transit slot');
assert(computeEndpointDelayMs('Handgepäck') === ENDPOINT_FAST_MS, 'slot fast');

console.log('liveChatEndpoint.test.ts OK');
