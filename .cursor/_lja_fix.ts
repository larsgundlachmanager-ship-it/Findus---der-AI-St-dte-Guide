/**
 * Live-ÖPNV-Anpassung (SSOT): Wartezeit, Aufholen, nächste Verbindung.
 * Keine RN-Imports — Tests + journeyLeaveBy + Timeline.
 *
 * Dies sind nur abstrakte Beispiele für den logischen Ablauf. Übernimm niemals
 * den genauen Wortlaut.
 */

export type LivePaceScenario =
  | 'relaxed'
  | 'ok'
  | 'catch_up'
  | 'wait_next'
  | 'missed';

export type LivePaceAssessment = {
  scenario: LivePaceScenario;
  /** Minuten Puffer nach Ankunft am Halt (vor Abfahrt). */
  waitMin: number;
  /** Verbleibende Fußweg-Minuten (geschätzt). */
  walkEtaMin: number;
  distanceM: number;
  /** Mindesttempo zum Erreichen mit Stationspuffer. */
  neededKmh: number | null;
  /** Wartezeit bis nächste Folgeverbindung (falls bekannt). */
  nextWaitMin: number | null;
  tip: string | null;
  /** Kurz für Timeline-Untertitel. */
  timelineHint: string | null;
};

const DEFAULT_WALK_M_PER_MIN = 70;
const CATCH_UP_MIN_KMH = 4;
const CATCH_UP_MAX_KMH = 14;
const RELAXED_WAIT_MIN = 5;

export function liveWalkEtaMin(opts: {
  distanceM: number;
  /** m/min — Pace-Profil oder Live-Schätzung. */
  paceMPerMin?: number | null;
}): number {
  const dist = Math.max(0, opts.distanceM);
  const pace = Math.max(
    35,
    opts.paceMPerMin != null && Number.isFinite(opts.paceMPerMin)
      ? opts.paceMPerMin
      : DEFAULT_WALK_M_PER_MIN,
  );
  if (dist < 25) return 0;
  return Math.max(1, Math.round(dist / pace));
}

/**
 * Benötigtes Tempo (km/h), um in `secondsLeft` die Distanz zu schaffen.
 */
export function neededCatchUpKmh(
  distanceM: number,
  secondsLeft: number,
): number | null {
  if (distanceM < 20 || secondsLeft <= 5) return null;
  const hours = secondsLeft / 3600;
  if (hours <= 0) return null;
  const kmh = distanceM / 1000 / hours;
  if (!Number.isFinite(kmh) || kmh <= 0) return null;
  return Math.round(kmh * 10) / 10;
}

