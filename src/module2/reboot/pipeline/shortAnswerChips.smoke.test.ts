import { shortAnswersToModuleButtons } from './shortAnswerChips';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg);
}

const chips = shortAnswersToModuleButtons({
  turnId: 't1',
  labels: ['Option 1', 'Option 2'],
  slotKey: 'pitch_option',
});

assert(chips.length === 2, 'two chips');
assert(chips[0]?.payload.kind === 'ui', 'ui kind');
assert(
  (chips[0]?.payload as { action?: string }).action === 'choice_tap',
  'choice_tap',
);

console.log('[short-answer-chips] ok');
