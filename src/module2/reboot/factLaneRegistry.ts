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

export type FactLaneId =
  | 'amenity_nav'
  | 'combo_cluster'
  | 'pack_match'
  | 'parking_care'
  | 'pitch_choice'
  | 'time_trigger'
  | 'agent_fallback'
  | 'system_control';

function wantsTimeTrigger(text: string): boolean {
  try {
    const { isClockIntent } = require('../../services/alarms/clockIntents') as {
      isClockIntent: (t: string) => boolean;
    };
    return isClockIntent(text);
  } catch {
    return /\b(wecker|timer|eieruhr|powernap|weck\s+mich|erinner\s+mich\s+(?:in|um))\b/i.test(
      text,
    );
  }
}

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
  try {
    const { isWorldFactUtterance } = require('./pipeline/worldFactGuard') as {
      isWorldFactUtterance: (s: string) => boolean;
    };
    if (isWorldFactUtterance(text)) return false;
  } catch {
    /* soft */
  }
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

  if (!opts.secondary && wantsTimeTrigger(text)) {
    let clockOnly = true;
    try {
      const { isClockOnlyUtterance } = require('./pipeline/orchestrateSlots') as {
        isClockOnlyUtterance: (s: string) => boolean;
      };
      clockOnly = isClockOnlyUtterance(text);
    } catch {
      clockOnly = true;
    }
    if (clockOnly) {
      const task: PipelineTask = {
        id: 'time_trigger',
        rawText: text,
        rewrittenText: text,
        intent: 'trigger',
        priority: 1,
        subject: opts.subject,
        city: opts.city,
        jobId: opts.jobId,
      };
      const result = await agentForIntent('trigger').run({
        task,
        rucksack: opts.rucksack,
        signal: opts.signal,
      });
      return { lane: 'time_trigger', result };
    }
  }

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
    try {
      const { isParkingSearchIntent } = require('../../services/concierge/timeCareIntent') as {
        isParkingSearchIntent: (s: string) => boolean;
      };
      if (isParkingSearchIntent(text)) {
        /* Suche → Pitch, nicht Spot speichern */
      } else if (isParkingCareUtterance(text) || /\bparkticket\b/i.test(text)) {
        return {
          lane: 'parking_care',
          result: await researchParkingCare({ userText: text }),
        };
      }
    } catch {
      if (isParkingCareUtterance(text) || /\bparkticket\b/i.test(text)) {
        return {
          lane: 'parking_care',
          result: await researchParkingCare({ userText: text }),
        };
      }
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

  // Auswahl-Pitch v4 — nie Legacy-Gastro-2er / Dual-Option
  if (
    !opts.secondary &&
    (opts.jobId === 'dining_open' ||
      opts.jobId === 'dining_hard_match' ||
      opts.jobId === 'sight_recommend')
  ) {
    const nonChoiceGastro =
      /\b(reservier|tisch\s+(?:anfrag|buch)|anrufen|telefon(?:nummer)?)\b/i.test(
        text,
      ) ||
      (/\b(speisekarte|getränkekarte|menü|menu)\b/i.test(text) &&
        !/\b(wo\s+|empfehl|restaurant\s+für|hunger|zwei\s+option)\b/i.test(
          text,
        ));
    if (!nonChoiceGastro) {
      const { shouldHandoffToPitchModule } = await import(
        '../pitch/shouldHandoffPitch'
      );
      const forceOpenDining = opts.jobId === 'dining_open';
      const hardDiningOk =
        opts.jobId === 'dining_hard_match' &&
        (shouldHandoffToPitchModule(text) ||
          /\b(restaurant|essen|hunger|pizza|sushi|burger|italiener|grieche)\b/i.test(
            text,
          ));
      const sightOk =
        opts.jobId === 'sight_recommend' && shouldHandoffToPitchModule(text);
      if (forceOpenDining || hardDiningOk || sightOk) {
        const { researchPitchAsAgentResult } = await import(
          '../pitch/pitchFactLane'
        );
        return {
          lane: 'pitch_choice',
          result: await researchPitchAsAgentResult({
            userText: text,
            requestId: `lane_${opts.jobId}_${Date.now()}`,
            signal: opts.signal,
          }),
        };
      }
    }
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
 * Alle Child-Jobs parallel (Cap REBOOT_MAX_PARALLEL_FACT_JOBS). Plan webt, ersetzt nicht.
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
  const seen = new Set<string>();
  const ids: FindusJobId[] = [];
  for (const id of [opts.jobId, ...(opts.secondaryJobIds ?? [])]) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  const capped = ids.slice(0, Math.max(1, REBOOT_MAX_PARALLEL_FACT_JOBS));
  if (capped.length <= 1) {
    return runOneFactLane({ ...opts, jobId: capped[0] ?? opts.jobId });
  }

  const ran = await Promise.all(
    capped.map((id, i) =>
      runOneFactLane({
        ...opts,
        jobId: id,
        secondary: i > 0,
      }),
    ),
  );
  let merged = ran[0]!.result;
  for (let i = 1; i < ran.length; i++) {
    merged = mergeFactResults(merged, ran[i]!.result);
  }
  return { lane: ran[0]!.lane, result: merged };
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