export function assessLiveJourneyPace(opts: {
  nowMs: number;
  depMs: number;
  distanceM: number;
  /** Stationspuffer (3 / 7). */
  bufferMin?: number;
  paceMPerMin?: number | null;
  /** Nächste Folgeverbindung (ms), falls bekannt. */
  nextDepMs?: number | null;
  line?: string | null;
  nextLine?: string | null;
  /**
   * Schlechtes GPS / Tunnel: Distanz nicht für Missed/Catch-up nutzen.
   * Verpasst nur noch nach Abfahrtszeit.
   */
  gpsUnreliable?: boolean;
}): LivePaceAssessment {
  const bufferMin = Math.max(0, opts.bufferMin ?? 3);
  const dist = Math.max(0, Math.round(opts.distanceM));
  const gpsBad = opts.gpsUnreliable === true;
  const walkEtaMin = gpsBad
    ? 0
    : liveWalkEtaMin({
        distanceM: dist,
        paceMPerMin: opts.paceMPerMin,
      });
  const arriveNeedMs = opts.nowMs + walkEtaMin * 60_000;
  const arriveByMs = opts.depMs - bufferMin * 60_000;
  const waitMin = Math.max(
    0,
    Math.round((opts.depMs - Math.max(opts.nowMs, arriveNeedMs)) / 60_000),
  );
  const slackMs = arriveByMs - opts.nowMs;
  const secondsLeft = Math.max(0, Math.round(slackMs / 1000));
  const needed = gpsBad ? null : neededCatchUpKmh(dist, secondsLeft);
  const nextWaitMin =
    opts.nextDepMs != null &&
    Number.isFinite(opts.nextDepMs) &&
    opts.nextDepMs > opts.depMs + 60_000
      ? Math.max(0, Math.round((opts.nextDepMs - opts.nowMs) / 60_000))
      : null;

  const line = (opts.line || 'Bahn').trim();
  const nextLine = (opts.nextLine || line).trim();

  // Zeit-Fallback: bei schlechtem GPS reicht Abfahrt + Grace (ohne Distanz).
  const pastDep = opts.nowMs > opts.depMs + 20_000;
  if (pastDep && (gpsBad || dist > 80)) {
    const tip =
      nextWaitMin != null && nextWaitMin > 0
        ? `${line} ist weg — nächste ${nextLine} in etwa ${nextWaitMin} Minuten.`
        : `${line} ist weg. Ich schaue nach einer Alternative.`;
    return {
      scenario: 'missed',
      waitMin: 0,
      walkEtaMin,
      distanceM: dist,
      neededKmh: null,
      nextWaitMin,
      tip,
      timelineHint: nextWaitMin != null ? `nächste in ${nextWaitMin} Min` : 'verpasst',
    };
  }

  // Bei schlechtem GPS: kein Distanz-Aufholen — nur Uhr bis Abfahrt.
  if (gpsBad) {
    if (waitMin >= RELAXED_WAIT_MIN) {
      return {
        scenario: 'relaxed',
        waitMin,
        walkEtaMin,
        distanceM: dist,
        neededKmh: null,
        nextWaitMin,
        tip: null,
        timelineHint: `${waitMin} Min · GPS unsicher`,
      };
    }
    return {
      scenario: 'ok',
      waitMin,
      walkEtaMin,
      distanceM: dist,
      neededKmh: null,
      nextWaitMin,
      tip: null,
      timelineHint: waitMin > 0 ? `${waitMin} Min · GPS unsicher` : 'Einstieg · GPS unsicher',
    };
  }

  // Mit normalem Tempo nicht mehr rechtzeitig → Aufholen oder warten.
  if (arriveNeedMs > arriveByMs + 30_000) {
    const canSprint =
      needed != null &&
      needed >= CATCH_UP_MIN_KMH &&
      needed <= CATCH_UP_MAX_KMH &&
      dist >= 40 &&
      secondsLeft >= 30;
    if (canSprint) {
      const tip =
        nextWaitMin != null && nextWaitMin >= 8
          ? `Du musst mindestens ${Math.ceil(needed!)} km/h auf ${dist} m machen, um ${line} noch zu schaffen — oder etwa ${nextWaitMin} Minuten warten, dann fährt wieder ${nextLine}.`
          : `Du musst mindestens ${Math.ceil(needed!)} km/h auf ${dist} m machen, um ${line} noch zu schaffen.`;
      return {
        scenario: 'catch_up',
        waitMin: 0,
        walkEtaMin,
        distanceM: dist,
        neededKmh: needed,
        nextWaitMin,
        tip,
        timelineHint: `Aufholen · ≥${Math.ceil(needed!)} km/h`,
      };
    }
    if (nextWaitMin != null && nextWaitMin > 0) {
      const tip = `Knapp — lieber etwa ${nextWaitMin} Minuten warten, dann fährt wieder ${nextLine}.`;
      return {
        scenario: 'wait_next',
        waitMin: 0,
        walkEtaMin,
        distanceM: dist,
        neededKmh: needed,
        nextWaitMin,
        tip,
        timelineHint: `warten · nächste in ${nextWaitMin} Min`,
      };
    }
    return {
      scenario: 'catch_up',
      waitMin: 0,
      walkEtaMin,
      distanceM: dist,
      neededKmh: needed,
      nextWaitMin,
      tip: `Beeil dich Richtung Halt — ${line} wird knapp.`,
      timelineHint: 'knapp · aufholen',
    };
  }

  if (waitMin >= RELAXED_WAIT_MIN) {
    return {
      scenario: 'relaxed',
      waitMin,
      walkEtaMin,
      distanceM: dist,
      neededKmh: null,
      nextWaitMin,
      tip: null,
      timelineHint: `${waitMin} Min warten`,
    };
  }

  return {
    scenario: 'ok',
    waitMin,
    walkEtaMin,
    distanceM: dist,
    neededKmh: null,
    nextWaitMin,
    tip: null,
    timelineHint: waitMin > 0 ? `${waitMin} Min warten` : 'Einstieg',
  };
}

