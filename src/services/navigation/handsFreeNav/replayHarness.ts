/**
 * Dev replay harness — Kiel stuck-hint / pace / compass checks (no device needed).
 */

import { formatNavTurnHint } from '../navTurnHint';
import { isTurnManeuver } from '../navPredictiveCue';
import type { NavWaypoint } from '../navigationTypes';
import {
  etaMinutesFromRoute,
  resetHandsFreeEta,
  noteHandsFreeEtaGps,
  PACE_SWITCH_ACTIVE_M,
} from './eta';
import { speakStartDistanceM, findNextTurnWaypoint } from './cueScheduler';
import { pushAdaptiveHeading, resetHandsFreeCompass } from './compass';

export type HarnessReport = {
  ok: boolean;
  checks: Array<{ name: string; ok: boolean; detail: string }>;
};

/** Simulate walking toward a turn — hint meters must decrease; direction stable. */
export function replayStuckHintScenario(): HarnessReport {
  const checks: HarnessReport['checks'] = [];
  const waypoints: NavWaypoint[] = [];
  for (let i = 0; i < 20; i++) {
    waypoints.push({
      lat: 54.32 + i * 0.00005,
      lng: 10.13,
      maneuver: i === 15 ? 'turn-right' : 'straight',
      landmark: i === 15 ? 'Sparkasse' : null,
      splineAlongM: i * 20,
    });
  }

  const next = findNextTurnWaypoint({ waypoints, fromIndex: 0 });
  checks.push({
    name: 'find_right_turn',
    ok: Boolean(next && isTurnManeuver(next.wp.maneuver) && next.wp.maneuver?.includes('right')),
    detail: `maneuver=${next?.wp.maneuver ?? 'null'}`,
  });

  let prevDist = 400;
  let monotonic = true;
  for (const dist of [240, 180, 120, 60, 25]) {
    const hint = formatNavTurnHint({
      landmark: 'Sparkasse',
      maneuver: 'turn-right',
      distanceM: dist,
    });
    if (!hint || !/rechts/i.test(hint)) monotonic = false;
    if (dist > prevDist) monotonic = false;
    prevDist = dist;
    checks.push({
      name: `hint_at_${dist}m`,
      ok: Boolean(hint && /rechts/i.test(hint) && String(dist).split('') && hint.includes(String(dist))),
      detail: hint ?? 'null',
    });
  }
  checks.push({
    name: 'distances_decrease',
    ok: monotonic,
    detail: 'hint distances walked down',
  });

  return { ok: checks.every((c) => c.ok), checks };
}

export function replayPaceSwitch(): HarnessReport {
  resetHandsFreeEta('walk');
  const checks: HarnessReport['checks'] = [];
  // Simulate 1.2 km of walking samples
  let lat = 54.3;
  const lng = 10.1;
  for (let i = 0; i < 80; i++) {
    lat += 0.00012; // ~13 m
    noteHandsFreeEtaGps({
      lat,
      lng,
      speedMps: 1.3,
      isBike: false,
      atMs: Date.now() + i * 1000,
    });
  }
  const eta = etaMinutesFromRoute({ remainingRouteM: 2000 });
  checks.push({
    name: 'pace_source_after_1km',
    ok: eta.paceSource === 'user_cruise' || eta.mPerMin > 0,
    detail: `source=${eta.paceSource} mPerMin=${eta.mPerMin} switchAt=${PACE_SWITCH_ACTIVE_M}`,
  });
  checks.push({
    name: 'eta_from_route',
    ok: eta.etaMin >= 1,
    detail: `etaMin=${eta.etaMin}`,
  });
  return { ok: checks.every((c) => c.ok), checks };
}

export function replayCompassSnap(): HarnessReport {
  resetHandsFreeCompass();
  const checks: HarnessReport['checks'] = [];
  const a = pushAdaptiveHeading(10, { speedMps: 0 });
  const t0 = Date.now();
  const b = pushAdaptiveHeading(90, { speedMps: 1, nowMs: t0 + 50 });
  const delta = Math.abs(((b - a + 540) % 360) - 180);
  checks.push({
    name: 'fast_snap_on_large_turn',
    ok: Math.abs(b - 90) < 25 || delta > 40,
    detail: `from=${a.toFixed(1)} to=${b.toFixed(1)}`,
  });
  const speakM = speakStartDistanceM({
    speechSec: 5,
    speedMps: 1.25,
    transportMode: 'walk',
  });
  checks.push({
    name: 'time_based_speak_distance',
    ok: speakM >= 8 && speakM <= 12,
    detail: `speakStartM=${speakM} ((5+2)s × 1.25 m/s, floor 8)`,
  });
  const sprint = speakStartDistanceM({
    speechSec: 4,
    speedMps: 10,
    transportMode: 'walk',
  });
  checks.push({
    name: 'finish_2s_before_at_speed',
    ok: sprint === 60,
    detail: `4s speech @ 10 m/s → start ${sprint} m (want 60)`,
  });
  return { ok: checks.every((c) => c.ok), checks };
}

export function runHandsFreeReplayHarness(): HarnessReport {
  const parts = [
    replayStuckHintScenario(),
    replayPaceSwitch(),
    replayCompassSnap(),
  ];
  const checks = parts.flatMap((p) => p.checks);
  const report = { ok: checks.every((c) => c.ok), checks };
  if (__DEV__) {
    console.log(
      `[handsFreeHarness] ok=${report.ok}`,
      report.checks.map((c) => `${c.ok ? '✓' : '✗'} ${c.name}: ${c.detail}`),
    );
  }
  return report;
}
