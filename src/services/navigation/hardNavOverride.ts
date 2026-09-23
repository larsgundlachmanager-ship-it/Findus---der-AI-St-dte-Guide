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
  /\b(?:ich\s+(?:will|möchte|moechte|muss|soll)\s+(?:jetzt\s+)?(?:zum|zur|nach|zu|ins|in\s+den|in\s+die)\s+|bring\s+mich\s+(?:jetzt\s+)?(?:zum|zur|nach|zu)\s+|nimm\s+mich\s+(?:jetzt\s+)?(?:zum|zur|nach|zu|auf)\s+|nehm\s+mich\s+(?:jetzt\s+)?(?:zum|zur|nach|zu|auf)\s+|führ\s+mich\s+(?:jetzt\s+)?(?:zum|zur|nach|zu)\s+|fuehr\s+mich\s+(?:jetzt\s+)?(?:zum|zur|nach|zu)\s+|navigier(?:e|en|t)?\s+(?:mich\s+|werden\s+)?(?:jetzt\s+)?(?:zum|zur|nach|zu)\s+|fahr(?:e|en)?\s+(?:mich\s+|uns\s+)?(?:jetzt\s+)?(?:zum|zur|nach|zu)\s+|(?:route|navigation|navi)\s+(?:starten\s+)?(?:zum|zur|nach|zu)\s+|(?:zum|zur|nach|zu)\s+(?=[\wÄÖÜäöüß.\-]+\s+\d)|geh(?:en)?\s+(?:wir\s+)?(?:jetzt\s+)?(?:zum|zur|nach|zu)\s+|ziel\s+(?:ändern|aendern|wechseln)\s+(?:auf|zu)\s+)\s*([A-ZÄÖÜa-zäöüß0-9][\wÄÖÜäöüß\-&.']*(?:\s+[A-ZÄÖÜa-zäöüß0-9][\wÄÖÜäöüß\-&.']*){0,4})/iu;

/** „nächsten Bäcker“ / „zum Café“ ohne Eigenname → Discovery, nicht Geocode. */
const CATEGORY_DEST_RE =
  /^(?:dem\s+|der\s+|den\s+|einem?\s+|einer\s+)?(?:nächste[rn]?\s+|naheste[rn]?\s+|nächste\s+)?(?:bäckerei|baeckerei|bäcker|baecker|bakery|café|cafe|kaffee|restaurant|apotheke|supermarkt|aldi|lidl|rewe|edeka|drogerie|toilette|klo|imbiss|bistro)$/iu;

const CLEAR_ROUTE_RE =
  /\b((?:beende?|beenden|stopp(?:e|en)?|stop|abbrechen)\s+(?:bitte\s+)?(?:die\s+)?(?:navigation|navi|route)|(?:navigation|navi|route)\s+(?:bitte\s+)?(?:löschen|loeschen|abbrechen|beenden|aus|stopp|stoppen)|stopp\s+(?:die\s+)?(?:route|navigation)|navi\s+(?:aus|stopp|stop|beenden)|ziel\s+(?:löschen|loeschen|vergessen)|clear\s+route|(?:nein[,\s]+)?stopp(?:e|en)?\s+(?:die|das|es))\b/iu;

export function isClearRouteIntent(text: string): boolean {
  return CLEAR_ROUTE_RE.test(text.replace(/\s+/g, ' ').trim());
}

/** Shared with pendingOffer — Verb-first „beende die Navigation“ etc. */
export function isStopOrClearNavigationIntent(text: string): boolean {
  return isClearRouteIntent(text);
}

/**
 * Compound: „beende Navigation und bring mich zum X“ → Rest „bring mich zum X“.
 * Bloßer Ortsname nach Stop (STT-Noise) zählt NICHT als neuer Auftrag.
 */
export function stripStopNavigationForContinue(text: string): string | null {
  const t = text.replace(/\s+/g, ' ').trim();
  if (!CLEAR_ROUTE_RE.test(t)) return null;
  let rest = t.replace(CLEAR_ROUTE_RE, ' ').replace(/\s+/g, ' ').trim();
  rest = rest.replace(/^(?:[,.!\s]|und|aber|dann|bitte)+/giu, '').trim();
  if (!rest || rest.length < 4) return null;
  if (/^(bitte|danke|ok|okay|mal|jetzt|einmal)[.!]?$/iu.test(rest)) return null;
  try {
    const { isExplicitNavIntent } = require('../intent/poiInfoVsNav') as {
      isExplicitNavIntent: (s: string) => boolean;
    };
    if (isExplicitNavIntent(rest)) return rest;
  } catch {
    /* soft */
  }
  if (
    HARD_DEST_RE.test(rest) ||
    /\b(?:bring|führ|fuehr|navigier|nimm|nehm)\b/iu.test(rest)
  ) {
    return rest;
  }
  return null;
}

