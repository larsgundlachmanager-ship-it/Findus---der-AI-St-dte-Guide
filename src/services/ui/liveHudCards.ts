/**
 * Live-HUD Karten — max. 5, swipebar / Auto-Rotate (Idle).
 * Ort + Wetter oft; optionale Themen alle 30 Min frei gewählt (nicht immer Sunset/Dinner).
 */

import { stripNavDestLeak } from '../navigation/streetAddressQuery';
import { resolvePlacePresence } from '../geo/placePresence';
import { formatNavHudTitle } from '../navigation/transportMode';
import { formatParkingHudCard } from '../timeline/parkingSpotStore';
import {
  collectHudTipCandidates,
  evaluateProactiveHud,
  type HudTipCandidate,
} from './proactiveHudEngine';
import { useFinnusStore } from '../../store/useFinnusStore';
import { getCachedWeatherSnapshot } from '../weatherService';
import { computeSunsetMs, isTodaysSunsetLive } from '../geo/solarTimes';
import { getSunsetHorizonCache } from './sunsetHorizonSpots';
import { formatHudRemain, formatTimerCountdown, sameLocalCalendarDay } from './hudRemainLabel';
import {
  HUD_META_CHARS_PER_LINE,
  HUD_TITLE_CHARS_PER_LINE,
  fitHudLine,
  fitHudMeta,
  hudCharsForWidth,
} from './hudTextFit';
import {
  citySoftTips,
  curatedCityPulseTips,
  pinnedIdeaSoftTips,
} from './liveHudSoftTips';
import {
  getNearbyAmenityHudCards,
} from './liveHudNearbyAmenities';
import {
  hudThemeBucketKey,
  pickIdleHudThemes,
  type HudOptionalTheme,
} from './liveHudThemeCurator';
import {
  getMealHudCache,
  resolveMealSlot,
} from './liveHudMealSuggestions';
import { isMappedHudPlaceLabel } from './liveHudPlacePin';
import {
  allowActivitySoftTips,
  isNachtruhe,
} from './nachtruhePolicy';
import {
  formatRainHudLine,
  isPrecipWeatherCode,
} from '../weather/rainIncomingPolicy';
import { stripHudCoachMeta } from './hudCoachMeta';
import { formatWeatherHudCard } from './weatherDayPlanSpeech';

export type LiveHudCard = {
  id: string;
  title: string;
  meta?: string;
  /** Tippen → Tips / Concierge-Prompt */
  tellMorePrompt: string;
  /**
   * Tippen startet Navigation hierhin (statt Concierge-Frage).
   * Für konkrete Orte auf der Live-Karte.
   */
  navDest?: { name: string; lat: number; lng: number };
  /** Tippen öffnet Stempelkarte → Route-Tab (bei aktiver Nav). */
  openRoutePassport?: boolean;
};

const MAX_IDLE_CARDS = 6;

const UTILITY_TIP_KINDS = new Set([
  'battery_charge',
  'parking_ticket',
  'weather_rain',
  'session_deadline',
  'wake_alarm',
  'transit_depart',
  'nav_eta',
  'shopping_closing',
  'hotel_breakfast',
  'hotel_checkin',
]);

type HudFit = { titleChars: number; metaChars: number };

const DEFAULT_HUD_FIT: HudFit = {
  titleChars: HUD_TITLE_CHARS_PER_LINE,
  metaChars: HUD_META_CHARS_PER_LINE,
};

/** Während `buildLiveHudCards` — gemessene Lane-Breite. */
let activeFit: HudFit = DEFAULT_HUD_FIT;

function polishCard(c: LiveHudCard): LiveHudCard {
  const metaRaw = stripHudCoachMeta(c.meta);
  return {
    ...c,
    title: fitHudLine(c.title, activeFit.titleChars),
    meta: metaRaw
      ? fitHudMeta(metaRaw, { charsPerLine: activeFit.metaChars })
      : undefined,
  };
}

/**
 * Live-Ort nur bei echtem Karten-Pin (POI/Hotel/Shop/Bahnhof …).
 * Keine reine Adresse, kein „Hier in der Gegend“.
 */
export { isMappedHudPlaceLabel } from './liveHudPlacePin';

