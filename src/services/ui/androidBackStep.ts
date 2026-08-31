/**
 * Android-Zurück: ein Schritt pro Geste (Edge-Wisch + System-Back nicht doppelt).
 */

let lastBackAtMs = 0;

/** true = dieser Back darf eine Aktion auslösen; false = Doppel-Event ignorieren. */
export function claimAndroidBackStep(minGapMs = 420): boolean {
  const now = Date.now();
  if (now - lastBackAtMs < minGapMs) return false;
  lastBackAtMs = now;
  return true;
}

export function resetAndroidBackStep(): void {
  lastBackAtMs = 0;
}
