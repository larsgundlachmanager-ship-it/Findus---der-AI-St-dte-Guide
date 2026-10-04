# -*- coding: utf-8 -*-
"""Minimal Live-Nav fixes: silent 2nd crossing, alight, HUD wait, onboard, HALT_NEAR."""
from __future__ import annotations

import os
import shutil
import time
from pathlib import Path

ROOT = Path(r"c:\Users\larsf\Findus 2.0")


def force_write(path: Path, content: str) -> None:
    path = Path(path)
    tmp = path.with_suffix(path.suffix + f".tmp{os.getpid()}")
    bak = path.with_suffix(path.suffix + ".bak_lnav")
    tmp.write_text(content, encoding="utf-8")
    for i in range(12):
        try:
            if path.exists():
                try:
                    if bak.exists():
                        bak.unlink()
                except OSError:
                    pass
                try:
                    path.replace(bak)
                except OSError:
                    shutil.copy2(path, bak)
                    path.unlink(missing_ok=True)
            os.replace(tmp, path)
            try:
                if bak.exists():
                    bak.unlink()
            except OSError:
                pass
            print(f"OK {path.relative_to(ROOT)}")
            return
        except OSError as e:
            print(f"  retry {i+1} {path.name}: {e}")
            time.sleep(0.35)
    raise SystemExit(f"FAILED {path}")


def patch(rel: str, old: str, new: str, *, already: str | None = None) -> None:
    path = ROOT / rel
    t = path.read_text(encoding="utf-8")
    if already and already in t and old not in t:
        print(f"SKIP {rel} (already)")
        return
    if old not in t:
        print(f"MISS {rel}")
        print("--- expected snippet start ---")
        print(old[:200])
        print("---")
        return
    force_write(path, t.replace(old, new, 1))


# ---------------------------------------------------------------------------
# 1) cueScheduler — arm each turn; export noteCuePhaseSpoken for coach final
# ---------------------------------------------------------------------------
patch(
    "src/services/navigation/handsFreeNav/cueScheduler.ts",
    """let lastSpokenPhaseKey: string | null = null;
let lastSpokenAtMs = 0;
let lastReassureAtMs = 0;
let stretchArmedAtMs = 0;
let confirmedTurnIndex: number | null = null;

export function resetCueScheduler(): void {
  lastSpokenPhaseKey = null;
  lastSpokenAtMs = 0;
  lastReassureAtMs = 0;
  stretchArmedAtMs = 0;
  confirmedTurnIndex = null;
}""",
    """let lastSpokenPhaseKey: string | null = null;
let lastSpokenAtMs = 0;
let lastReassureAtMs = 0;
let stretchArmedAtMs = 0;
let confirmedTurnIndex: number | null = null;
/** Aktuelle Abbiegung — bei Wechsel Warn+Final neu freigeben. */
let armedTurnIndex: number | null = null;

export function resetCueScheduler(): void {
  lastSpokenPhaseKey = null;
  lastSpokenAtMs = 0;
  lastReassureAtMs = 0;
  stretchArmedAtMs = 0;
  confirmedTurnIndex = null;
  armedTurnIndex = null;
}

/** Coach markiert Final/Warn, damit die nächste Kreuzung nicht blockiert. */
export function noteCuePhaseSpoken(
  phase: CuePhase,
  turnIndex: number,
  nowMs?: number,
): void {
  lastSpokenPhaseKey = phaseKey(phase, turnIndex);
  lastSpokenAtMs = nowMs ?? Date.now();
  if (phase === 'final' || phase === 'warn') {
    armedTurnIndex = turnIndex;
  }
  if (phase === 'confirm') {
    confirmedTurnIndex = turnIndex;
  }
}

/** Neue Maneuver-Grenze → Warn+Final wieder erlaubt (kein Skip der 2.). */
export function armTurnForCues(turnIndex: number): void {
  if (turnIndex < 0) return;
  if (armedTurnIndex === turnIndex) return;
  armedTurnIndex = turnIndex;
  // Vorherige Phase nicht über Kreuzungen tragen.
  lastSpokenPhaseKey = null;
}""",
    already="armTurnForCues",
)