/** Nächster Einsteig nach aktuellem Stop (Umstieg während der Fahrt). */
export type UpcomingTransferBoard = {
  index: number;
  lat: number;
  lng: number;
  name: string | null;
  line: string | null;
  depMs: number;
  vehicleMode: string | null;
  transferWalkMin: number;
};

export type TransferLinkScenario = 'ok' | 'tight' | 'at_risk' | 'broken';

export type TransferLinkAssessment = {
  scenario: TransferLinkScenario;
  /** Minuten Puffer: Abfahrt − Ankunft − Umsteige-Fuß. */
  transferSlackMin: number;
  tip: string | null;
  timelineHint: string | null;
};

function isBoardishRole(role: string | null | undefined): boolean {
  return role === 'walk' || role === 'transfer' || role === 'board';
}

/**
 * Findet den nächsten Fahrzeug-Einstieg nach `currentIndex`
 * (während alight/in_transit = Anschluss-Bus/Bahn).
 */
export function findUpcomingTransferBoard<
  T extends {
    role?: string | null;
    lat: number;
    lng: number;
    name?: string | null;
    line?: string | null;
    vehicleStartMs?: number | null;
    vehicleMode?: string | null;
    durationSec?: number | null;
    done?: boolean;
  },
>(stops: T[], currentIndex: number): UpcomingTransferBoard | null {
  const from = Math.max(0, currentIndex);
  for (let i = from + 1; i < stops.length; i += 1) {
    const s = stops[i]!;
    if (s.done) continue;
    if (!isBoardishRole(s.role)) continue;
    const dep = s.vehicleStartMs;
    if (dep == null || !Number.isFinite(dep)) continue;
    if (!(s.line || s.vehicleMode)) continue;
    const walkMin =
      typeof s.durationSec === 'number' && s.durationSec > 20
        ? Math.max(1, Math.round(s.durationSec / 60))
        : 2;
    return {
      index: i,
      lat: s.lat,
      lng: s.lng,
      name: s.name ?? null,
      line: s.line ?? null,
      depMs: dep,
      vehicleMode: s.vehicleMode ?? null,
      transferWalkMin: walkMin,
    };
  }
  return null;
}

/** Geplante / geschätzte Ankunft am Ausstieg (aktueller alight-Stop). */
export function resolveAlightArriveMs<
  T extends {
    role?: string | null;
    endMs?: number | null;
    startMs?: number | null;
    durationSec?: number | null;
  },
>(opts: {
  stop: T | null | undefined;
  nowMs: number;
  /** Live-ETA zum Ausstieg in Sekunden (Distanz/Speed). */
  etaSec?: number | null;
}): number | null {
  const s = opts.stop;
  if (!s) return null;
  if (opts.etaSec != null && Number.isFinite(opts.etaSec) && opts.etaSec >= 0) {
    return opts.nowMs + Math.round(opts.etaSec * 1000);
  }
  if (s.endMs != null && Number.isFinite(s.endMs)) return s.endMs as number;
  if (
    s.startMs != null &&
    Number.isFinite(s.startMs) &&
    typeof s.durationSec === 'number' &&
    s.durationSec > 0
  ) {
    return (s.startMs as number) + s.durationSec * 1000;
  }
  return null;
}

