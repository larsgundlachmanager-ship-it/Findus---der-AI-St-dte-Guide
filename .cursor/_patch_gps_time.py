from pathlib import Path

# --- navigationService ---
p = Path(r"c:\Users\larsf\Findus 2.0\src\services\navigation\navigationService.ts")
t = p.read_text(encoding="utf-8")
old = """  const alightTarget =
    tourStop?.role === 'alight'
      ? { lat: tourStop.lat, lng: tourStop.lng }
      : routeHasTransitLegs && active
        ? { lat: active.lat, lng: active.lng }
        : null;
  const navPhase = tickBoardingDetector({
    lat,
    lng,
    transportMode,
    speedMs: getSmoothedSpeedMs(),
    stations: stations.map((s) => ({
      lat: s.lat,
      lng: s.lng,
      name: s.stationName,
    })),
    remainingStations,
    hasTransitLegs: routeHasTransitLegs || stations.length > 0,
    alightLat: alightTarget?.lat ?? null,
    alightLng: alightTarget?.lng ?? null,
  });
"""
new = """  const alightTarget =
    tourStop?.role === 'alight'
      ? { lat: tourStop.lat, lng: tourStop.lng }
      : routeHasTransitLegs && active
        ? { lat: active.lat, lng: active.lng }
        : null;
  const tourStops = (() => {
    try {
      return useFinnusStore.getState().multiStopTour?.stops ?? [];
    } catch {
      return [];
    }
  })();
  const boardSched =
    tourStop?.role === 'alight' || tourStop?.role === 'board'
      ? tourStop.vehicleStartMs
      : tourStops.find((s) => s.role === 'board' || s.vehicleStartMs != null)
          ?.vehicleStartMs ?? null;
  const alightSched =
    tourStop?.role === 'alight'
      ? tourStop.endMs
      : tourStops.find((s) => s.role === 'alight')?.endMs ?? null;
  let gpsAccuracyM: number | null = null;
  let gpsAtMs: number | null = null;
  try {
    const { useGpsStore } = require('../../store/useGpsStore') as {
      useGpsStore: {
        getState: () => { accuracyM: number | null; atMs: number | null };
      };
    };
    const gps = useGpsStore.getState();
    gpsAccuracyM = gps.accuracyM;
    gpsAtMs = gps.atMs;
  } catch {
    /* soft */
  }
  const navPhase = tickBoardingDetector({
    lat,
    lng,
    transportMode,
    speedMs: getSmoothedSpeedMs(),
    stations: stations.map((s) => ({
      lat: s.lat,
      lng: s.lng,
      name: s.stationName,
    })),
    remainingStations,
    hasTransitLegs: routeHasTransitLegs || stations.length > 0,
    alightLat: alightTarget?.lat ?? null,
    alightLng: alightTarget?.lng ?? null,
    gpsAccuracyM,
    gpsAtMs,
    scheduledBoardMs: boardSched ?? null,
    scheduledAlightMs: alightSched ?? null,
  });
"""
if old not in t:
    raise SystemExit("nav block missing")
t2 = t.replace(old, new, 1)
tmp = Path(r"c:\Users\larsf\Findus 2.0\.cursor\_nav_gps.ts")
tmp.write_text(t2, encoding="utf-8", newline="\n")
try:
    p.unlink()
except Exception as e:
    print("unlink nav", e)
p.write_bytes(tmp.read_bytes())
print("nav ok", "scheduledAlightMs" in p.read_text(encoding="utf-8"))

# --- journeyLeaveBy ---
j = Path(r"c:\Users\larsf\Findus 2.0\src\services\navigation\journeyLeaveBy.ts")
jt = j.read_text(encoding="utf-8")
old_imp = "import { getNavPhase } from './boardingDetector';"
new_imp = "import { getNavPhase, isGpsUnreliable } from './boardingDetector';"
if old_imp not in jt:
    raise SystemExit("import missing")
jt2 = jt.replace(old_imp, new_imp, 1)
oldp = """    const pace = assessLiveJourneyPace({
      nowMs: now,
      depMs,
      distanceM: distM,
      bufferMin,
      paceMPerMin: planWalkMPerMin(),
      nextDepMs: nextDepHintMs,
      line: board.line,
      nextLine: nextLineHint || board.line,
    });
"""
newp = """    const gpsUnreliable = isGpsUnreliable({
      accuracyM: gps.accuracyM,
      gpsAtMs: gps.atMs,
      nowMs: now,
    });
    const pace = assessLiveJourneyPace({
      nowMs: now,
      depMs,
      distanceM: distM,
      bufferMin,
      paceMPerMin: planWalkMPerMin(),
      nextDepMs: nextDepHintMs,
      line: board.line,
      nextLine: nextLineHint || board.line,
      gpsUnreliable,
    });
"""
if oldp not in jt2:
    raise SystemExit("pace call missing")
jt2 = jt2.replace(oldp, newp, 1)
olds = """  const atHalt =
    board.lat !== 0 &&
    haversineMeters(origin.lat, origin.lng, board.lat, board.lng) < 80;
  if (atHalt) return;
"""
news = """  const gpsUnreliable = isGpsUnreliable({
    accuracyM: useGpsStore.getState().accuracyM,
    gpsAtMs: useGpsStore.getState().atMs,
    nowMs: now,
  });
  // Bei schlechtem GPS keine Distanz-am-Halt-Annahme — Zeit entscheidet.
  const atHalt =
    !gpsUnreliable &&
    board.lat !== 0 &&
    haversineMeters(origin.lat, origin.lng, board.lat, board.lng) < 80;
  if (atHalt) return;
"""
if olds not in jt2:
    raise SystemExit("atHalt missing")
jt2 = jt2.replace(olds, news, 1)
tmpj = Path(r"c:\Users\larsf\Findus 2.0\.cursor\_jlb_gps.ts")
tmpj.write_text(jt2, encoding="utf-8", newline="\n")
try:
    j.unlink()
except Exception as e:
    print("unlink jlb", e)
j.write_bytes(tmpj.read_bytes())
print("jlb ok", "gpsUnreliable" in j.read_text(encoding="utf-8"))
