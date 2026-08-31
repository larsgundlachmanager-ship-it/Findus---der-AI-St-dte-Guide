/**
 * Nice-Info-Szenarien — sanfte Tipps (Push/HUD), nie Leave-by/Regen-akut.
 * Blaupause: Kontext erkennen → Tipp + Prompt; Wortlaut frei in Concierge.
 */

import type { HudTipCandidate } from './proactiveHudEngine';
import { getCachedUserProfile } from '../userProfileService';
import { getCachedWeatherSnapshot } from '../weatherService';
import { dateKeyFromMs } from '../../utils/dateKeys';

function minutesOfDay(ms: number): number {
  const d = new Date(ms);
  return d.getHours() * 60 + d.getMinutes();
}

function factValue(key: string): string | null {
  try {
    const { useOpenQuestionStore } = require('../../store/useOpenQuestionStore') as {
      useOpenQuestionStore: {
        getState: () => {
          userFacts: Array<{ key: string; value: string }>;
        };
      };
    };
    const hit = useOpenQuestionStore
      .getState()
      .userFacts.find((f) => f.key === key);
    return hit?.value?.trim() || null;
  } catch {
    return null;
  }
}

function parseHmToMs(label: string, dayMs: number): number | null {
  const m = label.match(/(\d{1,2})[:.](\d{2})/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  const d = new Date(dayMs);
  d.setHours(h, min, 0, 0);
  return d.getTime();
}

function flightDepartureMsTodayOrSoon(nowMs: number): number | null {
  const label = factValue('flug_abflug');
  if (label) {
    const ms = parseHmToMs(label, nowMs);
    if (ms != null && ms > nowMs - 30 * 60_000) return ms;
    // Label ohne „heute“ — morgen versuchen
    const tomorrow = nowMs + 24 * 60 * 60_000;
    const ms2 = parseHmToMs(label, tomorrow);
    if (ms2 != null) return ms2;
  }
  try {
    const {
      useLogisticsTriggerStore,
    } = require('../../store/useLogisticsTriggerStore') as {
      useLogisticsTriggerStore: {
        getState: () => {
          getActiveEvents: () => Array<{
            kind: string;
            atMs: number | null;
            status: string;
          }>;
        };
      };
    };
    const flights = useLogisticsTriggerStore
      .getState()
      .getActiveEvents()
      .filter(
        (e) =>
          e.kind === 'flight' &&
          e.status === 'active' &&
          e.atMs != null &&
          e.atMs > nowMs - 60 * 60_000,
      )
      .sort((a, b) => (a.atMs ?? 0) - (b.atMs ?? 0));
    return flights[0]?.atMs ?? null;
  } catch {
    return null;
  }
}

function isMorningWindow(nowMs: number): boolean {
  const m = minutesOfDay(nowMs);
  return m >= 6 * 60 + 30 && m <= 11 * 60 + 30;
}

function isEveningWindow(nowMs: number): boolean {
  const m = minutesOfDay(nowMs);
  return m >= 17 * 60 && m <= 21 * 60;
}

/**
 * Konkrete Nice-Info-Tipps aus Kontext (stadt-agnostisch).
 */
export function collectNiceInfoScenarioTips(opts?: {
  nowMs?: number;
}): HudTipCandidate[] {
  const nowMs = opts?.nowMs ?? Date.now();
  const tips: HudTipCandidate[] = [];
  const dayKey = dateKeyFromMs(nowMs);
  const profile = getCachedUserProfile();
  const weather = getCachedWeatherSnapshot();

  // --- 1) Gepäck abgeben (Morgen vor Flug / Checkout) ---
  const depMs = flightDepartureMsTodayOrSoon(nowMs);
  const checkoutLabel = factValue('hotel_checkout');
  const checkedLuggage = factValue('flug_gepaeck_aufgabe') === 'ja';
  let bounceOk = false;
  try {
    const { isBounceAvailableForCity } = require('../affiliate/affiliateService') as {
      isBounceAvailableForCity: (id?: string | null, name?: string | null) => boolean;
    };
    bounceOk = isBounceAvailableForCity(profile?.cityId, profile?.cityName);
  } catch {
    bounceOk = false;
  }

  const hotel = (() => {
    try {
      const { useUserMemoryStore } = require('../../store/useUserMemoryStore') as {
        useUserMemoryStore: {
          getState: () => { getConfirmedHotel: () => { name?: string } | null };
        };
      };
      return useUserMemoryStore.getState().getConfirmedHotel();
    } catch {
      return null;
    }
  })();

  const departureToday =
    depMs != null && dateKeyFromMs(depMs) === dayKey;
  const departureSoon =
    depMs != null &&
    depMs - nowMs > 0 &&
    depMs - nowMs <= 14 * 60 * 60_000;

  if (
    isMorningWindow(nowMs) &&
    (departureToday || departureSoon || checkoutLabel) &&
    (checkedLuggage || bounceOk || hotel)
  ) {
    const flightClock =
      depMs != null
        ? new Date(depMs).toLocaleTimeString('de-DE', {
            hour: '2-digit',
            minute: '2-digit',
          })
        : null;
    tips.push({
      id: `luggage-${dayKey}`,
      kind: 'luggage_drop',
      text: bounceOk
        ? '🧳 Gepäck-Spot in der Nähe'
        : hotel
          ? '🧳 Gepäck: Hotel oder mitnehmen?'
          : '🧳 Gepäck vor dem Flug klären',
      meta: flightClock
        ? `Flug ${flightClock}${checkoutLabel ? ` · Checkout ${checkoutLabel}` : ''}`
        : checkoutLabel
          ? `Checkout ${checkoutLabel}`
          : 'Vormittag',
      tellMorePrompt: bounceOk
        ? 'Ich brauche einen Gepäck-Abgabe-Spot in der Nähe (Bounce) — Link und kurze Tipps, ohne zu nerven.'
        : 'Flugtag/Checkout: Gepäck-Optionen kurz — Hotel lassen, Spot, oder mitnehmen? Mit Buttons falls möglich.',
      score: checkedLuggage ? 74 : bounceOk ? 70 : 66,
    });
  }

  // --- 2) Schirm heute (Regen später, nicht akut <90 Min) ---
  if (weather?.nextRainAtMs != null) {
    const inMin = Math.round((weather.nextRainAtMs - nowMs) / 60_000);
    if (inMin > 90 && inMin <= 8 * 60) {
      tips.push({
        id: `umbrella-${dayKey}-${Math.floor(inMin / 60)}`,
        kind: 'umbrella_day',
        text: `🌂 Regen ab ~${new Date(weather.nextRainAtMs).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}`,
        meta: 'Schirm einpacken?',
        tellMorePrompt:
          'Später Regen möglich — kurz sagen ob Schirm/Jacke sinnvoll ist, ohne Panik.',
        score: 62,
      });
    }
  }

  // --- 3) Sunset (Abend) ---
  const sunsetMs =
    (weather as { sunsetMs?: number | null } | null)?.sunsetMs ?? null;
  if (
    isEveningWindow(nowMs) &&
    sunsetMs != null &&
    sunsetMs > nowMs &&
    sunsetMs - nowMs <= 2.5 * 60 * 60_000
  ) {
    const clock = new Date(sunsetMs).toLocaleTimeString('de-DE', {
      hour: '2-digit',
      minute: '2-digit',
    });
    tips.push({
      id: `sunset-${dayKey}`,
      kind: 'sunset_tip',
      text: `🌅 Sonnenuntergang ~${clock}`,
      meta: 'Schöner Spot?',
      tellMorePrompt:
        'Sonnenuntergang bald — schlag einen schönen Spot in der Nähe vor mit Route-Button, ehrlich und kurz.',
      score: 64,
    });
  }

  // --- 4) Freier Slot nach Checkout / vor Leave-by ---
  const leaveByFact = factValue('flug_leave_by');
  if (isMorningWindow(nowMs) && checkoutLabel && leaveByFact) {
    tips.push({
      id: `gap-${dayKey}`,
      kind: 'free_slot',
      text: `Zeitlücke bis Leave-by ${leaveByFact}`,
      meta: `Checkout ${checkoutLabel}`,
      tellMorePrompt:
        'Zwischen Checkout und Flug-Leave-by: ein sinnvoller Vorschlag was man machen kann (Café, Spaziergang, Gepäck) + Buttons.',
      score: 63,
    });
  }

  // --- 5) Offene Einkaufs-Todos am Vormittag (weich) ---
  if (isMorningWindow(nowMs)) {
    try {
      const { useShoppingTaskStore } = require('../../store/useShoppingTaskStore') as {
        useShoppingTaskStore: {
          getState: () => {
            getOpenTasks: () => Array<{ itemLabel: string }>;
          };
        };
      };
      const open = useShoppingTaskStore.getState().getOpenTasks();
      if (open.length > 0) {
        const label = open[0]!.itemLabel.slice(0, 28);
        tips.push({
          id: `shop-morning-${dayKey}`,
          kind: 'nice_tip',
          text: open.length === 1 ? `🛒 Noch: ${label}` : `🛒 ${open.length} offene Einkäufe`,
          meta: 'Vormittag',
          tellMorePrompt: `Offene Einkaufs-Todos: ${open
            .slice(0, 3)
            .map((t) => t.itemLabel)
            .join(', ')} — kurze Erinnerung + Route zum nächsten Laden falls sinnvoll.`,
          score: 58,
        });
      }
    } catch {
      /* soft */
    }
  }

  // --- 6) Outfit / Kleidung wenn Wetterwechsel ---
  if (isMorningWindow(nowMs) && weather) {
    const precip = weather.nextRainProb ?? null;
    const high = weather.dayHighC ?? weather.currentTempC ?? null;
    if (
      (typeof precip === 'number' && precip >= 45) ||
      (typeof high === 'number' && (high <= 10 || high >= 28))
    ) {
      tips.push({
        id: `outfit-${dayKey}`,
        kind: 'nice_tip',
        text:
          typeof high === 'number' && high >= 28
            ? '👕 Heiß — luftig + Sonnenschutz'
            : typeof precip === 'number' && precip >= 45
              ? '🧥 Regen möglich — Jacke mitnehmen'
              : '🧥 Cooler Tag — Schicht empfohlen',
        meta: weather.summaryLine?.slice(0, 40) || 'Wetter',
        tellMorePrompt:
          'Kurzer Kleidungs-Tipp für heute aus dem Wetter, ohne Vorlesung.',
        score: 60,
      });
    }
  }

  return tips;
}

/**
 * Feuert fällige Nice-Info-Pushes (Dedup intern).
 * Max. 2 pro Tick, damit es nicht spammt.
 */
export async function tickNiceInfoScenarios(opts?: {
  nowMs?: number;
}): Promise<{ pushed: number }> {
  const nowMs = opts?.nowMs ?? Date.now();
  const tips = collectNiceInfoScenarioTips({ nowMs })
    .filter((t) => t.score >= 60)
    .sort((a, b) => b.score - a.score)
    .slice(0, 2);

  if (!tips.length) return { pushed: 0 };

  const { scheduleNiceInfoPush } = await import(
    '../notifications/niceInfoNotifications'
  );
  const { buildHudTipPushTeaser } = await import(
    '../notifications/notificationTeaser'
  );

  let pushed = 0;
  for (const tip of tips) {
    const teaser = buildHudTipPushTeaser(tip);
    const r = await scheduleNiceInfoPush({
      title: teaser.title,
      body: teaser.body,
      dataKey: tip.id,
    });
    if (r.ok) pushed += 1;
  }
  return { pushed };
}

/**
 * Beim Anlegen eines Flugtags: Morgen-Push „Gepäck“ vorplanen.
 */
export async function scheduleFlightMorningLuggagePush(opts: {
  departureMs: number;
  airportName?: string | null;
  hasCheckedLuggage?: boolean;
}): Promise<void> {
  const dep = new Date(opts.departureMs);
  // 08:00 am Abflugtag (oder 90 Min nach Mitternacht wenn Abflug früh)
  const morning = new Date(opts.departureMs);
  morning.setHours(8, 0, 0, 0);
  if (morning.getTime() >= opts.departureMs - 90 * 60_000) {
    morning.setTime(opts.departureMs - 3 * 60 * 60_000);
  }
  if (morning.getTime() < Date.now() + 60_000) {
    // schon Vormittag — sofortiger Nice-Push
    const { scheduleNiceInfoPush } = await import(
      '../notifications/niceInfoNotifications'
    );
    void scheduleNiceInfoPush({
      title: '🧳 Gepäck vor dem Flug',
      body: opts.airportName
        ? `Abflug ${dep.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })} · ${opts.airportName} — Spot oder Hotel?`
        : `Abflug ${dep.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })} — Gepäck jetzt klären?`,
      dataKey: `luggage-now-${dateKeyFromMs(opts.departureMs)}`,
    });
    return;
  }

  const { scheduleNiceInfoPushAt } = await import(
    '../notifications/niceInfoNotifications'
  );
  void scheduleNiceInfoPushAt({
    fireAtMs: morning.getTime(),
    title: '🧳 Gepäck abgeben?',
    body: opts.hasCheckedLuggage
      ? `Flugtag — Aufgabe / Spot / Hotel klären vor dem Weg zum ${opts.airportName ?? 'Flugplatz'}.`
      : `Vorm Flug: Gepäck-Spot in der Nähe oder im Hotel lassen?`,
    dataKey: `luggage-am-${dateKeyFromMs(opts.departureMs)}`,
  });
}
