/**
 * Hard destination override: clear queue + idle nav, then route to new target.
 * Voice: „Ich will zum Pudding“ while another route is active.
 */

import { stopSpeaking } from '../ttsService';
import { clearMultiStopTour } from './multiStopTour';
import { stopNavigation } from './navigationService';
import { commitHandsFreeNavStart } from './handsFreeNav';
import { useFinnusStore } from '../../store/useFinnusStore';
import { resetWrongWayMonitor } from './wrongWayMonitor';
import { isPoiInfoQuestion } from '../intent/poiInfoVsNav';
import {
  extractStreetAddressFromUtterance,
  isWeakNavDestLabel,
  looksLikeAddressAnaphor,
  peekLastStreetNavQuery,
  stripNavJunkFromDest,
} from './streetAddressQuery';
import { resolveNavDestCorrection } from './navDestCityCorrection';

/** Explicit go-to destination (not affirmations / stop / discovery / info Qs). */
const HARD_DEST_RE =
  /\b(?:ich\s+(?:will|möchte|moechte|muss|soll)\s+(?:jetzt\s+)?(?:zum|zur|nach|zu|ins|in\s+den|in\s+die)\s+|bring\s+mich\s+(?:jetzt\s+)?(?:zum|zur|nach|zu)\s+|nimm\s+mich\s+(?:jetzt\s+)?(?:zum|zur|nach|zu|auf)\s+|nehm\s+mich\s+(?:jetzt\s+)?(?:zum|zur|nach|zu|auf)\s+|führ\s+mich\s+(?:jetzt\s+)?(?:zum|zur|nach|zu)\s+|fuehr\s+mich\s+(?:jetzt\s+)?(?:zum|zur|nach|zu)\s+|navigier(?:e|en|t)?\s+(?:mich\s+|werden\s+)?(?:jetzt\s+)?(?:zum|zur|nach|zu)\s+|(?:zum|zur|nach|zu)\s+(?=[\wÄÖÜäöüß.\-]+\s+\d)|geh(?:en)?\s+(?:wir\s+)?(?:jetzt\s+)?(?:zum|zur|nach|zu)\s+|ziel\s+(?:ändern|aendern|wechseln)\s+(?:auf|zu)\s+)\s*([A-ZÄÖÜa-zäöüß0-9][\wÄÖÜäöüß\-&.']*(?:\s+[A-ZÄÖÜa-zäöüß0-9][\wÄÖÜäöüß\-&.']*){0,4})/iu;

/** „nächsten Bäcker“ / „zum Café“ ohne Eigenname → Discovery, nicht Geocode. */
const CATEGORY_DEST_RE =
  /^(?:dem\s+|der\s+|den\s+|einem?\s+|einer\s+)?(?:nächste[rn]?\s+|naheste[rn]?\s+|nächste\s+)?(?:bäckerei|baeckerei|bäcker|baecker|bakery|café|cafe|kaffee|restaurant|apotheke|supermarkt|aldi|lidl|rewe|edeka|drogerie|toilette|klo|imbiss|bistro)$/iu;

const CLEAR_ROUTE_RE =
  /\b((?:beende?|beenden|stopp(?:e|en)?|stop|abbrechen)\s+(?:bitte\s+)?(?:die\s+)?(?:navigation|navi|route)|(?:navigation|navi|route)\s+(?:bitte\s+)?(?:löschen|loeschen|abbrechen|beenden|aus|stopp|stoppen)|stopp\s+(?:die\s+)?(?:route|navigation)|navi\s+(?:aus|stopp|stop|beenden)|ziel\s+(?:löschen|loeschen|vergessen)|clear\s+route)\b/iu;

export function isClearRouteIntent(text: string): boolean {
  return CLEAR_ROUTE_RE.test(text.replace(/\s+/g, ' ').trim());
}

/** Shared with pendingOffer — Verb-first „beende die Navigation“ etc. */
export function isStopOrClearNavigationIntent(text: string): boolean {
  return isClearRouteIntent(text);
}

/** Kategorie ohne Eigenname — gehört zur Open-Now-Discovery. */
export function isCategoryNavDestination(dest: string): boolean {
  return CATEGORY_DEST_RE.test(dest.replace(/\s+/g, ' ').trim());
}

/**
 * Extract hard override destination label, or null if not an override phrase.
 * Skips hotel/chained multi-stop phrases (handled elsewhere).
 */
