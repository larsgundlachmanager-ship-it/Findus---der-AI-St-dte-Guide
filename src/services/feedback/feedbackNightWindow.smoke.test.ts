/**
 * Run: npx --yes tsx src/services/feedback/feedbackNightWindow.smoke.test.ts
 */
import {
  FEEDBACK_AUTO_HOUR,
  FEEDBACK_EVENING_DEBOUNCE_MS,
  feedbackAutoWindowStart,
  shouldAutoUploadFeedback,
} from './feedbackNightWindow';

function atLocal(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute = 0,
): Date {
  return new Date(year, month - 1, day, hour, minute, 0, 0);
}

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg);
}

const evening = atLocal(2026, 8, 17, 21, 15);
assert(
  feedbackAutoWindowStart(evening).getHours() === FEEDBACK_AUTO_HOUR,
  'window starts at 21:00',
);
assert(shouldAutoUploadFeedback(0, evening), 'never uploaded → evening upload');
assert(
  !shouldAutoUploadFeedback(evening.getTime() - 60_000, evening),
  'just uploaded → no immediate re-upload',
);
assert(
  shouldAutoUploadFeedback(
    evening.getTime() - FEEDBACK_EVENING_DEBOUNCE_MS - 1000,
    evening,
  ),
  'evening debounce elapsed → extra save may upload',
);

const morning = atLocal(2026, 8, 18, 10, 0);
const lastNight = atLocal(2026, 8, 17, 21, 20).getTime();
assert(
  !shouldAutoUploadFeedback(lastNight, morning),
  'already uploaded last night → no daytime spam',
);
assert(
  shouldAutoUploadFeedback(0, morning),
  'missed last night → morning catch-up',
);

const afternoon = atLocal(2026, 8, 17, 14, 0);
assert(
  !shouldAutoUploadFeedback(atLocal(2026, 8, 16, 21, 10).getTime(), afternoon),
  'daytime after last-night upload → wait until evening',
);

console.log('feedbackNightWindow.smoke.test.ts OK');
