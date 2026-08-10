/**
 * Smart logistics leave-by + progressive check cadence.
 * App decides intervals (no user-tuned “every 5 min”).
 *
 * Leave target = departure − walkEta − arrivalBuffer
 * arrivalBuffer grows with station size and live delay.
 */

export type LogisticsMode =
  | 'train'
  | 'bus'
  | 'flight'
  | 'ferry'
  | 'walk'
  | 'bike'
  | 'car'
  | 'taxi'
  | 'generic';

export type StationScale = 'stop' | 'station' | 'major_hub';

export type LogisticsCheckKind =
  | 'coarse'
  | 'prep'
  | 'safety'
  | 'leave'
  | 'delay_watch';

export type CheckScheduleProfile = 'leave' | 'wake';

export type LogisticsCheckPoint = {
  kind: LogisticsCheckKind;
  atMs: number;
  /** Human label for Settings / debug */
  label: string;
  /**
   * micro = kurzer stiller Check (nur bei Problem melden)
   * warn = Haupt-Vorwarnung (Losgehen / rechtzeitig)
   * hard = Aufbruch / Wecker-Moment
   */
  role: 'micro' | 'warn' | 'hard';
};

/**
 * Progressive checkpoints vor dem Anker (Leave-by oder Wecker).
 *
 * Blaupause (universell):
 * - Alles VOR der Hauptwarnung = Mikro-Aufwachen: Standort, Verbindung, Ausfall?
 *   Passt alles → wieder schlafen (kein Spam). Passt nicht → sofort anpassen;
 *   akut → User bescheid + Trigger neu.
 * - Leave Prio 1–2: Hauptwarnung ~30 Min vor Losgehen (+ 5 Min).
 * - Leave ab Prio 3: nur ~5 Min vor Leave-by (kein 30-Min-„du musst los“).
 * - Wecker: Hauptwarnung ~35 Min vorher („rechtzeitig los“), Wecker selbst hard.
 */
export function buildCheckSchedule(
  anchorMs: number,
  nowMs: number = Date.now(),
  profile: CheckScheduleProfile = 'leave',
  opts?: { warnLeadMin?: number },
): LogisticsCheckPoint[] {
  const defaultWarn = profile === 'wake' ? 35 : 30;
  const warnMin = Math.max(
    5,
    Math.min(120, opts?.warnLeadMin ?? defaultWarn),
  );
  const softOnly = profile === 'leave' && warnMin <= 5;

  const offsets: Array<{
    kind: LogisticsCheckKind;
    offsetMin: number;
    label: string;
    role: LogisticsCheckPoint['role'];
  }> = softOnly
    ? [
        {
          kind: 'safety',
          offsetMin: 5,
          label: 'Gleich los (~5 Min vor Aufbruch)',
          role: 'warn',
        },
        {
          kind: 'leave',
          offsetMin: 0,
          label: 'Aufbruch-Push (vibrieren / sprechen)',
          role: 'hard',
        },
      ]
    : [
        {
          kind: 'coarse',
          offsetMin: 180,
          label: 'Mikro-Check (~3 Std.)',
          role: 'micro',
        },
        {
          kind: 'prep',
          offsetMin: 60,
          label: 'Mikro-Check (~1 Std.)',
          role: 'micro',
        },
        {
          kind: 'safety',
          offsetMin: warnMin,
          label:
            profile === 'wake'
              ? `Vorwarnung (~${warnMin} Min vor Wecker) — rechtzeitig los`
              : `Vorwarnung (~${warnMin} Min vor Losgehen)`,
          role: 'warn',
        },
        ...(warnMin > 5
          ? [
              {
                kind: 'prep' as const,
                offsetMin: 5,
                label:
                  profile === 'wake'
                    ? 'Kurz vor Wecker (~5 Min)'
                    : 'Gleich los (~5 Min vor Aufbruch)',
                role: 'warn' as const,
              },
            ]
          : []),
        {
          kind: 'leave',
          offsetMin: 0,
          label:
            profile === 'wake'
              ? 'Wecker-Moment'
              : 'Aufbruch-Push (vibrieren / sprechen)',
          role: 'hard',
        },
      ];

  const points: LogisticsCheckPoint[] = [];
  for (const o of offsets) {
    const atMs = anchorMs - o.offsetMin * 60_000;
    if (atMs <= nowMs - 30_000) continue;
    points.push({
      kind: o.kind,
      atMs,
      label: o.label,
      role: o.role,
    });
  }
  return points.sort((a, b) => a.atMs - b.atMs);
}

/** Trains: ≥5 min early; major hubs ≥10; delay adds extra 10. */
export function computeArrivalBufferMin(opts: {
  mode: LogisticsMode;
  stationScale?: StationScale;
  delayMin?: number;
}): number {
  const scale = opts.stationScale ?? 'station';
  const delay = Math.max(0, Math.round(opts.delayMin ?? 0));

  let base = 5;
  if (opts.mode === 'flight') {
    base = 45;
  } else if (opts.mode === 'ferry') {
    base = 15;
  } else if (opts.mode === 'bus') {
    base = scale === 'stop' ? 5 : 8;
  } else if (opts.mode === 'train') {
    if (scale === 'major_hub') base = 10;
    else if (scale === 'station') base = 8;
    else base = 5;
  } else if (
    opts.mode === 'walk' ||
    opts.mode === 'bike' ||
    opts.mode === 'car' ||
    opts.mode === 'taxi' ||
    opts.mode === 'generic'
  ) {
    // Fuß/Rad/Auto: kein Bahnhofs-Puffer — Termin-Puffer kommt vom Planer
    base = 2;
  }

  // Verspätung: extra Puffer — Lage kann sich wieder ändern
  const delayExtra = delay >= 5 ? 10 : delay > 0 ? 5 : 0;
  return base + delayExtra;
}

