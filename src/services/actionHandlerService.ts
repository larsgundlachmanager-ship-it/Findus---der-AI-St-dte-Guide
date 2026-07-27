/**
 * Native Quick-Actions: Navigation, tel:, URLs, Reservierung, Follow-up.
 */

import { Linking, Alert } from 'react-native';
import type { QuickAction } from '../types/concierge';
import type { ReservationTier } from '../types/reservation';
import { getAllPois, getFactsForPoi } from '../db/database';
import { startNavigation } from './navigation';
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
  openUberRide,
} from './affiliate/affiliateService';
import { confirmAffiliateRedirectIfNeeded } from './affiliate/affiliateDisclosure';
import { isPartnerAffiliateAction } from '../constants/legal';
import { isCityMapUrl, openCityMap } from './cityMapService';

export type ActionHandlerResult = {
  ok: boolean;
  /** Optional: Follow-up-Frage an Voice-Pipeline */
  followUpPrompt?: string;
  message?: string;
};

export async function resolvePoiId(
  target: string | number | undefined,
): Promise<number | null> {
  if (target == null) return null;
  if (typeof target === 'number' && Number.isFinite(target)) return target;
  const s = String(target).trim();
  if (/^\d+$/.test(s)) return Number(s);

  const pois = await getAllPois();
  const lower = s.toLowerCase();
  const bySpot = pois.find(
    (p) => (p.spot_key ?? '').toLowerCase() === lower,
  );
  if (bySpot) return bySpot.id;

  const byName = pois.find((p) =>
    p.name.toLowerCase().includes(lower.replace(/_/g, ' ')),
  );
  if (byName) return byName.id;

  const tokens = lower
    .replace(/[()[\].,]/g, ' ')
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 4);
  if (tokens.length > 0) {
    let bestId: number | null = null;
    let bestScore = 0;
    for (const poi of pois) {
      const blob = `${poi.name} ${poi.spot_key ?? ''} ${poi.category ?? ''}`.toLowerCase();
      let score = 0;
      for (const tok of tokens) {
        if (blob.includes(tok)) score += 12;
      }
      if (/\bortskern\b/.test(lower) && /\b(dorf|zedelius|platz)\b/.test(blob)) {
        score += 20;
      }
      if (/\bparty\b/.test(lower) && /\b(bar|kneip|zedelius)\b/.test(blob)) {
        score += 15;
      }
      if (score > bestScore) {
        bestScore = score;
        bestId = poi.id;
      }
    }
    if (bestId != null && bestScore >= 12) return bestId;
  }

  return null;
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

export async function handleQuickAction(
  action: QuickAction,
): Promise<ActionHandlerResult> {
  if (isPartnerAffiliateAction(action)) {
    const proceed = await confirmAffiliateRedirectIfNeeded();
    if (!proceed) {
      return { ok: false };
    }
  }

  switch (action.type) {
    case 'START_NAVIGATION': {
      const poiId = await resolvePoiId(action.payload.targetPoiId);
      if (poiId == null) {
        return {
          ok: false,
          message: 'Dazu finde ich gerade keinen Ort für die Navigation.',
        };
      }
      const ok = await startNavigation(poiId);
      return {
        ok,
        message: ok
          ? undefined
          : 'Navigation startet gerade nicht — gleich nochmal versuchen.',
      };
    }

    case 'DIAL_PHONE': {
      const raw = (action.payload.phoneNumber ?? '').replace(/[^\d+]/g, '');
      if (!raw || raw.length < 6) {
        return { ok: false, message: 'Keine gültige Telefonnummer.' };
      }
      const url = `tel:${raw}`;
      const can = await Linking.canOpenURL(url);
      if (!can) {
        return {
          ok: false,
          message: 'Anrufe sind auf diesem Gerät nicht möglich.',
        };
      }
      await Linking.openURL(url);
      return { ok: true };
    }

    case 'OPEN_URL': {
      let url = (action.payload.url ?? '').trim();
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
      if (!url) return { ok: false, message: 'Kein Link hinterlegt.' };
      if (!/^https?:\/\//i.test(url)) {
        if (/musement|tui/i.test(url)) {
          url = getMusementBookingUrl(url);
        } else if (/viator|tripadvisor/i.test(url)) {
          url = getViatorBookingUrl(url);
        } else if (/economybookings|mietwagen|rental/i.test(url)) {
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
      // Spotify-App-Deep-Link → Browser-Fallback, wenn App fehlt
      if (/^spotify:/i.test(url)) {
        const q = url.replace(/^spotify:search:/i, '').trim();
        url = q
          ? `https://open.spotify.com/search/${encodeURIComponent(decodeURIComponent(q))}`
          : 'https://open.spotify.com/search/playlist';
      }
      try {
        await Linking.openURL(url);
        return { ok: true };
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
      const ok = await openStay22Accommodation(dest);
      return {
        ok,
        message: ok
          ? undefined
          : 'Unterkunftssuche lässt sich gerade nicht öffnen — versuch es gleich nochmal.',
      };
    }

    case 'CONFIRM_API_RESERVATION':
      return reservationFromAction(action, 'API');

    case 'SEND_RESERVATION_EMAIL':
      return reservationFromAction(action, 'EMAIL');

    case 'TRIGGER_AI_CALL':
      return reservationFromAction(action, 'AI_CALL');

    case 'SHOW_MORE': {
      const prompt =
        action.payload.textPrompt?.trim() ||
        'Erzähl mir bitte etwas mehr dazu.';
      return { ok: true, followUpPrompt: prompt };
    }

    default:
      return { ok: false, message: 'Unbekannte Aktion.' };
  }
}

export function dismissConciergeCard(): void {
  const store = useFinnusStore.getState();
  store.setActiveConciergeCard(null);
  store.setPendingAffiliateOffer(null);
}

export function alertActionError(message: string): void {
  Alert.alert('Findus', message);
}
