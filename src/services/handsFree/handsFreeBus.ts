/**
 * Bus: Hands-free „Mikro an“ von Notification / Deep-Link / Assistent-Intent.
 * Plus Dev/QA: getippte Fragen via findus://ask?q=…
 * Plus UI-Choice: Locked-Mic abbrechen ohne Live-Chat.
 */

type ListenHandler = () => void;
type AskHandler = (text: string) => void;
type AbortUiHandler = (reason?: string) => void;

let handler: ListenHandler | null = null;
let pending = false;

let askHandler: AskHandler | null = null;
let pendingAsk: string | null = null;

let abortUiHandler: AbortUiHandler | null = null;

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

/** Tippen/Deep-Link → dieselbe Pipeline wie Mic/Textmodal. */
export function registerTypedAskHandler(h: AskHandler | null): void {
  askHandler = h;
  if (h && pendingAsk) {
    const text = pendingAsk;
    pendingAsk = null;
    try {
      h(text);
    } catch {
      /* soft */
    }
  }
}

export function requestTypedAsk(text: string, reason?: string): void {
  const q = (text || '').trim();
  if (!q) return;
  if (__DEV__ && reason) {
    console.log('[handsFree] typed ask:', reason, q.slice(0, 80));
  }
  if (askHandler) {
    try {
      askHandler(q);
    } catch (err) {
      console.warn('[handsFree] typed ask failed:', err);
    }
    return;
  }
  pendingAsk = q;
}

/** UI registriert: Locked-PTT / Mic-State bei Chip-Tap zurücksetzen. */
export function registerAbortHandsFreeUiHandler(h: AbortUiHandler | null): void {
  abortUiHandler = h;
}

/** Quick-Reply / Action: Locked-Mic-UI sofort idle (ohne Finalisieren). */
export function requestAbortHandsFreeUi(reason?: string): void {
  if (__DEV__ && reason) {
    console.log('[handsFree] abort ui:', reason);
  }
  if (!abortUiHandler) return;
  try {
    abortUiHandler(reason);
  } catch (err) {
    console.warn('[handsFree] abort ui failed:', err);
  }
}
