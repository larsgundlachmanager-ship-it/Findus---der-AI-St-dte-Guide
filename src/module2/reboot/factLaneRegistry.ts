/**
 * Fact-Lanes — stilfreie Faktenbeschaffung (Pack/OSM/Places).
 * Kein LLM in den Lanes außer bewusstem Fallback-Agent.
 */

import type { FindusJobId } from '../jobs/types';
import type { AgentResult } from '../types';
import type { RucksackState } from '../rucksack/rucksackStore';
import { anchorCoords } from '../rucksack/rucksackStore';
import {
  detectAmenityKind,
  researchAmenityNav,
} from '../agents/amenityNavFacts';
import {
  isComboClusterQuery,
  researchComboCluster,
} from '../agents/comboClusterFacts';
import {
  isMoreHistoryUtterance,
  researchPackMatchStory,
} from './packMatchFacts';
import {
  isParkingCareUtterance,
  researchParkingCare,
} from './parkingFactLane';
import type { ThinkAheadHint } from './types';
import { agentForIntent } from '../agents/registry';
import type { AgentIntent, PipelineTask } from '../types';
import { wantsHandsFreeSetup } from '../../services/handsFree/handsFreeSetupAdvisor';
import {
  wantsLiveChatVoiceCommand,
  wantsStopLiveChatVoiceCommand,
} from '../../services/handsFree/liveChatSession';
import { isDeicticPoiQuestion } from '../../services/intent/poiInfoVsNav';
import { REBOOT_MAX_PARALLEL_FACT_JOBS } from './contracts';
import { isHourTourQuery, researchHourTour } from './hourTourFacts';

export type FactLaneId =
  | 'amenity_nav'
  | 'combo_cluster'
  | 'pack_match'
  | 'parking_care'
  | 'hour_tour'
  | 'agent_fallback'
  | 'system_control';

function wantsSystemAppControl(text: string): boolean {
  if (wantsHandsFreeSetup(text)) return true;
  if (wantsLiveChatVoiceCommand(text) || wantsStopLiveChatVoiceCommand(text)) {
    return true;
  }
  if (
    /\b(sprechen[- ]?notification|home[- ]?shortcut|shortcut\s+(?:legen|pin))\b/i.test(
      text,
    )
  ) {
    return true;
  }
  if (
    /\b(stimme|voice|taschenlampe|blitzlicht|flashlight|einstellung|settings|was kannst du|wer bist du)\b/i.test(
      text,
    )
  ) {
    return true;
  }
  if (
    /\b(schrift|buttons?).{0,12}(größ|gross|klein|normal)|anzeige\s+größ/i.test(
      text,
    )
  ) {
    return true;
  }
  return false;
}

/** Pack-Match nur für echte Orts-/Historie-Fragen — nicht Punkte/Kino/Outfit. */
function wantsPackMatchStory(jobId: FindusJobId, text: string): boolean {
  if (isMoreHistoryUtterance(text) || isDeicticPoiQuestion(text)) return true;
  if (jobId === 'poi_identify' || jobId === 'museum_theme') return true;
  if (
    jobId === 'fact_number' &&
    /\b(elbe|breite|hoch|meter|stufen|turm|denkmal|gebaut|jahr)\b/i.test(text)
  ) {
    return true;
  }
  if (
    /\b(was\s+ist\s+das|warum\s+(wurde|ist|steht)|wieso\s+(wurde|ist)|erzähl\s+mir\s+(mehr|etwas|von)|mehr\s+zu\s+[A-ZÄÖÜ])\b/i.test(
      text,
    )
  ) {
    return true;
  }
  return false;
}

