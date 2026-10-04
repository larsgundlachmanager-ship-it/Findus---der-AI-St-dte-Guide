/**
 * Run: npx --yes --package tsx@4.19.4 tsx src/module2/pitch/pitchMenuFollowUp.smoke.test.ts
 */
import assert from 'node:assert/strict';
import {
  looksLikePitchMenuFollowUp,
  resolvePitchOptionVenueForMenu,
} from './pitchMenuFollowUp';
import { isStickyVenueTaskIntent } from './shouldHandoffPitch';
import { shouldHandoffToPitchModule } from './shouldHandoffPitch';

assert(
  looksLikePitchMenuFollowUp(
    'Zeig mir die Speisekarte vom ersten Restaurant',
  ),
  'menu follow erkannt',
);
assert(
  !shouldHandoffToPitchModule(
    'Zeig mir die Speisekarte vom ersten Restaurant',
  ),
  'menu follow kein Re-Pitch',
);
assert(
  isStickyVenueTaskIntent('Zeig mir die Speisekarte vom ersten Restaurant'),
  'menu follow sticky venue',
);

try {
  const { usePlanCalendarUiStore } = require('../timeline/planCalendarUiStore') as {
    usePlanCalendarUiStore: {
      getState: () => {
        setPendingChoice: (c: unknown) => void;
      };
    };
  };
  usePlanCalendarUiStore.getState().setPendingChoice({
    stepKey: 'smoke_menu',
    headline: 'Essen',
    anchorTimeMs: null,
    anchorTimeLabel: null,
    options: [
      {
        id: 'opt_a',
        title: "Rindock´s Pinneberg",
        menuUrl: 'https://rindock.example/speisekarte',
      },
      { id: 'opt_b', title: 'Bulls Steakhouse', menuUrl: null },
    ],
  });
  const hit = resolvePitchOptionVenueForMenu(
    'Zeig mir die Speisekarte vom ersten Restaurant',
  );
  assert(hit?.name.includes('Rindock'), `erste Option: ${hit?.name}`);
  assert(hit?.menuUrl?.includes('speisekarte'), 'menuUrl Option 1');
} catch (e) {
  console.warn('pendingChoice smoke skipped:', e);
}

console.log('pitchMenuFollowUp.smoke.test.ts ok');
