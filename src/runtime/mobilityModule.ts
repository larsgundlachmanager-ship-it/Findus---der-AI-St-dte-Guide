/**
 * Modul 3 Mobility (Phase 7).
 * Bike: frühere Trigger, kürzere Ansagen, Prefetch, Fahrradwege
 * ÖPNV: Sub-Modus, Push, Verspätung
 * Presence-Ping nach ~30 Min Stille (6 h Cooldown)
 * Proaktiver Aufpasser (Reservierung, Flug, Bus, Wetter vs. Bike)
 * Adaptive GPS in Production (gpsPolicy + adaptiveGpsService)
 */

import { updateAdaptiveGpsProfile, distanceToNearestTriggerM } from '../services/adaptiveGpsService';
import {
  isGpsDeepSleeping,
  tickStillnessFromGps,
} from '../services/battery/pedometerSleep';
import { speakRuntimeText } from './speechModule';
import { getActiveCatchMyBusReminder } from '../services/transit/catchMyBusReminder';
import { getPendingWakeProposal } from '../services/alarms/wakeAlarmAdvisor';
import {
  getWeatherRoutingAdjustment,
  resolveWeatherRouting,
} from '../services/weatherService';
import {
  getGpsStreamProfile,
  setGpsStreamProfile,
  type GpsStreamProfile,
} from '../services/locationService';
import {
  getCurrentTransportMode,
} from '../services/navigation/navigationService';
import type { TransportMode } from '../services/navigation/navigationTypes';
import { isTransitMode } from '../services/navigation/transportMode';
import {
  PREFETCH_PLAY_M,
  PREFETCH_WARM_M,
  tickPoiPrefetch,
} from '../services/navigation/poiPrefetchService';
import { getVoiceSettingsForTour } from '../services/ttsService';
import { tickDeadlineWatcher } from '../services/planning/tickDeadlineWatcher';
import { evaluateProactiveHud } from '../services/ui/proactiveHudEngine';
import { tickProactiveReminderEngine } from '../services/ui/proactiveReminderEngine';
import { useFinnusStore } from '../store/useFinnusStore';
import { resolveGpsPollPolicy } from './gpsPolicy';
import type { GpsSample } from './types';

/** ~30 Min ohne Bewegung/Interaktion → Presence-Ping (kontextueller Vorschlag). */
export const PRESENCE_SILENCE_MS = 30 * 60_000;

/** Nach einer Nachfrage: 6 h Pause (egal ob ignoriert oder „alles gut“). */
const PRESENCE_MIN_GAP_MS = 6 * 60 * 60_000;

/** Bike: früherer Prefetch-Warmup / Play (Masterbook). */
export const BIKE_PREFETCH_WARM_M = 160;
export const BIKE_PREFETCH_PLAY_M = 35;

/** ÖPNV Drive-by: noch früher warmen. */
export const TRANSIT_PREFETCH_WARM_M = 200;
export const TRANSIT_PREFETCH_PLAY_M = 50;

const STILL_SPEED_MS = 0.35;
const PROACTIVE_MIN_GAP_MS = 8 * 60_000;
const WEATHER_BIKE_WARN_GAP_MS = 45 * 60_000;

export type PrefetchRadii = { warmM: number; playM: number };

let lastActivityMs = Date.now();
let lastPresencePingMs = 0;
let lastProactiveMs = 0;
let lastWeatherBikeWarnMs = 0;
let presenceInFlight = false;

export function noteMobilityUserActivity(): void {
  lastActivityMs = Date.now();
}

export function getPrefetchRadii(mode: TransportMode): PrefetchRadii {
  if (mode === 'bicycle') {
    return { warmM: BIKE_PREFETCH_WARM_M, playM: BIKE_PREFETCH_PLAY_M };
  }
  if (isTransitMode(mode)) {
    return { warmM: TRANSIT_PREFETCH_WARM_M, playM: TRANSIT_PREFETCH_PLAY_M };
  }
  return { warmM: PREFETCH_WARM_M, playM: PREFETCH_PLAY_M };
}

