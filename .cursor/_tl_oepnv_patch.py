# -*- coding: utf-8 -*-
"""Timeline/ÖPNV/drag patches. Retry writes if Windows file lock."""
from __future__ import annotations

import time
from pathlib import Path

ROOT = Path(r"c:\Users\larsf\Findus 2.0")


def write_retry(path: Path, text: str, tries: int = 8) -> None:
    last = None
    for i in range(tries):
        try:
            path.write_text(text, encoding="utf-8", newline="\n")
            print("wrote", path.relative_to(ROOT))
            return
        except OSError as e:
            last = e
            time.sleep(0.35 * (i + 1))
    raise last  # type: ignore[misc]


def patch(path: Path, pairs: list[tuple[str, str]], *, count: int | None = 1) -> None:
    text = path.read_text(encoding="utf-8")
    for old, new in pairs:
        if old not in text:
            raise SystemExit(f"MISSING in {path.name}:\n{old[:180]!r}")
        if count is None:
            text = text.replace(old, new)
        else:
            text = text.replace(old, new, count)
    write_retry(path, text)


def main() -> None:
    # --- syncLiveNavToPlan ---
    patch(
        ROOT / "src/module2/timeline/syncLiveNavToPlan.ts",
        [
            (
                """export function applyLiveNavTransport(mode: FuturePlanTransport): void {
  try {
    const { setPreferredTravelMode } = require('../../services/navigation/travelModeContext') as {
      setPreferredTravelMode: (m: 'foot' | 'bike' | 'transit' | null) => void;
    };
    if (mode === 'bike') setPreferredTravelMode('bike');
    else if (mode === 'transit') setPreferredTravelMode('transit');
    else if (mode === 'walk') setPreferredTravelMode('foot');
  } catch {
    /* soft */
  }

  lastTransport = mode;
  lastSyncAtMs = 0;
  upsertLiveNavFromStore({ force: true });
}""",
                """export function applyLiveNavTransport(mode: FuturePlanTransport): void {
  try {
    const { setPreferredTravelMode } = require('../../services/navigation/travelModeContext') as {
      setPreferredTravelMode: (m: 'foot' | 'bike' | 'transit' | null) => void;
    };
    if (mode === 'bike') setPreferredTravelMode('bike');
    else if (mode === 'transit') setPreferredTravelMode('transit');
    else if (mode === 'walk') setPreferredTravelMode('foot');
  } catch {
    /* soft */
  }

  lastTransport = mode;
  lastSyncAtMs = 0;
  upsertLiveNavFromStore({ force: true });

  void (async () => {
    try {
      const { getActiveNavDestination } = require('../../services/navigation/navigationService') as {
        getActiveNavDestination: () => {
          name: string;
          lat: number;
          lng: number;
        } | null;
      };
      let dest = getActiveNavDestination();
      if (!dest || !Number.isFinite(dest.lat) || !Number.isFinite(dest.lng)) {
        const tour = useFinnusStore.getState().multiStopTour;
        const upcoming = (tour?.stops ?? []).filter((s) => !s.done);
        const last =
          [...upcoming].reverse().find((s) => s.role === 'dest') ??
          upcoming[upcoming.length - 1];
        if (last) dest = { name: last.name, lat: last.lat, lng: last.lng };
      }
      if (!dest) return;
      const { startPitchNavigation } = require('../../module2/pitch/pitchStartNav') as {
        startPitchNavigation: (
          t: { name: string; lat: number; lng: number },
          i?: {
            preferWalk?: boolean;
            preferTransit?: boolean;
            preferBike?: boolean;
          },
        ) => Promise<{ ok: boolean }>;
      };
      const intent =
        mode === 'transit'
          ? { preferTransit: true }
          : mode === 'bike'
            ? { preferBike: true }
            : { preferWalk: true };
      await startPitchNavigation(
        { name: dest.name, lat: dest.lat, lng: dest.lng },
        intent,
      );
      lastSyncAtMs = 0;
      upsertLiveNavFromStore({ force: true });
    } catch {
      /* soft — Label ist schon gesetzt */
    }
  })();
}""",
            )
        ],
    )

    # --- homeMapNavStart: no duplicate plan stop ---
    patch(
        ROOT / "src/services/homeMap/homeMapNavStart.ts",
        [
            (
                """        const { appendTourStop } = await import('../navigation/multiStopTour');
        const { addPlanStop } = await import(
          '../../module2/timeline/planLiveEdits'
        );
        const added = await appendTourStop(""",
                """        const { appendTourStop } = await import('../navigation/multiStopTour');
        const added = await appendTourStop(""",
            ),
            (
                """        if (added) {
          try {
            addPlanStop({
              title: dest.name,
              lat: dest.lat,
              lng: dest.lng,
              kind: 'stop',
            });
          } catch {
            /* soft */
          }
          notifyNavRouteGeometryChanged();""",
                """        if (added) {
          notifyNavRouteGeometryChanged();""",
            ),
        ],
    )

    print("batch1 ok")


if __name__ == "__main__":
    main()
