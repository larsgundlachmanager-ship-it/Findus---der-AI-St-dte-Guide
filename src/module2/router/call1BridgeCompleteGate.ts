/**
 * bridgeComplete darf Call-2/Recherche nur bei echten Blockern skippen.
 * Touristen-Invent (Amenity, eSIM, Tickets, Novel-Web, …) nie abwürgen.
 */

export type BridgeCompleteResolveOpts = {
  userText: string;
  /** LLM oder Brief behauptet: Bridge = ganze Antwort */
  claimedComplete: boolean;
  askBack: string | null;
  runnableWorkCount: number;
  novelRequiresDeepWeb?: boolean;
};

function isNavStopOnly(text: string): boolean {
  return /\b(stopp|stop|beende|abbrechen)\b.{0,24}\b(navigation|navi|route)\b/iu.test(
    text || '',
  );
}

function isModeOrVoiceOnly(text: string): boolean {
  const t = text || '';
  if (
    /\b(stell\s+die\s+stimme|andere\s+stimme|voice\s+um|travel[\s-]?mode|ich\s+bin\s+mit\s+dem\s+(rad|fahrrad|auto)|zu\s+fu[sß])\b/iu.test(
      t,
    ) &&
    !/\b(wo|find|suche|ticket|hotel|essen|flug|reserv)\b/iu.test(t)
  ) {
    return true;
  }
  return false;
}

/** Nur echte Slot-Blocker — nicht Ambiguity/Permission. */
export function isCriticalSlotAskBack(
  askBack: string | null,
  userText: string,
): boolean {
  if (!askBack || askBack.trim().length < 4) return false;
  const a = askBack.toLowerCase();
  const u = (userText || '').toLowerCase();
  if (
    /\b(flugnummer|abflug|welche\s+uhrzeit|wann\s+(?:fliegt|geht\s+der\s+flug)|flug\s+um\s+wieviel)\b/iu.test(
      a,
    )
  ) {
    return true;
  }
  if (
    /\b(wohin|welches\s+ziel|ziel\s+fehlt|wo\s+soll)\b/iu.test(a) &&
    /\b(taxi|uber|bolt)\b/iu.test(u)
  ) {
    return true;
  }
  // Taxi→Flughafen ohne Flug-Hinweis im User-Satz
  if (
    /\b(taxi|uber|bolt)\b/iu.test(u) &&
    /\b(flughafen|airport|terminal)\b/iu.test(u) &&
    !/\b(flugnummer|abflug|flug\s+\w+|flight\s*[A-Z]{0,3}\d)\b/iu.test(u)
  ) {
    return true;
  }
  return false;
}

/**
 * true = Call-2 wirklich skippen.
 * false = claimedComplete ignorieren, weiter recherchieren.
 */
export function shouldSkipCall2ForBridgeComplete(
  opts: BridgeCompleteResolveOpts,
): boolean {
  const t = String(opts.userText || '').replace(/\s+/g, ' ').trim();
  if (!opts.claimedComplete && !opts.askBack) return false;

  if (isNavStopOnly(t) || isModeOrVoiceOnly(t)) return true;
  if (isCriticalSlotAskBack(opts.askBack, t)) return true;

  // Inventierbar → nie skippen
  if (opts.runnableWorkCount > 0) return false;
  if (opts.novelRequiresDeepWeb) return false;

  try {
    const { isClosedFactAsk } = require('./call1IntentForesight') as {
      isClosedFactAsk: (s: string) => boolean;
    };
    if (isClosedFactAsk(t)) {
      // Quiz braucht Call-2 Fakt — Bridge allein reicht nicht
      return false;
    }
  } catch {
    /* soft */
  }

  try {
    const { looksLikeTouristInventNeed } = require('./call1TouristInvent') as {
      looksLikeTouristInventNeed: (s: string) => boolean;
    };
    if (looksLikeTouristInventNeed(t)) return false;
  } catch {
    /* soft */
  }

  try {
    const { isAmenityPlaceFindQuery } = require('../mission/amenityPlaceFind') as {
      isAmenityPlaceFindQuery: (s: string) => boolean;
    };
    if (isAmenityPlaceFindQuery(t)) return false;
  } catch {
    /* soft */
  }

  // LLM bridgeComplete ohne inventierbare Arbeit und ohne Critical → nur bei klarer Ack/Stop
  if (
    opts.claimedComplete &&
    /\b(danke|ok|okay|alles\s+klar|passt|super|ja\s+genau)\b/iu.test(t) &&
    t.length < 40
  ) {
    return true;
  }

  // Default: bei claimedComplete ohne Critical lieber recherchieren als stumm bleiben
  return false;
}

/** Finales bridgeComplete-Flag für Brief/Analysis. */
export function resolveBridgeCompleteFlag(
  opts: BridgeCompleteResolveOpts,
): boolean {
  const claimed =
    opts.claimedComplete ||
    (Boolean(opts.askBack) && isCriticalSlotAskBack(opts.askBack, opts.userText));
  return shouldSkipCall2ForBridgeComplete({ ...opts, claimedComplete: claimed });
}
