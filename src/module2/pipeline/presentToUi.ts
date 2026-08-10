/**
 * Modul-2 → Concierge-Card + Auto-Nav (Reboot SSOT).
 */

import { useFinnusStore } from '../../store/useFinnusStore';
import type { QuickAction } from '../../types/concierge';
import { clampVisualBullets } from '../../services/concierge/parseConciergeResponse';
import { setLastPlaceName } from '../context/shortTermContext';
import type { Module2ActionButton } from '../types';

export type PresentToUiOpts = {
  userText?: string;
  /** Unique Aldi/Lidl etc. — Nav starten auch bei laufender Tour */
  forceAutoNav?: boolean;
  /** Sofort-HUD bis erster Nav-Tick (Luftlinie ok) */
  seedDistanceM?: number | null;
  /** ActionBoard: Entities aus Fact-Lane */
  boardEntities?: import('../../services/actionBoard/types').ActionEntity[];
  boardModule1?: {
    poiId: number | string;
    name: string;
    lat: number;
    lng: number;
    websiteUrl?: string | null;
    category?: string | null;
    hotel?: boolean;
    activity?: boolean;
  };
  /** Speisekarte / Tickets / Stay22 Slow-Lane starten */
  startActionDeep?: boolean;
};

function uiPromptForAction(
  action: string,
  data: Record<string, unknown>,
  fallbackLabel: string,
): string {
  if (typeof data.prompt === 'string' && data.prompt.trim()) {
    return String(data.prompt).trim();
  }
  if (action === 'more_history') {
    const topic = typeof data.topic === 'string' ? data.topic.trim() : '';
    return topic
      ? `Erzähl mir noch mehr zu ${topic}.`
      : 'Erzähl mir noch mehr zur Geschichte.';
  }
  if (action === 'more_offer') {
    const title =
      typeof data.offerTitle === 'string' ? data.offerTitle.trim() : '';
    return title
      ? `Erzähl mir mehr zu „${title}“${data.topic ? ` bei ${data.topic}` : ''}.`
      : 'Erzähl mir mehr zu diesem Angebot.';
  }
  if (action === 'ask_history') {
    return 'Erzähl mir etwas Spannendes über einen Ort hier in der Nähe.';
  }
  return fallbackLabel;
}

