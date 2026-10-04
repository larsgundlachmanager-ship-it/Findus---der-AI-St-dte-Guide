/**
 * Compound Mobility — Taxi + Venue / Flight / Dining as work[] chain
 * oder Prioritätsfrage (zwei Speak-Pfade). Kein dünner Transit-Einzeiler.
 */

import { wantsTaxiRide } from '../../services/mobility/taxiRideIntent';
import type { TurnWorkTask } from './turnFrame';
import type { ManagerAnalysis } from './types';
import { emptyTurnFrame } from './turnFrame';

export type MobilityCompoundKind =
  | 'taxi_only'
  | 'taxi_before_venue'
  | 'taxi_leave_by_flight'
  | 'dining_plus_taxi'
  | null;

export type DiningTaxiCompoundMode = 'work_chain' | 'priority_ask';

export type DiningTaxiCompoundPlan = {
  mode: DiningTaxiCompoundMode;
  kind: MobilityCompoundKind;
  work: TurnWorkTask[];
  thinkAhead: string[];
  /** Für priority_ask: Spuren in openLoops/intents behalten */
  openLoops: string[];
};

const TAXI_SLOT_BRIEF =
  'Taxi/Uber: Ziel auflösen → Vorbestell-/Deep-Link → ETA → Preis nur belegt — kein leerer Hail-Einzeiler';

/** Flug + Taxi im Satz → Leave-by, kein reines Hail. */
export function looksLikeTaxiWithFlight(text: string): boolean {
  const t = (text || '').replace(/\s+/g, ' ').trim();
  if (!t) return false;
  const flight = /\b(flieg(?:e|st|t)?|fliegen|flug|flieger|abflug|boarding|flughafen)\b/iu.test(
    t,
  );
  const taxi = wantsTaxiRide(t) || /\b(taxi|uber|bolt|freenow)\b/iu.test(t);
  return flight && taxi;
}

/** Taxi vor/nach Restaurant/Theater/Venue (ohne Flug). */
export function looksLikeTaxiBeforeVenue(text: string): boolean {
  const t = (text || '').replace(/\s+/g, ' ').trim();
  if (!t || looksLikeTaxiWithFlight(t)) return false;
  if (!wantsTaxiRide(t) && !/\b(taxi|uber)\b/iu.test(t)) return false;
  return /\b(restaurant|theater|theatre|kino|venue|café|cafe|bar|hotel|essen|vor(?:her)?|bevor|danach|nach\s+dem|zum\s+(?:theater|restaurant|kino))\b/iu.test(
    t,
  );
}

/** Essen suchen (AYCE/Restaurant) + Taxi in einem Satz. */
export function looksLikeDiningPlusTaxi(text: string): boolean {
  const t = (text || '').replace(/\s+/g, ' ').trim();
  if (!t || looksLikeTaxiWithFlight(t)) return false;
  const taxi = wantsTaxiRide(t) || /\b(taxi|uber|bolt|freenow)\b/iu.test(t);
  if (!taxi) return false;
  const dining =
    /\b(essen|restaurant|gastro|ayce|all\s*you\s*can\s*eat|all\s*xou\s*can\s*eat|mittagessen|abendessen|dining|steak|pizzeria)\b/iu.test(
      t,
    ) || /\b(wo\s+kann\s+ich|was\s+essen|hunger)\b/iu.test(t);
  return dining;
}

/** Klare Reihenfolge im Satz (danach / bevor / nach dem …). */
export function hasClearDiningTaxiOrder(text: string): boolean {
  const t = (text || '').replace(/\s+/g, ' ').trim();
  return /\b(danach|vorher|bevor|nach\s+dem|nachher|zuerst|erst\s+(?:mal|das)|dann\s+(?:ein\s+)?taxi|taxi\s+(?:danach|vorher|bevor))\b/iu.test(
    t,
  );
}