/**
 * Anschluss während der Fahrt: schaffe ich Umstieg Bus/Bahn noch?
 * Wortlaut frei — nur Struktur.
 */
export function assessTransferConnection(opts: {
  nowMs: number;
  alightArriveMs: number;
  nextDepMs: number;
  transferWalkMin?: number;
  line?: string | null;
  nextLine?: string | null;
}): TransferLinkAssessment {
  const walk = Math.max(0, opts.transferWalkMin ?? 2);
  const readyMs = opts.alightArriveMs + walk * 60_000;
  const slackMin = Math.round((opts.nextDepMs - readyMs) / 60_000);
  const nextLine = (opts.nextLine || opts.line || 'Anschluss').trim();
  const ride = (opts.line || 'Bahn').trim();

  if (opts.nextDepMs <= opts.nowMs - 30_000) {
    return {
      scenario: 'broken',
      transferSlackMin: slackMin,
      tip: `${nextLine} ist weg — nach dem Ausstieg schaue ich eine Alternative.`,
      timelineHint: 'Anschluss weg',
    };
  }
  if (readyMs > opts.nextDepMs + 45_000) {
    return {
      scenario: 'broken',
      transferSlackMin: slackMin,
      tip: `Anschluss ${nextLine} wird nach ${ride} knapp verpasst — ich plane den Rest neu.`,
      timelineHint: 'Anschluss verpasst',
    };
  }
  if (slackMin < 2) {
    return {
      scenario: 'at_risk',
      transferSlackMin: slackMin,
      tip: `Umstieg auf ${nextLine} wird sehr knapp — zügig zum Steig.`,
      timelineHint: 'Umstieg knapp',
    };
  }
  if (slackMin < 5) {
    return {
      scenario: 'tight',
      transferSlackMin: slackMin,
      tip: null,
      timelineHint: `Umstieg · ~${Math.max(1, slackMin)} Min`,
    };
  }
  return {
    scenario: 'ok',
    transferSlackMin: slackMin,
    tip: null,
    timelineHint:
      slackMin <= 12 ? `Umstieg · ${slackMin} Min Puffer` : null,
  };
}

/** Verspätung: Board-/Ride-Zeiten auf Tour-Stops verschieben. */
export function shiftTourStopTimesForDelay<
  T extends {
    role?: string | null;
    vehicleStartMs?: number | null;
    startMs?: number | null;
    endMs?: number | null;
    delaySec?: number | null;
  },
>(stops: T[], opts: { oldDepMs: number; newDepMs: number; delaySec?: number | null }): T[] {
  const delta = opts.newDepMs - opts.oldDepMs;
  if (!Number.isFinite(delta) || Math.abs(delta) < 45_000) return stops;
  const old = opts.oldDepMs;
  return stops.map((s) => {
    const nearBoard =
      s.vehicleStartMs != null &&
      Number.isFinite(s.vehicleStartMs) &&
      Math.abs((s.vehicleStartMs as number) - old) < 3 * 60_000;
    const nearRide =
      s.startMs != null &&
      Number.isFinite(s.startMs) &&
      Math.abs((s.startMs as number) - old) < 3 * 60_000;
    if (!nearBoard && !nearRide) return s;
    const next = { ...s };
    if (nearBoard && next.vehicleStartMs != null) {
      next.vehicleStartMs = (next.vehicleStartMs as number) + delta;
    }
    if (nearRide) {
      if (next.startMs != null) next.startMs = (next.startMs as number) + delta;
      if (next.endMs != null) next.endMs = (next.endMs as number) + delta;
    }
    if (opts.delaySec != null && Number.isFinite(opts.delaySec)) {
      next.delaySec = opts.delaySec;
    }
    return next;
  });
}

