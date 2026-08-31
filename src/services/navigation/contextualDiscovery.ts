/**
 * Contextual place discovery: open-now POIs ahead of movement,
 * rating gates, detour insertion for active routes.
 */

import { useFinnusStore } from '../../store/useFinnusStore';
import { bearingDegrees, distanceMeters } from './bearing';
import {
  fetchRouteDirections,
  looksLikeOfficeOnlyPlace,
  type DiscoveredPlace,
} from './googleMapsNav';
import {
  estimateTravelEtaRouted,
  formatWalkBikeEtaSpeech,
} from './travelEta';
import {
  searchPlacesExpanding,
  PLACE_FAR_SPEECH_M,
  PLACE_EXPAND_RINGS_M,
} from './expandingPlaceSearch';
import { isAheadOfMovement } from './spatialOrientation';
import {
  getActiveNavDestination,
  startNavigationToCoords,
} from './navigationService';
import {
  insertTourStop,
  weaveSpontaneousStop,
  hasActiveTourQueue,
  ensureTourFromActiveNav,
  type TourStop,
} from './multiStopTour';
import { checkClosingTimeGate } from './closingTimeGate';
import { stopSpeaking, speakAssistantText } from '../ttsService';
import type { QuickAction } from '../../types/concierge';
import { buildEmpathyDiscoveryOverlay } from '../persona/empathyEngine';
import { shortenActionLabel } from '../concierge/actionLabelShorten';
import { getCachedUserProfile } from '../userProfileService';
import {
  expandThenOnlineSpeechPrefix,
  runWishOnlineResearch,
  webResearchToActions,
} from '../research/webResearchService';
import { runPhoneChargeDiscovery } from './phoneChargeDiscovery';

/** Detour ≤ this → auto-insert without asking. */
export const AUTO_INSERT_DETOUR_M = 250;
/** Rating below this → voice confirmation. */
export const LOW_RATING_THRESHOLD = 3.8;

export type DiscoveryCandidate = {
  placeId: string;
  name: string;
  lat: number;
  lng: number;
  distanceM: number;
  /** Distance ahead along walking path, if known. */
  aheadM: number;
  rating: number | null;
  openNow: boolean;
  types: string[];
  /** True if rating < LOW_RATING_THRESHOLD. */
  lowRated: boolean;
  /** Detour meters if a route is already active (null if free-roam). */
  detourM: number | null;
  /** Nationale/internationale Tel. wenn aus Places bekannt. */
  phoneNumber?: string | null;
  /** Website für Öffnungs-/Urlaub-Check */
  websiteUri?: string | null;
};

export type DiscoveryResult = {
  queryLabel: string;
  candidates: DiscoveryCandidate[];
  /** German speech prompt. */
  speech: string;
  /** Fast-click chips for Concierge UI. */
  quickActions: QuickAction[];
  /** Optional: 1:1 zu Speech (z. B. Handy-laden). Sonst aus candidates abgeleitet. */
  visualBullets?: string[];
  /** When true, user must confirm (low rating or large detour). */
  needsConfirmation: boolean;
  /** Auto-inserted stop (detour ≤ 250 m) — already navigated. */
  autoInserted: boolean;
};