export function detectMobilityCompoundKind(
  text: string,
): MobilityCompoundKind {
  const t = (text || '').replace(/\s+/g, ' ').trim();
  if (!t) return null;
  try {
    const { isSoloFlightAbSearch } = require('../../services/flights/flightTripIntent') as {
      isSoloFlightAbSearch: (s: string) => boolean;
    };
    const { isFindusReisebueroHandoff } = require('../../reisebuero/handoff') as {
      isFindusReisebueroHandoff: (s: string) => boolean;
    };
    // Solo-Flug / Reisebüro: kein Taxi-Compound-Steal (außer klar taxi+flight leave-by)
    if (isFindusReisebueroHandoff(t)) return null;
    if (isSoloFlightAbSearch(t) && !looksLikeTaxiWithFlight(t)) return null;
  } catch {
    /* soft */
  }
  try {
    const { inferCall1JobShape } = require('./call1JobShape') as {
      inferCall1JobShape: (s: string) => string;
    };
    const shape = inferCall1JobShape(t);
    if (
      shape === 'place_dining' &&
      !looksLikeDiningPlusTaxi(t) &&
      !looksLikeTaxiBeforeVenue(t)
    ) {
      return null;
    }
    if (
      shape === 'weather_info' ||
      shape === 'weather_rain' ||
      shape === 'weather_outfit' ||
      shape === 'fact_lookup'
    ) {
      return null;
    }
  } catch {
    /* soft */
  }
  if (looksLikeTaxiWithFlight(t)) return 'taxi_leave_by_flight';
  if (looksLikeDiningPlusTaxi(t)) return 'dining_plus_taxi';
  if (looksLikeTaxiBeforeVenue(t)) return 'taxi_before_venue';
  if (wantsTaxiRide(t)) return 'taxi_only';
  return null;
}

function diningLeadTask(text: string): TurnWorkTask {
  const ayce = /\b(ayce|all\s*you\s*can\s*eat|all\s*xou\s*can\s*eat)\b/iu.test(
    text,
  );
  const avoidAsia = /\b(kein[e]?n?\s+asiatisch|nicht\s+asiatisch|ohne\s+asiatisch)\b/iu.test(
    text,
  );
  const must: string[] = [];
  if (ayce) must.push('all_you_can_eat');
  if (avoidAsia) must.push('avoid_cuisine_asian');
  return {
    id: 'venue',
    worker: 'dining',
    brief: ayce
      ? 'AYCE-Orte finden (belegt all_you_can_eat); Avoid-Kriterien hart; Top-2'
      : 'Restaurant/Venue laut Satz finden (vor Taxi)',
    startIsGps: true,
    mustHaves: must,
  };
}

function theaterOrDestTask(): TurnWorkTask {
  return {
    id: 'dest',
    worker: 'chat',
    brief:
      'Taxi-Ziel (Theater/Restaurant): genanntes/sticky Venue auflösen — nicht raten',
    startIsGps: true,
  };
}

function taxiTask(dependsOn: string, nuance: string): TurnWorkTask {
  return {
    id: 'taxi',
    worker: 'transit',
    brief: `${TAXI_SLOT_BRIEF}. ${nuance}`,
    startIsGps: true,
    dependsOn,
  };
}

/**
 * Essen+Taxi: entweder klare work[]-Kette mit Taxi-Slots
 * oder Prioritätsfrage (zwei gleichwertige Jetzt-Pfade).
 */