patch(
    "src/services/navigation/handsFreeNav/cueScheduler.ts",
    """  const turnIdx = opts.nextTurnIndex;
  const maybeArm = (stretchM: number) => {
    if (userMoving && stretchArmedAtMs <= 0 && stretchM >= 280) {
      stretchArmedAtMs = now;
    }
  };""",
    """  const turnIdx = opts.nextTurnIndex;
  if (turnIdx >= 0) {
    armTurnForCues(turnIdx);
  }
  const maybeArm = (stretchM: number) => {
    if (userMoving && stretchArmedAtMs <= 0 && stretchM >= 280) {
      stretchArmedAtMs = now;
    }
  };""",
    already="armTurnForCues(turnIdx)",
)

# ---------------------------------------------------------------------------
# 1b) tickCoach — gap bypass for new turn; mark final in scheduler
# ---------------------------------------------------------------------------
patch(
    "src/services/navigation/handsFreeNav/tickCoach.ts",
    """import {
  pickCueForTick,
  speakStartDistanceM,
  warmDistanceM,
  estimateSpeechSec,
  findNextTurnWaypoint,
  buildFinalCueText,
} from './cueScheduler';""",
    """import {
  pickCueForTick,
  speakStartDistanceM,
  warmDistanceM,
  estimateSpeechSec,
  findNextTurnWaypoint,
  buildFinalCueText,
  noteCuePhaseSpoken,
  armTurnForCues,
} from './cueScheduler';""",
    already="noteCuePhaseSpoken",
)

patch(
    "src/services/navigation/handsFreeNav/tickCoach.ts",
    """  const turnImminentForGap =
    distToTurnM != null &&
    distToTurnM <= speakAtM + 15 &&
    turnIdx >= 0 &&
    isHandsFreeSpeakTurn({
      maneuver: turnWp?.maneuver,
      roadName: turnWp?.roadName,
      turnComplexity: turnWp?.turnComplexity,
    });
  if (now - session.lastSpokenAt < MIN_SPEAK_GAP_MS && !turnImminentForGap) return;""",
    """  const turnImminentForGap =
    distToTurnM != null &&
    distToTurnM <= speakAtM + 15 &&
    turnIdx >= 0 &&
    isHandsFreeSpeakTurn({
      maneuver: turnWp?.maneuver,
      roadName: turnWp?.roadName,
      turnComplexity: turnWp?.turnComplexity,
    });
  // Neue Abbiegung: Gap darf Warn/Final der nächsten Kreuzung nicht schlucken.
  const newTurnPending =
    turnIdx >= 0 &&
    turnIdx !== session.lastSpokenTurnIdx &&
    isHandsFreeSpeakTurn({
      maneuver: turnWp?.maneuver,
      roadName: turnWp?.roadName,
      turnComplexity: turnWp?.turnComplexity,
    });
  if (
    now - session.lastSpokenAt < MIN_SPEAK_GAP_MS &&
    !turnImminentForGap &&
    !newTurnPending
  ) {
    return;
  }
  if (turnIdx >= 0) armTurnForCues(turnIdx);""",
    already="newTurnPending",
)

patch(
    "src/services/navigation/handsFreeNav/tickCoach.ts",
    """  if (nearTurn && turnIdx >= 0 && session.lastSpokenTurnIdx !== turnIdx) {
    // Nur diese Abbiegung als gesprochen markieren.
    // Nie die Folgekurbel vorab als „schon gesagt“ setzen — sonst zweite Kreuzung stumm.
    session.lastSpokenTurnIdx = turnIdx;
    session.lastSpokenAt = now;""",
    """  if (nearTurn && turnIdx >= 0 && session.lastSpokenTurnIdx !== turnIdx) {
    // Nur diese Abbiegung als gesprochen markieren.
    // Nie die Folgekurbel vorab als „schon gesagt“ setzen — sonst zweite Kreuzung stumm.
    session.lastSpokenTurnIdx = turnIdx;
    session.lastSpokenAt = now;
    noteCuePhaseSpoken('final', turnIdx, now);""",
    already="noteCuePhaseSpoken('final'",
)

