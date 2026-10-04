from pathlib import Path

j = Path(r"c:\Users\larsf\Findus 2.0\src\services\navigation\journeyLeaveBy.ts")
t = j.read_text(encoding="utf-8")

# --- pollTransferWhileRiding: cancel via board before replan ---
old_xfer = """  try {
    const { planTransitHandsFree } = await import('./handsFreeNav/transitBridge');
    const { linesMatch } = await import('../transit/missedConnectionPolicy');
    const departAt = new Date(
      Math.max(now, alightArrive - 2 * 60_000),
    );
    const fresh = await planTransitHandsFree({
"""
new_xfer = """  try {
    // Anschluss-Ausfall an der Tafel (Failover) — vor Replan.
    try {
      const halt = (transfer.name || '').trim();
      const line = (transfer.line || '').trim();
      if (halt && line) {
        const { lookupBoardDeparture } = await import(
          '../transit/lookupBoardDeparture'
        );
        const hit = await lookupBoardDeparture({
          stationName: halt,
          line,
          depMs: transfer.depMs,
          lat: transfer.lat,
          lng: transfer.lng,
        });
        if (hit?.cancelled) {
          void proposeMissedAlternative(
            { lat: transfer.lat, lng: transfer.lng },
            now,
            {
              forceTransfer: true,
              preferLine: line,
              reason: 'cancelled',
            },
          );
          return;
        }
        // Board-Delay für spätere Slip-Klassifikation merken.
        if (hit && hit.delaySec != null && hit.delaySec >= 180) {
          nextDepHintMs = hit.whenMs;
          nextLineHint = (hit.line || line).trim();
        }
      }
    } catch {
      /* soft */
    }

    const { planTransitHandsFree } = await import('./handsFreeNav/transitBridge');
    const { linesMatch } = await import('../transit/missedConnectionPolicy');
    const departAt = new Date(
      Math.max(now, alightArrive - 2 * 60_000),
    );
    const fresh = await planTransitHandsFree({
"""
if old_xfer not in t:
    raise SystemExit("xfer block missing")
t = t.replace(old_xfer, new_xfer, 1)

# Prefer board delaySec in transfer slip when match delay missing —
# patch after match found: inject board into classify if we have nextDepHint from cancel block
# Better: after match, also lookup and merge — already have cancel early return.
# Merge board delay into classifyTransitSlip for transfer:
old_kind = """    const kind = classifyTransitSlip({
      nowMs: now,
      armedDepMs: transfer.depMs,
      nextDepMs: liveDep,
      scheduledStartMs: scheduledMs,
      delaySec: match.delaySec ?? null,
    });
"""
new_kind = """    let boardDelaySec: number | null = match.delaySec ?? null;
    let boardNextDep = liveDep;
    let boardScheduled = scheduledMs;
    try {
      const { lookupBoardDeparture } = await import(
        '../transit/lookupBoardDeparture'
      );
      const boardHit = await lookupBoardDeparture({
        stationName: transfer.name,
        line: transfer.line,
        depMs: transfer.depMs,
        lat: transfer.lat,
        lng: transfer.lng,
      });
      if (boardHit && !boardHit.cancelled) {
        if (boardHit.delaySec != null) boardDelaySec = boardHit.delaySec;
        if (Number.isFinite(boardHit.whenMs)) boardNextDep = boardHit.whenMs;
        if (boardHit.plannedWhenMs != null) {
          boardScheduled = boardHit.plannedWhenMs;
        }
      }
    } catch {
      /* soft */
    }
    const kind = classifyTransitSlip({
      nowMs: now,
      armedDepMs: transfer.depMs,
      nextDepMs: boardNextDep,
      scheduledStartMs: boardScheduled,
      delaySec: boardDelaySec,
    });
    const liveDepEffective = boardNextDep;
"""
# This would break variable liveDep usage below - rename carefully.
# Simpler approach: only replace delaySec line and nextDep assignment

# Revert new_kind - do simpler merge
t = t.replace(new_kind if new_kind in t else "___never___", old_kind, 1)  # no-op if not applied

# Actually I haven't applied new_kind yet. Apply a simpler version:
simple_kind = """    let slipDelaySec = match.delaySec ?? null;
    let slipNextDep = liveDep;
    let slipScheduled = scheduledMs;
    try {
      const { lookupBoardDeparture } = await import(
        '../transit/lookupBoardDeparture'
      );
      const boardHit = await lookupBoardDeparture({
        stationName: transfer.name,
        line: transfer.line,
        depMs: transfer.depMs,
        lat: transfer.lat,
        lng: transfer.lng,
      });
      if (boardHit?.cancelled) {
        void proposeMissedAlternative(
          { lat: transfer.lat, lng: transfer.lng },
          now,
          {
            forceTransfer: true,
            preferLine: transfer.line,
            reason: 'cancelled',
          },
        );
        return;
      }
      if (boardHit) {
        if (boardHit.delaySec != null) slipDelaySec = boardHit.delaySec;
        if (Number.isFinite(boardHit.whenMs)) slipNextDep = boardHit.whenMs;
        if (boardHit.plannedWhenMs != null) {
          slipScheduled = boardHit.plannedWhenMs;
        }
      }
    } catch {
      /* soft */
    }
    const kind = classifyTransitSlip({
      nowMs: now,
      armedDepMs: transfer.depMs,
      nextDepMs: slipNextDep,
      scheduledStartMs: slipScheduled,
      delaySec: slipDelaySec,
    });
"""
if old_kind not in t:
    raise SystemExit("kind block missing after xfer patch")
