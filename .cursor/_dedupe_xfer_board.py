from pathlib import Path

j = Path(r"c:\Users\larsf\Findus 2.0\src\services\navigation\journeyLeaveBy.ts")
t = j.read_text(encoding="utf-8")
old = """  try {
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
"""
new = """  try {
    const { planTransitHandsFree } = await import('./handsFreeNav/transitBridge');
"""
if old not in t:
    raise SystemExit("dup block missing")
t = t.replace(old, new, 1)
tmp = Path(r"c:\Users\larsf\Findus 2.0\.cursor\_jlb_dedupe.ts")
tmp.write_text(t, encoding="utf-8", newline="\n")
try:
    j.unlink()
except Exception as e:
    print(e)
j.write_bytes(tmp.read_bytes())
print("deduped", t.count("lookupBoardDeparture"))
