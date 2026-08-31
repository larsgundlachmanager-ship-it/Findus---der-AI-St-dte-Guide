/**
 * Run: npx --yes tsx src/services/actionBoard/scheduleDeepLink.smoke.test.ts
 */
import assert from 'node:assert/strict';
import {
  isClubOrActHomepageUrl,
  isScheduleDeepPath,
  scoreScheduleCandidate,
  pickBestScheduleCandidate,
  scheduleUrlQualityScore,
} from './scheduleDeepLink';

assert.equal(isClubOrActHomepageUrl('https://hamburgtowers.de/'), true);
assert.equal(isClubOrActHomepageUrl('https://hamburgtowers.de/spielplan'), false);
assert.equal(isScheduleDeepPath('https://hamburgtowers.de/spielplan'), true);
assert.equal(isScheduleDeepPath('https://example.com/fixtures/2026'), true);
assert.ok(scoreScheduleCandidate('https://x.de/spielplan', 'Spielplan') >= 50);
assert.ok(scheduleUrlQualityScore('https://x.de/spielplan') > scheduleUrlQualityScore('https://x.de/'));

const best = pickBestScheduleCandidate(
  [
    { url: 'https://club.de/', score: 10, label: 'Home' },
    { url: 'https://club.de/spielplan', score: 90, label: 'Spielplan' },
  ],
  'https://club.de/',
);
assert.equal(best?.url, 'https://club.de/spielplan');

console.log('scheduleDeepLink.smoke.test.ts ok');
