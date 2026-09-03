/**
 * Chat-first Lane — Gemini + optional Blaupause/Tools.
 * Kein Himmels-Spezialpfad: Sky = Blaupause sky_phenomenon; Fakten = normaler Chat.
 */

import { generateGeminiText, hasAnyChatLlm } from '../../services/geminiService';
import {
  FINDUS_ANSWER_FIRST_BLOCK,
  FINDUS_BRIDGE_CONTINUITY_BLOCK,
  FINDUS_DYNAMIC_STRUCTURE_DOCTRINE,
  FINDUS_SYNTHESIS_RAIL_BLOCK,
  FINDUS_FEW_SHOT_DISCLAIMER,
  FINDUS_JUST_DO_IT_BLOCK,
  FINDUS_ACTIVITY_BEACH_DEST_BLOCK,
  FINDUS_SPEECH_LENGTH_BLOCK,
  FINDUS_TYPICAL_SPEECH_MAX_CHARS,
  FINDUS_CORE_WOVEN_SPEECH_BLOCK,
  FINDUS_LIVE_CHAT_HUMAN_BLOCK,
} from '../../services/concierge/findusResponsePolicy';
import {
  isCelestialOrSkyQuery,
  isQuickLookupQuery,
} from '../../services/concierge/celestialSkyQuery';
import { resolveBlueprintForText } from '../blueprints/aliases';
import {
  personaPromptBlock,
  resolvePersonaVariant,
} from '../blueprints/personaVariants';
import {
  buildPersonalityMatrixPromptBlock,
} from '../../services/persona/personalityMatrixPrompt';
import { getCachedUserProfile } from '../../services/userProfileService';
import {
  getLearnedFactBriefs,
  recordLearnSignal,
} from '../blueprints/autoLearn';
import type { ResearchDepth, PersonaVariant } from '../router/routeAllowlist';
import type { Module2ActionButton } from '../types';
import {
  mergeOfferIntoSpeech,
  pickButlerOffer,
  sanitizeBridgeText,
} from './butlerOfferBus';
import { setLastTopic } from '../context/shortTermContext';
import { OFFLINE_SPEECH, isRucksackOffline } from '../safety/offlineGate';
import {
  getLiveChatTurnContext,
  wantsExplicitDeepResearch,
  isLiveChatTurnActive,
} from '../../services/handsFree/liveChatTurnContext';
import { stripChatLaneMeta } from './chatLaneMeta';

export type ChatLaneInput = {
  userText: string;
  turnId: string;
  bridgeFromRouter?: string | null;
  blueprintId?: string | null;
  nearestBlueprint?: string | null;
  blueprintStage?: string | null;
  needsResearch?: ResearchDepth;
  personaVariant?: PersonaVariant | null;
  cityHint?: string | null;
  cityKey?: string | null;
  openIntentsSummary?: string | null;
  signal?: AbortSignal;
  fromPlanContext?: boolean;
  /** Call-1 topicScope — Chat-Lane Historie hart begrenzen. */
  topicScope?: {
    mode: 'new' | 'followup';
    turnsForCall2: number;
    inheritLiveInventory?: boolean;
  } | null;
};

export type ChatLaneResult = {
  speech: string;
  bullets: string[];
  buttons: Module2ActionButton[];
  bridgeSpoken: string | null;
  blueprintId: string | null;
  personaVariant: PersonaVariant;
  needsResearch: ResearchDepth;
  /** nur Anti-Nightlife-Flag, kein Spezialpfad */
  celestial: boolean;
  nextHandoff: 'pitch' | 'nav' | 'plan' | 'events' | null;
  /** Spickzettel-Thema, z. B. Wetter in Hamburg */
  cardTitle?: string | null;
};

function parseJsonObject(raw: string): Record<string, unknown> | null {
  const t = (raw || '').trim();
  if (!t) return null;
  try {
    const p = JSON.parse(t);
    if (p && typeof p === 'object' && !Array.isArray(p)) {
      return p as Record<string, unknown>;
    }
  } catch {
    /* fence */
  }
  const m = t.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    return JSON.parse(m[0]) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function asButtons(raw: unknown): Module2ActionButton[] {
  if (!Array.isArray(raw)) return [];
  const out: Module2ActionButton[] = [];
  for (const item of raw.slice(0, 4)) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const label = String(o.label || '').trim().slice(0, 28);
    const url = typeof o.url === 'string' ? o.url.trim() : '';
    if (!label) continue;
    if (url && /^https?:\/\//i.test(url)) {
      out.push({
        id: String(o.id || `act_${out.length}`).slice(0, 40),
        label,
        payload: {
          kind: 'deep_link',
          url,
          destName: String(o.destName || label).slice(0, 80),
        },
      });
      continue;
    }
    const prompt = String(o.textPrompt || o.prompt || '').trim();
    if (prompt) {
      out.push({
        id: String(o.id || `act_${out.length}`).slice(0, 40),
        label,
        payload: {
          kind: 'ui',
          action: 'text_prompt',
          data: { textPrompt: prompt.slice(0, 200) },
        },
      });
    }
  }
  return out;
}

