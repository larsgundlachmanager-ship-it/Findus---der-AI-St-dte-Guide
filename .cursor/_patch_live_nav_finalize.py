# -*- coding: utf-8 -*-
from __future__ import annotations
import os, shutil, time
from pathlib import Path

ROOT = Path(r"c:\Users\larsf\Findus 2.0")


def force_write(path: Path, content: str) -> None:
    path = Path(path)
    tmp = path.with_suffix(path.suffix + f".tmp{os.getpid()}")
    bak = path.with_suffix(path.suffix + ".bak_fin")
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
            print(f"OK {path.name}")
            return
        except OSError as e:
            print(f"retry {e}")
            time.sleep(0.3)
    raise SystemExit("fail")


def patch(rel: str, old: str, new: str, *, already: str | None = None) -> None:
    p = ROOT / rel
    t = p.read_text(encoding="utf-8")
    if already and already in t and old not in t:
        print(f"SKIP {rel}")
        return
    if old not in t:
        print(f"MISS {rel}")
        print(old[:160])
        return
    force_write(p, t.replace(old, new, 1))


patch(
    "src/services/navigation/tourAheadRouteCache.ts",
    """    if (seeded && seeded.length >= 3) {
      cache.set(key, seeded);
      continue;
    }""",
    """    if (seeded && seeded.length >= 2) {
      cache.set(key, seeded);
      continue;
    }""",
    already="seeded.length >= 2",
)

# Wire catch-up from navigation tick (leave-watch may be idle mid-ride)
patch(
    "src/services/navigation/navigationService.ts",
    """  // Ausstieg erkannt (Dwell/Stillstand) → sofort Fuß zum Bus/Transfer, ohne auf Ankunftsradius zu warten.
  if (takeAlightAdvancePending() && !arrivalInFlight) {""",
    """  // Stale Tour: GPS schon am Folgestopp → vorziehen.
  if (!arrivalInFlight) {
    try {
      const { maybeCatchUpTourProgress } = require('./multiStopTour') as {
        maybeCatchUpTourProgress: (o?: {
          lat?: number | null;
          lng?: number | null;
        }) => Promise<boolean>;
      };
      void maybeCatchUpTourProgress({ lat: lastLat, lng: lastLng });
    } catch {
      /* soft */
    }
  }
  // Ausstieg erkannt (Dwell/Stillstand) → sofort Fuß zum Bus/Transfer, ohne auf Ankunftsradius zu warten.
  if (takeAlightAdvancePending() && !arrivalInFlight) {""",
    already="maybeCatchUpTourProgress({ lat: lastLat",
)

# Smoke: transit stations preferred
patch(
    "src/services/navigation/navRouteMapPayload.smoke.test.ts",
    """assert(
  payloadSrc.includes('currentIsTransit') &&
    (payloadSrc.includes("curRole === 'alight' || curRole === 'board'") ||
      payloadSrc.includes("curRoleEarly === 'alight' || curRoleEarly === 'board'")),
  'ÖPNV zeichnet Bahn-/Board-Pfad, nicht die alte Fußroute',
);""",
    """assert(
  payloadSrc.includes('currentIsTransit') &&
    (payloadSrc.includes("curRole === 'alight' || curRole === 'board'") ||
      payloadSrc.includes("curRoleEarly === 'alight' || curRoleEarly === 'board'")),
  'ÖPNV zeichnet Bahn-/Board-Pfad, nicht die alte Fußroute',
);
assert(
  payloadSrc.includes('Stationskette / Journey-Leg') ||
    payloadSrc.includes('ÖPNV: Stationskette'),
  'Transit-Geometrie = Stationskette, nicht Fuß-OSRM',
);
assert(
  readFileSync(
    join(process.cwd(), 'src/services/navigation/tourAheadRouteCache.ts'),
    'utf8',
  ).includes('Stationskette schlägt Fuß-OSRM'),
  'Ahead-Cache: Stationskette vor Fuß-OSRM',
);""",
    already="Transit-Geometrie = Stationskette",
)

# Smoke: heading + puck
patch(
    "src/components/homeMap/nativeHomeMap.smoke.test.ts",
    """assert(view.includes('gpsLockCenterRef'), 'Lock-Center Ref steuert ShapeSource aus');""",
    """assert(view.includes('gpsLockCenterRef'), 'Lock-Center Ref steuert ShapeSource aus');
assert(
  view.includes('Heading-Follow: um GPS drehen') ||
    view.includes('Sofort GPS als Drehzentrum'),
  'Heading-up pinnt GPS-Center',
);
assert(
  view.includes('nie Kamera-Center') ||
    view.includes('gpsLockCenter && props.locationFollow'),
  'Pan: Puck geo-fix / Lock nur bei Follow',
);""",
    already="Heading-up pinnt GPS-Center",
)