patch(
    "src/services/navigation/handsFreeNav/tickCoach.ts",
    """  if (scheduled && scheduled.phase !== 'final') {
    // final handled above with prefetch
    session.lastSpokenAt = now;
    if (scheduled.phase === 'warn' || scheduled.phase === 'final') {
      try {
        const { vibrateNavTurnFromManeuver } = require('../navTurnHaptics') as {
          vibrateNavTurnFromManeuver: (m: string | null | undefined) => void;
        };
        vibrateNavTurnFromManeuver(turnWp?.maneuver);
      } catch {
        /* soft */
      }
    }
    void speak(scheduled.text);
  }
}""",
    """  if (scheduled && scheduled.phase !== 'final') {
    // final handled above with prefetch
    session.lastSpokenAt = now;
    if (scheduled.phase === 'warn' || scheduled.phase === 'final') {
      noteCuePhaseSpoken(scheduled.phase, turnIdx, now);
      try {
        const { vibrateNavTurnFromManeuver } = require('../navTurnHaptics') as {
          vibrateNavTurnFromManeuver: (m: string | null | undefined) => void;
        };
        vibrateNavTurnFromManeuver(turnWp?.maneuver);
      } catch {
        /* soft */
      }
    }
    void speak(scheduled.text);
  }
}""",
    already="noteCuePhaseSpoken(scheduled.phase",
)

patch(
    "src/services/navigation/handsFreeNav/index.ts",
    """export {
  resetCueScheduler,
  estimateSpeechSec,
  speakStartDistanceM,
  findNextTurnWaypoint,
  remainingAlongWaypointsM,
  buildFinalCueText,
  buildComplexWarnText,
  buildConfirmText,
  buildReassureText,
  pickCueForTick,
  warmDistanceM,
  FINISH_BEFORE_TURN_SEC,
  COMPLEX_WARN_FOOT_M,
} from './cueScheduler';""",
    """export {
  resetCueScheduler,
  noteCuePhaseSpoken,
  armTurnForCues,
  estimateSpeechSec,
  speakStartDistanceM,
  findNextTurnWaypoint,
  remainingAlongWaypointsM,
  buildFinalCueText,
  buildComplexWarnText,
  buildConfirmText,
  buildReassureText,
  pickCueForTick,
  warmDistanceM,
  FINISH_BEFORE_TURN_SEC,
  COMPLEX_WARN_FOOT_M,
} from './cueScheduler';""",
    already="noteCuePhaseSpoken,",
)

