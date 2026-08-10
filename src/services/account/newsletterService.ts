/**
 * Newsletter opt-in — Profil (lokal) + user_marketing (Supabase).
 */

import { getSupabase } from '../supabase';
import { getCachedUserProfile, updateUserProfile } from '../userProfileService';
import { getSyncUserId, syncMarketingRow } from './userCloudSync';
import type { AppLanguage } from '../../types/userProfile';
import { uiLang } from '../../types/userProfile';

export async function getNewsletterOptIn(): Promise<boolean> {
  return !!getCachedUserProfile()?.newsletterOptIn;
}

export async function setNewsletterOptIn(
  optIn: boolean,
  locale?: AppLanguage,
): Promise<{ ok: boolean; error?: string }> {
  const lang = locale ?? uiLang(getCachedUserProfile()?.language);
  const at = optIn ? new Date().toISOString() : null;
  try {
    await updateUserProfile({
      newsletterOptIn: optIn,
      newsletterOptInAt: at,
    });
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Profil speichern fehlgeschlagen',
    };
  }
  const userId = await getSyncUserId();
  if (!userId) return { ok: true };
  const pushed = await syncMarketingRow(userId, optIn, at, lang);
  if (!pushed.ok) return pushed;
  const { scheduleUserCloudPush } = await import('./userCloudSync');
  scheduleUserCloudPush();
  return { ok: true };
}
