# -*- coding: utf-8 -*-
from pathlib import Path
import re

path = Path(r"c:\Users\larsf\Findus 2.0\.cursor\_jlb_work.ts")
text = path.read_text(encoding="utf-8")

poll_new = r'''async function pollTransferWhileRiding(now: number): Promise<void> {
  const tour = useFinnusStore.getState().multiStopTour;
  if (!tour?.stops?.length) return;
  const idx = tour.currentIndex ?? 0;
  const cur = tour.stops[idx];
  const transfer = findUpcomingTransferBoard(tour.stops, idx);
  if (!transfer) return;
  if (!Number.isFinite(destArmed.lat) || destArmed.lat === 0) return;

  const navDist = useFinnusStore.getState().navDistanceM;
  const etaSec =
    typeof navDist === 'number' && Number.isFinite(navDist) && navDist > 0
      ? navDist / 12
      : null;
  const alightArrive =
    resolveAlightArriveMs({
      stop: cur,
      nowMs: now,
      etaSec,
    }) ?? transfer.depMs - (transfer.transferWalkMin + 3) * 60_000;

  try {
    const { planTransitHandsFree } = await import('./handsFreeNav/transitBridge');
    const { linesMatch } = await import('../transit/missedConnectionPolicy');
    const departAt = new Date(
      Math.max(now, alightArrive - 2 * 60_000),
    );
    const fresh = await planTransitHandsFree({
      from: { lat: transfer.lat, lng: transfer.lng },
      to: { lat: destArmed.lat, lng: destArmed.lng },
      departAt,
    });
    const legs = fresh?.legs ?? [];
    const match =
      legs.find(
        (l) =>
          l.mode !== 'WALK' &&
          l.mode !== 'BIKE' &&
          linesMatch(l.line, transfer.line),
      ) ??
      legs.find((l) => l.mode !== 'WALK' && l.mode !== 'BIKE');
    if (!match?.startTime) return;
    const liveDep =
      match.startTime instanceof Date
        ? match.startTime.getTime()
        : NaN;
    if (!Number.isFinite(liveDep)) return;
    const scheduledMs =
      match.scheduledStart instanceof Date
        ? match.scheduledStart.getTime()
        : null;
    const kind = classifyTransitSlip({
      nowMs: now,
      armedDepMs: transfer.depMs,
      nextDepMs: liveDep,
      scheduledStartMs: scheduledMs,
      delaySec: match.delaySec ?? null,
    });

    let nextDep = transfer.depMs;
    if (kind === 'live_delay' || kind === 'missed_next') {
      nextDep = liveDep;
    }
    nextDepHintMs = nextDep;
    nextLineHint = (match.line || transfer.line || '').trim();

    const link = assessTransferConnection({
      nowMs: now,
      alightArriveMs: alightArrive,
      nextDepMs: nextDep,
      transferWalkMin: transfer.transferWalkMin,
      line: cur?.line ?? lineLabel,
      nextLine: nextLineHint || transfer.line,
    });

    if (link.timelineHint && link.timelineHint !== lastTransferHint) {
      lastTransferHint = link.timelineHint;
      applyLiveHintToTour(link.timelineHint);
      try {
        const st = useFinnusStore.getState();
        const t2 = st.multiStopTour;
        if (t2?.liveMeta) {
          st.setMultiStopTour({
            ...t2,
            liveMeta: {
              ...t2.liveMeta,
              bufferMin: Math.max(0, link.transferSlackMin),
            },
          });
        }
        const { upsertLiveNavFromStore } = require('../../module2/timeline/syncLiveNavToPlan') as {
          upsertLiveNavFromStore: (o?: { force?: boolean }) => void;
        };
        upsertLiveNavFromStore({ force: true });
      } catch {
        /* soft */
      }
    }

    if (
      (kind === 'live_delay' || Math.abs(nextDep - transfer.depMs) >= 45_000) &&
      Number.isFinite(nextDep)
    ) {
      const patched = shiftTourStopTimesForDelay(tour.stops, {
        oldDepMs: transfer.depMs,
        newDepMs: nextDep,
        delaySec: match.delaySec ?? null,
      });
      useFinnusStore.getState().setMultiStopTour({
        ...tour,
        stops: patched,
      });
    }

    const speakRisk =
      link.scenario === 'at_risk' ||
      link.scenario === 'broken' ||
      kind === 'live_delay';
    if (
      speakRisk &&
      link.tip &&
      !muteLeaveSpeech &&
      now - lastTransferSpeakMs > 3 * 60_000
    ) {
      lastTransferSpeakMs = now;
      const { enqueueSpeech } = await import('../../module2/speech/speechQueue');
      let text = link.tip;
      if (kind === 'live_delay' && match.delaySec != null && match.delaySec >= 180) {
        const delayMin = Math.max(3, Math.round(match.delaySec / 60));
        text = `${nextLineHint || 'Anschluss'} hat etwa ${delayMin} Minuten Verspätung — Abfahrt um ${clockHm(nextDep)} Uhr. ${link.tip}`;
      }
      enqueueSpeech({
        kind: 'main',
        text: text.slice(0, 320),
        turnId: `journey_xfer_${Date.now()}`,
      });
    }

    // Anschluss weg: Alternative ab Umstiegshaltestelle (nicht Zug-GPS).
    if (link.scenario === 'broken' || kind === 'missed_next') {
      void proposeMissedAlternative(
        { lat: transfer.lat, lng: transfer.lng },
        now,
        { forceTransfer: true, preferLine: transfer.line },
      );
    }
  } catch {
    /* soft */
  }
}

async function pollDelay(): Promise<void> {
  if (!watchAlive) return;
  const now = Date.now();
  if (now - lastDelayPollMs < 90_000) return;
  lastDelayPollMs = now;
  if (!Number.isFinite(destArmed.lat) || destArmed.lat === 0) return;

  // Während der Fahrt: Anschluss am Umstieg prüfen — kein GPS-Replan vom Zug.
  if (isMidRideTransit()) {
    await pollTransferWhileRiding(now);
    return;
  }

  const origin = {
    lat: useGpsStore.getState().lat ?? useFinnusStore.getState().lastGpsLat,
    lng: useGpsStore.getState().lng ?? useFinnusStore.getState().lastGpsLng,
  };
  if (origin.lat == null || origin.lng == null) return;
  try {
    const { planTransitHandsFree } = await import('./handsFreeNav/transitBridge');
    const fresh = await planTransitHandsFree({
      from: { lat: origin.lat, lng: origin.lng },
      to: { lat: destArmed.lat, lng: destArmed.lng },
    });
    const first = (fresh?.legs ?? []).find(
      (l) => l.mode !== 'WALK' && l.mode !== 'BIKE',
    );
    const nextDep =
      fresh?.firstTransitDeparture instanceof Date
        ? fresh.firstTransitDeparture.getTime()
        : first?.startTime instanceof Date
          ? first.startTime.getTime()
          : NaN;
    if (!Number.isFinite(nextDep) || depMsArmed == null) return;
    const scheduledMs =
      first?.scheduledStart instanceof Date
        ? first.scheduledStart.getTime()
        : null;
    const kind = classifyTransitSlip({
      nowMs: now,
      armedDepMs: depMsArmed,
      nextDepMs: nextDep,
      scheduledStartMs: scheduledMs,
      delaySec: first?.delaySec ?? null,
    });
    const slipMin = Math.round((nextDep - depMsArmed) / 60_000);
    if (kind === 'unchanged') return;
    if (kind === 'missed_next') {
      void proposeMissedAlternative(origin, now);
      return;
    }
    const ride = (first?.line || lineLabel || 'Bahn').trim();
    const delayMin = Math.max(
      3,
      Math.round((first?.delaySec ?? slipMin * 60) / 60),
    );
    // Folgeverbindung merken (für „lieber warten“-Tipp).
    try {
      const alts = await planTransitHandsFree({
        from: { lat: origin.lat, lng: origin.lng },
        to: { lat: destArmed.lat, lng: destArmed.lng },
        departAt: new Date(nextDep + 8 * 60_000),
      });
      const altDep =
        alts?.firstTransitDeparture instanceof Date
          ? alts.firstTransitDeparture.getTime()
          : NaN;
      if (Number.isFinite(altDep) && altDep > nextDep + 60_000) {
        nextDepHintMs = altDep;
        nextLineHint = (alts?.firstTransitLine || ride).trim();
      }
    } catch {
      /* soft */
    }
    if (now - lastDelaySpeakMs > 4 * 60_000) {
      if (!watchAlive) return;
      lastDelaySpeakMs = now;
      const { enqueueSpeech } = await import('../../module2/speech/speechQueue');
      const bufferGain =
        slipMin >= 2
          ? ` Mehr Puffer — du kannst entspannter laufen.`
          : '';
      enqueueSpeech({
        kind: 'main',
        text: `${ride} hat etwa ${delayMin} Minuten Verspätung — Abfahrt um ${clockHm(nextDep)} Uhr.${bufferGain}`,
        turnId: `journey_delay_${Date.now()}`,
      });
    }
    const tour = useFinnusStore.getState().multiStopTour;
    if (tour?.liveMeta && depMsArmed != null) {
      const oldDep = depMsArmed;
      const walkMin = walkMinToStop(
        { lat: origin.lat, lng: origin.lng },
        firstStop,
      );
      const nextLeave =
        nextDep -
        (walkMin +
          stationArriveBufferMin({
            name:
              useFinnusStore.getState().multiStopTour?.stops?.[0]?.name ??
              lineLabel,
          })) *
          60_000;
      armedLeaveByMs = nextLeave;
      depMsArmed = nextDep;
      const patchedStops = shiftTourStopTimesForDelay(tour.stops, {
        oldDepMs: oldDep,
        newDepMs: nextDep,
        delaySec: first?.delaySec ?? delayMin * 60,
      });
      useFinnusStore.getState().setMultiStopTour({
        ...tour,
        stops: patchedStops,
        liveMeta: {
          ...tour.liveMeta,
          leaveByMs: nextLeave,
          firstTransitMs: nextDep,
          plannedArriveByMs:
            fresh?.endTime instanceof Date
              ? fresh.endTime.getTime()
              : tour.liveMeta.plannedArriveByMs,
        },
      });
      const { upsertLiveNavFromStore } = require('../../module2/timeline/syncLiveNavToPlan') as {
        upsertLiveNavFromStore: (o?: { force?: boolean }) => void;
      };
      upsertLiveNavFromStore({ force: true });
    }
  } catch {
    /* soft */
  }
}
'''