# ---------------------------------------------------------------------------
# 2) stationCountdown — alight when ≤1 halt + near stop
# ---------------------------------------------------------------------------
patch(
    "src/services/navigation/stationCountdown.ts",
    """export async function maybeSpeakAlightNow(opts: {
  transportMode: TransportMode;
  remainingStations: number | null;
  distanceToDestinationM: number | null;
  speedMs: number | null;
  navPhase?: NavPhase | null;
}): Promise<void> {
  if (!riding(opts.navPhase ?? null) && !isTransitMode(opts.transportMode)) {
    return;
  }
  if (!riding(opts.navPhase ?? null)) return;
  if (opts.remainingStations == null || opts.remainingStations > 1) return;
  if (alightNowSpoken) return;

  const facts = factsForCountdown(
    useFinnusStore.getState().navTargetName || '',
  );
  const cadence = cadenceInput(facts);
  const dist = opts.distanceToDestinationM ?? 9999;
  const speed =
    typeof opts.speedMs === 'number' && opts.speedMs > 1.5
      ? opts.speedMs
      : isLongHaulFallback(cadence.line)
        ? 40
        : 12;
  const etaSec = dist / speed;
  const leadSec = alightLeadSec({ ...cadence, etaSec });
  const due = shouldSpeakAlightSoon({
    remainingStops: opts.remainingStations,
    etaSec,
    leadSec,
    nextStopSpokenAtMs,
    nowMs: Date.now(),
    boardedStops,
  });
  if (!due) return;
  if (Date.now() - lastCueAtMs < 8_000) return;

  const store = useFinnusStore.getState();
  if (
    store.isListening ||
    store.isPlayingAudio ||
    store.isAudiblySpeaking ||
    store.isGenerating
  ) return;

  alightNowSpoken = true;
  lastCueAtMs = Date.now();
  triggerHapticPulse('double');
  try {
    const leadMin = Math.max(1, Math.round(leadSec / 60));
    await speakAssistantText(alightSoonCueText(facts, leadMin));
  } catch {
    /* soft */
  }
}""",
    """export async function maybeSpeakAlightNow(opts: {
  transportMode: TransportMode;
  remainingStations: number | null;
  distanceToDestinationM: number | null;
  speedMs: number | null;
  navPhase?: NavPhase | null;
  /** Distanz zum Ausstieg (Tour-Alight), falls bekannt. */
  distanceToAlightM?: number | null;
}): Promise<void> {
  if (!riding(opts.navPhase ?? null) && !isTransitMode(opts.transportMode)) {
    return;
  }
  if (!riding(opts.navPhase ?? null)) return;
  if (opts.remainingStations == null || opts.remainingStations > 1) return;
  if (alightNowSpoken) return;

  const facts = factsForCountdown(
    useFinnusStore.getState().navTargetName || '',
  );
  const cadence = cadenceInput(facts);
  const distAlight =
    opts.distanceToAlightM != null && Number.isFinite(opts.distanceToAlightM)
      ? opts.distanceToAlightM
      : opts.distanceToDestinationM ?? 9999;
  const dist = distAlight;
  const speed =
    typeof opts.speedMs === 'number' && opts.speedMs > 1.5
      ? opts.speedMs
      : isLongHaulFallback(cadence.line)
        ? 40
        : 12;
  const etaSec = dist / Math.max(0.5, speed);
  const leadSec = alightLeadSec({ ...cadence, etaSec });
  // Nah am Halt / letzter Halt: immer „Jetzt aussteigen“ — nicht nur Zeit-Vorlauf.
  const nearStop =
    opts.remainingStations <= 1 &&
    (dist <= 120 || etaSec <= 45 || opts.remainingStations === 0);
  const dueSoon = shouldSpeakAlightSoon({
    remainingStops: opts.remainingStations,
    etaSec,
    leadSec,
    nextStopSpokenAtMs,
    nowMs: Date.now(),
    boardedStops,
  });
  if (!nearStop && !dueSoon) return;
  if (Date.now() - lastCueAtMs < 5_000) return;

  const store = useFinnusStore.getState();
  if (
    store.isListening ||
    store.isPlayingAudio ||
    store.isAudiblySpeaking ||
    store.isGenerating
  ) return;

  alightNowSpoken = true;
  lastCueAtMs = Date.now();
  triggerHapticPulse('double');
  try {
    if (nearStop || etaSec <= 55) {
      const { alightNowCueText } = await import('./transitGuideCoach');
      await speakAssistantText(alightNowCueText(facts));
    } else {
      const leadMin = Math.max(1, Math.round(leadSec / 60));
      await speakAssistantText(alightSoonCueText(facts, leadMin));
    }
  } catch {
    alightNowSpoken = false;
  }
}""",
    already="distanceToAlightM",
)

