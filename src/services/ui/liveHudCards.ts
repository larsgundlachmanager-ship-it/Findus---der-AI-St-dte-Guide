/**
 * Live-HUD Karten — max. 5, swipebar / Auto-Rotate (Idle).
 * Ort + Wetter oft; optionale Themen alle 30 Min frei gewählt (nicht immer Sunset/Dinner).
 */

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
import { fitHudLine, fitHudMeta } from './hudTextFit';
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
import {
  allowActivitySoftTips,
  isNachtruhe,
} from './nachtruhePolicy';

export type LiveHudCard = {
  id: string;
  title: string;
  meta?: string;
  /** Tippen → Tips / Concierge-Prompt */
  tellMorePrompt: string;
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

function polishCard(c: LiveHudCard): LiveHudCard {
  return {
    ...c,
    title: fitHudLine(c.title, 40),
    meta: c.meta ? fitHudMeta(c.meta) : undefined,
  };
}

function placeCard(): LiveHudCard {
  const presence = resolvePlacePresence();
  const store = useFinnusStore.getState();
  const name =
    presence.role === 'hotel'
      ? presence.hotelName
      : presence.role === 'poi'
        ? presence.poiName
        : presence.role === 'stationary' || presence.role === 'moving'
          ? presence.place
          : store.currentLocationName?.trim() || 'der Gegend';
  const title =
    presence.role === 'nav'
      ? `📍 ${presence.target}`
      : presence.title.startsWith('📍')
        ? presence.title
        : `📍 ${presence.title.replace(/^Hier:\s*/i, '').trim()}`;
  return polishCard({
    // Stabile ID — verhindert Carousel-Reset bei jedem Orts-/Dwell-Update
    id: 'place-here',
    title,
    tellMorePrompt: `Was wäre jetzt bei ${name} am hilfreichsten — eine kurze Idee, die zu mir passt?`,
  });
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
    tellMorePrompt: `Kurz: wie komme ich zu ${place}, Ankunftszeit, und worauf soll ich achten?`,
  });
}

function tipToCard(tip: HudTipCandidate): LiveHudCard {
  const fallbackAsk =
    tip.kind === 'battery_charge'
      ? 'Akku wird knapp — such Powerbank-Automaten oder Café mit Steckdosen in der Nähe und gib mir Route-Buttons.'
      : tip.kind === 'weather_rain'
        ? 'Regen-Hinweis: Schirm/Jacke oder Indoor/Café mit Route — was hilft mir jetzt?'
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
  return polishCard({
    id: 'parking-spot',
    title: line.title,
    meta: line.meta ? `${line.meta} · Tippen hilft?` : 'Tippen für Leave-by',
    tellMorePrompt:
      'Mein Parkticket / Parkplatz — Countdown, wann ich zum Auto muss, und Route zurück.',
  });
}

