/**
 * Proaktive HUD-Engine — abstraktes Schema, keine Einzelfall-Kette.
 *
 * Kandidaten (TipCandidate) bewerten kontinuierlich Kontext:
 * Zeit · GPS · User-Memory · Wetter · offene Tasks · Session-Plan.
 * Alle ~15 Min (und on demand) neu evaluieren; HUD zeigt den
 * relevantesten Tipp (höchster Score).
 */

import { haversineMeters } from '../../db/database';
import { useFinnusStore } from '../../store/useFinnusStore';
import { useUserMemoryStore } from '../../store/useUserMemoryStore';
import { useShoppingTaskStore } from '../../store/useShoppingTaskStore';
import { useSessionPlanStore } from '../../store/useSessionPlanStore';
import { getCachedWeatherSnapshot } from '../weatherService';
import {
  evaluateContextTriggers,
  getCachedBatteryLevel01,
  refreshBatteryCache,
} from './contextTriggerMatrix';
import { allowProactiveHudTip } from './nachtruhePolicy';

export const HUD_ENGINE_INTERVAL_MS = 15 * 60_000;

export type HudTipKind =
  | 'hotel_breakfast'
  | 'hotel_checkin'
  | 'shopping_closing'
  | 'session_deadline'
  | 'weather_rain'
  | 'weather_heat'
  | 'weather_summary'
  | 'luggage_drop'
  | 'umbrella_day'
  | 'sunset_tip'
  | 'free_slot'
  | 'nice_tip'
  | 'open_task'
  | 'battery_charge'
  | 'wake_alarm'
  | 'parking_ticket'
  | 'nav_eta'
  | 'transit_depart'
  | 'generic';

export type HudTipCandidate = {
  id: string;
  kind: HudTipKind;
  /** HUD-Titelzeile */
  text: string;
  /** Meta unter dem Titel */
  meta?: string;
  /** Tippen → konkreter Concierge-/Discovery-Prompt */
  tellMorePrompt?: string;
  /**
   * 0–100 — höher = dringender / relevanter.
   * Engine pickt max score (bei Gleichstand frühere kind-Priorität).
   */
  score: number;
};

export type HudTipContext = {
  nowMs: number;
  lat: number | null;
  lng: number | null;
};

type TipProducer = (ctx: HudTipContext) => HudTipCandidate[];

const KIND_TIEBREAK: Record<HudTipKind, number> = {
  battery_charge: 95,
  parking_ticket: 92,
  shopping_closing: 90,
  session_deadline: 85,
  wake_alarm: 84,
  transit_depart: 83,
  nav_eta: 82,
  hotel_checkin: 80,
  hotel_breakfast: 75,
  weather_rain: 72,
  weather_heat: 58,
  luggage_drop: 57,
  sunset_tip: 52,
  umbrella_day: 50,
  free_slot: 48,
  nice_tip: 45,
  open_task: 55,
  weather_summary: 40,
  generic: 10,
};

