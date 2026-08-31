/**
 * Fact-Lane: „Was ist das?“ / Story am Ort — Pack first, Gap → optional Web.
 * depth=deep = Button „Mehr Historie“ / Adjustable Depth (gleicher Ort).
 */

import {
  formatPackFactsForAgent,
  lookupPackFactsForSubject,
} from '../agents/packFactLookup';
import { getForegroundSaidFacts } from '../../services/memory/conversationThreads';
import type { AgentResult } from '../types';
import { isDeicticPoiQuestion } from '../../services/intent/poiInfoVsNav';

export type PackMatchDepth = 'arrival' | 'deep';

/** Button „Mehr Historie“ / „erzähl mehr zu …“ */
export function isMoreHistoryUtterance(text: string): boolean {
  const t = text.replace(/\s+/g, ' ').trim();
  if (!t) return false;
  if (/\berzähl\s+mir\s+noch\s+mehr\s+zu\b/iu.test(t)) return true;
  if (/\bmehr\s+(zur\s+)?(historie|geschichte)\b/iu.test(t)) return true;
  if (/\bnoch\s+mehr\s+(dazu|über|ueber|zu)\b/iu.test(t)) return true;
  if (/\bmehr\s+historie\s+(zum|zur|zu|über|ueber)\b/iu.test(t)) return true;
  return false;
}

/** „Erzähl mir noch mehr zu Marinedenkmal.“ → Subject */
export function extractMoreHistoryTopic(text: string): string | null {
  const m = text.match(
    /\berzähl\s+mir\s+noch\s+mehr\s+zu\s+(.+?)(?:\.|$)/iu,
  );
  const topic = m?.[1]?.replace(/[„“"']/g, '').trim();
  if (topic && topic.length >= 2 && topic.length < 80) return topic;
  return null;
}

export async function researchPackMatchStory(opts: {
  userText: string;
  lat: number;
  lng: number;
  cityHint?: string | null;
  subject?: string | null;
  depth?: PackMatchDepth;
}): Promise<AgentResult> {
  const depth: PackMatchDepth = opts.depth ?? 'arrival';
  const deep = depth === 'deep' || isMoreHistoryUtterance(opts.userText);
  const deictic = !deep && isDeicticPoiQuestion(opts.userText);
  const topicFromPrompt = extractMoreHistoryTopic(opts.userText);

  const lookupSubject = deictic
    ? opts.userText.trim()
    : (
        topicFromPrompt ||
        opts.subject ||
        opts.userText ||
        'dieser Ort'
      ).trim();

  const hit = await lookupPackFactsForSubject({
    subject: deep
      ? lookupSubject
      : deictic
        ? opts.userText.trim()
        : `${lookupSubject} ${opts.userText}`.trim(),
    cityHint: opts.cityHint,
    lat: opts.lat,
    lng: opts.lng,
    limitFacts: deep ? 28 : 16,
  });

  if (!hit) {
    return {
      agent: 'knowledge',
      ok: true,
      draftText: deep
        ? 'Zum Vertiefen fehlt mir im Pack gerade Rohstoff. Frag gezielt (Jahr, Bau, Person) — oder wir recherchieren live nur diese Lücke.'
        : 'Dazu habe ich im Stadt-Datensatz gerade keinen klaren Treffer. Beschreib den Ort kurz (Denkmal, Brunnen, Gebäude) — oder wir recherchieren live nach.',
      bullets: ['Kein Pack-Match'],
      buttons: [],
      meta: {
        packMatch: true,
        concrete_place: false,
        needsLiveResearch: true,
        depth: deep ? 'deep' : 'arrival',
      },
    };
  }

  const said = getForegroundSaidFacts();
  let facts = hit.facts;
  if (said.length) {
    const fresh = facts.filter((f) => {
      const key = f.toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 80);
      return !said.some(
        (s) => key.includes(s) || s.includes(key.slice(0, 40)),
      );
    });
    if (fresh.length) facts = fresh;
  }

  // Deep: bewusst mehr Pool, aber schon Gesagtes streichen
  if (deep && facts.length === 0 && hit.facts.length) {
    facts = hit.facts.slice(-8);
  }

  const block = formatPackFactsForAgent({ ...hit, facts });
  const followUp =
    deep ||
    /\b(warum|wieso|weshalb|geschlossen|mehr|erzähl)\b/iu.test(opts.userText);

  let lead = `Ort: ${hit.poi.name}`;
  if (hit.distanceM != null) lead += ` (~${hit.distanceM} m)`;
  lead += '.';

  const gap =
    followUp &&
    facts.length <= 2 &&
    !/\b(geschlossen|sanier|abriss|warum)\b/i.test(facts.join(' '));

  const draftParts = [
    lead,
    deep
      ? 'MEHR HISTORIE am SELBEN Ort: nur noch nicht Gesagtes. Max ~2000 Zeichen Speech. Keine Timeline, keine fremden Museen, kein Explore-Drift. Nichts erfinden.'
      : followUp
        ? 'Beantworte die Rückfrage zuerst mit noch nicht Gesagtem aus den Fakten. Max ~500 Zeichen.'
        : deictic
          ? 'Erkläre was das ist — visuell kurz, dann Historie aus den Fakten. Nichts erfinden. Max ~1000 Zeichen.'
          : 'Beantworte die User-Frage nur aus den Fakten.',
    block,
  ];
  if (gap) {
    draftParts.push(
      'LÜCKE: Pack beantwortet die Frage nicht vollständig → ehrlich sagen was fehlt; Live-Research nur für diese Lücke am selben Ort.',
    );
  }
  if (hit.liveHints.length && !deep) {
    draftParts.push(
      'LIVE-HINTS: nur nachziehen wenn User Live-Infos braucht (Preis/heute/Event).',
    );
  }

  const showMoreBtn = !deep && facts.length >= 3;

  return {
    agent: 'knowledge',
    ok: true,
    draftText: draftParts.join('\n\n').slice(0, deep ? 4500 : 3500),
    bullets: [
      hit.poi.name,
      ...(hit.distanceM != null ? [`~${hit.distanceM} m`] : []),
      ...(facts[0] ? [facts[0].slice(0, 90)] : []),
    ].slice(0, 3),
    buttons: showMoreBtn
      ? [
          {
            id: 'more_history',
            label: '📖 Mehr Historie',
            payload: {
              kind: 'ui',
              action: 'more_history',
              data: { topic: hit.poi.name },
            },
          },
        ]
      : [],
    meta: {
      packMatch: true,
      concrete_place: true,
      number_answer: followUp,
      placeName: hit.poi.name,
      placeLat: hit.poi.lat,
      placeLng: hit.poi.lng,
      distanceM: hit.distanceM,
      needsLiveResearch: gap || (!deep && hit.liveHints.length > 0),
      candidates: hit.placeCandidates?.length ?? 1,
      depth: deep ? 'deep' : 'arrival',
      speechBudgetHint: deep ? 1200 : 900,
    },
  };
}