/** Kürzere Bike-Ansagen — max. ~2 Sätze. */
export function condenseForBikeMode(text: string, maxChars = 140): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return clean;
  const sentences = clean.match(/[^.!?]+[.!?]+|[^.!?]+$/g) ?? [clean];
  const short = sentences.slice(0, 2).join(' ').trim();
  if (short.length <= maxChars) return short;
  const cut = short.slice(0, maxChars - 1);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > 40 ? cut.slice(0, lastSpace) : cut).trim()}…`;
}

export function isTransitSubModeActive(): boolean {
  const store = useFinnusStore.getState();
  const mode = getCurrentTransportMode();
  return store.navActive && isTransitMode(mode);
}

function mapTransportForPolicy(
  mode: TransportMode,
): 'walk' | 'bicycle' | 'transit' | 'unknown' {
  if (mode === 'bicycle') return 'bicycle';
  if (mode === 'walk') return 'walk';
  if (isTransitMode(mode)) return 'transit';
  return 'unknown';
}

function profileFromPolicyInterval(
  intervalMs: number,
  transportMode: TransportMode,
): GpsStreamProfile {
  if (intervalMs >= 25_000) return 'far';
  if (intervalMs >= 4_500) return 'economy';
  if (transportMode === 'bicycle') return 'realtime-bike';
  return 'realtime';
}

/**
 * Production adaptive GPS: runtime gpsPolicy + distance tiers + bike profile.
 */
export async function applyAdaptiveGpsForTick(opts: {
  lat: number;
  lng: number;
  speedMs?: number | null;
  audioBusy?: boolean;
  transportMode: TransportMode;
}): Promise<GpsStreamProfile> {
  if (isGpsDeepSleeping()) return 'sleep';

  const store = useFinnusStore.getState();
  const nearestDist = await distanceToNearestTriggerM(opts.lat, opts.lng);
  const sample: GpsSample = {
    lat: opts.lat,
    lng: opts.lng,
    speedMs: opts.speedMs ?? null,
  };
  const policy = resolveGpsPollPolicy({
    sample,
    nearestTriggerDistM: nearestDist,
    transportMode: mapTransportForPolicy(opts.transportMode),
  });

  let next = profileFromPolicyInterval(policy.intervalMs, opts.transportMode);

  if (opts.audioBusy || store.isPlayingAudio) {
    next = 'throttled';
  } else if (store.navActive) {
    const base = await updateAdaptiveGpsProfile({
      lat: opts.lat,
      lng: opts.lng,
      speedMs: opts.speedMs ?? null,
      audioBusy: opts.audioBusy,
    });
    next = base;
    // Bike-Nav: hohe Frequenz nur während aktiver Navigation
    if (
      opts.transportMode === 'bicycle' &&
      base !== 'sleep' &&
      base !== 'throttled' &&
      base !== 'far'
    ) {
      next = 'realtime-bike';
    }
  } else {
    // Free-Roam: sparsam — kein realtime-bike (Paywall/Akku); nahe POI → realtime
    const base = await updateAdaptiveGpsProfile({
      lat: opts.lat,
      lng: opts.lng,
      speedMs: opts.speedMs ?? null,
      audioBusy: opts.audioBusy,
    });
    next = base;
  }

  if (getGpsStreamProfile() !== next) {
    await setGpsStreamProfile(next);
  }
  return next;
}

async function speakProactiveLine(
  speech: string,
  opts?: { critical?: boolean },
): Promise<void> {
  const store = useFinnusStore.getState();
  if (!opts?.critical) {
    try {
      const { allowProactiveVoice } = await import(
        '../services/ui/nachtruhePolicy'
      );
      if (!allowProactiveVoice()) return;
    } catch {
      /* soft — Policy fehlt → weiter */
    }
  }
  try {
    const { canModule4Speak } = await import(
      '../services/navigation/modulePriorityPolicy'
    );
    const gate = canModule4Speak();
    if (!gate.ok) {
      // Kein Modul-2-Queue mehr — Proaktiv später erneut versuchen
      return;
    }
  } catch {
    if (store.isPlayingAudio || store.isListening || store.isGenerating) return;
  }
  if (store.isPlayingAudio) return;
  try {
    const voice = await getVoiceSettingsForTour();
    await speakRuntimeText(speech, {
      voiceId: voice.voiceId,
      speechRate: voice.speechRate,
    });
    lastProactiveMs = Date.now();
    noteMobilityUserActivity();
  } catch (err) {
    console.warn('[mobility] proactive speak failed:', err);
  }
}

async function maybeWeatherBikeConflict(transportMode: TransportMode): Promise<void> {
  if (transportMode !== 'bicycle') return;
  try {
    const { allowProactiveVoice } = await import(
      '../services/ui/nachtruhePolicy'
    );
    if (!allowProactiveVoice()) return;
  } catch {
    /* soft */
  }
  const now = Date.now();
  if (now - lastWeatherBikeWarnMs < WEATHER_BIKE_WARN_GAP_MS) return;

  const store = useFinnusStore.getState();
  if (store.isPlayingAudio || store.isListening || store.navActive) return;

  const adj =
    store.lastGpsLat != null && store.lastGpsLng != null
      ? await resolveWeatherRouting({
          lat: store.lastGpsLat,
          lng: store.lastGpsLng,
        })
      : getWeatherRoutingAdjustment();

  if (!adj.isHeavyRain || !adj.voiceAlert) return;

  lastWeatherBikeWarnMs = now;
  const extra =
    ' Wenn du lieber trocken bleiben willst, sag Bescheid — dann schauen wir uns ÖPNV an.';
  await speakProactiveLine(`${adj.voiceAlert}${extra}`);
}

async function maybeTransitImminentPing(): Promise<void> {
  const reminder = getActiveCatchMyBusReminder();
  if (!reminder) return;
  const msToLeave = reminder.leaveBy.getTime() - Date.now();
  if (msToLeave > 3 * 60_000 || msToLeave < -60_000) return;

  const store = useFinnusStore.getState();
  if (store.isPlayingAudio || store.isListening) return;

  const speech = `Kurzer Hinweis: Dein Bus ${reminder.line} — du solltest jetzt Richtung Haltestelle los.`;
  await speakProactiveLine(speech, { critical: true });
}

async function maybeWakeAlarmNudge(): Promise<void> {
  const store = useFinnusStore.getState();
  if (store.isPlayingAudio || store.isListening) return;

  // Offener Timeline-Wecker später heute + User schon aktiv → Early-Wake-Angebot
  try {
    const { listWakeStopsForDay } = await import(
      '../services/alarms/nativeAlarmBridge'
    );
    const { todayDateKey } = await import('../utils/dateKeys');
    const wakes = listWakeStopsForDay(todayDateKey())
      .filter(
        (s) =>
          s.plannedStartMs != null && s.plannedStartMs > Date.now() + 3 * 60_000,
      )
      .sort((a, b) => (a.plannedStartMs ?? 0) - (b.plannedStartMs ?? 0));
    const next = wakes[0];
    if (next?.plannedStartMs != null) {
      const msToWake = next.plannedStartMs - Date.now();
      // Schon wach, Wecker in 10–90 Min → anerkennen + Löschen (Briefing deckt früheren Morgen ab)
      if (msToWake >= 10 * 60_000 && msToWake <= 90 * 60_000) {
        const key = `early_wake_${next.plannedStartMs}`;
        const g = globalThis as { __findusEarlyWakeOffered?: Set<string> };
        if (!g.__findusEarlyWakeOffered) g.__findusEarlyWakeOffered = new Set();
        if (!g.__findusEarlyWakeOffered.has(key)) {
          g.__findusEarlyWakeOffered.add(key);
          const clock = new Date(next.plannedStartMs).toLocaleTimeString(
            'de-DE',
            { hour: '2-digit', minute: '2-digit' },
          );
          await speakProactiveLine(
            `Du bist ja schon früher wach — soll ich den Wecker um ${clock} löschen?`,
            { critical: false },
          );
          store.setActiveConciergeCard({
            id: `early-wake-${Date.now()}`,
            createdAtMs: Date.now(),
            cardTitle: 'Wecker',
            speechText: `Du bist ja schon früher wach — soll ich den Wecker um ${clock} löschen?`,
            visualBullets: [`Wecker ${clock}`],
            quickActions: [
              {
                type: 'SET_WAKE_ALARM',
                label: 'Wecker löschen',
                payload: {
                  dateIso: new Date(next.plannedStartMs).toISOString(),
                  wakeMode: 'cancel',
                  replaceWakeAtMs: next.plannedStartMs,
                  destName: 'Wecker',
                },
              },
            ],
          });
          return;
        }
      }
    }
  } catch {
    /* soft */
  }

  const proposal = getPendingWakeProposal();
  if (!proposal) return;
  const msToWake = proposal.wakeAtMs - Date.now();
  if (msToWake > 5 * 60_000 || msToWake < -60_000) return;

  await speakProactiveLine(
    `Guten Morgen — in ein paar Minuten ist Wecker-Zeit für ${proposal.reasonLabel}.`,
    { critical: true },
  );
}

async function tickProactiveWatcher(
  transportMode: TransportMode,
): Promise<void> {
  const now = Date.now();
  if (now - lastProactiveMs < PROACTIVE_MIN_GAP_MS) return;

  const store = useFinnusStore.getState();
  if (store.isPlayingAudio || store.isListening || store.isGenerating) return;
  if (store.activeConciergeCard) return;

  await maybeWeatherBikeConflict(transportMode);
  await maybeTransitImminentPing();
  await maybeWakeAlarmNudge();
}

async function requestPresencePingViaGemini(): Promise<void> {
  if (presenceInFlight) return;
  const store = useFinnusStore.getState();
  if (store.isPlayingAudio || store.isListening || store.isGenerating) return;
  if (store.navActive) return;

  try {
    const { allowActivitySoftTips } = await import(
      '../services/ui/nachtruhePolicy'
    );
    // Presence = „was machen?“ — nur 10:30–19:30
    if (!allowActivitySoftTips()) return;
  } catch {
    /* soft */
  }

  try {
    const { getCachedUserProfile } = await import('../services/userProfileService');
    const profile = getCachedUserProfile();
    const setupAt = profile?.completedAt
      ? Date.parse(profile.completedAt)
      : NaN;
    // Frühestens 2 h nach Einrichtung — kein Presence-Ping direkt danach
    if (Number.isFinite(setupAt) && Date.now() - setupAt < 2 * 60 * 60_000) {
      return;
    }
  } catch {
    /* soft */
  }

  // Venue-Gate: in Restaurant/Museum/Aktivität nicht nerven;
  // Hotel oder leerer/random Ort ohne Plan → ok
  const gate = await shouldOfferPresenceSuggestion();
  if (!gate.ok) return;

  presenceInFlight = true;
  try {
    const place = humanPlaceLabel(store.currentLocationName);
    const suggestion = buildPresenceSuggestion({
      place,
      atHotel: gate.atHotel,
      openTodo: gate.openTodo,
    });

    lastPresencePingMs = Date.now();

    const { presentConciergeResponse } = await import(
      '../services/concierge/presentConcierge'
    );
    await presentConciergeResponse({
      speechText: suggestion.speech,
      cardTitle: suggestion.cardTitle,
      visualBullets: suggestion.bullets,
      quickActions: suggestion.actions,
    });
  } catch (err) {
    console.warn('[mobility] presence ping failed:', err);
  } finally {
    presenceInFlight = false;
  }
}

function humanPlaceLabel(raw: string | null | undefined): string {
  const t = (raw ?? '').trim();
  if (!t) return 'hier';
  // Nie Koordinaten als Ortsname
  if (
    /\b\d{1,3}\.\d{3,}\s*,\s*-?\d{1,3}\.\d{3,}\b/.test(t) ||
    /^ort\s+bei\s+\d/i.test(t)
  ) {
    return 'hier';
  }
  return t;
}

const VENUE_BUSY_RE =
  /\b(restaurant|café|cafe|bistro|imbiss|pizzeria|gasthof|museum|galerie|kino|theater|ausstellung|sport|tennis|fitness|gym|bad|schwimm|bibliothek|kirche|dom|schloss|zoo|freizeitpark|bowling|minigolf|escape|workshop|kurs|praxis|zahnarzt|friseur|frisör)\b/iu;

async function shouldOfferPresenceSuggestion(): Promise<{
  ok: boolean;
  atHotel: boolean;
  openTodo: string | null;
}> {
  const store = useFinnusStore.getState();
  let atHotel = false;
  try {
    const { resolvePlacePresence } = await import('../services/geo/placePresence');
    const presence = resolvePlacePresence({
      lat: store.lastGpsLat,
      lng: store.lastGpsLng,
      speedMs: 0,
    });
    atHotel = presence.role === 'hotel';
  } catch {
    /* soft */
  }

  let openTodo: string | null = null;
  try {
    // Session-Plan offene Todos (kein Modul-5-Tagesplan mehr)
    const { useSessionPlanStore } = await import(
      '../store/useSessionPlanStore'
    );
    const plan = useSessionPlanStore.getState().plan;
    if (plan?.active && plan.stops?.length) {
      const pending = plan.stops.find((s) => !s.done && (s.label ?? '').trim());
      if (pending?.label) openTodo = pending.label.trim();
    }
  } catch {
    /* soft */
  }

  // Bekannter POI vom Typ Restaurant/Museum/Aktivität → still
  const placeBlob = `${store.currentLocationName ?? ''}`.toLowerCase();
  if (!atHotel && store.currentPoiId != null && VENUE_BUSY_RE.test(placeBlob)) {
    return { ok: false, atHotel, openTodo };
  }
  if (!atHotel && store.currentPoiId != null) {
    try {
      const { getAllPois } = await import('../db/database');
      const pois = await getAllPois();
      const poi = pois.find((p) => p.id === store.currentPoiId);
      if (poi) {
        const cat = `${poi.category ?? ''} ${poi.kind ?? ''} ${poi.name}`.toLowerCase();
        if (VENUE_BUSY_RE.test(cat)) {
          return { ok: false, atHotel, openTodo };
        }
      }
    } catch {
      /* soft */
    }
  }

  // Hotel, random / kein Eintrag, oder nicht im Plan → Vorschlag ok
  return { ok: true, atHotel, openTodo };
}

function buildPresenceSuggestion(opts: {
  place: string;
  atHotel: boolean;
  openTodo: string | null;
}): {
  speech: string;
  cardTitle: string;
  bullets: string[];
  actions: Array<{
    type: 'SHOW_MORE';
    label: string;
    payload: { textPrompt: string };
  }>;
} {
  const h = new Date().getHours();
  const variants: Array<{
    speech: string;
    title: string;
    prompt: string;
    label: string;
  }> = [];

  if (opts.openTodo) {
    variants.push({
      speech: `Du wolltest noch „${opts.openTodo}" besorgen — sollen wir das kurz holen?`,
      title: 'Offener Punkt',
      prompt: `Lass uns kurz „${opts.openTodo}" erledigen`,
      label: '✅ Kurz holen',
    });
  }

  if (h >= 5 && h < 11) {
    variants.push({
      speech: opts.atHotel
        ? 'Schöner Morgen — wollen wir frühstücken?'
        : 'Wollen wir irgendwo gemütlich frühstücken?',
      title: 'Frühstück',
      prompt: 'Was schlägst du zum Frühstück vor?',
      label: '🥐 Frühstück',
    });
  } else if (h >= 17 || h < 3) {
    variants.push({
      speech: 'Am Abend — wollen wir noch was essen gehen?',
      title: 'Abendessen',
      prompt: 'Was schlägst du heute Abend zum Essen vor?',
      label: '🍽 Essen gehen',
    });
  } else {
    variants.push({
      speech: 'Schöner Moment für einen Spaziergang durch den Park — Lust?',
      title: 'Spaziergang',
      prompt: 'Bring mich zu einem schönen Park oder Spazierweg in der Nähe',
      label: '🌳 Spaziergang',
    });
    variants.push({
      speech: 'Wollen wir einen kurzen schönen Spaziergang machen?',
      title: 'Raus',
      prompt: 'Schlage einen kurzen schönen Spaziergang in der Nähe vor',
      label: '🚶 Kurz raus',
    });
  }

  // Rotiere anhand Stunde, vermeide immer dieselbe Floskel
  const pick = variants[Math.floor(Date.now() / 3600_000) % variants.length]!;
  return {
    speech: pick.speech,
    cardTitle: pick.title,
    bullets: opts.place && opts.place !== 'hier' ? [opts.place] : [pick.title],
    actions: [
      {
        type: 'SHOW_MORE',
        label: pick.label,
        payload: { textPrompt: pick.prompt },
      },
      {
        type: 'SHOW_MORE',
        label: '❓ Andere Idee',
        payload: {
          textPrompt: 'Hast du eine andere Idee, was wir jetzt machen können?',
        },
      },
    ],
  };
}