# Wire distanceToAlightM in navigationService applyTick
patch(
    "src/services/navigation/navigationService.ts",
    """  void maybeSpeakAlightNow({
    transportMode: tick.transportMode,
    remainingStations: tick.remainingStations ?? null,
    distanceToDestinationM: tick.distanceToDestinationM,
    speedMs: tick.speedMs ?? null,
    navPhase: tick.navPhase ?? null,
  });""",
    """  let distanceToAlightM: number | null = null;
  try {
    const tour = useFinnusStore.getState().multiStopTour;
    const alight =
      tour?.stops.find((s) => s.role === 'alight' && !s.done) ?? null;
    if (
      alight &&
      typeof lastLat === 'number' &&
      typeof lastLng === 'number'
    ) {
      distanceToAlightM = distanceMeters(lastLat, lastLng, alight.lat, alight.lng);
    }
  } catch {
    /* soft */
  }
  void maybeSpeakAlightNow({
    transportMode: tick.transportMode,
    remainingStations: tick.remainingStations ?? null,
    distanceToDestinationM: tick.distanceToDestinationM,
    speedMs: tick.speedMs ?? null,
    navPhase: tick.navPhase ?? null,
    distanceToAlightM,
  });""",
    already="distanceToAlightM,",
)

# ---------------------------------------------------------------------------
# 3) HUD — wait minutes at halt (walk_to_stop / waiting)
# ---------------------------------------------------------------------------
patch(
    "src/services/navigation/navHudEta.ts",
    """export function pickNavHudEta(input: {
  lastStopEndMs?: number | null;
  rideStartMs?: number | null;
  navEtaMin?: number | null;
  remainingM?: number | null;
  walkFallbackMin?: number | null;
  nowMs: number;
}): { etaMin: number | null; arriveMs: number | null } {
  const end = input.lastStopEndMs;
  if (end != null && Number.isFinite(end) && end > input.nowMs - 30 * 60_000) {
    const rideStart = input.rideStartMs;
    const rideMin =
      rideStart != null &&
      Number.isFinite(rideStart) &&
      end > rideStart
        ? Math.max(1, Math.round((end - rideStart) / 60_000))
        : Math.max(0, Math.round((end - input.nowMs) / 60_000));
    return {
      etaMin: rideMin,
      arriveMs: end,
    };
  }""",
    """export function pickNavHudEta(input: {
  lastStopEndMs?: number | null;
  rideStartMs?: number | null;
  navEtaMin?: number | null;
  remainingM?: number | null;
  walkFallbackMin?: number | null;
  nowMs: number;
  /**
   * Am Halt wartend: Minuten bis Fahrzeug — nicht Ziel-ETA.
   * walk_to_stop / waiting.
   */
  waitingForVehicle?: boolean;
  vehicleDepartMs?: number | null;
}): { etaMin: number | null; arriveMs: number | null; waitMin?: number | null } {
  if (input.waitingForVehicle) {
    const dep = input.vehicleDepartMs ?? input.rideStartMs;
    if (dep != null && Number.isFinite(dep)) {
      const waitMin = Math.max(0, Math.round((dep - input.nowMs) / 60_000));
      return {
        etaMin: waitMin,
        arriveMs: dep,
        waitMin,
      };
    }
  }
  const end = input.lastStopEndMs;
  if (end != null && Number.isFinite(end) && end > input.nowMs - 30 * 60_000) {
    const rideStart = input.rideStartMs;
    const rideMin =
      rideStart != null &&
      Number.isFinite(rideStart) &&
      end > rideStart
        ? Math.max(1, Math.round((end - rideStart) / 60_000))
        : Math.max(0, Math.round((end - input.nowMs) / 60_000));
    return {
      etaMin: rideMin,
      arriveMs: end,
    };
  }""",
    already="waitingForVehicle",
)

