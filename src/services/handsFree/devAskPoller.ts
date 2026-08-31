/**
 * __DEV__ only: pollt lokalen Ask-Server (scripts/deviceQa/askServer.mjs)
 * via adb reverse tcp:8791 → tippt Fragen in dieselbe Pipeline wie Mic.
 */

import { requestTypedAsk } from './handsFreeBus';

const PORT = 8791;
const POLL_MS = 900;
let timer: ReturnType<typeof setInterval> | null = null;
let inFlight = false;

async function tick(): Promise<void> {
  if (inFlight) return;
  inFlight = true;
  try {
    const res = await fetch(`http://127.0.0.1:${PORT}/next`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return;
    const body = (await res.json()) as { ask?: string | null };
    const ask = typeof body?.ask === 'string' ? body.ask.trim() : '';
    if (!ask) return;
    console.log('[devAskPoller] got ask:', ask.slice(0, 80));
    requestTypedAsk(ask, 'dev-ask-server');
  } catch {
    /* server offline — silent */
  } finally {
    inFlight = false;
  }
}

export function startDevAskPoller(): void {
  // Auch Release: lokaler Ask-Server (adb reverse) für Geräte-QA — offline = silent.
  if (timer) return;
  console.log('[devAskPoller] started → :' + PORT);
  void tick();
  timer = setInterval(() => {
    void tick();
  }, POLL_MS);
}

export function stopDevAskPoller(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
