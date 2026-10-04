from pathlib import Path
import os
import time
import shutil

def force_write(path: Path, content: str) -> None:
    path = Path(path)
    tmp = path.with_suffix(path.suffix + f".tmp{os.getpid()}")
    bak = path.with_suffix(path.suffix + ".bak_p0")
    tmp.write_text(content, encoding="utf-8")
    for i in range(8):
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
                    # fallback: copy then overwrite
                    shutil.copy2(path, bak)
                    path.unlink(missing_ok=True)
            os.replace(tmp, path)
            print(f"OK {path.name}")
            try:
                if bak.exists():
                    bak.unlink()
            except OSError:
                pass
            return
        except OSError as e:
            print(f"retry {i+1}: {e}")
            time.sleep(0.4)
    raise SystemExit(f"FAILED {path}")

# mapSceneController
p = Path(r"c:\Users\larsf\Findus 2.0\src\services\homeMap\mapSceneController.ts")
t = p.read_text(encoding="utf-8")
old = """  unsubNav = useFinnusStore.subscribe((s, prev) => {
    if (s.navActive === prev.navActive) return;
    if (s.navActive) startNavSyncTimer();
    else {
      stopNavSyncTimer();
      lastNavRouteJson = 'null';
      useMapRouteStore.getState().setRoute(null);
    }
  });"""
new = """  unsubNav = useFinnusStore.subscribe((s, prev) => {
    if (s.navActive === prev.navActive) return;
    if (s.navActive) startNavSyncTimer();
    else {
      stopNavSyncTimer();
      // Tour-Leg-Handoff (ÖPNV→Fuß): kurz navActive=false — Linie behalten.
      const tourOpen = (useFinnusStore.getState().multiStopTour?.stops ?? []).some(
        (st) => !st.done,
      );
      if (!tourOpen) {
        lastNavRouteJson = 'null';
        useMapRouteStore.getState().setRoute(null);
      }
    }
  });"""
if old not in t:
    raise SystemExit("mapSceneController: old block not found")
force_write(p, t.replace(old, new, 1))

# journeyTourStops
p2 = Path(r"c:\Users\larsf\Findus 2.0\src\services\navigation\journeyTourStops.ts")
t2 = p2.read_text(encoding="utf-8")
old2 = """  const last = head[head.length - 1];
  if (
    last &&
    Math.abs(last.lat - dest.lat) < 1e-4 &&
    Math.abs(last.lng - dest.lng) < 1e-4
  ) {
    last.role = 'dest';
    last.name = dest.name;
    return foldTinyTransfers(head);
  }
  return foldTinyTransfers([...head, destStop]);
}"""
new2 = """  const last = head[head.length - 1];
  // Nur kollabieren wenn wirklich derselbe Punkt UND kein eigener Fußweg.
  // Sonst verschluckt der Alight den letzten Walk → Fuß nach ÖPNV stirbt.
  const walkPathLen = walkToDest?.path?.length ?? 0;
  const nearSame =
    last &&
    Math.abs(last.lat - dest.lat) < 1e-4 &&
    Math.abs(last.lng - dest.lng) < 1e-4;
  if (nearSame && walkPathLen < 3) {
    last.role = 'dest';
    last.name = dest.name;
    return foldTinyTransfers(head);
  }
  return foldTinyTransfers([...head, destStop]);
}"""
if old2 not in t2:
    raise SystemExit("journeyTourStops: old block not found")
force_write(p2, t2.replace(old2, new2, 1))
