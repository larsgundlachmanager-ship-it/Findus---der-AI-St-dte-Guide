/**
 * Modul 2 — Fragen & Rückfragen (Phase 5).
 * User voice/text → interrupt TTS → offline-first → Gemini → actions.
 */

import { getPoiWithFacts } from '../db/database';
import { buildFindusSystemPrompt, buildPoiResearchContext } from '../constants/prompts';
import { FOLLOW_UP_ANSWER_RULES_DE } from '../services/audioGuideScript';
import {
  consumeGeminiCreditsWarning,
  hasGeminiApiKey,
} from '../services/geminiService';
import { questionStylePromptHint } from '../services/questionStyleService';
import {
  lowChatterPromptBlock,
  isLowChatterActive,
} from '../services/persona/lowChatterMode';
import { empathyEnginePromptBlock } from '../services/persona/empathyEngine';
import { formatSessionMemoryForPrompt, formatHolisticDayContextForPrompt } from '../services/ai/sessionMemory';
import { formatGpsTrackForPrompt } from '../services/navigation/gpsTrackBuffer';
import { formatUserMemoryForPrompt } from '../store/useUserMemoryStore';
import { buildTravelModePromptBlock } from '../services/navigation/travelModeContext';
import {
  applyConciergeNavOffers,
  isConciergeQuery,
  prepareConciergeContext,
  type ConciergeContext,
} from '../services/concierge/conciergeContext';
import {
  enrichWithConciergeOffers,
  presentConciergeResponse,
} from '../services/concierge/presentConcierge';
import { reflectAndSyncConciergeActions } from '../services/concierge/actionButtonSync';
import { runConciergeTwoPass } from '../services/concierge/conciergeTwoPass';
import {
  CONCIERGE_JSON_INSTRUCTION,
  wrapPlainAsConcierge,
} from '../services/concierge/parseConciergeResponse';
import { findusConstitutionBlock } from '../services/concierge/findusResponsePolicy';
import { applyHardGuardrails } from '../services/agi/speechGuardrails';
import { applyActionButtonJudge } from '../services/agi/actionButtonJudge';
import { isDeviceOffline } from '../services/navigation/networkState';
import { isStopNavigationIntent } from '../services/navigation';
import { useFinnusStore } from '../store/useFinnusStore';
import type { GeminiConciergeResponse } from '../types/concierge';
import {
  applyReservationIntel,
  evaluateReservationIntel,
  reservationIntelPromptBlock,
} from './reservationIntel';
import { buildConciergeFeatureTipsPromptBlock } from './featureTipsModule';
import { speakRuntimeText } from './speechModule';
import { getVoiceSettingsForTour } from '../services/ttsService';
import {
  generateUniversalFallbackReply,
} from './approachVisualCue';

export type ConciergeQuestionOpts = {
  withSide?: (reply: string) => string;
  blockAutoNav?: boolean;
  navSnapshot?: { navActive: boolean; navVisible: boolean } | null;
  inputKind?: 'user_voice' | 'user_text';
};