/** Reiner Stopp — kein zweiter Auftrag im selben Satz. */
export function isPureStopNavigationIntent(text: string): boolean {
  const t = text.replace(/\s+/g, ' ').trim();
  if (!isClearRouteIntent(t)) return false;
  return stripStopNavigationForContinue(t) == null;
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
  try {
    const { extractCruiseCenterNavDest } = require('../stt/cruiseVoiceRepair') as {
      extractCruiseCenterNavDest: (s: string) => string | null;
    };
    const cruiseDest = extractCruiseCenterNavDest(t);
    if (cruiseDest) return cruiseDest;
  } catch {
    /* soft */
  }
  try {
    const { isSoloFlightAbSearch, isFlightTripQuery } = require('../flights/flightTripIntent') as {
      isSoloFlightAbSearch: (s: string) => boolean;
      isFlightTripQuery: (s: string) => boolean;
    };
    if (isSoloFlightAbSearch(t) || isFlightTripQuery(t)) return null;
  } catch {
    /* soft */
  }
  try {
    const { isFindusReisebueroHandoff } = require('../../reisebuero/handoff') as {
      isFindusReisebueroHandoff: (s: string) => boolean;
    };
    if (isFindusReisebueroHandoff(t)) return null;
  } catch {
    /* soft */
  }
  try {
    const { inferCall1JobShape } = require('../../module2/router/call1JobShape') as {
      inferCall1JobShape: (s: string) => string;
    };
    const shape = inferCall1JobShape(t);
    if (
      shape === 'place_dining' ||
      shape === 'trip_package' ||
      shape === 'weather_info' ||
      shape === 'weather_rain' ||
      shape === 'weather_outfit' ||
      shape === 'fact_lookup' ||
      shape === 'arrival_home' ||
      shape === 'flight_only'
    ) {
      return null;
    }
  } catch {
    /* soft */
  }
  // „beende Navigation“ nie als neues Ziel — Compound nur über Rest-Satz
  if (isClearRouteIntent(t)) {
    const cont = stripStopNavigationForContinue(t);
    if (!cont) return null;
    return detectHardNavOverride(cont, ctx);
  }
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

  // „danach zum Tennis Club“ / Resume nach Zwischenstopp → Hard-Nav, kein M1
  try {
    const {
      isResumeOriginalDestIntent,
      extractNamedOnRoutePlace,
    } = require('./onRouteZwischenstopp') as {
      isResumeOriginalDestIntent: (s: string) => boolean;
      extractNamedOnRoutePlace: (s: string) => string | null;
    };
    if (isResumeOriginalDestIntent(t)) {
      const named = extractNamedOnRoutePlace(t);
      if (named && !isWeakNavDestLabel(named) && !isCategoryNavDestination(named)) {
        return named;
      }
    }
  } catch {
    /* soft */
  }

  const m = t.match(HARD_DEST_RE);
  if (!m?.[1]) {
    // Unique Local-Anker + Go-To („zum Tennis Club“) — ohne Verb / Hausnummer
    if (
      !isPoiInfoQuestion(t) &&
      /\b(zum|zur|nach|navigier|bring\s+mich|führ\s+mich|fuehr\s+mich|fahr(?:e|en)?|route|navi)\b/iu.test(
        t,
      )
    ) {
      try {
        const { resolveLocalAnchor } = require('../../module2/context/shortTermContext') as {
          resolveLocalAnchor: (s: string) => { name: string } | null;
        };
        const anchor = resolveLocalAnchor(t);
        if (anchor?.name && !isCategoryNavDestination(anchor.name)) {
          return stripNavJunkFromDest(anchor.name);
        }
      } catch {
        /* soft */
      }
    }
    return null;
  }
  let dest = stripNavJunkFromDest(
    m[1]
      .replace(/[.,!?]+$/g, '')
      .replace(/\s+/g, ' ')
      .trim(),
  );
  try {
    const { repairNavDestLabel } = require('./navDestFuzzyRepair') as {
      repairNavDestLabel: (
        raw: string,
        o?: { userText?: string | null },
      ) => string;
    };
    dest = repairNavDestLabel(dest, { userText: t });
  } catch {
    /* soft */
  }
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
    const st = useFinnusStore.getState();
    st.setNavRouteLoading(false);
    st.setIsGenerating(false);
    st.setStopQueueVisible(false);
    st.setDiscoveryCandidates([]);
    st.setPendingNavOffer(null);
    st.setPendingNavAlternatives([]);
  } catch {
    try {
      useFinnusStore.getState().setNavRouteLoading(false);
      useFinnusStore.getState().setIsGenerating(false);
    } catch {
      /* soft */
    }
  }
  try {
    const { bumpNavCommitGeneration } = require('./navigationService') as {
      bumpNavCommitGeneration: () => number;
    };
    bumpNavCommitGeneration();
  } catch {
    /* soft */
  }
  try {
    const { invalidateProgressiveNavEnrich } = require('./handsFreeNav/startNav') as {
      invalidateProgressiveNavEnrich: () => void;
    };
    invalidateProgressiveNavEnrich();
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
  opts?: { userText?: string | null },
): Promise<{ ok: boolean; reply: string; name: string; replaced: boolean }> {
  const replaced =
    Boolean(useFinnusStore.getState().navActive) ||
    Boolean(String(useFinnusStore.getState().navTargetName || '').trim());
  let name = destName;
  let lat: number | null = null;
  let lng: number | null = null;
  try {
    const { repairNavDestLabel } = require('./navDestFuzzyRepair') as {
      repairNavDestLabel: (
        raw: string,
        o?: { userText?: string | null },
      ) => string;
    };
    name = repairNavDestLabel(destName, { userText: opts?.userText ?? destName });
  } catch {
    name = destName;
  }
  try {
    const { resolveLocalAnchor } = require('../../module2/context/shortTermContext') as {
      resolveLocalAnchor: (s: string) => {
        name: string;
        lat: number;
        lng: number;
      } | null;
    };
    const blob = `${opts?.userText || ''} ${name}`.replace(/\s+/g, ' ').trim();
    const anchor =
      resolveLocalAnchor(blob) ||
      resolveLocalAnchor(name) ||
      resolveLocalAnchor(opts?.userText || '');
    if (anchor) {
      name = anchor.name;
      lat = anchor.lat;
      lng = anchor.lng;
    }
  } catch {
    /* soft */
  }
  // Pack-POI zuerst (Tennis-Club Prisdorf TCP etc.), dann Prefetch/Geocode.
  if (lat == null || lng == null) {
    try {
      const { resolvePlacePackOsmGoogle } = require('./packPlaceResolve') as {
        resolvePlacePackOsmGoogle: (o: {
          query: string;
          cityHint?: string | null;
          biasLat?: number;
          biasLng?: number;
        }) => Promise<{ lat: number; lng: number; label: string } | null>;
      };
      const { useGpsStore } = require('../../store/useGpsStore') as {
        useGpsStore: {
          getState: () => { lat: number | null; lng: number | null };
        };
      };
      const gps = useGpsStore.getState();
      let cityHint: string | null = null;
      try {
        const { getCachedUserProfile } = require('../userProfileService') as {
          getCachedUserProfile: () => { cityId?: string | null } | null;
        };
        cityHint = getCachedUserProfile()?.cityId ?? null;
      } catch {
        /* soft */
      }
      const packHit = await resolvePlacePackOsmGoogle({
        query: name,
        cityHint,
        biasLat: gps.lat ?? undefined,
        biasLng: gps.lng ?? undefined,
      });
      if (packHit) {
        lat = packHit.lat;
        lng = packHit.lng;
        name = packHit.label || name;
      }
    } catch {
      /* soft */
    }
  }
  // Prefetch-Coords (Bridge hat oft schon geocodet)
  if (lat == null || lng == null) {
    try {
      const { awaitNavDestPrefetch } = require('./navDestPrefetch') as {
        awaitNavDestPrefetch: (d?: string | null) => Promise<{
          lat: number;
          lng: number;
          label?: string;
        } | null>;
      };
      const pref = await awaitNavDestPrefetch(name);
      if (pref) {
        lat = pref.lat;
        lng = pref.lng;
        if (pref.label) name = pref.label;
      }
    } catch {
      /* soft */
    }
  }
  // Schon unterwegs zum gleichen Ziel (Bridge-Instant-Commit) → kein clear+restart
  try {
    const { getActiveNavDestination } = require('./navigationService') as {
      getActiveNavDestination: () => {
        name?: string | null;
        lat?: number | null;
        lng?: number | null;
      } | null;
    };
    const { isSameNavDestination } = require('./sameNavDestination') as {
      isSameNavDestination: (o: {
        liveName?: string | null;
        nextName?: string | null;
        liveLat?: number | null;
        liveLng?: number | null;
        nextLat?: number | null;
        nextLng?: number | null;
      }) => boolean;
    };
    const live = getActiveNavDestination();
    if (live && useFinnusStore.getState().navActive) {
      if (
        isSameNavDestination({
          liveName: live.name || useFinnusStore.getState().navTargetName,
          nextName: name,
          liveLat: live.lat,
          liveLng: live.lng,
          nextLat: lat,
          nextLng: lng,
        })
      ) {
        return {
          ok: true,
          name: live.name || name,
          replaced: true,
          reply: `Alles klar — ich führ dich weiter zu ${live.name || name}.`,
        };
      }
    }
  } catch {
    /* soft */
  }
  await clearNavigationHard({ silent: true });
  const result = await commitHandsFreeNavStart(
    {
      name,
      poiId: null,
      lat,
      lng,
      userQuery: opts?.userText ?? destName,
    },
    {
      skipClosingGate: true,
      skipDestVerify: lat != null && lng != null,
    },
  );
  if (!result.ok) {
    return {
      ok: false,
      name,
      replaced,
      reply:
        result.message ||
        `„${name}“ hab ich gerade nicht gefunden — sag den Namen nochmal.`,
    };
  }
  // Kurze Fallback-Speech — Router setzt ETA dran wenn möglich.
  return {
    ok: true,
    name: result.name,
    replaced,
    reply: replaced
      ? `Alles klar — ich führ dich jetzt zu ${result.name}.`
      : `Alles klar — ich navigiere dich zu ${result.name}.`,
  };
}