function placeCard(): LiveHudCard | null {
  const presence = resolvePlacePresence();
  const store = useFinnusStore.getState();
  let offer = store.pendingNavOffer;
  try {
    const { isBogusNavDestName } = require('../research/htmlResearchGate') as {
      isBogusNavDestName: (n: string) => boolean;
    };
    if (offer?.name) {
      const cleaned = stripNavDestLeak(offer.name);
      if (cleaned) offer = { ...offer, name: cleaned };
      if (
        !cleaned ||
        isBogusNavDestName(offer.name) ||
        isBogusNavDestName(cleaned)
      ) {
        offer = null;
      }
    }
  } catch {
    /* soft */
  }

  // Topic/Stadt weg: Offer weit weg vom GPS → kein Live-Pin (z. B. Athen-Chat)
  if (
    offer &&
    typeof offer.lat === 'number' &&
    typeof offer.lng === 'number' &&
    store.lastGpsLat != null &&
    store.lastGpsLng != null
  ) {
    try {
      const { haversineMeters } = require('../../db/database') as {
        haversineMeters: (
          a: number,
          b: number,
          c: number,
          d: number,
        ) => number;
      };
      const dist = haversineMeters(
        store.lastGpsLat,
        store.lastGpsLng,
        offer.lat,
        offer.lng,
      );
      if (dist > 80_000) offer = null;
    } catch {
      /* soft */
    }
  }

  const navDest =
    offer &&
    typeof offer.lat === 'number' &&
    typeof offer.lng === 'number' &&
    Number.isFinite(offer.lat) &&
    Number.isFinite(offer.lng) &&
    offer.name.trim()
      ? { name: offer.name.trim(), lat: offer.lat, lng: offer.lng }
      : undefined;

  // Nur echte Pins / aktive Nav — sonst keine Ort-Karte
  const atHotel = presence.role === 'hotel';
  const atPoi = presence.role === 'poi';
  const inNav = presence.role === 'nav';
  if (!navDest && !atHotel && !atPoi && !inNav) {
    const label =
      presence.role === 'stationary' || presence.role === 'moving'
        ? presence.place
        : store.currentLocationName?.trim() || '';
    if (!isMappedHudPlaceLabel(label)) return null;
  }

  const name =
    presence.role === 'hotel'
      ? presence.hotelName
      : presence.role === 'poi'
        ? presence.poiName
        : presence.role === 'stationary' || presence.role === 'moving'
          ? presence.place
          : store.currentLocationName?.trim() || 'der Gegend';

  let title: string;
  let meta: string | undefined;
  let tellMorePrompt: string;

  if (navDest) {
    const eta = estimateOfferHudEta(navDest.lat, navDest.lng);
    title = `🧭 Navigation zum ${navDest.name}?`;
    meta = eta?.meta;
    tellMorePrompt = eta?.tellMore
      ? `${eta.tellMore} Route zu ${navDest.name} starten.`
      : `Bring mich zu ${navDest.name} — Verbindung und Ankunft kurz, dann Navigation.`;
  } else if (presence.role === 'nav') {
    title = `🧭 ${presence.target}`;
    meta = undefined;
    tellMorePrompt = `Kurz: wie komme ich zu ${presence.target}, Ankunftszeit, und worauf soll ich achten?`;
  } else if (presence.role === 'hotel') {
    title = `🏨 ${presence.hotelName}`;
    meta = undefined;
    tellMorePrompt = `Was wäre jetzt bei ${name} am hilfreichsten — eine kurze Idee, die zu mir passt?`;
  } else if (presence.role === 'poi') {
    title = `📌 ${presence.poiName}`;
    meta = undefined;
    tellMorePrompt = `Was wäre jetzt bei ${name} am hilfreichsten — eine kurze Idee, die zu mir passt?`;
  } else if (presence.role === 'moving') {
    title = `🚶 ${presence.place}`;
    meta = undefined;
    tellMorePrompt = `Was wäre jetzt bei ${name} am hilfreichsten — eine kurze Idee, die zu mir passt?`;
  } else {
    title = presence.title.startsWith('📍')
      ? presence.title
      : `📍 ${name.replace(/^Hier:\s*/i, '').trim()}`;
    meta = undefined;
    tellMorePrompt = `Was wäre jetzt bei ${name} am hilfreichsten — eine kurze Idee, die zu mir passt?`;
  }

  return polishCard({
    id: 'place-here',
    title,
    meta,
    tellMorePrompt,
    navDest,
  });
}