export function detectHardNavOverride(
  text: string,
  ctx?: { currentDestName?: string | null; lastStreetQuery?: string | null },
): string | null {
  const t = text.replace(/\s+/g, ' ').trim();
  if (!t || t.length < 3) return null;
  // Info questions about a POI must NEVER become hard nav
  if (isPoiInfoQuestion(t)) return null;
  // Let chained / hotel / discovery handlers own those phrases
  if (
    /\b(vorher|erst(?:mal)?|dann\s+noch|über|via)\b/iu.test(t) &&
    /\b(hotel|dann)\b/iu.test(t)
  ) {
    return null;
  }
  if (
    /\b(find(?:e|est)?|suche|zeig\s+mir|navigier)\b.{0,40}\b(bäck|café|cafe|toilette|apotheke|supermarkt)\b/iu.test(
      t,
    )
  ) {
    return null;
  }

  // Straße+Nr. (auch ohne „navigier“) und Stadt-Korrektur der letzten Adresse.
  const destCorr = resolveNavDestCorrection({
    userText: t,
    currentDestName: ctx?.currentDestName,
    lastStreetQuery: ctx?.lastStreetQuery ?? peekLastStreetNavQuery(),
  });
  if (destCorr) {
    return destCorr;
  }

  const spokenAddr = extractStreetAddressFromUtterance(t);
  if (spokenAddr) return spokenAddr;

  if (looksLikeAddressAnaphor(t)) {
    const last =
      ctx?.lastStreetQuery ||
      peekLastStreetNavQuery() ||
      ctx?.currentDestName ||
      null;
    const resolved = last ? stripNavJunkFromDest(last) : '';
    if (resolved && !isWeakNavDestLabel(resolved)) return resolved;
    return null;
  }

  const m = t.match(HARD_DEST_RE);
  if (!m?.[1]) return null;
  const dest = stripNavJunkFromDest(
    m[1]
      .replace(/[.,!?]+$/g, '')
      .replace(/\s+/g, ' ')
      .trim(),
  );
  if (dest.length < 2) return null;
  if (/^(hotel|hause|hause\b|mir|bitte)$/i.test(dest)) return null;
  if (isWeakNavDestLabel(dest)) return null;
  if (isCategoryNavDestination(dest)) return null;
  try {
    const { expandBareHauptbahnhofQuery, isBareHauptbahnhofLabel } = require('./expandBareHauptbahnhof') as {
      expandBareHauptbahnhofQuery: (
        n: string,
        o?: { lat?: number | null; lng?: number | null; cityHint?: string | null },
      ) => string;
      isBareHauptbahnhofLabel: (n: string) => boolean;
    };
    if (isBareHauptbahnhofLabel(dest)) {
      const { useFinnusStore } = require('../../store/useFinnusStore') as {
        useFinnusStore: {
          getState: () => { lastGpsLat: number | null; lastGpsLng: number | null };
        };
      };
      const { getCachedUserProfile } = require('../userProfileService') as {
        getCachedUserProfile: () => { cityName?: string | null; cityId?: string | null } | null;
      };
      const st = useFinnusStore.getState();
      const profile = getCachedUserProfile();
      return expandBareHauptbahnhofQuery(dest, {
        lat: st.lastGpsLat,
        lng: st.lastGpsLng,
        cityHint: profile?.cityName ?? profile?.cityId ?? null,
      });
    }
  } catch {
    /* soft */
  }
  return dest;
}

/**
 * Instantly reset navigation engine to IDLE (0 latency intent).
 */
export async function clearNavigationHard(opts?: {
  silent?: boolean;
}): Promise<void> {
  try {
    const { stopJourneyLeaveWatch } = require('./journeyLeaveBy') as {
      stopJourneyLeaveWatch: (reason?: string) => void;
    };
    stopJourneyLeaveWatch('nav_cleared');
  } catch {
    /* soft */
  }
  try {
    const { suppressLiveNavMirror } = require('../../module2/timeline/syncLiveNavToPlan') as {
      suppressLiveNavMirror: () => void;
    };
    suppressLiveNavMirror();
  } catch {
    /* soft */
  }
  try {
    await stopSpeaking();
  } catch {
    // ignore
  }
  try {
    clearMultiStopTour();
    resetWrongWayMonitor();
    useFinnusStore.getState().setNavRouteLoading(false);
    useFinnusStore.getState().setStopQueueVisible(false);
    useFinnusStore.getState().setDiscoveryCandidates([]);
    useFinnusStore.getState().setPendingNavOffer(null);
  } catch {
    /* soft */
  }
  try {
    await stopNavigation({
      silent: opts?.silent ?? true,
      reason: 'user_abort_near',
      invalidateEntranceCache: true,
    });
  } catch (err) {
    console.warn('[hardNav] stopNavigation threw', String(err).slice(0, 180));
  }
  try {
    const { clearLiveNavFromPlan } = await import(
      '../../module2/timeline/syncLiveNavToPlan'
    );
    clearLiveNavFromPlan({ abandon: true });
  } catch {
    /* soft */
  }
}

/**
 * Hard override: wipe queue + start fresh route to destination.
 */
export async function hardOverrideNavigationTo(
  destName: string,
): Promise<{ ok: boolean; reply: string; name: string }> {
  await clearNavigationHard({ silent: true });
  const result = await commitHandsFreeNavStart({
    name: destName,
    poiId: null,
    lat: null,
    lng: null,
  });
  if (!result.ok) {
    return {
      ok: false,
      name: destName,
      reply:
        result.message ||
        `Ich finde „${destName}“ gerade nicht. Sag den Namen nochmal?`,
    };
  }
  return {
    ok: true,
    name: result.name,
    reply: `Alles klar — alte Route weg. Ich führ dich jetzt zu ${result.name}.`,
  };
}
