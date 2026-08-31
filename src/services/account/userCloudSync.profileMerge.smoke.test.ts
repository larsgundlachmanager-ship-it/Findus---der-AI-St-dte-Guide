/**
 * Re-Login: fertiges Cloud-Profil schlägt Onboarding-Draft.
 */
import { createDefaultProfile, profileHasFinishedSetup } from '../../types/userProfile';
import { mergeCloudUserProfiles } from './userCloudProfileMerge';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg);
}

const draft = createDefaultProfile();
const finished = {
  ...createDefaultProfile(),
  setupComplete: true,
  firstMapWelcomeDone: true,
  firstName: 'Maria',
  cityId: 'hamburg',
  cityName: 'Hamburg',
  completedAt: '2026-01-01T00:00:00.000Z',
};

assert(!profileHasFinishedSetup(draft), 'draft unfinished');
assert(profileHasFinishedSetup(finished), 'finished');

const older = '2026-01-01T00:00:00.000Z';
const newer = '2026-08-21T10:00:00.000Z';

const restored = mergeCloudUserProfiles(draft, newer, {
  profile: finished,
  updatedAt: older,
});
assert(restored.setupComplete, 'remote finished wins over newer draft');
assert(restored.firstMapWelcomeDone, 'explanation already heard');
assert(restored.firstName === 'Maria', 'keeps cloud personal data');
assert(restored.cityId === 'hamburg', 'keeps city');

const keepLocal = mergeCloudUserProfiles(finished, newer, {
  profile: draft,
  updatedAt: older,
});
assert(keepLocal.setupComplete, 'local finished not overwritten by draft cloud');
assert(keepLocal.firstName === 'Maria', 'keeps local personal data');

console.log('userCloudSync.profileMerge.smoke.test.ts ok');
