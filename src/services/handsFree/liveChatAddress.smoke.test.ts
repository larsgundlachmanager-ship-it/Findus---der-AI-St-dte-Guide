/**
 * Run: npx --yes tsx src/services/handsFree/liveChatAddress.smoke.test.ts
 */
import { classifyLiveChatAddress } from './liveChatAddress';
import {
  clearBesideConversation,
  isBesideConversationActive,
} from './besideConversationMode';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

clearBesideConversation('test');

{
  const v = classifyLiveChatAddress(
    'Windows ich habe ein Problem kannst du mir helfen',
    { openFloor: true },
  );
  assert(!v.addressed, 'tech side ignored on open floor');
  assert(isBesideConversationActive(), 'beside sticky after side tech');
}

{
  const v = classifyLiveChatAddress('was ist mit dem Laptop', {
    openFloor: true,
  });
  assert(!v.addressed, 'beside hold blocks without Yorro');
}

{
  const v = classifyLiveChatAddress('Hey Yorro, wo gibt es Pizza?', {
    openFloor: true,
  });
  assert(v.addressed, 'wake clears beside');
  assert(!isBesideConversationActive(), 'beside cleared');
  assert(/pizza/i.test(v.cleanText), 'clean has pizza');
}

{
  clearBesideConversation('test');
  const v = classifyLiveChatAddress('schau mal schatz das ist cool', {
    openFloor: true,
  });
  assert(!v.addressed, 'side vocative ignored');
}

{
  clearBesideConversation('test');
  const v = classifyLiveChatAddress('Gibt es hier einen Bäcker in der Nähe', {
    openFloor: true,
  });
  assert(v.addressed, 'open floor accepts substantive travel-ish ask');
}

{
  clearBesideConversation('test');
  const slangAsks = [
    'Alter, was ist denn aktuell los?',
    'Alter was ist denn aktuell los',
    'Wie alt ist der Papst?',
    'Was ist 3 + 3?',
    'Wird es heute regnen?',
    'Soll es heute noch regnen',
    'Wie hoch ist der St. Michel?',
    'Navigiere mich zur Ulmenallee 23 in Pinneberg',
    'Ey Digga, wie alt ist der Papst',
  ];
  for (const q of slangAsks) {
    const v = classifyLiveChatAddress(q, { openFloor: false });
    assert(v.addressed, `PTT/typed ask must reach Yorro: ${q}`);
    assert(
      !isBesideConversationActive(),
      `slang+question must not mute: ${q}`,
    );
  }
}

{
  clearBesideConversation('test');
  classifyLiveChatAddress('schau mal schatz das ist cool', { openFloor: true });
  assert(isBesideConversationActive(), 'hard side still sticky');
  const v = classifyLiveChatAddress('Wie alt ist der Papst?', {
    openFloor: true,
  });
  assert(v.addressed, 'clear trivia ask breaks false beside hold');
  assert(!isBesideConversationActive(), 'beside cleared by clear ask');
}

{
  clearBesideConversation('test');
  classifyLiveChatAddress(
    'Windows ich habe ein Problem kannst du mir helfen',
    { openFloor: true },
  );
  const v = classifyLiveChatAddress('was ist mit dem Laptop', {
    openFloor: true,
  });
  assert(!v.addressed, 'tech follow-up stays beside');
}

console.log('liveChatAddress beside smoke ok');
