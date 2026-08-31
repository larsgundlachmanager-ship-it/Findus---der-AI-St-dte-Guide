import { useCallback, useMemo, useState } from 'react';
import {
  isPartnerAffiliateAction,
} from '../../constants/legal';
import type { ConciergeCardState, QuickAction } from '../../types/concierge';
import {
  alertActionError,
  dismissConciergeCard,
  handleQuickAction,
  maybeRunActionAutoFollowUp,
} from '../../services/actionHandlerService';
import { interruptAndNavigateToDiscovery } from '../../services/navigation/contextualDiscovery';
import { useFinnusStore } from '../../store/useFinnusStore';
import { shouldShowConfirmationButton } from '../../services/concierge/speechAsksConfirmation';
import { isCityMapUrl } from '../../services/cityMapService';
import {
  MAX_EVENT_QUICK_ACTIONS,
  MAX_QUICK_ACTIONS,
} from '../../services/affiliate/prioritizeActions';
import { recordFindusActionClicked } from '../../services/feedback/executionTracking';

/** User tippt → Speech weg, außer Link/Buchung (Yorro redet weiter). Mic immer tot. */
async function abortAudioOnUserTap(action?: QuickAction): Promise<void> {
  // Antwort kam per UI → Rückfrage-Mic / Live-Listen sofort abbrechen
  try {
    const {
      abortListenSessionForUiChoice,
    } = await import('../../services/handsFree/scheduleMicAfterAsk');
    await abortListenSessionForUiChoice(
      action ? `ui_${action.type}` : 'ui_choice',
    );
  } catch {
    /* soft */
  }
  try {
    const {
      shouldKeepTalkingOnAction,
      armLinkBackgroundSpeech,
    } = require('../../services/speech/backgroundSpeechPolicy') as {
      shouldKeepTalkingOnAction: (t: string) => boolean;
      armLinkBackgroundSpeech: (o?: { reason?: string }) => void;
    };
    if (action && shouldKeepTalkingOnAction(action.type)) {
      armLinkBackgroundSpeech({ reason: action.type });
      return;
    }
  } catch {
    /* soft */
  }
  try {
    const { stopVoiceOnUserTap } = await import(
      '../../module2/speech/speechQueue'
    );
    await stopVoiceOnUserTap();
  } catch {
    /* soft */
  }
}

export function pickYesTarget(
  actions: QuickAction[],
  speech: string,
): QuickAction | null {
  if (/\b(karte|ortsplan|inselplan|inselkarte)\b/iu.test(speech)) {
    const map = actions.find(
      (a) => a.type === 'OPEN_URL' && isCityMapUrl(a.payload.url),
    );
    if (map) return map;
  }
  const nav = actions.find((a) => a.type === 'START_NAVIGATION');
  if (nav) return nav;
  const wake = actions.find((a) => a.type === 'SET_WAKE_ALARM');
  if (wake) return wake;
  const partner = actions.find((a) => isPartnerAffiliateAction(a));
  if (partner) return partner;
  const reserve = actions.find(
    (a) =>
      a.type === 'CONFIRM_API_RESERVATION' ||
      a.type === 'SEND_RESERVATION_EMAIL' ||
      a.type === 'TRIGGER_AI_CALL',
  );
  return reserve ?? null;
}

export function yesButtonLabel(
  target: QuickAction | null,
  speech: string,
): string {
  if (target?.type === 'START_NAVIGATION') {
    const name = target.label
      .replace(/^📍\s*/u, '')
      .replace(/^Route:\s*/i, '')
      .trim();
    if (name && name.length <= 22) {
      return `Ja, zu ${name}`;
    }
    return 'Ja, Navigation starten';
  }
  if (target?.type === 'SET_WAKE_ALARM') {
    return target.label?.startsWith('Wecker')
      ? `Ja, ${target.label}`
      : 'Ja, Wecker stellen';
  }
  if (target?.type === 'OPEN_URL' && isCityMapUrl(target.payload.url)) {
    return 'Ja, Karte öffnen';
  }
  switch (target?.type) {
    case 'BOOK_STAY22':
      return 'Ja, Unterkünfte zeigen';
    case 'BOOK_ESIM':
      return 'Ja, eSIM öffnen';
    case 'BOOK_BOUNCE_LUGGAGE':
      return 'Ja, Gepäck-Spot öffnen';
    case 'BOOK_CAR_RENTAL':
      return 'Ja, Mietwagen öffnen';
    case 'BOOK_UBER':
      return 'Ja, Uber öffnen';
    case 'OPEN_GYG_WIDGET':
    case 'OPEN_URL':
      return 'Ja, Angebote öffnen';
    case 'CONFIRM_API_RESERVATION':
    case 'SEND_RESERVATION_EMAIL':
    case 'TRIGGER_AI_CALL':
      return 'Ja, Reservierung starten';
    default:
      break;
  }
  if (/\b(kompass|navigation|route|führ|fuehr)\b/iu.test(speech)) {
    return 'Ja, Navigation starten';
  }
  if (/\b(unterkunft|hotel|ferien)\b/iu.test(speech)) {
    return 'Ja, Unterkünfte zeigen';
  }
  if (/\b(tour|ticket|ausflug)\b/iu.test(speech)) {
    return 'Ja, Angebote öffnen';
  }
  return 'Ja, bitte';
}

