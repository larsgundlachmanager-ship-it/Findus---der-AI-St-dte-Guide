/**
 * Venue-Walk-By Pitch — stadt-agnostisch.
 * User läuft an Arena/Theater/Konzerthalle/Stadion vorbei →
 * belegtes Programm HEUTE/HEUTE ABEND + Ticket-Button (Reservix/ADticket bevorzugt).
 * Keine Venue-Hardcodes; Orte per Places Nearby.
 */

import { haversineMeters } from '../../db/database';
import { useFinnusStore } from '../../store/useFinnusStore';
import { getCachedUserProfile } from '../userProfileService';
import { canSpeakExploreEvent } from '../navigation/modulePriorityPolicy';
import { allowProactiveVoice } from '../ui/nachtruhePolicy';
import {
  formatTemporaryLiveSpeech,
  isUpcomingForUnsolicitedPitch,
} from '../speech/laterPlanSpeech';
import {
  buildEventOfferKey,
  canEventPitch,
  eventPitchQuotaExhausted,
  loadEventPitchMemory,
  noteEventPitchSpoken,
  softSkipTagsForUser,
} from './eventPitchMemory';
import { spotFitsUserAudience } from './eventAudienceFit';
import {
  classifyVenueOfferKind,
  discoverVenueOffers,
} from './venueOfferDiscovery';
import type { DiscoveredPlace } from '../navigation/googleMapsNav';

/** Annäherung an große Venues — enger als Stadt-Ambient (~5 km). */
export const VENUE_WALKBY_RADIUS_M = 420;

/** Places-Typen für Live-Event-Venues (Google Places New). */
const WALKBY_PLACE_TYPES = [
  'stadium',
  'performing_arts_theater',
  'concert_hall',
] as const;

/** GPS-Throttle: keine Places-Spam bei jedem Tick. */
const SCAN_MIN_INTERVAL_MS = 75_000;
const SCAN_MIN_MOVE_M = 55;

let walkByInFlight = false;
const pitchedVenueKeys = new Set<string>();
let lastScanAtMs = 0;
let lastScanLat: number | null = null;
let lastScanLng: number | null = null;

function venueKey(name: string, lat: number, lng: number): string {
  return `${name.trim().toLowerCase().slice(0, 48)}:${lat.toFixed(3)}:${lng.toFixed(3)}`;
}

function isLiveVenuePlace(p: DiscoveredPlace): boolean {
  const blob = `${p.name} ${(p.types || []).join(' ')}`;
  const kind = classifyVenueOfferKind(blob);
  if (kind === 'theater' || kind === 'concert_hall') return true;
  return /\b(stadium|arena|theater|theatre|concert_hall|performing_arts)\b/i.test(
    blob,
  );
}

function shouldScanHere(lat: number, lng: number, now: number): boolean {
  if (lastScanLat == null || lastScanLng == null) return true;
  const moved = haversineMeters(lastScanLat, lastScanLng, lat, lng);
  if (moved >= SCAN_MIN_MOVE_M) return true;
  return now - lastScanAtMs >= SCAN_MIN_INTERVAL_MS;
}

async function findNearbyLiveVenues(
  lat: number,
  lng: number,
  radiusM: number,
): Promise<DiscoveredPlace[]> {
  const out: DiscoveredPlace[] = [];
  const seen = new Set<string>();

  try {
    const { searchPlacesNearbyForType, searchPlacesByText } = await import(
      '../navigation/googleMapsNav'
    );
    for (const t of WALKBY_PLACE_TYPES) {
      const places = await searchPlacesNearbyForType({
        lat,
        lng,
        radiusM,
        includedType: t,
      });
      for (const p of places) {
        if (!isLiveVenuePlace(p)) continue;
        if (p.distanceM > radiusM) continue;
        const id = p.placeId || `${p.name}:${p.lat}`;
        if (seen.has(id)) continue;
        seen.add(id);
        out.push(p);
      }
    }
    if (out.length) {
      return out.sort((a, b) => a.distanceM - b.distanceM);
    }
    const hits = await searchPlacesByText({
      query: 'Arena OR Stadion OR Theater OR Konzerthalle OR Oper',
      lat,
      lng,
      radiusM: Math.max(radiusM, 800),
    });
    for (const p of hits) {
      if (!isLiveVenuePlace(p)) continue;
      const d = p.distanceM || haversineMeters(lat, lng, p.lat, p.lng);
      if (d > radiusM) continue;
      const id = p.placeId || `${p.name}:${p.lat}`;
      if (seen.has(id)) continue;
      seen.add(id);
      out.push({ ...p, distanceM: Math.round(d) });
    }
  } catch {
    /* soft */
  }

  return out.sort((a, b) => a.distanceM - b.distanceM);
}

