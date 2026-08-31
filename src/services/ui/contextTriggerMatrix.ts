/**
 * Context Trigger Matrix — ~40 Touristen-Situationen + Ableitungen.
 * Speist HUD / Action-Button-Policy (alle ~15 Min oder bei Fokus).
 */

import type { QuickAction } from '../../types/concierge';
import { useUserMemoryStore } from '../../store/useUserMemoryStore';
import { useShoppingTaskStore } from '../../store/useShoppingTaskStore';
import { useSessionPlanStore } from '../../store/useSessionPlanStore';
import { getCachedUserProfile } from '../userProfileService';
import { useFinnusStore } from '../../store/useFinnusStore';
import { getCachedWeatherSnapshot } from '../weatherService';
import { resolveActiveTravelMode } from '../navigation/travelModeContext';
import { isPostMidnightWindow } from '../time/temporalGerman';
import { resolvePlacePresence } from '../geo/placePresence';
import { getBatteryLevelAsync } from 'expo-battery';
import {
  ACTIVITY_TRIGGER_IDS,
  isActivitySuggestionWindow,
  isNachtruhe,
} from './nachtruhePolicy';

export type DayPart = 'night' | 'morning' | 'day' | 'evening';

export type TriggerId =
  | 'weather_briefing'
  | 'hotel_breakfast'
  | 'route_by_weather'
  | 'pack_list'
  | 'wake_alarm_check'
  | 'lunch_nearby'
  | 'toilet_nearby'
  | 'drinking_water_nearby'
  | 'ice_cream_hot'
  | 'park_pause'
  | 'photo_spots'
  | 'low_battery_charge'
  | 'sudden_rain_indoor'
  | 'poi_dwell_fact'
  | 'dinner_reservation'
  | 'route_home'
  | 'sunset_spot'
  | 'supermarket_evening'
  | 'day_summary'
  | 'bike_stand_pump'
  | 'transit_next_stop'
  | 'profile_burger'
  | 'profile_tennis'
  | 'open_shopping_task'
  | 'session_next_stop';

export type TriggerCandidate = {
  id: TriggerId;
  score: number;
  title: string;
  prompt: string;
  actions?: QuickAction[];
};

let cachedBattery: number | null = null;
let lastBatteryFetchMs = 0;

export function getCachedBatteryLevel01(): number | null {
  return cachedBattery;
}

/** Soft battery cache for HUD (non-blocking). */
export function refreshBatteryCache(): void {
  const now = Date.now();
  if (now - lastBatteryFetchMs < 60_000) return;
  lastBatteryFetchMs = now;
  void getBatteryLevelAsync()
    .then((v) => {
      cachedBattery = typeof v === 'number' && Number.isFinite(v) ? v : null;
    })
    .catch(() => {
      cachedBattery = null;
    });
}

function dayPart(now = new Date()): DayPart {
  const h = now.getHours();
  if (h < 5 || isPostMidnightWindow(now)) return 'night';
  if (h < 11) return 'morning';
  if (h < 17) return 'day';
  return 'evening';
}

/**
 * Bewertet Trigger und liefert Top-N Vorschläge.
 */