export function useConciergeActions(
  card: ConciergeCardState | null,
  onFollowUp?: (prompt: string) => void,
) {
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const actionKey = (action: QuickAction, i: number) =>
    `${action.type}:${i}:${action.payload?.destName ?? action.payload?.url ?? action.label}`;

  const onAction = useCallback(
    async (action: QuickAction, index = 0) => {
      if (busyKey) return;
      if (action.payload?.pending) {
        try {
          const { speakAssistantText } = require('../../services/AudioVoiceService') as {
            speakAssistantText: (t: string) => Promise<unknown>;
          };
          void speakAssistantText('Die Speisekarte lade ich noch nach — einen Moment.');
        } catch {
          /* soft */
        }
        return;
      }
      const key = actionKey(action, index);
      setBusyKey(key);
      try {
        await abortAudioOnUserTap(action);
        // Deep Exec Telemetry: user actually clicked this button.
        recordFindusActionClicked(action, Date.now());

        if (action.type === 'START_NAVIGATION') {
          // Say–Do: blauer Ladebalken sofort, bevor Journey/Nav awaits
          try {
            useFinnusStore.getState().setNavRouteLoading(true);
          } catch {
            /* soft */
          }
          // Gecachte door-to-door Journey → Stempelkarte mit echten Beinen
          try {
            const {
              peekRememberedJourney,
              takeRememberedJourney,
            } = require('../../services/navigation/journeyStartCache') as {
              peekRememberedJourney: () => {
                itinerary: import('../../services/transit/journeyPlanner').JourneyItinerary;
                destName: string;
                destLat: number;
                destLng: number;
              } | null;
              takeRememberedJourney: () => {
                itinerary: import('../../services/transit/journeyPlanner').JourneyItinerary;
                destName: string;
                destLat: number;
                destLng: number;
              } | null;
            };
            const remembered = peekRememberedJourney();
            if (
              remembered &&
              (action.payload.skipClosingGate === true ||
                action.payload.journeyNav === true ||
                /öpnv\s*starten/i.test(action.label))
            ) {
              const { startJourneyNavigation } = require('../../services/navigation/startJourneyNavigation') as {
                startJourneyNavigation: (o: typeof remembered) => Promise<{
                  ok: boolean;
                  reply: string;
                }>;
              };
              takeRememberedJourney();
              const jr = await startJourneyNavigation(remembered);
              if (jr.ok) {
                if (action.payload.keepCard !== true) {
                  dismissConciergeCard();
                }
                if (jr.reply) {
                  try {
                    const { speakAssistantText } = require('../../services/ttsService') as {
                      speakAssistantText: (t: string) => Promise<void>;
                    };
                    void speakAssistantText(jr.reply).catch(() => {});
                  } catch {
                    /* soft */
                  }
                }
                await maybeRunActionAutoFollowUp(action);
                return;
              }
              alertActionError(
                jr.reply ||
                  'ÖPNV-Route konnte nicht starten — bitte nochmal tippen.',
              );
              return;
            }
          } catch {
            /* fall through to normal nav */
          }

          const lat = action.payload.destLat;
          const lng = action.payload.destLng;
          const name =
            action.payload.destName ||
            action.label.replace(/\s*\([^)]*\)\s*$/, '').trim();
          if (lat != null && lng != null && name) {
            const rawPoi = action.payload.targetPoiId;
            const poiId =
              typeof rawPoi === 'number' && Number.isFinite(rawPoi)
                ? rawPoi
                : typeof rawPoi === 'string' && /^\d+$/.test(rawPoi)
                  ? Number(rawPoi)
                  : undefined;
            const ok = await interruptAndNavigateToDiscovery(
              { name, lat, lng, ...(poiId != null ? { poiId } : {}) },
              {
                emergency: action.payload.skipClosingGate === true,
                skipClosingGate: action.payload.skipClosingGate === true,
                skipDestVerify: action.payload.skipDestVerify === true,
              },
            );
            if (ok) {
              // Notfall/Arzt: Karte mit Tel/Stichpunkten behalten
              if (action.payload.keepCard !== true) {
                dismissConciergeCard();
              }
              await maybeRunActionAutoFollowUp(action);
              return;
            }
            // Fernziel-/Schließ-Nachfrage schon gesetzt — nicht still erneut starten
            const cardId =
              useFinnusStore.getState().activeConciergeCard?.id ?? '';
            if (
              cardId.startsWith('nav-confirm') ||
              cardId.startsWith('closing-gate')
            ) {
              return;
            }
          }
        }
        const result = await handleQuickAction(action);
        if (result.message) {
          if (!result.ok) {
            alertActionError(result.message);
          } else if (
            action.type === 'CONFIRM_API_RESERVATION' ||
            action.type === 'SEND_RESERVATION_EMAIL' ||
            action.type === 'TRIGGER_AI_CALL'
          ) {
            alertActionError(result.message);
          }
        }
        if (result.followUpPrompt) {
          dismissConciergeCard();
          onFollowUp?.(result.followUpPrompt);
        }
        if (result.ok && action.type === 'START_NAVIGATION') {
          if (action.payload.keepCard !== true && result.keepCard !== true) {
            dismissConciergeCard();
          }
          await maybeRunActionAutoFollowUp(action);
        }
        // Partner/OPEN_URL: Card bleibt — User kann zurück und weiterklicken
        // (schließen nur per ✕ oder neue Frage)
      } finally {
        setBusyKey(null);
      }
    },
    [busyKey, onFollowUp],
  );

  const showYes = useMemo(() => {
    if (!card) return false;
    // Zwei Wecker-Optionen (aktualisieren / zweiten) → nur Action-Buttons, kein „Ja“
    const wakeChoices = card.quickActions.filter(
      (a) => a.type === 'SET_WAKE_ALARM' && a.payload.wakeMode,
    );
    if (wakeChoices.length >= 2) return false;
    return shouldShowConfirmationButton(card.speechText, card.quickActions);
  }, [card]);

  const yesTarget =
    showYes && card ? pickYesTarget(card.quickActions, card.speechText) : null;
  const yesLabel =
    showYes && card
      ? yesButtonLabel(yesTarget, card.speechText)
      : 'Ja, bitte';

  const onYes = useCallback(async () => {
    if (!card || busyKey) return;
    const target = pickYesTarget(card.quickActions, card.speechText);
    if (target) {
      await onAction(target, 0);
      return;
    }
    const yesBusy = `yes:${yesLabel}`;
    setBusyKey(yesBusy);
    try {
      try {
        await abortAudioOnUserTap();
      } catch {
        // ignore
      }
      dismissConciergeCard();
      onFollowUp?.('Ja');
    } finally {
      setBusyKey(null);
    }
  }, [busyKey, card, onAction, onFollowUp, yesLabel]);

  const otherActions = useMemo(() => {
    if (!card) return [];
    const actionCeiling =
      card.quickActions.length > MAX_QUICK_ACTIONS
        ? MAX_EVENT_QUICK_ACTIONS
        : MAX_QUICK_ACTIONS;
    return (
      yesTarget
        ? card.quickActions.filter(
            (a) =>
              !(
                a.type === yesTarget.type &&
                a.label === yesTarget.label &&
                String(a.payload.targetPoiId ?? '') ===
                  String(yesTarget.payload.targetPoiId ?? '') &&
                (a.payload.url ?? '') === (yesTarget.payload.url ?? '')
              ),
          )
        : card.quickActions
    ).slice(0, Math.max(0, actionCeiling - (showYes ? 1 : 0)));
  }, [card, showYes, yesTarget]);

  const hasActions = showYes || otherActions.length > 0;
  const hasBullets = (card?.visualBullets.length ?? 0) > 0;

  return {
    busyKey,
    showYes,
    yesTarget,
    yesLabel,
    onYes,
    onAction,
    otherActions,
    hasActions,
    hasBullets,
  };
}
