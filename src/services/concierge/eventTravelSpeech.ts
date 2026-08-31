/**
 * Event-/Festival-ETA in Speech: Ankunftsuhr + Modus (kein vages „ca. 2 Stunden“).
 * Mobility-SSOT: planMobilityPolicy (>20 Min → ÖPNV wenn sinnvoll).
 */

import { haversineMeters } from '../../db/database';
import { pickPlanMobilityMode } from '../../module2/planning/planMobilityPolicy';
import {
  formatDistanceKmOrM,
  formatDurationMinutesDe,
} from '../navigation/travelEta';

export type EventTravelHint = {
  /** Spoken: Ankunftsuhr + Modus — keine nackte Dauer als Hauptaussage */
  speech: string;
  /** Bullet-only distance */
  distLabel: string;
  mode: 'walk' | 'bike' | 'transit' | 'taxi';
  minutes: number;
  /** Ankunft wenn jetzt los (lokale Uhr) */
  arrivalClock: string;
  meters: number;
};

function clockInMinutes(minutes: number, from = new Date()): string {
  const arrive = new Date(from.getTime() + Math.max(1, minutes) * 60_000);
  const h = arrive.getHours().toString().padStart(2, '0');
  const m = arrive.getMinutes().toString().padStart(2, '0');
  return `${h}:${m}`;
}

/** Speech-Blaupause: Ankunft + Modus als Fließsatz-Fragment (kein Label, kein Telegramm). */
export function formatEventTravelArrivalSpeech(opts: {
  minutes: number;
  mode: 'walk' | 'bike' | 'transit' | 'taxi';
  arrivalClock?: string;
}): string {
  const clock = opts.arrivalClock || clockInMinutes(opts.minutes);
  const dur = formatDurationMinutesDe(opts.minutes, 'speech');
  // Kurze Strecken: Dauer natürlich einbetten
  if (opts.minutes <= 25) {
    switch (opts.mode) {
      case 'transit':
        return `mit ÖPNV bist du in ${dur} da`;
      case 'bike':
        return `mit dem Rad bist du in ${dur} da`;
      case 'taxi':
        return `mit Taxi bist du in ${dur} da`;
      default:
        return `zu Fuß bist du in ${dur} da`;
    }
  }
  // Länger: Ankunftsuhr — flüssig, nie „Anreise:“ / nie nacktes „wenn du jetzt…“ als Überschrift
  switch (opts.mode) {
    case 'transit':
      return `mit ÖPNV wärst du gegen ${clock} Uhr da`;
    case 'bike':
      return `mit dem Rad wärst du gegen ${clock} Uhr da`;
    case 'taxi':
      return `mit Taxi/Auto wärst du gegen ${clock} Uhr da`;
    default:
      return `zu Fuß wärst du gegen ${clock} Uhr da`;
  }
}

/**
 * Flüssiger Anschluss an laufenden Satz/Absatz — kein „Anreise:“-Label.
 * Dies sind nur abstrakte Beispiele für den logischen Ablauf. Übernimm niemals
 * den genauen Wortlaut. Passe deine Antwort immer dynamisch und organisch an
 * den aktuellen Kontext und die aktuelle Stadt an.
 */
export function weaveEventTravelIntoSpeech(
  travelClause: string,
  style: 'continue' | 'tail' = 'tail',
): string {
  const clause = travelClause.replace(/\s+/g, ' ').trim().replace(/^[—–-]\s*/, '');
  if (!clause) return '';
  if (style === 'continue') {
    return ` und ${clause}`;
  }
  // Nach Satzende: weicher Übergang, kleingeschriebenes Verb behalten
  return ` Von hier ${clause}.`;
}

/**
 * Grobe ETA aus Luftlinie (kein Directions-Roundtrip in der Speech-Seed).
 * Fuß ~80 m/min, Rad ~3× schneller, ÖPNV ~45 % der Fußzeit (Floor 12) —
 * näher an echten HVV/DB-Zeiten als 55 %.
 * Wenn ÖPNV klar besser: nur ÖPNV nennen — kein Parallel-Fuß-Pitch.
 */