# Header: pass waiting flag + label vehicle wait
patch(
    "src/components/Header.tsx",
    """    const hudEta = pickNavHudEta({
      lastStopEndMs,
      rideStartMs,
      navEtaMin: s.navEtaMin,
      remainingM: remaining,
      walkFallbackMin: walkFallback,
      nowMs: Date.now(),
    });
    const totalEtaMin = hudEta.etaMin;
    const stopProg = isMultiStop
      ? `Stop ${Math.min(tour!.currentIndex + 1, tour!.stops.length)}/${tour!.stops.length}`
      : null;
    const arriveClock =
      hudEta.arriveMs != null
        ? new Date(hudEta.arriveMs).toLocaleTimeString('de-DE', {
            hour: '2-digit',
            minute: '2-digit',
          })
        : null;
    const transitHud = Boolean(
      tour?.stops.some(
        (st) =>
          st.role === 'alight' || st.role === 'board' || Boolean(st.line),
      ) || tour?.liveMeta,
    );
    const distEta = transitHud
      ? totalEtaMin != null
        ? formatDurationMinutesDe(totalEtaMin, 'short')
        : null
      : remaining != null
        ? totalEtaMin != null
          ? `${formatKm(remaining)} · ${formatDurationMinutesDe(totalEtaMin, 'short')}`
          : formatKm(remaining)
        : null;""",
    """    const waitingAtBoard =
      s.navPhase === 'walk_to_stop' ||
      (Boolean(tour?.stops.some((st) => Boolean(st.line))) &&
        s.navPhase !== 'in_transit' &&
        s.navPhase !== 'post_transit_walk' &&
        rideStartMs != null &&
        rideStartMs > Date.now() - 30_000);
    const hudEta = pickNavHudEta({
      lastStopEndMs,
      rideStartMs,
      navEtaMin: s.navEtaMin,
      remainingM: remaining,
      walkFallbackMin: walkFallback,
      nowMs: Date.now(),
      waitingForVehicle: waitingAtBoard,
      vehicleDepartMs: rideStartMs,
    });
    const totalEtaMin = hudEta.etaMin;
    const stopProg = isMultiStop
      ? `Stop ${Math.min(tour!.currentIndex + 1, tour!.stops.length)}/${tour!.stops.length}`
      : null;
    const arriveClock =
      !waitingAtBoard && hudEta.arriveMs != null
        ? new Date(hudEta.arriveMs).toLocaleTimeString('de-DE', {
            hour: '2-digit',
            minute: '2-digit',
          })
        : null;
    const transitHud = Boolean(
      tour?.stops.some(
        (st) =>
          st.role === 'alight' || st.role === 'board' || Boolean(st.line),
      ) || tour?.liveMeta,
    );
    const waitLabel =
      waitingAtBoard && totalEtaMin != null
        ? totalEtaMin <= 0
          ? 'Fahrzeug gleich da'
          : `Fahrzeug in ${totalEtaMin} Min`
        : null;
    const distEta = waitLabel
      ? waitLabel
      : transitHud
        ? totalEtaMin != null
          ? formatDurationMinutesDe(totalEtaMin, 'short')
          : null
        : remaining != null
          ? totalEtaMin != null
            ? `${formatKm(remaining)} · ${formatDurationMinutesDe(totalEtaMin, 'short')}`
            : formatKm(remaining)
          : null;""",
    already="Fahrzeug in",
)

# ---------------------------------------------------------------------------
# 4) onboardSpeech must fire on in_transit — retry + gap bypass
# ---------------------------------------------------------------------------
patch(
    "src/services/navigation/transitGuideCoach.ts",
    """async function speakKey(key: string, text: string): Promise<void> {
  if (!text.trim()) return;
  if (spoken.has(key)) return;
  const now = Date.now();
  if (now - lastSpeakAt < CUE_GAP_MS) return;
  const store = useFinnusStore.getState();
  if (store.isPlayingAudio || store.isGenerating) return;
  spoken.add(key);
  lastSpeakAt = now;
  try {
    await speakAssistantText(text.trim());
  } catch {
    spoken.delete(key);
  }
}""",
    """async function speakKey(
  key: string,
  text: string,
  opts?: { force?: boolean },
): Promise<boolean> {
  if (!text.trim()) return false;
  if (spoken.has(key)) return true;
  const now = Date.now();
  if (!opts?.force && now - lastSpeakAt < CUE_GAP_MS) return false;
  const store = useFinnusStore.getState();
  if (!opts?.force && (store.isPlayingAudio || store.isGenerating)) return false;
  spoken.add(key);
  lastSpeakAt = now;
  try {
    await speakAssistantText(text.trim());
    return true;
  } catch {
    spoken.delete(key);
    return false;
  }
}""",
    already="opts?: { force?: boolean }",
)

