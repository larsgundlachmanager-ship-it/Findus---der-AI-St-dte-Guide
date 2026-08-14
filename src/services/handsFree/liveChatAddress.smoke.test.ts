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
  assert(!v.addressed, 'beside hold blocks without Findus');
}

{
  const v = classifyLiveChatAddress('Hey Findus, wo gibt es Pizza?', {
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

console.log('liveChatAddress beside smoke ok');
