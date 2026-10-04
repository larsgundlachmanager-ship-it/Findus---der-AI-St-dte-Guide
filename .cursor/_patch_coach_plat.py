from pathlib import Path

p = Path(r"c:\Users\larsf\Findus 2.0\src\services\navigation\transitGuideCoach.ts")
t = p.read_text(encoding="utf-8")
old = """  // Fehlt Gleis am Halt → einmal Live-Tafel nachziehen (nur Belegtes).
  if (
    dHalt <= HALT_NEAR_M + 40 &&
    !(board.platform || '').trim() &&
    (board.line || '').trim() &&
    !platformLookupTried.has(tour.currentIndex) &&
    !platformLookupInflight
  ) {
    platformLookupTried.add(tour.currentIndex);
    platformLookupInflight = true;
    void (async () => {
      try {
        const { lookupPlatformForBoard } = await import(
          '../transit/enrichJourneyPlatforms'
        );
        const plat = await lookupPlatformForBoard({
          stationName: board.name,
          line: board.line ?? null,
          headsign: board.headsign ?? null,
          depMs,
          lat: board.lat,
          lng: board.lng,
        });
        if (!plat) return;
        const st = useFinnusStore.getState();
        const t = st.multiStopTour;
        if (!t?.stops?.length) return;
        const idx = t.currentIndex ?? 0;
        let boardIdx = -1;
        for (let i = idx; i >= Math.max(0, idx - 1); i -= 1) {
          const s = t.stops[i];
          if (
            s &&
            (s.role === 'walk' || s.role === 'transfer' || s.role === 'board') &&
            !(s.platform || '').trim()
          ) {
            boardIdx = i;
            break;
          }
        }
        if (boardIdx < 0) boardIdx = idx;
        const patched = t.stops.map((s, i) =>
          i === boardIdx ? { ...s, platform: plat } : s,
        );
"""
new = """  // Gleis am Halt: einmal Live-Tafel (Failover) — fehlt oder korrigiert.
  if (
    dHalt <= HALT_NEAR_M + 40 &&
    (board.line || '').trim() &&
    !platformLookupTried.has(tour.currentIndex) &&
    !platformLookupInflight
  ) {
    platformLookupTried.add(tour.currentIndex);
    platformLookupInflight = true;
    void (async () => {
      try {
        const { lookupPlatformForBoard } = await import(
          '../transit/enrichJourneyPlatforms'
        );
        const plat = await lookupPlatformForBoard({
          stationName: board.name,
          line: board.line ?? null,
          headsign: board.headsign ?? null,
          depMs,
          lat: board.lat,
          lng: board.lng,
          currentPlatform: board.platform ?? null,
        });
        if (!plat) return;
        const st = useFinnusStore.getState();
        const t = st.multiStopTour;
        if (!t?.stops?.length) return;
        const idx = t.currentIndex ?? 0;
        let boardIdx = -1;
        for (let i = idx; i >= Math.max(0, idx - 1); i -= 1) {
          const s = t.stops[i];
          if (
            s &&
            (s.role === 'walk' || s.role === 'transfer' || s.role === 'board')
          ) {
            boardIdx = i;
            break;
          }
        }
        if (boardIdx < 0) boardIdx = idx;
        const curPlat = (t.stops[boardIdx]?.platform || '').trim().toLowerCase();
        if (curPlat === plat.trim().toLowerCase()) return;
        const patched = t.stops.map((s, i) =>
          i === boardIdx ? { ...s, platform: plat } : s,
        );
"""
if old not in t:
    raise SystemExit("coach block missing")
t2 = t.replace(old, new, 1)
tmp = Path(r"c:\Users\larsf\Findus 2.0\.cursor\_coach_plat.ts")
tmp.write_text(t2, encoding="utf-8", newline="\n")
try:
    p.unlink()
except Exception as e:
    print(e)
p.write_bytes(tmp.read_bytes())
print("coach ok")
