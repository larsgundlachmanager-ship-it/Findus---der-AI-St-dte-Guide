/**
 * Call-1 Manager (dünn) — Job + Thread → Bridge-Budget + ThinkAhead.
 * Kein Gemini hier: nur Struktur aus Classifier + Topic-Router.
 */

import type { JobClassification } from '../jobs/types';
import type { TopicRouteDecision } from '../../services/memory/conversationThreads';
import {
  REBOOT_BRIDGE_RULES,
  REBOOT_MANAGER_MODULES,
  moduleForPrimaryJob,
} from './contracts';
import type {
  ManagerModule,
  RebootRouterOut,
  ThinkAheadHint,
  ThreadMode,
} from './types';

const STORY_JOBS = new Set([
  'poi_identify',
  'museum_theme',
  'sight_recommend',
  'fact_number',
]);

/** Follow-up am selben Ort/Topic → keine neue Bridge. */
export function shouldSuppressBridge(opts: {
  topicMode: TopicRouteDecision['mode'] | null | undefined;
  jobId: string;
  userText: string;
}): boolean {
  // App-Steuerung / Hands-free: kein Bridge-Vorgeplänkel
  if (
    /\b(shortcut|hands[-\s]?free|sprechen[- ]?notification|live[-\s]?chat|gesprächs?modus|taschenlampe|stimme\s+(?:von|ändern)|einstellung)\b/iu.test(
      opts.userText,
    )
  ) {
    return true;
  }
  const mode = opts.topicMode;
  if (mode === 'continue' || mode === 'resume') {
    if (STORY_JOBS.has(opts.jobId)) return true;
    // Anapher / Rückfrage ohne neues Thema
    if (
      /\b(warum|wieso|weshalb|und\s+dann|was\s+noch|mehr\s+dazu|Erzähl|erzähl|geschlossen|wann|wie\s+viel|noch\s+mehr|mehr\s+historie|mehr\s+zur\s+geschichte)\b/iu.test(
        opts.userText,
      )
    ) {
      return true;
    }
  }
  // Button „Mehr Historie“ immer ohne Bridge — auch wenn Topic-Router „new“ sagt
  if (
    /\berzähl\s+mir\s+noch\s+mehr\s+zu\b/iu.test(opts.userText) ||
    /\bmehr\s+(zur\s+)?(historie|geschichte)\b/iu.test(opts.userText)
  ) {
    return true;
  }
  return false;
}

export function buildManagerTurn(opts: {
  jobClass: JobClassification;
  topic: TopicRouteDecision | null;
  userText: string;
  earlyBridgeLine: string | null;
}): RebootRouterOut {
  const module = moduleForPrimaryJob(opts.jobClass.jobId) as ManagerModule;
  const modCfg = REBOOT_MANAGER_MODULES[module];
  const thread = (opts.topic?.mode ?? 'new') as ThreadMode;
  const suppress = shouldSuppressBridge({
    topicMode: opts.topic?.mode,
    jobId: opts.jobClass.jobId,
    userText: opts.userText,
  });

  const thinkAhead: ThinkAheadHint[] = [...modCfg.defaultThinkAhead];
  if (opts.jobClass.secondaryJobIds.includes('weather_outfit')) {
    if (!thinkAhead.includes('outfit_from_plan_and_weather')) {
      thinkAhead.push('outfit_from_plan_and_weather');
    }
  }
  if (/\b(vegetar|vegan)\b/iu.test(opts.userText)) {
    if (!thinkAhead.includes('diet_filter')) thinkAhead.push('diet_filter');
  }
  if (
    /\b(parken|parkplatz).{0,40}\b(pizza|essen|takeaway).{0,40}\b(förde|foerde|sonnenuntergang|aussicht)\b/iu.test(
      opts.userText,
    ) ||
    opts.jobClass.jobId === 'day_plan_budget'
  ) {
    if (
      /\b(parken|pizza|förde|foerde)\b/iu.test(opts.userText) &&
      !thinkAhead.includes('combo_cluster')
    ) {
      thinkAhead.push('combo_cluster');
    }
  }

  const amenityUnique =
    opts.jobClass.jobId === 'shopping_errand' ||
    opts.jobClass.jobId === 'friction_now' ||
    opts.jobClass.jobId === 'nav_route';

  let bridge: string | null = suppress ? null : opts.earlyBridgeLine;
  if (suppress) bridge = null;
  if (
    bridge &&
    REBOOT_BRIDGE_RULES.suppressOnThreadContinue &&
    (thread === 'continue' || thread === 'resume')
  ) {
    // Amenity-Neufrage auf continue darf kurze Bridge behalten; Story nicht
    if (STORY_JOBS.has(opts.jobClass.jobId)) bridge = null;
  }

  const topicId =
    opts.topic?.thread.id ??
    `topic_${opts.jobClass.jobId}_${Date.now().toString(36)}`;

  return {
    module,
    jobs: [
      opts.jobClass.jobId,
      ...opts.jobClass.secondaryJobIds.slice(0, 1),
    ],
    thinkAhead,
    bridgeOneLiner: bridge,
    thread,
    topicId,
    allowSlowLane: true,
    autoStartNavIfUnique: amenityUnique,
  };
}