const PLACE_QUERY_MAP: Array<{ re: RegExp; type: string; label: string }> = [
  {
    re: /\b(durst|durstig|wasser|trinken|getränk|getraenk|etwas\s+zu\s+trinken|was\s+zu\s+trinken|durst\s+löschen|erfrisch)\b/iu,
    type: 'convenience_store',
    label: 'Getränke',
  },
  { re: /\b(bäckerei|baeckerei|bäcker|baecker|bakery|brötchen|brot)\b/iu, type: 'bakery', label: 'Bäckerei' },
  {
    re: /\b(powerbank|power\s*bank|ladeautomat|ladestation|steckdose|handyakku|handy\s*laden|akku\s*(laden|leer|schwach)|usb[-\s]?laden)\b/iu,
    type: 'phone_charge',
    label: 'Handy laden',
  },
  { re: /\b(café|cafe|kaffee|coffee)\b/iu, type: 'cafe', label: 'Café' },
  { re: /\b(restaurant|essen|mittag|abendessen|hunger)\b/iu, type: 'restaurant', label: 'Restaurant' },
  { re: /\b(apotheke|pharmacy)\b/iu, type: 'pharmacy', label: 'Apotheke' },
  {
    re: /\b(drogerie|dm|rossmann|müller|mueller|budni|zahnbürste|zahnbuerste|zahncreme|sonnencreme)\b/iu,
    type: 'drugstore',
    label: 'Drogerie',
  },
  { re: /\b(toilette|klo|wc|bathroom|restroom)\b/iu, type: 'toilet', label: 'Toilette' },
  { re: /\b(supermarkt|einkaufen|aldi|lidl|rewe|edeka|kiosk)\b/iu, type: 'supermarket', label: 'Supermarkt' },
  { re: /\b(geldautomat|bankomat|atm|sparkasse|bank)\b/iu, type: 'atm', label: 'Geldautomat' },
  { re: /\b(tankstelle|petrol)\b/iu, type: 'gas_station', label: 'Tankstelle' },
  { re: /\b(parkplatz|parken)\b/iu, type: 'parking', label: 'Parkplatz' },
  { re: /\b(krankenhaus|hospital|notaufnahme)\b/iu, type: 'hospital', label: 'Krankenhaus' },
  { re: /\b(arzt|doctor)\b/iu, type: 'doctor', label: 'Arzt' },
  {
    re: /\b(trinkwasser|trinkbrunnen|wasser\s+auffüll|flasche\s+füll)\b/iu,
    type: 'drinking_water',
    label: 'Trinkwasser',
  },
  {
    re: /\b(wlan|wifi|wi-?fi|internet\s+café|internet\s+cafe)\b/iu,
    type: 'wifi',
    label: 'WLAN',
  },
];

const FIND_POI_RE =
  /\b(find(e|est)?|suche|wo\s+(gibt|ist|finde)|zeig\s+mir|brauch(e|st)?|benötige|ich\s+(brauch|will|möchte|muss)|navigier(?:e|en)?|führ\s+mich|fuehr\s+mich|bring\s+mich|geh(?:en)?\s+(?:wir\s+)?(?:zum|zur|zu)|durst|trinken|getränk)\b.{0,60}\b(bäck|baeck|café|cafe|kaffee|restaurant|apotheke|drogerie|dm|rossmann|toilette|klo|wc|supermarkt|geldautomat|atm|parkplatz|arzt|krankenhaus|wasser|trinken|getränk|kiosk|durst|wlan|wifi|powerbank|steckdose|akku|aufladen|ladestation)\b/iu;

const EMERGENCY_RE =
  /\b(toilette|klo|wc|notfall|dringend|sofort|muss\s+(mal|auf\s+toilette)|pipi|akku\s*(leer|schwach|fast\s*leer)|handyakku)\b/iu;