function pickTonightOffer(
  offers: Array<{
    title: string;
    whenLabel: string | null;
    summary: string;
    ticketUrl: string | null;
    type: string;
  }>,
): {
  title: string;
  whenLabel: string;
  summary: string;
  ticketUrl: string | null;
} | null {
  const now = new Date();
  for (const o of offers) {
    const when = (o.whenLabel || '').trim() || 'heute';
    const blob = `${when} ${o.title} ${o.summary}`;
    if (
      !isUpcomingForUnsolicitedPitch(blob, now, {
        kindHint: /kids|familie|kinder/i.test(blob) ? 'kids' : 'culture',
      })
    ) {
      continue;
    }
    const looksToday =
      /\b(heute|heute\s+abend|abend|tonight|\d{1,2}\s*[:.]\s*\d{2}|\d{1,2}\s*uhr)\b/iu.test(
        blob,
      ) || Boolean(o.ticketUrl);
    if (!looksToday) continue;
    return {
      title: o.title,
      whenLabel: when,
      summary: o.summary,
      ticketUrl: o.ticketUrl,
    };
  }
  return null;
}

/**
 * Wenn User nahe einer Live-Venue ist: Programm pitchen (max. 1 / 2 h,
 * teilt Quota mit Ambient).
 * @returns true wenn gesprochen (Ambient soll dann nicht nochmal pitchen).
 */
