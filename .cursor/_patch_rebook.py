# -*- coding: utf-8 -*-
"""Patch proposeMissedAlternative + pollDelay + tick for auto-rebook."""
from pathlib import Path
import re

p = Path(r"c:\Users\larsf\Findus 2.0\src\services\navigation\journeyLeaveBy.ts")
t = p.read_text(encoding="utf-8")

# Import HEAVY_DELAY_MIN via dynamic require in functions — or add to existing imports.
# We use require inside to avoid churn.

old_propose = r'''async function proposeMissedAlternative(
  origin: { lat: number; lng: number },
  now: number,
  opts?: { forceTransfer?: boolean; preferLine?: string | null },
): Promise<void> {
  if (!watchAlive) return;
  if (depMsArmed == null) return;
  if (now - lastMissedSwapMs < 90_000) return;
  if (!Number.isFinite(destArmed.lat) || destArmed.lat === 0) return;
  const tour = useFinnusStore.getState().multiStopTour;
  const idx = tour?.currentIndex ?? 0;
  const cur = tour?.stops?.[idx];
  const transfer =
    opts?.forceTransfer && tour?.stops
      ? findUpcomingTransferBoard(tour.stops, idx)
      : null;
  // Erster Einstieg oder Umstieg — nicht still die laufende Fahrt ersetzen.
  if (!opts?.forceTransfer && idx > 0) {
    const okRole =
      cur?.role === 'transfer' ||
      cur?.role === 'walk' ||
      cur?.role === 'board';
    if (!okRole) return;
  }
  if (!opts?.forceTransfer && tour?.stops?.[0]?.done && idx === 0) return;
  lastMissedSwapMs = now;
  const prefer =
    opts?.preferLine ?? transfer?.line ?? cur?.line ?? lineLabel;
  const oldDep =
    transfer?.depMs ?? cur?.vehicleStartMs ?? depMsArmed;
  try {
    const { recalculateMissedConnection } = await import('../transit/journeyPlanner');
    const afterMs = Math.max(now, oldDep) + 2 * 60_000;
    const pick = await recalculateMissedConnection({
      from: { lat: origin.lat, lng: origin.lng },
      to: { lat: destArmed.lat, lng: destArmed.lng },
      after: new Date(afterMs),
      preferLine: prefer,
      missedLineLabel: prefer,
    });
    const next = pick.primary;
    if (!next) return;
    const nextDep =
      next.firstTransitDeparture instanceof Date
        ? next.firstTransitDeparture.getTime()
        : next.startTime.getTime();
    if (!Number.isFinite(nextDep)) return;
    nextDepHintMs = nextDep;
    nextLineHint = (next.firstTransitLine || '').trim();

    // Während der Fahrt: nur ansagen, Tour nicht still ersetzen.
    const riding = opts?.forceTransfer === true && isMidRideTransit();
    if (riding || (pick.mode === 'active_prompt' && pick.promptSpeech)) {
      if (!watchAlive) return;
      const { enqueueSpeech } = await import('../../module2/speech/speechQueue');
      const ask =
        pick.promptSpeech ||
        `${prefer || 'Anschluss'} passt nicht mehr — nach dem Ausstieg neue Verbindung um ${clockHm(nextDep)} Uhr.`;
      enqueueSpeech({
        kind: 'main',
        text: ask.slice(0, 320),
        turnId: `journey_missed_ask_${Date.now()}`,
      });
      applyLiveHintToTour(
        pick.waitMinForPrimary > 0
          ? `nächste in ${pick.waitMinForPrimary} Min`
          : 'Alternative prüfen',
      );
      try {
        const { upsertLiveNavFromStore } = require('../../module2/timeline/syncLiveNavToPlan') as {
          upsertLiveNavFromStore: (o?: { force?: boolean }) => void;
        };
        upsertLiveNavFromStore({ force: true });
      } catch {
        /* soft */
      }
      return;
    }

    const { startJourneyNavigation } = await import('./startJourneyNavigation');
    await startJourneyNavigation({
      itinerary: next,
      destName: destArmed.name,
      destLat: destArmed.lat,
      destLng: destArmed.lng,
      replace: true,
    });
    const ride = (next.firstTransitLine || 'nächste Verbindung').trim();
    if (!watchAlive) return;
    const { enqueueSpeech } = await import('../../module2/speech/speechQueue');
    enqueueSpeech({
      kind: 'main',
      text:
        `${cur?.line || lineLabel || 'Bahn'} um ${clockHm(oldDep)} Uhr ist weg. ` +
        `Nächste: ${ride} um ${clockHm(nextDep)} Uhr` +
        (pick.waitMinForPrimary > 0
          ? ` — etwa ${pick.waitMinForPrimary} Minuten warten.`
          : '.'),
      turnId: `journey_missed_${Date.now()}`,
    });
  } catch {
    /* soft */
  }
}'''