function formatClock(ms: number): string {
  return new Date(ms).toLocaleTimeString('de-DE', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function parseClockToMinutes(raw: string): number | null {
  const m = raw.trim().match(/^(\d{1,2})[:.](\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/** Extract first HH:MM after a keyword in free-form hotel notes. */
function extractTimeAfter(
  notes: string,
  keywordRe: RegExp,
): { label: string; minutes: number } | null {
  const m = notes.match(keywordRe);
  if (!m) return null;
  const mins = parseClockToMinutes(m[1] ?? m[2] ?? '');
  if (mins == null) return null;
  const h = Math.floor(mins / 60);
  const min = mins % 60;
  const label = `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
  return { label, minutes: mins };
}

function minutesOfDay(nowMs: number): number {
  const d = new Date(nowMs);
  return d.getHours() * 60 + d.getMinutes();
}

function distanceToHotelM(
  lat: number | null,
  lng: number | null,
): number | null {
  const hotel = useUserMemoryStore.getState().getConfirmedHotel();
  if (
    !hotel ||
    typeof hotel.lat !== 'number' ||
    typeof hotel.lng !== 'number' ||
    lat == null ||
    lng == null
  ) {
    return null;
  }
  return haversineMeters(lat, lng, hotel.lat, hotel.lng);
}

// ── Producers (add new situations here — engine stays unchanged) ──

const produceHotelBreakfast: TipProducer = (ctx) => {
  const hotel = useUserMemoryStore.getState().getConfirmedHotel();
  if (!hotel?.notes) return [];
  const parsed = extractTimeAfter(
    hotel.notes,
    /frühstück|fruehstueck|breakfast[^\d]{0,24}?(\d{1,2}[:.]\d{2})|bis\s+(\d{1,2}[:.]\d{2})/i,
  );
  // Also: "Frühstück … 10:30" / "bis 10:30"
  const until =
    parsed ??
    extractTimeAfter(
      hotel.notes,
      /frühstück[^\n]{0,40}?bis\s+(\d{1,2}[:.]\d{2})/i,
    ) ??
    extractTimeAfter(
      hotel.notes,
      /(\d{1,2}[:.]\d{2})\s*(?:uhr)?[^\n]{0,12}frühstück/i,
    );

  // Soft default when notes mention breakfast without time
  let endLabel = until?.label ?? null;
  let endMins = until?.minutes ?? null;
  if (
    !endLabel &&
    /frühstück|fruehstueck|breakfast/i.test(hotel.notes)
  ) {
    endLabel = '10:30';
    endMins = 10 * 60 + 30;
  }
  if (!endLabel || endMins == null) return [];

  const nowM = minutesOfDay(ctx.nowMs);
  // Morning window: 05:00 – end+30
  if (nowM < 5 * 60 || nowM > endMins + 30) return [];

  const remaining = endMins - nowM;
  let score = 55;
  if (remaining <= 45) score = 88;
  else if (remaining <= 90) score = 72;
  else if (nowM < 9 * 60) score = 68;

  // Stronger if still near/at hotel
  const d = distanceToHotelM(ctx.lat, ctx.lng);
  if (d != null && d < 250) score += 8;

  return [
    {
      id: `breakfast-${endLabel}`,
      kind: 'hotel_breakfast',
      text: `Frühstück gibt es bis ${endLabel} Uhr`,
      meta: hotel.name ? `Hotel · ${hotel.name}` : 'Hotel',
      score: Math.min(100, score),
    },
  ];
};

const produceHotelCheckout: TipProducer = (ctx) => {
  const hotel = useUserMemoryStore.getState().getConfirmedHotel();
  if (!hotel) return [];
  const notes = hotel.notes ?? '';
  const parsed =
    extractTimeAfter(
      notes,
      /check[\s-]?out|auscheck(?:en)?[^\d]{0,20}?(\d{1,2}[:.]\d{2})|bis\s+(\d{1,2}[:.]\d{2})\s*(?:uhr)?[^\n]{0,12}(?:raus|check)/i,
    ) ??
    extractTimeAfter(notes, /(\d{1,2}[:.]\d{2})\s*(?:uhr)?[^\n]{0,16}check[\s-]?out/i);

  if (!parsed) return [];
  const nowM = minutesOfDay(ctx.nowMs);
  const remaining = parsed.minutes - nowM;
  if (remaining < -30 || remaining > 8 * 60) return [];

  let score = 70;
  if (remaining <= 45) score = 92;
  else if (remaining <= 120) score = 80;
  const d = distanceToHotelM(ctx.lat, ctx.lng);
  if (d != null && d < 400) score += 6;

  return [
    {
      id: `checkout-${parsed.label}`,
      kind: 'session_deadline',
      text:
        remaining > 0
          ? `Checkout um ${parsed.label} · in ${remaining} Min`
          : `Checkout um ${parsed.label} Uhr`,
      meta: hotel.name ? `Hotel · ${hotel.name}` : 'Hotel',
      score: Math.min(100, score),
    },
  ];
};

const produceHotelCheckin: TipProducer = (ctx) => {
  const hotel = useUserMemoryStore.getState().getConfirmedHotel();
  if (!hotel) return [];
  const notes = hotel.notes ?? '';
  const parsed =
    extractTimeAfter(
      notes,
      /check[\s-]?in|eincheck(?:en)?[^\d]{0,20}?(\d{1,2}[:.]\d{2})|ab\s+(\d{1,2}[:.]\d{2})/i,
    ) ??
    extractTimeAfter(notes, /einchecken\s+ab\s+(\d{1,2}[:.]\d{2})/i);

  const fromLabel = parsed?.label ?? (/check[\s-]?in|eincheck/i.test(notes) ? '15:00' : null);
  const fromMins = parsed?.minutes ?? (fromLabel === '15:00' ? 15 * 60 : null);
  if (!fromLabel || fromMins == null) return [];

  const d = distanceToHotelM(ctx.lat, ctx.lng);
  // Approaching hotel: 80 m – 800 m
  if (d == null || d > 800 || d < 60) return [];

  const nowM = minutesOfDay(ctx.nowMs);
  let score = 60;
  if (nowM < fromMins) {
    score = 78 + Math.max(0, 12 - Math.floor((fromMins - nowM) / 30));
  } else {
    score = 70; // already past check-in time, still useful
  }
  if (d < 300) score += 10;

  return [
    {
      id: `checkin-${fromLabel}`,
      kind: 'hotel_checkin',
      text: `Einchecken ab ${fromLabel} Uhr möglich`,
      meta: hotel.name ? `Zielhotel · ${hotel.name}` : 'Zielhotel',
      score: Math.min(100, score),
    },
  ];
};

const produceShoppingClosing: TipProducer = (ctx) => {
  const tasks = useShoppingTaskStore.getState().getOpenTasks();
  const shopTasks = tasks.filter(
    (t) =>
      t.anchor === 'store' ||
      t.placeTypes.length > 0 ||
      /cola|bier|zahnbürste|zahnbuerste|einkauf|shop|supermakt|drogerie/i.test(
        t.itemLabel,
      ),
  );
  if (!shopTasks.length) return [];

  const nowM = minutesOfDay(ctx.nowMs);
  // Evening pressure from ~17:00
  if (nowM < 17 * 60) return [];

  // Typical DE supermarket close ~20:00 (abstract default; city packs can refine later)
  const closeMins = 20 * 60;
  const remaining = closeMins - nowM;
  if (remaining < -30) return []; // already late evening

  const items = shopTasks
    .slice(0, 2)
    .map((t) => t.itemLabel)
    .join(', ');
  const closeLabel = '20:00';

  let score = 62;
  if (remaining <= 60) score = 92;
  else if (remaining <= 120) score = 80;
  else score = 68;

  return [
    {
      id: `shop-close-${closeLabel}`,
      kind: 'shopping_closing',
      text: `Achtung: Supermärkte schließen hier um ${closeLabel} Uhr`,
      meta: items ? `Offen: ${items}` : 'Offene Einkäufe',
      score,
    },
  ];
};

const produceSessionDeadline: TipProducer = (ctx) => {
  const plan = useSessionPlanStore.getState().getActivePlan();
  if (!plan) return [];
  const tips: HudTipCandidate[] = [];

  if (plan.leaveByMs != null) {
    const delta = plan.leaveByMs - ctx.nowMs;
    if (delta > 0 && delta <= 3 * 60 * 60_000) {
      const mins = Math.max(1, Math.round(delta / 60_000));
      const score =
        delta <= 20 * 60_000 ? 96 : delta <= 45 * 60_000 ? 88 : delta <= 90 * 60_000 ? 78 : 68;
      const countdown =
        mins <= 90
          ? `In ${mins} Min losgehen`
          : `Spätestens ${formatClock(plan.leaveByMs)} Uhr los`;
      tips.push({
        id: `leaveby-${plan.leaveByMs}`,
        kind: 'session_deadline',
        text: countdown,
        meta: `Leave-by ${formatClock(plan.leaveByMs)}`,
        tellMorePrompt: `Leave-by ${formatClock(plan.leaveByMs)} — kurz bestätigen und Route/nächste Schritte, falls ich jetzt los muss.`,
        score,
      });
    }
  }

  for (const stop of plan.stops.filter((s) => !s.done && s.arriveByMs != null)) {
    const delta = stop.arriveByMs! - ctx.nowMs;
    if (delta > 0 && delta <= 3 * 60 * 60_000) {
      const score =
        delta <= 45 * 60_000 ? 88 : delta <= 90 * 60_000 ? 74 : 60;
      tips.push({
        id: `arrive-${stop.id}`,
        kind: 'session_deadline',
        text: `${stop.label} bis ${formatClock(stop.arriveByMs!)} Uhr`,
        meta: 'Termin',
        tellMorePrompt: `Termin „${stop.label}“ bis ${formatClock(stop.arriveByMs!)} — wann los und Route?`,
        score,
      });
    }
  }

  return tips;
};

const produceWeather: TipProducer = () => {
  const tips: HudTipCandidate[] = [];
  let allowRainWarn = true;
  try {
    const { canIssueProactiveRainWarning } = require('../weather/rainWarnSessionGate') as {
      canIssueProactiveRainWarning: () => boolean;
    };
    allowRainWarn = canIssueProactiveRainWarning();
  } catch {
    allowRainWarn = true;
  }

  if (allowRainWarn) {
    try {
      const { getWeatherHudLine, getWeatherTrackerState } = require('../logistics/weatherTracker') as {
        getWeatherHudLine: () => string | null;
        getWeatherTrackerState: () => {
          nextRainAtMs: number | null;
          rainStartsInMin: number | null;
          summaryLine: string;
        } | null;
      };
      const line = getWeatherHudLine();
      const st = getWeatherTrackerState();
      if (line) {
        const rainingNow = /^(🌧\s*)?Regen (jetzt|noch )/i.test(line);
        const soonClock = /^Regen ab /i.test(line);
        const mins = rainingNow
          ? 0
          : soonClock
            ? 90
            : st?.nextRainAtMs != null
              ? Math.round((st.nextRainAtMs - Date.now()) / 60_000)
              : 99;
        const soon = rainingNow || mins <= 30;
        tips.push({
          id: `rain-hud-${st?.nextRainAtMs ?? 'now'}`,
          kind: 'weather_rain',
          text: line.startsWith('🌧') ? line : `🌧 ${line}`,
          meta: rainingNow
            ? 'Aktuelle Dauer'
            : soon
              ? 'Schirm dabei?'
              : mins <= 90
                ? 'Bald nass'
                : undefined,
          tellMorePrompt: rainingNow
            ? 'Es regnet — Café oder Indoor in der Nähe mit Route.'
            : soon
              ? 'Regen bald — Café oder Indoor in der Nähe mit Route, und sag mir ob Schirm sinnvoll ist.'
              : `In etwa ${mins} Minuten könnte es regnen — was soll ich anpassen (Route, Indoor, Schirm)?`,
          score: rainingNow || mins <= 5 ? 95 : mins <= 30 ? 88 : mins <= 90 ? 74 : 60,
        });
      }
    } catch {
      /* soft */
    }
  } else {
    // Auch ohne Warn-Gate: akuter Regen-Status (jetzt / noch …).
    try {
      const { getWeatherHudLine } = require('../logistics/weatherTracker') as {
        getWeatherHudLine: () => string | null;
      };
      const line = getWeatherHudLine();
      if (line && /^(🌧\s*)?Regen (jetzt|noch )/i.test(line)) {
        tips.push({
          id: 'rain-hud-now',
          kind: 'weather_rain',
          text: line.startsWith('🌧') ? line : `🌧 ${line}`,
          meta: 'Aktuelle Regendauer',
          tellMorePrompt: 'Es regnet — Café oder Indoor in der Nähe mit Route.',
          score: 95,
        });
      }
    } catch {
      /* soft */
    }
  }

  const weather = getCachedWeatherSnapshot();
  if (!weather) return tips;

  if (allowRainWarn && !tips.some((t) => t.kind === 'weather_rain')) {
    try {
      const { formatRainHudLine } = require('../weather/rainIncomingPolicy') as {
        formatRainHudLine: (opts: {
          currentPrecipMm?: number | null;
          rainStartsInMin?: number | null;
          nextRainAtMs?: number | null;
          rainEndsAtMs?: number | null;
          rainWindows?: Array<{ startMs: number; endMs: number; pop?: number }> | null;
        }) => string | null;
      };
      const line = formatRainHudLine({
        currentPrecipMm: weather.precipitationMm,
        nextRainAtMs: weather.nextRainAtMs,
        rainStartsInMin: weather.rainStartsInMin,
        rainEndsAtMs: weather.rainEndsAtMs,
        rainWindows: weather.rainWindows,
        weatherCode: weather.weatherCode,
        isHeavyRain: weather.isHeavyRain,
      });
      if (line) {
        const rainingNow = /^(🌧\s*)?Regen (jetzt|noch )/i.test(line);
        const mins =
          !rainingNow && weather.nextRainAtMs != null
            ? Math.round((weather.nextRainAtMs - Date.now()) / 60_000)
            : rainingNow
              ? 0
              : 99;
        const soon = rainingNow || mins <= 30;
        tips.push({
          id: `rain-${weather.nextRainAtMs ?? 'now'}`,
          kind: 'weather_rain',
          text: `🌧 ${line}${
            !rainingNow && weather.nextRainAtMs != null
              ? ` (${formatClock(weather.nextRainAtMs)})`
              : ''
          }`,
          meta: soon
            ? 'Schirm/Indoor?'
            : weather.nextRainAtMs != null
              ? `Ab ~${formatClock(weather.nextRainAtMs)} · Schirm?`
              : undefined,
          tellMorePrompt: rainingNow
            ? 'Es regnet — Café oder Indoor in der Nähe mit Route.'
            : soon
              ? 'Regen bald — Café oder Indoor in der Nähe mit Route.'
              : `In etwa ${mins} Minuten Regen möglich — Schirm/Jacke oder Plan anpassen?`,
          score: rainingNow || mins <= 5 ? 95 : soon ? 84 : 72,
        });
      }
    } catch {
      /* soft */
    }
  }

  const summary = weather.summaryLine?.trim();
  // Kein zweites Wetter-Tipp mit „Aktuell … Regen …“, wenn Regen-Karte schon da.
  const hasRainTip = tips.some((t) => t.kind === 'weather_rain');
  if (
    summary &&
    summary.length <= 72 &&
    !hasRainTip &&
    !/^aktuell\b/i.test(summary)
  ) {
    tips.push({
      id: `wx-${summary.slice(0, 24)}`,
      kind: 'weather_summary',
      text: summary,
      meta: 'Mehr Wetter-Tipps?',
      tellMorePrompt: '__WEATHER_DAY_CHECK__',
      score: 38,
    });
  }

  // Hitze → Trinken / Sonnencreme (Nice-to-know, nicht akut wie Regen-5-Min)
  const temp =
    typeof weather.currentTempC === 'number' ? weather.currentTempC : null;
  const high =
    typeof weather.dayHighC === 'number' ? weather.dayHighC : temp;
  if ((temp != null && temp >= 26) || (high != null && high >= 28)) {
    const tLabel = Math.round(high ?? temp ?? 0);
    tips.push({
      id: `heat-${Math.round(Date.now() / (3 * 60 * 60_000))}`,
      kind: 'weather_heat',
      text: `☀️ ${tLabel}° — Wasser & Sonnencreme`,
      meta: 'Tipp für draußen',
      tellMorePrompt:
        'Es ist heiß — erinnere mich an Trinken und Sonnencreme, und zeig kurz eine Trinkwasserstelle oder Drogerie in der Nähe falls sinnvoll.',
      score: temp != null && temp >= 30 ? 76 : 68,
    });
  }

  return tips;
};

const produceBatteryCharge: TipProducer = () => {
  refreshBatteryCache();
  const bat = getCachedBatteryLevel01();
  if (bat == null || !Number.isFinite(bat)) return [];
  const pct = Math.round(bat * 100);
  // HUD vor Survival-Speech (15 %): ab 25 % fragen
  if (pct > 25) return [];
  const critical = pct <= 15;
  return [
    {
      id: `battery-${pct}`,
      kind: 'battery_charge',
      text: critical
        ? `🔋 Akku ${pct} % — Powerbank?`
        : '🔋 Brauchst du mehr Akku?',
      meta: critical
        ? 'Nächste Station ansteuern?'
        : `Noch ${pct} % — Station suchen?`,
      tellMorePrompt:
        'Akku wird knapp — such Powerbank-Automaten oder Café mit Steckdosen in der Nähe und gib mir Route-Buttons.',
      score: critical ? 97 : pct <= 18 ? 93 : 80,
    },
  ];
};

const produceWakeAlarm: TipProducer = (ctx) => {
  try {
    const { planDayKeyFromMs } = require('../../utils/dateKeys') as {
      planDayKeyFromMs: (ms: number) => string;
    };
    const { listWakeStopsForDay } = require('../alarms/nativeAlarmBridge') as {
      listWakeStopsForDay: (dayKey: string) => Array<{
        id: string;
        title: string;
        plannedStartMs?: number | null;
      }>;
    };
    const dayKey = planDayKeyFromMs(ctx.nowMs);
    const wakes = listWakeStopsForDay(dayKey)
      .filter(
        (s) =>
          s.plannedStartMs != null &&
          s.plannedStartMs > ctx.nowMs - 2 * 60_000,
      )
      .sort(
        (a, b) => (a.plannedStartMs ?? 0) - (b.plannedStartMs ?? 0),
      );
    const next = wakes[0];
    if (!next?.plannedStartMs) return [];
    const delta = next.plannedStartMs - ctx.nowMs;
    if (delta > 14 * 60 * 60_000) return [];
    const mins = Math.max(0, Math.round(delta / 60_000));
    const clock = formatClock(next.plannedStartMs);
    // Nur HUD-Chip — nie Push/Voice vor dem Wecken („ich wecke dich um 8“)
    if (mins > 20) return [];
    return [
      {
        id: `wake-${next.plannedStartMs}`,
        kind: 'wake_alarm',
        text: `⏰ Wecker ${clock}`,
        meta: mins <= 1 ? 'Gleich' : `In ${mins} Min`,
        tellMorePrompt: `Mein Wecker steht auf ${clock}. Nur anpassen wenn ich das will — keine Vorab-Erinnerung.`,
        score: mins <= 2 ? 42 : 28,
      },
    ];
  } catch {
    return [];
  }
};

const produceParkingTicket: TipProducer = (ctx) => {
  try {
    const { getParkingSpot, formatParkingHudCard } = require('../timeline/parkingSpotStore') as {
      getParkingSpot: () => {
        label: string;
        maxDurationMin: number | null;
        parkedAtMs: number;
      } | null;
      formatParkingHudCard: (nowMs: number) => {
        title: string;
        meta?: string;
        tellMorePrompt: string;
      } | null;
    };
    const spot = getParkingSpot();
    if (!spot) return [];
    const line = formatParkingHudCard(ctx.nowMs);
    if (!line) return [];
    let score = 58;
    if (spot.maxDurationMin != null && spot.maxDurationMin > 0) {
      const rem =
        spot.maxDurationMin -
        Math.round((ctx.nowMs - spot.parkedAtMs) / 60_000);
      if (rem <= 0) score = 96;
      else if (rem <= 20) score = 92;
      else if (rem <= 45) score = 84;
      else if (rem <= 90) score = 70;
    }
    return [
      {
        id: `park-ticket-${spot.parkedAtMs}`,
        kind: 'parking_ticket',
        text: line.title,
        meta: line.meta ?? undefined,
        tellMorePrompt: line.tellMorePrompt,
        score,
      },
    ];
  } catch {
    return [];
  }
};

const produceNavEta: TipProducer = (ctx) => {
  const store = useFinnusStore.getState();
  if (!store.navActive || !store.navVisible) return [];
  const rem = store.navDistanceM;
  if (rem == null || !Number.isFinite(rem) || rem <= 0) return [];
  const target =
    store.navTargetName?.trim() ||
    store.multiStopTour?.stops[store.multiStopTour.currentIndex]?.name ||
    'Ziel';
  let etaMin: number;
  try {
    const { resolveActiveTravelMode } = require('../navigation/travelModeContext') as {
      resolveActiveTravelMode: () => { mode: string };
    };
    const { bikeMinutesForDistanceM, walkMinutesForDistanceM } = require('../navigation/travelEta') as {
      bikeMinutesForDistanceM: (m: number) => number;
      walkMinutesForDistanceM: (m: number) => number;
    };
    const travel = resolveActiveTravelMode().mode;
    etaMin =
      travel === 'bike'
        ? bikeMinutesForDistanceM(rem)
        : walkMinutesForDistanceM(rem);
  } catch {
    etaMin = Math.max(1, Math.round(rem / 80));
  }
  const arriveAt = ctx.nowMs + etaMin * 60_000;
  const distLabel =
    rem < 1000 ? `${Math.round(rem)} m` : `${(rem / 1000).toFixed(1)} km`;
  return [
    {
      id: `nav-eta-${target}`,
      kind: 'nav_eta',
      text: target,
      meta: `${distLabel} · ~${etaMin} Min · Ankunft ${formatClock(arriveAt)}`,
      tellMorePrompt: `Kurz zur Route nach ${target}: Ankunft, nächster Hinweis, und was ich unterwegs beachten soll.`,
      score: etaMin <= 8 ? 78 : 62,
    },
  ];
};

const produceTransitDepart: TipProducer = (ctx) => {
  try {
    const { planDayKeyFromMs } = require('../../utils/dateKeys') as {
      planDayKeyFromMs: (ms: number) => string;
    };
    const { useFuturePlanStore } = require('../../module2/timeline/futurePlanState') as {
      useFuturePlanStore: {
        getState: () => {
          getPlanForDay: (dayKey: string) => {
            stops: Array<{
              id: string;
              title: string;
              transport: string;
              plannedStartMs?: number | null;
              status?: string;
              emoji?: string;
            }>;
          };
        };
      };
    };
    const dayKey = planDayKeyFromMs(ctx.nowMs);
    const stops = useFuturePlanStore
      .getState()
      .getPlanForDay(dayKey)
      .stops.filter(
        (s) =>
          s.status !== 'done' &&
          s.plannedStartMs != null &&
          s.plannedStartMs > ctx.nowMs &&
          (s.transport === 'transit' ||
            /bahn|zug|bus|tram|ubahn|s-bahn|öpnv|haltestelle/i.test(
              `${s.title} ${s.emoji ?? ''}`,
            )),
      )
      .sort((a, b) => (a.plannedStartMs ?? 0) - (b.plannedStartMs ?? 0));
    const next = stops[0];
    if (!next?.plannedStartMs) return [];
    const delta = next.plannedStartMs - ctx.nowMs;
    if (delta > 3 * 60 * 60_000) return [];
    const mins = Math.max(1, Math.round(delta / 60_000));
    const clock = formatClock(next.plannedStartMs);
    return [
      {
        id: `transit-${next.id}`,
        kind: 'transit_depart',
        text: `🚆 Abfahrt ${clock}`,
        meta: `${next.title} · in ${mins} Min · hilft das?`,
        tellMorePrompt: `Meine Bahn/Bus-Abfahrt um ${clock} (${next.title}) — Leave-by, Weg zur Haltestelle und was ich beachten soll.`,
        score: mins <= 15 ? 94 : mins <= 45 ? 82 : 68,
      },
    ];
  } catch {
    return [];
  }
};

const produceOpenTasks: TipProducer = (ctx) => {
  const tasks = useShoppingTaskStore.getState().getOpenTasks();
  if (!tasks.length) return [];
  // Offene Punkte erst nach 4 Min erinnern
  const ripe = tasks.filter(
    (t) => ctx.nowMs - (t.createdAtMs ?? 0) >= 4 * 60_000,
  );
  if (!ripe.length) return [];
  const top = ripe[0]!;
  return [
    {
      id: `task-${top.id}`,
      kind: 'open_task',
      text: `Noch offen: ${top.itemLabel}`,
      meta: 'Auf der Liste',
      tellMorePrompt: `Offener Punkt „${top.itemLabel}“ — konkrete nächste Schritte und Route wenn sinnvoll.`,
      score: 48,
    },
  ];
};

/** Trigger-Matrix → HUD (Top-Score als generic Tip). */
const produceContextMatrix: TipProducer = () => {
  refreshBatteryCache();
  let amenityKinds = new Set<string>();
  try {
    const { getNearbyAmenityHudCards } = require('./liveHudNearbyAmenities') as {
      getNearbyAmenityHudCards: () => Array<{ kind: string }>;
    };
    amenityKinds = new Set(getNearbyAmenityHudCards().map((c) => c.kind));
  } catch {
    /* soft */
  }
  const top = evaluateContextTriggers({ limit: 5 }).filter((t) => {
    if (t.id === 'low_battery_charge') return false; // eigener battery_charge Producer
    // Doppel vermeiden: konkrete Nearby-Karten schlagen generische Matrix
    if (t.id === 'toilet_nearby' && amenityKinds.has('toilet')) return false;
    if (t.id === 'drinking_water_nearby' && amenityKinds.has('drinking_water'))
      return false;
    if (t.id === 'ice_cream_hot' && amenityKinds.has('ice_cream')) return false;
    if (t.id === 'supermarket_evening' && amenityKinds.has('supermarket'))
      return false;
    // Generisches „Supermarkt“ ohne Nearby-Treffer nicht zeigen
    if (t.id === 'supermarket_evening') return false;
    // Sunset-Karte aus liveHudCards ist SSOT (Uhr + Wetter)
    if (t.id === 'sunset_spot') return false;
    if (t.id === 'lunch_nearby' || t.id === 'dinner_reservation') return false;
    return true;
  });
  return top.map((t) => ({
    id: `ctx-${t.id}`,
    kind: 'generic' as const,
    text: t.title,
    meta: undefined,
    tellMorePrompt: t.prompt,
    score: Math.min(82, Math.round(t.score * 0.85)),
  }));
};

const produceNiceInfoScenarios: TipProducer = () => {
  try {
    const { collectNiceInfoScenarioTips } = require('./niceInfoScenarios') as {
      collectNiceInfoScenarioTips: (opts?: {
        nowMs?: number;
      }) => HudTipCandidate[];
    };
    return collectNiceInfoScenarioTips();
  } catch {
    return [];
  }
};

/** Registry — neue Situationen = neuer Producer, kein if/else-Wachstum im Picker. */
const PRODUCERS: TipProducer[] = [
  produceHotelBreakfast,
  produceHotelCheckout,
  produceHotelCheckin,
  produceShoppingClosing,
  produceSessionDeadline,
  produceWeather,
  produceBatteryCharge,
  produceWakeAlarm,
  produceParkingTicket,
  produceNavEta,
  produceTransitDepart,
  produceOpenTasks,
  produceNiceInfoScenarios,
  produceContextMatrix,
];

let cachedTip: HudTipCandidate | null = null;
let lastEvalMs = 0;
const listeners = new Set<() => void>();

export function getActiveHudTip(): HudTipCandidate | null {
  return cachedTip;
}

export function subscribeHudTip(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notify(): void {
  for (const l of listeners) {
    try {
      l();
    } catch {
      /* ignore */
    }
  }
}

export function collectHudTipCandidates(
  ctx?: Partial<HudTipContext>,
): HudTipCandidate[] {
  const store = useFinnusStore.getState();
  const full: HudTipContext = {
    nowMs: ctx?.nowMs ?? Date.now(),
    lat: ctx?.lat ?? store.lastGpsLat,
    lng: ctx?.lng ?? store.lastGpsLng,
  };
  const all: HudTipCandidate[] = [];
  for (const produce of PRODUCERS) {
    try {
      all.push(...produce(full));
    } catch (err) {
      if (__DEV__) console.warn('[hudEngine] producer failed', err);
    }
  }
  return all.filter((t) =>
    allowProactiveHudTip({ kind: t.kind, score: t.score, nowMs: full.nowMs }),
  );
}

export function pickBestHudTip(
  candidates: HudTipCandidate[],
): HudTipCandidate | null {
  if (!candidates.length) return null;
  return [...candidates].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return (KIND_TIEBREAK[b.kind] ?? 0) - (KIND_TIEBREAK[a.kind] ?? 0);
  })[0]!;
}

/**
 * Re-evaluate tip set. Returns the active tip (may be null).
 * @param force ignore 15-min throttle
 */
export function evaluateProactiveHud(opts?: {
  force?: boolean;
  ctx?: Partial<HudTipContext>;
}): HudTipCandidate | null {
  const now = Date.now();
  if (
    !opts?.force &&
    lastEvalMs > 0 &&
    now - lastEvalMs < HUD_ENGINE_INTERVAL_MS &&
    cachedTip
  ) {
    return cachedTip;
  }

  const best = pickBestHudTip(collectHudTipCandidates(opts?.ctx));
  const changed =
    (cachedTip?.id ?? null) !== (best?.id ?? null) ||
    (cachedTip?.text ?? null) !== (best?.text ?? null);
  cachedTip = best;
  lastEvalMs = now;
  if (changed) notify();
  return cachedTip;
}

/** Back-compat for Header rotation fallback. */
export function getHudTickerLines(): string[] {
  const tip = evaluateProactiveHud({ force: false });
  const all = collectHudTipCandidates()
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map((t) => t.text);
  if (tip && !all.includes(tip.text)) {
    return [tip.text, ...all].slice(0, 5);
  }
  return all.length ? all : tip ? [tip.text] : [];
}