function buildOfflineConciergeReply(opts: {
  conciergeCtx: ConciergeContext | null;
}): GeminiConciergeResponse {
  const { conciergeCtx } = opts;
  const store = useFinnusStore.getState();
  const currentPlace = store.currentLocationName;
  const pending = store.pendingNavOffer;

  if (conciergeCtx?.fallbackSpeech?.trim()) {
    return wrapPlainAsConcierge(conciergeCtx.fallbackSpeech.trim(), {
      cardTitle:
        conciergeCtx.kind === 'reservation'
          ? 'Offline · Reservierung'
          : conciergeCtx.kind === 'food'
            ? 'Offline · Empfehlung'
            : 'Offline · Findus',
      visualBullets: conciergeCtx.fallbackBullets ?? [],
      quickActions: [],
    });
  }

  const intent = conciergeCtx?.kind ?? 'general';
  const target =
    conciergeCtx?.primaryOffer?.name ??
    currentPlace ??
    pending?.name ??
    null;

  const speechParts: string[] = ['Offline'];
  if (target) speechParts.push(`bei ${target}`);
  if (intent === 'food') speechParts.push('— lokale Orte und Navigation gehen weiter');
  else if (intent === 'reservation') {
    speechParts.push('— gespeicherte Infos nutzbar, Verfügbarkeit prüfe ich online nach');
  } else if (target) {
    speechParts.push('— gespeicherte Infos und Navigation gehen weiter');
  } else {
    speechParts.push('— Navigation und gespeicherte Orte gehen weiter');
  }

  const bullets = conciergeCtx?.fallbackBullets?.length
    ? conciergeCtx.fallbackBullets
    : pending?.name
      ? [`Navigation weiter möglich: ${pending.name}`]
      : [];

  return wrapPlainAsConcierge(speechParts.join(' '), {
    cardTitle:
      intent === 'reservation'
        ? 'Offline · Reservierung'
        : intent === 'food'
          ? 'Offline · Empfehlung'
          : 'Offline · Findus',
    visualBullets: bullets,
    quickActions: [],
  });
}

async function enrichReservationIfNeeded(
  response: GeminiConciergeResponse,
  text: string,
  ctx: ConciergeContext | null,
): Promise<GeminiConciergeResponse> {
  if (ctx?.kind !== 'reservation' || !ctx.primaryOffer?.poiId) {
    return response;
  }
  return applyReservationIntel(response, ctx.primaryOffer.poiId, text);
}