m = re.search(r'async function pollDelay\(\): Promise<void> \{', text)
if not m:
    raise SystemExit('pollDelay not found')
start = m.start()
end_m = re.search(r'\nfunction tick\(\): void \{', text[start:])
if not end_m:
    raise SystemExit('tick not found after pollDelay')
end = start + end_m.start()
text = text[:start] + poll_new + '\n' + text[end:]

old_tick_block = '''  if (
    Number.isFinite(origin.lat) &&
    Number.isFinite(origin.lng) &&
    Number.isFinite(firstStop.lat) &&
    depMsArmed != null
  ) {
    const board = currentBoardTarget();
'''
new_tick_block = '''  // Mitten in der Fahrt: kein Fuß-Pacing zum ersten Einstieg (wäre falsch „verpasst“).
  if (isMidRideTransit()) {
    void pollDelay();
    return;
  }
  if (
    Number.isFinite(origin.lat) &&
    Number.isFinite(origin.lng) &&
    Number.isFinite(firstStop.lat) &&
    depMsArmed != null
  ) {
    const board = currentBoardTarget();
'''
if old_tick_block not in text:
    raise SystemExit('tick block not found')
text = text.replace(old_tick_block, new_tick_block, 1)

old_propose = '''async function proposeMissedAlternative(
  origin: { lat: number; lng: number },
  now: number,
): Promise<void> {
  if (!watchAlive) return;
  if (depMsArmed == null) return;
  if (now - lastMissedSwapMs < 90_000) return;
  if (!Number.isFinite(destArmed.lat) || destArmed.lat === 0) return;
  const tour = useFinnusStore.getState().multiStopTour;
  const idx = tour?.currentIndex ?? 0;
  const cur = tour?.stops?.[idx];
  // Erster Einstieg oder Umstieg (transfer/walk mit Fahrzeug) — nicht mitten in der Fahrt.
  if (idx > 0) {
    const okRole =
      cur?.role === 'transfer' ||
      cur?.role === 'walk' ||
      cur?.role === 'board';
    if (!okRole) return;
  }
  if (tour?.stops?.[0]?.done && idx === 0) return;
  lastMissedSwapMs = now;
  const oldDep = cur?.vehicleStartMs ?? depMsArmed;
  try {
    const { recalculateMissedConnection } = await import('../transit/journeyPlanner');
    const afterMs = Math.max(now, oldDep) + 2 * 60_000;
    const pick = await recalculateMissedConnection({
      from: { lat: origin.lat, lng: origin.lng },
      to: { lat: destArmed.lat, lng: destArmed.lng },
      after: new Date(afterMs),
      preferLine: cur?.line ?? lineLabel,
      missedLineLabel: cur?.line ?? lineLabel,
    });
'''

