# -*- coding: utf-8 -*-
from pathlib import Path

p = Path(r"c:\Users\larsf\Findus 2.0\src\services\navigation\transitGuideCoach.ts")
t = p.read_text(encoding="utf-8")
old = """        if (!plat) return;
        const st = useFinnusStore.getState();
        const t = st.multiStopTour;
        if (!t?.stops?.length) return;
        const idx = t.currentIndex ?? 0;
        const stops = t.stops.map((s, i) =>
          i === idx || (s.role === board.role && s.name === board.name)
            ? { ...s, platform: plat }
            : s,
        );
        // Nur den Board-Stop patchen (current oder matching boardish).
        const boardIdx = stops.findIndex(
          (s, i) =>
            i >= Math.max(0, idx - 1) &&
            (s.role === 'walk' || s.role === 'transfer' || s.role === 'board') &&
            (s.line || '') === (board.line || '') &&
            !(s.platform || '').trim(),
        );
        const patched =
          boardIdx >= 0
            ? stops.map((s, i) => (i === boardIdx ? { ...s, platform: plat } : s))
            : t.stops.map((s, i) =>
                i === idx ? { ...s, platform: plat } : s,
              );
        st.setMultiStopTour({ ...t, stops: patched });
"""
new = """        if (!plat) return;
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
        st.setMultiStopTour({ ...t, stops: patched });
"""
if old not in t:
    raise SystemExit('block not found')
t = t.replace(old, new, 1)
tmp = Path(r"c:\Users\larsf\Findus 2.0\.cursor\_coach_plat.ts")
tmp.write_text(t, encoding="utf-8", newline="\n")
print('ok', tmp.stat().st_size)