export async function handleConciergeQuestion(
  text: string,
  opts?: ConciergeQuestionOpts,
): Promise<void> {
  const withSide = opts?.withSide ?? ((s) => s);
  const blockAutoNav =
    (opts?.blockAutoNav ?? false) ||
    /\b(wie\s+sieht|mein\s+plan|ablauf\s+morgen|tagesplan)\b/iu.test(text);
  const navSnapshot = opts?.navSnapshot ?? null;

  const store = useFinnusStore.getState();
  store.setIsGenerating(true);

  try {
    const { stopSpeaking } = await import('../services/ttsService');
    void stopSpeaking();

    const live = useFinnusStore.getState();
    const history = live.chatHistory;
    const memory = formatSessionMemoryForPrompt({ entries: live.visitedHistory });
    const longTerm = formatUserMemoryForPrompt();
    const told = live.toldFactKeys.slice(-40).join(' | ');

    let poiBlock = '';
    if (live.currentPoiId != null) {
      const poi = await getPoiWithFacts(live.currentPoiId);
      if (poi) {
        poiBlock = `\n\n${buildPoiResearchContext(poi)}`;
      }
    }

    let conciergeCtx: ConciergeContext | null = null;
    let conciergeBlock = '';
    if (isConciergeQuery(text)) {
      conciergeCtx = await prepareConciergeContext(text);
      if (conciergeCtx) {
        conciergeBlock = `\n\n${conciergeCtx.promptBlock}`;
        if (!blockAutoNav) {
          applyConciergeNavOffers(conciergeCtx);
        }
      }
    }

    if (conciergeCtx?.kind === 'reservation' && conciergeCtx.primaryOffer?.poiId) {
      const poi = await getPoiWithFacts(conciergeCtx.primaryOffer.poiId);
      if (poi) {
        const intel = await evaluateReservationIntel(poi, text);
        conciergeBlock += `\n\n${reservationIntelPromptBlock(intel)}`;
      }
    }

    const intentBoundary = blockAutoNav
      ? `\n\n=== INTENT: POI_INFO (STRENG) ===\nDer User fragt nach Infos (Zeiten/Frühstück/Öffnungszeiten/…). Antworte nur informativ. KEINE START_NAVIGATION, kein „ich führ dich hin“, kein Kompass.`
      : '';

    const featureTipsBlock = await buildConciergeFeatureTipsPromptBlock();

    const openQuestionBlock = await (async () => {
      const { useOpenQuestionStore } = await import('../store/useOpenQuestionStore');
      await useOpenQuestionStore.getState().hydrate();
      const block = useOpenQuestionStore.getState().formatForPrompt();
      return block ? `\n\n${block}` : '';
    })();

    const system = `${buildFindusSystemPrompt()}

${FOLLOW_UP_ANSWER_RULES_DE}

${questionStylePromptHint()}

${buildTravelModePromptBlock()}

${lowChatterPromptBlock()}

${empathyEnginePromptBlock()}
${intentBoundary}

${featureTipsBlock}

${findusConstitutionBlock()}

## Session-Memory
${memory}

## Tageskontext (Deadlines, Plan, Tasks)
${formatHolisticDayContextForPrompt()}

## Bewegungskontext (letzte GPS-Fixes)
${formatGpsTrackForPrompt()}

## Langzeitgedächtnis (Hotels, Restaurants, Dwell-Stops)
${longTerm}

Bereits gesagte Fakt-Keys (nicht wiederholen): ${told || '—'}
${poiBlock}
${conciergeBlock}
${openQuestionBlock}

${CONCIERGE_JSON_INSTRUCTION}

Der User stellt eine Rückfrage. Fülle speechText für die Stimme — visualBullets/quickActions nur fürs Display.${
      isLowChatterActive()
        ? ' LOW-CHATTER: speechText max 1–2 kurze Sätze, nur Navi/Essenz.'
        : ''
    }`;

    const withPersona = [{ role: 'system' as const, content: system }, ...history];

    const offline = await isDeviceOffline();
    let response: GeminiConciergeResponse | null = null;

    if (!offline && hasGeminiApiKey()) {
      try {
        const twoPass = await runConciergeTwoPass({
          userText: text,
          messages: withPersona,
          conciergeCtx,
          maxTokens: isLowChatterActive() ? 280 : 900,
        });
        response = twoPass.response;
        if (twoPass.research.eventResearch && conciergeCtx) {
          conciergeCtx.eventResearch = twoPass.research.eventResearch;
          conciergeCtx.maxQuickActions = 4;
        }
        if (twoPass.research.webResearch && conciergeCtx) {
          conciergeCtx.webResearch = twoPass.research.webResearch;
        }
        if (__DEV__) {
          console.log(
            '[questions] two-pass',
            twoPass.pass1.subQuestions.map((q) => q.text).join(' | ') ||
              twoPass.pass1.userGoal,
          );
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const netLike = /network|fetch|internet|offline|timeout|connection/i.test(
          msg,
        );
        if (__DEV__) {
          console.warn('[questions] Gemini concierge failed:', err);
        }
        response = netLike
          ? buildOfflineConciergeReply({ conciergeCtx })
          : wrapPlainAsConcierge(
              (await generateUniversalFallbackReply({
                userQuestion: text,
                placeName: live.currentLocationName,
                intentKind: conciergeCtx?.kind ?? null,
              })) ??
                'Gemini antwortet gerade nicht sauber. Versuch es gleich noch einmal.',
            );
      }
    } else if (offline) {
      response = buildOfflineConciergeReply({ conciergeCtx });
      if (conciergeCtx?.kind === 'reservation' && conciergeCtx.primaryOffer?.poiId) {
        response = await applyReservationIntel(
          response,
          conciergeCtx.primaryOffer.poiId,
          text,
        );
      }
    } else if (!hasGeminiApiKey()) {
      response = wrapPlainAsConcierge(
        'Online-Antworten über Gemini sind gerade nicht konfiguriert. Offline kann ich dir aber mit Navigation und gespeicherten Infos helfen.',
      );
    }

    if (!response) {
      response = buildOfflineConciergeReply({ conciergeCtx });
    }

    response = await enrichWithConciergeOffers(response, conciergeCtx);
    response = await enrichReservationIfNeeded(response, text, conciergeCtx);

    // Pre-response self-reflection: Relevance + Button-Sync + Extra-Mile (PDF)
    try {
      const reflected = await reflectAndSyncConciergeActions(response, {
        eventResearch: conciergeCtx?.eventResearch ?? null,
        webResearch: conciergeCtx?.webResearch ?? null,
        userText: text,
      });
      response = reflected.response;
      if (reflected.maxActions > 0 && conciergeCtx) {
        conciergeCtx.maxQuickActions = Math.max(
          conciergeCtx.maxQuickActions ?? 0,
          reflected.maxActions,
        );
      }
      if (__DEV__ && reflected.notes.length) {
        console.log('[questions] reflection', reflected.notes.join(', '));
      }
    } catch (err) {
      if (__DEV__) console.warn('[questions] reflection failed', err);
    }

    if (blockAutoNav) {
      response = {
        ...response,
        quickActions: response.quickActions.filter(
          (a) => a.type !== 'START_NAVIGATION',
        ),
      };
      useFinnusStore.getState().setPendingNavOffer(null);
      useFinnusStore.getState().setPendingNavAlternatives([]);
    }

    response = {
      ...response,
      speechText: withSide(response.speechText),
    };

    // Pipeline nach Enrich/Sync:
    // LLM-Judge lief bereits EINMAL in runConciergeTwoPass — hier NUR sync Code (0ms LLM).
    {
      const judged = applyActionButtonJudge(response, { userText: text });
      response = judged.response;
      if (__DEV__ && judged.changed) {
        console.log(
          '[questions] action-button-judge (sync-only)',
          judged.notes
            .filter((n) => n.action !== 'kept')
            .map((n) => `${n.action}:${n.type}:${n.reason}`)
            .join(' | ') || 'changed',
        );
      }
    }

    // Hard Speech-Guardrails (sync, kein LLM) — letzte Linie vor UI/TTS
    {
      const guarded = applyHardGuardrails(response, { userText: text });
      response = guarded.response;
      if (__DEV__ && guarded.report.notes.length) {
        console.log('[questions] guardrails', guarded.report.notes.join(', '));
      }
    }

    // Billing-Warnung nach Gemini-Versuch (leeres Guthaben)
    {
      const billing = await consumeGeminiCreditsWarning();
      if (billing && !response.speechText.includes('KI-Guthaben')) {
        response = {
          ...response,
          speechText: `${billing} ${response.speechText}`,
          cardTitle: response.cardTitle || 'Hinweis',
          visualBullets: [
            'Gemini-Guthaben leer — bitte nachladen',
            ...response.visualBullets.slice(0, 5),
          ],
        };
      }
    }

    useFinnusStore.getState().addChatMessage({
      role: 'assistant',
      content: response.speechText,
    });
    useFinnusStore
      .getState()
      .addToldFactKeys([response.speechText.slice(0, 120)]);

    await presentConciergeResponse(response, {
      skipAutoNav: blockAutoNav,
      userText: text,
    });

    if (navSnapshot && !isStopNavigationIntent(text)) {
      useFinnusStore.getState().patchNavigation(navSnapshot);
    }
  } catch (error) {
    console.error('[questions] Concierge follow-up failed:', error);
    const live = useFinnusStore.getState();
    const fallback =
      (await generateUniversalFallbackReply({
        userQuestion: text,
        placeName: live.currentLocationName,
        intentKind: null,
      })) ?? 'Versuch es gleich noch einmal — ich bin noch da.';
    useFinnusStore.getState().addChatMessage({
      role: 'assistant',
      content: fallback,
    });
    const voiceSettings = await getVoiceSettingsForTour();
    await speakRuntimeText(fallback, {
      voiceId: voiceSettings.voiceId,
      speechRate: voiceSettings.speechRate,
    });
  } finally {
    useFinnusStore.getState().setIsGenerating(false);
  }
}
