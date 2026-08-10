/**
 * Tourist friction — toilets, ATM, water, WiFi, hours, right-way, tickets.
 * Prefers contextual discovery; short practical answers + buttons.
 */

import type { QuickAction } from '../../types/concierge';
import { shortenActionLabel } from '../concierge/actionLabelShorten';
import { useFinnusStore } from '../../store/useFinnusStore';
import {
  detectDiscoveryIntent,
  presentDiscoveryAsConcierge,
  runContextualDiscovery,
} from '../navigation/contextualDiscovery';
import {
  getActiveNavDestination,
  getDeviceHeadingDeg,
  getMovementBearingDeg,
} from '../navigation/navigationService';
import { bearingDegrees, shortestAngleDelta } from '../navigation/bearing';
import { getTrackMovementBearingDeg } from '../navigation/gpsTrackBuffer';
import { getCachedUserProfile } from '../userProfileService';

const RIGHT_WAY_RE =
  /\b(richtige\s+richtung|richtig\s+unterwegs|gehe?\s+ich\s+richtig|bin\s+ich\s+richtig|stimmt\s+die\s+richtung|auf\s+dem\s+richtigen\s+weg|am\s+i\s+going\s+the\s+right\s+way)\b/iu;

const WIFI_RE =
  /\b(wlan|wifi|wi-?fi|internet\s+(frei|zugang)|kostenlos(?:es)?\s+internet)\b/iu;

const WATER_RE =
  /\b(trinkwasser|wasserhahn|trinkbrunnen|wasser\s+auffüll|flasche\s+füllen|flasche\s+fuellen)\b/iu;

const HOURS_RE =
  /\b(öffnungszeit|oeffnungszeit|wann\s+(hat|habt|habt\s+ihr|hat\s+.*\s+auf)|hat\s+.*\s+(heute\s+)?auf|geöffnet|geoeffnet|bis\s+wann\s+auf)\b/iu;

const TICKET_RE =
  /\b(ticket|tickets|eintritt|eintrittskarte|fahrkarte|kurkarte)\b/iu;

export function detectRightWayIntent(text: string): boolean {
  return RIGHT_WAY_RE.test(text.replace(/\s+/g, ' ').trim());
}

export function detectTouristFrictionKind(
  text: string,
): 'wifi' | 'water' | 'hours' | 'tickets' | 'right_way' | null {
  const t = text.replace(/\s+/g, ' ').trim();
  if (!t) return null;
  if (detectRightWayIntent(t)) return 'right_way';
  if (WIFI_RE.test(t)) return 'wifi';
  if (WATER_RE.test(t)) return 'water';
  if (TICKET_RE.test(t) && /\b(wo|kauf|brauch|gibt|wie\s+teuer|online)\b/iu.test(t)) {
    return 'tickets';
  }
  if (HOURS_RE.test(t)) return 'hours';
  return null;
}

function handleRightWay(): { handled: boolean; reply?: string } {
  const store = useFinnusStore.getState();
  const dest = getActiveNavDestination();
  if (!store.navActive || !dest) {
    const speech =
      'Gerade läuft keine Navigation. Sag mir ein Ziel — dann check ich die Richtung.';
    useFinnusStore.getState().setActiveConciergeCard({
      id: `friction-${Date.now()}`,
      createdAtMs: Date.now(),
      cardTitle: 'Richtung',
      speechText: speech,
      visualBullets: ['Keine aktive Route'],
      quickActions: [],
    });
    return { handled: true, reply: speech };
  }

  const lat = store.lastGpsLat;
  const lng = store.lastGpsLng;
  if (lat == null || lng == null) {
    const speech =
      `Ziel ist ${dest.name}. GPS kurz an, dann sag ich dir ob du richtig gehst.`;
    return { handled: true, reply: speech };
  }

  const toDest = bearingDegrees(lat, lng, dest.lat, dest.lng);
  const move =
    getTrackMovementBearingDeg() ??
    getMovementBearingDeg() ??
    getDeviceHeadingDeg();
  let speech: string;
  const bullets: string[] = [`Ziel: ${dest.name}`];
  if (move == null || !Number.isFinite(move)) {
    speech = `Dein Ziel ist ${dest.name}. Beweg dich ein paar Schritte, dann prüfe ich die Richtung.`;
  } else {
    const delta = Math.abs(shortestAngleDelta(move, toDest));
    if (delta <= 45) {
      speech = `Ja — du gehst grob Richtung ${dest.name}. Weiter so.`;
      bullets.push('Richtung passt');
    } else if (delta >= 135) {
      speech = `Du läufst eher vom Ziel weg. Dreh dich um — ${dest.name} liegt hinter dir.`;
      bullets.push('Fast entgegengesetzt');
    } else {
      const side =
        shortestAngleDelta(move, toDest) > 0 ? 'rechts' : 'links';
      speech = `Fast — etwas nach ${side} korrigieren, dann passt's Richtung ${dest.name}.`;
      bullets.push(`Korrektur nach ${side}`);
    }
  }

  const actions: QuickAction[] = [
    {
      type: 'START_NAVIGATION',
      label: shortenActionLabel(`📍 ${dest.name}`),
      payload: {
        destName: dest.name,
        destLat: dest.lat,
        destLng: dest.lng,
        targetPoiId: dest.poiId,
      },
    },
  ];

  useFinnusStore.getState().setActiveConciergeCard({
    id: `friction-${Date.now()}`,
    createdAtMs: Date.now(),
    cardTitle: 'Richtung',
    speechText: speech,
    visualBullets: bullets,
    quickActions: actions,
  });
  return { handled: true, reply: speech };
}