export function evaluateContextTriggers(opts?: {
  now?: Date;
  limit?: number;
}): TriggerCandidate[] {
  refreshBatteryCache();
  const now = opts?.now ?? new Date();
  const limit = opts?.limit ?? 6;
  const part = dayPart(now);
  const presence = resolvePlacePresence();
  const atHotel = presence.role === 'hotel';
  const profile = getCachedUserProfile();
  const weather = getCachedWeatherSnapshot();
  const hotel = useUserMemoryStore.getState().getConfirmedHotel();
  const mode = resolveActiveTravelMode().mode;
  const tasks = useShoppingTaskStore.getState().getOpenTasks();
  const plan = useSessionPlanStore.getState().plan;
  const bat = cachedBattery;
  const rain =
    weather?.isHeavyRain ||
    (weather?.precipitationMm != null && weather.precipitationMm > 0.4);
  const out: TriggerCandidate[] = [];

  const push = (c: TriggerCandidate) => {
    if (c.score <= 0) return;
    out.push(c);
  };

  // —— Morgens / Hotel ——
  if (atHotel && (part === 'morning' || part === 'night')) {
    push({
      id: 'weather_briefing',
      score: part === 'morning' ? 90 : 55,
      title: 'Wetter-Briefing',
      prompt: 'Was ziehe ich heute an — kurzes Wetter-Briefing?',
    });
    push({
      id: 'hotel_breakfast',
      score: 88,
      title: 'Frühstückszeiten',
      prompt: hotel
        ? `Wann gibt es Frühstück bei ${hotel.name}? Bitte live recherchieren, nichts schätzen.`
        : 'Wann gibt es Frühstück in meinem Hotel? Live recherchieren.',
      actions: [
        {
          type: 'SHOW_MORE',
          label: 'Frühstück prüfen',
          payload: {
            textPrompt: hotel
              ? `Frühstückszeiten ${hotel.name} heute — live suchen`
              : 'Frühstückszeiten meines Hotels heute — live suchen',
          },
        },
      ],
    });
    push({
      id: 'route_by_weather',
      score: 70,
      title: 'Route nach Wetter',
      prompt: 'Schlage eine Route für heute vor, passend zum Wetter.',
    });
    push({
      id: 'pack_list',
      score: rain ? 85 : 60,
      title: 'Packliste',
      prompt: rain
        ? 'Packliste: Regenschirm / Jacke — was brauche ich?'
        : 'Packliste: Sonnencreme oder eher Jacke?',
    });
    push({
      id: 'wake_alarm_check',
      score: part === 'night' ? 92 : 40,
      title: 'Wecker',
      prompt: 'Wecker für morgen — passende Zeit vorschlagen und stellen.',
      actions: [
        {
          type: 'SET_WAKE_ALARM',
          label: 'Wecker stellen',
          payload: { destName: 'Aufstehen' },
        },
      ],
    });
  }

  // —— Tagsüber unterwegs ——
  if (!atHotel && (part === 'day' || part === 'morning')) {
    push({
      id: 'lunch_nearby',
      score: now.getHours() >= 11 && now.getHours() < 15 ? 86 : 40,
      title: 'Mittagessen nah?',
      prompt: 'Mittagessen in unter 500 Metern — konkrete Orte, live.',
    });
    push({
      id: 'toilet_nearby',
      score: 42,
      title: 'Klo in der Nähe?',
      prompt:
        'Falls hilfreich: nächste öffentliche Toilette in der Nähe — Distanz und Route, ohne Drama.',
    });
    push({
      id: 'drinking_water_nearby',
      score: 40,
      title: 'Trinkwasser um die Ecke?',
      prompt:
        'Trinkbrunnen oder Trinkwasser in der Nähe — kurz mit Distanz und Route.',
    });
    push({
      id: 'park_pause',
      score: 48,
      title: 'Pause / Park?',
      prompt: 'Sitzmöglichkeit oder Park zum Durchatmen in der Nähe?',
    });
    push({
      id: 'photo_spots',
      score: profile?.experiencePrefs?.aussichten === 'yes' ? 75 : 45,
      title: 'Foto-Spot hier?',
      prompt: 'Fotogener Spot in der Nähe — einer reicht.',
    });
  }

  // Hitze → Eis (locker)
  {
    const line = (weather?.summaryLine ?? '').toLowerCase();
    const tempM = line.match(/(\d{1,2})\s*grad/i);
    const hot =
      (tempM != null && Number(tempM[1]) >= 26) ||
      /heiß|hitze|schwül|sehr warm/.test(line);
    if (hot && !atHotel && (part === 'day' || part === 'evening')) {
      push({
        id: 'ice_cream_hot',
        score: 58,
        title: 'Heiß heute — Eis gefällig?',
        prompt:
          'Nächste Eisdiele in der Nähe mit Distanz und Route — locker, kein Upsell.',
      });
    }
  }

  if (bat != null && bat < 0.25) {
    push({
      id: 'low_battery_charge',
      score: bat < 0.18 ? 96 : bat < 0.2 ? 92 : 80,
      title: 'Brauchst du mehr Akku?',
      prompt:
        'Akku wird knapp — such Powerbank-Automaten oder Café mit Steckdosen in der Nähe und gib mir Route-Buttons.',
    });
  }

  if (rain && !atHotel) {
    push({
      id: 'sudden_rain_indoor',
      score: 93,
      title: 'Regen → Indoor',
      prompt: 'Es regnet — Indoor-Idee / Museum / Café in der Nähe?',
    });
  }

  if (presence.role === 'poi') {
    push({
      id: 'poi_dwell_fact',
      score: 72,
      title: 'POI-Fakt',
      prompt: 'Kurzer historischer Fakt zu dem Ort, vor dem ich stehe.',
    });
  }

  // —— Abends ——
  if (part === 'evening' || part === 'night') {
    push({
      id: 'dinner_reservation',
      score: atHotel ? 70 : 82,
      title: 'Abendessen',
      prompt:
        'Zwei konkrete Restaurants fürs Abendessen — Namen, kurze Beschreibung, Route.',
    });
    if (hotel && !atHotel) {
      push({
        id: 'route_home',
        score: 88,
        title: 'Zurück zum Hotel',
        prompt: `Bring mich zurück zu ${hotel.name}.`,
        actions: [
          {
            type: 'START_NAVIGATION',
            label: `Zu ${hotel.name}`,
            payload: {
              destName: hotel.name,
              destLat: hotel.lat ?? undefined,
              destLng: hotel.lng ?? undefined,
              targetPoiId: hotel.poiId ?? undefined,
            },
          },
        ],
      });
    }
    push({
      id: 'sunset_spot',
      score: now.getHours() >= 17 && now.getHours() < 21 ? 78 : 35,
      title: (() => {
        const wx = getCachedWeatherSnapshot() as {
          sunsetMs?: number | null;
          summaryLine?: string | null;
          weatherCode?: number | null;
          precipitationMm?: number | null;
          isHeavyRain?: boolean;
        } | null;
        let sunsetMs =
          wx?.sunsetMs && wx.sunsetMs > Date.now() - 30 * 60_000
            ? wx.sunsetMs
            : null;
        if (sunsetMs == null) {
          try {
            const store = require('../../store/useFinnusStore') as {
              useFinnusStore: {
                getState: () => {
                  lastGpsLat: number | null;
                  lastGpsLng: number | null;
                };
              };
            };
            const { computeSunsetMs } = require('../geo/solarTimes') as {
              computeSunsetMs: (
                lat: number,
                lng: number,
                nowMs: number,
              ) => number | null;
            };
            const g = store.useFinnusStore.getState();
            if (
              g.lastGpsLat != null &&
              g.lastGpsLng != null &&
              Number.isFinite(g.lastGpsLat) &&
              Number.isFinite(g.lastGpsLng)
            ) {
              sunsetMs = computeSunsetMs(
                g.lastGpsLat,
                g.lastGpsLng,
                Date.now(),
              );
            }
          } catch {
            /* soft */
          }
        }
        if (sunsetMs == null || sunsetMs <= Date.now() - 30 * 60_000) {
          return 'Sonnenuntergang';
        }
        const t = new Date(sunsetMs).toLocaleTimeString('de-DE', {
          hour: '2-digit',
          minute: '2-digit',
        });
        // Uhr zuerst — Truncation darf die Zeit nicht schlucken
        return `🌅 ${t} Sonnenuntergang`;
      })(),
      prompt:
        'Wann genau ist Sonnenuntergang, wie ist das Wetter dafür, und wo der beste Spot — Route wenn klar.',
    });
    // supermarket_evening: nur Fallback — konkrete Nearby-Karte schlägt später
    push({
      id: 'day_summary',
      score: part === 'evening' ? 65 : 40,
      title: 'Tages-Zusammenfassung',
      prompt: 'Kurze Zusammenfassung: Wo waren wir heute?',
    });
  }

  // —— Transport ——
  if (mode === 'bike') {
    push({
      id: 'bike_stand_pump',
      score: 60,
      title: 'Fahrrad',
      prompt: 'Fahrradständer oder Luftpumpe in der Nähe?',
    });
  }
  if (mode === 'transit') {
    push({
      id: 'transit_next_stop',
      score: 70,
      title: 'ÖPNV',
      prompt: 'Nächste Haltestelle und aktuelle Verspätungen?',
    });
  }

  // —— Profil ——
  const blob = [
    profile?.aboutMe,
    profile?.wantToExperience,
    ...(profile?.learnedFacts ?? []),
  ]
    .join(' ')
    .toLowerCase();
  if (/burger|smash|cheeseburger/.test(blob)) {
    push({
      id: 'profile_burger',
      score: part === 'day' || part === 'evening' ? 74 : 40,
      title: 'Burger lokal',
      prompt: 'Lokale Burger-Alternativen in der Nähe — konkret.',
    });
  }
  if (/tennis/.test(blob)) {
    push({
      id: 'profile_tennis',
      score: 62,
      title: 'Tennis',
      prompt: 'Tennisplätze oder lokale Turniere / Infos hier?',
    });
  }

  if (tasks.length) {
    const t = tasks[0]!;
    push({
      id: 'open_shopping_task',
      score: 70,
      title: `Noch auf der Liste: ${t.itemLabel}?`,
      prompt: `Erinnerung: ${t.itemLabel} — wo erledigen, wenn’s jetzt passt?`,
    });
  }

  if (plan?.active && plan.stops?.some((s) => !s.done)) {
    const next = plan.stops.find((s) => !s.done);
    if (next) {
      push({
        id: 'session_next_stop',
        score: 72,
        title: `${next.label} — noch offen?`,
        prompt: `Nächster Plan-Stop: ${next.label} — Route oder Leave-by?`,
        actions: [
          {
            type: 'START_NAVIGATION',
            label: next.label,
            payload: {
              destName: next.label,
              destLat: next.lat ?? undefined,
              destLng: next.lng ?? undefined,
            },
          },
        ],
      });
    }
  }

  return out
    .filter((c) => {
      // Nachtruhe: keine Aktivitäts-Vorschläge — nur Wecker / nächster Plan-Stop
      if (isNachtruhe(now.getTime())) {
        return c.id === 'session_next_stop' || c.id === 'wake_alarm_check';
      }
      // Tagsüber: vor allem „was man machen könnte“
      if (isActivitySuggestionWindow(now.getTime())) {
        return (
          ACTIVITY_TRIGGER_IDS.has(c.id) ||
          c.id === 'session_next_stop' ||
          c.id === 'open_shopping_task' ||
          c.id === 'transit_next_stop' ||
          c.id === 'route_home'
        );
      }
      return false;
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/** Filter: keine START_NAVIGATION ohne expliziten User-Nav-Wunsch im Hotel. */
export function filterActionsForContext(
  actions: QuickAction[],
  opts?: { explicitNav?: boolean },
): QuickAction[] {
  const presence = resolvePlacePresence();
  const part = dayPart();
  const explicit = !!opts?.explicitNav;

  return actions.filter((a) => {
    if (a.type !== 'START_NAVIGATION') return true;
    if (explicit) return true;
    if (presence.role === 'hotel' && (part === 'night' || part === 'evening')) {
      return false;
    }
    return true;
  });
}

export function contextTriggerPromptBlock(): string {
  const top = evaluateContextTriggers({ limit: 5 });
  if (!top.length) return '';
  return [
    '=== KONTEXT-TRIGGER (Vorschläge, nicht erzwingen) ===',
    ...top.map((t) => `- [${t.score}] ${t.id}: ${t.title} — ${t.prompt}`),
    'Action-Buttons nur kontextpassend. Keine proaktive Navigation ohne Wunsch.',
    'Keine geschätzten Öffnungszeiten — Tools/Live-Suche.',
  ].join('\n');
}
