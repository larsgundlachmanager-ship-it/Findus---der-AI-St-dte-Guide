/**
 * Wenn Modul 5 den User etwas fragt: Timeline sichtbar, Mic wieder auf,
 * Short-Answers tippbar — ohne dass der laufende Turn das Mikro blockt.
 */

import { requestOpenPlanCalendar } from '../timeline/planCalendarUiStore';

export function onPlanDirectAsk(): void {
  try {
    requestOpenPlanCalendar();
  } catch {
    /* soft */
  }
  try {
    const { useFinnusStore } = require('../../store/useFinnusStore') as {
      useFinnusStore: { getState: () => { setIsGenerating: (v: boolean) => void } };
    };
    useFinnusStore.getState().setIsGenerating(false);
  } catch {
    /* soft */
  }
  void (async () => {
    try {
      const {
        isLiveChatActive,
        releaseLiveChatFloorForAsk,
      } = await import('../../services/handsFree/liveChatSession');
      if (isLiveChatActive()) {
        releaseLiveChatFloorForAsk();
        return;
      }
      const { scheduleMicAfterDirectAsk } = await import(
        '../../services/handsFree/scheduleMicAfterAsk'
      );
      scheduleMicAfterDirectAsk();
    } catch {
      /* soft */
    }
  })();
}