export function planDiningTaxiCompound(
  text: string,
): DiningTaxiCompoundPlan | null {
  const kind = detectMobilityCompoundKind(text);
  if (!kind || kind === 'taxi_only') return null;

  if (kind === 'taxi_leave_by_flight') {
    const flightTask = {
      id: 'flight',
      worker: 'flight' as const,
      brief:
        'Task 1: Startflughafen selbst wählen → Abflugtafel matchen → Boarding/Gate/Security/Gepäck-Chips → Leave-by → Timeline — noch kein Taxi',
      startIsGps: true,
      mustHaves: ['flight_time', 'leave_by'],
    };
    const work: TurnWorkTask[] = [flightTask];
    const thinkAhead = [
      'Erkennung: Wunsch=Taxi pünktlich am Flughafen; Infos sortieren; Startflughafen selbst herleiten',
      'Task 1 Flieger (Tafel/Boarding/Gepäck/Leave-by/Timeline) → Task 2 Taxi-Deep-Link prefilled; fehlende Slots nur als Chips/Frage; nie Explore-Drift',
    ];
    const openLoops = ['taxi_after_leave_by'];

    // GPS ≠ Abflugstadt → echte Anreise-Task vor Taxi
    try {
      const {
        detectOriginGpsMismatch,
        buildOriginAccessWorkChain,
      } = require('../../services/flights/flightOriginMismatch') as {
        detectOriginGpsMismatch: (o: {
          gpsLat?: number | null;
          gpsLng?: number | null;
          userText?: string | null;
        }) => {
          mismatch: boolean;
          statedAirport: { city: string; iata: string } | null;
          gpsAirport: { city: string } | null;
        };
        buildOriginAccessWorkChain: (o: {
          mismatch: ReturnType<
            typeof import('../../services/flights/flightOriginMismatch').detectOriginGpsMismatch
          >;
          flightTaskId?: string;
          taxiTaskId?: string;
        }) => Array<{
          id: string;
          worker: string;
          brief: string;
          dependsOn?: string | null;
          mustHaves?: string[];
        }> | null;
      };
      let gpsLat: number | null = null;
      let gpsLng: number | null = null;
      try {
        const { useGpsStore } = require('../../store/useGpsStore') as {
          useGpsStore: {
            getState: () => { lat: number | null; lng: number | null };
          };
        };
        const g = useGpsStore.getState();
        gpsLat = g.lat;
        gpsLng = g.lng;
      } catch {
        /* soft */
      }
      const mismatch = detectOriginGpsMismatch({
        gpsLat,
        gpsLng,
        userText: text,
      });
      if (mismatch.mismatch) {
        const accessChain = buildOriginAccessWorkChain({
          mismatch,
          flightTaskId: 'flight',
          taxiTaskId: 'taxi',
        });
        if (accessChain?.length) {
          for (const a of accessChain) {
            work.push({
              id: a.id,
              worker: a.worker as TurnWorkTask['worker'],
              brief: a.brief,
              startIsGps: true,
              dependsOn: a.dependsOn ?? null,
              mustHaves: a.mustHaves,
            });
          }
          openLoops.push('origin_access_leg');
          thinkAhead.push(
            `GPS≠Abflugstadt (${mismatch.gpsAirport?.city}≠${mismatch.statedAirport?.city}): Anreise-Task vor Taxi`,
          );
        }
      }
    } catch {
      /* soft */
    }

    if (!work.some((w) => w.id === 'taxi')) {
      work.push(
        taxiTask(
          work.some((w) => w.id === 'origin_access')
            ? 'origin_access'
            : 'flight',
          'Task 2 auto nach Task 1: Taxi/Uber Deep-Link voll prefilled (Start, Flughafen, Abholzeit=Leave-by, Personen) — User nur bestätigen',
        ),
      );
    }

    return {
      mode: 'work_chain',
      kind,
      openLoops,
      thinkAhead,
      work,
    };
  }

  // dining_plus_taxi oder taxi_before_venue
  const diningHeavy = looksLikeDiningPlusTaxi(text);
  const clearOrder = hasClearDiningTaxiOrder(text);

  // Zwei Speak-Pfade ohne Reihenfolge → Prioritätsfrage
  if (diningHeavy && !clearOrder) {
    return {
      mode: 'priority_ask',
      kind: 'dining_plus_taxi',
      work: [],
      openLoops: ['dining_track', 'taxi_track'],
      thinkAhead: [
        'Zwei Jetzt-Ziele: Essen-Suche und Taxi — erst Priorität fragen, dann eine Spur voll ausführen',
      ],
    };
  }

  const venue = diningLeadTask(text);
  const needsSeparateDest =
    /\b(theater|theatre|kino)\b/iu.test(text) &&
    !/\b(diesem\s+restaurant|zum\s+restaurant)\b/iu.test(text);

  const work: TurnWorkTask[] = [venue];
  if (needsSeparateDest) {
    work.push(theaterOrDestTask());
    work.push(
      taxiTask(
        'dest',
        'Nach Essen/vor Theater-Ankunft — Ziel aus dest-Task',
      ),
    );
  } else {
    work.push(
      taxiTask(
        'venue',
        'Vor Ankunft am Venue / nach dem Essen — Ziel aus venue-Task',
      ),
    );
  }

  return {
    mode: 'work_chain',
    kind: diningHeavy ? 'dining_plus_taxi' : 'taxi_before_venue',
    work,
    openLoops: [],
    thinkAhead: [
      'Taxi-Leg vollständig: Ziel, Vorbestellen, ETA, Preis nur belegt',
      'Dining-Musts (AYCE/Avoid) nicht droppen',
    ],
  };
}

/**
 * Heuristik-Work-Kette für Compound — LLM darf überschreiben.
 */
export function heuristicMobilityWorkTasks(text: string): TurnWorkTask[] {
  const plan = planDiningTaxiCompound(text);
  if (!plan || plan.mode === 'priority_ask') return [];
  return plan.work;
}

function taxiBriefLooksThin(brief: string): boolean {
  const b = (brief || '').toLowerCase();
  if (b.length < 40) return true;
  return !/\b(eta|vorbestell|deep-?link|preis|ziel|anfahr)/i.test(b);
}

