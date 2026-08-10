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
import { resolveExistingPoiId } from './navigation/resolveNavTarget';
import { useShoppingTaskStore } from '../store/useShoppingTaskStore';
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
};

/** Feste Ansagen beim Öffnen von Maps / Speisekarte (SSOT). */
export const OPEN_GOOGLE_MAPS_SPEECH = 'Google Maps wird geöffnet.';
export const OPEN_SPEISEKARTE_SPEECH = 'Die hier ist die Speisekarte.';

function isGoogleMapsOpenUrl(url: string): boolean {
  return /google\.[^/]*\/maps|maps\.google|maps\.app\.goo\.gl|goo\.gl\/maps|^geo:/i.test(
    url,
  );
}

function isSpeisekarteOpenUrl(url: string, label: string): boolean {
  const blob = `${url} ${label}`;
  if (/🍽|\bspeisekarte\b/i.test(label)) return true;
  if (/google\.[^/]+\/search/i.test(url) && /speisekarte/i.test(url)) {
    return true;
  }
  return /speisekarte|speise-?karte|food[\-_]?menu|menükarte|menuekarte|menukarte|\/menu\b|\/menue\b|\/menü|speisen\.pdf/i.test(
    blob,
  );
}

function speechForOpenUrl(url: string, label: string): string | null {
  if (isGoogleMapsOpenUrl(url)) return OPEN_GOOGLE_MAPS_SPEECH;
  if (isSpeisekarteOpenUrl(url, label)) return OPEN_SPEISEKARTE_SPEECH;
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
    speechWasActive = isSpeechActive();
    // Maps/Speisekarte während Pitch: Speech weiterlaufen lassen
    if (!isOpenUrl) {
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
        });
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
        { skipClosingGate: action.payload.skipClosingGate === true,
          offlineOnly: action.payload.offlineOnly === true,
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
        return {
          ok: false,
          message: 'Link wird noch gesucht — einen Moment…',
        };
      }
      let url = (action.payload.url ?? '').trim();
      if (/findus\.local\/pending/i.test(url)) {
        return {
          ok: false,
          message: 'Link wird noch gesucht — einen Moment…',
        };
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
        // Reservieren ohne URL → Deep-Research-Flow statt stillem Fail
        if (/\b(tisch|reserv)/i.test(action.label)) {
          return handleTableReservationTap(action, action.label);
        }
        return { ok: false, message: 'Kein Link hinterlegt.' };
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
        // Nur ansagen wenn gerade nichts gesprochen wird
        if (!speechWasActive) {
          announceOpenUrlSpeech(OPEN_GOOGLE_MAPS_SPEECH);
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
          const geo = `geo:${lat},${lng}?q=${lat},${lng}(${encodeURIComponent(label.slice(0, 60))})`;
          try {
            await openExternalUrl(geo);
            return { ok: true, message: OPEN_GOOGLE_MAPS_SPEECH };
          } catch {
            /* https fallback */
          }
        }
        try {
          await openExternalUrl(url);
          return { ok: true, message: OPEN_GOOGLE_MAPS_SPEECH };
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
      try {
        const openSpeech = speechForOpenUrl(url, action.label);
        if (openSpeech && !speechWasActive) {
          announceOpenUrlSpeech(openSpeech);
        }
        await openExternalUrl(url);
        return {
          ok: true,
          message: openSpeech ?? 'Ich öffne den Link.',
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

      if (
        lat == null ||
        lng == null ||
        !Number.isFinite(lat) ||
        !Number.isFinite(lng)
      ) {
        return {
          ok: false,
          message: 'Für Uber brauche ich noch die Ziel-Koordinaten.',
        };
      }

      const ok = await openUberRide(lat, lng, name || 'Ziel');
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
          ? undefined
          : 'Uber lässt sich gerade nicht öffnen — versuch den Link gleich nochmal.',
      };
    }

    case 'BOOK_CAR_RENTAL': {
      const ok = await openCarRental();
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
      const ok = await openStay22Accommodation(dest, {
        url: directUrl,
        checkin: action.payload.checkin,
        checkout: action.payload.checkout,
        adults: action.payload.adults,
      });
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
        });
        useFinnusStore.getState().setActiveConciergeCard(null);
        return {
          ok: result.ok,
          message: result.ok ? result.reply : result.reply,
        };
      }
      const prompt =
        action.payload.textPrompt?.trim() ||
        'Erzähl mir bitte etwas mehr dazu.';

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
          ? `Wecker auf ${formatClockDe(wakeAtMs)} gestellt.`
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
        const { fetchStreetViewImageBase64 } = await import(
          './navigation/googleMapsNav'
        );
        const heading =
          typeof action.payload.headingDeg === 'number' &&
          Number.isFinite(action.payload.headingDeg)
            ? action.payload.headingDeg
            : 0;
        // Lazy: Bild erst jetzt laden (kein Prefetch)
        const b64 = await fetchStreetViewImageBase64(lat, lng, heading);
        if (b64) {
          useFinnusStore.getState().setCityMap({
            url: `data:image/jpeg;base64,${b64}`,
            title: action.payload.destName?.trim() || 'Street View',
          });
          return { ok: true };
        }
        const { Linking } = await import('react-native');
        announceOpenUrlSpeech(OPEN_GOOGLE_MAPS_SPEECH);
        await openExternalUrl(
          `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${lat},${lng}`,
        );
        return { ok: true, message: OPEN_GOOGLE_MAPS_SPEECH };
      } catch (err) {
        console.warn('[action] street view failed', err);
        return { ok: false, message: 'Street View ließ sich nicht laden.' };
      }
    }

    case 'SET_DEPARTURE_REMINDER': {
      const leaveByMs = action.payload.dateIso
        ? Date.parse(action.payload.dateIso)
        : NaN;
      if (!Number.isFinite(leaveByMs) || leaveByMs < Date.now() + 20_000) {
        return {
          ok: false,
          message: 'Die Erinnerungs-Zeit liegt zu nah oder fehlt.',
        };
      }
      const label =
        action.payload.destName?.trim() ||
        action.payload.textPrompt?.trim() ||
        'dein Termin';
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
  Alert.alert('Findus', message);
}
