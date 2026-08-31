/**
 * SSOT: Master notificationsEnabled + granulare Auto-Hinweis-Flags.
 */

import { getCachedUserProfile } from '../userProfileService';
import type { ProactiveAlertKind, UserProfile } from '../../types/userProfile';

const DEFAULT_ON = true;

export function isProactiveAlertEnabled(
  kind: ProactiveAlertKind,
  profile?: UserProfile | null,
): boolean {
  const p = profile ?? getCachedUserProfile();
  if (!p) return DEFAULT_ON;
  if (p.notificationsEnabled === false) return false;
  const flags = p.proactiveAlerts;
  if (!flags) return DEFAULT_ON;
  const v = flags[kind];
  return v === undefined ? DEFAULT_ON : !!v;
}

export function patchProactiveAlert(
  draft: UserProfile,
  kind: ProactiveAlertKind,
  enabled: boolean,
): Partial<UserProfile> {
  return {
    proactiveAlerts: {
      ...(draft.proactiveAlerts ?? {}),
      [kind]: enabled,
    },
  };
}
