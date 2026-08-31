/**
 * Smoke: Aufgaben-Push-Copy (kein Leave-by-Text).
 * Run: npx --yes -p tsx@4.19.3 tsx src/services/notifications/taskReminderCopy.smoke.ts
 */
import {
  buildTaskReminderSpeech,
  extractTaskReminderPhrase,
  looksLikeLeaveByReminder,
  looksLikeTaskReminder,
  shouldUseTaskReminderPush,
} from './taskReminderCopy';

let failed = 0;
function assert(cond: boolean, msg: string): void {
  if (!cond) {
    console.error(`FAIL ${msg}`);
    failed += 1;
  }
}

assert(
  shouldUseTaskReminderPush({
    userText:
      'Ich möchte gerne, dass du mich um 14 Uhr dran erinnerst, diese Person anzurufen',
  }) === true,
  'call-at-14 is a task push',
);
assert(
  /anzurufen/i.test(
    extractTaskReminderPhrase(
      'Ich möchte gerne, dass du mich um 14 Uhr dran erinnerst, diese Person anzurufen',
    ),
  ),
  'keeps the call task',
);
assert(
  !/loskomm|aufzubrechen|bahn/i.test(
    buildTaskReminderSpeech({
      task: 'diese Person anzurufen',
      fireAtMs: Date.parse('2026-08-23T14:00:00'),
    }),
  ),
  'speech is not leave-by',
);
assert(looksLikeTaskReminder('Erinner mich die Tabletten zu nehmen'), 'pills');
assert(looksLikeLeaveByReminder('Sag Bescheid wenn ich zur Bahn muss'), 'train leave-by');
assert(
  shouldUseTaskReminderPush({
    userText: 'Erinner mich wenn ich zur Bahn muss',
    destName: 'Hauptbahnhof',
  }) === false,
  'train is leave-by',
);
assert(
  shouldUseTaskReminderPush({
    userText: 'Erinner mich um 14 Uhr',
    hasCoords: true,
    destName: 'Museum',
  }) === false,
  'coords stay leave-by',
);

if (failed) {
  console.error(`taskReminderCopy smoke: ${failed} failed`);
  process.exit(1);
}
console.log('taskReminderCopy smoke: ok');
