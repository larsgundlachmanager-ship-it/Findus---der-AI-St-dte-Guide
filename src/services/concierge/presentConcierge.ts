/**
 * Voice-first Concierge Playback:
 * 1) Wenn Yorro Navigation ankündigt → Kompass SOFORT
 * 2) TTS parallel (User kann schon losgehen)
 * 3) Spickzettel-Karte, sobald die Stimme läuft
 */

import type { GeminiConciergeResponse } from '../../types/concierge';
import type { ConciergeCardState } from '../../types/concierge';
import type { QuickAction } from '../../types/concierge';
import { useFinnusStore } from '../../store/useFinnusStore';
import { getVoiceSettingsForTour } from '../ttsService';
import { speakRuntimeText } from '../../runtime/speechModule';
import type { ConciergeContext } from './conciergeContext';
import {
  clampVisualBullets,
} from './parseConciergeResponse';
import type { TransitAdvice } from '../transit/transitAdvisor';
import { formatDelayStatus } from '../transit/transitAdvisor';
import { getAllPois, getPoiWithFacts } from '../../db/database';
import { normalizeNavActionsAndOffer } from '../navigation/resolveNavTarget';
import {
  isExplicitNavIntent,
  shouldBlockAutoNavigation,
} from '../intent/poiInfoVsNav';
import {
  buildBounceLuggageAction,
  buildCarRentalAction,
  buildEsimAction,
  getAiraloAffiliateUrl,
  buildStay22AccommodationAction,
  buildExpediaAccommodationAction,
  buildTourBookingAction,
  buildTravelInsuranceAction,
  buildCampingInfoAction,
  buildSolmarAction,
  buildPackageHolidayAction,
  buildCheck24CarRentalAction,
  buildTravelpayoutsCategoryAction,
  buildEconomyBookingsAction,
  looksLikeFakeTourSlug,
  buildGetYourGuideSearchUrl,
  normalizeAffiliateUrl,
  isBounceAvailableForCity,
  buildUberRideAction,
} from '../affiliate/affiliateService';
import {
  extractCampingplatzName,
  parseTravelDateYmd,
  parseClockHmm,
  parseLuggageBagCount,
  addDaysYmd,
  resolveEsimCountry,
  roundClockHmmDownTo5,
  encodeUriBrackets,
} from '../affiliate/partnerDeepPrefill';
import {
  withWegotripPrefill,
  withSailyAffiliate,
  buildSailyCountryPageUrl,
  buildYesimCountryPageUrl,
  buildCompensairCheckUrl,
} from '../affiliate/partnerTpxDeepLink';
import { parseOriginIata } from '../affiliate/partnerAwinHolidayDeepLink';
import { buildKonfettiAction } from '../affiliate/konfettiAffiliate';
import {
  buildReservixAction,
  RESERVIX_LIVE_EVENT_RE,
} from '../affiliate/reservixAffiliate';
import {
  MAX_QUICK_ACTIONS,
  MAX_EVENT_QUICK_ACTIONS,
  prioritizeQuickActions,
} from '../affiliate/prioritizeActions';

const TOUR_PARTNER_URL_RE =
  /getyourguide|musement|viator|tripadvisor|klook|tiqets|kkday|wegotrip|gocity/i;

function readGpsLatLng(): { lat: number | null; lng: number | null } {
  try {
    const { useGpsStore } = require('../../store/useGpsStore') as {
      useGpsStore: {
        getState: () => { lat: number | null; lng: number | null };
      };
    };
    const gps = useGpsStore.getState();
    return { lat: gps.lat ?? null, lng: gps.lng ?? null };
  } catch {
    return { lat: null, lng: null };
  }
}
import { pickPendingAffiliateOffer } from '../affiliate/pendingAffiliateOffer';
import { enrichPlaylistOffers } from '../playlistService';
import { getCachedUserProfile } from '../userProfileService';
import type { QuickActionType } from '../../types/concierge';
import { speechAsksForConfirmation } from './speechAsksConfirmation';
import {
  buildCityMapAction,
  getCityMapLink,
  isCityMapUrl,
  openCityMap,
  speechCommitsToMap,
  speechMentionsMap,
} from '../cityMapService';
import {
  buildPlaceChoiceActions,
  shouldForcePlaceChoiceChips,
  wantsMusicExplicitly,
  wantsUberExplicitly,
} from './quickActionPolicy';
import { namesAlign } from './canonicalDestination';
import {
  buildReservationQuickActions,
  evaluateReservationIntel,
} from '../../runtime/reservationIntel';
import {
  speechAdmitsNoActionableData,
  stripFakeReservationClaims,
  stripOrphanButtonClaims,
  stripUnbackedActions,
} from './zeroFakeActions';
import { recordFindusActionsTriggered } from '../feedback/executionTracking';
import { applyHardGuardrails } from '../agi/speechGuardrails';
import { applyActionButtonJudge } from '../agi/actionButtonJudge';
import { shortenActionLabel } from './actionLabelShorten';
import { buildNamedBookingPortalActions } from './bookingPlatformActions';

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Wartet auf hörbares Audio — nicht auf isPlayingAudio (das wird vor Synth gesetzt). */
async function waitUntilVoicePlaying(timeoutMs = 8000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const { isAudiblyPlaying } = require('../AudioVoiceService') as {
        isAudiblyPlaying: () => boolean;
      };
      if (isAudiblyPlaying()) return true;
    } catch {
      if (useFinnusStore.getState().isAudiblySpeaking) return true;
    }
    await sleep(50);
  }
  try {
    const { isAudiblyPlaying } = require('../AudioVoiceService') as {
      isAudiblyPlaying: () => boolean;
    };
    return isAudiblyPlaying();
  } catch {
    return useFinnusStore.getState().isAudiblySpeaking === true;
  }
}