function tickNavPresencePing(speedMs: number | null | undefined): void {
  const now = Date.now();
  const speed =
    typeof speedMs === 'number' && Number.isFinite(speedMs) ? speedMs : 0;

  if (speed > STILL_SPEED_MS) {
    noteMobilityUserActivity();
    return;
  }

  const store = useFinnusStore.getState();
  if (store.isPlayingAudio || store.isListening || store.isGenerating) {
    noteMobilityUserActivity();
    return;
  }

  if (now - lastActivityMs < PRESENCE_SILENCE_MS) return;
  if (now - lastPresencePingMs < PRESENCE_MIN_GAP_MS) return;

  void requestPresencePingViaGemini();
}

/**
 * Main GPS-tick hook — call from handleLocationUpdate.
 */
export async function tickMobilityOnGps(
  lat: number,
  lng: number,
  opts?: {
    speedMs?: number | null;
    headingDeg?: number | null;
    transportMode?: TransportMode;
    audioBusy?: boolean;
  },
): Promise<void> {
  tickStillnessFromGps(opts?.speedMs ?? null);

  const transportMode = opts?.transportMode ?? getCurrentTransportMode();
  const store = useFinnusStore.getState();
  const audioBusy =
    opts?.audioBusy ?? (store.isPlayingAudio || store.isGenerating);

  await applyAdaptiveGpsForTick({
    lat,
    lng,
    speedMs: opts?.speedMs ?? null,
    audioBusy,
    transportMode,
  });

  const radii = getPrefetchRadii(transportMode);
  void tickPoiPrefetch(lat, lng, radii);

  tickNavPresencePing(opts?.speedMs ?? null);
  void tickProactiveWatcher(transportMode);
  // Deadline interrupt even when proactive gap blocks speech — time-critical
  void tickDeadlineWatcher();

  // Stumm-Session: Zeit- oder Geofence-Wake
  void import('../services/audio/muteSessionService').then(({ tickMuteSession }) =>
    tickMuteSession({ lat, lng }),
  );

  // Proaktive HUD + Reminder — max alle 15 Min (Voice/Push/HUD)
  evaluateProactiveHud({ ctx: { lat, lng } });
  void tickProactiveReminderEngine({ lat, lng });
}

/** ÖPNV Push + Verspätung — Re-Export für Modul-3-Fassade. */
export {
  getActiveCatchMyBusReminder,
  scheduleCatchMyBusReminder,
  clearCatchMyBusReminder,
  isCatchMyBusQuery,
} from '../services/transit/catchMyBusReminder';

export type { CatchMyBusReminder } from '../services/transit/catchMyBusReminder';
