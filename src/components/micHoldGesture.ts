/**
 * Mic-Hold-Wisch: rechts = Feststelltaste, links = Live-Chat.
 * Schwellen bewusst niedrig + diagonal tolerant (WhatsApp-Lock).
 */

export const LOCK_SWIPE_RIGHT_PX = 40;
export const LIVE_SWIPE_LEFT_PX = -40;
export const LOCK_SWIPE_RELEASE_PX = 32;

export type MicHoldSwipe = 'lock' | 'live';

function mostlyHorizontal(dx: number, dy: number): boolean {
  const horiz = Math.abs(dx);
  const vert = Math.abs(dy);
  if (horiz < 20) return false;
  return vert <= horiz * 1.35;
}

export function resolveMicHoldSwipe(
  dx: number,
  dy: number,
): MicHoldSwipe | null {
  if (!mostlyHorizontal(dx, dy)) return null;
  if (dx >= LOCK_SWIPE_RIGHT_PX) return 'lock';
  if (dx <= LIVE_SWIPE_LEFT_PX) return 'live';
  return null;
}

/** Beim Loslassen: etwas kürzerer Weg reicht, wenn die Richtung klar ist. */
export function resolveMicHoldSwipeOnRelease(
  dx: number,
  dy: number,
): MicHoldSwipe | null {
  if (!mostlyHorizontal(dx, dy)) return null;
  if (dx >= LOCK_SWIPE_RELEASE_PX) return 'lock';
  if (dx <= -LOCK_SWIPE_RELEASE_PX) return 'live';
  return null;
}