new_propose = '''async function proposeMissedAlternative(
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
'''

if old_propose not in text:
    raise SystemExit('proposeMissedAlternative block not found')
text = text.replace(old_propose, new_propose, 1)

old_silent = '''    // Aktiver Prompt bei langer Wartezeit — Alternative nur vorschlagen, nicht still ersetzen.
    if (pick.mode === 'active_prompt' && pick.promptSpeech) {
'''
new_silent = '''    // Während der Fahrt: nur ansagen, Tour nicht still ersetzen.
    const riding = opts?.forceTransfer === true && isMidRideTransit();
    if (riding || (pick.mode === 'active_prompt' && pick.promptSpeech)) {
'''
if old_silent not in text:
    raise SystemExit('active_prompt block not found')
text = text.replace(old_silent, new_silent, 1)

old_speech = '''      enqueueSpeech({
        kind: 'main',
        text: pick.promptSpeech.slice(0, 320),
        turnId: `journey_missed_ask_${Date.now()}`,
      });
'''
new_speech = '''      const ask =
        pick.promptSpeech ||
        `${prefer || 'Anschluss'} passt nicht mehr — nach dem Ausstieg neue Verbindung um ${clockHm(nextDep)} Uhr.`;
      enqueueSpeech({
        kind: 'main',
        text: ask.slice(0, 320),
        turnId: `journey_missed_ask_${Date.now()}`,
      });
'''
if old_speech not in text:
    raise SystemExit('prompt speech not found')
text = text.replace(old_speech, new_speech, 1)

old_reset = '''  lastPaceHint = null;
  lastWaitShown = -1;
  nextDepHintMs = null;
  nextLineHint = '';
'''
new_reset = '''  lastPaceHint = null;
  lastWaitShown = -1;
  nextDepHintMs = null;
  nextLineHint = '';
  lastTransferSpeakMs = 0;
  lastTransferHint = null;
'''
if old_reset not in text:
    raise SystemExit('reset block not found')
text = text.replace(old_reset, new_reset, 1)

path.write_text(text, encoding='utf-8', newline='\n')
print('patched ok', path.stat().st_size)
print('pollTransfer', 'pollTransferWhileRiding' in text)
print('mid skip', 'Mitten in der Fahrt' in text)
print('forceTransfer', 'forceTransfer' in text)
