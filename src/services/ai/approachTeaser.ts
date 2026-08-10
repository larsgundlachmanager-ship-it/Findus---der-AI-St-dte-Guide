/**
 * @deprecated Legacy-Dateiname — SSOT ist module1PoiChat (Reboot).
 * Alle Aufrufe gehen in den neuen 2-Satz-Wegweiser mit Code-lookPhrase.
 */

import type { PoiWithFacts } from '../../db/types';
import type { UserProfile } from '../../types/userProfile';
import { getCachedUserProfile } from '../userProfileService';
import { getLastUserPosition } from '../../runtime/triggerEngine';
import { getSmoothedSpeedMs } from '../navigation/transportMode';
import { getDeviceHeadingDeg } from '../navigation/navigationService';
import { generateModule1ApproachSpeech } from './module1PoiChat';
import { buildWegweiserHook } from './fastHook';

/** @deprecated Nutze generateModule1ApproachSpeech */
export async function buildRichApproachTeaser(
  approachPoi: PoiWithFacts,
  profile?: UserProfile | null,
  _packTeaser?: string | null,
  _extraInstruction?: string | null,
): Promise<string> {
  const p = profile ?? getCachedUserProfile();
  const pos = getLastUserPosition();
  try {
    const out = await generateModule1ApproachSpeech({
      poi: approachPoi,
      profile: p,
      userLat: pos.lat,
      userLng: pos.lng,
      speedMs: getSmoothedSpeedMs(),
      deviceHeadingDeg: getDeviceHeadingDeg(),
    });
    if (out.skipped) return '';
    if (out.text.trim()) return out.text.trim();
  } catch (err) {
    console.warn('[approachTeaser] module1 chat failed:', err);
  }
  return buildWegweiserHook(approachPoi, p);
}