async function gatherToolContext(opts: {
  userText: string;
  needsResearch: ResearchDepth;
  wantWeather?: boolean;
  cityHint?: string | null;
}): Promise<string> {
  const chunks: string[] = [];

  if (
    opts.wantWeather ||
    /\b(wetter|anziehen|frieren|regen|temperatur|jacke|pulli|wolken|sicht)\b/iu.test(
      opts.userText,
    )
  ) {
    try {
      const { ensureWeatherFresh } = require('../../services/weatherService') as {
        ensureWeatherFresh: (
          reason?: 'open' | 'tick' | 'force',
          coords?: { lat: number; lng: number } | null,
          opts?: { userAsked?: boolean },
        ) => Promise<{
          currentTempC?: number | null;
          dayHighC?: number | null;
          summaryLine?: string | null;
          nextRainProb?: number | null;
          promptBlock?: string | null;
          tomorrowSummary?: string | null;
        } | null>;
      };
      const w = await ensureWeatherFresh('tick', null, { userAsked: true });
      if (w) {
        const temp =
          typeof w.currentTempC === 'number' ? w.currentTempC : null;
        const high = typeof w.dayHighC === 'number' ? w.dayHighC : null;
        const tomorrow = w.tomorrowSummary?.trim() || '';
        chunks.push(
          [
            'WETTER:',
            temp != null ? `jetzt ${Math.round(temp)} Grad` : null,
            high != null ? `heute bis ${Math.round(high)} Grad` : null,
            w.summaryLine || null,
            typeof w.nextRainProb === 'number'
              ? `Regenchance ${Math.round(w.nextRainProb)} Prozent`
              : null,
            tomorrow ? `Morgen ${tomorrow}` : null,
          ]
            .filter(Boolean)
            .join('. '),
        );
      }
    } catch {
      /* soft */
    }
  }

  if (
    /\b(frühstück|fruehstueck|breakfast|brunch)\b/iu.test(opts.userText) &&
    /\b(empfehl|wo|café|cafe|bäck|baeck|essen|kannst du)\b/iu.test(opts.userText)
  ) {
    try {
      const { searchPlacesByText } = require('../../services/navigation/googleMapsNav') as {
        searchPlacesByText: (o: {
          query: string;
          lat: number;
          lng: number;
        }) => Promise<Array<{ name?: string; rating?: number; vicinity?: string }>>;
      };
      const { useGpsStore } = require('../../store/useGpsStore') as {
        useGpsStore: {
          getState: () => { lat: number | null; lng: number | null };
        };
      };
      const gps = useGpsStore.getState();
      if (gps.lat != null && gps.lng != null) {
        const hits = await searchPlacesByText({
          query: `Frühstück Café ${opts.cityHint || ''}`.trim(),
          lat: gps.lat,
          lng: gps.lng,
        });
        const top = (hits || [])
          .slice(0, 3)
          .map((h) =>
            [h.name, typeof h.rating === 'number' ? `${h.rating.toFixed(1)}★` : '']
              .filter(Boolean)
              .join(' '),
          )
          .filter(Boolean);
        if (top.length) chunks.push(`FRUEHSTUECK_ORTE: ${top.join(' | ')}`);
      }
    } catch {
      /* soft */
    }
  }

  if (opts.needsResearch === 'deep' || opts.needsResearch === 'pack') {
    let skipPackGrow = false;
    try {
      const { looksLikeOutfitOrWeatherUtterance } = require('../planning/planUtteranceGate') as {
        looksLikeOutfitOrWeatherUtterance: (s: string) => boolean;
      };
      skipPackGrow = looksLikeOutfitOrWeatherUtterance(opts.userText);
    } catch {
      skipPackGrow = false;
    }
    let skipHtml = false;
    try {
      const { shouldSkipHtmlWebResearch } = require('../../services/research/htmlResearchGate') as {
        shouldSkipHtmlWebResearch: (s: string) => boolean;
      };
      skipHtml = shouldSkipHtmlWebResearch(opts.userText);
    } catch {
      skipHtml = false;
    }
    if (!skipHtml) {
      if (!skipPackGrow) {
        try {
          const { maybeGrowPackFromUserTurn } = require('../../services/research/packGrowthFromTurn') as {
            maybeGrowPackFromUserTurn: (o: {
              userText: string;
              lat?: number | null;
              lng?: number | null;
            }) => Promise<{ promptBlock?: string } | null>;
          };
          let lat: number | null = null;
          let lng: number | null = null;
          try {
            const { useFinnusStore } = require('../../store/useFinnusStore') as {
              useFinnusStore: {
                getState: () => {
                  lastGpsLat?: number | null;
                  lastGpsLng?: number | null;
                };
              };
            };
            const st = useFinnusStore.getState();
            lat = typeof st.lastGpsLat === 'number' ? st.lastGpsLat : null;
            lng = typeof st.lastGpsLng === 'number' ? st.lastGpsLng : null;
          } catch {
            /* soft */
          }
          const grown = await maybeGrowPackFromUserTurn({
            userText: opts.userText,
            lat,
            lng,
          });
          if (grown?.promptBlock) {
            chunks.push(grown.promptBlock.slice(0, 1600));
          }
        } catch {
          /* soft */
        }
      }
      try {
        const { runWebResearch } = require('../../services/research/webResearchService') as {
          runWebResearch: (
            q: string,
            o?: { force?: boolean },
          ) => Promise<{
            speechHint?: string | null;
            promptBlock?: string;
            facts?: Array<{ label?: string; value?: string }>;
          } | null>;
        };
        const wr = await runWebResearch(opts.userText, {
          force: opts.needsResearch === 'deep',
        });
        let draft = wr?.speechHint || wr?.promptBlock || '';
        try {
          const { isHtmlScrapeFailureSpeech } = require('../../services/research/htmlResearchGate') as {
            isHtmlScrapeFailureSpeech: (s: string) => boolean;
          };
          if (draft && isHtmlScrapeFailureSpeech(draft)) draft = '';
        } catch {
          /* soft */
        }
        if (draft) {
          chunks.push(`WEB_DRAFT: ${draft.slice(0, 1200)}`);
        }
        if (Array.isArray(wr?.facts) && wr.facts.length) {
          chunks.push(
            `WEB_FACTS: ${wr.facts
              .slice(0, 8)
              .map((f) => `${f.label || ''}: ${f.value || ''}`)
              .join(' | ')
              .slice(0, 800)}`,
          );
        }
      } catch {
        /* soft */
      }
    }
  }

  if (opts.cityHint) chunks.push(`CITY: ${opts.cityHint}`);

  try {
    const { isHoursQuery } = require('../router/placeGoQuery') as {
      isHoursQuery: (t: string) => boolean;
    };
    if (isHoursQuery(opts.userText)) {
      try {
        const { lookupPackHoursOrMenu } = require('../../services/research/packHoursOffline') as {
          lookupPackHoursOrMenu: (o: {
            userText: string;
            placeNameHint?: string | null;
          }) => Promise<{ line: string; trust: number } | null>;
        };
        const packHit = await lookupPackHoursOrMenu({
          userText: opts.userText,
        });
        if (packHit?.line) {
          chunks.push(`PACK_HOURS: ${packHit.line}`);
        }
      } catch {
        /* soft */
      }
      if (!chunks.some((c) => c.startsWith('PACK_HOURS'))) {
        try {
          const { searchPlacesByText } = require('../../services/navigation/googleMapsNav') as {
            searchPlacesByText: (o: {
              query: string;
              lat: number;
              lng: number;
              enrich?: boolean;
            }) => Promise<Array<{
              name?: string;
              openNow?: boolean | null;
              opensAtMin?: number | null;
              closesAtMin?: number | null;
            }>>;
          };
          const { hoursSpeechHint } = require('../agents/placeHoursFit') as {
            hoursSpeechHint: (p: {
              openNow?: boolean | null;
              opensAtMin?: number | null;
              closesAtMin?: number | null;
            }) => string | null;
          };
          const { useGpsStore } = require('../../store/useGpsStore') as {
            useGpsStore: {
              getState: () => { lat: number | null; lng: number | null };
            };
          };
          const gps = useGpsStore.getState();
          if (gps.lat != null && gps.lng != null) {
            const hits = await searchPlacesByText({
              query: opts.userText,
              lat: gps.lat,
              lng: gps.lng,
              enrich: true,
            });
            const hit = hits?.[0];
            const hint = hit ? hoursSpeechHint(hit) : null;
            if (hit?.name && hint) {
              chunks.push(`PLACES_HOURS: ${hit.name}: ${hint}`);
            }
          }
        } catch {
          /* soft */
        }
      }
    }
  } catch {
    /* soft */
  }

  return chunks.join('\n');
}