async function runOneFactLane(opts: {
  userText: string;
  jobId: FindusJobId;
  thinkAhead: ThinkAheadHint[];
  rucksack: RucksackState;
  subject?: string | null;
  city?: string | null;
  signal?: AbortSignal;
  /** Bei Secondary: Amenity/Parking/Combo nicht nochmal stehlen */
  secondary?: boolean;
}): Promise<{ lane: FactLaneId; result: AgentResult }> {
  const text = opts.userText;
  const a = anchorCoords(opts.rucksack);

  if (!opts.secondary && wantsSystemAppControl(text)) {
    const task: PipelineTask = {
      id: 'system_control',
      rawText: text,
      rewrittenText: text,
      intent: 'system',
      priority: 1,
      subject: opts.subject,
      city: opts.city,
      jobId: opts.jobId,
    };
    const result = await agentForIntent('system').run({
      task,
      rucksack: opts.rucksack,
      signal: opts.signal,
    });
    return { lane: 'system_control', result };
  }

  if (
    !opts.secondary &&
    (opts.jobId === 'parking_ev' ||
      isParkingCareUtterance(text) ||
      opts.thinkAhead.includes('parking_leave_by'))
  ) {
    if (isParkingCareUtterance(text) || /\bparkticket\b/i.test(text)) {
      return {
        lane: 'parking_care',
        result: await researchParkingCare({ userText: text }),
      };
    }
  }

  if (!opts.secondary) {
    const amenity = detectAmenityKind(text);
    if (amenity) {
      return {
        lane: 'amenity_nav',
        result: await researchAmenityNav({
          userText: text,
          lat: a.lat,
          lng: a.lng,
          kind: amenity,
        }),
      };
    }
  }

  if (
    !opts.secondary &&
    (opts.thinkAhead.includes('combo_cluster') ||
      isComboClusterQuery(text) ||
      (opts.jobId === 'day_plan_budget' &&
        /\b(parken|pizza|förde|foerde)\b/i.test(text)))
  ) {
    return {
      lane: 'combo_cluster',
      result: await researchComboCluster({
        userText: text,
        lat: a.lat,
        lng: a.lng,
        cityHint: opts.city,
      }),
    };
  }

  if (wantsPackMatchStory(opts.jobId, text)) {
    return {
      lane: 'pack_match',
      result: await researchPackMatchStory({
        userText: text,
        lat: a.lat,
        lng: a.lng,
        cityHint: opts.city,
        subject: opts.subject,
        depth: isMoreHistoryUtterance(text) ? 'deep' : 'arrival',
      }),
    };
  }

  // 1h-Tour / unbesuchte Sights (vor generischem Knowledge)
  if (
    !opts.secondary &&
    (opts.jobId === 'sight_recommend' || isHourTourQuery(text)) &&
    isHourTourQuery(text)
  ) {
    return {
      lane: 'hour_tour',
      result: await researchHourTour({
        userText: text,
        lat: a.lat,
        lng: a.lng,
        cityHint: opts.city,
      }),
    };
  }

  const intent = intentForJob(opts.jobId);
  const task: PipelineTask = {
    id: `reboot_${opts.jobId}`,
    rawText: text,
    rewrittenText: text,
    intent,
    priority: 1,
    subject: opts.subject,
    city: opts.city,
    jobId: opts.jobId,
  };
  const result = await agentForIntent(intent).run({
    task,
    rucksack: opts.rucksack,
    signal: opts.signal,
  });
  return { lane: 'agent_fallback', result };
}

function mergeFactResults(primary: AgentResult, secondary: AgentResult): AgentResult {
  const draft = [primary.draftText, secondary.draftText]
    .filter((t) => t && t.trim())
    .join('\n\n')
    .slice(0, 4500);
  const bullets = [...(primary.bullets ?? []), ...(secondary.bullets ?? [])]
    .filter(Boolean)
    .slice(0, 3);
  const buttons = [...(primary.buttons ?? []), ...(secondary.buttons ?? [])].slice(
    0,
    4,
  );
  return {
    agent: primary.agent,
    ok: primary.ok || secondary.ok,
    draftText: draft || primary.draftText,
    bullets,
    buttons,
    money: [...(primary.money ?? []), ...(secondary.money ?? [])],
    meta: {
      ...(secondary.meta ?? {}),
      ...(primary.meta ?? {}),
      secondaryLane: true,
      secondaryAgent: secondary.agent,
    },
  };
}

/**
 * Primär + optional 1 Secondary-Job (max 2 parallel) — z. B. Party + Outfit.
 */
export async function runFactLanes(opts: {
  userText: string;
  jobId: FindusJobId;
  secondaryJobIds?: FindusJobId[];
  thinkAhead: ThinkAheadHint[];
  rucksack: RucksackState;
  subject?: string | null;
  city?: string | null;
  signal?: AbortSignal;
}): Promise<{ lane: FactLaneId; result: AgentResult }> {
  const secondaryId = (opts.secondaryJobIds ?? []).find(
    (id) => id && id !== opts.jobId,
  );

  if (!secondaryId || REBOOT_MAX_PARALLEL_FACT_JOBS < 2) {
    return runOneFactLane(opts);
  }

  // Compound: Primary + Secondary parallel (keine doppelten Amenity-Lanes)
  const [primary, secondary] = await Promise.all([
    runOneFactLane(opts),
    runOneFactLane({
      ...opts,
      jobId: secondaryId,
      secondary: true,
    }),
  ]);

  return {
    lane: primary.lane,
    result: mergeFactResults(primary.result, secondary.result),
  };
}

export function intentForJob(jobId: FindusJobId): AgentIntent {
  switch (jobId) {
    case 'dining_open':
    case 'dining_hard_match':
      return 'gastro';
    case 'nav_route':
    case 'transit_live':
    case 'taxi_rideshare':
    case 'parking_ev':
      return 'mobility';
    case 'stay_search':
    case 'luggage_practical':
    case 'mobility_rent':
      return 'booking';
    case 'weather_outfit':
      return 'umwelt';
    case 'emergency_care':
    case 'safety_lost':
    case 'friction_now':
      return 'emergency';
    case 'smalltalk_general':
      return 'smalltalk';
    default:
      return 'knowledge';
  }
}

/** Für Harness: erwarteter Intent ohne Side-Effects. */
export function expectIntentForScenarioJob(jobId: FindusJobId): AgentIntent {
  return intentForJob(jobId);
}