# Smoke: entgegen + catch-up
patch(
    "src/module2/timeline/liveTourSchedule.smoke.test.ts",
    """console.log('liveTourSchedule.smoke.test.ts OK');""",
    """// Chronologie: Ausstieg vor Ziel (geplante Zeiten)
const orderCheck = buildLiveTourSchedule({
  upcoming: [
    {
      name: 'Bahnhof Pinneberg',
      lat: 53.654,
      lng: 9.796,
      role: 'alight',
      line: 'RB61',
      startMs: depRb,
      endMs: arrRb,
    },
    {
      name: 'Ulmenallee 23',
      lat: 53.641,
      lng: 9.812,
      role: 'dest',
      // absichtlich zu früh — darf Timeline nicht vor Ausstieg sortieren
      startMs: nowPin,
      endMs: nowPin + 60_000,
      durationSec: 240,
    },
  ],
  nowMs: nowPin,
  transport: 'walk',
  origin: { lat: 53.655, lng: 9.797 },
  liveDistanceM: 100,
  liveEtaMin: 2,
  destName: 'Ulmenallee 23',
});
const oStops = orderCheck.filter((r) => r.kind === 'stop');
assert(oStops.length === 2, '2 Stops');
assert(
  (oStops[0]!.plannedStartMs ?? 0) <= (oStops[1]!.plannedStartMs ?? 0),
  'Ausstieg nicht nach Ziel sortiert',
);
assert(/Pinneberg/i.test(oStops[0]!.title ?? ''), 'erster Stop = Ausstieg');

console.log('liveTourSchedule.smoke.test.ts OK');""",
    already="Ausstieg nicht nach Ziel sortiert",
)

# multiStopTour smoke-ish via reading if there's a smoke — add assert to syncLiveNav smoke
p = ROOT / "src/module2/timeline/syncLiveNavToPlan.smoke.test.ts"
t = p.read_text(encoding="utf-8")
if "maybeCatchUpTourProgress" not in t:
    t = t.replace(
        "console.log('liveTourSchedule.smoke.test.ts OK');",
        """const tourSrc = readFileSync(
  join(process.cwd(), 'src/services/navigation/multiStopTour.ts'),
  'utf8',
);
assert(tourSrc.includes('maybeCatchUpTourProgress'), 'stale progress catch-up');
assert(tourSrc.includes('entgegen der Fahrtrichtung'), 'Fuß entgegen Fahrtrichtung');
assert(tourSrc.includes('clearLiveNavFromPlan'), 'Tour-Ende räumt Live-ÖPNV');
console.log('syncLiveNavToPlan.smoke.test.ts OK');
""".replace("console.log('syncLiveNavToPlan.smoke.test.ts OK');", "")
        + "console.log('syncLiveNavToPlan.smoke.test.ts OK');\n",
    )
    # file ends with different log line
    if "console.log('syncLiveNavToPlan.smoke.test.ts OK')" in p.read_text(encoding="utf-8"):
        pass

# Fix sync smoke properly
t = p.read_text(encoding="utf-8")
if "maybeCatchUpTourProgress" not in t:
    if "from 'node:fs'" not in t and "readFileSync" not in t:
        t = "import { readFileSync } from 'node:fs';\nimport { join } from 'node:path';\n" + t
    old_end = "console.log('syncLiveNavToPlan.smoke.test.ts OK');"
    if old_end not in t:
        # find actual end
        print("end markers:", [ln for ln in t.splitlines() if "console.log" in ln][-3:])
    else:
        force_write(
            p,
            t.replace(
                old_end,
                """{
  const tourSrc = readFileSync(
    join(process.cwd(), 'src/services/navigation/multiStopTour.ts'),
    'utf8',
  );
  assert(tourSrc.includes('maybeCatchUpTourProgress'), 'stale progress catch-up');
  assert(tourSrc.includes('entgegen der Fahrtrichtung'), 'Fuß entgegen Fahrtrichtung');
  assert(tourSrc.includes('clearLiveNavFromPlan'), 'Tour-Ende räumt Live-ÖPNV');
}
console.log('syncLiveNavToPlan.smoke.test.ts OK');""",
                1,
            ),
        )

print("finalize done")
