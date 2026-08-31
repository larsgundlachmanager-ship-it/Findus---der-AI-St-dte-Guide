/**
 * Think-Ahead-Enums → Code, kein zweites LLM.
 */

import type { ThinkAheadHint } from '../types';
import type { ThinkAheadId } from './orchestrateSlots';

export type RainVsOutdoor = 'indoor' | 'outdoor' | 'unknown';

export type ThinkAheadResult = {
  taxiPref: 'uber_first' | null;
  reverseFromDeparture: boolean;
  rainVsOutdoor: RainVsOutdoor;
  hotelIfGap: boolean;
  sunsetAnchor: boolean;
  eveningFirstPitch: boolean;
  twoOptionsOwnVsRent: boolean;
};

export function rainVsOutdoorFromWeather(summary: string | null | undefined): RainVsOutdoor {
  const s = (summary || '').toLowerCase();
  if (!s.trim()) return 'unknown';
  if (/\b(regen|schauer|gewitter|storm|rain|shower)\b/i.test(s)) return 'indoor';
  if (/\b(sonne|klar|heiter|trocken|sun)\b/i.test(s)) return 'outdoor';
  return 'unknown';
}

export function runThinkAheadCode(
  ids: ThinkAheadId[],
  ctx?: { weatherSummary?: string | null },
): ThinkAheadResult {
  const has = (id: ThinkAheadId) => ids.includes(id);
  return {
    taxiPref: has('taxi_pref') ? 'uber_first' : null,
    reverseFromDeparture: has('reverse_from_departure'),
    rainVsOutdoor: has('rain_vs_outdoor')
      ? rainVsOutdoorFromWeather(ctx?.weatherSummary)
      : 'unknown',
    hotelIfGap: has('hotel_if_gap'),
    sunsetAnchor: has('sunset_anchor'),
    eveningFirstPitch: has('evening_first_pitch'),
    twoOptionsOwnVsRent: has('two_options_own_vs_rent'),
  };
}

/** Map auf bestehende Fact-Lane-Hints (kein neues Call-1-Feld). */
export function thinkAheadToLaneHints(ids: ThinkAheadId[]): ThinkAheadHint[] {
  const out: ThinkAheadHint[] = [];
  const add = (h: ThinkAheadHint) => {
    if (!out.includes(h)) out.push(h);
  };
  for (const id of ids) {
    switch (id) {
      case 'taxi_pref':
        add('mobility_mode');
        break;
      case 'reverse_from_departure':
        add('parking_leave_by');
        break;
      case 'rain_vs_outdoor':
        add('outfit_from_plan_and_weather');
        break;
      case 'hotel_if_gap':
        add('booking_deeplink_prefill');
        break;
      case 'sunset_anchor':
      case 'two_options_own_vs_rent':
        add('combo_cluster');
        break;
      case 'evening_first_pitch':
        add('menu_links_required');
        break;
      default:
        break;
    }
  }
  return out;
}
