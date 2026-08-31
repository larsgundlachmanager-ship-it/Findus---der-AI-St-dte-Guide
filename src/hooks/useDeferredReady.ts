/**
 * Nach `visible` → true: ein Frame Luft, dann `ready`.
 * NIEMALS endlos auf InteractionManager warten (WebView/Map hält das oft fest).
 */

import { useEffect, useState } from 'react';
import { InteractionManager } from 'react-native';

export function useDeferredReady(
  visible: boolean,
  opts?: { maxWaitMs?: number; sticky?: boolean },
): boolean {
  const [ready, setReady] = useState(false);
  const maxWaitMs = opts?.maxWaitMs ?? 64;
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
    // Harte Obergrenze — Map/TTS dürfen Settings nicht 60s blockieren
    const timeout = setTimeout(mark, Math.max(16, maxWaitMs));
    // Optional früher, falls Idle — nie Pflicht
    const handle = InteractionManager.runAfterInteractions(mark);

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      clearTimeout(timeout);
      handle.cancel();
    };
  }, [visible, maxWaitMs, sticky]);

  return ready;
}