const WEITERDENKEN = [
  'WEITERDENKEN (Butler — nur wenn es wirklich hilft):',
  '- Geschlossene Faktenfrage (Alter, Einwohner, Fläche, Sonnenaufgang, Rechnung, eine Maßzahl): Antwort + Stichpunkte, KEIN Offer, kein „wenn du magst…“.',
  '- Nur bei offenen Themen (News, Programm, Künstler vor Ort, zeitgebundenes Event): max. EIN weiches Angebot im Persona-Ton, immer Du.',
  '- Wenn Nachschlagen Sinn macht und der User nicht schon fertig ist: Button-Label genau „schau nach“, textPrompt = genau das Thema.',
  '- Künstler/Band: Auftritt in aktueller Stadt/Nähe nur wenn belegt → kurz + Interesse fragen.',
  '- Zeitgebunden (Finsternis, Konzert): Erinnern anbieten wenn sinnvoll.',
  '- Wolken nur mit Wetterbeleg.',
  '- wantsReminder / localShowHint im Output setzen wenn Offer passt — sonst weglassen.',
].join('\n');

export async function runChatLane(
  input: ChatLaneInput,
): Promise<ChatLaneResult> {
  const userText = (input.userText || '').trim();
  try {
    const { mustSkipChatLane } = require('../router/liveInventoryGate') as {
      mustSkipChatLane: (
        t: string,
        a?: { chatLane?: string | null; blueprintId?: string | null },
      ) => boolean;
    };
    if (
      mustSkipChatLane(userText, {
        blueprintId: input.blueprintId,
      })
    ) {
      // Neues Thema: Inventory-Heuristik darf Call-1 chat_lane nicht stehlen.
      const isolated =
        input.topicScope?.mode === 'new' ||
        (input.topicScope?.turnsForCall2 ?? 1) <= 0 ||
        input.topicScope?.inheritLiveInventory === false;
      if (!isolated) {
        const { detectLiveInventoryKind } = require('../router/liveInventoryGate') as {
          detectLiveInventoryKind: (s: string) => 'hotel' | 'pitch_choice' | 'events' | null;
        };
        const kind = detectLiveInventoryKind(userText);
        return {
          speech: '',
          bullets: [],
          buttons: [],
          bridgeSpoken: null,
          blueprintId: input.blueprintId || null,
          personaVariant: input.personaVariant || 'default',
          needsResearch: input.needsResearch || 'deep',
          celestial: false,
          nextHandoff: kind === 'events' ? 'events' : 'pitch',
        };
      }
    }
  } catch {
    /* soft */
  }

  // Wetter: Live-API + reicher Bericht — vor Learned/LLM (schneller + kein Halluzinieren).
  let skipWeatherForFlight = false;
  try {
    const { shouldPreserveFlightTripSession } = require('../../services/flights/flightTripIntent') as {
      shouldPreserveFlightTripSession: (s: string) => boolean;
    };
    const { hydrateFlightTripSession, hasFlightTripSession } = require(
      '../../services/flights/flightTripSession',
    ) as {
      hydrateFlightTripSession: () => Promise<void>;
      hasFlightTripSession: () => boolean;
    };
    await hydrateFlightTripSession();
    skipWeatherForFlight =
      hasFlightTripSession() && shouldPreserveFlightTripSession(userText);
  } catch {
    /* soft */
  }

  if (!skipWeatherForFlight) {
  try {
    const { fetchAndFormatWeatherVoice } = require('../../services/ui/weatherDayPlanSpeech') as {
      fetchAndFormatWeatherVoice: (o: {
        userText: string;
        cityHint?: string | null;
      }) => Promise<{ speech: string; bullets: string[] } | null>;
    };
    const wxFast = await fetchAndFormatWeatherVoice({
      userText,
      cityHint: input.cityHint,
    });
    if (wxFast?.speech?.trim()) {
      const bridge = sanitizeBridgeText(input.bridgeFromRouter);
      const speech = wxFast.speech.slice(0, FINDUS_TYPICAL_SPEECH_MAX_CHARS);
      const bullets = wxFast.bullets.slice(0, 3);
      let cardTitle: string | null = null;
      try {
        const { deriveSpickzettelTitle } = require('../../services/concierge/spickzettelTitle') as {
          deriveSpickzettelTitle: (o: {
            userText?: string | null;
            speech?: string | null;
            bullets?: string[] | null;
            cityHint?: string | null;
          }) => string;
        };
        cardTitle = deriveSpickzettelTitle({
          userText,
          speech,
          bullets,
          cityHint: input.cityHint,
        });
      } catch {
        cardTitle = null;
      }
      return {
        speech,
        bullets,
        buttons: [],
        bridgeSpoken: bridge,
        blueprintId: 'weather',
        personaVariant: input.personaVariant || 'default',
        needsResearch: 'quick',
        celestial: false,
        nextHandoff: null,
        cardTitle,
      };
    }
  } catch {
    /* soft — normaler Chat-Pfad */
  }
  }

  const antiNightlife = isCelestialOrSkyQuery(userText);
  const quick = isQuickLookupQuery(userText);

  let eventDeep = false;
  try {
    const { isEventResearchQuery } = require('../../services/concierge/eventResearchService') as {
      isEventResearchQuery: (s: string) => boolean;
    };
    eventDeep = !antiNightlife && isEventResearchQuery(userText);
  } catch {
    eventDeep =
      !antiNightlife &&
      /\b(was geht|events?|heute\s+abend|party|feiern|schlagermove)\b/iu.test(
        userText,
      );
  }

  let placeGo = false;
  let forbidQuick = false;
  try {
    const { isPlaceGoQuery, shouldForbidQuickChat } = require('../router/placeGoQuery') as {
      isPlaceGoQuery: (s: string) => boolean;
      shouldForbidQuickChat: (s: string) => boolean;
    };
    placeGo = isPlaceGoQuery(userText);
    forbidQuick = shouldForbidQuickChat(userText);
  } catch {
    placeGo = false;
    forbidQuick = false;
  }

  const bp = resolveBlueprintForText({
    userText,
    blueprintId: input.blueprintId,
    nearestBlueprint: input.nearestBlueprint,
    stage: input.blueprintStage,
  });
  const skyBp = bp.blueprintId === 'sky_phenomenon';
  let outfitWeather = false;
  try {
    const { looksLikeOutfitOrWeatherUtterance } = require('../planning/planUtteranceGate') as {
      looksLikeOutfitOrWeatherUtterance: (s: string) => boolean;
    };
    outfitWeather = looksLikeOutfitOrWeatherUtterance(userText);
  } catch {
    outfitWeather = false;
  }

  // Sky-Blaupause: pack + Wetter (nicht Vorcheck-quick — Erinnern/Wolken brauchen Kontext)
  let needsResearch: ResearchDepth = eventDeep || placeGo
    ? 'deep'
    : skyBp || forbidQuick
      ? 'pack'
      : input.needsResearch || (quick ? 'quick' : 'pack');
  if (quick && !skyBp && !eventDeep && !placeGo && !forbidQuick) {
    needsResearch = 'quick';
  }
  try {
    const {
      looksLikeSmalltalkCompanion,
      isSmalltalkCompanionActive,
      shouldAbortCompanionForTravel,
    } = require('../../services/handsFree/smalltalkCompanionMode') as {
      looksLikeSmalltalkCompanion: (t: string) => boolean;
      isSmalltalkCompanionActive: () => boolean;
      shouldAbortCompanionForTravel: (t: string) => boolean;
    };
    if (
      !shouldAbortCompanionForTravel(userText) &&
      (looksLikeSmalltalkCompanion(userText) ||
        isSmalltalkCompanionActive() ||
        input.needsResearch === 'quick')
    ) {
      needsResearch = 'quick';
    }
  } catch {
    /* soft */
  }
  try {
    const { wantsFerryOperatorSite } = require('../../services/transit/ferryTicketResearch') as {
      wantsFerryOperatorSite: (s: string) => boolean;
    };
    if (wantsFerryOperatorSite(userText) && needsResearch === 'quick') {
      needsResearch = 'pack';
    }
  } catch {
    /* soft */
  }

  // Live-Chat: Fast-Lane; Deep Research nur wenn der User sie ausdrücklich will
  let deferredDeepAsk = false;
  const liveTurn = isLiveChatTurnActive();
  try {
    const live = getLiveChatTurnContext();
    if (live.active && live.askBeforeDeepResearch) {
      const userForcedDeep = wantsExplicitDeepResearch(userText);
      if (userForcedDeep) {
        needsResearch = 'deep';
        deferredDeepAsk = false;
      } else if (needsResearch === 'deep' && !quick) {
        deferredDeepAsk = true;
        needsResearch = placeGo || eventDeep || skyBp || forbidQuick ? 'pack' : 'quick';
      } else if (
        !placeGo &&
        !eventDeep &&
        !skyBp &&
        !forbidQuick &&
        needsResearch === 'pack'
      ) {
        needsResearch = 'quick';
      }
    }
  } catch {
    /* soft */
  }

  const persona = resolvePersonaVariant();
  const personaVariant = input.personaVariant || persona.variant;

  const learnedPromise =
    needsResearch === 'quick'
      ? Promise.resolve([] as string[])
      : getLearnedFactBriefs({
          blueprintId: bp.blueprintId,
          personaVariant,
        });
  if (bp.blueprintId) {
    void recordLearnSignal({
      blueprintId: bp.blueprintId,
      personaVariant,
      userText,
      cityHint: input.cityHint,
    });
  }

  const bridge = sanitizeBridgeText(input.bridgeFromRouter);

  const toolCtxPromise =
    needsResearch === 'quick' && !forbidQuick && !outfitWeather
      ? Promise.resolve(
          [
            input.cityHint ? `CITY: ${input.cityHint}` : '',
            `DATUM_LOKAL: ${new Date().toISOString()}`,
          ]
            .filter(Boolean)
            .join('\n'),
        )
      : gatherToolContext({
          userText,
          needsResearch: needsResearch === 'quick' ? 'pack' : needsResearch,
          wantWeather: skyBp || outfitWeather,
          cityHint: input.cityHint,
        });

  const [learned, toolCtx] = await Promise.all([learnedPromise, toolCtxPromise]);

  const bpBlock = bp.contract
    ? [
        `BLAUPAUSE: ${bp.contract.id}/${bp.contract.stage} — ${bp.contract.label}`,
        bp.contract.description,
        ...(bp.contract.actionRules || []).map((r) => `ActionRule: ${r}`),
        ...(bp.contract.defaultTasks || []).map(
          (t) => `Task[${t.priority}]: ${t.brief}`,
        ),
        bp.adaptBrief ? `ADAPT: ${bp.adaptBrief}` : '',
      ]
        .filter(Boolean)
        .join('\n')
    : 'BLAUPAUSE: keine — Concierge-Chat.';

  const learnedBlock = learned.length
    ? `GELERNTE SLOTS:\n${learned.map((l) => `- ${l}`).join('\n')}`
    : '';

  let speech = '';
  let bullets: string[] = [];
  let buttons: Module2ActionButton[] = [];
  let nextHandoff: ChatLaneResult['nextHandoff'] = null;
  let weatherOkOutdoor = false;
  let wantsReminder = false;
  let localShowHint: string | null = null;

  const applyLiveWeatherBoard = (): boolean => {
    try {
      const { looksLikeOutfitOrWeatherUtterance, weatherAskIsFutureDay } = require('../planning/planUtteranceGate') as {
        looksLikeOutfitOrWeatherUtterance: (s: string) => boolean;
        weatherAskIsFutureDay: (s: string) => boolean;
      };
      const { looksLikePicnicQuery } = require('../pitch/picnicIntent') as {
        looksLikePicnicQuery: (s: string) => boolean;
      };
      if (!looksLikeOutfitOrWeatherUtterance(userText) || looksLikePicnicQuery(userText)) {
        return false;
      }
      // Fremde Stadt / „da“ → Sync-Cache (GPS) nicht nehmen — fetchAndFormatWeatherVoice geocodet
      try {
        const {
          resolveWeatherPlaceTarget,
        } = require('../../services/ui/weatherDayPlanSpeech') as {
          resolveWeatherPlaceTarget: (
            t: string,
            h?: string | null,
          ) => { useGps: boolean; namedCity: boolean };
        };
        const place = resolveWeatherPlaceTarget(userText, input.cityHint);
        if (!place.useGps || place.namedCity) return false;
      } catch {
        /* soft — Cache ok */
      }
      const { getCachedWeatherSnapshot } = require('../../services/weatherService') as {
        getCachedWeatherSnapshot: () => {
          currentTempC?: number | null;
          dayHighC?: number | null;
          precipitationMm?: number | null;
          nextRainProb?: number | null;
          rainStartsInMin?: number | null;
          nextRainAtMs?: number | null;
          summaryLine?: string | null;
          isHeavyRain?: boolean;
          tomorrowSummary?: string | null;
          weatherCode?: number | null;
        } | null;
      };
      const {
        formatWeatherPresentation,
        formatTomorrowWeatherChat,
        weatherOkOutdoorFromSnap,
      } = require('../../services/ui/weatherDayPlanSpeech') as {
        formatWeatherPresentation: (o: {
          snap: unknown;
          heavy: boolean;
          soon: boolean;
        }) => { speech: string; bullets: string[] };
        formatTomorrowWeatherChat: (snap: unknown) => {
          speech: string;
          bullets: string[];
        };
        weatherOkOutdoorFromSnap: (snap: unknown) => boolean;
      };
      const snap = getCachedWeatherSnapshot();
      if (!snap) return false;

      if (weatherAskIsFutureDay(userText)) {
        const tom = formatTomorrowWeatherChat(snap);
        if (!tom.speech.trim()) return false;
        speech = tom.speech.slice(0, FINDUS_TYPICAL_SPEECH_MAX_CHARS);
        bullets = tom.bullets.slice(0, 3);
        weatherOkOutdoor = weatherOkOutdoorFromSnap(snap);
        wantsReminder = false;
        localShowHint = null;
        nextHandoff = null;
        return true;
      }

      const heavy = Boolean(snap.isHeavyRain);
      const soon =
        (typeof snap.rainStartsInMin === 'number' && snap.rainStartsInMin <= 180) ||
        (typeof snap.nextRainProb === 'number' && snap.nextRainProb >= 40);
      const wx = formatWeatherPresentation({
        snap,
        heavy,
        soon,
        cityHint: input.cityHint,
      });
      speech = wx.speech.slice(0, FINDUS_TYPICAL_SPEECH_MAX_CHARS);
      bullets = wx.bullets.slice(0, 3);
      weatherOkOutdoor = weatherOkOutdoorFromSnap(snap);
      wantsReminder = false;
      localShowHint = null;
      nextHandoff = null;
      return Boolean(speech);
    } catch {
      return false;
    }
  };

  const liveWeatherDone = applyLiveWeatherBoard();

  let cityRegelwerk = '';
  try {
    const { buildCityChatRegelwerk } = require('../context/cityChatRegelwerk') as {
      buildCityChatRegelwerk: (i?: {
        userText?: string;
        cityHint?: string | null;
        cityKey?: string | null;
        maxRecentTurns?: number;
        skipStickyThread?: boolean;
      }) => string;
    };
    const scope = input.topicScope;
    const turns =
      scope?.mode === 'new' || (scope?.turnsForCall2 ?? 0) <= 0
        ? 0
        : Math.max(1, Math.min(10, scope?.turnsForCall2 ?? 3));
    cityRegelwerk = buildCityChatRegelwerk({
      userText,
      cityHint: input.cityHint,
      cityKey: input.cityKey,
      maxRecentTurns: turns,
      skipStickyThread: turns === 0,
    }).slice(0, 1800);
  } catch {
    cityRegelwerk = '';
  }
  if (outfitWeather) {
    try {
      const { weatherOutfitLookupTips } = require('../planning/planUtteranceGate') as {
        weatherOutfitLookupTips: (s: string) => string;
      };
      cityRegelwerk = [cityRegelwerk, weatherOutfitLookupTips(userText)]
        .filter(Boolean)
        .join('\n');
    } catch {
      /* soft */
    }
  }
  try {
    const { formatSynthesisRailsForPrompt } = require('../speech/synthesisRails') as {
      formatSynthesisRailsForPrompt: (s: string) => string;
    };
    const rails = formatSynthesisRailsForPrompt(userText);
    if (rails) {
      cityRegelwerk = [cityRegelwerk, rails].filter(Boolean).join('\n');
    }
  } catch {
    /* soft */
  }
  if (quick) {
    cityRegelwerk = [
      'WELTWISSEN: Das ist eine Faktenfrage, kein Stadt-Pack-Treffer.',
      'Nicht aus dem Offline-Katalog antworten. Nicht navigieren. Nicht Prisdorf/Stadt erfinden.',
      'Kurze belegte Antwort (Alter/Zahl/Name). Google Search nutzen.',
      'Kompakt: max 1–2 Sätze Speech. Stichpunkte: klare Ziffern (ca. 2300, nicht „2“ + „297“).',
      /\d+\s*(?:\+|plus|minus|-)\s*\d+/iu.test(userText)
        ? 'Rechenfrage: nur die Ergebniszahl, kein Theater.'
        : '',
    ]
      .filter(Boolean)
      .join(' ');
  }

  if (!liveWeatherDone && hasAnyChatLlm() && needsResearch === 'quick') {
    try {
      let companionBlock = '';
      try {
        const {
          looksLikeSmalltalkCompanion,
          isSmalltalkCompanionActive,
          getCompanionPersonaNotes,
        } = require('../../services/handsFree/smalltalkCompanionMode') as {
          looksLikeSmalltalkCompanion: (t: string) => boolean;
          isSmalltalkCompanionActive: () => boolean;
          getCompanionPersonaNotes: () => string[];
        };
        const { FINDUS_SMALLTALK_COMPANION_BLOCK } = require('../../services/concierge/findusResponsePolicy') as {
          FINDUS_SMALLTALK_COMPANION_BLOCK: string;
        };
        const { formatUserNamePromptRule } = require('../../services/persona/userNameThrottle') as {
          formatUserNamePromptRule: (n: string | null) => string;
        };
        const { getCachedUserProfile } = require('../../services/userProfileService') as {
          getCachedUserProfile: () => { firstName?: string | null } | null;
        };
        if (
          looksLikeSmalltalkCompanion(userText) ||
          isSmalltalkCompanionActive()
        ) {
          const notes = getCompanionPersonaNotes();
          companionBlock = [
            FINDUS_SMALLTALK_COMPANION_BLOCK,
            formatUserNamePromptRule(
              getCachedUserProfile()?.firstName?.trim() || null,
            ),
            notes.length
              ? `Gesprächs-Notizen:\n- ${notes.join('\n- ')}`
              : '',
            'KEINE Google-Suche / keine Orte / keine Preise — nur emotionaler Companion.',
          ]
            .filter(Boolean)
            .join('\n');
        }
      } catch {
        companionBlock = '';
      }
      const fastPrompt = [
        'Du bist Yorro. Answer-First, Deutsch.',
        buildPersonalityMatrixPromptBlock(getCachedUserProfile()),
        companionBlock || FINDUS_SPEECH_LENGTH_BLOCK,
        liveTurn && !companionBlock ? FINDUS_LIVE_CHAT_HUMAN_BLOCK : '',
        companionBlock ? '' : FINDUS_BRIDGE_CONTINUITY_BLOCK,
        companionBlock
          ? ''
          : 'Trivia/Fakten: direkte Zahl/Name zuerst; 1–2 belegte Fun-Facts ok; KEINE Regie/Stimm-Anweisungen im Text; Bridge nicht wiederholen.',
        companionBlock ? '' : WEITERDENKEN,
        companionBlock ? '' : cityRegelwerk,
        companionBlock ? '' : input.cityHint ? `Ort: ${input.cityHint}` : '',
        companionBlock ? '' : toolCtx,
        companionBlock,
        input.bridgeFromRouter && !companionBlock
          ? `BRIDGE_ALREADY: ${input.bridgeFromRouter}`
          : '',
        deferredDeepAsk
          ? 'LIVE-CHAT: kurze Antwort jetzt. Am Ende kurz anbieten, tiefer nachzuhaken (ohne Permission-Schleife) — Button kommt separat.'
          : '',
        '',
        'SPEECH: ...',
        'BULLET: ...',
        companionBlock ? '' : 'WANT_REMINDER: yes|no',
        companionBlock ? '' : 'LOCAL_SHOW: ...|none',
        '',
        `USER: ${userText.slice(0, 500)}`,
      ]
        .filter(Boolean)
        .join('\n');
      const raw = await generateGeminiText(fastPrompt, {
        task: 'generic',
        tier: 'lite',
        maxTokens: companionBlock ? 700 : 900,
        temperature: companionBlock ? 0.7 : 0.3,
        enableGoogleSearch:
          quick ||
          (!companionBlock && (!liveTurn || wantsExplicitDeepResearch(userText))),
        useFindusSystem: Boolean(companionBlock),
        signal: input.signal,
      });
      const text = (raw || '').trim();
      const speechM = text.match(
        /SPEECH:\s*([\s\S]*?)(?=\nBULLET:|\nWANT_|\nLOCAL_|$)/i,
      );
      speech = (speechM?.[1] || text)
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, FINDUS_TYPICAL_SPEECH_MAX_CHARS);
      speech = stripChatLaneMeta(speech);
      bullets = [...text.matchAll(/BULLET:\s*(.+)/giu)]
        .map((m) => stripChatLaneMeta(m[1]!.trim()).slice(0, 100))
        .filter(Boolean)
        .slice(0, 3);
      wantsReminder = /\bWANT_REMINDER:\s*yes\b/i.test(text);
      const showM = text.match(/LOCAL_SHOW:\s*(.+)/i);
      const showRaw = showM?.[1]?.trim() || '';
      if (showRaw && !/^none$/i.test(showRaw)) localShowHint = showRaw.slice(0, 80);
    } catch {
      /* soft */
    }
  } else if (!liveWeatherDone && hasAnyChatLlm()) {
    const prompt = [
      'Du bist Yorro Chat-Lane. Answer-First.',
      FINDUS_DYNAMIC_STRUCTURE_DOCTRINE,
      FINDUS_SYNTHESIS_RAIL_BLOCK,
      FINDUS_FEW_SHOT_DISCLAIMER,
      FINDUS_ANSWER_FIRST_BLOCK,
      FINDUS_SPEECH_LENGTH_BLOCK,
      FINDUS_CORE_WOVEN_SPEECH_BLOCK,
      FINDUS_BRIDGE_CONTINUITY_BLOCK,
      FINDUS_JUST_DO_IT_BLOCK,
      buildPersonalityMatrixPromptBlock(getCachedUserProfile()),
      liveTurn ? FINDUS_LIVE_CHAT_HUMAN_BLOCK : '',
      placeGo ? FINDUS_ACTIVITY_BEACH_DEST_BLOCK : '',
      cityRegelwerk,
      '',
      'JSON only:',
      '{ "speech": string, "bullets": string[], "actions": [{id,label,url?,textPrompt?}], "nextHandoff": "pitch"|"nav"|"plan"|"events"|null, "weatherOkOutdoor": boolean, "wantsReminder": boolean, "localShowHint": string|null }',
      '',
      placeGo || forbidQuick
        ? '- speech: durchgehender Fließtext (Persona aus Einstellungen), klare Empfehlung + was einen erwartet + Distanz wenn bekannt. Gesamtpaket, nicht aufblähen. 1–3 bullets. Nie „Soll ich raussuchen?“.'
        : `- speech: durchgehender Fließtext, mündlich, Persona aus den Einstellungen. ${FINDUS_SPEECH_LENGTH_BLOCK}`,
      '- bullets: max 3, Zahlen als Ziffern (27. März 1986, 39 Jahre). Speech darf ausschreiben. Alter-Frage → Alter-Stichpunkt.',
      '- actions nur echte URLs oder Erinnern mit konkretem Ort/Zeit (sonst kein Reminder)',
      /fähr|faehr|ferry/iu.test(userText)
        ? '- Fähre/Tickets: actions OPEN_URL zur belegten Reederei-/Ticketseite aus TOOL_CONTEXT (nicht bahn.de-Tafeln).'
        : '',
      WEITERDENKEN,
      input.fromPlanContext
        ? '- Plan-Kontext: Wissen beantworten; Reminder nur mit Ort/Zeit-Anker'
        : '',
      personaPromptBlock({ ...persona, variant: personaVariant }),
      bpBlock,
      learnedBlock,
      input.openIntentsSummary
        ? `OFFENE INTENTS: ${input.openIntentsSummary}`
        : '',
      toolCtx ? `TOOL_CONTEXT:\n${toolCtx}` : '',
      input.bridgeFromRouter
        ? `BRIDGE_ALREADY: ${input.bridgeFromRouter}`
        : '',
      '',
      `USER: ${userText.slice(0, 700)}`,
    ]
      .filter(Boolean)
      .join('\n');

    try {
      const raw = await generateGeminiText(prompt, {
        task: 'generic',
        tier: needsResearch === 'deep' ? 'pro' : 'lite',
        maxTokens: 1200,
        temperature: 0.45,
        responseJson: true,
        jsonMimeOnly: true,
        useFindusSystem: false,
        enableGoogleSearch: /\b(wetter|temperatur)\b/iu.test(userText),
        signal: input.signal,
      });
      const parsed = parseJsonObject(raw || '');
      if (parsed) {
        speech = stripChatLaneMeta(
          String(parsed.speech || '')
            .trim()
            .slice(0, FINDUS_TYPICAL_SPEECH_MAX_CHARS),
        );
        bullets = Array.isArray(parsed.bullets)
          ? parsed.bullets
              .map((b) => stripChatLaneMeta(String(b)).slice(0, 120))
              .filter(Boolean)
              .slice(0, 5)
          : [];
        buttons = asButtons(parsed.actions);
        const nh = String(parsed.nextHandoff || '');
        if (nh === 'pitch' || nh === 'nav' || nh === 'plan' || nh === 'events') {
          nextHandoff = nh;
        }
        weatherOkOutdoor = parsed.weatherOkOutdoor === true;
        wantsReminder = parsed.wantsReminder === true;
        if (
          typeof parsed.localShowHint === 'string' &&
          parsed.localShowHint.trim()
        ) {
          localShowHint = parsed.localShowHint.trim().slice(0, 80);
        }
      }
    } catch {
      /* soft */
    }
  }

  speech = stripChatLaneMeta(speech);
  if (!liveWeatherDone) applyLiveWeatherBoard();
  try {
    const { looksLikeOutfitOrWeatherUtterance } = require('../planning/planUtteranceGate') as {
      looksLikeOutfitOrWeatherUtterance: (s: string) => boolean;
    };
    if (looksLikeOutfitOrWeatherUtterance(userText)) {
      const { getCachedWeatherSnapshot } = require('../../services/weatherService') as {
        getCachedWeatherSnapshot: () => unknown;
      };
      const { weatherOkOutdoorFromSnap } = require('../../services/ui/weatherDayPlanSpeech') as {
        weatherOkOutdoorFromSnap: (s: unknown) => boolean;
      };
      const snap = getCachedWeatherSnapshot();
      if (snap) weatherOkOutdoor = weatherOkOutdoorFromSnap(snap);
    }
  } catch {
    /* soft */
  }

  if (speech) {
    try {
      const { isHtmlScrapeFailureSpeech } = require('../../services/research/htmlResearchGate') as {
        isHtmlScrapeFailureSpeech: (s: string) => boolean;
      };
      if (isHtmlScrapeFailureSpeech(speech)) speech = '';
    } catch {
      /* soft */
    }
  }
  if (!speech && toolCtx.includes('WEB_DRAFT:')) {
    const draft =
      toolCtx.split('WEB_DRAFT:')[1]?.split('\n')[0]?.trim() || '';
    try {
      const { isHtmlScrapeFailureSpeech } = require('../../services/research/htmlResearchGate') as {
        isHtmlScrapeFailureSpeech: (s: string) => boolean;
      };
      if (draft && !isHtmlScrapeFailureSpeech(draft)) {
        speech = draft.slice(0, FINDUS_TYPICAL_SPEECH_MAX_CHARS);
      }
    } catch {
      speech = draft.slice(0, FINDUS_TYPICAL_SPEECH_MAX_CHARS);
    }
  }
  if (!speech && toolCtx.includes('WETTER:')) {
    const raw = toolCtx.split('WETTER:')[1]?.split('\n')[0]?.trim() || '';
    const looksInternal = /temp=\?|feels=\?|precip=\?|summary=\s*$/i.test(raw);
    const human = raw
      .replace(/^WETTER:\s*/i, '')
      .replace(/\blage=/gi, '')
      .replace(/\bmorgen=/gi, 'Morgen ')
      .replace(/\bregenchance=/gi, 'Regenchance ')
      .replace(/\s*·\s*/g, '. ')
      .replace(/===.*?===/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (human && !looksInternal && !/[a-z_]+=/.test(human)) {
      speech = human.slice(0, FINDUS_TYPICAL_SPEECH_MAX_CHARS);
    } else if (human && !looksInternal) {
      speech = human
        .replace(/[a-z_]+=/gi, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, FINDUS_TYPICAL_SPEECH_MAX_CHARS);
    }
  }
  if (!speech) {
    speech = isRucksackOffline()
      ? OFFLINE_SPEECH
      : 'Die Online-KI hängt gerade — nicht dein Netz. Frag in einem Satz nochmal, ich nutze den Reserve-Kanal.';
  }

  const offer = pickButlerOffer({
    userText,
    speech,
    weatherOkOutdoor,
    needsClarify: false,
    wantsReminder: wantsReminder || skyBp,
    localShowHint,
  });
  speech = mergeOfferIntoSpeech(speech, offer);
  const softLookupBeforeStrip = (() => {
    try {
      const { detectSoftLookupOffer } = require('../../services/concierge/justDoItPolicy') as {
        detectSoftLookupOffer: (s: string) => boolean;
      };
      return detectSoftLookupOffer(speech) || deferredDeepAsk;
    } catch {
      return deferredDeepAsk;
    }
  })();
  try {
    const { stripPermissionLookupAsks, rewriteSiezenToDu } = require('../../services/concierge/justDoItPolicy') as {
      stripPermissionLookupAsks: (s: string) => string;
      rewriteSiezenToDu: (s: string) => string;
    };
    speech = rewriteSiezenToDu(stripPermissionLookupAsks(speech));
  } catch {
    /* soft */
  }
  if (offer?.button) buttons = [...buttons, offer.button].slice(0, 4);
  try {
    const { normalizeLookupShowMoreLabel } = require('../../services/concierge/justDoItPolicy') as {
      normalizeLookupShowMoreLabel: (lab: string, tp?: string | null) => string;
    };
    buttons = buttons.map((b) => {
      if ((b as { type?: string }).type !== 'SHOW_MORE') return b;
      const lab = String((b as { label?: string }).label ?? '');
      const tp =
        (b as { payload?: { textPrompt?: string } }).payload?.textPrompt ??
        (b as { payload?: { data?: { textPrompt?: string } } }).payload?.data
          ?.textPrompt ??
        null;
      const next = normalizeLookupShowMoreLabel(lab, tp);
      if (next === lab) return b;
      return { ...b, label: next };
    });
  } catch {
    /* soft */
  }
  const hasLookupBtn = buttons.some((b) => {
    const lab = String((b as { label?: string }).label ?? '').toLowerCase();
    const tp = String(
      (b as { payload?: { textPrompt?: string; data?: { textPrompt?: string } } })
        .payload?.textPrompt ??
        (b as { payload?: { data?: { textPrompt?: string } } }).payload?.data
          ?.textPrompt ??
        '',
    ).toLowerCase();
    return (
      /schau\s*nach|recherch|meldungen|tiefer/i.test(lab) ||
      /recherch|nachschau|aktuell/i.test(tp)
    );
  });
  const softLookupOffer =
    softLookupBeforeStrip ||
    /\b(aktuell(?:e|en)?\s+(meldungen|news)|nachschauen|nachgucken|mehr\s+dazu|was\s+(gerade\s+)?los\s+ist|schau ich kurz live)\b/iu.test(
      speech,
    );
  if (deferredDeepAsk || (softLookupOffer && !hasLookupBtn)) {
    const deepPrompt = (
      softLookupOffer && !deferredDeepAsk
        ? `Schau kurz live nach und fass knapp zusammen, was aktuell dazu los ist: ${userText}`
        : `Recherchiere tiefer und fass die wichtigsten Live-Infos knapp zusammen: ${userText}`
    ).slice(0, 400);
    buttons = [
      ...buttons,
      {
        type: 'SHOW_MORE',
        label: 'schau nach',
        payload: { textPrompt: deepPrompt },
      },
    ].slice(0, 4);
  }
  if (offer?.kind === 'pitch' && !nextHandoff) nextHandoff = 'pitch';
  if (eventDeep && !nextHandoff) nextHandoff = 'events';
  if (placeGo && !nextHandoff) nextHandoff = 'pitch';

  try {
    setLastTopic(
      bp.blueprintId || (/\bwetter\b/iu.test(userText) ? 'weather' : 'chat'),
    );
  } catch {
    /* soft */
  }

  speech = speech.slice(0, FINDUS_TYPICAL_SPEECH_MAX_CHARS);

  try {
    const {
      wantsFerryOperatorSite,
      ferryTicketActionsFromResearch,
    } = require('../../services/transit/ferryTicketResearch') as {
      wantsFerryOperatorSite: (s: string) => boolean;
      ferryTicketActionsFromResearch: (o: {
        query: string;
        sources?: Array<{ url: string; title?: string | null }>;
        facts?: Array<{ sourceUrl?: string | null }>;
      }) => Array<{ type: string; label: string; payload: { url?: string } }>;
    };
    if (wantsFerryOperatorSite(userText)) {
      const { runWebResearch } = require('../../services/research/webResearchService') as {
        runWebResearch: (
          q: string,
          o?: { force?: boolean },
        ) => Promise<{
          sources?: Array<{ url: string; title?: string | null }>;
          facts?: Array<{ sourceUrl?: string | null }>;
        } | null>;
      };
      const wr = await runWebResearch(userText);
      const acts = wr
        ? ferryTicketActionsFromResearch({
            query: userText,
            sources: wr.sources,
            facts: wr.facts,
          })
        : [];
      const seenUrl = new Set(
        buttons
          .map((b) =>
            typeof b.payload === 'object' && b.payload && 'url' in b.payload
              ? String((b.payload as { url?: string }).url || '')
              : '',
          )
          .filter(Boolean),
      );
      for (const a of acts) {
        const url = a.payload.url;
        if (!url || seenUrl.has(url)) continue;
        seenUrl.add(url);
        buttons.unshift({
          id: `ferry_tix_${buttons.length}`,
          label: a.label,
          payload: { kind: 'deep_link', url },
        });
      }
      buttons = buttons.slice(0, 4);
    }
  } catch {
    /* soft */
  }

  if (outfitWeather && nextHandoff === 'plan') {
    nextHandoff = null;
  }

  return {
    speech,
    bullets,
    buttons,
    bridgeSpoken: bridge,
    blueprintId: bp.blueprintId,
    personaVariant,
    needsResearch,
    celestial: antiNightlife,
    nextHandoff,
    cardTitle: (() => {
      try {
        const { deriveSpickzettelTitle } = require('../../services/concierge/spickzettelTitle') as {
          deriveSpickzettelTitle: (o: {
            userText?: string | null;
            speech?: string | null;
            bullets?: string[] | null;
          }) => string;
        };
        return deriveSpickzettelTitle({
          userText,
          speech,
          bullets,
          cityHint: input.cityHint,
        });
      } catch {
        return null;
      }
    })(),
  };
}

export function shouldUseChatLane(opts: {
  lane: string;
  userText: string;
  route?: string | null;
}): boolean {
  try {
    const { mustSkipChatLane } = require('../router/liveInventoryGate') as {
      mustSkipChatLane: (t: string) => boolean;
    };
    if (mustSkipChatLane(opts.userText)) return false;
  } catch {
    /* soft */
  }
  try {
    const { wantsTaxiRide } = require('../../services/mobility/taxiRideIntent') as {
      wantsTaxiRide: (s: string) => boolean;
    };
    if (wantsTaxiRide(opts.userText)) return false;
  } catch {
    /* soft */
  }
  if (opts.lane === 'chat') return true;
  if (
    opts.lane === 'nav' ||
    opts.lane === 'm1' ||
    opts.lane === 'plan' ||
    opts.lane === 'pitch'
  ) {
    return false;
  }
  if (isQuickLookupQuery(opts.userText)) return true;
  if (isCelestialOrSkyQuery(opts.userText)) return true;
  const r = opts.route || '';
  return r === 'blueprint' || r === 'smalltalk' || r === 'memory' || !r;
}
