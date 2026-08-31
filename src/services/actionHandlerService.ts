/**
 * Native Quick-Actions: Navigation, tel:, URLs, Reservierung, Follow-up.
 */

import { Linking, Alert } from 'react-native';
import type { QuickAction } from '../types/concierge';
import type { ReservationTier } from '../types/reservation';
import { getAllPois, getFactsForPoi } from '../db/database';
import { commitHandsFreeNavStart } from './navigation/handsFreeNav';
import {
  speakAssistantText,
  getVoiceSettingsForTour,
} from './ttsService';
import { useFinnusStore } from '../store/useFinnusStore';
import { getCachedUserProfile } from './userProfileService';
import {
  buildPoiReservationInfo,
  executeReservation,
} from './reservation/reservationService';
import {
  buildGetYourGuideTourUrl,
  getBounceLuggageUrl,
  getCarRentalUrl,
  getMusementBookingUrl,
  getStay22AccommodationUrl,
  getViatorBookingUrl,
  normalizeAffiliateUrl,
  openBounceLuggage,
  openCarRental,
  openStay22Accommodation,
  openEsim,
  getEsimAffiliateUrl,
  openUberRide,
} from './affiliate/affiliateService';
import { confirmAffiliateRedirectIfNeeded } from './affiliate/affiliateDisclosure';
import { isPartnerAffiliateAction } from '../constants/legal';
import { isCityMapUrl, openCityMap } from './cityMapService';
import { keepFoundEventUrl } from './research/eventInfoUrl';
import {
  encodeUriBrackets,
  roundClockHmmDownTo5,
} from './affiliate/partnerDeepPrefill';
import { resolveExistingPoiId } from './navigation/resolveNavTarget';
import { useShoppingTaskStore } from '../store/useShoppingTaskStore';
import { useLogisticsTriggerStore } from '../store/useLogisticsTriggerStore';
import { setWakeAlarmWithBridge } from './alarms/nativeAlarmBridge';
import { armLinkBackgroundSpeech } from './speech/backgroundSpeechPolicy';

/** Externer Link: TTS darf im Hintergrund weiter — Arm + openURL. */
async function openExternalUrl(
  url: string,
  reason = 'OPEN_URL',
): Promise<void> {
  armLinkBackgroundSpeech({ reason });
  await Linking.openURL(url);
}
import { isKnownEmergencyShort } from './concierge/emergencyNumbersByCountry';
import { compactPlaceForAction } from './concierge/actionLabelShorten';
import {
  formatClockDe,
  getPendingWakeProposal,
  setPendingWakeProposal,
} from './alarms/wakeAlarmAdvisor';
import { presentAutoReservationFollowUp } from './concierge/autoReservationFollowUp';
import { runContextualDiscovery, presentDiscoveryAsConcierge } from './navigation/contextualDiscovery';
import { getDeviceHeadingDeg, getMovementBearingDeg } from './navigation/navigationService';

export type ActionHandlerResult = {
  ok: boolean;
  /** Optional: Follow-up-Frage an Voice-Pipeline */
  followUpPrompt?: string;
  message?: string;
  /** Concierge-Karte nach Tap behalten (z. B. Route-neu vs. Stopp). */
  keepCard?: boolean;
};

/** Legacy-Konstanten — Feedback: Link-Open ohne Audio-Ansage. */
export const OPEN_GOOGLE_MAPS_SPEECH: string | null = null;
export const OPEN_SPEISEKARTE_SPEECH: string | null = null;

function isGoogleMapsOpenUrl(url: string): boolean {
  return /google\.[^/]*\/maps|maps\.google|maps\.app\.goo\.gl|goo\.gl\/maps|^geo:/i.test(
    url,
  );
}

function looksLikeHotelBookAction(action: QuickAction): boolean {
  if (action.payload.affiliateMarked === true) return true;
  if (String(action.payload.actionBoardId ?? '').startsWith('hotel:')) {
    return true;
  }
  return /\b(buch|hotel|zimmer|stay22|expedia|unterkunft|ferienwohnung|airbnb|booking)\b/iu.test(
    `${action.label} ${action.payload.url ?? ''}`,
  );
}

/** Pending/leer → klickfertigen Hotel-Partner-Link aus Ziel bauen. */
function recoverHotelBookUrl(action: QuickAction): string | null {
  if (!looksLikeHotelBookAction(action)) {
    return null;
  }
  const dest =
    action.payload.destination?.trim() ||
    action.payload.destName?.trim() ||
    action.payload.entityName?.trim() ||
    getCachedUserProfile()?.cityName?.trim() ||
    '';
  if (!dest || /^pending$/i.test(dest)) return null;
  try {
    const {
      buildPitchHotelBookingUrl,
    } = require('../module2/pitch/pitchBookingUrl') as {
      buildPitchHotelBookingUrl: (
        hotelName: string,
        contextBlob: string,
        cityHint?: string | null,
      ) => string | null;
    };
    const city = getCachedUserProfile()?.cityName?.trim() || null;
    const built = buildPitchHotelBookingUrl(
      dest,
      [action.payload.checkin, action.payload.checkout, action.label]
        .filter(Boolean)
        .join(' '),
      city,
    );
    if (built) return built;
  } catch {
    /* soft */
  }
  try {
    const {
      getExpediaAccommodationUrl,
      getStay22AccommodationUrl,
      getExpediaCamref,
    } = require('./affiliate/affiliateService') as {
      getExpediaAccommodationUrl: (
        d: string,
        o?: { checkin?: string; checkout?: string; adults?: number },
      ) => string;
      getStay22AccommodationUrl: (
        d: string,
        o?: { checkin?: string; checkout?: string; adults?: number },
      ) => string;
      getExpediaCamref: () => string;
    };
    const opts = {
      checkin: action.payload.checkin,
      checkout: action.payload.checkout,
      adults: action.payload.adults,
    };
    return getExpediaCamref()
      ? getExpediaAccommodationUrl(dest, opts)
      : getStay22AccommodationUrl(dest, opts);
  } catch {
    return null;
  }
}

/** Ansage beim Maps-Öffnen: nur kurzer Ortsname (z. B. „TC Prisdorf“). */
export function speechForGoogleMapsOpen(opts?: {
  destName?: string | null;
  label?: string | null;
}): string | null {
  // Feedback: Link-Open stumm — keine Maps-Ansage mehr.
  void opts;
  return null;
}

function speechForOpenUrl(
  _url: string,
  _label: string,
  _destName?: string | null,
): string | null {
  // Feedback: Link öffnen → keine Audio-Ansage.
  return null;
}

/** Sofort sprechen + Chat — blockiert Öffnen nicht. */
function announceOpenUrlSpeech(text: string): void {
  try {
    useFinnusStore.getState().addChatMessage({
      role: 'assistant',
      content: text,
    });
  } catch {
    /* soft */
  }
  void (async () => {
    try {
      const voice = await getVoiceSettingsForTour();
      await speakAssistantText(text, {
        voiceId: voice.voiceId,
        speechRate: voice.speechRate,
      });
    } catch {
      try {
        const { enqueueSpeech } = await import('../module2/speech/speechQueue');
        enqueueSpeech({
          kind: 'bridging',
          text,
          turnId: `open_url_${Date.now()}`,
        });
      } catch {
        /* soft */
      }
    }
  })();
}

/** @deprecated Prefer resolveExistingPoiId — behält Fuzzy-Match, prüft DB. */
export async function resolvePoiId(
  target: string | number | undefined,
): Promise<number | null> {
  return resolveExistingPoiId(target);
}

async function reservationFromAction(
  action: QuickAction,
  tier: ReservationTier,
): Promise<ActionHandlerResult> {
  const poiId = await resolvePoiId(action.payload.targetPoiId);
  if (poiId == null) {
    return {
      ok: false,
      message: 'Welches Restaurant meinst du? Tippe nochmal oder sag den Namen.',
    };
  }
  const pois = await getAllPois();
  const poi = pois.find((p) => p.id === poiId);
  if (!poi) {
    return { ok: false, message: 'Restaurant nicht gefunden.' };
  }
  const facts = (await getFactsForPoi(poiId)).map((f) => f.fact_text);
  const info = buildPoiReservationInfo(poi, facts);
  if (action.payload.phoneNumber && !info.phoneNumber) {
    info.phoneNumber = action.payload.phoneNumber;
  }

  const partySize = Math.max(1, Math.min(20, Number(action.payload.partySize) || 2));
  const timeLabel = (action.payload.timeLabel || 'heute Abend').trim();
  const profile = getCachedUserProfile();

  const result = await executeReservation(
    tier,
    info,
    {
      partySize,
      timeLabel,
      dateIso: action.payload.dateIso,
    },
    profile,
  );

  return {
    ok: result.ok,
    message: result.message,
  };
}