/**
 * Soft: dünnen Transit-Einzeiler → volle Kette; oder Prioritätsfrage erzwingen,
 * wenn Call 1 beides als Jetzt-Pfad offen ließ.
 */
export function applyDiningTaxiCompoundToAnalysis(
  analysis: ManagerAnalysis,
  userText: string,
): ManagerAnalysis {
  const plan = planDiningTaxiCompound(userText);
  if (!plan) return analysis;

  const frame = analysis.frame ?? emptyTurnFrame();
  const tasks = frame.tasks ?? [];

  if (plan.mode === 'priority_ask') {
    const alreadyChose =
      analysis.needsBlockingChoice === true &&
      analysis.bridgeComplete === true;
    const hasOrderedChain =
      tasks.some((t) => t.dependsOn) &&
      tasks.some((t) => t.worker === 'dining' || t.worker === 'flight');
    if (alreadyChose || hasOrderedChain) {
      // LLM hat schon entschieden — höchstens Think-Ahead anreichern
      return {
        ...analysis,
        frame: {
          ...frame,
          thinkAhead: [
            ...new Set([...(frame.thinkAhead ?? []), ...plan.thinkAhead]),
          ].slice(0, 4),
        },
      };
    }
    return {
      ...analysis,
      needsBlockingChoice: true,
      bridgeComplete: true,
      call2Brief: null,
      openLoops: [
        ...new Set([...(analysis.openLoops ?? []), ...plan.openLoops]),
      ].slice(0, 6),
      frame: {
        ...frame,
        tasks: [],
        thinkAhead: [
          ...new Set([...(frame.thinkAhead ?? []), ...plan.thinkAhead]),
        ].slice(0, 4),
      },
      intents: [
        {
          id: 'dining_track',
          lane: 'pitch',
          blueprintId: null,
          brief: 'Essen/AYCE-Spur nach Prioritätswahl',
          dependsOn: null,
        },
        {
          id: 'taxi_track',
          lane: 'nav',
          blueprintId: null,
          brief: 'Taxi-Spur: Ziel, Vorbestellen, ETA, Preis belegt',
          dependsOn: null,
        },
      ],
    };
  }

  // work_chain: fehlende/dünne Tasks nachziehen
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const merged: TurnWorkTask[] = [];
  for (const w of plan.work) {
    const existing = byId.get(w.id);
    if (!existing) {
      merged.push(w);
      continue;
    }
    if (existing.worker === 'transit' && taxiBriefLooksThin(existing.brief)) {
      merged.push({
        ...existing,
        brief: w.brief,
        dependsOn: existing.dependsOn || w.dependsOn,
        mustHaves: existing.mustHaves?.length
          ? existing.mustHaves
          : w.mustHaves,
      });
    } else if (
      existing.worker === 'flight' &&
      plan.kind === 'taxi_leave_by_flight' &&
      (/\btaxi|uber\b/iu.test(existing.brief) ||
        (existing.brief || '').length < 40)
    ) {
      // Flug-Brief darf Taxi nicht mischen — Task 1 = nur Flug/Leave-by
      merged.push({
        ...existing,
        brief: w.brief,
        dependsOn: null,
        mustHaves: existing.mustHaves?.length
          ? existing.mustHaves
          : w.mustHaves,
      });
    } else {
      merged.push(
        existing.worker === 'transit' && !existing.dependsOn && w.dependsOn
          ? { ...existing, dependsOn: w.dependsOn }
          : existing,
      );
    }
    byId.delete(w.id);
  }
  for (const rest of byId.values()) merged.push(rest);

  return {
    ...analysis,
    openLoops: [
      ...new Set([
        ...(analysis.openLoops ?? []),
        ...(plan.openLoops ?? []),
      ]),
    ].slice(0, 6),
    frame: {
      ...frame,
      tasks: merged.slice(0, 6),
      thinkAhead: [
        ...new Set([...(frame.thinkAhead ?? []), ...plan.thinkAhead]),
      ].slice(0, 4),
      mustHaves: [
        ...new Set([
          ...(frame.mustHaves ?? []),
          ...plan.work.flatMap((w) => w.mustHaves ?? []),
        ]),
      ].slice(0, 8),
    },
    mustHaves: [
      ...new Set([
        ...(analysis.mustHaves ?? []),
        ...plan.work.flatMap((w) => w.mustHaves ?? []),
      ]),
    ].slice(0, 8),
  };
}
