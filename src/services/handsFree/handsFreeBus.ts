/**
 * Bus: Hands-free „Mikro an“ von Notification / Deep-Link / Assistent-Intent.
 */

type ListenHandler = () => void;

let handler: ListenHandler | null = null;
let pending = false;

export function registerHandsFreeListenHandler(h: ListenHandler | null): void {
  handler = h;
  if (h && pending) {
    pending = false;
    try {
      h();
    } catch {
      /* soft */
    }
  }
}

/** Sofort oder queued, bis Home/Voice bereit ist. */
export function requestHandsFreeListen(reason?: string): void {
  if (__DEV__ && reason) {
    console.log('[handsFree] listen request:', reason);
  }
  if (handler) {
    try {
      handler();
    } catch (err) {
      console.warn('[handsFree] handler failed:', err);
    }
    return;
  }
  pending = true;
}

export function hasPendingHandsFreeListen(): boolean {
  return pending;
}
