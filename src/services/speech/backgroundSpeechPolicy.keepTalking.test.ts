/**
 * Run: npx --yes tsx src/services/speech/backgroundSpeechPolicy.keepTalking.test.ts
 */
import { shouldKeepTalkingOnAction } from './keepTalkingOnAction';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

assert(shouldKeepTalkingOnAction('OPEN_URL'), 'OPEN_URL keeps talking');
assert(shouldKeepTalkingOnAction('BOOK_STAY22'), 'Stay22 keeps talking');
assert(!shouldKeepTalkingOnAction('START_NAVIGATION'), 'nav still stops');
assert(!shouldKeepTalkingOnAction('DIAL_PHONE'), 'phone still stops');
assert(!shouldKeepTalkingOnAction(null), 'empty does not keep');

console.log('backgroundSpeechPolicy.keepTalking.test.ts OK');
