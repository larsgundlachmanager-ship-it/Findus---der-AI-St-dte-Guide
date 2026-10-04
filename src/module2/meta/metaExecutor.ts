/**
 * Meta-Executor — fact_lookup Schleife (max 3 Steps), ruft Meta-Tools.
 */

import { runMetaDeepWeb } from './metaDeepWeb';
import { filterHollowOpenUrlActions, buildHollowSafeOpenUrlAction } from './metaHollowLink';
import { metaWeatherLaneHint } from './metaWeather';
import { readMetaNavDestination } from './metaNav';

export type MetaExecutorStep = {
  tool: 'deep_web' | 'weather' | 'nav_snapshot' | 'link';
  ok: boolean;
  speech: string;
  bullets: string[];
};

export type MetaExecutorResult = {
  ok: boolean;
  steps: MetaExecutorStep[];
  speech: string;
  bullets: string[];
  actions: import('../../types/concierge').QuickAction[];
};

const MAX_FACT_LOOKUP_STEPS = 3;

export async function runMetaFactLookupLoop(opts: {
  userText: string;
  cityHint?: string | null;
  wantBookingLink?: boolean;
  signal?: AbortSignal;
}): Promise<MetaExecutorResult> {
  const steps: MetaExecutorStep[] = [];
  const actions: import('../../types/concierge').QuickAction[] = [];

  const weatherLane = metaWeatherLaneHint(opts.userText);
  if (weatherLane) {
    steps.push({
      tool: 'weather',
      ok: true,
      speech: '',
      bullets: [],
    });
  }

  const navSnap = readMetaNavDestination();
  steps.push({
    tool: 'nav_snapshot',
    ok: navSnap.navigating,
    speech: navSnap.name ? `Navigation läuft Richtung ${navSnap.name}.` : '',
    bullets: navSnap.name ? [`Ziel: ${navSnap.name}`] : [],
  });

  let deepOk = false;
  for (let pass = 0; pass < MAX_FACT_LOOKUP_STEPS; pass++) {
    if (opts.signal?.aborted) break;
    const deep = await runMetaDeepWeb({
      userText: opts.userText,
      cityHint: opts.cityHint,
      wantBookingLink: opts.wantBookingLink ?? /\b(buchen|ticket|link|url)\b/iu.test(opts.userText),
      budgetMs: pass === 0 ? 12_000 : 8_000,
      signal: opts.signal,
    });
    deepOk = deep.ok;
    steps.push({
      tool: 'deep_web',
      ok: deep.ok,
      speech: deep.spokenDraft,
      bullets: deep.bullets.slice(0, 3),
    });
    for (const b of deep.buttons) {
      const act = buildHollowSafeOpenUrlAction({
        url: b.url,
        label: b.label,
        destName: b.label,
      });
      if (act) actions.push(act);
    }
    try {
      const { deepWebNeedsAnotherPass } = require('../router/call1DeepWebWorker') as typeof import('../router/call1DeepWebWorker');
      const needMore = deepWebNeedsAnotherPass({
        wantBookingLink: opts.wantBookingLink ?? true,
        optionCount: deep.options?.length ?? 0,
        buttonCount: deep.buttons.length,
      });
      if (!needMore || deep.ok) break;
    } catch {
      break;
    }
  }

  const speechParts = steps
    .map((s) => s.speech.trim())
    .filter(Boolean);
  const speech = speechParts.join(' ').slice(0, 1800);
  const bullets = steps.flatMap((s) => s.bullets).slice(0, 3);

  return {
    ok: deepOk || steps.some((s) => s.ok && s.speech),
    steps: steps.slice(0, MAX_FACT_LOOKUP_STEPS + 2),
    speech,
    bullets,
    actions: filterHollowOpenUrlActions(actions).slice(0, 5),
  };
}