new_propose = r'''async function proposeMissedAlternative(
  origin: { lat: number; lng: number },
  now: number,
  opts?: {
    forceTransfer?: boolean;
    preferLine?: string | null;
    reason?:
      | 'too_slow'
      | 'cancelled'
      | 'heavy_delay'
      | 'missed_departed'
      | 'generic';
    delayMin?: number | null;
  },
): Promise<void> {
  if (!watchAlive) return;
  if (depMsArmed == null) return;
  if (now - lastMissedSwapMs < 90_000) return;
  if (!Number.isFinite(destArmed.lat) || destArmed.lat === 0) return;
  const tour = useFinnusStore.getState().multiStopTour;
  const idx = tour?.currentIndex ?? 0;
  const cur = tour?.stops?.[idx];
  const transfer =
    opts?.forceTransfer && tour?.stops
      ? findUpcomingTransferBoard(tour.stops, idx)
      : null;
  // Erster Einstieg oder Umstieg — nicht still die laufende Fahrt ersetzen.
  if (!opts?.forceTransfer && idx > 0) {
    const okRole =
      cur?.role === 'transfer' ||
      cur?.role === 'walk' ||
      cur?.role === 'board';
    if (!okRole) return;
  }
  if (!opts?.forceTransfer && tour?.stops?.[0]?.done && idx === 0) return;
  lastMissedSwapMs = now;
  const prefer =
    opts?.preferLine ?? transfer?.line ?? cur?.line ?? lineLabel;
  const oldDep =
    transfer?.depMs ?? cur?.vehicleStartMs ?? depMsArmed;
  const reason = opts?.reason ?? 'generic';
  try {
    const { recalculateMissedConnection } = await import('../transit/journeyPlanner');
    const { shouldAutoApplyMissedPick } = await import(
      '../transit/missedConnectionPolicy'
    );
    const afterMs = Math.max(now, oldDep) + 2 * 60_000;
    const pick = await recalculateMissedConnection({
      from: { lat: origin.lat, lng: origin.lng },
      to: { lat: destArmed.lat, lng: destArmed.lng },
      after: new Date(afterMs),
      preferLine: prefer,
      missedLineLabel: prefer,
      reason,
      delayMin: opts?.delayMin ?? null,
    });
    const next = pick.primary;
    if (!next) return;
    const nextDep =
      next.firstTransitDeparture instanceof Date
        ? next.firstTransitDeparture.getTime()
        : next.startTime.getTime();
    if (!Number.isFinite(nextDep)) return;
    nextDepHintMs = nextDep;
    nextLineHint = (next.firstTransitLine || '').trim();

    // Während der Fahrt (Anschluss): nur ansagen — laufende Bahn nicht ersetzen.
    const riding = opts?.forceTransfer === true && isMidRideTransit();
    const auto = !riding && shouldAutoApplyMissedPick(pick);

    if (riding || (!auto && pick.mode === 'active_prompt' && pick.promptSpeech)) {
      if (!watchAlive) return;
      const { enqueueSpeech } = await import('../../module2/speech/speechQueue');
      const ask =
        pick.promptSpeech ||
        pick.applySpeech ||
        `${prefer || 'Anschluss'} passt nicht mehr — neue Verbindung um ${clockHm(nextDep)} Uhr.`;
      enqueueSpeech({
        kind: 'main',
        text: ask.slice(0, 320),
        turnId: `journey_missed_ask_${Date.now()}`,
      });
      applyLiveHintToTour(
        pick.waitMinForPrimary > 0
          ? `nächste in ${pick.waitMinForPrimary} Min`
          : 'Alternative prüfen',
      );
      try {
        const { upsertLiveNavFromStore } = require('../../module2/timeline/syncLiveNavToPlan') as {
          upsertLiveNavFromStore: (o?: { force?: boolean }) => void;
        };
        upsertLiveNavFromStore({ force: true });
      } catch {
        /* soft */
      }
      return;
    }

    if (!auto) return;

    const { startJourneyNavigation } = await import('./startJourneyNavigation');
    await startJourneyNavigation({
      itinerary: next,
      destName: destArmed.name,
      destLat: destArmed.lat,
      destLng: destArmed.lng,
      replace: true,
    });
    depMsArmed = nextDep;
    lineLabel = (next.firstTransitLine || lineLabel || '').trim();
    if (!watchAlive) return;
    const { enqueueSpeech } = await import('../../module2/speech/speechQueue');
    const text =
      pick.applySpeech ||
      `${prefer || lineLabel || 'Bahn'} passt nicht mehr. ` +
        `Neue Verbindung: ${(next.firstTransitLine || 'ÖPNV').trim()} um ${clockHm(nextDep)} Uhr` +
        (pick.waitMinForPrimary > 0
          ? ` — etwa ${pick.waitMinForPrimary} Minuten.`
          : '.');
    enqueueSpeech({
      kind: 'main',
      text: text.slice(0, 320),
      turnId: `journey_missed_${Date.now()}`,
    });
    applyLiveHintToTour(
      pick.waitMinForPrimary > 0
        ? `neu · in ${pick.waitMinForPrimary} Min`
        : 'neue Verbindung',
    );
  } catch {
    /* soft */
  }
}'''