export function detectDiscoveryIntent(
  text: string,
): { type: string; label: string; emergency: boolean } | null {
  const t = text.replace(/\s+/g, ' ').trim();
  if (!t) return null;

  // Never steal multi-goal / appointment speech (LLM router owns those)
  if (
    /\b(?:pünktlich|puenktlich|verabredung|termin|vorher|außerdem|ausserdem)\b/iu.test(
      t,
    ) ||
    /\b(?:um\s+)?\d{1,2}[:.]\d{2}\b/.test(t) ||
    (/\buhr\b/iu.test(t) && /\b(?:sein|muss|möchte|moechte)\b/iu.test(t)) ||
    (/\bhotel\b/iu.test(t) &&
      /\b(?:brauch|einkauf|kaufen|spazier|herum)\b/iu.test(t))
  ) {
    return null;
  }

  const emergency = EMERGENCY_RE.test(t);
  // Named go-to („Ich möchte zu Restaurant Kreta“) ≠ open restaurant search
  // Aber „zum nächsten Bäcker“ / Kategorie ohne Eigenname → Discovery
  const categoryOnly =
    /\b(?:nächste[rn]?\s+|naheste[rn]?\s+)?(?:bäckerei|baeckerei|bäcker|baecker|bakery|café|cafe|apotheke|supermarkt|toilette|klo|drogerie|imbiss)\b/iu.test(
      t,
    ) &&
    !/\b(?:restaurant|café|cafe|bistro|bäckerei|baeckerei)\s+[A-ZÄÖÜ][\wÄÖÜäöüß\-&.']{2,}/u.test(
      t,
    );
  if (
    !categoryOnly &&
    (/\b(?:zum|zur|nach|zu|ins)\s+(?:restaurant|café|cafe|bistro|bar|imbiss)\s+\S+/iu.test(
      t,
    ) ||
      (/\b(?:ich\s+(?:will|möchte|moechte|muss)\s+(?:jetzt\s+)?(?:zum|zur|nach|zu)\s+)/iu.test(
        t,
      ) &&
        /\b[A-ZÄÖÜ][\wÄÖÜäöüß\-&.']{2,}/u.test(t)))
  ) {
    return null;
  }
  for (const row of PLACE_QUERY_MAP) {
    if (row.re.test(t)) {
      if (
        row.type === 'cafe' &&
        /\b(steckdose|powerbank|handyakku|akku\s*(laden|leer|schwach)|usb[-\s]?laden)\b/iu.test(
          t,
        )
      ) {
        continue;
      }
      if (
        !emergency &&
        row.type === 'restaurant' &&
        /\b(route|tour|frühstücks?route|essensroute)\b/iu.test(t)
      ) {
        continue;
      }
      // Named destination appointment: „im Restaurant Kreta sein“ ≠ find restaurants
      if (
        row.type === 'restaurant' &&
        /\b(?:im|ins|zum|beim)\s+restaurant\s+\w+/iu.test(t) &&
        /\b(?:sein|verabredung|termin)\b/iu.test(t)
      ) {
        continue;
      }
      if (
        FIND_POI_RE.test(t) ||
        emergency ||
        /\b(gibt\s+es|wo\s+ist|wo\s+gibt|in\s+der\s+nähe|voraus|unterwegs|navigier|nächste[rn]?)\b/iu.test(
          t,
        )
      ) {
        return { type: row.type, label: row.label, emergency };
      }
    }
  }
  return null;
}

function formatAheadCasual(m: number): string {
  if (m < 120) return 'gleich voraus';
  if (m < 350) return 'ein kurzes Stück voraus';
  if (m < 1000) return 'ein Stück voraus';
  return 'ein Stück weiter voraus';
}

function toCandidate(
  p: DiscoveredPlace,
  origin: { lat: number; lng: number },
  detourM: number | null,
): DiscoveryCandidate {
  const distanceM = Math.round(
    distanceMeters(origin.lat, origin.lng, p.lat, p.lng),
  );
  const rating = p.rating ?? null;
  return {
    placeId: p.placeId,
    name: p.name,
    lat: p.lat,
    lng: p.lng,
    distanceM,
    aheadM: distanceM,
    rating,
    openNow: p.openNow === true,
    types: p.types,
    lowRated: rating != null && rating < LOW_RATING_THRESHOLD,
    detourM,
    phoneNumber: p.phoneNumber?.trim() || null,
    websiteUri: p.websiteUri?.trim() || null,
  };
}

async function estimateDetourM(
  origin: { lat: number; lng: number },
  poi: { lat: number; lng: number },
  finalDest: { lat: number; lng: number },
): Promise<number> {
  // €0 zuerst: Haversine. Geroutete Detour nur wenn nötig (OSRM-first).
  const op = distanceMeters(origin.lat, origin.lng, poi.lat, poi.lng);
  const pd = distanceMeters(poi.lat, poi.lng, finalDest.lat, finalDest.lng);
  const od = distanceMeters(origin.lat, origin.lng, finalDest.lat, finalDest.lng);
  const air = Math.max(0, Math.round(op + pd - od));
  // Kurze Umwege: Luftlinie reicht — spart 3 Directions-Calls
  if (air < 400 || od < 600) return air;
  try {
    const [via, direct, viaToDest] = await Promise.all([
      fetchRouteDirections(origin, poi, 'walking'),
      fetchRouteDirections(origin, finalDest, 'walking'),
      fetchRouteDirections(poi, finalDest, 'walking'),
    ]);
    const viaM =
      (via?.reduce((s, x) => s + (x.distanceM || 0), 0) ?? 0) +
      (viaToDest?.reduce((s, x) => s + (x.distanceM || 0), 0) ?? 0);
    const directM = direct?.reduce((s, x) => s + (x.distanceM || 0), 0) ?? 0;
    if (viaM > 0 && directM > 0) return Math.max(0, Math.round(viaM - directM));
  } catch {
    /* soft */
  }
  return air;
}

function formatDist(m: number): string {
  if (m < 1000) return `${Math.max(50, Math.round(m / 50) * 50)} m`;
  return `${(m / 1000).toFixed(1)} km`;
}

function buildSpeech(
  label: string,
  candidates: DiscoveryCandidate[],
  opts: {
    emergency: boolean;
    activeRoute: boolean;
    drinkNeed?: boolean;
    expandLabel?: string | null;
    far?: boolean;
  },
): { speech: string; needsConfirmation: boolean } {
  const maxRingKm = Math.round(
    (PLACE_EXPAND_RINGS_M[PLACE_EXPAND_RINGS_M.length - 1] ?? 50_000) / 1000,
  );
  if (!candidates.length) {
    // Placeholder — runContextualDiscovery ersetzt durch Online-Recherche
    return {
      speech: opts.drinkNeed
        ? `Bis ~${maxRingKm} km kein klarer Kiosk/Supermarkt — ich recherchiere online weiter.`
        : `Bis ~${maxRingKm} km nichts Passendes für ${label} — ich recherchiere jetzt online.`,
      needsConfirmation: false,
    };
  }
  const top = candidates[0];
  const isFar = top.distanceM >= PLACE_FAR_SPEECH_M || Boolean(opts.far);
  const farHint = isFar
    ? ` ~${formatDist(top.distanceM)} — passt das?`
    : '';
  if (opts.drinkNeed && candidates.length >= 2) {
    const second = candidates[1];
    return {
      speech:
        `Es gibt zwei gute Optionen: ${top.name} — ca. ${formatDist(top.distanceM)}. ` +
        `Alternative: ${second.name}, ca. ${formatDist(second.distanceM)}. ` +
        `Wohin soll ich dich bringen?${farHint}`,
      needsConfirmation: isFar,
    };
  }
  if (opts.drinkNeed) {
    return {
      speech: `${top.name} ist ca. ${formatDist(top.distanceM)} entfernt — da kriegst du was zu trinken.${farHint}`,
      needsConfirmation: isFar,
    };
  }
  if (opts.emergency) {
    return {
      speech: isFar
        ? `Pass auf — ${top.name} liegt ~${formatDist(top.distanceM)} — passt das? Ich bring dich hin.`
        : `Pass auf — ${top.name} ist ${formatAheadCasual(top.aheadM)}. Ich bring dich sofort hin.`,
      needsConfirmation: false,
    };
  }
  if (top.lowRated && !isFar) {
    return {
      speech: `Der ${label} voraus ist leider nicht so gut bewertet. Möchtest du trotzdem dahin?`,
      needsConfirmation: true,
    };
  }
  if (
    opts.activeRoute &&
    top.detourM != null &&
    top.detourM > AUTO_INSERT_DETOUR_M &&
    !isFar
  ) {
    return {
      speech: `Ich hab auf dem Weg ${top.name} gefunden — wäre aber ein kleiner Schlenker. Sollen wir da kurz ran?`,
      needsConfirmation: true,
    };
  }
  if (isFar) {
    const expandBit = opts.expandLabel ? ` (gesucht ${opts.expandLabel})` : '';
    if (candidates.length === 1) {
      return {
        speech: `Gefunden: ${top.name}${expandBit} — liegt ~${formatDist(top.distanceM)} — passt das? Tippe den Chip oder sag Ja.`,
        needsConfirmation: true,
      };
    }
    const second = candidates[1];
    return {
      speech:
        `Weiter weg${expandBit}: ${top.name} (~${formatDist(top.distanceM)}) und ${second.name} (~${formatDist(second.distanceM)}) — passt das? Welchen nehmen wir?`,
      needsConfirmation: true,
    };
  }
  if (candidates.length === 1) {
    return {
      speech: `Gleich auf der Route: ${top.name}, ${formatAheadCasual(top.aheadM)}. Tippe den Chip oder sag Ja.`,
      needsConfirmation: false,
    };
  }
  const second = candidates[1];
  return {
    speech: `Voraus hab ich ${top.name} und ${second.name}. Welchen nehmen wir?`,
    needsConfirmation: false,
  };
}

function toQuickActions(candidates: DiscoveryCandidate[]): QuickAction[] {
  // Voice-first: max 2 Chips — Rest nennt die Stimme.
  return candidates.slice(0, 2).map((c, i) => {
    const dist =
      c.distanceM < 1000
        ? `${Math.round(c.distanceM / 10) * 10} m`
        : `${(c.distanceM / 1000).toFixed(1)} km`;
    const prefix = i === 0 ? 'Route' : 'Alt';
    return {
      type: 'START_NAVIGATION' as const,
      label: shortenActionLabel(`${prefix}: ${c.name} (${dist})`),
      payload: {
        destLat: c.lat,
        destLng: c.lng,
        destName: c.name,
        targetPoiId: `place:${c.placeId}`,
      },
    };
  });
}

function emptyContinueActions(label: string): QuickAction[] {
  return [
    {
      type: 'SHOW_MORE',
      label: shortenActionLabel('🔍 Weiter'),
      payload: {
        textPrompt: `Such weiter online nach ${label} in der Umgebung und gib mir konkrete Orte mit Links`,
      },
    },
    {
      type: 'SHOW_MORE',
      label: shortenActionLabel('🔍 Ohne Filter'),
      payload: {
        textPrompt: `Suche ${label} auch geschlossen oder etwas weiter weg — Wunsch erfüllen`,
      },
    },
  ];
}

/**
 * Discover open POIs ahead of the user. When a route is active,
 * auto-insert if detour ≤ 250 m; otherwise ask via speech + chips.
 */
export async function runContextualDiscovery(opts: {
  placeType: string;
  label: string;
  origin: { lat: number; lng: number };
  headingDeg?: number | null;
  movementBearingDeg?: number | null;
  emergency?: boolean;
}): Promise<DiscoveryResult> {
  if (
    opts.placeType === 'phone_charge' ||
    opts.placeType === 'powerbank' ||
    opts.placeType === 'outlet_cafe' ||
    /handy\s*laden|steckdose|powerbank/i.test(opts.label)
  ) {
    const charge = await runPhoneChargeDiscovery({ origin: opts.origin });
    return {
      queryLabel: charge.queryLabel,
      speech: charge.speech,
      candidates: charge.candidates,
      quickActions: charge.quickActions,
      visualBullets: charge.visualBullets,
      needsConfirmation: charge.needsConfirmation,
      autoInserted: charge.autoInserted,
    };
  }

  const drinkNeed =
    opts.placeType === 'convenience_store' ||
    opts.label === 'Getränke' ||
    /getränk|durst|trinken/i.test(opts.label);

  // Wunsch erfüllen: Ringe wachsen, bis Treffer da sind (nicht bei 900 m aufgeben)
  const expanded = await searchPlacesExpanding({
    lat: opts.origin.lat,
    lng: opts.origin.lng,
    placeType: drinkNeed ? 'supermarket' : opts.placeType,
    openNow: true,
    minResults: opts.emergency || drinkNeed ? 1 : 2,
    fallbackTypes: drinkNeed
      ? ['convenience_store', 'liquor_store']
      : opts.placeType === 'restaurant'
        ? ['meal_takeaway', 'cafe']
        : opts.placeType === 'toilet'
          ? []
          : [],
  });

  let allPlaces = expanded.places.filter(
    (p) =>
      p.openNow !== false &&
      !looksLikeOfficeOnlyPlace({ name: p.name, types: p.types }),
  );

  // Durst: Extra Convenience falls nur Supermarkt
  if (drinkNeed && allPlaces.length < 2) {
    const extra = await searchPlacesExpanding({
      lat: opts.origin.lat,
      lng: opts.origin.lng,
      placeType: 'convenience_store',
      openNow: true,
      minResults: 1,
    });
    const seen = new Set(allPlaces.map((p) => p.placeId));
    for (const p of extra.places) {
      if (!seen.has(p.placeId)) allPlaces.push(p);
    }
  }

  const heading = opts.headingDeg ?? null;
  const movement = opts.movementBearingDeg ?? heading;

  let filtered = allPlaces.filter((p) => {
    const targetBearing = bearingDegrees(
      opts.origin.lat,
      opts.origin.lng,
      p.lat,
      p.lng,
    );
    return isAheadOfMovement(
      movement,
      heading,
      targetBearing,
      opts.emergency || drinkNeed ? 180 : 95,
    );
  });
  // Wider cone once — still ahead-biased. Never prefer points behind the user.
  if (!filtered.length && !opts.emergency && !drinkNeed && movement != null) {
    filtered = allPlaces.filter((p) => {
      const targetBearing = bearingDegrees(
        opts.origin.lat,
        opts.origin.lng,
        p.lat,
        p.lng,
      );
      return isAheadOfMovement(movement, heading, targetBearing, 125);
    });
  }
  // Weit weg: auch hinter dem User zählen — Wunsch erfüllen > strikte Voraus-Filter
  if (!filtered.length && expanded.far) {
    filtered = allPlaces.slice(0, 6);
  }
  // Emergency / Durst: fall back to nearest open (any direction)
  if (!filtered.length && (opts.emergency || drinkNeed)) {
    filtered = allPlaces.slice(0, 6);
  }
  // Letzter Fallback: irgendwas aus Expanding-Suche
  if (!filtered.length && allPlaces.length) {
    filtered = allPlaces.slice(0, 6);
  }

  const active = getActiveNavDestination();
  const candidates: DiscoveryCandidate[] = [];

  for (const p of filtered.slice(0, 8)) {
    let detourM: number | null = null;
    if (active) {
      detourM = await estimateDetourM(opts.origin, p, {
        lat: active.lat,
        lng: active.lng,
      });
    }
    candidates.push(toCandidate(p, opts.origin, detourM));
  }

  // Durst: Favorit voraus + nächster zurück (wenn verschieden)
  if (drinkNeed && allPlaces.length) {
    const aheadIds = new Set(candidates.map((c) => c.placeId));
    const behind = allPlaces
      .filter((p) => !aheadIds.has(p.placeId))
      .map((p) => toCandidate(p, opts.origin, null))
      .sort((a, b) => a.distanceM - b.distanceM);
    if (behind[0] && candidates.length < 2) {
      candidates.push(behind[0]);
    } else if (behind[0] && candidates.length >= 1) {
      // Ensure second option is the nearest alternative (often behind)
      const secondIsSame =
        candidates[1] &&
        candidates[1].distanceM <= behind[0].distanceM + 40;
      if (!secondIsSame && behind[0].placeId !== candidates[0]?.placeId) {
        candidates.splice(1, 0, behind[0]);
      }
    }
  }

  candidates.sort((a, b) => {
    if (a.lowRated !== b.lowRated) return a.lowRated ? 1 : -1;
    if (a.detourM != null && b.detourM != null && a.detourM !== b.detourM) {
      return a.detourM - b.detourM;
    }
    return a.distanceM - b.distanceM;
  });

  // Keep max 4 unique
  const unique: DiscoveryCandidate[] = [];
  const seenIds = new Set<string>();
  for (const c of candidates) {
    if (seenIds.has(c.placeId)) continue;
    seenIds.add(c.placeId);
    unique.push(c);
    if (unique.length >= 4) break;
  }

  const { speech, needsConfirmation } = buildSpeech(opts.label, unique, {
    emergency: Boolean(opts.emergency),
    activeRoute: Boolean(active),
    drinkNeed,
    expandLabel: expanded.expandLabel,
    far: expanded.far,
  });

  let finalSpeech = speech;
  // Echte Route statt Luftlinie in der Ansage
  if (unique[0] && !opts.emergency) {
    try {
      const eta = await estimateTravelEtaRouted({
        userLat: opts.origin.lat,
        userLng: opts.origin.lng,
        destLat: unique[0].lat,
        destLng: unique[0].lng,
        destName: unique[0].name,
      });
      if (eta.routed && eta.distanceM > 40) {
        unique[0].distanceM = eta.distanceM;
        unique[0].aheadM = eta.distanceM;
        const etaLine = formatWalkBikeEtaSpeech(eta);
        finalSpeech = `${unique[0].name} — ${etaLine}. Tippe den Chip oder sag Ja.`;
        if (unique[1]) {
          finalSpeech += ` Alternative: ${unique[1].name}.`;
        }
      }
    } catch {
      /* keep air speech */
    }
  }
  let quickActions = toQuickActions(unique);

  // Expand-Ringe leer → Online-Recherche (Wunsch erfüllen)
  if (!unique.length) {
    const profile = getCachedUserProfile();
    const web = await runWishOnlineResearch({
      wishLabel: opts.label,
      userText: `${opts.label} ${drinkNeed ? 'Getränke Durst' : ''} finden`,
      cityName: profile?.cityName,
      lat: opts.origin.lat,
      lng: opts.origin.lng,
    });
    const prefix = expandThenOnlineSpeechPrefix(opts.label);
    if (web?.speechHint || web?.facts?.length) {
      const factBits = (web.facts ?? [])
        .slice(0, 2)
        .map((f) => `${f.label}: ${f.value}`)
        .join('. ');
      finalSpeech = (
        prefix +
        (web.speechHint || factBits || 'Hier ist, was ich online gefunden habe.')
      )
        .replace(/\s+/g, ' ')
        .trim();
      const webActions = webResearchToActions(web).map((a) => ({
        ...a,
        label: shortenActionLabel(a.label),
      }));
      quickActions = [
        ...webActions,
        ...emptyContinueActions(opts.label),
      ].slice(0, 3);
    } else {
      finalSpeech = (
        prefix +
        `Noch keine harten Treffer — tippe Weiter oder sag Küche/Ort genauer.`
      )
        .replace(/\s+/g, ' ')
        .trim();
      quickActions = emptyContinueActions(opts.label);
    }
  } else if (!opts.emergency) {
    const empathy = buildEmpathyDiscoveryOverlay({
      placeType: opts.placeType,
      label: opts.label,
      navSpeech: finalSpeech,
    });
    finalSpeech = empathy.speech;
    if (empathy.extraActions.length) {
      quickActions = [...empathy.extraActions, ...quickActions]
        .map((a) => ({ ...a, label: shortenActionLabel(a.label) }))
        .slice(0, 3);
    }
  }

  const result: DiscoveryResult = {
    queryLabel: opts.label,
    candidates: unique,
    speech: drinkNeed && unique.length ? speech : finalSpeech,
    quickActions: quickActions.slice(0, 3),
    needsConfirmation: unique.length ? needsConfirmation : false,
    autoInserted: false,
  };

  useFinnusStore.getState().setDiscoveryCandidates(unique);
  if (unique[0]) {
    useFinnusStore.getState().setPendingNavOffer({
      poiId: -1,
      name: unique[0].name,
      lat: unique[0].lat,
      lng: unique[0].lng,
    });
    useFinnusStore.getState().setPendingNavAlternatives(
      unique.slice(1, 3).map((c) => ({
        poiId: -1,
        name: c.name,
        lat: c.lat,
        lng: c.lng,
      })),
    );
  }

  return result;
}

/**
 * Instantly abort TTS and start nav (or insert into multi-stop queue).
 */
export async function interruptAndNavigateToDiscovery(
  candidate:
    | DiscoveryCandidate
    | { name: string; lat: number; lng: number; poiId?: number },
  opts?: {
    emergency?: boolean;
    keepFinal?: { name: string; lat: number; lng: number; poiId?: number } | null;
    skipClosingGate?: boolean;
    /** Pin / „Ja, dorthin“ — kein Fernziel-Verify, kein Einweben in alte Tour */
    skipDestVerify?: boolean;
  },
): Promise<boolean> {
  try {
    await stopSpeaking();
  } catch {
    // ignore
  }

  if (!opts?.emergency && !opts?.skipClosingGate) {
    const openHint =
      'openNow' in candidate ? (candidate as DiscoveryCandidate).openNow : null;
    const gate = await checkClosingTimeGate({
      destName: candidate.name,
      destLat: candidate.lat,
      destLng: candidate.lng,
      placeHint: candidate.name,
      openNow: openHint === false ? false : openHint === true ? true : null,
    });
    if (!gate.allow && gate.warningSpeech) {
      useFinnusStore.getState().setActiveConciergeCard({
        id: `closing-gate-${Date.now()}`,
        createdAtMs: Date.now(),
        cardTitle: 'Geschlossen',
        speechText: gate.warningSpeech,
        visualBullets: [
          'Geschlossen',
          gate.etaMinutes != null ? `ETA wäre ca. ${gate.etaMinutes} Min` : null,
        ].filter(Boolean) as string[],
        quickActions: [
          {
            type: 'SHOW_MORE',
            label: 'Offene Alternative',
            payload: {
              textPrompt: `Finde eine offene Alternative zu ${candidate.name} — nur geöffnete Läden`,
            },
          },
          {
            type: 'START_NAVIGATION',
            label: 'Trotzdem navigieren',
            payload: {
              destName: candidate.name,
              destLat: candidate.lat,
              destLng: candidate.lng,
              skipClosingGate: true,
              skipDestVerify: opts?.skipDestVerify === true,
            },
          },
        ],
      });
      // Just-Do-It: offene Alternative gleicher Kategorie suchen
      const types = 'types' in candidate ? candidate.types : [];
      const typeHint = [...(types ?? []), candidate.name].join(' ');
      let placeType = 'bakery';
      let label = 'offene Alternative';
      if (/cafe|café|kaffee/i.test(typeHint)) {
        placeType = 'cafe';
        label = 'Café';
      } else if (/restaurant|meal|food/i.test(typeHint)) {
        placeType = 'restaurant';
        label = 'Restaurant';
      } else if (/pharmacy|apotheke/i.test(typeHint)) {
        placeType = 'pharmacy';
        label = 'Apotheke';
      } else if (/supermarket|markt|edeka|rewe/i.test(typeHint)) {
        placeType = 'supermarket';
        label = 'Supermarkt';
      } else if (/bäck|baeck|bakery|brot|brötchen/i.test(typeHint)) {
        placeType = 'bakery';
        label = 'Bäckerei';
      }
      void (async () => {
        try {
          await speakAssistantText(gate.warningSpeech!);
        } catch {
          /* soft */
        }
        const store = useFinnusStore.getState();
        const lat = store.lastGpsLat;
        const lng = store.lastGpsLng;
        if (lat == null || lng == null) return;
        try {
          const alt = await runContextualDiscovery({
            origin: { lat, lng },
            label,
            placeType,
          });
          if (alt.speech?.trim()) {
            presentDiscoveryAsConcierge(alt);
            await speakAssistantText(alt.speech);
          }
        } catch {
          /* soft */
        }
      })();
      return false;
    }
  }

  // Karten-Pin / bestätigtes Ziel: frisch starten — nicht in stale Tour einweben
  if (!opts?.skipDestVerify) {
    const keepFinal = opts?.keepFinal ?? getActiveNavDestination();
    if (keepFinal) {
      const gps = useFinnusStore.getState();
      const fromLat = gps.lastGpsLat;
      const fromLng = gps.lastGpsLng;
      const longWalk =
        fromLat != null &&
        fromLng != null &&
        distanceMeters(fromLat, fromLng, candidate.lat, candidate.lng) / 80 >
          20;

      // Lange Ziele nicht in lokale Walk-Tour einweben — frische Route (Auto-ÖPNV)
      if (longWalk) {
        const tour = gps.multiStopTour;
        const transitTour = tour?.stops?.some(
          (s) =>
            s.role === 'board' ||
            s.role === 'alight' ||
            s.role === 'transfer',
        );
        if (!transitTour) {
          useFinnusStore.getState().setMultiStopTour(null);
        }
        const poiIdLong =
          'poiId' in candidate &&
          typeof (candidate as { poiId?: number }).poiId === 'number'
            ? (candidate as { poiId: number }).poiId
            : -1;
        return startNavigationToCoords({
          name: candidate.name,
          lat: candidate.lat,
          lng: candidate.lng,
          poiId: poiIdLong,
          skipDestVerify: true,
        });
      }

      ensureTourFromActiveNav({
        name: keepFinal.name,
        lat: keepFinal.lat,
        lng: keepFinal.lng,
        poiId: 'poiId' in keepFinal ? keepFinal.poiId ?? -1 : -1,
      });
      const stop: TourStop = {
        poiId: -1,
        name: candidate.name,
        lat: candidate.lat,
        lng: candidate.lng,
        done: false,
        priority: opts?.emergency ? 'must' : 'high',
        remindMinBefore: opts?.emergency ? 5 : null,
      };
      // Smart einweben (on-route vorher), nicht nur blind vorne — Tour bleibt
      if (hasActiveTourQueue()) {
        const woven = await weaveSpontaneousStop(stop, { startNow: true });
        if (woven) {
          try {
            await speakAssistantText(woven.speechHint);
          } catch {
            /* soft */
          }
          return true;
        }
      }
      await insertTourStop(stop, {
        position: 'front',
        startNow: true,
      });
      return true;
    }
  }

  const poiId =
    'poiId' in candidate &&
    typeof (candidate as { poiId?: number }).poiId === 'number'
      ? (candidate as { poiId: number }).poiId
      : -1;
  return startNavigationToCoords({
    name: candidate.name,
    lat: candidate.lat,
    lng: candidate.lng,
    poiId,
    skipDestVerify: opts?.skipDestVerify === true,
  });
}

/** Present discovery as Concierge card (speech + Fast-Click chips). */
export function presentDiscoveryAsConcierge(result: DiscoveryResult): void {
  const bullets =
    result.visualBullets && result.visualBullets.length > 0
      ? result.visualBullets.slice(0, 3)
      : result.candidates.slice(0, 3).map((c) => {
          const rating =
            c.rating != null ? ` · ★${c.rating.toFixed(1)}` : '';
          const detour =
            c.detourM != null && c.detourM > 0
              ? c.detourM <= AUTO_INSERT_DETOUR_M
                ? ' · auf dem Weg'
                : ' · kleiner Schlenker'
              : '';
          const dist =
            c.aheadM < 1000
              ? `${Math.round(c.aheadM / 10) * 10}m voraus`
              : `${(c.aheadM / 1000).toFixed(1)} km voraus`;
          return `${c.name} — ${dist}${rating}${detour}`;
        });
  useFinnusStore.getState().setActiveConciergeCard({
    id: `discovery-${Date.now()}`,
    createdAtMs: Date.now(),
    speechText: result.speech,
    visualBullets: bullets,
    quickActions: result.quickActions,
    cardTitle: result.queryLabel,
  });
}