export function presentToUi(
  speech: string,
  bullets: string[],
  buttons: Module2ActionButton[],
  userTextOrOpts?: string | PresentToUiOpts,
): void {
  const opts: PresentToUiOpts =
    typeof userTextOrOpts === 'string'
      ? { userText: userTextOrOpts }
      : userTextOrOpts ?? {};
  const userText = opts.userText;

  try {
    const store = useFinnusStore.getState();
    store.addChatMessage({ role: 'assistant', content: speech });

    const quickActions: QuickAction[] = buttons.map((b) => {
      const p = b.payload as {
        kind: string;
        url?: string;
        phone?: string;
        lat?: number;
        lng?: number;
        label?: string;
        destName?: string;
        action?: string;
        data?: Record<string, unknown>;
        keepCard?: boolean;
        skipClosingGate?: boolean;
        preferBike?: boolean;
      };

      if (p.kind === 'deep_link' && p.url) {
        const isPending = /findus\.local\/pending/i.test(p.url);
        return {
          type: 'OPEN_URL' as const,
          label: b.label,
          pending: isPending || undefined,
          payload: {
            url: p.url,
            destName: p.destName?.trim() || undefined,
            entityName: p.destName?.trim() || undefined,
          },
        };
      }
      if (p.kind === 'dial' && p.phone) {
        return {
          type: 'DIAL_PHONE' as const,
          label: b.label || '📞 Anrufen',
          payload: { phoneNumber: p.phone },
        };
      }
      if (p.kind === 'navigate' && p.lat != null && p.lng != null) {
        return {
          type: 'START_NAVIGATION' as const,
          label: b.label,
          payload: {
            destLat: p.lat,
            destLng: p.lng,
            destName: p.label ?? p.destName ?? 'Ziel',
            ...(p.keepCard === true ? { keepCard: true } : {}),
            ...(p.skipClosingGate === true ? { skipClosingGate: true } : {}),
            ...(p.preferBike === true ? { preferBike: true } : {}),
          },
        };
      }
      const action = String(p.action ?? b.id);
      const data = p.data ?? {};
      if (action === 'book_stay22' || action === 'BOOK_STAY22') {
        return {
          type: 'BOOK_STAY22' as const,
          label: b.label,
          payload: {
            url: (data.url as string) ?? p.url,
            destination:
              (data.destination as string) ??
              (data.city as string) ??
              (data.dest as string),
            ...(typeof data.checkin === 'string'
              ? { checkin: data.checkin }
              : {}),
            ...(typeof data.checkout === 'string'
              ? { checkout: data.checkout }
              : {}),
            ...(typeof data.adults === 'number' ? { adults: data.adults } : {}),
          },
        };
      }
      const dest = String(data.destName ?? data.dest ?? '');
      if (dest) setLastPlaceName(dest);
      return {
        type: 'SHOW_MORE' as const,
        label: b.label,
        payload: {
          textPrompt: uiPromptForAction(action, data, b.label),
        },
      };
    });

    const cardId = `m2_${Date.now()}`;
    let finalActions = quickActions;
    const startDeep = opts.startActionDeep !== false;
    try {
      const {
        applyActionBoardToResponse,
        startActionBoardDeep,
      } = require('../../services/actionBoard') as typeof import('../../services/actionBoard');
      const boarded = applyActionBoardToResponse(
        {
          speechText: speech,
          visualBullets: bullets,
          quickActions,
        },
        {
          cardId,
          userText,
          startDeep: false,
          entities: opts.boardEntities,
          module1: opts.boardModule1,
        },
      );
      finalActions = boarded.response.quickActions;
      store.setActiveConciergeCard({
        id: cardId,
        createdAtMs: Date.now(),
        speechText: speech,
        visualBullets: clampVisualBullets(bullets, { speechText: speech }),
        quickActions: finalActions,
        cardTitle: 'Findus',
      });
      if (startDeep && boarded.deepJobs.length > 0) {
        startActionBoardDeep({ jobs: boarded.deepJobs, cardId });
      }
    } catch {
      store.setActiveConciergeCard({
        id: cardId,
        createdAtMs: Date.now(),
        speechText: speech,
        visualBullets: clampVisualBullets(bullets, { speechText: speech }),
        quickActions: finalActions,
        cardTitle: 'Findus',
      });
    }

    void (async () => {
      try {
        const { autoStartNavigationIfCommitted } = await import(
          '../../services/concierge/presentConcierge'
        );
        const started = await autoStartNavigationIfCommitted(
          {
            speechText: speech,
            visualBullets: bullets,
            quickActions: finalActions,
          },
          {
            userText,
            forceAutoNav: opts.forceAutoNav === true,
          },
        );
        if (started) {
          const patch: {
            navActive: boolean;
            navVisible: boolean;
            navDistanceM?: number;
            navTotalDistanceM?: number;
          } = {
            navActive: true,
            navVisible: true,
          };
          const seed = opts.seedDistanceM;
          if (
            seed != null &&
            Number.isFinite(seed) &&
            seed > 0 &&
            (useFinnusStore.getState().navDistanceM == null ||
              (useFinnusStore.getState().navDistanceM ?? 0) <= 0)
          ) {
            const m = Math.round(seed);
            patch.navDistanceM = m;
            patch.navTotalDistanceM = m;
          }
          useFinnusStore.getState().patchNavigation(patch);
        }
      } catch {
        /* soft */
      }
    })();
  } catch {
    /* UI optional */
  }
}
