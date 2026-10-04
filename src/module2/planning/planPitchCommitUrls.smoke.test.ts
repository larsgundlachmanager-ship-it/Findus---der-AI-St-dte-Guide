/**
 * Pitch commit keeps mapsUrl+menuUrl(+websiteUrl); reject does not duplicate breakfast.
 * Run: npx --yes --package tsx@4.19.4 tsx src/module2/planning/planPitchCommitUrls.smoke.test.ts
 */
import {
  buildCommittedPlanStopFromPitchCard,
  countBreakfastWishes,
  openWishesQueueAfterPitchReject,
  shouldAdvancePlanStepAfterReject,
} from './planPitchCommit';
import type { IngestOpenWish } from './planningTypes';
import {
  looksLikeLandmarkQaText,
  looksLikeLandmarkPitchText,
} from './planWalkOrder';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

const wish: IngestOpenWish = {
  id: 'wish_breakfast_1',
  title: 'Frühstück',
  priority: 5,
  context: 'typisch hamburgerisch',
  estimatedTime: '10:00',
};

const card = {
  name: 'Café Paris',
  lat: 53.55,
  lng: 9.99,
  mapsUrl: 'https://maps.example/cafe-paris',
  menuUrl: 'https://cafe-paris.example/speisekarte',
  websiteUrl: 'https://cafe-paris.example/',
  bullets: ['Terrasse', 'Eier Benedikt'],
};

const stop = buildCommittedPlanStopFromPitchCard(card, wish, '2026-09-17', {
  committedId: 'stop_test_1',
  startMs: Date.parse('2026-09-17T10:00:00'),
});

assert(stop.mapsUrl === card.mapsUrl, `mapsUrl kept: ${stop.mapsUrl}`);
assert(stop.menuUrl === card.menuUrl, `menuUrl kept: ${stop.menuUrl}`);
assert(
  stop.websiteUrl === card.websiteUrl,
  `websiteUrl kept: ${stop.websiteUrl}`,
);
assert(stop.title === 'Café Paris', `title ${stop.title}`);
assert(stop.status === 'planned', 'planned status');
assert(stop.planTaskId === 'wish_breakfast_1', 'same wish id');

const queue: IngestOpenWish[] = [
  wish,
  {
    id: 'wish_evening',
    title: 'Pannfisch',
    priority: 5,
    context: 'Elbblick',
    estimatedTime: '19:30',
  },
];
const beforeBreakfast = countBreakfastWishes(queue);
const after = openWishesQueueAfterPitchReject(queue, wish);
assert(
  countBreakfastWishes(after) === beforeBreakfast,
  `reject must not duplicate breakfast (${beforeBreakfast} → ${countBreakfastWishes(after)})`,
);
assert(
  after.some((w) => w.id === 'wish_breakfast_1'),
  'same breakfast wish id kept',
);
assert(after.length === queue.length, 'queue length unchanged on reject');
assert(shouldAdvancePlanStepAfterReject() === false, 'reject does not advance');

// Landmark Michel: named + Q&A cues → Q&A path (no Top-2 pitch gate)
const michelBlob = 'Michel raufgehen, wie teuer das Ticket';
assert(looksLikeLandmarkPitchText(michelBlob), 'michel landmark pitch text');
assert(looksLikeLandmarkQaText(michelBlob), 'michel landmark qa — no Top-2 drift');
assert(
  looksLikeLandmarkQaText('Michel Eintritt Aussicht'),
  'michel alone with facts stays Q&A',
);

console.log('planPitchCommitUrls.smoke.test.ts ok');
