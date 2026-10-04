/**
 * Gap-Plan auf Work anwenden + GPS/Research auflösen — Call-1 / Follow-through.
 */

import type { Call1WorkItem, Call1ProximityMode } from './call1TaskBrief';
import {
  detectMissionGaps,
  planFromGaps,
  applyGapPlan,
  type GapPlan,
  type MissionGap,
} from './missionGapEngine';

function resolveGpsCity(): string | null {
  try {
    const { useGpsStore } = require('../../store/useGpsStore') as {
      useGpsStore: {
        getState: () => {
          cityName?: string | null;
          city?: string | null;
          lat?: number | null;
          lng?: number | null;
        };
      };
    };
    const g = useGpsStore.getState();
    if (g.cityName) return g.cityName;
    if (g.city) return g.city;
  } catch {
    /* soft */
  }
  try {
    const { getCachedUserProfile } = require('../../services/userProfileService') as {
      getCachedUserProfile: () => { cityName?: string | null; cityId?: string | null } | null;
    };
    const p = getCachedUserProfile();
    return p?.cityName || p?.cityId || null;
  } catch {
    return null;
  }
}

export function applyMissionGapsToWork(opts: {
  userText: string;
  work: Call1WorkItem[];
  proximity?: Call1ProximityMode;
  gpsCity?: string | null;
  researchCity?: string | null;
  accessAlreadyResolved?: boolean;
  existingAnchorName?: string | null;
}): { work: Call1WorkItem[]; plan: GapPlan; gaps: MissionGap[] } {
  let work = [...opts.work];
  const gpsCity = opts.gpsCity ?? resolveGpsCity();
  const gaps = detectMissionGaps({
    userText: opts.userText,
    gpsCity,
    researchCity: opts.researchCity,
    accessAlreadyResolved: opts.accessAlreadyResolved,
    existingAnchorName: opts.existingAnchorName,
  });

  // Surprise + Essen danach ohne Dining-Task → nachlegen
  const hasSurprise = gaps.some((g) => g.kind === 'surprise_anchor');
  if (
    hasSurprise &&
    /\b(essen|restaurant|danach|abendessen|mittag)\b/iu.test(opts.userText) &&
    !work.some((w) => w.worker === 'dining' || w.worker === 'pitch')
  ) {
    work.push({
      id: 'gap_dining_after_anchor',
      worker: 'dining',
      brief: 'Nach Anchor: Essen/Restaurant vom Theater-Anker — nicht vom GPS-Heimat',
      proximity: opts.proximity || 'here_now',
      executeWhen: 'later',
      dependsOn: 'anchor_resolve',
    });
  }

  // Presence + Theater/Plan ohne Events → Events later
  const hasPresence = gaps.some((g) => g.kind === 'presence');
  if (
    hasPresence &&
    /\b(theater|vorstellung|stück|stueck|abendessen|essen|erkunden)\b/iu.test(
      opts.userText,
    ) &&
    !work.some((w) => w.worker === 'events' || w.worker === 'plan' || w.worker === 'dining')
  ) {
    if (/\b(theater|vorstellung|stück|stueck)\b/iu.test(opts.userText)) {
      work.push({
        id: 'gap_onsite_events',
        worker: 'events',
        brief: 'Vor Ort nach Anreise: Theater/Programm in Zielstadt',
        proximity: opts.proximity || 'city_best',
        executeWhen: 'later',
        dependsOn: 'access_to_dest',
      });
    }
    if (/\b(essen|abendessen|restaurant)\b/iu.test(opts.userText)) {
      work.push({
        id: 'gap_onsite_dining',
        worker: 'dining',
        brief: 'Vor Ort nach Anreise: Essen in Zielstadt',
        proximity: opts.proximity || 'city_best',
        executeWhen: 'later',
        dependsOn: hasSurprise ? 'anchor_resolve' : 'access_to_dest',
      });
    }
  }

  const plan = planFromGaps({
    gaps,
    existingWork: work,
    proximity: opts.proximity,
  });
  return {
    work: applyGapPlan(work, plan),
    plan,
    gaps,
  };
}
