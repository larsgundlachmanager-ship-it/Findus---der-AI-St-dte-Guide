/**
 * Pitch Fact-Lane / Gastro-Handoff → Auswahl-Pitch (v4).
 * Call-1 Stadt/Kriterien/When durchreichen — kein Sticky-Heimat-Leak.
 */

import type { AgentResult } from '../types';
import { usePlanCalendarUiStore } from '../timeline/planCalendarUiStore';
import { buildPitchRequestFromText } from './buildPitchRequest';
import { runPitchModule } from './runPitchModule';
import type { Call1Criterion } from './call1Criteria';
import type { TurnWhen } from '../router/turnFrame';

export async function researchPitchAsAgentResult(opts: {
  userText: string;
  requestId?: string;
  signal?: AbortSignal;
  uiLayout?: 'live_split' | 'timeline_stack';
  /** Call-1 researchCity / destCity */
  call1DestCity?: string | null;
  call1MustHaves?: string[] | null;
  call1Criteria?: Call1Criterion[] | null;
  call1When?: TurnWhen[] | null;
  authorIntent?: string | null;
  /** city_best / here_now / … — soft hint */
  proximityHint?: 'urgent_near' | 'here_now' | 'city_best' | 'later_free' | null;
}): Promise<AgentResult> {
  const calendarOpen = usePlanCalendarUiStore.getState().calendarVisible;
  const { request } = buildPitchRequestFromText({
    text: opts.userText,
    requestId: opts.requestId ?? `pitch_lane_${Date.now()}`,
    uiLayout:
      opts.uiLayout ?? (calendarOpen ? 'timeline_stack' : 'live_split'),
    signal: opts.signal,
    call1DestCity: opts.call1DestCity ?? null,
    call1MustHaves: opts.call1MustHaves ?? null,
    call1Criteria: opts.call1Criteria ?? null,
    call1When: opts.call1When ?? null,
    authorIntent: opts.authorIntent ?? null,
  });
  // Parent/Manager-Bridge bereits gesprochen — Pitch spricht nur die Auswahl.
  request.bridgeAlreadySpoken = true;
  if (
    opts.proximityHint === 'city_best' ||
    opts.proximityHint === 'later_free'
  ) {
    request.searchMode = 'city_best';
  } else if (opts.proximityHint === 'urgent_near') {
    request.searchMode = 'here_now';
  }

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
