/**
 * Run: npx --yes tsx src/services/handsFree/liveChatTurnContext.smoke.test.ts
 */
import { wantsExplicitDeepResearch } from './liveChatTurnContext';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

assert(
  !wantsExplicitDeepResearch('Wo gibt es Spaghetti-Eis?'),
  'place ask is not explicit research',
);
assert(
  !wantsExplicitDeepResearch('Wie alt ist der Papst?'),
  'trivia is not explicit research',
);
assert(
  wantsExplicitDeepResearch('Recherchiere tiefer und ausführlich: Papst'),
  'button prompt is explicit',
);
assert(
  wantsExplicitDeepResearch('Kannst du das mal online nachschauen?'),
  'online nachschauen is explicit',
);
assert(
  wantsExplicitDeepResearch('schlag das nach'),
  'nachschlagen is explicit',
);

console.log('liveChatTurnContext.smoke.test.ts ok');
