/**
 * Run: npx --yes --package tsx@4.19.4 tsx src/services/ui/hudHintPrefs.smoke.test.ts
 *
 * Once-Hints: nach erster Aktion nie wieder (Source-Vertrag).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

const prefs = readFileSync(
  join(process.cwd(), 'src/services/ui/hudHintPrefs.ts'),
  'utf8',
);
assert(prefs.includes('usedTimelineChoice'), 'timeline choice flag');
assert(prefs.includes('usedTimelineGesture'), 'timeline gesture flag');
assert(prefs.includes('usedPitchChoose'), 'pitch choose flag');
assert(prefs.includes('shouldShowTimelineChoiceHint'), 'choice gate');
assert(prefs.includes('shouldShowTimelineGestureHint'), 'gesture gate');
assert(prefs.includes('shouldShowPitchChooseHint'), 'pitch gate');

const cal = readFileSync(
  join(process.cwd(), 'src/components/PlanCalendarModal.tsx'),
  'utf8',
);
assert(cal.includes('showTlChoiceHint'), 'timeline choice hint gated');
assert(cal.includes('showTlGestureHint'), 'timeline gesture hint gated');
assert(cal.includes('markTimelineChoiceUsed'), 'choice mark on pick');
assert(cal.includes('markTimelineGestureUsed'), 'gesture mark on drag/swipe');

const pitch = readFileSync(
  join(process.cwd(), 'src/components/PitchChoiceSlot.tsx'),
  'utf8',
);
assert(pitch.includes('showChooseHint'), 'pitch choose hint gated');
assert(pitch.includes('markPitchChooseUsed'), 'pitch mark on pick');

console.log('hudHintPrefs.smoke.test.ts OK');
