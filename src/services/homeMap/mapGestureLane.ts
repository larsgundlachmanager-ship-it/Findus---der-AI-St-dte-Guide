/**
 * Gesture-Lane: während User Pan/Zoom/Drehen kein Extract/Places/Cities-Push.
 * Host registriert Probe (userMapGestureRef); Native kann parallel fingerDown nutzen.
 */

let gestureProbe: (() => boolean) | null = null;

export function registerMapGestureProbe(probe: () => boolean): () => void {
  gestureProbe = probe;
  return () => {
    if (gestureProbe === probe) gestureProbe = null;
  };
}

export function isMapUserGesturing(): boolean {
  return gestureProbe?.() ?? false;
}
