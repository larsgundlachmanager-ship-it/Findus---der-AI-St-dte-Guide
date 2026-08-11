/**
 * Faktensammlung für Morgen-Briefing — nur belegte Slots.
 * Speech/LLM entscheidet Wortlaut; leere Felder bleiben stumm.
 */

import { todayDateKey, dateKeyFromMs } from '../../utils/dateKeys';
import { useFuturePlanStore } from '../../module2/timeline/futurePlanState';
import { useUserMemoryStore } from '../../store/useUserMemoryStore';
import { getCachedWeatherSnapshot } from '../weatherService';
import { listWakeStopsForDay } from '../alarms/nativeAlarmBridge';

export type MorningBriefingFacts = {
  yesterdayHighlights: string[];
  /** Gestern geplant, aber nicht erledigt → heutige Vorschläge */
  unfinishedYesterday: string[];
  todayStops: Array<{
    title: string;
    clock: string | null;
    priority: number | null;
    transport: string | null;
  }>;
  pressure: 'tight' | 'steady' | 'relaxed' | null;
  firstLeaveClock: string | null;
  weatherLine: string | null;
  clothingHint: string | null;
  weatherVsYesterday: 'nicer' | 'worse' | 'similar' | null;
  todos: string[];
  travelHint: 'heimreise' | 'weiterreise' | null;
  pendingWake: { wakeAtMs: number; clock: string } | null;
  /** Touristen-Trip: „Tag 2 von 4 in München“ */
  tripLine: string | null;
  /** Offene Tisch-/Ticket-Anfragen */
  reservationHint: string | null;
};