t = t.replace(old_kind, simple_kind, 1)

# Update nextDep / delay references in transfer for live_delay
t = t.replace(
"""    let nextDep = transfer.depMs;
    if (kind === 'live_delay' || kind === 'missed_next') {
      nextDep = liveDep;
    }
""",
"""    let nextDep = transfer.depMs;
    if (kind === 'live_delay' || kind === 'missed_next') {
      nextDep = slipNextDep;
    }
""",
1,
)

t = t.replace(
"""      if (kind === 'live_delay' && match.delaySec != null && match.delaySec >= 180) {
        const delayMin = Math.max(3, Math.round(match.delaySec / 60));
""",
"""      if (kind === 'live_delay' && slipDelaySec != null && slipDelaySec >= 180) {
        const delayMin = Math.max(3, Math.round(slipDelaySec / 60));
""",
1,
)

t = t.replace(
"""        delaySec: match.delaySec ?? null,
""",
"""        delaySec: slipDelaySec,
""",
1,
)

# --- pollDelay: board-first cancel + slip ---
old_poll = """    const first = (fresh?.legs ?? []).find(
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
          await proposeMissedAlternative(origin, now, {
            reason: 'cancelled',
            preferLine: line,
          });
          return;
        }
      }
    } catch {
      /* soft */
    }
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
"""

new_poll = """    const first = (fresh?.legs ?? []).find(
      (l) => l.mode !== 'WALK' && l.mode !== 'BIKE',
    );
    // Trip-Tafel zuerst (Failover) — Cancel/Delay SSOT, Replan nur Ergänzung.
    const board = currentBoardTarget();
    const halt = (board.name || '').trim();
    const line = (board.line || lineLabel || '').trim();
    let boardHit: {
      whenMs: number;
      plannedWhenMs: number | null;
      delaySec: number | null;
      cancelled: boolean;
      line: string;
      platform: string | null;
    } | null = null;
    try {
      if (halt && line) {
        const { lookupBoardDeparture } = await import(
          '../transit/lookupBoardDeparture'
        );
        boardHit = await lookupBoardDeparture({
          stationName: halt,
          line,
          depMs: board.depMs ?? depMsArmed,
          lat: board.lat,
          lng: board.lng,
        });
        if (boardHit?.cancelled) {
          await proposeMissedAlternative(origin, now, {
            reason: 'cancelled',
            preferLine: line,
          });
          return;
        }
        // Falsches Gleis an Tour korrigieren.
        if (boardHit?.platform) {
          try {
            const st = useFinnusStore.getState();
            const tour = st.multiStopTour;
            const idx = tour?.currentIndex ?? 0;
            const cur = tour?.stops?.[idx];
            if (
              tour &&
              cur &&
              (cur.platform || '').trim().toLowerCase() !==
                boardHit.platform.trim().toLowerCase()
            ) {
              st.setMultiStopTour({
                ...tour,
                stops: tour.stops.map((s, i) =>
                  i === idx ? { ...s, platform: boardHit!.platform } : s,
                ),
              });
            }
          } catch {
            /* soft */
          }
        }
      }
    } catch {
      /* soft */
    }
    const planNextDep =
      fresh?.firstTransitDeparture instanceof Date
        ? fresh.firstTransitDeparture.getTime()
        : first?.startTime instanceof Date
          ? first.startTime.getTime()
          : NaN;
    const nextDep =
      boardHit != null && Number.isFinite(boardHit.whenMs)
        ? boardHit.whenMs
        : planNextDep;
    if (!Number.isFinite(nextDep) || depMsArmed == null) return;
    const scheduledMs =
      boardHit?.plannedWhenMs != null
        ? boardHit.plannedWhenMs
        : first?.scheduledStart instanceof Date
          ? first.scheduledStart.getTime()
          : null;
    const delaySec =
      boardHit?.delaySec != null
        ? boardHit.delaySec
        : first?.delaySec ?? null;
    const kind = classifyTransitSlip({
      nowMs: now,
      armedDepMs: depMsArmed,
      nextDepMs: nextDep,
      scheduledStartMs: scheduledMs,
      delaySec,
    });
    const slipMin = Math.round((nextDep - depMsArmed) / 60_000);
"""

if old_poll not in t:
    raise SystemExit("pollDelay block missing")
t = t.replace(old_poll, new_poll, 1)

# Fix delayMin to use delaySec variable
t = t.replace(
"""    const ride = (first?.line || lineLabel || 'Bahn').trim();
    const delayMin = Math.max(
      3,
      Math.round((first?.delaySec ?? slipMin * 60) / 60),
    );
""",
"""    const ride = (boardHit?.line || first?.line || lineLabel || 'Bahn').trim();
    const delayMin = Math.max(
      3,
      Math.round((delaySec ?? slipMin * 60) / 60),
    );
""",
1,
)

t = t.replace(
"""        delaySec: first?.delaySec ?? delayMin * 60,
""",
"""        delaySec: delaySec ?? delayMin * 60,
""",
1,
)

tmp = Path(r"c:\Users\larsf\Findus 2.0\.cursor\_jlb_board.ts")
tmp.write_text(t, encoding="utf-8", newline="\n")
try:
    j.unlink()
except Exception as e:
    print("unlink", e)
j.write_bytes(tmp.read_bytes())
print("jlb patched")
print("lookupBoard", t.count("lookupBoardDeparture"))
print("lookupTrain", t.count("lookupTrainDeparture"))