/**
 * Live-Restfahrt in Sekunden (Distanz/Speed, sonst Halte × Hop).
 * Keine erfundenen Fahrpläne — nur aus belegter Reststrecke/Kette.
 */
export function estimateLiveRideEtaSec(opts: {
  distanceM?: number | null;
  speedMs?: number | null;
  remainingStations?: number | null;
  durationSec?: number | null;
  stationCount?: number | null;
  line?: string | null;
}): number | null {
  const dist =
    typeof opts.distanceM === 'number' && Number.isFinite(opts.distanceM)
      ? Math.max(0, opts.distanceM)
      : null;
  const speedRaw =
    typeof opts.speedMs === 'number' && Number.isFinite(opts.speedMs)
      ? opts.speedMs
      : null;
  const longHaul = /^(ICE|IC|EC|ECE|RJ|NJ|EN|TGV)\b/i.test(
    (opts.line || '').trim(),
  );
  const floorSpeed = longHaul ? 40 : 12;
  if (dist != null && dist > 40) {
    const speed = Math.max(floorSpeed, speedRaw != null && speedRaw > 1.5 ? speedRaw : floorSpeed);
    return Math.max(20, Math.round(dist / speed));
  }
  const rem = opts.remainingStations;
  const total = opts.stationCount;
  const dur = opts.durationSec;
  if (
    rem != null &&
    rem >= 1 &&
    dur != null &&
    dur > 30 &&
    total != null &&
    total >= 1
  ) {
    const hop = dur / Math.max(1, total);
    return Math.max(30, Math.round(rem * hop));
  }
  if (rem != null && rem >= 1) {
    const hopSec = longHaul ? 12 * 60 : 90;
    return Math.max(30, Math.round(rem * hopSec));
  }
  return null;
}

/**
 * Schreibt Live-Ankunft am aktuellen Ausstieg in endMs (+ durationSec).
 * Spätere vehicleStartMs bleiben (Bus-Abfahrt ändert sich nicht durch unsere Verspätung).
 * Timeline-Wartezeit am Umstieg folgt aus arriveMs vs. Board-Zeit.
 */
export function applyLiveAlightArriveToStops<
  T extends {
    role?: string | null;
    startMs?: number | null;
    endMs?: number | null;
    durationSec?: number | null;
    liveHint?: string | null;
  },
>(
  stops: T[],
  opts: {
    currentIndex: number;
    liveAlightArriveMs: number;
    nowMs: number;
    /** Mindest-Delta zum Überschreiben (ms). */
    minDeltaMs?: number;
  },
): { stops: T[]; deltaMs: number; arriveMs: number } | null {
  const idx = opts.currentIndex;
  const cur = stops[idx];
  if (!cur || cur.role !== 'alight') return null;
  const arrive = Math.max(
    opts.nowMs + 25_000,
    opts.liveAlightArriveMs,
  );
  const oldEnd =
    cur.endMs != null && Number.isFinite(cur.endMs)
      ? (cur.endMs as number)
      : null;
  const minDelta = opts.minDeltaMs ?? 40_000;
  if (oldEnd != null && Math.abs(arrive - oldEnd) < minDelta) {
    return null;
  }
  const deltaMs = oldEnd != null ? arrive - oldEnd : 0;
  const remMin = Math.max(1, Math.round((arrive - opts.nowMs) / 60_000));
  const next = stops.map((s, i) => {
    if (i !== idx) return s;
    const start =
      s.startMs != null && Number.isFinite(s.startMs)
        ? (s.startMs as number)
        : opts.nowMs;
    const durationSec = Math.max(
      30,
      Math.round((arrive - Math.min(start, arrive - 30_000)) / 1000),
    );
    return {
      ...s,
      endMs: arrive,
      durationSec,
      liveHint: `noch ~${remMin} Min`,
    };
  });
  return { stops: next, deltaMs, arriveMs: arrive };
}