async function nachreichenReservationButtons(
  name: string,
  websiteUrl: string | null,
  targetPoiId?: string | number,
): Promise<void> {
  try {
    const { runGastroMenuDeepResearch } = await import(
      '../module2/agents/gastroMenuDeepResearch'
    );
    const deep = await runGastroMenuDeepResearch({
      userText: `Tisch reservieren bei ${name}`,
      venues: [
        {
          name,
          websiteUrl: websiteUrl && /^https?:/i.test(websiteUrl) ? websiteUrl : null,
          menuUrl: null,
        },
      ],
      alreadySaid: '',
    });
    const bookBtn = deep.buttons?.find(
      (b) =>
        b.payload.kind === 'deep_link' &&
        b.payload.url &&
        /book|reserv|opentable|quandoo|resmio|tisch/i.test(
          `${b.label} ${b.payload.url}`,
        ),
    );
    const mailBtn = deep.buttons?.find(
      (b) =>
        b.payload.kind === 'deep_link' &&
        b.payload.url &&
        /^mailto:/i.test(b.payload.url),
    );
    const actions: QuickAction[] = [];
    if (bookBtn?.payload.kind === 'deep_link' && bookBtn.payload.url) {
      actions.push({
        type: 'OPEN_URL',
        label: '🌐 Tisch online',
        payload: { url: bookBtn.payload.url, destName: name },
      });
    }
    if (mailBtn?.payload.kind === 'deep_link' && mailBtn.payload.url) {
      actions.push({
        type: 'OPEN_URL',
        label: '✉️ Mail-Entwurf',
        payload: { url: mailBtn.payload.url, destName: name },
      });
    }
    if (!actions.length) {
      actions.push({
        type: 'OPEN_URL',
        label: '🔍 Reservieren',
        payload: {
          url: `https://www.google.com/search?q=${encodeURIComponent(`${name} Tisch reservieren`)}`,
          destName: name,
        },
      });
    }
    actions.push({
      type: 'SHOW_MORE',
      label: 'Andere Uhrzeit',
      payload: {
        textPrompt: `Andere Uhrzeit für Tisch bei ${name}`,
        destName: name,
      },
    });

    const { presentConciergeResponse } = await import(
      './concierge/presentConcierge'
    );
    const { wrapPlainAsConcierge } = await import(
      './concierge/parseConciergeResponse'
    );
    await presentConciergeResponse(
      wrapPlainAsConcierge(
        bookBtn
          ? `Online-Reservierung für ${name} liegt bereit — tipp den Button.`
          : `Reservierung für ${name}: Link ist offen; ich habe dir die besten Wege als Buttons nachgereicht.`,
        {
          cardTitle: `Reservierung · ${name}`,
          visualBullets: [name, 'Tisch anfragen'],
          quickActions: actions.slice(0, 4),
        },
      ),
    );

    const poiId = await resolvePoiId(targetPoiId);
    if (poiId != null && !bookBtn) {
      await presentAutoReservationFollowUp(poiId);
    }
  } catch (err) {
    if (__DEV__) console.warn('[reservation] deep follow-up', err);
  }
}

/**
 * Tisch-reservieren-Tap: sofort Reservierungs-Weg öffnen,
 * parallel Deep-Research → echter Buchungs-Button nachgereicht.
 */
async function handleTableReservationTap(
  action: QuickAction,
  prompt: string,
): Promise<ActionHandlerResult> {
  const offer = useFinnusStore.getState().pendingNavOffer;
  const name =
    (action.payload.destName || offer?.name || '').trim() ||
    prompt
      .replace(/^.*?(?:bei|für)\s+/i, '')
      .replace(/[?.!].*$/, '')
      .trim() ||
    'Restaurant';

  const interimUrl =
    (action.payload.url && /^https?:/i.test(action.payload.url)
      ? action.payload.url
      : null) ||
    `https://www.google.com/search?q=${encodeURIComponent(`${name} Tisch reservieren`)}`;

  try {
    await openExternalUrl(interimUrl);
  } catch {
    /* soft — Deep-Research liefert Buttons nach */
  }

  useFinnusStore.getState().setActiveConciergeCard(null);
  void nachreichenReservationButtons(
    name,
    interimUrl,
    action.payload.targetPoiId,
  );

  return { ok: true };
}