export function toConciergeCardState(
  response: GeminiConciergeResponse,
  opts?: { id?: string },
): ConciergeCardState {
  return {
    ...response,
    id:
      opts?.id ??
      `cc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    createdAtMs: Date.now(),
  };
}

/** Yorro behauptet, Navigation zu starten (kein bloßes Angebot). */
export function speechCommitsToNavigation(speech: string): boolean {
  const t = speech.trim();
  if (!t) return false;

  const asksPermission =
    /\b(soll\s+ich|darf\s+ich|sollen\s+wir|wollen\s+wir|möchtest\s+du|moechtest\s+du|willst\s+du|solln\s+wir)\b/iu.test(
      t,
    ) &&
    /\b(kompass|navigation|route|führ|fuehr|hinnavig|anmachen)\b/iu.test(t);

  const commits =
    /\b(ich\s+starte\s+die\s+navigation|ich\s+(führ|fuehr|bring|schalt|mach|start)(?:e|en)?|führ\s+dich\s+hin|fuehr\s+dich\s+hin|folge(?:\s+\w+){0,3}\s+dem\s+pfeil|kompass\s+(?:ist\s+)?(?:an|aktiv)|navigation\s+(?:startet|läuft|laeuft|ist\s+an)|schalt(?:e|)\s+(?:dir\s+)?(?:sofort\s+)?den\s+kompass|mach(?:e|)\s+(?:dir\s+)?(?:sofort\s+)?den\s+kompass|route\s+(?:startet|läuft|laeuft)|gleich\s+los|direkt\s+los)\b/iu.test(
      t,
    );

  // Reine Frage → warten auf Button/Ja
  if (asksPermission && !commits) return false;
  return commits;
}

async function attachCityMapAction(
  response: GeminiConciergeResponse,
  actions: QuickAction[],
): Promise<QuickAction[]> {
  if (!speechMentionsMap(response.speechText)) return actions;
  const hasMap = actions.some(
    (a) => a.type === 'OPEN_URL' && isCityMapUrl(a.payload.url),
  );
  if (hasMap) return actions;
  const link = await getCityMapLink();
  if (!link) return actions;
  return [...actions, buildCityMapAction(link)];
}

/**
 * Kompass sofort aktivieren, wenn Speech das zusagt.
 * Blockiert die Stimme nicht länger als nötig.
 */
export type AutoNavCommitResult = {
  started: boolean;
  confirmSpeech?: string;
};

export async function autoStartNavigationIfCommitted(
  response: GeminiConciergeResponse,
  opts?: {
    skipAutoNav?: boolean;
    userText?: string;
    /** Reboot Fact-Lane: Unique-Amenity / Just-Do-It — Speech-Heuristik überspringen */
    forceAutoNav?: boolean;
  },
): Promise<AutoNavCommitResult> {
  const NO: AutoNavCommitResult = { started: false };
  const YES: AutoNavCommitResult = { started: true };
  if (opts?.skipAutoNav) return NO;
  const store = useFinnusStore.getState();
  const userText = (opts?.userText ?? '').replace(/\s+/g, ' ').trim();
  const force = opts?.forceAutoNav === true;
  let affirming = false;
  try {
    const { isNavAffirmation } = require('../navigation/pendingOffer') as {
      isNavAffirmation: (t: string) => boolean;
    };
    affirming = Boolean(userText && isNavAffirmation(userText));
  } catch {
    /* soft */
  }

  // Reine Faktenfragen nie auto-nav — außer Fact-Lane erzwingt Unique-Ziel
  if (userText && shouldBlockAutoNavigation(userText) && !force) return NO;

  // Kalender offen / pending choice: nie auto-nav — außer User sagt „jetzt sofort los“
  try {
    const { usePlanCalendarUiStore } = require('../../module2/timeline/planCalendarUiStore') as {
      usePlanCalendarUiStore: {
        getState: () => { openRequestAtMs: number | null; pendingChoice: unknown };
      };
    };
    const planUi = usePlanCalendarUiStore.getState();
    const planningOn = planUi.pendingChoice != null;
    const userNow =
      userText &&
      (isExplicitNavIntent(userText) ||
        /\b(jetzt\s+sofort\s+los|jetzt\s+navigier|sofort\s+navigier|jetzt\s+starten)\b/i.test(
          userText,
        ));
    // Explizite Nav / Force: Pending-Choice (Pitch/Timeline) darf Just-Do-It nicht blocken
    if (planningOn && !userNow && !force) return NO;
  } catch {
    /* soft */
  }

  const navActions = response.quickActions.filter(
    (a) => a.type === 'START_NAVIGATION',
  );
  const commits = speechCommitsToNavigation(response.speechText);
  const mentionsNav =
    /\b(führ|fuehr|kompass|pfeil|route|bring\s+dich|navigation)\b/iu.test(
      response.speechText,
    );
  const onlyAsking =
    /\b(soll\s+ich|darf\s+ich|sollen\s+wir|wollen\s+wir|möchtest\s+du|moechtest\s+du|willst\s+du|meinst\s+du)\b/iu.test(
      response.speechText,
    ) && !commits;

  const singleTargetGo =
    navActions.length === 1 && mentionsNav && !onlyAsking;

  // Einziger Amenity-Treffer (Aldi etc.): Speech sagt „nur einen / Route startet“
  const uniqueAmenityGo =
    navActions.length === 1 &&
    !onlyAsking &&
    /\b(nur\s+einen|einzige[rn]?|führ\s+dich\s+hin|route\s+startet|ich\s+führ\s+dich)\b/iu.test(
      response.speechText,
    );

  // Explizites „navigiere mich…“ → Just-Do-It, auch wenn Speech noch fragt
  const userExplicit = userText.length > 0 && isExplicitNavIntent(userText);

  if (
    !force &&
    !commits &&
    !singleTargetGo &&
    !uniqueAmenityGo &&
    !userExplicit
  ) {
    return NO;
  }
  // Explizites „Bring mich…“ ohne Button: Ziel aus Text resolven + starten (nicht Buttons-only)
  if (
    (force || userExplicit) &&
    navActions.length === 0 &&
    !store.pendingNavOffer
  ) {
    try {
      const { getShortTerm, resolveLocalAnchor } = require('../../module2/context/shortTermContext') as {
        getShortTerm: () => { lastPlaceName: string | null };
        resolveLocalAnchor: (t: string) => {
          name: string;
          lat: number;
          lng: number;
        } | null;
      };
      const { extractNamedDestinationLabel } = require('./canonicalDestination') as {
        extractNamedDestinationLabel: (t: string) => string | null;
      };
      const short = getShortTerm();
      const named = extractNamedDestinationLabel(userText);
      const anchor =
        resolveLocalAnchor(userText) ||
        (named ? resolveLocalAnchor(named) : null) ||
        (short.lastPlaceName
          ? resolveLocalAnchor(short.lastPlaceName)
          : null);
      if (anchor) {
        store.setPendingNavOffer({
          poiId: -1,
          name: anchor.name,
          lat: anchor.lat,
          lng: anchor.lng,
        });
      } else if (named || userExplicit) {
        // Name ohne lokale Coords → commitHandsFreeNavStart resolvt Pack/Geocode
        const { commitHandsFreeNavStart } = await import(
          '../navigation/handsFreeNav'
        );
        const started = await commitHandsFreeNavStart(
          {
            poiId: null,
            name: named || userText,
            lat: null,
            lng: null,
          },
          { skipClosingGate: true },
        );
        if (started.ok) {
          const speechHasEta =
            /\b\d{1,3}\s*(?:min(?:ute)?n?)\b/iu.test(response.speechText || '');
          if (speechHasEta) {
            try {
              const { markNavOpeningSpoken } = require('../navigation/landmarkNavCoach') as {
                markNavOpeningSpoken: () => void;
              };
              markNavOpeningSpoken();
            } catch {
              /* soft */
            }
          }
          if (__DEV__) {
            console.log(
              `[concierge] auto-start nav (explicit resolve) via=${started.via} name=${started.name}`,
            );
          }
          return YES;
        }
        if (started.needsConfirm) {
          return { started: false, confirmSpeech: started.message };
        }
        return NO;
      } else {
        return NO;
      }
    } catch {
      return NO;
    }
  }

  // Confirm-Offer: nicht im selben Turn auto-starten (Name enthält schon die Stadt)
  if (
    useFinnusStore.getState().pendingNavOffer?.awaitConfirm &&
    !affirming
  ) {
    return NO;
  }

  // Laufende Nav: bei neuem expliziten Ziel / Force → Retarget (nicht Fake-Success)
  if (store.navActive) {
    const navActionPeek = navActions[0];
    const offerPeek = useFinnusStore.getState().pendingNavOffer;
    const nextName = (
      navActionPeek?.payload.destName ||
      navActionPeek?.label ||
      offerPeek?.name ||
      ''
    )
      .trim()
      .toLowerCase();
    const curName = (store.navTargetName || '').trim().toLowerCase();
    const sameDest =
      nextName.length >= 2 &&
      curName.length >= 2 &&
      (nextName === curName ||
        nextName.includes(curName) ||
        curName.includes(nextName));
    if (sameDest && (commits || userExplicit || force || uniqueAmenityGo)) {
      return YES;
    }
    if (!commits && !userExplicit && !uniqueAmenityGo && !force) {
      return NO;
    }
    // sonst unten commitHandsFreeNavStart (Retarget)
  }

  const navAction = navActions[0];
  const offer = useFinnusStore.getState().pendingNavOffer;
  const { commitHandsFreeNavStart } = await import(
    '../navigation/handsFreeNav'
  );
  // Explizite Action-Koordinaten schlagen immer ein altes Pending-Offer (sonst Drift zu letztem POI)
  const hasActionCoords =
    typeof navAction?.payload.destLat === 'number' &&
    typeof navAction?.payload.destLng === 'number' &&
    Number.isFinite(navAction.payload.destLat) &&
    Number.isFinite(navAction.payload.destLng);
  const started = await commitHandsFreeNavStart(
    {
      poiId: hasActionCoords
        ? (navAction?.payload.targetPoiId ?? -1)
        : (navAction?.payload.targetPoiId ?? offer?.poiId),
      name:
        navAction?.payload.destName ||
        navAction?.label ||
        offer?.name ||
        null,
      lat: hasActionCoords
        ? navAction!.payload.destLat!
        : (navAction?.payload.destLat ?? offer?.lat ?? null),
      lng: hasActionCoords
        ? navAction!.payload.destLng!
        : (navAction?.payload.destLng ?? offer?.lng ?? null),
    },
    {
      // User sagt explizit navigieren → nicht an Closing-Gate hängen
      skipClosingGate: force || userExplicit,
    },
  );

  if (!started.ok) {
    if (started.needsConfirm) {
      return { started: false, confirmSpeech: started.message };
    }
    console.warn(
      '[concierge] Speech sagt Navigation zu, aber Ziel nicht auflösbar',
      started.message,
    );
    return NO;
  }

  // Distanz-SSOT: nur committed Routenmeter (kein LLM-/Luftlinien-Raten)
  try {
    const { bindSpeechToCommittedRoute } = require('../navigation/navSpeechDistance') as {
      bindSpeechToCommittedRoute: (
        s: string,
        o?: { appendIfMissing?: boolean },
      ) => string;
    };
    if (response.speechText) {
      response.speechText = bindSpeechToCommittedRoute(response.speechText, {
        appendIfMissing: true,
      });
    }
  } catch {
    /* soft */
  }

  // Coach-ETA nur schlucken, wenn Concierge die Minuten schon gesagt hat
  const speechHasEta =
    /\b\d{1,3}\s*(?:min(?:ute)?n?)\b/iu.test(response.speechText || '');
  if (speechHasEta) {
    try {
      const { markNavOpeningSpoken } = require('../navigation/landmarkNavCoach') as {
        markNavOpeningSpoken: () => void;
      };
      markNavOpeningSpoken();
    } catch {
      /* soft */
    }
  }

  if (__DEV__) {
    console.log(
      `[concierge] auto-start nav via=${started.via} name=${started.name} ok=true explicit=${userExplicit}`,
    );
  }
  return YES;
}


/** Event-Turns: bis 4 Buttons; sonst Default-Cap. */
function actionCap(ctx: ConciergeContext | null): number {
  return (
    ctx?.maxQuickActions ??
    (ctx?.eventResearch?.events?.length ? MAX_EVENT_QUICK_ACTIONS : MAX_QUICK_ACTIONS)
  );
}

function navCap(ctx: ConciergeContext | null): number {
  return ctx?.eventResearch?.events?.length ? 3 : 2;
}

/** Ergänzt Nav-/Partner-Actions — progressive disclosure, voice-first. */
export async function enrichWithConciergeOffers(
  response: GeminiConciergeResponse,
  ctx: ConciergeContext | null,
): Promise<GeminiConciergeResponse> {
  // Event-Recherche: Buttons aus Research (Route + PDF + Tickets), Speech sync
  if (ctx?.eventResearch?.events?.length) {
    const { eventResearchToActions, synthesizeEventSpeech } = await import(
      './eventResearchService'
    );
    let speechText = response.speechText.trim();
    const research = ctx.eventResearch;
    const mentionsAny = research.events.some(
      (e) => namesAlign(speechText, e.venue) || namesAlign(speechText, e.title),
    );
    if (!speechText || !mentionsAny) {
      speechText = synthesizeEventSpeech(research);
    }
    const fromResearch = eventResearchToActions(research, {
      includeNav:
        research.events.length === 1 ||
        (() => {
          try {
            const {
              wantsEventBriefingActions,
              isEventFestivalDeepenQuery,
            } = require('./eventFestivalType') as {
              wantsEventBriefingActions: (s: string) => boolean;
              isEventFestivalDeepenQuery: (s: string) => boolean;
            };
            const ut = research.userText || '';
            return wantsEventBriefingActions(ut) || isEventFestivalDeepenQuery(ut);
          } catch {
            return false;
          }
        })(),
    });
    const geminiAligned = response.quickActions.filter((a) => {
      if (a.type === 'START_NAVIGATION') {
        return research.events.some((e) =>
          namesAlign(a.payload.destName || a.label, e.venue),
        );
      }
      if (a.type === 'OPEN_URL') {
        return research.events.some(
          (e) =>
            (e.infoUrl && a.payload.url === e.infoUrl) ||
            (e.ticketUrl && a.payload.url === e.ticketUrl),
        );
      }
      return false;
    });
    const merged: QuickAction[] = [];
    const seen = new Set<string>();
    for (const a of [...fromResearch, ...geminiAligned]) {
      const key = `${a.type}:${a.payload.url ?? ''}:${a.payload.destName ?? a.label}`;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(a);
    }
    const cap = actionCap(ctx);
    const ranked = prioritizeQuickActions(merged, {
      maxActions: cap,
      maxNavActions: navCap(ctx),
      primaryIntentTypes: ['START_NAVIGATION', 'OPEN_URL'],
    });
    const normalized = await normalizeNavActionsAndOffer({
      actions: ranked,
      fallbackOffer: ctx.primaryOffer,
    });
    if (ctx.primaryOffer) {
      useFinnusStore.getState().setPendingNavOffer(
        normalized.offer ?? ctx.primaryOffer,
      );
      useFinnusStore
        .getState()
        .setPendingNavAlternatives(ctx.alternatives.slice(0, 2));
    }
    return {
      ...response,
      speechText,
      cardTitle: response.cardTitle || 'Heute vor Ort',
      visualBullets: clampVisualBullets(
        response.visualBullets.length > 0
          ? response.visualBullets
          : ctx.fallbackBullets ?? [],
      ),
      quickActions: normalized.actions.slice(0, cap) as QuickAction[],
    };
  }

  // Wahl-Turn: Spickzettel = genau die 2 gesprochenen Orte (Tap = Auswahl)
  if (shouldForcePlaceChoiceChips(response.speechText, ctx) && ctx?.primaryOffer) {
    const choiceActions = buildPlaceChoiceActions(
      ctx.primaryOffer,
      ctx.alternatives,
    ).map((action) =>
      ctx.kind === 'food'
        ? {
            ...action,
            payload: {
              ...action.payload,
              autoFollowUp: 'reservation' as const,
            },
          }
        : action,
    );
    const normalized = await normalizeNavActionsAndOffer({
      actions: choiceActions,
      fallbackOffer: ctx.primaryOffer,
    });
    let speechText = response.speechText.trim();
    if (!speechText && ctx.fallbackSpeech?.trim()) {
      speechText = ctx.fallbackSpeech.trim();
      try {
        const { noteFallback } = await import('../debug/fallbackLabel');
        noteFallback('Concierge-Speech', speechText.slice(0, 80));
      } catch {
        /* soft */
      }
    }
    return {
      ...response,
      speechText,
      visualBullets: clampVisualBullets(
        response.visualBullets.length > 0
          ? response.visualBullets
          : ctx.fallbackBullets ?? [],
      ),
      cardTitle:
        response.cardTitle ||
        (ctx.kind === 'general' ? 'Was heute geht' : titleForKind(ctx.kind)),
      quickActions: normalized.actions.slice(0, 2) as QuickAction[],
    };
  }

  let actions = [...response.quickActions];

  if (ctx?.namedDestination && ctx.primaryOffer) {
    // SSOT: strip foreign nav chips, bind Route starten + Tisch/Speisekarte to named place
    const offer = ctx.primaryOffer;
    actions = actions.filter(
      (a) =>
        a.type !== 'START_NAVIGATION' &&
        a.type !== 'BOOK_STAY22', // open Stay22 only via hotel pack if needed
    );
    actions.unshift({
      type: 'START_NAVIGATION',
      label: '📍 Route starten',
      payload: {
        targetPoiId: offer.poiId,
        destName: offer.name,
        destLat: offer.lat,
        destLng: offer.lng,
      },
    });

    // Named hotel: why + availability check + booking button
    const looksHotel =
      ctx.kind === 'accommodation' ||
      /\b(hotel|pension|hostel|apartment|ferienwohnung|unterkunft)\b/iu.test(
        offer.name,
      );
    if (looksHotel) {
      try {
        const { buildHotelBookingPack } = await import('./hotelBookingPack');
        const pack = await buildHotelBookingPack(offer, {
          userText: response.speechText,
          suggestWhy: true,
        });
        // Only researched booking actions — never static Stay22-without-check
        for (const a of pack.actions) {
          if (!actions.some((x) => x.type === a.type && x.label === a.label)) {
            actions.push(a);
          }
        }
        if (pack.speechExtra) {
          (response as { _hotelSpeech?: string })._hotelSpeech =
            pack.available === false
              ? pack.speechExtra
              : pack.speechExtra;
        }
      } catch (err) {
        if (__DEV__) console.warn('[concierge] hotel booking pack', err);
      }
    }

    if (
      (ctx.kind === 'food' || ctx.kind === 'reservation') &&
      offer.poiId > 0
    ) {
      try {
        const poi = await getPoiWithFacts(offer.poiId);
        if (poi) {
          const intel = await evaluateReservationIntel(poi, '');
          const resActions = buildReservationQuickActions(intel, null, {
            lat: offer.lat ?? poi.lat,
            lng: offer.lng ?? poi.lng,
          }).filter((a) => a.type !== 'START_NAVIGATION');
          for (const a of resActions) {
            const exists = actions.some(
              (x) =>
                x.type === a.type ||
                (x.type === 'OPEN_URL' &&
                  a.type === 'OPEN_URL' &&
                  /speisekarte|karte|menu/i.test(x.label)),
            );
            if (!exists) actions.push(a);
          }
          // Speisekarte / Reservieren: Emoji + Kurzlabel (max 20)
          actions = actions.map((a) => {
            if (a.type === 'OPEN_URL' && /speisekarte|menu|karte|🍽/i.test(a.label)) {
              const name =
                a.payload.destName?.trim() ||
                offer.name ||
                a.label.replace(/^🍽\s*|Speisekarte\s*/iu, '').trim();
              const label = shortenActionLabel(
                name ? `🍽 ${name}` : '🍽 Karte',
              );
              return { ...a, label };
            }
            if (a.type === 'CONFIRM_API_RESERVATION') {
              return { ...a, label: shortenActionLabel('🍽 Tisch') };
            }
            if (a.type === 'SEND_RESERVATION_EMAIL') {
              return { ...a, label: shortenActionLabel('🍽 Anfragen') };
            }
            return a;
          });
        }
      } catch (err) {
        if (__DEV__) console.warn('[concierge] named dest reservation pack', err);
      }
    }

    // Speech must mention the named place — else use fallback
    let speechText = response.speechText.trim();
    if (
      !namesAlign(speechText, offer.name) &&
      ctx.fallbackSpeech?.trim()
    ) {
      speechText = ctx.fallbackSpeech.trim();
    } else if (!speechText && ctx.fallbackSpeech?.trim()) {
      speechText = ctx.fallbackSpeech.trim();
    }
    const hotelExtra = (response as { _hotelSpeech?: string })._hotelSpeech;
    if (hotelExtra?.trim()) {
      speechText = `${speechText} ${hotelExtra.trim()}`.trim();
    }

    const normalized = await normalizeNavActionsAndOffer({
      actions,
      fallbackOffer: offer,
    });
    useFinnusStore.getState().setPendingNavOffer(
      normalized.offer ?? offer,
    );
    useFinnusStore.getState().setPendingNavAlternatives([]);

    return {
      ...response,
      speechText,
      cardTitle: response.cardTitle || offer.name,
      visualBullets: clampVisualBullets(
        response.visualBullets.length > 0
          ? response.visualBullets
          : ctx.fallbackBullets ?? [offer.name],
      ),
      quickActions: prioritizeQuickActions(
        normalized.actions as QuickAction[],
        {
          maxActions: actionCap(ctx),
          maxNavActions: navCap(ctx),
        },
      ).slice(0, actionCap(ctx)),
    };
  }

  if (ctx?.primaryOffer) {
    const hasNav = actions.some((a) => a.type === 'START_NAVIGATION');
    if (!hasNav) {
      actions.unshift({
        type: 'START_NAVIGATION',
        label: ctx.primaryOffer.name,
        payload: {
          targetPoiId: ctx.primaryOffer.poiId,
          destName: ctx.primaryOffer.name,
          destLat: ctx.primaryOffer.lat,
          destLng: ctx.primaryOffer.lng,
        },
      });
    } else {
      // Retarget mismatched nav chips toward primary when speech aligns with primary
      actions = actions.map((a) => {
        if (a.type !== 'START_NAVIGATION') return a;
        const id = String(a.payload.targetPoiId ?? '');
        if (id === String(ctx.primaryOffer!.poiId)) {
          return {
            ...a,
            label: `📍 Route: ${ctx.primaryOffer!.name}`,
            payload: {
              ...a.payload,
              targetPoiId: ctx.primaryOffer!.poiId,
              destName: ctx.primaryOffer!.name,
              destLat: ctx.primaryOffer!.lat,
              destLng: ctx.primaryOffer!.lng,
            },
          };
        }
        const alt = ctx.alternatives.find((x) => String(x.poiId) === id);
        if (alt) return { ...a, label: alt.name };
        // Speech names primary but chip names something else → force primary
        const chipName = String(a.payload.destName || a.label || '');
        if (
          namesAlign(response.speechText, ctx.primaryOffer!.name) &&
          !namesAlign(chipName, ctx.primaryOffer!.name)
        ) {
          return {
            ...a,
            label: `📍 Route starten`,
            payload: {
              targetPoiId: ctx.primaryOffer!.poiId,
              destName: ctx.primaryOffer!.name,
              destLat: ctx.primaryOffer!.lat,
              destLng: ctx.primaryOffer!.lng,
            },
          };
        }
        return a;
      });
    }

    // Uber: explizit · Food-Zusage · lange ÖPNV-Strecke
    const offerUber =
      wantsUberExplicitly(response.speechText) ||
      ((ctx.kind === 'food' || ctx.kind === 'reservation') &&
        speechCommitsToNavigation(response.speechText)) ||
      /\b(öpnv|oepnv|uber|taxi|fuß\s+dauert|fuss\s+dauert)\b/iu.test(
        response.speechText,
      );

    if (offerUber) {
      let destLat: number | undefined = ctx.primaryOffer.lat;
      let destLng: number | undefined = ctx.primaryOffer.lng;
      let destName = ctx.primaryOffer.name;
      const pois = await getAllPois();
      const poi = pois.find((p) => p.id === ctx.primaryOffer!.poiId);
      if (poi) {
        destLat = poi.lat;
        destLng = poi.lng;
        destName = poi.name;
      }
      const hasUber = actions.some((a) => a.type === 'BOOK_UBER');
      if (!hasUber && destLat != null && destLng != null) {
        const time = parseClockHmm(response.speechText);
        actions.push(
          buildUberRideAction(destLat, destLng, destName, undefined, {
            dropoffFormattedAddress: destName,
            pickupTimeLabel: time,
          }),
        );
      }
      actions = actions.map((a) => {
        if (a.type !== 'BOOK_UBER') return a;
        const t = (a.payload.pickupTimeLabel || '').trim();
        const rounded = t ? roundClockHmmDownTo5(t) : t;
        const url = a.payload.url
          ? encodeUriBrackets(a.payload.url)
          : a.payload.url;
        let label = a.label;
        if (t && rounded && t !== rounded) {
          label = label.replace(t, rounded);
        }
        return {
          ...a,
          label,
          payload: {
            ...a.payload,
            url,
            pickupTimeLabel: rounded || undefined,
          },
        };
      });
    } else {
      actions = actions.filter((a) => a.type !== 'BOOK_UBER');
    }
  }

  // Uber Eats — nur bei klarem Liefer-Intent (User-Text)
  try {
    const {
      wantsUberEatsExplicitly,
      buildUberEatsAction,
    } = require('../affiliate/affiliateService') as {
      wantsUberEatsExplicitly: (t: string) => boolean;
      buildUberEatsAction: (o?: {
        cityHint?: string | null;
        query?: string | null;
      }) => { type: 'OPEN_URL'; label: string; payload: { url: string } };
    };
    const blob = `${response.speechText || ''}`;
    // Speech allein reicht selten — Concierge-Ctx-Kind food + Liefer-Wörter
    if (
      wantsUberEatsExplicitly(blob) ||
      (ctx?.kind === 'food' &&
        /\b(liefern|lieferung|delivery|uber\s*eats)\b/iu.test(blob))
    ) {
      const eats = buildUberEatsAction({
        cityHint: ctx?.primaryOffer?.name,
        query: ctx?.primaryOffer?.name,
      });
      if (!actions.some((a) => a.payload?.url === eats.payload.url)) {
        actions.push(eats as any);
      }
    }
  } catch {
    /* soft */
  }

  const offerCar =
    ctx?.wantsCarRental === true ||
    actions.some((a) => a.type === 'BOOK_CAR_RENTAL') ||
    /\b(mietwagen|leihwagen|auto\s+mieten|wagen\s+mieten)\b/iu.test(
      response.speechText,
    );

  if (offerCar) {
    const carIdx = actions.findIndex((a) => a.type === 'BOOK_CAR_RENTAL');
    const carCity =
      getCachedUserProfile()?.cityName?.trim() ||
      null;
    const carPickup = parseTravelDateYmd(response.speechText);
    const carDrop = carPickup ? addDaysYmd(carPickup, 3) : null;
    const carAction = buildCarRentalAction({
      pickupLocation: carCity,
      pickupDate: carPickup,
      dropoffDate: carDrop,
    });
    if (carIdx >= 0) {
      actions[carIdx] = {
        ...actions[carIdx],
        label: actions[carIdx].label || carAction.label,
        payload: {
          ...actions[carIdx].payload,
          url: carAction.payload.url,
        },
      };
    } else {
      actions.push(carAction);
    }
    if (
      /\b(check[\s-]?24|vergleich(?:en)?)\b/iu.test(response.speechText) &&
      !actions.some(
        (a) =>
          a.type === 'OPEN_URL' &&
          /mietwagen\.check24\.de|check24\.net\/mietwagen|awin1\.com.*9364/i.test(
            a.payload.url ?? '',
          ),
      )
    ) {
      actions.push(buildCheck24CarRentalAction());
    }
    if (
      /\beconomy[\s-]?bookings\b/iu.test(response.speechText) &&
      !actions.some(
        (a) =>
          a.type === 'OPEN_URL' &&
          /economybookings\.com/i.test(a.payload.url ?? ''),
      )
    ) {
      actions.push(
        buildEconomyBookingsAction({
          pickupDate: carPickup,
          dropoffDate: carDrop,
          pickupTime: '10:00',
          dropoffTime: '10:00',
        }),
      );
    }
  }

  const profileForBounce = getCachedUserProfile();
  const bounceAvailable = isBounceAvailableForCity(
    profileForBounce?.cityId,
    profileForBounce?.cityName,
  );
  const offerBounce =
    bounceAvailable &&
    (ctx?.wantsBounceLuggage === true ||
      actions.some((a) => a.type === 'BOOK_BOUNCE_LUGGAGE') ||
      /\b(gepäck|gepaeck|kofferfrei|bounce|aufbewahrung|früheincheck|frueheincheck|spätabflug|spaetabflug)\b/iu.test(
        response.speechText,
      ));

  if (offerBounce) {
    const bounceIdx = actions.findIndex((a) => a.type === 'BOOK_BOUNCE_LUGGAGE');
    const bounceDay =
      parseTravelDateYmd(response.speechText) ||
      new Date().toISOString().slice(0, 10);
    const bags = parseLuggageBagCount(response.speechText) ?? 2;
    const bounceAction = buildBounceLuggageAction({
      fromDate: bounceDay,
      toDate: bounceDay,
      standardBags: bags,
    });
    if (bounceAction) {
      if (bounceIdx >= 0) {
        actions[bounceIdx] = {
          ...actions[bounceIdx],
          label: actions[bounceIdx].label || bounceAction.label,
          payload: {
            ...actions[bounceIdx].payload,
            url: bounceAction.payload.url,
          },
        };
      } else {
        actions.push(bounceAction);
      }
    }
    const cityName = getCachedUserProfile()?.cityName?.trim() || '';
    const gps = readGpsLatLng();
    const hasRadical = actions.some(
      (a) =>
        a.type === 'OPEN_URL' && /radicalstorage/i.test(a.payload.url ?? ''),
    );
    if (!hasRadical) {
      const day = parseTravelDateYmd(response.speechText);
      actions.push(
        buildTravelpayoutsCategoryAction('luggage', {
          cityOrQuery: cityName,
          lat: gps.lat,
          lng: gps.lng,
          dateIso: day,
          endDateIso: day,
          dropOffTimeHm: parseClockHmm(response.speechText) || '11:00',
          pickUpTimeHm: '16:00',
          bags: parseLuggageBagCount(response.speechText) ?? 2,
        }),
      );
    }
  } else {
    // Kein Bounce vor Ort — Radical Storage (Travelpayouts) als Fallback
    for (let i = actions.length - 1; i >= 0; i--) {
      if (actions[i]?.type === 'BOOK_BOUNCE_LUGGAGE') actions.splice(i, 1);
    }
    if (
      /\b(gepäck|gepaeck|kofferfrei|aufbewahrung|früheincheck|frueheincheck|spätabflug|spaetabflug)\b/iu.test(
        response.speechText,
      )
    ) {
      const hasLuggageUrl = actions.some(
        (a) =>
          a.type === 'OPEN_URL' &&
          /radicalstorage|bounce/i.test(a.payload.url ?? ''),
      );
      if (!hasLuggageUrl) {
        const cityName = getCachedUserProfile()?.cityName?.trim() || '';
        const gps = readGpsLatLng();
        const day = parseTravelDateYmd(response.speechText);
        actions.push(
          buildTravelpayoutsCategoryAction('luggage', {
            cityOrQuery: cityName,
            lat: gps.lat,
            lng: gps.lng,
            dateIso: day,
            endDateIso: day,
            dropOffTimeHm: parseClockHmm(response.speechText) || '11:00',
            pickUpTimeHm: '16:00',
            bags: parseLuggageBagCount(response.speechText) ?? 2,
          }),
        );
      }
    }
  }

  // eSIM (Airalo via Travelpayouts) — nicht mitten in offener Flug-Slot-Abfrage.
  let flightSlotsOpen = false;
  try {
    const { getFlightTripSession } = require('../flights/flightTripSession') as {
      getFlightTripSession: () => { pendingAsk?: string | null } | null;
    };
    flightSlotsOpen = Boolean(getFlightTripSession()?.pendingAsk);
  } catch {
    flightSlotsOpen = false;
  }
  const userAskedEsim = /\b(esim|e-sim|roaming|daten\s*ausland|internet\s*ausland|sim\s*karte)\b/iu.test(
    opts?.userText || '',
  );
  const offerEsim =
    !flightSlotsOpen &&
    (userAskedEsim ||
      actions.some((a) => a.type === 'BOOK_ESIM') ||
      /\b(esim|e-sim|roaming|daten\s*ausland|internet\s*ausland|sim\s*karte)\b/iu.test(
        response.speechText,
      ));
  if (offerEsim) {
    const esimIdx = actions.findIndex((a) => a.type === 'BOOK_ESIM');
    const esimHit = resolveEsimCountry({
      text: response.speechText,
      cityName: getCachedUserProfile()?.cityName,
    });
    const esimAction = buildEsimAction({
      countrySlug: esimHit?.airaloSlug,
      countryLabel: esimHit?.labelDe,
      textHint: response.speechText,
    });
    if (esimAction) {
      if (esimIdx >= 0) {
        actions[esimIdx] = {
          ...actions[esimIdx],
          label: actions[esimIdx].label || esimAction.label,
          payload: {
            ...actions[esimIdx].payload,
            url: esimAction.payload.url,
          },
        };
      } else {
        actions.push(esimAction);
      }
    }
    const airaloUrl = getAiraloAffiliateUrl(esimHit?.airaloSlug);
    if (
      airaloUrl &&
      !actions.some(
        (a) =>
          a.type === 'OPEN_URL' &&
          /airalo\.com|tp\.media\/r\?[^?\s]*p=8310|airalo\.tpx\.li/i.test(
            a.payload.url ?? '',
          ),
      )
    ) {
      actions.push({
        type: 'OPEN_URL',
        label: esimHit?.labelDe
          ? `📱 Airalo ${esimHit.labelDe}`
          : '📱 Airalo eSIM',
        payload: { url: airaloUrl },
      });
    }
    const slug = esimHit?.airaloSlug;
    if (slug) {
      const sailyUrl = withSailyAffiliate(buildSailyCountryPageUrl(slug));
      if (
        !actions.some(
          (a) =>
            a.type === 'OPEN_URL' &&
            /saily\.com|go\.saily\.site/i.test(a.payload.url ?? ''),
        )
      ) {
        actions.push({
          type: 'OPEN_URL',
          label: esimHit?.labelDe
            ? `📱 Saily ${esimHit.labelDe}`
            : '📱 Saily eSIM',
          payload: { url: sailyUrl },
        });
      }
      const yesimUrl = buildYesimCountryPageUrl(slug);
      if (
        !actions.some(
          (a) =>
            a.type === 'OPEN_URL' && /yesim\.tech/i.test(a.payload.url ?? ''),
        )
      ) {
        actions.push({
          type: 'OPEN_URL',
          label: esimHit?.labelDe
            ? `📱 Yesim ${esimHit.labelDe}`
            : '📱 Yesim eSIM',
          payload: { url: yesimUrl },
        });
      }
    }
  }

  // Flughafen-Transfer
  const offerTransfer =
    /\b(flughafen[\s-]?transfer|airport\s*transfer|abholung\s*(am\s*)?flughafen|welcome\s*pickups?|kiwitaxi|gettransfer|shuttle\s*flughafen)\b/iu.test(
      response.speechText,
    ) ||
    actions.some(
      (a) =>
        a.type === 'OPEN_URL' &&
        /welcomepickups|gettransfer|kiwitaxi|intui\.travel/i.test(
          a.payload.url ?? '',
        ),
    );
  if (offerTransfer) {
    const hasTransfer = actions.some(
      (a) =>
        a.type === 'OPEN_URL' &&
        /welcomepickups|gettransfer|kiwitaxi|intui|tpx\.li\/Ex0uoBGe/i.test(
          a.payload.url ?? '',
        ),
    );
    if (!hasTransfer) {
      const cityName = getCachedUserProfile()?.cityName?.trim() || '';
      actions.push(
        buildTravelpayoutsCategoryAction('transfer', {
          cityOrQuery: cityName,
          dateIso:
            parseTravelDateYmd(response.speechText) ||
            new Date().toISOString().slice(0, 10),
          timeHm: parseClockHmm(response.speechText),
          adults: 2,
          luggage: parseLuggageBagCount(response.speechText) ?? 2,
        }),
      );
    }
  }

  // Flüge (Kiwi.com via Travelpayouts — Primär)
  const offerFlights =
    /\b(flug\s*suchen|flüge\s*suchen|flug\s*buchen|flugticket|billigflug|kiwi\.com|\bkiwi\b|aviasales|hin[\s-]?und[\s-]?rückflug|flug\s+nach)\b/iu.test(
      response.speechText,
    );
  if (offerFlights) {
    const hasFlight = actions.some(
      (a) =>
        a.type === 'OPEN_URL' &&
        /kiwi\.com|c111\.travelpayouts\.com|aviasales|tpx\.li\/zk7udfoO/i.test(
          a.payload.url ?? '',
        ),
    );
    if (!hasFlight) {
      actions.push(buildTravelpayoutsCategoryAction('flights'));
    }
  }

  // Flug-Entschädigung
  const offerCompensation =
    /\b(flugentschädigung|fluggastrecht|annulliert|annullierung|überbuchung|ueberbuchung|airhelp|compensair|verspätung.{0,40}entschädig)\b/iu.test(
      response.speechText,
    );
  if (offerCompensation) {
    const hasComp = actions.some(
      (a) =>
        a.type === 'OPEN_URL' &&
        /airhelp|compensair/i.test(a.payload.url ?? ''),
    );
    if (!hasComp) {
      actions.push(buildTravelpayoutsCategoryAction('compensation'));
    }
    if (
      !actions.some(
        (a) =>
          a.type === 'OPEN_URL' && /compensair\.com/i.test(a.payload.url ?? ''),
      )
    ) {
      actions.push({
        type: 'OPEN_URL',
        label: '✈️ Entschädigung Compensair',
        payload: { url: buildCompensairCheckUrl() },
      });
    }
  }

  // Bike / Scooter mieten — genannte Portale (Mietrad) vor generischem BikesBooking
  for (const a of buildNamedBookingPortalActions({
    speech: response.speechText,
    webResearch: ctx?.webResearch,
    existing: actions,
  })) {
    actions.push(a);
  }

  const offerBike =
    /\b(motorrad\s*mieten|roller\s*mieten|scooter\s*mieten|fahrrad\s*mieten|bikesbooking|vespa\s*mieten|fahrradverleih|radverleih|e-?bike\s*mieten)\b/iu.test(
      response.speechText,
    );
  const hasNamedBikePortal = actions.some(
    (a) =>
      a.type === 'OPEN_URL' && /mietrad\.de/i.test(a.payload.url ?? ''),
  );
  if (offerBike && !hasNamedBikePortal) {
    const hasBike = actions.some(
      (a) =>
        a.type === 'OPEN_URL' && /bikesbooking/i.test(a.payload.url ?? ''),
    );
    if (!hasBike) {
      const start = parseTravelDateYmd(response.speechText);
      actions.push(
        buildTravelpayoutsCategoryAction('bike', {
          dateIso: start,
          endDateIso: start ? addDaysYmd(start, 3) : null,
        }),
      );
    }
  }

  // QEEQ Pocket-WiFi / Powerbank-Miete am Standort
  const offerQeeq =
    /\b(qeeq|pocket[-\s]?wifi|wlan\s*mieten|powerbank\s*mieten)\b/iu.test(
      response.speechText,
    );
  if (offerQeeq) {
    const gps = readGpsLatLng();
    const hasQeeq = actions.some(
      (a) => a.type === 'OPEN_URL' && /qeeq\.com/i.test(a.payload.url ?? ''),
    );
    if (!hasQeeq && gps.lat != null && gps.lng != null) {
      actions.push(
        buildTravelpayoutsCategoryAction('wifi_power', {
          lat: gps.lat,
          lng: gps.lng,
        }),
      );
    }
  }

  // City Pass
  const offerCityPass =
    /\b(city\s*pass|stadtkarte|sightseeing\s*pass|go\s*city)\b/iu.test(
      response.speechText,
    );
  if (offerCityPass) {
    const hasPass = actions.some(
      (a) => a.type === 'OPEN_URL' && /gocity/i.test(a.payload.url ?? ''),
    );
    if (!hasPass) {
      const cityName = getCachedUserProfile()?.cityName?.trim() || '';
      actions.push(
        buildTravelpayoutsCategoryAction('city_pass', {
          cityOrQuery: cityName,
          adults: 2,
        }),
      );
    }
  }

  for (let i = 0; i < actions.length; i++) {
    const a = actions[i];
    if (a.type !== 'OPEN_URL') continue;
    const u = a.payload.url ?? '';
    if (
      /klook\.com|kkday\.com|wegotrip\.com|gocity\.com|welcomepickups|gettransfer|kiwitaxi|intui\.travel|localrent|getrentacar|autoeurope|bikesbooking|radicalstorage|airhelp|compensair|qeeq|saily\.com|yesim\.tech/i.test(
        u,
      ) &&
      !/affiliate\.klook|invl\.me|prf\.hn|go\.saily\.site/i.test(u)
    ) {
      actions[i] = {
        ...a,
        payload: { ...a.payload, url: normalizeAffiliateUrl(u) },
      };
    }
  }

  // Reiseversicherung — TravelSecure (AWIN)
  const offerInsurance =
    /\b(reiseversicherung|travel\s*insurance|auslandsversicherung|travelsecure)\b/iu.test(
      response.speechText,
    );
  if (offerInsurance) {
    const hasIns = actions.some(
      (a) =>
        a.type === 'OPEN_URL' &&
        /travelsecure|awin1\.com.*106517|ektatraveling/i.test(
          a.payload.url ?? '',
        ),
    );
    if (!hasIns) {
      actions.push(buildTravelInsuranceAction());
    }
  }

  // Camping — camping.info (AWIN mid=44063)
  const offerCamping = /\b(camping|campingplatz|camper|wohnwagen|wohnmobil|glamping|stellplatz|zeltplatz)\b/iu.test(
    response.speechText,
  );
  if (offerCamping) {
    const hasCamp = actions.some(
      (a) =>
        a.type === 'OPEN_URL' &&
        /camping\.info|awin1\.com.*44063/i.test(a.payload.url ?? ''),
    );
    if (!hasCamp) {
      const city = getCachedUserProfile()?.cityName?.trim() || null;
      const campsite = extractCampingplatzName(response.speechText);
      const arrival = parseTravelDateYmd(response.speechText);
      const departure = arrival ? addDaysYmd(arrival, 2) : null;
      actions.push(
        buildCampingInfoAction({
          cityOrQuery: campsite ? null : city,
          campsiteName: campsite,
          arrival,
          departure,
          adults: 2,
        }),
      );
    }
  }

  const offerKonfetti =
    /\b(gokonfetti|go[\s-]?konfetti|\bkonfetti\b|\bconfetti\b|workshop|kochkurs|weinprobe)\b/iu.test(
      response.speechText,
    );
  if (offerKonfetti) {
    const hasK = actions.some(
      (a) =>
        a.type === 'OPEN_URL' &&
        /gokonfetti\.com|awin1\.com.*31804/i.test(a.payload.url ?? ''),
    );
    if (!hasK) {
      const city = getCachedUserProfile()?.cityName?.trim() || null;
      actions.push(buildKonfettiAction({ cityOrQuery: city }));
    }
  }

  // Reservix — Live-Events DE (Konzert, Theater, Festival, Sport)
  const offerReservix =
    !ctx?.eventResearch?.events?.length &&
    RESERVIX_LIVE_EVENT_RE.test(response.speechText) &&
    !/\b(workshop|kochkurs|weinprobe|gokonfetti|konfetti|confetti)\b/iu.test(
      response.speechText,
    );
  if (offerReservix) {
    const hasReservix = actions.some(
      (a) =>
        a.type === 'OPEN_URL' &&
        /reservix\.(de|at|ch)|awin1\.com.*31293/i.test(a.payload.url ?? ''),
    );
    if (!hasReservix) {
      const city = getCachedUserProfile()?.cityName?.trim() || null;
      actions.push(buildReservixAction({ cityOrQuery: city }));
    }
  }

  // Solmar — Spanien Bus-/Pauschalreisen (AWIN mid=114510)
  const offerSolmar =
    /\b(solmar|busreise\s+spanien|spanien\s+bus|bus\s+nach\s+spanien|costa\s+blanca|costa\s+brava|costa\s+dorada|costa\s+del\s+azahar|pauschalreise\s+spanien|spanien\s+pauschal|spanienurlaub|urlaub\s+spanien\s+bus)\b/iu.test(
      response.speechText,
    );
  if (offerSolmar) {
    const hasSolmar = actions.some(
      (a) =>
        a.type === 'OPEN_URL' &&
        /solmar\.de|awin1\.com.*114510/i.test(a.payload.url ?? ''),
    );
    if (!hasSolmar) {
      actions.push(buildSolmarAction());
    }
  }

  // Pauschal / Last Minute / Kurztrips — CHECK24 (9364) primär
  const offerPackageHoliday =
    /\b(check[\s-]?24|ab[\s-]?in[\s-]?den[\s-]?urlaub|invia|weg\.de|pauschalreise|last\s*minute|lastminute|all[\s-]?inclusive|pauschal\s+buchen|urlaub\s+pauschal)\b/iu.test(
      response.speechText,
    );
  if (offerPackageHoliday) {
    const hasPackagePartner = actions.some(
      (a) =>
        a.type === 'OPEN_URL' &&
        /check24\.(de|net)|awin1\.com.*9364|ab-in-den-urlaub\.(de|at|ch)|awin1\.com.*9369|\bweg\.de\b|awin1\.com.*12224/i.test(
          a.payload.url ?? '',
        ),
    );
    if (!hasPackagePartner) {
      const city = getCachedUserProfile()?.cityName?.trim() || null;
      const pkgDate = parseTravelDateYmd(response.speechText);
      actions.push(
        buildPackageHolidayAction({
          cityOrQuery: city,
          speechOrBlob: response.speechText,
          departureDate: pkgDate,
          airport: parseOriginIata(response.speechText),
          adults: 2,
        }),
      );
    }
  }

  const offerStay22 =
    !ctx?.namedDestination &&
    ctx?.kind !== 'food' &&
    ctx?.kind !== 'reservation' &&
    !actions.some((a) => a.type === 'DIAL_PHONE') &&
    (ctx?.wantsStay22 === true ||
      actions.some((a) => a.type === 'BOOK_STAY22') ||
      (/\b(hotel|ferienwohnung|apartment|unterkunft|übernacht|uebernacht|stay22)\b/iu.test(
        response.speechText,
      ) &&
        !/\b(führ|fuehr|bring|navigier|route\s+zu|burger|restaurant|essen|frühstück|fruehstueck|reservier|anrufen|telefon)\b/iu.test(
          response.speechText,
        )));

  if (offerStay22) {
    const existing = actions.find((a) => a.type === 'BOOK_STAY22');
    const dest =
      ctx?.stay22Destination?.trim() ||
      existing?.payload.destination?.trim() ||
      getCachedUserProfile()?.cityName?.trim() ||
      'Germany';
    // Never use a single hotel proper name as Stay22 address
    const safeDest =
      /\bhotel\b/i.test(dest) && !/\b(in|umgebung|nähe|naehe)\b/i.test(dest)
        ? getCachedUserProfile()?.cityName?.trim() || dest
        : dest;
    const stayAction = buildStay22AccommodationAction(safeDest);
    stayAction.label = '🏨 Mehr Unterkünfte';
    const stayIdx = actions.findIndex((a) => a.type === 'BOOK_STAY22');
    // Primär Expedia (Partnerize) — höhere Hotel-Marge als Stay22
    const expediaAction = buildExpediaAccommodationAction(safeDest);
    const hasExpedia = actions.some(
      (a) =>
        a.type === 'OPEN_URL' &&
        /expedia\.(com|de)\b/i.test(a.payload.url ?? ''),
    );
    if (!hasExpedia) {
      actions.unshift(expediaAction);
    }
    if (stayIdx >= 0) {
      actions[stayIdx] = {
        ...actions[stayIdx],
        label: '🏨 Mehr Unterkünfte',
        payload: {
          ...actions[stayIdx].payload,
          ...stayAction.payload,
          destination: safeDest,
        },
      };
    }
    // Stay22 nur behalten wenn LLM ihn schon gesetzt hat — sonst Expedia reicht
  } else {
    actions = actions.filter((a) => a.type !== 'BOOK_STAY22');
  }

  // Konkrete Hotel-Stichpunkte nur wenn die KI gar keine geliefert hat
  let bullets = [...response.visualBullets];
  if (
    ctx?.accommodationHints &&
    ctx.accommodationHints.length > 0 &&
    bullets.length === 0
  ) {
    bullets = ctx.accommodationHints.slice(0, 3).map((h) => {
      const dist =
        h.distanceM != null
          ? h.distanceM < 1000
            ? `${h.distanceM} m`
            : `${(h.distanceM / 1000).toFixed(1)} km`
          : null;
      const whyShort = h.why.split(':')[0]?.trim() || 'Unterkunft';
      return dist
        ? `${h.name} — ${dist} — ${whyShort}`
        : `${h.name} — ${whyShort}`;
    });
  }

  // Tour-Partner nur bei klarem Ticket-/Tour-Intent — nicht bei reiner Geschichts-Rede
  const speechWantsTickets =
    /\b(ticket|tickets|eintritt|buchen|tour(?:en)?|getyourguide|musement|viator|klook|tiqets|kkday|wegotrip)\b/iu.test(
      response.speechText,
    );
  const hasExistingTourLink = actions.some(
    (a) =>
      a.type === 'OPEN_GYG_WIDGET' ||
      (a.type === 'OPEN_URL' &&
        TOUR_PARTNER_URL_RE.test(
          a.payload.url ?? a.payload.gygTourSlug ?? '',
        )),
  );
  const offerTours =
    ctx?.wantsTours === true || hasExistingTourLink || speechWantsTickets;

  const city =
    ctx?.tourDestination?.trim() ||
    ctx?.stay22Destination?.trim() ||
    getCachedUserProfile()?.cityName?.trim() ||
    '';

  if (offerTours) {
    for (let i = 0; i < actions.length; i++) {
      const a = actions[i];
      if (a.type === 'OPEN_URL' && a.payload.url) {
        const url = a.payload.url;
        if (/getyourguide\.com/i.test(url)) {
          const path = url.replace(/^https?:\/\/(www\.)?getyourguide\.com\/?/i, '');
          if (looksLikeFakeTourSlug(path)) {
            actions[i] = {
              ...a,
              payload: {
                ...a.payload,
                url: buildGetYourGuideSearchUrl(city || path),
              },
            };
          } else {
            actions[i] = {
              ...a,
              payload: { ...a.payload, url: normalizeAffiliateUrl(url) },
            };
          }
        } else if (/musement|viator|tripadvisor|klook|kkday|wegotrip|gocity/i.test(url)) {
          let next = url;
          if (/wegotrip\.com/i.test(url)) {
            next = withWegotripPrefill(url, {
              dateIso: parseTravelDateYmd(response.speechText),
              adults: 2,
            });
          }
          actions[i] = {
            ...a,
            payload: { ...a.payload, url: normalizeAffiliateUrl(next) },
          };
        }
      }
      if (
        a.type === 'OPEN_GYG_WIDGET' &&
        a.payload.gygTourSlug &&
        looksLikeFakeTourSlug(a.payload.gygTourSlug)
      ) {
        actions[i] = {
          type: 'OPEN_URL',
          label: a.label || '🎟️ Touren suchen',
          payload: {
            url: buildGetYourGuideSearchUrl(
              city || a.payload.gygTourSlug.replace(/[-_/]+/g, ' '),
            ),
          },
        };
      }
    }

    const hasTourLink = actions.some(
      (a) =>
        a.type === 'OPEN_GYG_WIDGET' ||
        (a.type === 'OPEN_URL' &&
          TOUR_PARTNER_URL_RE.test(a.payload.url ?? '')),
    );
    // Keine leeren AWIN/Tiqets-/Musement-Such-Buttons ohne echten Buchungspfad
    if (!hasTourLink && (ctx?.wantsTours === true || speechWantsTickets)) {
      const tourAction = buildTourBookingAction({
        kind:
          ctx?.tourKind === 'museum'
            ? 'museum'
            : ctx?.tourKind === 'vip'
              ? 'vip'
              : 'tour',
        city: city || undefined,
        query: city || undefined,
      });
      const tourUrl = tourAction.payload.url ?? '';
      try {
        const {
          mayShowAsPartnerBookAction,
        } = require('../affiliate/hollowPartnerUrl') as {
          mayShowAsPartnerBookAction: (o: {
            label: string;
            url?: string | null;
          }) => boolean;
        };
        if (
          mayShowAsPartnerBookAction({
            label: tourAction.label,
            url: tourUrl,
          }) &&
          !/suchen/i.test(tourAction.label)
        ) {
          actions.push(tourAction);
        }
      } catch {
        /* soft — lieber kein Fake-Ticket-Button */
      }
    }
  }

  const primaryIntent: QuickActionType[] = [];
  if (offerStay22) primaryIntent.push('BOOK_STAY22');
  if (offerBounce) primaryIntent.push('BOOK_BOUNCE_LUGGAGE');
  if (offerCar) primaryIntent.push('BOOK_CAR_RENTAL');
  if (offerEsim) primaryIntent.push('BOOK_ESIM');
  if (
    offerTours ||
    offerTransfer ||
    offerFlights ||
    offerCompensation ||
    offerBike ||
    offerCityPass ||
    offerInsurance ||
    offerCamping ||
    offerSolmar ||
    offerWegDe
  ) {
    primaryIntent.push('OPEN_URL', 'OPEN_GYG_WIDGET');
  }

  // Allgemeine „was geht“-Tipps: nur Nav-Chips — Partner/Playlist nicht mitfluten.
  // Event-Recherche: OPEN_URL (PDF/Flyer/Tickets) behalten.
  if (
    ctx?.kind === 'general' &&
    !offerCar &&
    !offerBounce &&
    !offerStay22 &&
    !offerTours &&
    !offerEsim &&
    !offerTransfer &&
    !offerFlights &&
    !offerCompensation &&
    !offerBike &&
    !offerCityPass &&
    !offerInsurance &&
    !offerCamping &&
    !offerSolmar &&
    !offerWegDe
  ) {
    const keepEventUrls = Boolean(ctx.eventResearch?.events?.length);
    actions = actions.filter(
      (a) =>
        a.type === 'START_NAVIGATION' ||
        a.type === 'SHOW_MORE' ||
        a.type === 'DIAL_PHONE' ||
        (keepEventUrls &&
          a.type === 'OPEN_URL' &&
          Boolean(a.payload.url?.trim())),
    );
  }

  const cap = actionCap(ctx);
  const ranked = prioritizeQuickActions(actions, {
    primaryIntentTypes: primaryIntent,
    maxActions: cap,
    maxNavActions: navCap(ctx),
  });

  // Gemini-IDs prüfen / unbekannte Orte geocoden → pendingNavOffer setzen
  const normalized = await normalizeNavActionsAndOffer({
    actions: ranked,
    fallbackOffer:
      ctx?.primaryOffer ?? useFinnusStore.getState().pendingNavOffer,
  });
  actions = normalized.actions as typeof actions;

  if (
    !ctx?.primaryOffer &&
    !offerCar &&
    !offerBounce &&
    !offerStay22 &&
    !offerTours &&
    !actions.some((a) => a.type === 'START_NAVIGATION')
  ) {
    const withMap = await attachCityMapAction(response, response.quickActions);
    const base = {
      ...response,
      quickActions: withMap,
    };
    const enriched =
      ctx?.kind === 'general' || !wantsMusicExplicitly(response.speechText)
        ? base
        : enrichPlaylistOffers(base);
    return {
      ...enriched,
      speechText:
        enriched.speechText.trim() ||
        ctx?.fallbackSpeech?.trim() ||
        response.speechText,
      quickActions: prioritizeQuickActions(enriched.quickActions, {
        maxActions: cap,
        maxNavActions: navCap(ctx),
      }),
    };
  }

  const withMap = await attachCityMapAction(
    response,
    actions.slice(0, cap),
  );
  const base = {
    ...response,
    visualBullets: clampVisualBullets(
      bullets.length > 0
        ? bullets
        : ctx?.fallbackBullets?.length
          ? ctx.fallbackBullets
          : bullets,
    ),
    quickActions: withMap,
    cardTitle:
      response.cardTitle ||
      (() => {
        try {
          const { deriveSpickzettelTitle } = require('./spickzettelTitle') as {
            deriveSpickzettelTitle: (o: {
              userText?: string | null;
              speech?: string | null;
              bullets?: string[] | null;
            }) => string;
          };
          return deriveSpickzettelTitle({
            speech: response.speechText,
            bullets: bullets.length ? bullets : response.visualBullets,
          });
        } catch {
          return ctx ? titleForKind(ctx.kind) : 'Spickzettel';
        }
      })(),
  };
  const enriched =
    ctx?.kind === 'general' || !wantsMusicExplicitly(response.speechText)
      ? base
      : enrichPlaylistOffers(base);

  let speechText = enriched.speechText.trim();
  if (!speechText && ctx?.fallbackSpeech?.trim()) {
    speechText = ctx.fallbackSpeech.trim();
  }

  return {
    ...enriched,
    speechText,
    visualBullets: clampVisualBullets(
      enriched.visualBullets.length > 0
        ? enriched.visualBullets
        : ctx?.fallbackBullets ?? [],
    ),
    quickActions: prioritizeQuickActions(enriched.quickActions, {
      primaryIntentTypes: primaryIntent,
      maxActions: cap,
      maxNavActions: navCap(ctx),
    }),
  };
}

function titleForKind(kind: ConciergeContext['kind']): string {
  switch (kind) {
    case 'food':
    case 'reservation':
      return 'Empfehlungen in deiner Nähe';
    case 'weather':
      return 'Wetter & Plan B';
    case 'infra':
      return 'In der Nähe';
    case 'flight':
      return 'Flug & Anreise';
    case 'travel':
      return 'Reise & Mietwagen';
    case 'luggage':
      return 'Gepäck & Bounce';
    case 'accommodation':
      return 'Unterkunft & Stay22';
    case 'tours':
      return 'Touren & Tickets';
    case 'general':
      return 'Heute vor Ort';
    default:
      return 'Spickzettel';
  }
}

export function transitAdviceToConcierge(
  advice: TransitAdvice,
  speechText: string,
  offerNavigation = true,
): GeminiConciergeResponse {
  const first =
    advice.departures.find((d) => !d.cancelled) ?? advice.departures[0];
  const second =
    advice.departures.find((d) => d !== first && !d.cancelled) ??
    advice.departures[1];
  const bullets: string[] = [];

  if (first) {
    const h = first.when.getHours().toString().padStart(2, '0');
    const m = first.when.getMinutes().toString().padStart(2, '0');
    const status = formatDelayStatus(first);
    bullets.push(
      `${first.line} ${h}:${m} · ${status} → ${first.direction}`,
    );
  }

  if (advice.arrivalWhen && advice.arrivalLabel) {
    const ah = advice.arrivalWhen.getHours().toString().padStart(2, '0');
    const am = advice.arrivalWhen.getMinutes().toString().padStart(2, '0');
    bullets.push(`Ankunft ${advice.arrivalLabel} ${ah}:${am}`);
  } else if (first) {
    bullets.push(`Haltestelle ${advice.stationName}`);
  }

  if (advice.walkMinutes >= 1 && bullets.length < 3) {
    const mode =
      advice.accessMode === 'bike' ? 'Rad' : 'Gehen';
    bullets.push(`${mode} ~${advice.walkMinutes} Min → Bahnhof`);
  }

  // Zweite Abfahrt nur, wenn sie wirklich eine Alternative ist
  if (
    second &&
    first &&
    second.when.getTime() !== first.when.getTime() &&
    bullets.length < 3
  ) {
    const h = second.when.getHours().toString().padStart(2, '0');
    const m = second.when.getMinutes().toString().padStart(2, '0');
    bullets.push(
      `Danach: ${second.line} ${h}:${m} · ${formatDelayStatus(second)}`,
    );
  }

  if (advice.source === 'takt' && bullets.length < 3) {
    bullets.push('Live-Verspätung gerade nicht verfügbar');
  }

  const actions: QuickAction[] = offerNavigation
    ? [
        {
          type: 'START_NAVIGATION',
          label: advice.hasJourneyNav
            ? '🚌 ÖPNV starten'
            : '🚌 Zum Bahnhof',
          payload: {
            targetPoiId: advice.stationPoi.id,
            destName: advice.arrivalLabel ?? advice.stationName,
            destLat: advice.hasJourneyNav
              ? undefined
              : advice.stationPoi.lat,
            destLng: advice.hasJourneyNav
              ? undefined
              : advice.stationPoi.lng,
            skipClosingGate: Boolean(advice.hasJourneyNav),
            keepCard: true,
          },
        },
      ]
    : [];

  return {
    speechText,
    cardTitle: 'Nächste Bahn',
    visualBullets: clampVisualBullets(bullets),
    quickActions: actions,
  };
}

/**
 * Zero Dead-Ends: nur wenn ein echter nächster Klick existiert.
 * Kein Placebo-Chip, wenn Speech zugibt dass keine Daten da sind.
 */
function ensureZeroDeadEndActions(
  response: GeminiConciergeResponse,
  skipNav: boolean,
): GeminiConciergeResponse {
  if (response.quickActions.length > 0) return response;

  if (speechAdmitsNoActionableData(response.speechText)) {
    return response;
  }

  const speech = response.speechText;
  const asksReserve =
    /\b(soll\s+ich|darf\s+ich)\b/iu.test(speech) &&
    /\b(reservier|buch|vorbereiten|tisch)\b/iu.test(speech);
  const mentionsReserve =
    /\b(reservier|tisch\s+anfrag|buchung\s+vorbereiten)\b/iu.test(speech);
  const offer = useFinnusStore.getState().pendingNavOffer;

  if ((asksReserve || mentionsReserve) && offer?.poiId) {
    return {
      ...response,
      speechText: speech
        .replace(
          /[^.?!]*\bsoll\s+ich\b[^.?!]*(vorbereiten|reservier|buch|tisch)[^.?!]*[.?!]?\s*/giu,
          '',
        )
        .trim() ||
        `Tisch bei ${offer.name} liegt bereit — tipp Reservieren oder wähl eine Alternative.`,
      quickActions: [
        {
          type: 'SHOW_MORE',
          label: '🍽 Tisch reservieren',
          payload: {
            textPrompt: `Reserviere einen Tisch bei ${offer.name}`,
            targetPoiId: offer.poiId,
            destName: offer.name,
          },
        },
        {
          type: 'SHOW_MORE',
          label: 'Andere Uhrzeit',
          payload: {
            textPrompt: `Andere Uhrzeit für Tisch bei ${offer.name}`,
          },
        },
        {
          type: 'SHOW_MORE',
          label: 'Neuer Termin',
          payload: {
            textPrompt: `Neuer Termin bei ${offer.name} eintragen`,
          },
        },
        {
          type: 'SHOW_MORE',
          label: 'Später',
          payload: { textPrompt: 'Reservierung später' },
        },
      ],
    };
  }

  if (!skipNav && offer) {
    try {
      const { isAlreadyAtCoords } = require('../../module2/pitch/navActionPolicy') as {
        isAlreadyAtCoords: (lat?: number | null, lng?: number | null) => boolean;
      };
      if (isAlreadyAtCoords(offer.lat, offer.lng)) {
        return response;
      }
    } catch {
      /* soft */
    }
    return {
      ...response,
      quickActions: [
        {
          type: 'START_NAVIGATION',
          label: `📍 Route zu ${offer.name}`,
          payload: {
            targetPoiId: offer.poiId,
            destName: offer.name,
            destLat: offer.lat,
            destLng: offer.lng,
          },
        },
      ],
    };
  }

  // Info-only / Mitdenken ohne Tool → kein erzwungener „Weiterhelfen“-Chip
  return response;
}

/**
 * Kompass zuerst (wenn zugesagt) → Stimme parallel → Card wenn Audio läuft.
 */
export async function presentConciergeResponse(
  response: GeminiConciergeResponse,
  opts?: {
    skipAutoNav?: boolean;
    userText?: string;
    /** Guardrails / Judge bereits angewendet */
    alreadyGuarded?: boolean;
  },
): Promise<void> {
  const store = useFinnusStore.getState();

  // Pipeline-Ende: sync Code-Judge + Guardrails (überspringbar wenn questions schon gelaufen)
  if (!opts?.alreadyGuarded) {
    const judged = applyActionButtonJudge(response, {
      userText: opts?.userText ?? response.speechText,
    });
    response = judged.response;
    if (__DEV__ && judged.changed) {
      console.log(
        '[present] action-button-judge (sync-only)',
        judged.notes
          .filter((n) => n.action !== 'kept')
          .map((n) => `${n.action}:${n.reason}`)
          .join(' | '),
      );
    }

    const guarded = applyHardGuardrails(response, { userText: opts?.userText });
    response = guarded.response;
  }

  // Bridge darf ausreden — nicht hart killen (sonst fällt Yorro sich ins Wort).
  try {
    const { hadRecentLatencyAck } = require('../speech/floskelEngine') as {
      hadRecentLatencyAck: (ms?: number) => boolean;
    };
    const { stopSpeaking } = await import('../ttsService');
    const {
      isAudiblyPlaying,
      getActiveTtsSessionCount,
    } = await import('../AudioVoiceService');
    if (hadRecentLatencyAck(12_000) || isAudiblyPlaying()) {
      const deadline = Date.now() + 8_000;
      while (
        Date.now() < deadline &&
        (isAudiblyPlaying() || getActiveTtsSessionCount() > 0)
      ) {
        await new Promise((r) => setTimeout(r, 80));
      }
    } else {
      await stopSpeaking();
    }
  } catch {
    /* ignore */
  }

  // Context Action Policy: keine proaktive Nav im Hotel nachts
  try {
    const { filterActionsForContext } = await import(
      '../ui/contextTriggerMatrix'
    );
    const explicitNav =
      (opts?.userText
        ? isExplicitNavIntent(opts.userText)
        : false) ||
      /\b(bring\s+mich|navigier|führ\s+mich|fuehr\s+mich|route)\b/iu.test(
        opts?.userText || response.speechText,
      );
    response = {
      ...response,
      quickActions: filterActionsForContext(response.quickActions, {
        explicitNav,
      }),
    };
  } catch {
    /* ignore */
  }

  // ActionBoard SSOT — Fastline + Pending; Deep startet nach Card-Mount
  const cardId = `ab_${Date.now()}`;
  let deepJobs: import('../actionBoard').DeepJob[] = [];
  try {
    const skipBoard =
      response.cardTitle === 'Günstige Flieger' ||
      response.cardTitle === 'Aufgabegepäck?' ||
      response.cardTitle === 'Wann fliegst du?' ||
      response.cardTitle === 'Welche Uhrzeit?';
    if (!skipBoard) {
      const { applyActionBoardToResponse } = await import('../actionBoard');
      // Transit-Karte: nur Station mit Coords — keine Speech-Mining-Fake-Maps
      let boardEntities: import('../actionBoard').ActionEntity[] | undefined;
      if (response.cardTitle === 'Nächste Bahn') {
        const nav = response.quickActions?.find(
          (a) =>
            a.type === 'START_NAVIGATION' &&
            typeof a.payload.destLat === 'number' &&
            typeof a.payload.destLng === 'number',
        );
        if (nav) {
          boardEntities = [
            {
              name: String(nav.payload.destName || 'Bahnhof'),
              rank: 1,
              lat: nav.payload.destLat as number,
              lng: nav.payload.destLng as number,
              poiId: nav.payload.targetPoiId ?? null,
              category: 'other',
            },
          ];
        } else {
          boardEntities = [];
        }
      }
      const boarded = applyActionBoardToResponse(response, {
        userText: opts?.userText,
        cardId,
        startDeep: false,
        entities: boardEntities,
      });
      response = boarded.response;
      deepJobs = boarded.deepJobs;
    }
  } catch (err) {
    if (__DEV__) console.warn('[present] actionBoard failed:', err);
  }

  // Live Deep-Link: toten 404-Button durch aktuellsten lebenden Link ersetzen
  try {
    const { resolveLiveOpenUrlActions } = await import('../research/liveDeepLink');
    const live = await resolveLiveOpenUrlActions(response.quickActions, {
      userText: opts?.userText,
      timeoutMs: 1200,
    });
    response = { ...response, quickActions: live.actions };
  } catch (err) {
    if (__DEV__) console.warn('[present] liveDeepLink', err);
  }

  // Zero-Fake: Turnierplan-Chips ohne URL etc. weg
  const cleanedActions = stripUnbackedActions(response.quickActions);
  response = {
    ...response,
    speechText: stripOrphanButtonClaims(
      stripFakeReservationClaims(
        response.speechText,
        cleanedActions,
        // Nav-Claims erst nach Auto-Start-Versuch strippen
        { navActuallyStarted: true },
      ),
      cleanedActions,
    ),
    quickActions: cleanedActions,
  };

  // Native Background-Tasks (Wecker) VOR der Stimme — Speech an echtes Ergebnis koppeln
  try {
    const { applyBackgroundTasks } = await import('./backgroundTasks');
    const bg = await applyBackgroundTasks(response, {
      userText: opts?.userText,
    });
    response = bg.response;
    if (__DEV__ && bg.changed) {
      console.log(
        '[present] background-tasks',
        bg.alarmResults.map((r) => `${r.ok}:${r.tier ?? r.reason}`).join(' | '),
      );
    }
  } catch (err) {
    console.warn('[present] background-tasks failed:', err);
  }

  // Erinnerung: Fake-Claim „ich erinnere dich“ → echt stellen oder ehrlich strippen
  try {
    const {
      speechClaimsReminderSet,
      buildRemindOnlyQuickAction,
      speechOffersRemind,
    } = await import('./reminderActionPolicy');
    const claimed =
      speechClaimsReminderSet(response.speechText) ||
      speechOffersRemind(response.speechText);
    const hasRemindBtn = response.quickActions.some(
      (a) =>
        a.type === 'SET_DEPARTURE_REMINDER' ||
        a.type === 'SET_WAKE_ALARM' ||
        a.type === 'SET_TIMER',
    );
    if (claimed && !hasRemindBtn) {
      const btn = buildRemindOnlyQuickAction({
        speech: response.speechText,
        userText: opts?.userText,
        requireOfferOrAsk: false,
      });
      if (btn && speechClaimsReminderSet(response.speechText)) {
        // Behaupteter Erfolg → sofort ausführen
        const { handleQuickAction } = await import('../actionHandlerService');
        const r = await handleQuickAction(btn);
        response = {
          ...response,
          speechText:
            r.message ||
            (r.ok !== false
              ? response.speechText
              : 'Erinnerung ist noch nicht gestellt.'),
          visualBullets: (
            r.ok !== false
              ? [
                  btn.payload.timeLabel
                    ? `⏰ ${btn.payload.timeLabel}`
                    : 'Erinnerung aktiv',
                  ...(response.visualBullets ?? []),
                ]
              : ['Erinnerung fehlgeschlagen', ...(response.visualBullets ?? [])]
          ).slice(0, 3),
          quickActions:
            r.ok === false
              ? [btn, ...response.quickActions].slice(0, 4)
              : response.quickActions,
        };
      } else if (btn) {
        // Soft-Offer → Button erzwingen
        response = {
          ...response,
          quickActions: [btn, ...response.quickActions].slice(0, 4),
        };
      } else if (speechClaimsReminderSet(response.speechText)) {
        response = {
          ...response,
          speechText: response.speechText
            .replace(
              /[^.!?]*(?:ich\s+erinnere\s+dich|erinnerung\s+(?:ist\s+)?(?:gestellt|gesetzt)|sag(?:e|)\s+(?:ich\s+)?(?:dir|euch)\s+bescheid)[^.!?]*[.!?]?/giu,
              ' ',
            )
            .replace(/\s+/g, ' ')
            .trim() ||
            'Sag mir Uhrzeit oder Ort — dann stelle ich die Erinnerung echt.',
          visualBullets: ['Erinnerung noch nicht gestellt'],
          quickActions: [
            {
              type: 'SHOW_MORE' as const,
              label: 'In 30 Min',
              payload: { textPrompt: 'Erinner mich in 30 Minuten' },
            },
            ...response.quickActions,
          ].slice(0, 4),
        };
      }
    }
  } catch (err) {
    console.warn('[present] reminder honesty failed:', err);
  }

  // Zero Dead-Ends: nur echte nächste Klicks
  response = ensureZeroDeadEndActions(response, opts?.skipAutoNav === true);

  try {
    const title = response.cardTitle || '';
    if (
      title === 'Aufgabegepäck?' ||
      title === 'Wann fliegst du?' ||
      title === 'Welche Uhrzeit?'
    ) {
      const chips = (response.quickActions ?? [])
        .filter((a) => a.type === 'SHOW_MORE')
        .slice(0, 5)
        .map((a, i) => ({
          id: `flight_chip_${i}_${a.label}`,
          label: a.label,
          action: 'prompt' as const,
          prompt: String(a.payload?.textPrompt || a.label),
        }));
      if (chips.length) {
        const { usePlanCalendarUiStore } = require('../../module2/timeline/planCalendarUiStore') as {
          usePlanCalendarUiStore: {
            getState: () => { setShortAnswers: (a: typeof chips) => void };
          };
        };
        usePlanCalendarUiStore.getState().setShortAnswers(chips);
      }
    }
  } catch {
    /* soft */
  }

  // 1) Navigation SOFORT — Kompass sichtbar, User kann losgehen
  //    Stimme startet danach und läuft parallel weiter (kein Warten auf TTS-Ende).
  const navCommit = await autoStartNavigationIfCommitted(response, opts);
  if (navCommit.started) {
    useFinnusStore.getState().patchNavigation({
      navActive: true,
      navVisible: true,
    });
  } else if (navCommit.confirmSpeech) {
    const card = useFinnusStore.getState().activeConciergeCard;
    if (card?.id.startsWith('nav-retarget')) {
      response = {
        ...response,
        speechText: navCommit.confirmSpeech,
        visualBullets: card.visualBullets,
        quickActions: card.quickActions,
        cardTitle: card.cardTitle,
      };
    } else {
      response = {
        ...response,
        speechText: navCommit.confirmSpeech,
      };
    }
  } else if (speechCommitsToNavigation(response.speechText)) {
    // Say–Do: nie „ich starte Navigation“ ohne echten Start
    response = {
      ...response,
      speechText: stripFakeReservationClaims(
        response.speechText,
        response.quickActions.filter((a) => a.type !== 'START_NAVIGATION'),
        { navActuallyStarted: false },
      ),
    };
  }

  if (speechCommitsToMap(response.speechText)) {
    await openCityMap();
  }

  const hasVisual =
    response.visualBullets.length > 0 ||
    response.quickActions.length > 0 ||
    speechAsksForConfirmation(response.speechText);
  const card = hasVisual
    ? toConciergeCardState(response, { id: cardId })
    : null;

  // Voice-Follow-up: letztes Partner-Angebot merken („Ja, buchen“)
  useFinnusStore
    .getState()
    .setPendingAffiliateOffer(pickPendingAffiliateOffer(response.quickActions));

  // Collective learning: Live-/Recherche-Orte + Cohort-Stil
  try {
    const {
      contributePlacesFromResearchResult,
      maybeContributeCohortStyle,
    } = await import('../memory/collectiveLearning');
    const { inferIntentFamily } = await import('../memory/correctionLearning');
    const { getCachedUserProfile } = await import('../userProfileService');
    const venues: Array<{
      name: string;
      lat?: number | null;
      lng?: number | null;
      placeType?: string;
      sourceTrust?: number;
    }> = [];
    for (const a of response.quickActions) {
      if (a.type !== 'START_NAVIGATION') continue;
      const poiId = a.payload?.targetPoiId;
      const numeric =
        typeof poiId === 'number'
          ? poiId
          : typeof poiId === 'string' && /^-?\d+$/.test(poiId)
            ? Number(poiId)
            : null;
      // Negativ / fehlend = nicht aus offiziellem Pack → Community-Overlay
      if (numeric != null && numeric >= 0) continue;
      const name =
        (a.payload?.destName || a.payload?.entityName || a.label || '')
          .replace(/^📍\s*/, '')
          .replace(/^Route:\s*/i, '')
          .trim();
      if (name.length < 3) continue;
      venues.push({
        name: name.slice(0, 80),
        lat: a.payload?.destLat ?? null,
        lng: a.payload?.destLng ?? null,
        placeType: 'place',
        sourceTrust: 0.5,
      });
    }
    if (venues.length) {
      const city =
        getCachedUserProfile()?.cityName ??
        store.currentLocationName ??
        null;
      contributePlacesFromResearchResult({
        query: opts?.userText || response.speechText.slice(0, 80),
        city,
        venues,
      });
    }
    maybeContributeCohortStyle({
      intentFamily: inferIntentFamily(
        opts?.userText || response.speechText,
      ),
      answerStyle: getCachedUserProfile()?.answerStyle,
    });
  } catch {
    /* soft */
  }

  const voiceSettings = await getVoiceSettingsForTour();

  let speech = response.speechText.trim();
  if (speech.length < 8) {
    const { generateUniversalFallbackReply } = await import(
      '../../runtime/approachVisualCue'
    );
    speech =
      (await generateUniversalFallbackReply({
        userQuestion: speech || store.chatHistory.slice(-1)[0]?.content || '',
        placeName: store.currentLocationName,
        intentKind: 'concierge',
      })) ??
      'Kurz nochmal: wobei kann ich dir gerade helfen?';
  }

  useFinnusStore.getState().setIsGenerating(false);

  // Thinking halten — aber Card erst bei hörbarem Audio (nicht vor Synth).
  useFinnusStore.getState().setIsPlayingAudio(true);

  const speakPromise = speakRuntimeText(speech, {
    voiceId: voiceSettings.voiceId,
    speechRate: voiceSettings.speechRate,
  });

  // 3) Spickzettel erst wenn wirklich gesprochen wird — sonst Stichpunkte 20–30 s vor Speech
  if (card) {
    recordFindusActionsTriggered(card.quickActions, Date.now());
    // Card parallel zur Speech: kurz auf Hörstart warten, dann immer zeigen.
    await waitUntilVoicePlaying(1_200);
    useFinnusStore.getState().setActiveConciergeCard(card);
    // Deep Recharge parallel zum Audio (Pending-Chips → echte Links)
    if (deepJobs.length > 0) {
      try {
        const { startActionBoardDeep } = await import('../actionBoard');
        startActionBoardDeep({ jobs: deepJobs, cardId: card.id });
      } catch {
        /* soft */
      }
    }
  } else {
    useFinnusStore.getState().setActiveConciergeCard(null);
  }

  try {
    await speakPromise;
  } catch (err: unknown) {
    console.warn('[concierge] TTS failed:', err);
  } finally {
    // Immer UI-Standby nach Concierge-Speech — sonst klebt „Ich erzähle“
    // Speech-Ende — kein UI-Clear nötig
    try {
      const {
        markAudiblePlayback,
        releaseSpeakingUiIfIdle,
        getActiveTtsSessionCount,
      } = await import('../AudioVoiceService');
      markAudiblePlayback(false);
      if (getActiveTtsSessionCount() === 0) {
        releaseSpeakingUiIfIdle();
      } else {
        useFinnusStore.getState().setIsAudiblySpeaking(false);
      }
    } catch {
      useFinnusStore.getState().setIsPlayingAudio(false);
      useFinnusStore.getState().setIsAudiblySpeaking(false);
    }
  }
}