patch(
    "src/services/navigation/transitGuideCoach.ts",
    """  if (opts.next === 'in_transit' && opts.prev !== 'in_transit') {
    const n = opts.remainingStops;
    if (n != null && n >= 1) {
      noteTransitGuideSpoken(`stops:${n}`);
    }
    await speakKey('onboard', onboardSpeech(facts));
  }""",
    """  if (opts.next === 'in_transit' && opts.prev !== 'in_transit') {
    const n = opts.remainingStops;
    if (n != null && n >= 1) {
      noteTransitGuideSpoken(`stops:${n}`);
    }
    // Phase-Flip: Ride-Start muss durch — Gap/Busy nicht schlucken.
    const ok = await speakKey('onboard', onboardSpeech(facts), { force: true });
    if (!ok) spoken.delete('onboard');
  }""",
    already="force: true",
)

patch(
    "src/services/navigation/transitGuideCoach.ts",
    """  if (phase && phase !== lastPhase) {
    const prev = lastPhase;
    lastPhase = phase;
    void onTransitGuidePhaseChange({
      prev,
      next: phase,
      remainingStops: opts.remainingStations,
      destWalkM: opts.distanceToDestinationM,
      destName: opts.destName,
      mode: opts.transportMode,
    });
  } else if (phase) {
    lastPhase = phase;
  }""",
    """  if (phase && phase !== lastPhase) {
    const prev = lastPhase;
    lastPhase = phase;
    void onTransitGuidePhaseChange({
      prev,
      next: phase,
      remainingStops: opts.remainingStations,
      destWalkM: opts.distanceToDestinationM,
      destName: opts.destName,
      mode: opts.transportMode,
    });
  } else if (phase === 'in_transit' && !spoken.has('onboard')) {
    // Retry wenn Board-Speech beim Flip wegen Busy verpasst wurde.
    void onTransitGuidePhaseChange({
      prev: 'walk_to_stop',
      next: 'in_transit',
      remainingStops: opts.remainingStations,
      destWalkM: opts.distanceToDestinationM,
      destName: opts.destName,
      mode: opts.transportMode,
    });
  } else if (phase) {
    lastPhase = phase;
  }""",
    already="!spoken.has('onboard')",
)

# ---------------------------------------------------------------------------
# 5) Bus line only at HALT_NEAR (not +40)
# ---------------------------------------------------------------------------
patch(
    "src/services/navigation/transitGuideCoach.ts",
    """        // Halt noch nicht gesagt → mit Gleis nachziehen.
        if (!spoken.has('halt')) {
          const refreshed = factsFromTour({
            remainingStops: opts.remainingStations,
            destWalkM: opts.distanceToDestinationM,
            destName: opts.destName,
            mode: opts.transportMode,
            nowMs: Date.now(),
          });
          if (refreshed) {
            await speakKey('halt', haltArrivedSpeech(refreshed));
          }
        }""",
    """        // Halt-Speech nur echt nah (nicht schon bei Lookup-Radius +40).
        const dNow = distanceMeters(
          opts.userLat,
          opts.userLng,
          board.lat,
          board.lng,
        );
        if (!spoken.has('halt') && dNow <= HALT_NEAR_M) {
          const refreshed = factsFromTour({
            remainingStops: opts.remainingStations,
            destWalkM: opts.distanceToDestinationM,
            destName: opts.destName,
            mode: opts.transportMode,
            nowMs: Date.now(),
          });
          if (refreshed) {
            await speakKey('halt', haltArrivedSpeech(refreshed));
          }
        }""",
    already="dNow <= HALT_NEAR_M",
)

print("live_nav_remaining done")