export async function tryVenueWalkByPitch(opts: {
  lat: number;
  lng: number;
  now?: number;
}): Promise<boolean> {
  const now = opts.now ?? Date.now();
  if (walkByInFlight) return false;
  if (!allowProactiveVoice(now)) return false;

  const s = useFinnusStore.getState();
  // Live-Nav: kein Arena/Stadion-Places-Poll (Lag + Log-Spam).
  if (s.navActive) return false;
  const card = s.activeConciergeCard;
  const cardBusy = Boolean(
    card &&
      ((card.visualBullets?.length ?? 0) > 0 ||
        (card.quickActions?.length ?? 0) > 0),
  );
  if (
    s.isPlayingAudio ||
    s.isAudiblySpeaking ||
    s.isListening ||
    s.isGenerating ||
    cardBusy
  ) {
    return false;
  }

  // 'other' — Walk-By ist kein Hauptort (Open-Quiet + 60s nach M2 bleiben)
  const speakGate = canSpeakExploreEvent('other', undefined, now);
  if (!speakGate.ok) return false;

  const profile = getCachedUserProfile();
  if (!profile?.setupComplete) return false;

  try {
    const { isProactiveAlertEnabled } = require('../notifications/proactiveAlerts') as {
      isProactiveAlertEnabled: (k: 'ambientEvents') => boolean;
    };
    if (!isProactiveAlertEnabled('ambientEvents')) return false;
  } catch {
    /* soft — allow */
  }

  let memory;
  try {
    memory = await loadEventPitchMemory();
  } catch {
    memory = null;
  }
  if (eventPitchQuotaExhausted(memory, now)) {
    return false;
  }

  if (!shouldScanHere(opts.lat, opts.lng, now)) return false;

  walkByInFlight = true;
  lastScanAtMs = now;
  lastScanLat = opts.lat;
  lastScanLng = opts.lng;

  const emptyMemory = {
    softSkipTags: [] as string[],
    softLikeTags: [] as string[],
    recentPitchTags: [] as string[],
    recentPitches: [],
    lastPitchAtMs: null as number | null,
    lastPitchName: null as string | null,
  };

  try {
    const venues = await findNearbyLiveVenues(
      opts.lat,
      opts.lng,
      VENUE_WALKBY_RADIUS_M,
    );
    if (!venues.length) return false;

    const city =
      profile.cityName?.trim() || profile.cityId?.trim() || null;
    const softSkip = softSkipTagsForUser(memory ?? emptyMemory, profile);

    for (const venue of venues) {
      const key = venueKey(venue.name, venue.lat, venue.lng);
      if (pitchedVenueKeys.has(key)) continue;

      const discovery = await discoverVenueOffers({
        subject: venue.name,
        city,
        userText: `Was läuft heute oder heute Abend in ${venue.name}? Tickets?`,
        websiteUrl: venue.websiteUri ?? null,
      });
      if (!discovery?.offers?.length) continue;

      const offer = pickTonightOffer(discovery.offers);
      if (!offer) continue;

      const offerKey = buildEventOfferKey({
        venueName: venue.name,
        whenLabel: offer.whenLabel,
        titleOrHook: offer.title,
      });
      if (
        !canEventPitch(memory, now, {
          venueName: venue.name,
          offerKey,
        }).ok
      ) {
        continue;
      }

      const hookFacts = [offer.title, offer.summary, offer.whenLabel]
        .filter(Boolean)
        .join(' — ');
      if (
        !spotFitsUserAudience(
          {
            name: venue.name,
            kindHint: 'culture',
            hook: hookFacts,
            audienceTags: ['culture', 'venue_walkby'],
          },
          {
            age: profile.age ?? 30,
            travelParty: profile.travelParty ?? null,
            nightlifeOk: Boolean(profile.mustHaveStyles?.includes('nightlife')),
            aboutMe: profile.aboutMe?.trim() || null,
            softSkipTags: softSkip,
          },
        )
      ) {
        continue;
      }

      // Fakten für Speech-Formatter — Wortlaut bleibt dynamisch (kein Venue-Script).
      const hook = [
        `${venue.name}: ${offer.title}`,
        offer.whenLabel ? `(${offer.whenLabel})` : '',
        offer.summary ? `— ${offer.summary}` : '',
      ]
        .filter(Boolean)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 280);

      const speechBlob = `${offer.title} ${offer.summary} ${offer.whenLabel}`;
      const priceFromOffer =
        speechBlob.match(
          /\b(?:ab\s+)?(\d{1,3}(?:[.,]\d{1,2})?\s*(?:€|euro)|eintritt\s+frei|kostenlos|gratis)\b/iu,
        )?.[0] ?? null;
      const speech = formatTemporaryLiveSpeech(
        {
          name: venue.name,
          whenLabel: offer.whenLabel,
          distanceHintM: venue.distanceM,
          hook,
          priceHint: priceFromOffer,
          whyHint: offer.summary?.trim().slice(0, 120) || null,
        },
        new Date(now),
      );
      if (speech.length < 16) continue;

      let ticketUrl =
        offer.ticketUrl ||
        discovery.buttons.find((b) => b.payload.kind === 'deep_link')?.payload
          .url ||
        null;
      if (ticketUrl) {
        try {
          const { preferReservixFamilyAffiliateUrl } = await import(
            '../affiliate/reservixAffiliate'
          );
          const { normalizeAffiliateUrl } = await import(
            '../affiliate/affiliateService'
          );
          ticketUrl = preferReservixFamilyAffiliateUrl(ticketUrl);
          ticketUrl = normalizeAffiliateUrl(ticketUrl);
        } catch {
          /* soft */
        }
      }

      const { speakAssistantText, getVoiceSettingsForTour } = await import(
        '../ttsService'
      );
      const voice = await getVoiceSettingsForTour();

      try {
        const { wrapPlainAsConcierge } = await import(
          '../concierge/parseConciergeResponse'
        );
        const { toConciergeCardState } = await import(
          '../concierge/presentConcierge'
        );
        const { buildReservixAction } = await import(
          '../affiliate/reservixAffiliate'
        );
        const actions: Array<{
          type: 'OPEN_URL' | 'SHOW_MORE';
          label: string;
          payload: { url?: string; textPrompt?: string };
        }> = [];
        if (ticketUrl && /^https?:\/\//i.test(ticketUrl)) {
          actions.push({
            type: 'OPEN_URL',
            label: '🎫 Tickets',
            payload: { url: ticketUrl },
          });
        } else {
          actions.push(
            buildReservixAction({
              cityOrQuery: `${venue.name} ${city || ''}`.trim(),
              label: '🎫 Events & Tickets',
            }),
          );
        }
        actions.push({
          type: 'SHOW_MORE',
          label: 'Mehr dazu',
          payload: {
            textPrompt: `Erzähl mehr zum Programm bei ${venue.name}${offer.title ? `: ${offer.title}` : ''} — Uhrzeit, Eintritt, Tickets.`,
          },
        });
        useFinnusStore.getState().setActiveConciergeCard(
          toConciergeCardState(
            wrapPlainAsConcierge(speech, {
              cardTitle: venue.name.slice(0, 40),
              visualBullets: [
                offer.title.slice(0, 60),
                offer.whenLabel.slice(0, 40),
                venue.distanceM <= 200
                  ? 'direkt hier'
                  : `~${venue.distanceM} m`,
              ].filter(Boolean),
              quickActions: actions,
            }),
          ),
        );
      } catch {
        /* soft — speech alone */
      }

      await speakAssistantText(speech, {
        voiceId: voice.voiceId,
        speechRate: voice.speechRate,
      });

      pitchedVenueKeys.add(key);
      await noteEventPitchSpoken({
        name: venue.name,
        kindHint: 'culture',
        whenLabel: offer.whenLabel,
        distanceHintM: venue.distanceM,
        hook,
        sourceUrl: ticketUrl,
        audienceTags: ['culture', 'venue_walkby'],
        offerKey,
      });
      return true;
    }

    return false;
  } catch (err) {
    if (__DEV__) console.warn('[venueWalkByPitch]', err);
    return false;
  } finally {
    walkByInFlight = false;
  }
}

/**
 * GPS-Tick: nahe Live-Venue → ggf. Programm pitchen.
 * Kein 10-Min-App-offen-Gate (anders als Stadt-Ambient).
 */
export async function tickVenueWalkByPitch(
  lat: number,
  lng: number,
): Promise<boolean> {
  return tryVenueWalkByPitch({ lat, lng });
}

export function __resetVenueWalkByPitchForTests(): void {
  walkByInFlight = false;
  pitchedVenueKeys.clear();
  lastScanAtMs = 0;
  lastScanLat = null;
  lastScanLng = null;
}