export function eventTravelHintFromCoords(opts: {
  fromLat: number;
  fromLng: number;
  toLat: number;
  toLng: number;
  preferBike?: boolean;
  /** echte Journey-Minuten überschreiben Schätzung */
  liveTransitMin?: number | null;
  liveArrivalAt?: Date | null;
}): EventTravelHint | null {
  const distM = haversineMeters(
    opts.fromLat,
    opts.fromLng,
    opts.toLat,
    opts.toLng,
  );
  if (!Number.isFinite(distM) || distM < 40) return null;

  const walkMin = Math.max(1, Math.round(distM / 80));
  const bikeMin = Math.max(1, Math.round(distM / 250));
  const transitMin =
    opts.liveTransitMin != null && Number.isFinite(opts.liveTransitMin)
      ? Math.max(8, Math.round(opts.liveTransitMin))
      : Math.max(12, Math.round(walkMin * 0.45));
  const taxiMin = Math.max(4, Math.round(distM / 700));

  const mode = pickPlanMobilityMode({
    walkMin,
    bikeMin,
    transitMin,
    taxiMin,
    preferBike: opts.preferBike === true,
  });

  const distLabel = formatDistanceKmOrM(distM);
  let minutes = walkMin;

  switch (mode) {
    case 'bike':
      minutes = bikeMin;
      break;
    case 'transit':
      minutes = transitMin;
      break;
    case 'taxi':
    case 'car':
      minutes = taxiMin;
      break;
    default:
      minutes = walkMin;
      break;
  }

  const resolvedMode: EventTravelHint['mode'] =
    mode === 'car' || mode === 'flight' || mode === 'unknown' ? 'taxi' : mode;

  const arrivalClock =
    opts.liveArrivalAt && Number.isFinite(opts.liveArrivalAt.getTime())
      ? (() => {
          const h = opts.liveArrivalAt!.getHours().toString().padStart(2, '0');
          const m = opts.liveArrivalAt!.getMinutes().toString().padStart(2, '0');
          return `${h}:${m}`;
        })()
      : clockInMinutes(minutes);

  return {
    speech: formatEventTravelArrivalSpeech({
      minutes,
      mode: resolvedMode,
      arrivalClock,
    }),
    distLabel,
    mode: resolvedMode,
    minutes,
    arrivalClock,
    meters: Math.round(distM),
  };
}

/**
 * Live-ÖPNV für Top-Events: echte Minuten + Journey cachen (Route-Button).
 * Timeout-geschützt — bei Fail bleibt Luftlinien-Schätzung.
 */
export async function enrichEventsWithLiveTransit(opts: {
  events: Array<{
    lat?: number | null;
    lng?: number | null;
    venue?: string;
    title?: string;
    liveTransitMin?: number | null;
    liveArrivalAtMs?: number | null;
  }>;
  fromLat: number;
  fromLng: number;
  timeoutMs?: number;
}): Promise<void> {
  const top = opts.events
    .filter(
      (e) =>
        typeof e.lat === 'number' &&
        typeof e.lng === 'number' &&
        Number.isFinite(e.lat) &&
        Number.isFinite(e.lng),
    )
    .slice(0, 2);
  if (!top.length) return;

  const timeoutMs = Math.max(800, opts.timeoutMs ?? 2800);
  const work = async () => {
    const { planTransitHandsFree } = await import(
      '../navigation/handsFreeNav/transitBridge'
    );
    const { rememberJourneyForStart } = await import(
      '../navigation/journeyStartCache'
    );
    // Favorit zuerst cachen
    for (let i = 0; i < top.length; i++) {
      const e = top[i]!;
      try {
        const best = await planTransitHandsFree({
          from: { lat: opts.fromLat, lng: opts.fromLng },
          to: { lat: e.lat!, lng: e.lng! },
        });
        if (!best) continue;
        const min = Math.max(1, Math.round(best.durationSec / 60));
        e.liveTransitMin = min;
        const end =
          best.endTime instanceof Date
            ? best.endTime
            : best.endTime
              ? new Date(best.endTime)
              : null;
        if (end && Number.isFinite(end.getTime())) {
          e.liveArrivalAtMs = end.getTime();
        }
        if (i === 0) {
          rememberJourneyForStart({
            itinerary: best,
            destName: (e.venue || e.title || 'Fest').trim(),
            destLat: e.lat!,
            destLng: e.lng!,
          });
        }
      } catch {
        /* soft */
      }
    }
  };

  await Promise.race([
    work(),
    new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
  ]);
}

export {
  parseSpokenClockToMinutes,
  formatClockMinutesForSpeech,
  isLaterPlanSchedule,
  formatRelativeWhenSpeech,
  formatLaterPlanClosenessSpeech,
} from '../speech/laterPlanSpeech';
