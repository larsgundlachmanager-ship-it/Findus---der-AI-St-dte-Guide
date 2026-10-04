# -*- coding: utf-8 -*-
from pathlib import Path
import os

ROOT = Path(r"c:\Users\larsf\Findus 2.0")
p = ROOT / "src/components/homeMap/NativeHomeMapView.tsx"
t = p.read_text(encoding="utf-8")

old1 = """            // Follow aktiv: schon kleine Geste = Unlock (sonst kämpft GPS gegen Finger).
            const followFight =
              (locationFollowRef.current || headingFollowRef.current) &&
              Date.now() - lastProgrammaticCenterAt.current > 100 &&
              (userInteract ||
                zoomDelta >= 0.02 ||
                Math.abs(midLat - userViewCamRef.current.lat) > 0.00004 ||
                Math.abs(midLng - userViewCamRef.current.lng) > 0.00004);
            // Tippen ohne Move → Follow bleibt. Pan/Zoom → sofort Unlock.
            // Pinch oft ohne isUserInteraction → Zoom-Delta allein reicht.
            if (
              followFight ||
              (moved &&
                likelyUserExploreMotion(midLat, midLng, zoom, { userInteract }))
            ) {
              noteUserGesture();
              if (zoomDelta >= 0.05) lastUserZoomAt.current = Date.now();
            }"""

new1 = """            // Follow aktiv: schon kleine Geste = Unlock (sonst kämpft GPS gegen Finger).
            // Pan/Zoom löst nur Standort-Follow; reine Drehung nur Heading-Follow.
            const posDelta =
              Math.abs(midLat - userViewCamRef.current.lat) > 0.00004 ||
              Math.abs(midLng - userViewCamRef.current.lng) > 0.00004 ||
              zoomDelta >= 0.02;
            const followPosFight =
              locationFollowRef.current &&
              Date.now() - lastProgrammaticCenterAt.current > 100 &&
              (userInteract || posDelta);
            if (
              followPosFight ||
              (moved &&
                likelyUserExploreMotion(midLat, midLng, zoom, { userInteract }))
            ) {
              noteUserGesture('position');
              if (zoomDelta >= 0.05) lastUserZoomAt.current = Date.now();
            }"""

old2 = """            if (explore) {
              noteUserGesture();
              liveMapTurnRef.current = true;
              if (zoomDelta >= 0.05) lastUserZoomAt.current = Date.now();
              // Detached: Pan sofort in User-View — sonst holt Layer-Idle Boot-GPS.
              if (!locationFollowRef.current && vb?.[0] && vb?.[1]) {
                commitUserView({
                  lat: midLat,
                  lng: midLng,
                  zoom,
                  heading:
                    typeof bearing === 'number' && Number.isFinite(bearing)
                      ? bearing
                      : userViewCamRef.current.heading,
                });
              }
            }"""

new2 = """            if (explore) {
              const centerMovedNow = gestureMovedEnough(midLat, midLng, zoom);
              // Reine Rotation ≠ Pan: Standort-Fix bleibt, nur Heading-Follow fliegt.
              if (centerMovedNow || zoomDelta >= 0.05) {
                noteUserGesture('position');
              } else if (
                typeof bearing === 'number' &&
                Number.isFinite(bearing) &&
                Math.abs(shortestSignedBearing(displayBearingRef.current, bearing)) >
                  2.5
              ) {
                noteUserGesture('heading');
              } else {
                noteUserGesture('position');
              }
              liveMapTurnRef.current = true;
              if (zoomDelta >= 0.05) lastUserZoomAt.current = Date.now();
              // Detached: Pan sofort in User-View — sonst holt Layer-Idle Boot-GPS.
              if (!locationFollowRef.current && vb?.[0] && vb?.[1]) {
                commitUserView({
                  lat: midLat,
                  lng: midLng,
                  zoom,
                  heading:
                    typeof bearing === 'number' && Number.isFinite(bearing)
                      ? bearing
                      : userViewCamRef.current.heading,
                });
              }
            }"""

old3 = """            if (
              !fingerDown.current &&
              Math.abs(zoom - camLiveRef.current.zoom) >= 0.08 &&
              !locationFollowRef.current &&
              (userInteract || explore)
            ) {
              noteUserGesture();
              lastUserZoomAt.current = Date.now();
            }"""

new3 = """            if (
              !fingerDown.current &&
              Math.abs(zoom - camLiveRef.current.zoom) >= 0.08 &&
              !locationFollowRef.current &&
              (userInteract || explore)
            ) {
              noteUserGesture('position');
              lastUserZoomAt.current = Date.now();
            }"""

# Also fix other bare noteUserGesture() in DidChange if any unlock wrongly
# Search remaining bare calls that aren't already 'position'|'heading'

for label, old, new in [
    ("followFight", old1, new1),
    ("explore", old2, new2),
    ("pinch", old3, new3),
]:
    if old not in t:
        raise SystemExit(f"{label}: block not found")
    t = t.replace(old, new, 1)
    print(label, "OK")

tmp = p.with_suffix(".tsx.tmpwrite")
tmp.write_text(t, encoding="utf-8")
os.replace(tmp, p)
print("NativeHomeMapView patched")
