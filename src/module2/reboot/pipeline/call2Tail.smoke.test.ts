/**
 * Sprint B smoke — Call-2 tail parse + hybrid bullets.
 */

import { parseCall2Tail, mergeCall2Bullets, buildCall2TailPrompt } from './call2Tail';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg);
}

const raw = JSON.stringify({
  bullets: ['Fr 19 Uhr Konzert', 'Eintritt ab 25 Euro', 'Tickets online'],
  shortAnswers: ['Option 1', 'Option 2'],
  memory_extract: ['User mag Jazz'],
});

const tail = parseCall2Tail(raw);
assert(tail?.bullets?.length === 3, 'tail bullets');
assert(tail?.shortAnswers?.length === 2, 'short answers');

const merged = mergeCall2Bullets({
  tailBullets: tail?.bullets ?? [],
  agentBullets: ['Fallback'],
  speechText: 'Fr 19 Uhr Konzert im Michel.',
  bulletMaxChars: 72,
});
assert(merged.length >= 1, 'merged bullets');

const prompt = buildCall2TailPrompt({
  userText: 'Wann spielt Jazz?',
  speechText: 'Also Freitag um 19 Uhr gibt es ein Konzert.',
  bulletMaxChars: 56,
});
assert(/NIEMALS Speech|nicht als Bullet-Vorlage/i.test(prompt), 'fact chips not speech paraphrase');
assert(!/nur Fakten aus Speech/i.test(prompt), 'no speech-summary wording');

console.log('[call2-tail] ok');