/** Grobe Ankunft für Live-Pin — Fuß/Rad nah, sonst ÖPNV-Hinweis. */
function estimateOfferHudEta(
  destLat: number,
  destLng: number,
): { meta: string; tellMore: string } | null {
  const store = useFinnusStore.getState();
  if (store.lastGpsLat == null || store.lastGpsLng == null) return null;
  try {
    const { haversineMeters } = require('../../db/database') as {
      haversineMeters: (
        a: number,
        b: number,
        c: number,
        d: number,
      ) => number;
    };
    const dist = haversineMeters(
      store.lastGpsLat,
      store.lastGpsLng,
      destLat,
      destLng,
    );
    if (!(dist > 0) || !Number.isFinite(dist)) return null;
    const distLabel =
      dist < 1000
        ? `${Math.max(50, Math.round(dist / 10) * 10)} m`
        : `${(dist / 1000).toFixed(1).replace('.', ',')} km`;

    let mode = 'walk';
    try {
      const { resolveActiveTravelMode } = require('../navigation/travelModeContext') as {
        resolveActiveTravelMode: () => { mode: string };
      };
      mode = resolveActiveTravelMode().mode;
    } catch {
      mode = 'walk';
    }

    if (dist <= 2800 || mode === 'bike') {
      const { walkMinutesForDistanceM, bikeMinutesForDistanceM } =
        require('../navigation/travelEta') as {
          walkMinutesForDistanceM: (m: number) => number;
          bikeMinutesForDistanceM: (m: number) => number;
        };
      const mins =
        mode === 'bike'
          ? bikeMinutesForDistanceM(dist)
          : walkMinutesForDistanceM(dist);
      const modeLabel = mode === 'bike' ? 'Rad' : 'Fuß';
      const arrive = new Date(Date.now() + mins * 60_000);
      const clock = arrive.toLocaleTimeString('de-DE', {
        hour: '2-digit',
        minute: '2-digit',
      });
      return {
        meta: `${distLabel} · ~${mins} Min ${modeLabel} · Ankunft ${clock}`,
        tellMore: `Ca. ${mins} Min ${modeLabel} (${distLabel}), Ankunft gegen ${clock}.`,
      };
    }

    // Weiter weg: ÖPNV grob (Stadtverkehr ~18 km/h effektiv inkl. Warten)
    const transitMin = Math.max(25, Math.ceil(dist / 300));
    const arrive = new Date(Date.now() + transitMin * 60_000);
    const clock = arrive.toLocaleTimeString('de-DE', {
      hour: '2-digit',
      minute: '2-digit',
    });
    const dur =
      transitMin >= 60
        ? `${Math.floor(transitMin / 60)} Std ${transitMin % 60} Min`
        : `${transitMin} Min`;
    return {
      meta: `${distLabel} · ÖPNV ~${dur} · Ankunft ${clock}`,
      tellMore: `Ca. ${distLabel} — sinnvolle Verbindung (ÖPNV/U/S) suchen, grob ${dur}, Ankunft gegen ${clock}.`,
    };
  } catch {
    return null;
  }
}

function navCard(): LiveHudCard {
  const store = useFinnusStore.getState();
  const place =
    store.navTargetName?.trim() ||
    store.multiStopTour?.stops[store.multiStopTour.currentIndex]?.name ||
    'Ziel';
  return polishCard({
    id: `nav-${place}`,
    title: formatNavHudTitle(place, store.transportMode),
    meta: 'Route auf der Karte',
    tellMorePrompt: `Kurz: wie komme ich zu ${place}, Ankunftszeit, und worauf soll ich achten?`,
    openRoutePassport: true,
  });
}