export async function handleQuickAction(
  action: QuickAction,
): Promise<ActionHandlerResult> {
  const isOpenUrl = action.type === 'OPEN_URL';
  let speechWasActive = false;
  try {
    const { stopVoiceOnUserTap, isSpeechActive } = await import(
      '../module2/speech/speechQueue'
    );
    const {
      shouldKeepTalkingOnAction,
      armLinkBackgroundSpeech,
    } = require('./speech/backgroundSpeechPolicy') as {
      shouldKeepTalkingOnAction: (t: string) => boolean;
      armLinkBackgroundSpeech: (o?: { reason?: string }) => void;
    };
    speechWasActive = isSpeechActive();
    if (shouldKeepTalkingOnAction(action.type)) {
      armLinkBackgroundSpeech({ reason: action.type });
    } else if (!isOpenUrl) {
      await stopVoiceOnUserTap();
    }
  } catch {
    /* soft */
  }
  // Keine Button-Floskeln — Bridge/Hauptantwort reichen

  if (isPartnerAffiliateAction(action)) {
    const proceed = await confirmAffiliateRedirectIfNeeded();
    if (!proceed) {
      return { ok: false };
    }
  }

  switch (action.type) {
    case 'START_NAVIGATION': {
      // Say–Do: Laden sofort sichtbar, Thinking/Mic-Textfeld weg
      try {
        useFinnusStore.getState().setNavRouteLoading(true);
        useFinnusStore.getState().setIsGenerating(false);
        if (
          action.payload.replaceRoute === true ||
          action.payload.addStop === true ||
          action.payload.preferWalk === true ||
          action.payload.preferTransit === true ||
          action.payload.preferBike === true
        ) {
          useFinnusStore.getState().setActiveConciergeCard(null);
        }
      } catch {
        /* soft */
      }
      if (action.payload.preferWalk === true) {
        try {
          const { armSkipMobilityChoiceOnce } = require('./navigation/navLeaveByFollowUp') as {
            armSkipMobilityChoiceOnce: () => void;
          };
          armSkipMobilityChoiceOnce();
        } catch {
          /* soft */
        }
      }

      if (
        !action.payload.replaceRoute &&
        !action.payload.addStop &&
        !(action.payload.multiStop && action.payload.multiStop.length >= 2)
      ) {
        const { shouldOfferNavRetarget, presentNavRetargetChoice } = await import(
          './navigation/navRetargetChoice'
        );
        const destName = (
          action.payload.destName ||
          action.label ||
          ''
        ).trim();
        if (
          shouldOfferNavRetarget({
            name: destName,
            lat: action.payload.destLat,
            lng: action.payload.destLng,
            poiId: action.payload.targetPoiId,
          })
        ) {
          presentNavRetargetChoice(
            { ...action.payload, destName: destName || action.payload.destName },
            { speak: true },
          );
          return { ok: true, keepCard: true };
        }
      }

      const legs = action.payload.multiStop;
      if (legs && legs.length >= 2) {
        const { startMultiStopTour } = await import('./navigation/multiStopTour');
        const stops = legs.map((leg, i) => ({
          poiId: leg.poiId ?? -1 - i,
          name: leg.name,
          lat: leg.lat,
          lng: leg.lng,
          done: false,
        }));
        const result = await startMultiStopTour({
          kind: 'custom',
          title: `${stops[0]!.name} → ${stops[stops.length - 1]!.name}`,
          targetDistanceM: null,
          targetDurationMin: null,
          estimatedDistanceM: 0,
          stops,
          currentIndex: 0,
          liveMeta: {
            requestId: `action_${Date.now()}`,
            hardArriveByMs: null,
            softDurationMin: null,
            bufferMin: 10,
            plannedArriveByMs: Date.now() + stops.length * 12 * 60_000,
            startedAtMs: Date.now(),
            denserStops: false,
            mobility: 'transit_ok',
          },
        });
        if (result.ok) {
          try {
            const { startTourLiveSupervisor } = await import(
              '../module2/tour/tourLiveSupervisor'
            );
            const { takeRestPool } = await import('../module2/tour/restPool');
            const { useLiveTourStore } = await import('../module2/tour/tourSpeech');
            const rid = useLiveTourStore.getState().requestId;
            const stashed = rid ? takeRestPool(rid) : null;
            startTourLiveSupervisor({
              requestId: rid ?? `action_${Date.now()}`,
              restPool: stashed?.rest ?? [],
              denserStops: stashed?.denserStops === true,
            });
          } catch {
            /* soft */
          }
        }
        useFinnusStore.getState().setActiveConciergeCard(null);
        try {
          const { requestClosePlanCalendar } = require('../module2/timeline/planCalendarUiStore') as {
            requestClosePlanCalendar: () => void;
          };
          requestClosePlanCalendar();
        } catch {
          /* soft */
        }
        return {
          ok: result.ok,
          message: result.ok ? result.reply : result.reply,
        };
      }
      const offer = useFinnusStore.getState().pendingNavOffer;
      if (action.payload.preferBike === true) {
        try {
          const { forceBikeModeFromVoice } = await import(
            './navigation/travelModeContext'
          );
          forceBikeModeFromVoice();
        } catch {
          /* soft */
        }
      }
      const payloadName = (
        action.payload.destName ||
        action.label ||
        ''
      ).trim();
      if (
        (action.payload.preferWalk === true ||
          action.payload.preferTransit === true ||
          action.payload.preferBike === true) &&
        typeof action.payload.destLat === 'number' &&
        typeof action.payload.destLng === 'number' &&
        Number.isFinite(action.payload.destLat) &&
        Number.isFinite(action.payload.destLng)
      ) {
        const { startPitchNavigation, pitchNavIntentFromPayload } = await import(
          '../module2/pitch/pitchStartNav'
        );
        const chosen = await startPitchNavigation(
          {
            name: payloadName || 'Ort',
            lat: action.payload.destLat,
            lng: action.payload.destLng,
          },
          pitchNavIntentFromPayload(action.payload),
        );
        return { ok: chosen.ok, message: chosen.message };
      }
      const wakeLike = /^wecker\b|aufstehen/i.test(payloadName);
      const hasPayloadCoords =
        typeof action.payload.destLat === 'number' &&
        typeof action.payload.destLng === 'number' &&
        Number.isFinite(action.payload.destLat) &&
        Number.isFinite(action.payload.destLng);
      // Nie Wecker-/Stale-Offer als Nav-Ziel missbrauchen
      const useOffer =
        !wakeLike &&
        !hasPayloadCoords &&
        offer != null &&
        !/^wecker\b|aufstehen/i.test(offer.name ?? '');
      const result = await commitHandsFreeNavStart(
        {
          poiId: action.payload.targetPoiId,
          name: payloadName || (useOffer ? offer?.name : null) || null,
          lat: hasPayloadCoords
            ? action.payload.destLat!
            : useOffer
              ? offer?.lat ?? null
              : null,
          lng: hasPayloadCoords
            ? action.payload.destLng!
            : useOffer
              ? offer?.lng ?? null
              : null,
        },
        {
          skipClosingGate: action.payload.skipClosingGate === true,
          offlineOnly: action.payload.offlineOnly === true,
          skipDestVerify: action.payload.skipDestVerify === true,
          replaceRoute: action.payload.replaceRoute === true,
          addStop: action.payload.addStop === true,
        },
      );
      
      if (result.ok) {
        try {
          const { requestClosePlanCalendar } = require('../module2/timeline/planCalendarUiStore') as {
            requestClosePlanCalendar: () => void;
          };
          requestClosePlanCalendar();
        } catch {
          /* soft */
        }
        const store = useFinnusStore.getState();
        const lat = store.lastGpsLat;
        const lng = store.lastGpsLng;
        const tasks = useShoppingTaskStore.getState().getOpenTasks();
        
        if (lat != null && lng != null && tasks.length > 0) {
          const task = tasks[0];
          // Fire and forget - Phase 2 proactive detour search
          setTimeout(async () => {
            const discovery = await runContextualDiscovery({
              placeType: task.placeTypes[0] || 'convenience_store',
              label: task.itemLabel,
              origin: { lat, lng },
              headingDeg: getDeviceHeadingDeg(),
              movementBearingDeg: getMovementBearingDeg(),
              emergency: false,
            });
            
            if (discovery.candidates.length > 0) {
               const top = discovery.candidates[0];
               if (top.detourM != null && top.detourM <= 250) {
                  discovery.speech = `Vorher noch zum ${task.itemLabel}? ${top.name} ist nur ${top.detourM}m Umweg.`;
                  discovery.quickActions = [{
                    type: 'START_NAVIGATION',
                    label: `Ja, zu ${top.name}`,
                    payload: { destLat: top.lat, destLng: top.lng, destName: top.name, targetPoiId: `place:${top.placeId}` }
                  }];
                  presentDiscoveryAsConcierge(discovery);
               }
            }
          }, 2000);
        }
      }
      
      return {
        ok: result.ok,
        // Bei Tour-Weave: kurze Erklärung („Aldi oben, Tour bleibt“)
        message: result.message,
      };
    }

    case 'DIAL_PHONE': {
      const raw = (action.payload.phoneNumber ?? '').replace(/[^\d+]/g, '');
      const digits = raw.replace(/\D/g, '');
      // Kurzwahlen Notruf/Ärztlicher Bereitschaftsdienst (landesabhängig)
      const isEmergencyShort = isKnownEmergencyShort(digits);
      if (!raw || (!isEmergencyShort && digits.length < 6)) {
        return { ok: false, message: 'Keine gültige Telefonnummer.' };
      }
      // tel: öffnet die Telefon-App mit vorausgefüllter Nummer
      const url = `tel:${raw}`;
      try {
        await openExternalUrl(url);
        return { ok: true };
      } catch {
        const can = await Linking.canOpenURL(url).catch(() => false);
        if (!can) {
          return {
            ok: false,
            message: 'Telefon-App konnte nicht geöffnet werden.',
          };
        }
        await openExternalUrl(url);
        return { ok: true };
      }
    }

    case 'OPEN_URL': {
      if (action.payload.pending) {
        const recoveredPending = recoverHotelBookUrl(action);
        if (recoveredPending) {
          action = {
            ...action,
            payload: {
              ...action.payload,
              url: recoveredPending,
              pending: false,
            },
          };
        } else {
          return {
            ok: false,
            message: 'Link wird noch gesucht — einen Moment…',
          };
        }
      }
      let url = (action.payload.url ?? '').trim();
      if (/findus\.local\/pending/i.test(url)) {
        const recovered = recoverHotelBookUrl(action);
        if (recovered) {
          url = recovered;
        } else {
          return {
            ok: false,
            message: 'Link wird noch gesucht — einen Moment…',
          };
        }
      }
      // GetYourGuide-Slugs ohne volle URL
      if (
        !url &&
        (action.payload.gygTourSlug || action.payload.gygLocationId)
      ) {
        url = buildGetYourGuideTourUrl(
          action.payload.gygTourSlug ||
            `l${action.payload.gygLocationId}`,
        );
      }
      if (!url) {
        const recoveredEmpty = recoverHotelBookUrl(action);
        if (recoveredEmpty) {
          url = recoveredEmpty;
        } else if (/\b(tisch|reserv)/i.test(action.label)) {
          // Reservieren ohne URL → Deep-Research-Flow statt stillem Fail
          return handleTableReservationTap(action, action.label);
        } else {
          return { ok: false, message: 'Kein Link hinterlegt.' };
        }
      }
      if (/m\.uber\.com|uber\.com\/ul/i.test(url)) {
        url = encodeUriBrackets(url);
      }
      // Letzte Verteidigung: nie leere Partner-Portale als „Buchen“ öffnen
      try {
        const {
          isHollowPartnerUrl,
          looksLikePartnerBookClaim,
        } = require('./affiliate/hollowPartnerUrl') as {
          isHollowPartnerUrl: (u: string) => boolean;
          looksLikePartnerBookClaim: (l: string) => boolean;
        };
        if (
          looksLikePartnerBookClaim(action.label) &&
          isHollowPartnerUrl(url)
        ) {
          const recoveredHollow = recoverHotelBookUrl(action);
          if (
            recoveredHollow &&
            !isHollowPartnerUrl(recoveredHollow)
          ) {
            url = recoveredHollow;
          } else {
            return {
              ok: false,
              message:
                'Dafür habe ich gerade keinen direkten Buchungslink beim Partner — nutz Route/Infos, oder nenn mir die genaue Ticket-Seite.',
            };
          }
        }
      } catch {
        /* soft */
      }
      // Nach dem Öffnen: echten Buchungs-Button nachreichen (kein zweites openURL)
      if (/\b(tisch|reserv)/i.test(action.label)) {
        const dest =
          action.payload.destName?.trim() ||
          useFinnusStore.getState().pendingNavOffer?.name ||
          'Restaurant';
        void nachreichenReservationButtons(dest, url, action.payload.targetPoiId);
      }
      // mailto: vorausgefüllte Anfragen (Hotel-Verlängerung etc.)
      if (/^mailto:/i.test(url)) {
        try {
          await openExternalUrl(url);
          return { ok: true };
        } catch {
          return {
            ok: false,
            message: 'E-Mail-App ließ sich nicht öffnen.',
          };
        }
      }
      if (!/^https?:\/\//i.test(url)) {
        if (/musement|tui/i.test(url)) {
          url = getMusementBookingUrl(url);
        } else if (/viator|tripadvisor/i.test(url)) {
          url = getViatorBookingUrl(url);
        } else if (/discovercars|economybookings|mietwagen|rental/i.test(url)) {
          url = getCarRentalUrl();
        } else if (/bounce|gepaeck|gepäck|luggage/i.test(url)) {
          url = getBounceLuggageUrl();
        } else if (/stay22|hotel|unterkunft|ferien/i.test(url)) {
          const dest =
            action.payload.destination?.trim() ||
            action.payload.destName?.trim() ||
            '';
          url = getStay22AccommodationUrl(dest);
        } else if (/getyourguide|tour|ticket/i.test(url)) {
          url = buildGetYourGuideTourUrl(url);
        } else {
          url = `https://${url}`;
        }
      }
      url = normalizeAffiliateUrl(url);
      const keptPage = keepFoundEventUrl(url);
      if (keptPage) url = keptPage;
      try {
        const { resolveTapOpenUrl } = require('./research/liveDeepLink') as {
          resolveTapOpenUrl: (o: {
            url: string;
            label: string;
            destName?: string | null;
            entityName?: string | null;
          }) => Promise<string>;
        };
        url = await resolveTapOpenUrl({
          url,
          label: action.label,
          destName: action.payload.destName,
          entityName: action.payload.entityName,
          payload: action.payload,
        });
      } catch {
        /* soft — lieber öffnen als blocken */
      }
      if (isCityMapUrl(url)) {
        const ok = await openCityMap({
          id: 'map',
          title: 'Interaktive Inselkarte',
          url,
        });
        return {
          ok,
          message: ok ? undefined : 'Die Karte lässt sich gerade nicht öffnen.',
        };
      }
      // Google Maps: geo:-Intent zuerst (App-Pin), sonst https dir-Link
      const isMaps = isGoogleMapsOpenUrl(url);
      if (isMaps) {
        try {
          const {
            rewriteGoogleMapsOpenUrl,
          } = require('./research/eventInfoUrl') as {
            rewriteGoogleMapsOpenUrl: (o: {
              url: string;
              destName?: string | null;
              entityName?: string | null;
            }) => string;
          };
          url = rewriteGoogleMapsOpenUrl({
            url,
            destName: action.payload.destName,
            entityName: action.payload.entityName,
          });
        } catch {
          /* soft */
        }
        const mapsSpeech = speechForGoogleMapsOpen({
          destName: action.payload.destName || action.payload.entityName,
          label: action.label,
        });
        // Nur ansagen wenn gerade nichts gesprochen wird
        if (mapsSpeech && !speechWasActive) {
          announceOpenUrlSpeech(mapsSpeech);
        }
        const dest =
          url.match(/[?&]destination=([-.\d]+),([-.\d]+)/i) ||
          url.match(/[?&]query=([-.\d]+),([-.\d]+)/i);
        if (dest) {
          const lat = dest[1]!;
          const lng = dest[2]!;
          const labelMatch = url.match(
            /destination_place_id=([^&]+)|destination=([^&]+)/i,
          );
          const label = decodeURIComponent(
            (labelMatch?.[1] || labelMatch?.[2] || 'Ziel').replace(/\+/g, ' '),
          );
          const spokenName =
            (action.payload.destName || action.payload.entityName || '')
              .trim() || label.slice(0, 60);
          const geo = `geo:${lat},${lng}?q=${lat},${lng}(${encodeURIComponent(spokenName.slice(0, 60))})`;
          try {
            await openExternalUrl(geo);
            return { ok: true, message: mapsSpeech ?? undefined };
          } catch {
            /* https fallback */
          }
        }
        try {
          await openExternalUrl(url);
          return { ok: true, message: mapsSpeech ?? undefined };
        } catch {
          return {
            ok: false,
            message: 'Google Maps ließ sich gerade nicht öffnen.',
          };
        }
      }
      // Spotify-App-Deep-Link → Browser-Fallback, wenn App fehlt
      if (/^spotify:/i.test(url)) {
        const q = url.replace(/^spotify:search:/i, '').trim();
        url = q
          ? `https://open.spotify.com/search/${encodeURIComponent(decodeURIComponent(q))}`
          : 'https://open.spotify.com/search/playlist';
      }
      // Speisekarte / OPEN_URL: immer System-Browser (kein In-App-WebView).
      try {
        const openSpeech = speechForOpenUrl(
          url,
          action.label,
          action.payload.destName || action.payload.entityName,
        );
        if (openSpeech && !speechWasActive) {
          announceOpenUrlSpeech(openSpeech);
        }
        await openExternalUrl(url);
        return {
          ok: true,
          // Stumm — kein Chat-/TTS-Hinweis beim Link-Open
          message: openSpeech ?? undefined,
        };
      } catch {
        // canOpenURL ist auf Android oft falsch-negativ — trotzdem öffnen versucht
        const can = await Linking.canOpenURL(url).catch(() => false);
        return {
          ok: false,
          message: can
            ? 'Diesen Link kann ich gerade nicht öffnen.'
            : 'Diesen Link kann ich nicht öffnen — Spotify oder Browser prüfen.',
        };
      }
    }

    case 'OPEN_GYG_WIDGET': {
      const slug = action.payload.gygTourSlug || action.payload.url;
      const locationId = action.payload.gygLocationId;
      if (!slug && !locationId) {
        return {
          ok: false,
          message: 'Keine Tour oder Location für GetYourGuide.',
        };
      }
      useFinnusStore.getState().setGygWidget({
        tourUrlOrSlug: slug || undefined,
        locationId: locationId || undefined,
        widget: slug ? 'availability' : 'activities',
      });
      return {
        ok: true,
        message: 'Ich öffne die Verfügbarkeit in der App.',
      };
    }

    case 'BOOK_UBER': {
      let lat = action.payload.destLat;
      let lng = action.payload.destLng;
      let name = (action.payload.destName || '').trim();
      const dropAddr =
        (action.payload.dropoffFormattedAddress || name || '').trim();
      const pickupTimeRaw = (action.payload.pickupTimeLabel || '').trim();
      const pickupTimeLabel = pickupTimeRaw
        ? roundClockHmmDownTo5(pickupTimeRaw)
        : '';

      if (
        (lat == null || lng == null || !Number.isFinite(lat) || !Number.isFinite(lng)) &&
        action.payload.targetPoiId != null
      ) {
        const poiId = await resolvePoiId(action.payload.targetPoiId);
        if (poiId != null) {
          const pois = await getAllPois();
          const poi = pois.find((p) => p.id === poiId);
          if (poi) {
            lat = poi.lat;
            lng = poi.lng;
            if (!name) {
              name = poi.name
                .replace(/\s*[·•|]\s*Wegweiser\s*$/i, '')
                .trim();
            }
          }
        }
      }

      // Adresse ohne Koordinaten → Geocode (Pickup = aktuelle Position)
      if (
        (lat == null || lng == null || !Number.isFinite(lat) || !Number.isFinite(lng)) &&
        (dropAddr || name)
      ) {
        try {
          const { geocodePlaceName } = await import(
            './navigation/googleMapsNav'
          );
          const hit = await geocodePlaceName(dropAddr || name);
          if (hit && Number.isFinite(hit.lat) && Number.isFinite(hit.lng)) {
            lat = hit.lat;
            lng = hit.lng;
            if (!name) name = dropAddr || 'Ziel';
          }
        } catch {
          /* soft */
        }
      }

      if (
        lat == null ||
        lng == null ||
        !Number.isFinite(lat) ||
        !Number.isFinite(lng)
      ) {
        return {
          ok: false,
          message: 'Für Uber brauche ich noch die Zieladresse oder Koordinaten.',
        };
      }

      const ok = await (async () => {
        const direct = action.payload.url?.trim();
        if (direct && /uber\.com/i.test(direct)) {
          try {
            // canOpenURL auf Android oft falsch-negativ bei dropoff[latitude]
            await openExternalUrl(encodeUriBrackets(direct));
            return true;
          } catch {
            /* fall through */
          }
        }
        return openUberRide(lat, lng, name || 'Ziel', null, {
          dropoffFormattedAddress: dropAddr || name || 'Ziel',
          pickupTimeLabel: pickupTimeLabel || null,
          pickupDateIso: action.payload.dateIso || null,
        });
      })();
      if (ok) {
        try {
          const { useLogisticsTriggerStore } = await import(
            '../store/useLogisticsTriggerStore'
          );
          const { reportTaxiStatus } = await import(
            './logistics/logisticsTriggerEngine'
          );
          const active = useLogisticsTriggerStore
            .getState()
            .getActiveEvents()
            .find(
              (e) =>
                e.kind === 'train' ||
                e.kind === 'bus' ||
                e.kind === 'flight' ||
                e.kind === 'reminder',
            );
          reportTaxiStatus({
            eventId: active?.id ?? `taxi-${Date.now()}`,
            status: 'booked',
            destLat: lat,
            destLng: lng,
            destName: name || 'Ziel',
          });
        } catch {
          /* optional logistics link */
        }
      }
      return {
        ok,
        message: ok
          ? pickupTimeLabel
            ? `Uber ist vorbereitet (Ziel + dein Standort). Uhrzeit ${pickupTimeLabel} bitte in der App noch prüfen — Uber-Links können die Uhrzeit nicht fest setzen.`
            : undefined
          : 'Uber lässt sich gerade nicht öffnen — versuch den Link gleich nochmal.',
      };
    }

    case 'BOOK_CAR_RENTAL': {
      const direct = action.payload.url?.trim();
      if (direct) {
        const tracked = normalizeAffiliateUrl(direct);
        try {
          await openExternalUrl(tracked);
          return { ok: true };
        } catch {
          return {
            ok: false,
            message:
              'Mietwagen-Buchung lässt sich gerade nicht öffnen — versuch es gleich nochmal.',
          };
        }
      }
      let fromFlight: Parameters<typeof getCarRentalUrl>[0];
      try {
        const { getLastFlightCommit } = require('./flights/flightTripSession') as {
          getLastFlightCommit: () => {
            destIata?: string;
            destCity?: string;
            dateKey?: string;
          } | null;
        };
        const snap = getLastFlightCommit();
        if (snap?.destIata && snap.dateKey) {
          fromFlight = {
            pickupIata: snap.destIata,
            pickupLocation: snap.destCity || snap.destIata,
            pickupDate: snap.dateKey,
          };
        }
      } catch {
        fromFlight = undefined;
      }
      const ok = await openCarRental(fromFlight);
      return {
        ok,
        message: ok
          ? undefined
          : 'Mietwagen-Buchung lässt sich gerade nicht öffnen — versuch es gleich nochmal.',
      };
    }

    case 'BOOK_BOUNCE_LUGGAGE': {
      const ok = await openBounceLuggage();
      return {
        ok,
        message: ok
          ? undefined
          : 'Bounce lässt sich gerade nicht öffnen — versuch es gleich nochmal.',
      };
    }

    case 'BOOK_STAY22': {
      const dest =
        action.payload.destination?.trim() ||
        action.payload.destName?.trim() ||
        getCachedUserProfile()?.cityName?.trim() ||
        '';
      const directUrl = action.payload.url?.trim();
      let bookUrl = directUrl || '';
      try {
        const { upgradeHotelUrlOnTap } = require('./affiliate/openUrlBookingPrefill') as {
          upgradeHotelUrlOnTap: (o: {
            url: string;
            label?: string;
            destName?: string | null;
            destination?: string | null;
            checkin?: string;
            checkout?: string;
            adults?: number;
          }) => Promise<string>;
        };
        bookUrl = await upgradeHotelUrlOnTap({
          url: directUrl || 'https://www.stay22.com/',
          label: action.label,
          destName: action.payload.destName,
          destination:
            action.payload.destination?.trim() ||
            dest,
          checkin: action.payload.checkin,
          checkout: action.payload.checkout,
          adults: action.payload.adults,
        });
      } catch {
        /* soft */
      }
      let ok = await openStay22Accommodation(dest, {
        url: bookUrl || directUrl,
        checkin: action.payload.checkin,
        checkout: action.payload.checkout,
        adults: action.payload.adults,
      });
      if (!ok) {
        try {
          const {
            openExpediaAccommodation,
          } = require('./affiliate/affiliateService') as {
            openExpediaAccommodation: (
              d: string,
              o?: {
                checkin?: string;
                checkout?: string;
                adults?: number;
                url?: string;
              },
            ) => Promise<boolean>;
          };
          ok = await openExpediaAccommodation(dest || 'Germany', {
            checkin: action.payload.checkin,
            checkout: action.payload.checkout,
            adults: action.payload.adults,
          });
        } catch {
          /* soft */
        }
      }
      return {
        ok,
        message: ok
          ? undefined
          : 'Unterkunftssuche lässt sich gerade nicht öffnen — versuch es gleich nochmal.',
      };
    }

    case 'BOOK_ESIM': {
      const directUrl = action.payload.url?.trim();
      if (directUrl) {
        const tracked = normalizeAffiliateUrl(directUrl);
        const can = await Linking.canOpenURL(tracked);
        if (!can) {
          return {
            ok: false,
            message:
              'eSIM-Angebot lässt sich gerade nicht öffnen — versuch es gleich nochmal.',
          };
        }
        await openExternalUrl(tracked);
        return { ok: true };
      }
      if (!getEsimAffiliateUrl()) {
        return {
          ok: false,
          message: 'eSIM-Angebot ist gerade nicht konfiguriert.',
        };
      }
      const ok = await openEsim();
      return {
        ok,
        message: ok
          ? undefined
          : 'eSIM-Shop lässt sich gerade nicht öffnen — versuch es gleich nochmal.',
      };
    }

    case 'CONFIRM_API_RESERVATION':
      return reservationFromAction(action, 'API');

    case 'SEND_RESERVATION_EMAIL':
      return reservationFromAction(action, 'EMAIL');

    case 'TRIGGER_AI_CALL': {
      // Fire & Forget — User darf App schließen; Follow-up später
      const poiId = await resolvePoiId(action.payload.targetPoiId);
      if (poiId == null) {
        return {
          ok: false,
          message:
            'Welches Restaurant meinst du? Tippe nochmal oder sag den Namen.',
        };
      }
      const pois = await getAllPois();
      const poi = pois.find((p) => p.id === poiId);
      if (!poi) {
        return { ok: false, message: 'Restaurant nicht gefunden.' };
      }
      const profile = getCachedUserProfile();
      if (!profile) {
        return {
          ok: false,
          message: 'Profil fehlt für den KI-Anruf.',
        };
      }
      const facts = (await getFactsForPoi(poiId)).map((f) => f.fact_text);
      const { startAsyncAiCallReservation } = await import(
        './reservation/asyncVapiBooking'
      );
      const { immediateSpeech } = startAsyncAiCallReservation({
        poi,
        details: {
          partySize: Math.max(
            1,
            Math.min(20, Number(action.payload.partySize) || 2),
          ),
          timeLabel: (action.payload.timeLabel || 'heute Abend').trim(),
          dateIso: action.payload.dateIso,
        },
        profile,
        factTexts: facts,
        onFollowUp: async (speech) => {
          try {
            await speakAssistantText(speech);
          } catch {
            /* soft */
          }
        },
      });
      return { ok: true, message: immediateSpeech };
    }

    case 'SHOW_MORE': {
      if (action.payload.choiceTap) {
        const ct = action.payload.choiceTap;
        useFinnusStore.getState().setActiveConciergeCard(null);
        try {
          const { continueTurnFromChoice } = await import(
            '../module2/router/continueTurnFromChoice'
          );
          await continueTurnFromChoice({
            parentTurnId: ct.parentTurnId,
            choiceId: ct.choiceId,
            label: ct.label,
            slotKey: ct.slotKey,
          });
          return { ok: true };
        } catch (err) {
          console.warn('[action] choice tap failed:', err);
          return {
            ok: false,
            message: 'Die Auswahl konnte gerade nicht verarbeitet werden.',
          };
        }
      }
      const legs = action.payload.multiStop;
      if (legs && legs.length >= 2) {
        const { startMultiStopTour } = await import('./navigation/multiStopTour');
        const stops = legs.map((leg, i) => ({
          poiId: leg.poiId ?? -1 - i,
          name: leg.name,
          lat: leg.lat,
          lng: leg.lng,
          done: false,
        }));
        const result = await startMultiStopTour({
          kind: 'custom',
          title: `${stops[0]!.name} → ${stops[stops.length - 1]!.name}`,
          targetDistanceM: null,
          targetDurationMin: null,
          estimatedDistanceM: 0,
          stops,
          currentIndex: 0,
          liveMeta: {
            requestId: `showmore_${Date.now()}`,
            hardArriveByMs: null,
            softDurationMin: null,
            bufferMin: 10,
            plannedArriveByMs: Date.now() + stops.length * 12 * 60_000,
            startedAtMs: Date.now(),
            denserStops: false,
            mobility: 'transit_ok',
          },
        });
        if (result.ok) {
          try {
            const { startTourLiveSupervisor } = await import(
              '../module2/tour/tourLiveSupervisor'
            );
            startTourLiveSupervisor({
              requestId: `showmore_${Date.now()}`,
              restPool: [],
              denserStops: false,
            });
          } catch {
            /* soft */
          }
        }
        useFinnusStore.getState().setActiveConciergeCard(null);
        return {
          ok: result.ok,
          message: result.ok ? result.reply : result.reply,
        };
      }
      const prompt =
        action.payload.textPrompt?.trim() ||
        'Erzähl mir bitte etwas mehr dazu.';

      if (
        prompt === '__SHOW_PLAN_DAY__' ||
        prompt.startsWith('__SHOW_PLAN_DAY__:')
      ) {
        const dayKey = prompt.includes(':')
          ? prompt.split(':').slice(1).join(':').trim()
          : null;
        useFinnusStore.getState().setActiveConciergeCard(null);
        try {
          const { revealPlanCalendarNow } = await import(
            '../module2/timeline/planCalendarUiStore'
          );
          await revealPlanCalendarNow(dayKey || null);
        } catch {
          /* soft */
        }
        return { ok: true };
      }

      if (prompt === '__START_PLAN_STEP_LOOP__') {
        useFinnusStore.getState().setActiveConciergeCard(null);
        try {
          const { runPlanningModule } = await import(
            '../module2/planning/runPlanningModule'
          );
          await runPlanningModule({
            userText: '__START_PLAN_STEP_LOOP__',
          });
        } catch (err) {
          console.warn('[action] start plan step loop failed', err);
        }
        return { ok: true };
      }

      try {
        const {
          resolveChoiceSlotFromPrompt,
          getLastParentTurnId,
        } = await import('../module2/router/choiceTurnContext');
        const resolved = resolveChoiceSlotFromPrompt(prompt, action.label);
        if (resolved) {
          useFinnusStore.getState().setActiveConciergeCard(null);
          const { continueTurnFromChoice } = await import(
            '../module2/router/continueTurnFromChoice'
          );
          const parentTurnId =
            getLastParentTurnId() || `tap_${Date.now()}`;
          await continueTurnFromChoice({
            parentTurnId,
            choiceId: resolved.choiceId,
            label: resolved.label,
            slotKey: resolved.slotKey,
            inventoryPatch: resolved.inventoryPatch,
          });
          return { ok: true };
        }
      } catch (err) {
        console.warn('[action] choice slot resolve failed:', err);
      }

      try {
        const { isRainDontCareUtterance } = await import(
          './weather/rainIncomingPolicy'
        );
        if (isRainDontCareUtterance(prompt)) {
          useFinnusStore.getState().setActiveConciergeCard(null);
          const ack = 'Alles klar — dann bleiben wir beim Plan.';
          try {
            const { speakAssistantText, getVoiceSettingsForTour } = await import(
              './ttsService'
            );
            const voice = await getVoiceSettingsForTour();
            await speakAssistantText(ack, {
              voiceId: voice.voiceId,
              speechRate: voice.speechRate,
            });
          } catch {
            /* soft */
          }
          return { ok: true, message: ack };
        }
      } catch {
        /* soft */
      }

      try {
        const { tryHandleNarrationResumePrompt } = await import(
          './session/sessionResumeService'
        );
        if (await tryHandleNarrationResumePrompt(prompt)) {
          useFinnusStore.getState().setActiveConciergeCard(null);
          return { ok: true, message: 'Story fortgesetzt.' };
        }
      } catch {
        /* soft */
      }

      // Tisch reservieren: sofort Link öffnen + Deep-Research für echten Buchungs-Button
      const reserveTap =
        /\b(tisch\s+reserv|reservier)/i.test(action.label) ||
        (/\b(reservier|tisch\s+(?:bei|anfrag|buch))/i.test(prompt) &&
          !/\b(hotel|zimmer|übernacht|uebernacht)\b/i.test(prompt));
      if (reserveTap) {
        return handleTableReservationTap(action, prompt);
      }
      if (prompt === '__OPEN_APP_SETTINGS__') {
        useFinnusStore.getState().requestOpenSettings();
        useFinnusStore.getState().setActiveConciergeCard(null);
        return { ok: true };
      }
      if (prompt === '__RESTORE_PREV_NAV_ROUTE__') {
        const { restorePreviousNavRoute } = await import(
          './navigation/navigationService'
        );
        const ok = restorePreviousNavRoute();
        useFinnusStore.getState().setActiveConciergeCard(null);
        return {
          ok,
          message: ok
            ? 'Alte Route wieder aktiv.'
            : 'Alte Route nicht mehr verfügbar.',
        };
      }
      if (/kein\s+wecker|lieber\s+nicht|ohne\s+wecker/i.test(prompt)) {
        setPendingWakeProposal(null);
        useFinnusStore.getState().setActiveConciergeCard(null);
        try {
          const voice = await getVoiceSettingsForTour();
          void speakAssistantText('Alles klar — kein Wecker.', {
            voiceId: voice.voiceId,
            speechRate: voice.speechRate,
          });
        } catch {
          /* ignore */
        }
        return { ok: true };
      }

      // Akku / Powerbank / Steckdose → Discovery-SSOT (nie LLM-Heimatläden)
      try {
        const { isPhoneChargeIntent, runPhoneChargeDiscovery } = await import(
          './navigation/phoneChargeDiscovery'
        );
        if (isPhoneChargeIntent(prompt)) {
          const store = useFinnusStore.getState();
          const lat = store.lastGpsLat;
          const lng = store.lastGpsLng;
          if (lat != null && lng != null) {
            const charge = await runPhoneChargeDiscovery({
              origin: { lat, lng },
            });
            presentDiscoveryAsConcierge({
              ...charge,
              queryLabel: 'Akku · Handy laden',
            });
            try {
              const voice = await getVoiceSettingsForTour();
              await speakAssistantText(charge.speech, {
                voiceId: voice.voiceId,
                speechRate: voice.speechRate,
              });
            } catch {
              /* soft */
            }
            return { ok: true, message: charge.speech };
          }
        }
      } catch {
        /* soft — fall through to concierge */
      }

      // Modul-1 Mehr Historie → Deep-Dive am Ort (nie Planung/Timeline)
      // Wissens-Expand („App Store…“) darf NIEMALS Orts-Historie triggern
      if (action.payload.expandKind === 'knowledge') {
        return { ok: true, followUpPrompt: prompt };
      }
      const wantsM1Deep =
        action.payload.expandKind === 'poi_history' ||
        action.payload.expandKind === 'activity' ||
        action.payload.module1DeepDive === true ||
        /mehr\s+historie|mehr\s+zur\s+(geschichte|historie)|tiefe[rn]?\s+geschichte|was\s+du\s+noch\s+nicht\s+gesagt/i.test(
          prompt,
        );
      if (wantsM1Deep) {
        const store = useFinnusStore.getState();
        const poiIdRaw =
          action.payload.targetPoiId ??
          store.currentPoiId ??
          store.lastVisitedPoiId;
        const poiId =
          typeof poiIdRaw === 'number'
            ? poiIdRaw
            : typeof poiIdRaw === 'string' && /^\d+$/.test(poiIdRaw)
              ? Number(poiIdRaw)
              : null;
        if (poiId != null && Number.isFinite(poiId)) {
          store.setActiveConciergeCard(null);
          try {
            const { triggerPoiArrival } = await import('../runtime/exploreModule');
            await triggerPoiArrival(poiId, {
              force: true,
              interestDeepDive: true,
            });
            return { ok: true };
          } catch (err) {
            console.warn('[action] module1 deep-dive failed:', err);
          }
        }
      }

      return { ok: true, followUpPrompt: prompt };
    }

    case 'COMPLETE_SHOPPING_TASK': {
      const taskId = action.payload.taskId?.trim();
      if (!taskId) {
        return { ok: false, message: 'Keine Einkaufs-Aufgabe gefunden.' };
      }
      const task = useShoppingTaskStore
        .getState()
        .tasks.find((t) => t.id === taskId);
      useShoppingTaskStore.getState().completeTask(taskId);
      useFinnusStore.getState().setActiveConciergeCard(null);
      const item = task?.itemLabel ?? 'das';
      try {
        const { retireCommitmentsForHint } = require('../module2/timeline/retireTimelineCommitments') as {
          retireCommitmentsForHint: (hint: string) => unknown;
        };
        if (task?.itemLabel) retireCommitmentsForHint(task.itemLabel);
      } catch {
        /* soft */
      }
      try {
        const voice = await getVoiceSettingsForTour();
        void speakAssistantText(`Super — ${item} ist erledigt.`, {
          voiceId: voice.voiceId,
          speechRate: voice.speechRate,
        });
      } catch {
        /* ignore */
      }
      return { ok: true };
    }

    case 'SNOOZE_SHOPPING_TASK': {
      const taskId = action.payload.taskId?.trim();
      if (!taskId) {
        return { ok: false, message: 'Keine Einkaufs-Aufgabe gefunden.' };
      }
      useShoppingTaskStore.getState().snoozeTask(taskId);
      useFinnusStore.getState().setActiveConciergeCard(null);
      try {
        const voice = await getVoiceSettingsForTour();
        void speakAssistantText('Alles klar — ich frage später nochmal.', {
          voiceId: voice.voiceId,
          speechRate: voice.speechRate,
        });
      } catch {
        /* ignore */
      }
      return { ok: true };
    }

    case 'SET_TIMER': {
      const prompt = action.payload.textPrompt?.trim() ?? '';
      if (/timer\s+(aus|stopp|stop|abbrechen)|stopp?\s+(den\s+)?timer/i.test(prompt)) {
        const { cancelFindusTimer } = await import('./alarms/timerService');
        const cancelled = await cancelFindusTimer();
        useFinnusStore.getState().setActiveConciergeCard(null);
        try {
          const voice = await getVoiceSettingsForTour();
          void speakAssistantText(cancelled.speech, {
            voiceId: voice.voiceId,
            speechRate: voice.speechRate,
          });
        } catch {
          /* ignore */
        }
        return { ok: cancelled.ok, message: cancelled.speech };
      }

      const durationMs =
        typeof action.payload.durationMs === 'number' &&
        Number.isFinite(action.payload.durationMs)
          ? action.payload.durationMs
          : action.payload.dateIso
            ? Date.parse(action.payload.dateIso) - Date.now()
            : NaN;
      if (!Number.isFinite(durationMs) || durationMs < 5_000) {
        return { ok: false, message: 'Timer-Dauer fehlt oder ist zu kurz.' };
      }
      const { startFindusTimer } = await import('./alarms/timerService');
      const started = await startFindusTimer({
        durationMs,
        label: action.payload.destName?.trim() || 'Timer',
      });
      useFinnusStore.getState().setActiveConciergeCard(null);
      try {
        const voice = await getVoiceSettingsForTour();
        void speakAssistantText(started.speech, {
          voiceId: voice.voiceId,
          speechRate: voice.speechRate,
        });
      } catch {
        /* ignore */
      }
      return { ok: started.ok, message: started.speech };
    }

    case 'SET_WAKE_ALARM': {
      const pending = getPendingWakeProposal();
      const wakeAtMs = action.payload.dateIso
        ? Date.parse(action.payload.dateIso)
        : pending?.wakeAtMs ?? NaN;
      const wakeMode = action.payload.wakeMode;

      if (wakeMode === 'cancel') {
        const cancelAt =
          action.payload.replaceWakeAtMs ??
          (Number.isFinite(wakeAtMs) ? wakeAtMs : NaN);
        const { cancelWakeAlarmWithBridge } = await import(
          './alarms/nativeAlarmBridge'
        );
        const result = await cancelWakeAlarmWithBridge({ wakeAtMs: cancelAt });
        useFinnusStore.getState().setActiveConciergeCard(null);
        const speech = result.message || 'Wecker gelöscht.';
        try {
          const voice = await getVoiceSettingsForTour();
          void speakAssistantText(speech, {
            voiceId: voice.voiceId,
            speechRate: voice.speechRate,
          });
        } catch {
          /* ignore */
        }
        return { ok: result.ok, message: speech };
      }

      if (!Number.isFinite(wakeAtMs) || wakeAtMs < Date.now() + 20_000) {
        const prompt = action.payload.textPrompt?.trim();
        if (prompt) {
          const { prepareWakeAlarmFollowUp } = await import(
            './alarms/wakeAlarmAdvisor'
          );
          const wake = await prepareWakeAlarmFollowUp(prompt);
          useFinnusStore.getState().setActiveConciergeCard(null);
          const speech =
            wake?.speech ||
            'Die Wecker-Zeit liegt zu nah oder fehlt — sag mir z. B. „Wecker um 7“.';
          try {
            const voice = await getVoiceSettingsForTour();
            void speakAssistantText(speech, {
              voiceId: voice.voiceId,
              speechRate: voice.speechRate,
            });
          } catch {
            /* ignore */
          }
          return { ok: Boolean(wake?.wakeAtMs), message: speech };
        }
        const msg =
          'Die Wecker-Zeit liegt zu nah oder fehlt — sag mir z. B. „Wecker um 7“.';
        try {
          const voice = await getVoiceSettingsForTour();
          void speakAssistantText(msg, {
            voiceId: voice.voiceId,
            speechRate: voice.speechRate,
          });
        } catch {
          /* ignore */
        }
        return { ok: false, message: msg };
      }
      const reason =
        action.payload.destName?.trim() ||
        pending?.reasonLabel ||
        'deinen Termin';
      const result = await setWakeAlarmWithBridge({
        wakeAtMs,
        reasonLabel: reason,
        leaveByMs: pending?.leaveByMs ?? null,
        reminderKey: `${reason}:${wakeAtMs}`,
        preferNative: true,
        wakeMode:
          wakeMode === 'replace' || wakeMode === 'add' ? wakeMode : 'add',
        replaceWakeAtMs: action.payload.replaceWakeAtMs ?? null,
      });
      useFinnusStore.getState().setActiveConciergeCard(null);
      setPendingWakeProposal(null);
      const speech =
        result.message ||
        (result.ok
          ? `Ich habe deinen Wecker auf ${formatClockDe(wakeAtMs)} gestellt.`
          : 'Wecker lässt sich gerade nicht stellen.');
      try {
        const voice = await getVoiceSettingsForTour();
        void speakAssistantText(speech, {
          voiceId: voice.voiceId,
          speechRate: voice.speechRate,
        });
      } catch {
        /* ignore */
      }
      return { ok: result.ok, message: speech };
    }

    case 'SHOW_STREET_VIEW': {
      const lat = action.payload.destLat;
      const lng = action.payload.destLng;
      if (
        typeof lat !== 'number' ||
        typeof lng !== 'number' ||
        !Number.isFinite(lat) ||
        !Number.isFinite(lng)
      ) {
        return { ok: false, message: 'Kein Ort für Street View.' };
      }
      try {
        const heading =
          typeof action.payload.headingDeg === 'number' &&
          Number.isFinite(action.payload.headingDeg)
            ? action.payload.headingDeg
            : 0;
        const url =
          `https://www.google.com/maps/@?api=1&map_action=pano` +
          `&viewpoint=${lat},${lng}&heading=${heading}`;
        const { Linking } = await import('react-native');
        await Linking.openURL(url);
        return { ok: true };
      } catch (err) {
        console.warn('[action] street view failed', err);
        return { ok: false, message: 'Street View ließ sich nicht öffnen.' };
      }
    }

    case 'SET_DEPARTURE_REMINDER': {
      // Pitch „Später einplanen“: still Timeline + Speech
      if ((action.payload as { pitchTiming?: string }).pitchTiming === 'later') {
        try {
          const { useLivePitchStore } = require('../module2/pitch/publishPitchUi') as {
            useLivePitchStore: {
              getState: () => {
                requestId: string | null;
                options: Array<{
                  id: string;
                  name: string;
                  lat: number;
                  lng: number;
                  mapsUrl?: string;
                  menuUrl?: string | null;
                  actions?: unknown[];
                }>;
                selectedOptionId: string | null;
                visitAtMs: number | null;
                pitchKind: string | null;
                pitchContext: string | null;
              };
            };
          };
          const live = useLivePitchStore.getState();
          const opt =
            live.options.find((o) => o.id === live.selectedOptionId) ||
            live.options[0];
          if (opt && live.requestId) {
            const { mirrorLivePitchChoiceToTimeline } = require('../module2/pitch/mirrorLivePitchToTimeline') as {
              mirrorLivePitchChoiceToTimeline: (o: unknown) => void;
            };
            mirrorLivePitchChoiceToTimeline({
              requestId: live.requestId,
              option: opt,
              visitAtMs: live.visitAtMs,
              pitchKind: live.pitchKind,
              pitchContext: live.pitchContext,
            });
          }
          const { pitchTimingLaterSpeech } = require('../module2/pitch/pitchTimingFork') as {
            pitchTimingLaterSpeech: (n: string) => string;
          };
          const { enqueueSpeech } = require('../module2/speech/speechQueue') as {
            enqueueSpeech: (o: { kind: string; text: string; turnId: string }) => void;
          };
          const name =
            action.payload.destName?.trim() || opt?.name || 'den Ort';
          enqueueSpeech({
            kind: 'main',
            text: pitchTimingLaterSpeech(name),
            turnId: `pitch_later_${Date.now()}`,
          });
          return { ok: true, keepCard: true };
        } catch {
          /* fall through to normal reminder */
        }
      }
      const leaveByMs = action.payload.dateIso
        ? Date.parse(action.payload.dateIso)
        : NaN;
      const label =
        action.payload.destName?.trim() ||
        action.payload.textPrompt?.trim() ||
        'dein Termin';
      const hasTime =
        Number.isFinite(leaveByMs) && leaveByMs >= Date.now() + 20_000;

      // Nur Ort, keine Uhrzeit → Geo-Erinnerung (am Ort erinnern)
      if (!hasTime) {
        const destName = action.payload.destName?.trim();
        if (!destName) {
          return {
            ok: false,
            message:
              'Dafür brauche ich noch eine Uhrzeit oder einen konkreten Ort.',
          };
        }
        let lat =
          typeof action.payload.destLat === 'number'
            ? action.payload.destLat
            : null;
        let lng =
          typeof action.payload.destLng === 'number'
            ? action.payload.destLng
            : null;
        if (
          lat == null ||
          lng == null ||
          !Number.isFinite(lat) ||
          !Number.isFinite(lng)
        ) {
          try {
            const { geocodePlaceNameOsmFirst } = await import(
              './navigation/googleMapsNav'
            );
            const profile = getCachedUserProfile();
            const gps = useFinnusStore.getState();
            const g = await geocodePlaceNameOsmFirst(destName, {
              cityHint: profile?.cityName ?? null,
              biasLat:
                typeof gps.lastGpsLat === 'number' ? gps.lastGpsLat : undefined,
              biasLng:
                typeof gps.lastGpsLng === 'number' ? gps.lastGpsLng : undefined,
            });
            if (g && Number.isFinite(g.lat) && Number.isFinite(g.lng)) {
              lat = g.lat;
              lng = g.lng;
            }
          } catch {
            /* soft */
          }
        }
        if (
          lat == null ||
          lng == null ||
          !Number.isFinite(lat) ||
          !Number.isFinite(lng)
        ) {
          return {
            ok: false,
            message: `Den Ort „${destName}“ finde ich gerade nicht zum Erinnern.`,
          };
        }
        useLogisticsTriggerStore.getState().upsertGeoTrigger({
          title: `Erinnerung: ${destName}`,
          detail: action.payload.textPrompt ?? undefined,
          lat,
          lng,
          radiusM: 120,
        });
        useFinnusStore.getState().setActiveConciergeCard(null);
        try {
          const voice = await getVoiceSettingsForTour();
          void speakAssistantText(
            `Alles klar — sobald du bei ${destName} bist, erinnere ich dich.`,
            { voiceId: voice.voiceId, speechRate: voice.speechRate },
          );
        } catch {
          /* soft */
        }
        return { ok: true, message: `Geo-Erinnerung: ${destName}` };
      }

      const hasCoords =
        typeof action.payload.destLat === 'number' &&
        typeof action.payload.destLng === 'number' &&
        Number.isFinite(action.payload.destLat) &&
        Number.isFinite(action.payload.destLng);
      const { shouldUseTaskReminderPush, extractTaskReminderPhrase } =
        await import('./notifications/taskReminderCopy');
      const userBlob =
        action.payload.textPrompt?.trim() ||
        action.payload.destName?.trim() ||
        '';
      if (
        shouldUseTaskReminderPush({
          userText: userBlob,
          destName: action.payload.destName,
          hasCoords,
        })
      ) {
        const task = extractTaskReminderPhrase(userBlob, label);
        const { registerTimeReminder } = await import(
          './logistics/logisticsTriggerEngine'
        );
        registerTimeReminder({
          title: task,
          fireAtMs: leaveByMs,
          detail: userBlob.slice(0, 180),
          eventId: `task-${leaveByMs}`,
        });
        useFinnusStore.getState().setActiveConciergeCard(null);
        try {
          const voice = await getVoiceSettingsForTour();
          void speakAssistantText(
            `Alles klar — um ${formatClockDe(leaveByMs)} erinnere ich dich: ${task}.`,
            { voiceId: voice.voiceId, speechRate: voice.speechRate },
          );
        } catch {
          /* ignore */
        }
        return { ok: true, message: `Erinnerung ${formatClockDe(leaveByMs)}: ${task}` };
      }

      const walkGuess = Math.max(
        5,
        Math.round((leaveByMs - Date.now()) / 60_000) > 0 ? 15 : 15,
      );
      const departureMs = leaveByMs + walkGuess * 60_000;
      const { registerDepartureWatch } = await import(
        './logistics/logisticsTriggerEngine'
      );
  registerDepartureWatch({
    eventId: `depart-${leaveByMs}`,
    title: label,
    departureMs,
    walkEtaMin: walkGuess,
    mode: 'walk',
    destName: action.payload.destName ?? label,
    destLat: action.payload.destLat ?? null,
    destLng: action.payload.destLng ?? null,
    scheduleOsPush: true,
    // Explizite User-Erinnerung = hohe Prio
    warnLeadMin: 30,
    planPriority: 2,
  });
      // OS-Push kommt aus registerDepartureWatch (modusgerecht, kein Flug-Text)
      useFinnusStore.getState().setActiveConciergeCard(null);
      try {
        const voice = await getVoiceSettingsForTour();
        void speakAssistantText(
          `Alles klar — ich erinnere dich spätestens um ${formatClockDe(leaveByMs)}, damit du pünktlich loskommst.`,
          { voiceId: voice.voiceId, speechRate: voice.speechRate },
        );
      } catch {
        /* ignore */
      }
      return { ok: true };
    }

    default:
      return { ok: false, message: 'Unbekannte Aktion.' };
  }
}

export async function maybeRunActionAutoFollowUp(
  action: QuickAction,
): Promise<void> {
  if (action.type !== 'START_NAVIGATION') return;
  if (action.payload.autoFollowUp !== 'reservation') return;
  const poiId = await resolvePoiId(action.payload.targetPoiId);
  if (poiId == null) return;
  await presentAutoReservationFollowUp(poiId);
}

export function dismissConciergeCard(): void {
  void import('../module2/speech/speechQueue')
    .then(({ stopVoiceOnUserTap }) => stopVoiceOnUserTap())
    .catch(() => undefined);
  const store = useFinnusStore.getState();
  store.setActiveConciergeCard(null);
  store.setPendingAffiliateOffer(null);
}

export function alertActionError(message: string): void {
  Alert.alert('Yorro', message);
}
