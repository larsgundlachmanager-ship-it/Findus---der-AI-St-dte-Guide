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
 * Blaupause Leave / Flug / Parken (warnLead ≥ 30):
 *   60 · 40 · 35 = Mikro (wo ist User? ETA? still)
 *   30 = Ansage (warn)
 *   15 · 7 = Mikro
 *   5 = Ansage (warn)
 *   0 = Hard (Aufbruch)
 * Soft (warnLead ≤ 5, niedrige Prio): nur 5 + 0.
 * Wecker: nur stille Mikro-Checks — nie Vorwarn-Speak.
 */
export function buildCheckSchedule(
  anchorMs: number,
  nowMs: number = Date.now(),
  profile: CheckScheduleProfile = 'leave',
  opts?: { warnLeadMin?: number },
): LogisticsCheckPoint[] {
  // Reiner Wecker: nur stille Checks — nie „rechtzeitig los“ / „gleich wecken“
  if (profile === 'wake') {
    const wakeOffsets: Array<{
      kind: LogisticsCheckKind;
      offsetMin: number;
      label: string;
      role: LogisticsCheckPoint['role'];
    }> = [
      {
        kind: 'coarse',
        offsetMin: 180,
        label: 'Mikro-Check ÖPNV (~3 Std. vor Wecker)',
        role: 'micro',
      },
      {
        kind: 'prep',
        offsetMin: 60,
        label: 'Mikro-Check ÖPNV (~1 Std. vor Wecker)',
        role: 'micro',
      },
      {
        kind: 'safety',
        offsetMin: 30,
        label: 'Mikro-Check ÖPNV (~30 Min vor Wecker)',
        role: 'micro',
      },
    ];
    return materializePoints(anchorMs, nowMs, wakeOffsets);
  }

  const warnMin = Math.max(
    5,
    Math.min(30, opts?.warnLeadMin ?? 30),
  );
  const softOnly = warnMin <= 5;

  if (softOnly) {
    return materializePoints(anchorMs, nowMs, [
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
    ]);
  }

  // Volle Blaupause: Live-Lage + zwei Ansagen (30 / 5), dazwischen stille Checks
  return materializePoints(anchorMs, nowMs, [
    {
      kind: 'prep',
      offsetMin: 60,
      label: 'Mikro-Check (~1 Std.) — Lage / Wegzeit',
      role: 'micro',
    },
    {
      kind: 'prep',
      offsetMin: 40,
      label: 'Mikro-Check (~40 Min)',
      role: 'micro',
    },
    {
      kind: 'prep',
      offsetMin: 35,
      label: 'Mikro-Check (~35 Min)',
      role: 'micro',
    },
    {
      kind: 'safety',
      offsetMin: 30,
      label: 'Ansage (~30 Min vor Losgehen)',
      role: 'warn',
    },
    {
      kind: 'prep',
      offsetMin: 15,
      label: 'Mikro-Check (~15 Min)',
      role: 'micro',
    },
    {
      kind: 'prep',
      offsetMin: 7,
      label: 'Mikro-Check (~7 Min)',
      role: 'micro',
    },
    {
      kind: 'safety',
      offsetMin: 5,
      label: 'Ansage (~5 Min vor Aufbruch)',
      role: 'warn',
    },
    {
      kind: 'leave',
      offsetMin: 0,
      label: 'Aufbruch-Push (vibrieren / sprechen)',
      role: 'hard',
    },
  ]);
}

function materializePoints(
  anchorMs: number,
  nowMs: number,
  offsets: Array<{
    kind: LogisticsCheckKind;
    offsetMin: number;
    label: string;
    role: LogisticsCheckPoint['role'];
  }>,
): LogisticsCheckPoint[] {
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
