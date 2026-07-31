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
  refreshBatteryCache,
} from './contextTriggerMatrix';

export const HUD_ENGINE_INTERVAL_MS = 15 * 60_000;

export type HudTipKind =
  | 'hotel_breakfast'
  | 'hotel_checkin'
  | 'shopping_closing'
  | 'session_deadline'
  | 'weather_rain'
  | 'weather_summary'
  | 'open_task'
  | 'generic';

export type HudTipCandidate = {
  id: string;
  kind: HudTipKind;
  /** HUD-Titelzeile */
  text: string;
  /** Meta unter dem Titel */
  meta?: string;
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
  shopping_closing: 90,
  session_deadline: 85,
  hotel_checkin: 80,
  hotel_breakfast: 75,
  weather_rain: 70,
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
      text: `Checkout um ${parsed.label} Uhr`,
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
        meta: `Leave-by ${formatClock(plan.leaveByMs)} · pünktlich am Ziel`,
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
        meta: 'Offener Termin',
        score,
      });
    }
  }

  return tips;
};

const produceWeather: TipProducer = () => {
  const tips: HudTipCandidate[] = [];

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
      const mins = st?.rainStartsInMin ?? (
        st?.nextRainAtMs != null
          ? Math.round((st.nextRainAtMs - Date.now()) / 60_000)
          : 99
      );
      tips.push({
        id: `rain-hud-${st?.nextRainAtMs ?? 'x'}`,
        kind: 'weather_rain',
        text: line,
        meta:
          mins <= 30
            ? 'Vielleicht kurz rein — Café / Indoor?'
            : undefined,
        score: mins <= 5 ? 95 : mins <= 30 ? 88 : 70,
      });
    }
  } catch {
    /* soft */
  }

  const weather = getCachedWeatherSnapshot();
  if (!weather) return tips;

  if (weather.nextRainAtMs != null && !tips.some((t) => t.kind === 'weather_rain')) {
    const delta = weather.nextRainAtMs - Date.now();
    if (delta > 0 && delta <= 3 * 60 * 60_000) {
      const mins = Math.round(delta / 60_000);
      tips.push({
        id: `rain-${weather.nextRainAtMs}`,
        kind: 'weather_rain',
        text:
          weather.rainStartsInMin != null
            ? `🌧 Regen in ${weather.rainStartsInMin} Min`
            : `🌧 Regen in ${mins} Min (${formatClock(weather.nextRainAtMs)})`,
        meta: delta <= 35 * 60_000 ? 'Vielleicht kurz rein — Café / Indoor?' : undefined,
        score: delta <= 35 * 60_000 ? 84 : 66,
      });
    }
  }

  const summary = weather.summaryLine?.trim();
  if (summary && summary.length <= 72) {
    tips.push({
      id: `wx-${summary.slice(0, 24)}`,
      kind: 'weather_summary',
      text: summary,
      score: 38,
    });
  }

  return tips;
};

const produceOpenTasks: TipProducer = () => {
  const tasks = useShoppingTaskStore.getState().getOpenTasks();
  if (!tasks.length) return [];
  const top = tasks[0]!;
  return [
    {
      id: `task-${top.id}`,
      kind: 'open_task',
      text: `Noch offen: ${top.itemLabel}`,
      meta: 'Erinnerung',
      score: 48,
    },
  ];
};

/** Trigger-Matrix → HUD (Top-Score als generic Tip). */
const produceContextMatrix: TipProducer = () => {
  refreshBatteryCache();
  const top = evaluateContextTriggers({ limit: 3 });
  return top.map((t) => ({
    id: `ctx-${t.id}`,
    kind: 'generic' as const,
    text: t.title,
    meta: t.prompt.slice(0, 64),
    score: Math.min(92, t.score),
  }));
};

/** Registry — neue Situationen = neuer Producer, kein if/else-Wachstum im Picker. */
const PRODUCERS: TipProducer[] = [
  produceHotelBreakfast,
  produceHotelCheckout,
  produceHotelCheckin,
  produceShoppingClosing,
  produceSessionDeadline,
  produceWeather,
  produceOpenTasks,
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
  return all;
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