function timerCard(nowMs: number): LiveHudCard | null {
  try {
    const { getActiveTimer } = require('../alarms/timerService') as {
      getActiveTimer: () => { endsAtMs: number; label: string } | null;
    };
    const t = getActiveTimer();
    if (!t || t.endsAtMs <= nowMs) return null;
    const remMin = Math.max(1, Math.ceil((t.endsAtMs - nowMs) / 60_000));
    return polishCard({
      id: `timer-${t.endsAtMs}`,
      title: `⏱️ ${t.label} · noch ${remMin} Min`,
      meta: 'Timer · Tippen für Status',
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

/** Wetter — möglichst oft im Idle-Carousel; Regen schon ab ~90 Min. */
function weatherCard(): LiveHudCard | null {
  const snap = getCachedWeatherSnapshot();
  if (!snap?.summaryLine?.trim()) return null;
  const rainMins =
    snap.rainStartsInMin != null
      ? snap.rainStartsInMin
      : snap.nextRainAtMs != null
        ? Math.round((snap.nextRainAtMs - Date.now()) / 60_000)
        : null;
  const rain =
    rainMins != null && rainMins >= 0 && rainMins <= 90
      ? rainMins <= 30
        ? `Regen in ~${rainMins} Min — Schirm/Indoor?`
        : `Regen in ~${rainMins} Min möglich`
      : null;
  return polishCard({
    id: 'weather-live',
    title: rain ? `🌧 ${rain}` : 'Wetter',
    meta: rain
      ? `${snap.summaryLine.trim()}\nTippen für Plan-Check`
      : snap.summaryLine.trim(),
    tellMorePrompt: '__WEATHER_DAY_CHECK__',
  });
}

function sunsetCard(nowMs: number): LiveHudCard | null {
  const h = new Date(nowMs).getHours();
  if (h < 15 || h > 21) return null;
  const snap = getCachedWeatherSnapshot() as {
    sunsetMs?: number | null;
  } | null;
  const sunsetMs =
    typeof snap?.sunsetMs === 'number' && Number.isFinite(snap.sunsetMs)
      ? snap.sunsetMs
      : null;
  if (sunsetMs == null || sunsetMs < nowMs - 20 * 60_000) {
    return polishCard({
      id: 'sunset-soft',
      title: 'Sonnenuntergang',
      meta: 'Uhrzeit laden… zwei Spots mit freiem Horizont suchen.',
      tellMorePrompt:
        'Wann genau ist Sonnenuntergang? Starte einen Countdown und nenne mir zwei konkrete Spots mit freiem Horizont in der Nähe inkl. Route.',
    });
  }
  const mins = Math.round((sunsetMs - nowMs) / 60_000);
  const clock = formatClock(sunsetMs);
  const meta =
    mins > 1
      ? `Noch ${mins} Min · ${clock} Uhr — zwei Horizont-Spots`
      : mins >= 0
        ? `Jetzt (${clock} Uhr) — besten Spot ansteuern`
        : `War um ${clock} Uhr — morgen wieder`;
  return polishCard({
    id: 'sunset-live',
    title: `Sonnenuntergang ${clock}`,
    meta,
    tellMorePrompt:
      `Sonnenuntergang ist um ${clock} Uhr` +
      (mins > 0 ? ` (noch ca. ${mins} Min)` : '') +
      `. Bitte Countdown/Leave-by setzen und zwei konkrete Spots mit freiem Horizont in der Nähe vorschlagen — mit Route.`,
  });
}

function dinnerCard(nowMs: number): LiveHudCard | null {
  const slot = resolveMealSlot(nowMs);
  // Nur in sinnvollen Fenstern zeigen
  const h = new Date(nowMs).getHours();
  if (slot === 'bakery' && (h < 6 || h >= 11)) return null;
  if (slot === 'lunch' && (h < 11 || h >= 16)) return null;
  if (slot === 'dinner' && (h < 16 || h > 22)) return null;

  const cached = getMealHudCache();
  if (cached && cached.slot === slot && cached.items.length > 0) {
    return polishCard({
      id: `meal-${slot}`,
      title: cached.title,
      meta: cached.meta,
      tellMorePrompt: cached.tellMorePrompt,
    });
  }

  // Fallback ohne GPS-Suche — klar als Platzhalter, kein Fake-Lokalname
  const label =
    slot === 'bakery'
      ? 'Bäckerei in der Nähe'
      : slot === 'lunch'
        ? 'Mittagessen in der Nähe'
        : 'Abendessen in der Nähe';
  return polishCard({
    id: `meal-${slot}-soft`,
    title: label,
    meta: 'Offene Lokale mit Fußweg-Zeit werden geladen…',
    tellMorePrompt: `Zwei konkrete ${label}-Tipps mit Öffnungszeiten, Fußweg-Minuten und Route.`,
  });
}

function pushThemeCards(
  push: (c: LiveHudCard | null) => void,
  themes: Set<HudOptionalTheme>,
  nowMs: number,
): void {
  if (themes.has('sunset')) push(sunsetCard(nowMs));
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
}): LiveHudCard[] {
  const nowMs = opts?.nowMs ?? Date.now();
  const store = useFinnusStore.getState();
  const navigating = store.navActive && store.navVisible;
  const atPoi = store.currentPoiId != null && !!store.currentLocationName?.trim();

  const mode =
    opts?.mode ??
    (atPoi ? 'poi' : navigating ? 'nav' : 'idle');

  if (mode === 'poi') {
    return [placeCard()];
  }

  if (mode === 'nav') {
    const cards: LiveHudCard[] = [navCard()];
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

  push(placeCard());
  push(weatherCard());
  push(timerCard(nowMs));
  push(parkingCard(nowMs));

  // Utility-Tipps zuerst (Wecker, Akku, Bahn, Leave-by, Regen …)
  evaluateProactiveHud({ force: false });
  const utilityTips = collectHudTipCandidates({ nowMs })
    .filter(
      (t) =>
        UTILITY_TIP_KINDS.has(t.kind) ||
        (t.score >= 70 && t.kind !== 'weather_summary'),
    )
    .sort((a, b) => b.score - a.score);
  for (const tip of utilityTips) {
    if (tip.id.startsWith('wx-')) continue;
    // Parken schon als parkingCard
    if (tip.kind === 'parking_ticket' && seen.has('parking-spot')) continue;
    push(tipToCard(tip));
    if (cards.length >= MAX_IDLE_CARDS) break;
  }

  // Nearby: Klo / Trinkwasser / Eis — nur wenn Treffer in Cache
  if (allowActivitySoftTips(nowMs)) {
    const amenityCards = getNearbyAmenityHudCards(nowMs).sort(
      (a, b) => b.score - a.score,
    );
    // Max 2 Amenity-Karten, damit es nicht aufdringlich wird
    let amenityPushed = 0;
    for (const a of amenityCards) {
      if (amenityPushed >= 2) break;
      push(
        polishCard({
          id: a.id,
          title: a.title,
          meta: a.meta,
          tellMorePrompt: a.tellMorePrompt,
        }),
      );
      amenityPushed += 1;
    }

    // Eingeklemmte Ideen (Plan/Liste/Wunsch) — eine Karte reicht
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

  // Nachtruhe: keine Soft-Aktivitäts-Tips
  if (isNachtruhe(nowMs) || !allowActivitySoftTips(nowMs)) {
    return cards.length ? cards.slice(0, MAX_IDLE_CARDS) : [placeCard()];
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

  return cards.length ? cards.slice(0, MAX_IDLE_CARDS) : [placeCard()];
}
