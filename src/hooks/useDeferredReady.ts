/**
 * Nach `visible` → true: ein Frame Luft, dann `ready`.
 * NIEMALS auf InteractionManager warten (WebView/Map hält das oft fest) —
 * nur rAF + harte maxWaitMs-Obergrenze.
 */

import { useEffect, useState } from 'react';

export function useDeferredReady(
  visible: boolean,
  opts?: { maxWaitMs?: number; sticky?: boolean },
): boolean {
  const [ready, setReady] = useState(false);
  const maxWaitMs = opts?.maxWaitMs ?? 48;
  const sticky = opts?.sticky === true;

  useEffect(() => {
    if (!visible) {
      if (!sticky) setReady(false);
      return;
    }
    let cancelled = false;
    const mark = () => {
      if (!cancelled) setReady(true);
    };

    // Ein Frame → Chrome sichtbar, dann Inhalt
    const raf = requestAnimationFrame(mark);
    // Harte Obergrenze — Map/TTS dürfen Settings/Timeline nicht blockieren
    const timeout = setTimeout(mark, Math.max(16, maxWaitMs));

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      clearTimeout(timeout);
    };
  }, [visible, maxWaitMs, sticky]);

  return ready;
}