function clockOf(ms: number | null | undefined): string | null {
  if (ms == null || !Number.isFinite(ms)) return null;
  return new Date(ms).toLocaleTimeString('de-DE', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function clothingFromWeather(opts: {
  tempC: number | null;
  dayHighC?: number | null;
  precip: number | null;
  windy?: boolean;
}): string | null {
  try {
    const {
      buildOutfitAdviceFromWeather,
    } = require('../weather/outfitFromWeather') as {
      buildOutfitAdviceFromWeather: (o: {
        nowTempC: number | null;
        dayHighC: number | null;
        precipProbPct: number | null;
        windy?: boolean;
      }) => { clothingBits: string[] };
    };
    const advice = buildOutfitAdviceFromWeather({
      nowTempC: opts.tempC,
      dayHighC: opts.dayHighC ?? null,
      precipProbPct: opts.precip,
      windy: opts.windy,
    });
    return advice.clothingBits.length
      ? advice.clothingBits.slice(0, 2).join(', ')
      : null;
  } catch {
    const parts: string[] = [];
    const dress = opts.dayHighC ?? opts.tempC;
    if (dress != null) {
      if (dress <= 5) parts.push('warme Jacke');
      else if (dress <= 12) parts.push('Übergangsjacke');
      else if (dress <= 18) parts.push('leichte Schicht');
      else if (dress >= 22) parts.push('luftige Kleidung');
    }
    if (opts.precip != null && opts.precip >= 40) parts.push('Regenjacke');
    if (opts.windy) parts.push('Windschutz');
    return parts.length ? parts.join(', ') : null;
  }
}

function detectTravelHint(): 'heimreise' | 'weiterreise' | null {
  const mem = useUserMemoryStore.getState();
  const blob = [
    ...mem.findEntities({}).slice(0, 20).map((e) => `${e.name} ${e.notes ?? ''}`),
  ]
    .join(' ')
    .toLowerCase();
  if (/\b(heimreise|nach\s+hause|rückreise|zur[üu]ck\s+nach\s+hause)\b/.test(blob)) {
    return 'heimreise';
  }
  if (/\b(weiterreise|nächste\s+stadt|abreise\s+nach|zug\s+nach)\b/.test(blob)) {
    return 'weiterreise';
  }
  return null;
}

/** Gestern-Highlights aus Memory (kurz, max 4). */
export function collectYesterdayHighlights(yesterdayKey: string): string[] {
  const mem = useUserMemoryStore.getState();
  const sinceIso = `${yesterdayKey}T00:00:00.000`;
  const until = new Date(`${yesterdayKey}T23:59:59.999`).getTime();
  return mem
    .findEntities({ sinceIso })
    .filter((e) => {
      if (!e.visitedAt) return true;
      const t = Date.parse(e.visitedAt);
      return !Number.isFinite(t) || t <= until;
    })
    .slice(0, 4)
    .map((e) => e.name);
}

/**
 * Gestern im Plan, aber nicht done — Kandidaten für heutige Vorschläge.
 * Wish-Bänder + Stops ohne done; Explore-Noise raus.
 */
export function collectUnfinishedYesterday(yesterdayKey: string): string[] {
  try {
    useFuturePlanStore.getState().ensureDay(yesterdayKey);
    const stops = useFuturePlanStore.getState().getPlanForDay(yesterdayKey).stops;
    const out: string[] = [];
    const seen = new Set<string>();
    for (const s of stops) {
      if (s.status === 'done') continue;
      if (s.kind === 'nav_leg') continue;
      if (s.id.startsWith('wake_') || s.id.startsWith('choice_')) continue;
      const title = (s.title || '').trim();
      if (title.length < 2) continue;
      if (/^(frei|explore|entdecken|spazieren|offen)$/i.test(title)) continue;
      const key = title.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(title.slice(0, 48));
      if (out.length >= 4) break;
    }
    return out;
  } catch {
    return [];
  }
}

export function collectMorningBriefingFacts(opts?: {
  yesterdayKey?: string;
}): MorningBriefingFacts {
  const dayKey = todayDateKey();
  const now = Date.now();
  const yesterday =
    opts?.yesterdayKey ??
    (() => {
      const d = new Date();
      d.setDate(d.getDate() - 1);
      return dateKeyFromMs(d.getTime());
    })();

  useFuturePlanStore.getState().ensureDay(dayKey);
  const stops = useFuturePlanStore
    .getState()
    .getPlanForDay(dayKey)
    .stops.filter(
      (s) =>
        s.kind === 'stop' &&
        !s.id.startsWith('choice_') &&
        !s.id.startsWith('wish_') &&
        !s.id.startsWith('wake_') &&
        (s.plannedStartMs == null || s.plannedStartMs >= now - 30 * 60_000),
    )
    .sort((a, b) => (a.plannedStartMs ?? 0) - (b.plannedStartMs ?? 0));

  const todayStops = stops.slice(0, 6).map((s) => ({
    title: s.title,
    clock: clockOf(s.plannedStartMs),
    priority: s.planPriority ?? null,
    transport: s.transport ?? null,
  }));

  const hardSoon = stops.find(
    (s) =>
      s.plannedStartMs != null &&
      (s.planPriority ?? 99) <= 2 &&
      s.plannedStartMs - now < 3 * 60 * 60_000,
  );
  const firstTimed = stops.find((s) => s.plannedStartMs != null);
  let pressure: MorningBriefingFacts['pressure'] = null;
  if (stops.length === 0) {
    pressure = null;
  } else if (hardSoon || (firstTimed?.plannedStartMs != null && firstTimed.plannedStartMs - now < 90 * 60_000)) {
    pressure = 'tight';
  } else if (stops.length >= 4 || stops.some((s) => (s.planPriority ?? 99) <= 3)) {
    pressure = 'steady';
  } else {
    pressure = 'relaxed';
  }

  const snap = getCachedWeatherSnapshot();
  let tempC: number | null = null;
  let dayHighC: number | null = null;
  let precip: number | null = null;
  try {
    const { extractTempsFromWeatherText } = require('../weather/outfitFromWeather') as {
      extractTempsFromWeatherText: (o: {
        summaryLine?: string | null;
        promptBlock?: string | null;
        currentTempC?: number | null;
        dayHighC?: number | null;
      }) => { nowTempC: number | null; dayHighC: number | null };
    };
    const t = extractTempsFromWeatherText({
      summaryLine: snap?.summaryLine,
      promptBlock: snap?.promptBlock,
      currentTempC: snap?.currentTempC ?? null,
      dayHighC: snap?.dayHighC ?? null,
    });
    tempC = t.nowTempC;
    dayHighC = t.dayHighC;
  } catch {
    if (snap?.summaryLine) {
      const m = snap.summaryLine.match(/Aktuell\s+(-?\d+(?:[.,]\d+)?)\s*°/i);
      if (m) tempC = Number(m[1]!.replace(',', '.'));
    }
  }
  if (snap?.nextRainProb != null) {
    precip =
      snap.nextRainProb <= 1 ? snap.nextRainProb * 100 : snap.nextRainProb;
  }

  const todos: string[] = [];
  try {
    const { useShoppingTaskStore } = require('../../store/useShoppingTaskStore') as {
      useShoppingTaskStore: {
        getState: () => {
          tasks: Array<{ status?: string; itemLabel?: string }>;
        };
      };
    };
    for (const t of useShoppingTaskStore.getState().tasks ?? []) {
      if (t.status && t.status !== 'open') continue;
      const label = (t.itemLabel || '').trim();
      if (label) todos.push(label);
      if (todos.length >= 3) break;
    }
  } catch {
    /* soft */
  }

  const wakes = listWakeStopsForDay(dayKey)
    .filter((s) => s.plannedStartMs != null && s.plannedStartMs > now + 2 * 60_000)
    .sort((a, b) => (a.plannedStartMs ?? 0) - (b.plannedStartMs ?? 0));
  const wake = wakes[0];
  const pendingWake =
    wake?.plannedStartMs != null
      ? {
          wakeAtMs: wake.plannedStartMs,
          clock: clockOf(wake.plannedStartMs)!,
        }
      : null;

  return {
    yesterdayHighlights: collectYesterdayHighlights(yesterday),
    unfinishedYesterday: collectUnfinishedYesterday(yesterday),
    todayStops,
    pressure,
    firstLeaveClock: clockOf(firstTimed?.plannedStartMs),
    weatherLine: snap?.summaryLine?.trim() || null,
    clothingHint: clothingFromWeather({
      tempC,
      dayHighC,
      precip,
      windy: /\bwind|böen|boeen\b/i.test(snap?.summaryLine ?? ''),
    }),
    // Ohne gestrigen Wetter-Snapshot keinen Fake-Vergleich
    weatherVsYesterday: null,
    todos,
    travelHint: detectTravelHint(),
    pendingWake,
    tripLine: (() => {
      try {
        const { useTripModeStore } = require('../../store/useTripModeStore') as {
          useTripModeStore: {
            getState: () => {
              active: boolean;
              cityName: string | null;
              dayCount: number;
              getTripDayIndex: (k?: string) => number | null;
            };
          };
        };
        const trip = useTripModeStore.getState();
        if (!trip.active) return null;
        const idx = trip.getTripDayIndex(dayKey);
        if (idx == null) return null;
        const where = trip.cityName ? ` in ${trip.cityName}` : '';
        return `Tag ${idx} von ${trip.dayCount}${where}`;
      } catch {
        return null;
      }
    })(),
    reservationHint: (() => {
      try {
        const {
          formatOpenReservationsHint,
        } = require('../../store/useReservationMemoryStore') as {
          formatOpenReservationsHint: () => string | null;
        };
        return formatOpenReservationsHint();
      } catch {
        return null;
      }
    })(),
  };
}

/** Kompakter Kontextblock für LLM — leere Slots weglassen. */
export function formatMorningBriefingContext(facts: MorningBriefingFacts): string {
  const lines: string[] = [];
  if (facts.tripLine) {
    lines.push(`Trip: ${facts.tripLine}`);
  }
  if (facts.yesterdayHighlights.length) {
    lines.push(`Gestern Highlights: ${facts.yesterdayHighlights.join(', ')}`);
  }
  if (facts.unfinishedYesterday.length) {
    lines.push(
      `Gestern nicht geschafft (heute vorschlagen, wenn passend): ${facts.unfinishedYesterday.join(', ')}`,
    );
  }
  if (facts.todayStops.length) {
    lines.push(
      `Heute: ${facts.todayStops
        .map(
          (s) =>
            `${s.clock ? `${s.clock} ` : ''}${s.title}` +
            (s.priority != null && s.priority <= 2 ? ' (wichtig)' : '') +
            (s.transport ? ` [${s.transport}]` : ''),
        )
        .join(' · ')}`,
    );
  }
  if (facts.reservationHint) {
    lines.push(`Offene Reservierungen: ${facts.reservationHint}`);
  }
  if (facts.pressure === 'tight') {
    lines.push(
      `Druck: eher knackig${facts.firstLeaveClock ? ` — erster Anker ~${facts.firstLeaveClock}` : ''}`,
    );
  } else if (facts.pressure === 'relaxed') {
    lines.push('Druck: entspannt, kein Eile-Druck');
  } else if (facts.pressure === 'steady') {
    lines.push('Druck: normaler Tag, planbar');
  }
  if (facts.weatherLine) lines.push(`Wetter: ${facts.weatherLine}`);
  if (facts.clothingHint) lines.push(`Kleidung: ${facts.clothingHint}`);
  if (facts.weatherVsYesterday === 'nicer') lines.push('Wetter vs gestern: schöner');
  if (facts.weatherVsYesterday === 'worse') lines.push('Wetter vs gestern: schlechter');
  if (facts.weatherVsYesterday === 'similar') lines.push('Wetter vs gestern: ähnlich');
  if (facts.todos.length) lines.push(`Todos/Erinnerungen: ${facts.todos.join(', ')}`);
  if (facts.travelHint === 'heimreise') lines.push('Reisekontext: Heimreise im Blick');
  if (facts.travelHint === 'weiterreise') lines.push('Reisekontext: Weiterreise im Blick');
  if (facts.pendingWake) {
    lines.push(
      `Offener Wecker ${facts.pendingWake.clock} — User ist schon wach: Wecker-Löschen anbieten`,
    );
  }
  return lines.join('\n');
}