if old_propose not in t:
    raise SystemExit('proposeMissedAlternative block not found')
t = t.replace(old_propose, new_propose, 1)

# pace.scenario === 'missed' → too_slow
old_missed = '''    if (pace.scenario === 'missed') {
      void proposeMissedAlternative(origin, now);
    }'''
new_missed = '''    if (pace.scenario === 'missed') {
      void proposeMissedAlternative(origin, now, { reason: 'too_slow' });
    }'''
if old_missed not in t:
    raise SystemExit('pace missed block not found')
t = t.replace(old_missed, new_missed, 1)

# pollDelay missed_next + heavy delay + cancel check
old_kind = '''    if (kind === 'unchanged') return;
    if (kind === 'missed_next') {
      void proposeMissedAlternative(origin, now);
      return;
    }
    const ride = (first?.line || lineLabel || 'Bahn').trim();
    const delayMin = Math.max(
      3,
      Math.round((first?.delaySec ?? slipMin * 60) / 60),
    );'''
new_kind = '''    if (kind === 'unchanged') return;
    if (kind === 'missed_next') {
      void proposeMissedAlternative(origin, now, { reason: 'missed_departed' });
      return;
    }
    const ride = (first?.line || lineLabel || 'Bahn').trim();
    const delayMin = Math.max(
      3,
      Math.round((first?.delaySec ?? slipMin * 60) / 60),
    );
    // Starke Verspätung → bessere Route still umbuchen, wenn klar früher.
    try {
      const { HEAVY_DELAY_MIN } = require('../transit/missedConnectionPolicy') as {
        HEAVY_DELAY_MIN: number;
      };
      if (kind === 'live_delay' && delayMin >= HEAVY_DELAY_MIN) {
        void proposeMissedAlternative(origin, now, {
          reason: 'heavy_delay',
          delayMin,
          preferLine: ride,
        });
      }
    } catch {
      /* soft */
    }'''
if old_kind not in t:
    raise SystemExit('kind block not found')
t = t.replace(old_kind, new_kind, 1)

# maybeSwapMissedConnection → too_slow / missed_departed
old_swap = '''  void proposeMissedAlternative(origin, now);
}

export function startJourneyLeaveWatch'''
new_swap = '''  void proposeMissedAlternative(origin, now, { reason: 'too_slow' });
}

export function startJourneyLeaveWatch'''
if old_swap not in t:
    raise SystemExit('swap tail not found')
t = t.replace(old_swap, new_swap, 1)

# Cancelled board check inside pollDelay after we have origin — before plan, or after first
# Insert after fresh first is found, before classify — lookup cancel
old_fresh = '''    const first = (fresh?.legs ?? []).find(
      (l) => l.mode !== 'WALK' && l.mode !== 'BIKE',
    );
    const nextDep ='''
new_fresh = '''    const first = (fresh?.legs ?? []).find(
      (l) => l.mode !== 'WALK' && l.mode !== 'BIKE',
    );
    // Ausfall an der Tafel → neue Verbindung still.
    try {
      const board = currentBoardTarget();
      const halt = (board.name || '').trim();
      const line = (board.line || lineLabel || '').trim();
      if (halt && line) {
        const { lookupTrainDeparture } = await import('../transit/dbRestJourneys');
        const hit = await lookupTrainDeparture({
          stationQuery: halt,
          trainHint: line,
          aroundMs: board.depMs ?? depMsArmed ?? undefined,
          biasLat: board.lat,
          biasLng: board.lng,
        });
        if (hit?.cancelled) {
          void proposeMissedAlternative(origin, now, {
            reason: 'cancelled',
            preferLine: line,
          });
          return;
        }
      }
    } catch {
      /* soft */
    }
    const nextDep ='''
if old_fresh not in t:
    raise SystemExit('fresh first block not found')
t = t.replace(old_fresh, new_fresh, 1)

# forceTransfer broken path — pass reason
old_xfer = '''      void proposeMissedAlternative(
        { lat: transfer.lat, lng: transfer.lng },
        now,
        { forceTransfer: true, preferLine: transfer.line },
      );'''
new_xfer = '''      void proposeMissedAlternative(
        { lat: transfer.lat, lng: transfer.lng },
        now,
        {
          forceTransfer: true,
          preferLine: transfer.line,
          reason: 'missed_departed',
        },
      );'''
if old_xfer not in t:
    raise SystemExit('xfer propose not found')
t = t.replace(old_xfer, new_xfer, 1)

out = Path(r"c:\Users\larsf\Findus 2.0\.cursor\_jlb_rebook.ts")
out.write_text(t, encoding="utf-8", newline="\n")
print("patched", out.stat().st_size)
print("too_slow", "reason: 'too_slow'" in t)
print("cancelled", "reason: 'cancelled'" in t)
print("heavy", "heavy_delay" in t)
print("shouldAuto", "shouldAutoApplyMissedPick" in t)