function tipToCard(tip: HudTipCandidate): LiveHudCard {
  const fallbackAsk =
    tip.kind === 'battery_charge'
      ? 'Akku wird knapp — such Powerbank-Automaten oder Café mit Steckdosen in der Nähe und gib mir Route-Buttons.'
      : tip.kind === 'weather_rain'
        ? '__WEATHER_DAY_CHECK__'
        : `Hinweis „${tip.text}“ — hilft mir das? Wenn ja, setz es konkret um (Route, Reminder oder nächster Schritt).`;
  return polishCard({
    id: tip.id,
    title: tip.text,
    meta: tip.meta,
    tellMorePrompt: (tip.tellMorePrompt ?? fallbackAsk).trim(),
  });
}

function parkingCard(nowMs: number): LiveHudCard | null {
  const line = formatParkingHudCard(nowMs);
  if (!line) return null;
  // ETA einmal warm ziehen, wenn noch kein Cache
  try {
    const { getLastParkingWalkMinEstimate, evaluateParkingCare } =
      require('../timeline/parkingCareEngine') as {
        getLastParkingWalkMinEstimate: () => number | null;
        evaluateParkingCare: (nowMs?: number) => Promise<unknown>;
      };
    if (getLastParkingWalkMinEstimate() == null && line.navDest) {
      void evaluateParkingCare(nowMs);
    }
  } catch {
    /* soft */
  }
  return polishCard({
    id: 'parking-spot',
    title: line.title,
    meta: line.meta,
    tellMorePrompt: line.tellMorePrompt,
    navDest: line.navDest,
  });
}

function timerCard(nowMs: number): LiveHudCard | null {
  try {
    const { getActiveTimer } = require('../alarms/timerService') as {
      getActiveTimer: () => { endsAtMs: number; label: string } | null;
    };
    const t = getActiveTimer();
    if (!t || t.endsAtMs <= nowMs) return null;
    const remain = t.endsAtMs - nowMs;
    const clock = formatTimerCountdown(remain);
    return polishCard({
      id: `timer-${t.endsAtMs}`,
      title: `Timer ${clock}`,
      meta: t.label !== 'Timer' ? `${t.label} · läuft` : 'läuft · klingelt auch aus',
      tellMorePrompt: `Status zu meinem Timer „${t.label}“ — noch wie lange, und was danach?`,
    });
  } catch {
    return null;
  }
}