export function inferStationScale(opts: {
  stationName?: string | null;
  mode?: LogisticsMode;
}): StationScale {
  const name = (opts.stationName ?? '').toLowerCase();
  if (
    /\b(hbf|hauptbahnhof|central\s*station|flughafen|airport|terminus)\b/i.test(
      name,
    )
  ) {
    return 'major_hub';
  }
  if (opts.mode === 'train' && /\b(bahnhof|station)\b/i.test(name)) {
    return 'station';
  }
  if (opts.mode === 'bus' || /\b(haltestelle|bus)\b/i.test(name)) {
    return 'stop';
  }
  return opts.mode === 'train' ? 'station' : 'stop';
}

export type LeavePlan = {
  departureMs: number;
  /** Effective departure after delay (departureMs + delayMin) */
  effectiveDepartureMs: number;
  walkEtaMin: number;
  /**
   * Extra Minuten aus Route-Hindernissen (Bahnübergang skaliert, Treppen +1).
   * Bereits in leaveBy eingerechnet; 0 wenn in walkEtaMin enthalten.
   */
  routeObstacleBufferMin: number;
  arrivalBufferMin: number;
  /** When user should start walking */
  leaveByMs: number;
  /** Target arrive-at-platform / gate */
  arriveTargetMs: number;
  delayMin: number;
  stationScale: StationScale;
  mode: LogisticsMode;
};

export function computeLeavePlan(opts: {
  departureMs: number;
  walkEtaMin: number;
  /**
   * Bahnübergang/Treppen — nur setzen, wenn noch NICHT in walkEtaMin steckt.
   * Brücken: immer 0.
   */
  routeObstacleBufferMin?: number;
  mode?: LogisticsMode;
  stationScale?: StationScale;
  stationName?: string | null;
  delayMin?: number;
}): LeavePlan {
  const mode = opts.mode ?? 'generic';
  const delayMin = Math.max(0, Math.round(opts.delayMin ?? 0));
  const stationScale =
    opts.stationScale ??
    inferStationScale({ stationName: opts.stationName, mode });
  const walkEtaMin = Math.max(0, Math.ceil(opts.walkEtaMin));
  const routeObstacleBufferMin = Math.max(
    0,
    Math.round(opts.routeObstacleBufferMin ?? 0),
  );
  const arrivalBufferMin = computeArrivalBufferMin({
    mode,
    stationScale,
    delayMin,
  });
  const effectiveDepartureMs = opts.departureMs + delayMin * 60_000;
  const arriveTargetMs = effectiveDepartureMs - arrivalBufferMin * 60_000;
  const leaveByMs =
    arriveTargetMs - (walkEtaMin + routeObstacleBufferMin) * 60_000;

  return {
    departureMs: opts.departureMs,
    effectiveDepartureMs,
    walkEtaMin,
    routeObstacleBufferMin,
    arrivalBufferMin,
    leaveByMs,
    arriveTargetMs,
    delayMin,
    stationScale,
    mode,
  };
}

/**
 * Next poll interval while watching an active departure.
 * Closer to leave → denser; delay → denser still.
 */
export function nextPollIntervalMs(opts: {
  leaveByMs: number;
  nowMs?: number;
  delayMin?: number;
}): number {
  const now = opts.nowMs ?? Date.now();
  const minsUntilLeave = (opts.leaveByMs - now) / 60_000;
  const hasDelay = (opts.delayMin ?? 0) >= 5;

  if (minsUntilLeave > 180) return 60 * 60_000;
  if (minsUntilLeave > 90) return 30 * 60_000;
  if (minsUntilLeave > 45) return 15 * 60_000;
  if (minsUntilLeave > 20) return hasDelay ? 5 * 60_000 : 10 * 60_000;
  if (minsUntilLeave > 8) return hasDelay ? 3 * 60_000 : 5 * 60_000;
  if (minsUntilLeave > 0) return hasDelay ? 90_000 : 2 * 60_000;
  // already past leave-by but still watching delay recovery
  return hasDelay ? 2 * 60_000 : 5 * 60_000;
}

export function formatClockMs(ms: number): string {
  const d = new Date(ms);
  const h = d.getHours().toString().padStart(2, '0');
  const m = d.getMinutes().toString().padStart(2, '0');
  return `${h}:${m}`;
}

export function describeLeavePlan(plan: LeavePlan): string {
  const delayNote =
    plan.delayMin > 0
      ? ` · Verspätung +${plan.delayMin} Min (Extra-Puffer)`
      : '';
  const obstacleNote =
    plan.routeObstacleBufferMin > 0
      ? ` · Hindernis-Puffer ${plan.routeObstacleBufferMin} Min`
      : '';
  return (
    `Abfahrt ${formatClockMs(plan.effectiveDepartureMs)} · ` +
    `Fußweg ${plan.walkEtaMin} Min · ` +
    `Ankunftspuffer ${plan.arrivalBufferMin} Min · ` +
    `Los ${formatClockMs(plan.leaveByMs)}${delayNote}${obstacleNote}`
  );
}