/**
 * Handle friction intents that are discovery-backed or direction checks.
 * Hours/tickets fall through to concierge (web research) with prompt hints.
 */
export async function handleTouristFrictionIntent(
  text: string,
  origin: { lat: number; lng: number } | null,
): Promise<{ handled: boolean; reply?: string; fallThrough?: boolean }> {
  const kind = detectTouristFrictionKind(text);
  if (!kind) {
    // Still allow classic discovery (toilet/atm/…) if keyword matched there
    return { handled: false };
  }

  if (kind === 'right_way') {
    return handleRightWay();
  }

  if (kind === 'hours' || kind === 'tickets') {
    // Concierge + web research owns these; mark for prompt enrichment only
    return { handled: false, fallThrough: true };
  }

  if (!origin) {
    return {
      handled: true,
      reply:
        kind === 'wifi'
          ? 'GPS an — dann such ich WLAN in der Nähe (Café/Info).'
          : 'GPS an — dann such ich einen Trinkwasser-Punkt.',
    };
  }

  const placeType = kind === 'wifi' ? 'wifi' : 'drinking_water';
  const label = kind === 'wifi' ? 'WLAN' : 'Trinkwasser';
  const result = await runContextualDiscovery({
    placeType,
    label,
    origin,
    headingDeg: getDeviceHeadingDeg(),
    movementBearingDeg: getMovementBearingDeg(),
    emergency: false,
  });
  presentDiscoveryAsConcierge(result);
  return { handled: true, reply: result.speech };
}

/** Also run when detectDiscoveryIntent already matched toilet/atm/etc. — no-op helper for policy. */
export function touristFrictionPromptHint(text: string): string | null {
  const kind = detectTouristFrictionKind(text);
  const discovery = detectDiscoveryIntent(text);
  if (!kind && !discovery) {
    if (
      /\b(toilette|klo|wc|geldautomat|atm|öffnungszeit|ticket|wlan|wifi)\b/iu.test(
        text,
      )
    ) {
      // covered by broader policy block
    } else {
      return null;
    }
  }
  const city = getCachedUserProfile()?.cityName ?? 'vor Ort';
  return [
    '=== TOURIST-FRICTION (kurz & praktisch) ===',
    `Stadt-Kontext: ${city}.`,
    'Toilette/ATM/Wasser/WLAN/Akku: konkrete nächste Option + Route-Button — keine Essays.',
    'Akku: Powerbank-Automat bevorzugt, sonst Steckdose/Café — Just-Do-It mit Route.',
    'Öffnungszeiten: nur belegte Zeiten, sonst ehrlich „weiß ich nicht sicher“ + Link.',
    'Tickets: Kauf-Link / Partner wenn möglich (OPEN_URL), sonst ehrlicher Hinweis.',
    '„Richtige Richtung?“: Bezug zur aktiven Navigation, sonst Ziel erfragen.',
  ].join('\n');
}