function formatClock(ms: number): string {
  return new Date(ms).toLocaleTimeString('de-DE', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Wetter — menschlicher Mini-Bericht, Tap = lockerer Tagesbericht. */
function weatherCard(): LiveHudCard | null {
  const snap = getCachedWeatherSnapshot();
  let tracker: {
    currentPrecipMm?: number | null;
    nextRainAtMs?: number | null;
    rainStartsInMin?: number | null;
    rainEndsAtMs?: number | null;
    rainWindows?: Array<{ startMs: number; endMs: number; pop?: number }> | null;
    weatherCode?: number | null;
    summaryLine?: string | null;
  } | null = null;
  try {
    const { getWeatherTrackerState } = require('../logistics/weatherTracker') as {
      getWeatherTrackerState: () => typeof tracker;
    };
    tracker = getWeatherTrackerState();
  } catch {
    tracker = null;
  }
  if (!snap?.summaryLine?.trim() && snap?.currentTempC == null && !tracker) {
    return null;
  }
  // Tracker/Radar-Timing schlägt ggf. stale Cache (Live-Anzeige SSOT).
  const hudSnap = {
    ...(snap ?? {}),
    precipitationMm: tracker?.currentPrecipMm ?? snap?.precipitationMm,
    nextRainAtMs: tracker?.nextRainAtMs ?? snap?.nextRainAtMs,
    rainStartsInMin: tracker?.rainStartsInMin ?? snap?.rainStartsInMin,
    rainEndsAtMs: tracker?.rainEndsAtMs ?? snap?.rainEndsAtMs,
    rainWindows: (tracker?.rainWindows ?? snap?.rainWindows) as
      | Array<{ startMs: number; endMs: number; pop: number }>
      | undefined,
    weatherCode: tracker?.weatherCode ?? snap?.weatherCode,
    summaryLine:
      (tracker?.summaryLine && /regen/i.test(tracker.summaryLine)
        ? tracker.summaryLine
        : null) ??
      snap?.summaryLine ??
      null,
    currentTempC: snap?.currentTempC,
    dayHighC: snap?.dayHighC,
    isHeavyRain: snap?.isHeavyRain,
    nightLowC: snap?.nightLowC,
    sunsetMs: snap?.sunsetMs,
    sunriseMs: snap?.sunriseMs,
    nextRainProb: snap?.nextRainProb,
  };
  const rainHud = formatRainHudLine({
    currentPrecipMm: hudSnap.precipitationMm,
    nextRainAtMs: hudSnap.nextRainAtMs,
    rainStartsInMin: hudSnap.rainStartsInMin,
    rainEndsAtMs: hudSnap.rainEndsAtMs,
    rainWindows: hudSnap.rainWindows,
    weatherCode: hudSnap.weatherCode,
    isHeavyRain: hudSnap.isHeavyRain,
  });
  const hud = formatWeatherHudCard({ snap: hudSnap, nowMs: Date.now() });
  if (!hud && !rainHud) return null;

  // Fallback wenn formatWeatherHudCard null (nur Radar-Felder).
  const title = hud?.title ?? (rainHud ? `🌧 ${rainHud}` : '🌧 Regen');
  return polishCard({
    id: 'weather-live',
    title,
    meta: hud?.meta,
    tellMorePrompt: '__WEATHER_DAY_CHECK__',
  });
}

function sunsetCard(nowMs: number): LiveHudCard | null {
  const hour = new Date(nowMs).getHours();
  if (hour < 15 || hour > 21) return null;
  const store = useFinnusStore.getState();
  const lat = store.lastGpsLat;
  const lng = store.lastGpsLng;
  const snap = getCachedWeatherSnapshot();
  const skyPoor = sunsetSkyIsPoor(snap);
  const solar =
    lat != null && lng != null && Number.isFinite(lat) && Number.isFinite(lng)
      ? computeSunsetMs(lat, lng, nowMs)
      : null;
  const wx = snap?.sunsetMs;
  const sunsetMs =
    typeof wx === 'number' &&
    Number.isFinite(wx) &&
    sameLocalCalendarDay(nowMs, wx) &&
    isTodaysSunsetLive(nowMs, wx)
      ? wx
      : solar;
  if (!isTodaysSunsetLive(nowMs, sunsetMs)) return null;
  const spots = getSunsetHorizonCache()?.spots ?? [];
  const clock = formatClock(sunsetMs!);
  const remain = sunsetMs! - nowMs;
  const remainLine =
    remain > 60_000
      ? formatHudRemain(remain)
      : remain >= -8 * 60_000
        ? 'läuft gerade'
        : null;
  if (!remainLine) return null;

  // Wetter nur als Fakt — keine Coach-Anweisung im HUD.
  let weatherBit: string;
  if (skyPoor) {
    weatherBit = 'voraussichtlich Regen';
  } else if (
    snap &&
    (/sonne|klar|sonnig/i.test(snap.summaryLine ?? '') ||
      isClearishSunsetSky(snap.weatherCode))
  ) {
    weatherBit = 'Wetter top zum Zuschauen';
  } else if (snap && /bewölkt|wolke/i.test(snap.summaryLine ?? '')) {
    weatherBit = 'Himmel eher wolkig';
  } else {
    weatherBit = 'Himmel sieht okay aus';
  }

  const spotLine = spots[0]
    ? `${spots[0].name} · ${spots[0].walkMin} Min`
    : null;
  // Uhr steht schon im Titel — Meta nicht nochmal „um 20:09“.
  const metaParts = [remainLine, weatherBit];
  if (spotLine) metaParts.push(spotLine);
  const meta = metaParts.join(' · ');

  const spotFacts = spots
    .map(
      (s) =>
        `${s.name} (${s.walkMin} Min zu Fuß, ${s.lat.toFixed(5)},${s.lng.toFixed(5)})`,
    )
    .join(' oder ');
  const weatherAsk = skyPoor
    ? 'Wetter ist nass — trotzdem Uhrzeit nennen, Spot optional.'
    : 'Wetter kurz positiv einordnen wenn schön.';
  const tellMorePrompt =
    spots.length >= 2
      ? `Sonnenuntergang um ${clock} Uhr (${remainLine}). ${weatherAsk} Zwei Horizont-Spots — ${spotFacts}. Sofort Pitch-Modus, Route-Buttons. Kein Leave-by automatisch.`
      : spots.length === 1
        ? `Sonnenuntergang um ${clock} Uhr (${remainLine}). ${weatherAsk} Route zu ${spots[0]!.name}. Spot: ${spotFacts}.`
        : `Sonnenuntergang um ${clock} Uhr (${remainLine}). ${weatherAsk} Zwei konkrete Spots mit freiem Horizont in der Nähe — mit Route. Sofort Pitch-Modus. Kein Leave-by automatisch.`;
  const navDest =
    spots.length === 1
      ? { name: spots[0]!.name, lat: spots[0]!.lat, lng: spots[0]!.lng }
      : undefined;
  // Uhrzeit VOR dem Wort — Truncation schneidet sonst die Zeit weg
  return polishCard({
    id: spots.length >= 2 ? 'sunset-spots' : 'sunset-live',
    title: `🌅 ${clock} Sonnenuntergang`,
    meta,
    tellMorePrompt,
    navDest,
  });
}

function sunsetSkyIsPoor(snap: ReturnType<typeof getCachedWeatherSnapshot>): boolean {
  if (!snap) return false;
  if (snap.isHeavyRain) return true;
  if ((snap.precipitationMm ?? 0) >= 0.4) return true;
  if (snap.rainStartsInMin != null && snap.rainStartsInMin <= 90) return true;
  if (isPrecipWeatherCode(snap.weatherCode)) return true;
  return /regen|schauer|gewitter/i.test(snap.summaryLine ?? '');
}

/**
 * Klar bis leicht bewölkt (WMO 0–2 / OWM 800–802) — gut zum Sunset-Zuschauen.
 * Muss existieren: liveHudCards ruft das in sunsetCard auf.
 */
export function isClearishSunsetSky(
  weatherCode: number | null | undefined,
): boolean {
  if (weatherCode == null || !Number.isFinite(weatherCode)) return false;
  const c = Math.round(weatherCode);
  if (c >= 0 && c <= 2) return true; // WMO / Open-Meteo
  if (c === 800 || c === 801 || c === 802) return true; // OWM
  return false;
}

/**
 * Gastro nur mit echten Nearby-Treffern — kein Soft-Placeholder
 * („Mittagessen nah?“ / Recherche-Anweisung als Meta).
 */
function dinnerCard(nowMs: number): LiveHudCard | null {
  const slot = resolveMealSlot(nowMs);
  const hour = new Date(nowMs).getHours();
  // Nur mit echtem Nearby-Treffer — nie leere Soft-Frage.
  if (slot === 'bakery' && (hour < 6 || hour >= 11)) return null;
  if (slot === 'lunch' && (hour < 11 || hour >= 16)) return null;
  if (slot === 'dinner' && (hour < 16 || hour >= 22)) return null;

  const cached = getMealHudCache();
  if (!cached || cached.slot !== slot || cached.items.length === 0) {
    return null;
  }
  const primary = cached.items[0];
  const navDest =
    primary &&
    typeof primary.lat === 'number' &&
    typeof primary.lng === 'number' &&
    Number.isFinite(primary.lat) &&
    Number.isFinite(primary.lng)
      ? { name: primary.name, lat: primary.lat, lng: primary.lng }
      : undefined;
  return polishCard({
    id: `meal-${slot}`,
    title: cached.title,
    meta: cached.meta,
    tellMorePrompt: cached.tellMorePrompt,
    navDest,
  });
}

function pushThemeCards(
  push: (c: LiveHudCard | null) => void,
  themes: Set<HudOptionalTheme>,
  nowMs: number,
): void {
  if (themes.has('sunset')) push(sunsetCard(nowMs));
  // Konkrete Gastro nur mit Cache-Treffer (dinnerCard), nie Soft-Placeholder.
  if (themes.has('dinner')) push(dinnerCard(nowMs));

  // Pro aktivem Pulse-Thema nur den besten Tipp — kein Durchreichen aller Karten
  const pulse = curatedCityPulseTips(nowMs).sort((a, b) => b.score - a.score);
  const pulseThemes: HudOptionalTheme[] = [
    'events',
    'concerts',
    'city_news',
    'user_relevant',
  ];
  for (const theme of pulseThemes) {
    if (!themes.has(theme)) continue;
    const tip = pulse.find((t) => t.theme === theme);
    if (!tip) continue;
    push(
      polishCard({
        id: `${tip.id}-${hudThemeBucketKey(nowMs)}`,
        title: tip.title,
        meta: tip.meta,
        tellMorePrompt: tip.tellMorePrompt,
      }),
    );
  }

  if (themes.has('soft_city')) {
    const tip = citySoftTips(nowMs).sort((a, b) => b.score - a.score)[0];
    if (tip) {
      push(
        polishCard({
          id: `${tip.id}-${hudThemeBucketKey(nowMs)}`,
          title: tip.title,
          meta: tip.meta,
          tellMorePrompt: tip.tellMorePrompt,
        }),
      );
    }
  }
}

/**
 * Modul 1 / POI: nur Ort.
 * Navigation: Nav + optional nächste Ebene.
 * Idle: Ort + Wetter + kuratierte Themen (max 5), swipebar vor/zurück.
 */
export function buildLiveHudCards(opts?: {
  nowMs?: number;
  mode?: 'idle' | 'poi' | 'nav';
  /** Gemessene Textbreite der Live-Anzeige — Truncation, nicht Umbruch. */
  textWidthPx?: number;
}): LiveHudCard[] {
  const nowMs = opts?.nowMs ?? Date.now();
  const textW = opts?.textWidthPx;
  const fit: HudFit =
    textW != null && textW > 80
      ? {
          titleChars: hudCharsForWidth(textW, 16) * 2,
          metaChars: hudCharsForWidth(textW, 12),
        }
      : DEFAULT_HUD_FIT;
  const prevFit = activeFit;
  activeFit = fit;
  try {
    return buildLiveHudCardsInner(nowMs, opts?.mode);
  } finally {
    activeFit = prevFit;
  }
}

function buildLiveHudCardsInner(
  nowMs: number,
  modeOpt?: 'idle' | 'poi' | 'nav',
): LiveHudCard[] {
  const store = useFinnusStore.getState();
  const navigating = store.navActive && store.navVisible;
  const atPoi = store.currentPoiId != null && !!store.currentLocationName?.trim();

  const mode =
    modeOpt ??
    (atPoi ? 'poi' : navigating ? 'nav' : 'idle');

  if (mode === 'poi') {
    const cards: LiveHudCard[] = [];
    const t = timerCard(nowMs);
    if (t) cards.push(t);
    const pin = placeCard();
    if (pin) cards.push(pin);
    return cards.slice(0, 2);
  }

  if (mode === 'nav') {
    const cards: LiveHudCard[] = [];
    const t = timerCard(nowMs);
    if (t) cards.push(t);
    cards.push(navCard());
    evaluateProactiveHud({ force: false });
    const tips = collectHudTipCandidates({ nowMs })
      .filter(
        (t) =>
          UTILITY_TIP_KINDS.has(t.kind) ||
          t.kind === 'nav_eta' ||
          t.score >= 75,
      )
      .sort((a, b) => b.score - a.score);
    for (const tip of tips) {
      cards.push(tipToCard(tip));
      if (cards.length >= 3) break;
    }
    const wx = weatherCard();
    if (wx && cards.length < 3) cards.push(wx);
    const park = parkingCard(nowMs);
    if (park && cards.length < 3) cards.push(park);
    return cards.slice(0, 3);
  }

  const cards: LiveHudCard[] = [];
  const seen = new Set<string>();
  const push = (c: LiveHudCard | null) => {
    if (!c || seen.has(c.id) || cards.length >= MAX_IDLE_CARDS) return;
    seen.add(c.id);
    cards.push(c);
  };

  // Aktiver Timer immer ganz vorne (Sekunden-Countdown im Header)
  push(timerCard(nowMs));
  push(placeCard());
  push(weatherCard());
  push(parkingCard(nowMs));
  // Konkrete Gastro-Treffer (Cache) — unabhängig vom Theme-Mix, nie Soft-Placeholder.
  if (allowActivitySoftTips(nowMs)) push(dinnerCard(nowMs));

  evaluateProactiveHud({ force: false });
  const utilityTips = collectHudTipCandidates({ nowMs })
    .filter(
      (t) =>
        UTILITY_TIP_KINDS.has(t.kind) ||
        (t.score >= 70 && t.kind !== 'weather_summary'),
    )
    .sort((a, b) => b.score - a.score);
  const skipSoftUtility = (tip: (typeof utilityTips)[number]) => {
    if (tip.id.startsWith('wx-')) return true;
    if (tip.kind === 'parking_ticket' && seen.has('parking-spot')) return true;
    if (tip.kind === 'weather_rain' && seen.has('weather-live')) return true;
    if (
      tip.kind === 'umbrella_day' ||
      /Jacke mitnehmen|Regen möglich|Regen → Indoor|Burger lokal/i.test(tip.text)
    ) {
      return true;
    }
    return false;
  };
  // 1) Zeitkritisch zuerst: Leave-by / Bahn / Flug / Taxi
  for (const tip of utilityTips) {
    if (skipSoftUtility(tip)) continue;
    const critical =
      tip.score >= 88 &&
      (tip.kind === 'session_deadline' ||
        tip.kind === 'transit_depart' ||
        tip.kind === 'nav_eta');
    if (!critical) continue;
    push(tipToCard(tip));
    if (cards.length >= MAX_IDLE_CARDS) break;
  }

  // 2) Nearby-Amenities (Klo/Wasser/Eis…) bevor Soft-Utility die Slots füllt
  if (allowActivitySoftTips(nowMs)) {
    const amenityCards = getNearbyAmenityHudCards(nowMs).sort(
      (a, b) => b.score - a.score,
    );
    let amenityPushed = 0;
    for (const a of amenityCards) {
      if (amenityPushed >= 2) break;
      push(
        polishCard({
          id: a.id,
          title: a.title,
          meta: a.meta,
          tellMorePrompt: a.tellMorePrompt,
          navDest: a.navDest,
        }),
      );
      amenityPushed += 1;
    }
    const pinned = pinnedIdeaSoftTips(nowMs).sort((a, b) => b.score - a.score)[0];
    if (pinned) {
      push(
        polishCard({
          id: `${pinned.id}-${hudThemeBucketKey(nowMs)}`,
          title: pinned.title,
          meta: pinned.meta,
          tellMorePrompt: pinned.tellMorePrompt,
        }),
      );
    }
  }

  // 3) Restliche Utility (Akku, Wecker, Parken …)
  for (const tip of utilityTips) {
    if (skipSoftUtility(tip)) continue;
    const alreadyCritical =
      tip.score >= 88 &&
      (tip.kind === 'session_deadline' ||
        tip.kind === 'transit_depart' ||
        tip.kind === 'nav_eta');
    if (alreadyCritical) continue;
    push(tipToCard(tip));
    if (cards.length >= MAX_IDLE_CARDS) break;
  }

  // Nachtruhe: keine Soft-Aktivitäts-Tips
  if (isNachtruhe(nowMs) || !allowActivitySoftTips(nowMs)) {
    return cards.slice(0, MAX_IDLE_CARDS);
  }

  if (cards.length >= MAX_IDLE_CARDS) {
    return cards.slice(0, MAX_IDLE_CARDS);
  }

  const themes = pickIdleHudThemes(nowMs);
  pushThemeCards(push, themes, nowMs);

  // Weitere user-relevante Tips wenn Platz
  if (themes.has('user_relevant') || cards.length < MAX_IDLE_CARDS) {
    const tips = collectHudTipCandidates({ nowMs }).sort(
      (a, b) => b.score - a.score,
    );
    for (const tip of tips) {
      if (tip.kind === 'weather_summary' || tip.id.startsWith('wx-')) continue;
      if (UTILITY_TIP_KINDS.has(tip.kind)) continue; // schon oben
      push(tipToCard(tip));
      if (cards.length >= MAX_IDLE_CARDS) break;
    }
  }

  return cards.slice(0, MAX_IDLE_CARDS);
}
