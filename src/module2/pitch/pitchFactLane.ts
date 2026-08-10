/**
 * Fact-Lane / Gastro-Handoff → Auswahl-Pitch (v4).
 * Kein Legacy-Dual-Option / keine Medaillen-Speech aus dem Gastro-Agent.
 */

import type { AgentResult } from '../types';
import { usePlanCalendarUiStore } from '../timeline/planCalendarUiStore';
import { buildPitchRequestFromText } from './buildPitchRequest';
import { runPitchModule } from './runPitchModule';

export async function researchPitchAsAgentResult(opts: {
  userText: string;
  requestId?: string;
  signal?: AbortSignal;
  uiLayout?: 'live_split' | 'timeline_stack';
}): Promise<AgentResult> {
  const calendarOpen = usePlanCalendarUiStore.getState().calendarVisible;
  const { request } = buildPitchRequestFromText({
    text: opts.userText,
    requestId: opts.requestId ?? `pitch_lane_${Date.now()}`,
    uiLayout:
      opts.uiLayout ?? (calendarOpen ? 'timeline_stack' : 'live_split'),
    signal: opts.signal,
  });
  // Parent/Manager-Bridge bereits gesprochen — Pitch spricht nur die Auswahl.
  request.bridgeAlreadySpoken = true;

  const result = await runPitchModule(request);
  const placeName = result.options[0]?.name ?? null;
  if (placeName) {
    try {
      const { setLastPlaceName } = await import('../context/shortTermContext');
      setLastPlaceName(placeName);
    } catch {
      /* soft */
    }
  }

  return {
    agent: 'gastro',
    ok: true,
    draftText: result.spokenText,
    bullets: result.options.flatMap((o) => o.bullets).slice(0, 6),
    buttons: [],
    meta: {
      pitchModule: true,
      softFail: result.softFail,
      placeName,
      venues: result.options.map((o) => ({
        name: o.name,
        lat: o.lat,
        lng: o.lng,
        menuUrl: o.menuUrl ?? null,
      })),
    },
  };
}
