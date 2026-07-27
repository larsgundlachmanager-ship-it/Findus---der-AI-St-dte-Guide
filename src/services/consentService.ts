/**
 * Lokale Einwilligungen (DSGVO): Privacy Policy & Audio-Consent.
 * Persistenz über UserProfile (FileSystem) + optionale Spiegelung.
 */

import type { UserProfile } from '../types/userProfile';
import { loadUserProfile, saveUserProfile } from './userProfileService';

export type ConsentSnapshot = {
  hasAcceptedPrivacyPolicy: boolean;
  hasAcceptedAudioConsent: boolean;
  privacyAcceptedAt: string | null;
  audioConsentAt: string | null;
  micListenMode: UserProfile['micListenMode'];
};

export function consentFromProfile(
  profile: UserProfile | null | undefined,
): ConsentSnapshot {
  return {
    hasAcceptedPrivacyPolicy: !!profile?.hasAcceptedPrivacyPolicy,
    hasAcceptedAudioConsent: !!profile?.hasAcceptedAudioConsent,
    privacyAcceptedAt: profile?.privacyAcceptedAt ?? null,
    audioConsentAt: profile?.audioConsentAt ?? null,
    micListenMode: profile?.micListenMode ?? null,
  };
}

export async function acceptPrivacyPolicy(
  profile: UserProfile,
): Promise<UserProfile> {
  const now = new Date().toISOString();
  return saveUserProfile({
    ...profile,
    hasAcceptedPrivacyPolicy: true,
    privacyAcceptedAt: now,
  });
}

export async function acceptAudioConsent(
  profile: UserProfile,
  micListenMode: NonNullable<UserProfile['micListenMode']>,
): Promise<UserProfile> {
  const now = new Date().toISOString();
  return saveUserProfile({
    ...profile,
    hasAcceptedAudioConsent: true,
    audioConsentAt: now,
    micListenMode,
  });
}

export async function revokeAudioConsent(
  profile: UserProfile,
): Promise<UserProfile> {
  return saveUserProfile({
    ...profile,
    hasAcceptedAudioConsent: false,
    audioConsentAt: null,
    micListenMode: null,
  });
}

export async function loadConsentSnapshot(): Promise<ConsentSnapshot> {
  const profile = await loadUserProfile();
  return consentFromProfile(profile);
}
