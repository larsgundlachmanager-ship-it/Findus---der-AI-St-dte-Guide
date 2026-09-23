/**
 * Führt order.act aus (navigate / timeline / pack).
 * Phrasen-Erkennung nur, wenn Call 1 kein act geliefert hat.
 */

import type { IntentAct, IntentTopic } from './call1OrderTicket';

export type IntentExecResult = {
  speech: string;
  bullets: string[];
  cardTitle: string;
};

function cardFor(topic: IntentTopic | null): string {
  if (topic === 'cruise') return 'Kreuzfahrt';
  if (topic === 'hotel') return 'Hotel';
  if (topic === 'flight') return 'Flug';
  if (topic === 'train') return 'Bahn';
  if (topic === 'pack') return 'Packliste';
  return 'Unterwegs';
}

function phraseFallback(blob: string): IntentAct | null {
  try {
    const {
      looksLikeCruiseCenterNavAsk,
      extractCruiseCenterNavDest,
    } = require('../../services/stt/cruiseVoiceRepair') as {
      looksLikeCruiseCenterNavAsk: (s: string) => boolean;
      extractCruiseCenterNavDest: (s: string) => string | null;
    };
    if (!looksLikeCruiseCenterNavAsk(blob)) return null;
    return {
      actions: ['navigate', 'timeline'],
      place: extractCruiseCenterNavDest(blob),
      topic: 'cruise',
    };
  } catch {
    return null;
  }
}

export async function executeIntentAct(opts: {
  act: IntentAct | null | undefined;
  userText: string;
  heardAs?: string | null;
}): Promise<IntentExecResult | null> {
  const blob = [opts.userText, opts.heardAs || ''].filter(Boolean).join(' ');
  const fromTicket = opts.act?.actions?.length ? opts.act : null;
  const act = fromTicket || phraseFallback(blob);
  if (!act) return null;
  const wantsNav = act.actions.includes('navigate');
  const wantsTimeline = act.actions.includes('timeline');
  const wantsPack = act.actions.includes('pack');
  if (!wantsNav && !wantsTimeline && !wantsPack) return null;
  if (fromTicket && wantsNav && !wantsTimeline && !wantsPack) return null;

  const place = act.place;
  const topic = act.topic;
  const researchText = [blob, place || ''].filter(Boolean).join(' ');

  const navPromise = (async () => {
    if (!wantsNav || !place) return null;
    const { hardOverrideNavigationTo } = await import(
      '../../services/navigation/hardNavOverride'
    );
    return hardOverrideNavigationTo(place, { userText: researchText });
  })();

  const timelinePromise = (async () => {
    if (!wantsTimeline && !wantsPack) return null;
    const { runTravelScheduleHarden } = require('../timeline/travelScheduleHarden') as {
      runTravelScheduleHarden: (o: {
        userText: string;
        cityHint?: string | null;
        forceKinds?: Array<'cruise_glance' | 'hotel_stamm' | 'packlist'> | null;
      }) => Promise<{ speech?: string; bullets?: string[] } | null>;
    };
    const force: Array<'cruise_glance' | 'hotel_stamm' | 'packlist'> = [];
    if (wantsPack || topic === 'pack') force.push('packlist');
    if (wantsTimeline && topic === 'cruise') force.push('cruise_glance');
    if (wantsTimeline && topic === 'hotel') force.push('hotel_stamm');
    return runTravelScheduleHarden({
      userText: researchText,
      cityHint: place,
      forceKinds: force.length ? force : null,
    });
  })();

  const [navResult, timeline] = await Promise.all([navPromise, timelinePromise]);
  const bits = [
    navResult?.ok
      ? `Ich navigiere dich zu ${navResult.name || place}.`
      : wantsNav && place
        ? `Die Route zu ${place} starte ich.`
        : '',
    timeline?.speech || '',
  ].filter(Boolean);
  const speech = bits.join(' ').replace(/\s+/g, ' ').trim();
  if (!speech && !navResult?.ok) return null;
  return {
    speech,
    bullets: (timeline?.bullets ?? []).slice(0, 3),
    cardTitle: cardFor(topic),
  };
}
