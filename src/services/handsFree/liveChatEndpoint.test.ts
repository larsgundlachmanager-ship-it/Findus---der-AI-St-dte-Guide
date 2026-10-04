/**
 * Quick check: adaptive Live-Chat endpoint delays.
 * Run: npx --yes tsx src/services/handsFree/liveChatEndpoint.test.ts
 */

import {
  computeEndpointDelayMs,
  looksLikeFinishedUtterance,
  looksLikeClearSentenceEnd,
  looksLikeIncompleteTriviaFrame,
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

assert(looksLikeIncompleteTriviaFrame('Wie alt ist') === true, 'incomplete age');
assert(looksLikeIncompleteTriviaFrame('Wie alt ist der') === true, 'incomplete der');
assert(looksLikeIncompleteTriviaFrame('Wie alt ist der Papst') === false, 'complete papst');
assert(looksLikeFinishedUtterance('Wie alt ist') === false, 'not finished age');
assert(looksLikeFinishedUtterance('Wie alt ist der') === false, 'not finished der');
assert(looksLikeFinishedUtterance('Wie alt ist der Papst') === true, 'finished papst');
assert(looksLikeFinishedUtterance('Wie alt ist der Papst?') === true, 'finished papst ?');
assert(computeEndpointDelayMs('Wie alt ist der') === ENDPOINT_SLOW_MS, 'slow incomplete');

// Capture/Reisebüro: 6 Wörter ohne Satzzeichen ≠ klares Ende
assert(
  looksLikeFinishedUtterance('wir sind vier leute und') === false,
  'open trail mid',
);
assert(
  looksLikeClearSentenceEnd('wir sind vier leute bisschen party') === false,
  'capture not finished mid brief',
);
assert(looksLikeClearSentenceEnd('Ja.') === true, 'capture clear ack');
assert(looksLikeClearSentenceEnd('Passt so.') === true, 'capture clear period');
assert(looksLikeClearSentenceEnd('Apartment wäre cool,') === false, 'trailing comma open');
assert(computeEndpointDelayMs('Apartment wäre cool,') === ENDPOINT_SLOW_MS, 'comma slow');

// Capture: kein Wortzahl-Cap — lange Briefings dürfen nicht „fertig“ wirken
assert(
  looksLikeClearSentenceEnd(
    'wir wollen irgendwie vier leute nach griechenland mit pool und party und billig trinken und so',
  ) === false,
  'long brief not clear end',
);

void ENDPOINT_BASE_MS;
console.log('liveChatEndpoint.test.ts OK');
