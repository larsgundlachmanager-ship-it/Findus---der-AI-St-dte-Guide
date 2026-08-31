import { profileHasFinishedSetup, type UserProfile } from '../../types/userProfile';

export function finishedCloudProfile(p: UserProfile): UserProfile {
  return {
    ...p,
    setupComplete: true,
    firstMapWelcomeDone: true,
    completedAt: p.completedAt ?? new Date().toISOString(),
  };
}

export function mergeCloudUserProfiles(
  local: UserProfile,
  localUpdatedAt: string,
  remote: { profile: UserProfile; updatedAt: string } | null,
  authPatch: Partial<UserProfile> = {},
): UserProfile {
  if (!remote) return { ...local, ...authPatch };
  const remoteDone = profileHasFinishedSetup(remote.profile);
  const localDone = profileHasFinishedSetup(local);

  if (remoteDone && !localDone) {
    return { ...finishedCloudProfile(remote.profile), ...authPatch };
  }
  if (localDone && !remoteDone) {
    return { ...finishedCloudProfile(local), ...authPatch };
  }
  const pickRemote = remote.updatedAt > localUpdatedAt;
  const base = pickRemote ? remote.profile : local;
  const merged = { ...base, ...authPatch };
  if (remoteDone || localDone) {
    return finishedCloudProfile(merged);
  }
  return merged;
}
