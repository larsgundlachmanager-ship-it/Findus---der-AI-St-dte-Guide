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
  /** Spickzettel-Titel (Thema) — nie „Yorro“ */
  cardTitle?: string | null;
  /** Keine Auto-Stichpunkte aus Speech (Chat-Lane: Card erst nach hörbarem Audio) */
  skipBulletDerive?: boolean;
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

export type PresentToUiResult = {
  speech: string;
  navStarted: boolean;
};

export async function presentToUi(
  speech: string,
  bullets: string[],
  buttons: Module2ActionButton[],
  userTextOrOpts?: string | PresentToUiOpts,
): Promise<PresentToUiResult> {
  // Ein Tick Luft — Settings/Mic/Timeline nicht hinter großen Store-Writes
  await new Promise<void>((r) => setTimeout(r, 0));

  const opts: PresentToUiOpts =
    typeof userTextOrOpts === 'string'
      ? { userText: userTextOrOpts }
      : userTextOrOpts ?? {};
  const userText = opts.userText;
  let outSpeech = speech;
  let outBullets = [...bullets];
  let navStarted = false;

  try {
    const { stripPermissionLookupAsks } = require('../../services/concierge/justDoItPolicy') as {
      stripPermissionLookupAsks: (s: string) => string;
    };
    outSpeech = stripPermissionLookupAsks(outSpeech);
  } catch {
    /* soft */
  }
  if (!opts.skipBulletDerive && !outBullets.filter(Boolean).length && outSpeech) {
    try {
      const { deriveMemoryBullets } = require('../../services/concierge/speechMemoryBullets') as {
        deriveMemoryBullets: (
          s: string,
          e?: string[] | null,
          o?: { userText?: string },
        ) => string[];
      };
      outBullets = deriveMemoryBullets(outSpeech, bullets, { userText }).slice(
        0,
        3,
      );
    } catch {
      /* soft */
    }
  }

  try {
    const store = useFinnusStore.getState();

    try {
      const { getCachedUserProfile } = require('../../services/userProfileService') as {
        getCachedUserProfile: () => { firstName?: string | null } | null;
      };
      const { noteUserNameIfSpoken, stripUserNameIfThrottled } = require('../../services/persona/userNameThrottle') as {
        noteUserNameIfSpoken: (s: string | null, n: string | null) => void;
        stripUserNameIfThrottled: (s: string | null, n: string | null) => string | null;
      };
      const fn = getCachedUserProfile()?.firstName?.trim() || null;
      const stripped = stripUserNameIfThrottled(outSpeech, fn);
      if (stripped && stripped !== outSpeech) outSpeech = stripped;
      noteUserNameIfSpoken(outSpeech, fn);
    } catch {
      /* soft */
    }

    const quickActions: QuickAction[] = buttons.map((b) => {
      const p = b.payload as {
        kind: string;
        url?: string;
        phone?: string;
        lat?: number;
        lng?: number;
        label?: string;
        destName?: string;
        destination?: string;
        checkin?: string;
        checkout?: string;
        adults?: number;
        destLat?: number;
        destLng?: number;
        action?: string;
        data?: Record<string, unknown>;
        keepCard?: boolean;
        skipClosingGate?: boolean;
        preferBike?: boolean;
        multiStop?: Array<{
          name: string;
          lat: number;
          lng: number;
          poiId?: number;
        }>;
      };

      if (p.kind === 'deep_link' && p.url) {
        const isPending = /findus\.local\/pending/i.test(p.url);
        const destHint = p.destName?.trim() || undefined;
        const cityHint = p.destination?.trim() || undefined;
        // Buchung: nie klickbaren Fake-Pending-URL zeigen — Partner-Link sofort
        if (
          isPending &&
          /\b(buch|hotel|zimmer|stay22|expedia|unterkunft)\b/iu.test(b.label)
        ) {
          try {
            const {
              buildPitchHotelBookingUrl,
            } = require('../pitch/pitchBookingUrl') as {
              buildPitchHotelBookingUrl: (
                hotelName: string,
                contextBlob: string,
                cityHint?: string | null,
              ) => string | null;
            };
            const { getCachedUserProfile } = require('../../services/userProfileService') as {
              getCachedUserProfile: () => { cityName?: string } | null;
            };
            const city =
              cityHint ||
              getCachedUserProfile()?.cityName?.trim() ||
              null;
            const dest =
              (destHint && !/^pending$/i.test(destHint) ? destHint : null) ||
              city ||
              'Germany';
            const real =
              buildPitchHotelBookingUrl(dest, b.label, city) ||
              (() => {
                const {
                  getStay22AccommodationUrl,
                } = require('../../services/affiliate/affiliateService') as {
                  getStay22AccommodationUrl: (d: string) => string;
                };
                return getStay22AccommodationUrl(
                  city ? `${dest}, ${city}` : dest,
                );
              })();
            if (real && /^https?:\/\//i.test(real)) {
              return {
                type: 'OPEN_URL' as const,
                label: b.label.replace(/…|\.{3}/g, '').trim() || b.label,
                payload: {
                  url: real,
                  destName: dest,
                  destination: city || dest,
                  entityName: dest,
                  ...(typeof p.checkin === 'string' ? { checkin: p.checkin } : {}),
                  ...(typeof p.checkout === 'string'
                    ? { checkout: p.checkout }
                    : {}),
                  ...(typeof p.adults === 'number' ? { adults: p.adults } : {}),
                },
              };
            }
          } catch {
            /* soft → pending unten */
          }
        }
        return {
          type: 'OPEN_URL' as const,
          label: b.label,
          payload: {
            url: p.url,
            destName: destHint,
            entityName: destHint,
            ...(cityHint ? { destination: cityHint } : {}),
            ...(typeof p.checkin === 'string' ? { checkin: p.checkin } : {}),
            ...(typeof p.checkout === 'string' ? { checkout: p.checkout } : {}),
            ...(typeof p.adults === 'number' ? { adults: p.adults } : {}),
            ...(isPending ? { pending: true } : {}),
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
        const destName = (p.label ?? p.destName ?? 'Ziel').trim();
        try {
          const prev = store.pendingNavOffer;
          store.setPendingNavOffer({
            poiId: -1,
            name: destName,
            lat: p.lat,
            lng: p.lng,
            awaitConfirm: prev?.awaitConfirm === true,
          });
          setLastPlaceName(destName);
        } catch {
          /* soft */
        }
        return {
          type: 'START_NAVIGATION' as const,
          label: b.label,
          payload: {
            destLat: p.lat,
            destLng: p.lng,
            destName,
            ...(p.keepCard === true ? { keepCard: true } : {}),
            ...(p.skipClosingGate === true ? { skipClosingGate: true } : {}),
            ...(p.preferBike === true ? { preferBike: true } : {}),
            ...(Array.isArray(p.multiStop) ? { multiStop: p.multiStop } : {}),
          },
        };
      }
      if ((p.kind === 'uber' || p.kind === 'book_uber') && (p.lat != null || p.destLat != null) && (p.lng != null || p.destLng != null)) {
        const uberLat = Number(p.destLat ?? p.lat);
        const uberLng = Number(p.destLng ?? p.lng);
        try {
          const { buildUberRideAction } = require('../../services/affiliate/affiliateService') as {
            buildUberRideAction: (
              lat: number,
              lng: number,
              name: string,
            ) => {
              type: 'BOOK_UBER';
              label: string;
              payload: Record<string, unknown>;
            };
          };
          const destName = (p.label ?? p.destName ?? 'Ziel').trim();
          const act = buildUberRideAction(uberLat, uberLng, destName);
          return {
            type: 'BOOK_UBER' as const,
            label: b.label || act.label,
            payload: act.payload,
          };
        } catch {
          return {
            type: 'OPEN_URL' as const,
            label: b.label || '🚗 Uber',
            payload: {
              url: `https://m.uber.com/ul/?action=setPickup&pickup=my_location&dropoff%5Blatitude%5D=${uberLat}&dropoff%5Blongitude%5D=${uberLng}`,
              destName: (p.label ?? p.destName ?? 'Ziel').trim(),
            },
          };
        }
      }
      if (p.kind === 'switch_nav_mode' && p.preferBike === true) {
        try {
          const {
            getActiveNavDestination,
          } = require('../../services/navigation/navigationService') as {
            getActiveNavDestination: () => {
              lat: number;
              lng: number;
              name: string;
              poiId?: number;
            } | null;
          };
          const dest = getActiveNavDestination();
          if (
            dest &&
            Number.isFinite(dest.lat) &&
            Number.isFinite(dest.lng)
          ) {
            return {
              type: 'START_NAVIGATION' as const,
              label: b.label || 'Navigation auf Rad',
              payload: {
                destLat: dest.lat,
                destLng: dest.lng,
                destName: dest.name,
                preferBike: true,
                keepCard: true,
              },
            };
          }
        } catch {
          /* soft */
        }
      }
      const action = String(p.action ?? b.id);
      const data = p.data ?? {};
      if (
        action === 'start_journey_nav' ||
        action === 'START_JOURNEY_NAV'
      ) {
        let destName = String(
          data.dest ?? data.destName ?? data.destination ?? '',
        ).trim();
        try {
          const { isBogusNavDestName } = require('../../services/research/htmlResearchGate') as {
            isBogusNavDestName: (n: string) => boolean;
          };
          if (destName && isBogusNavDestName(destName)) destName = '';
        } catch {
          /* soft */
        }
        let destLat =
          typeof data.destLat === 'number' ? data.destLat : undefined;
        let destLng =
          typeof data.destLng === 'number' ? data.destLng : undefined;
        try {
          const {
            peekRememberedJourney,
          } = require('../../services/navigation/journeyStartCache') as {
            peekRememberedJourney: () => {
              destName: string;
              destLat: number;
              destLng: number;
            } | null;
          };
          const j = peekRememberedJourney();
          if (j) {
            if (!destName) destName = j.destName;
            if (destLat == null) destLat = j.destLat;
            if (destLng == null) destLng = j.destLng;
          }
        } catch {
          /* soft */
        }
        if (destName) setLastPlaceName(destName);
        return {
          type: 'START_NAVIGATION' as const,
          label: b.label,
          payload: {
            destName: destName || 'Ziel',
            ...(typeof destLat === 'number' ? { destLat } : {}),
            ...(typeof destLng === 'number' ? { destLng } : {}),
            skipClosingGate: true,
            journeyNav: true,
          },
        };
      }
      if (
        action === 'set_wake_alarm' ||
        action === 'SET_WAKE_ALARM'
      ) {
        return {
          type: 'SET_WAKE_ALARM' as const,
          label: b.label,
          payload: {
            ...(typeof data.dateIso === 'string'
              ? { dateIso: data.dateIso }
              : {}),
            ...(typeof data.destName === 'string'
              ? { destName: data.destName as string }
              : {}),
            ...(data.wakeMode === 'replace' ||
            data.wakeMode === 'add' ||
            data.wakeMode === 'cancel'
              ? { wakeMode: data.wakeMode }
              : {}),
            ...(typeof data.replaceWakeAtMs === 'number'
              ? { replaceWakeAtMs: data.replaceWakeAtMs }
              : {}),
          },
        };
      }
      if (
        action === 'set_departure_reminder' ||
        action === 'SET_DEPARTURE_REMINDER'
      ) {
        return {
          type: 'SET_DEPARTURE_REMINDER' as const,
          label: b.label,
          payload: {
            ...(typeof data.dateIso === 'string'
              ? { dateIso: data.dateIso }
              : {}),
            ...(typeof data.destName === 'string'
              ? { destName: data.destName as string }
              : {}),
            ...(typeof data.timeLabel === 'string'
              ? { timeLabel: data.timeLabel as string }
              : {}),
            ...(typeof data.textPrompt === 'string'
              ? { textPrompt: data.textPrompt as string }
              : {}),
            ...(typeof data.destLat === 'number'
              ? { destLat: data.destLat as number }
              : {}),
            ...(typeof data.destLng === 'number'
              ? { destLng: data.destLng as number }
              : {}),
          },
        };
      }
      if (action === 'book_esim' || action === 'BOOK_ESIM') {
        return {
          type: 'BOOK_ESIM' as const,
          label: b.label,
          payload: {
            url: (data.url as string) ?? p.url,
          },
        };
      }
      if (action === 'book_car_rental' || action === 'BOOK_CAR_RENTAL') {
        return {
          type: 'BOOK_CAR_RENTAL' as const,
          label: b.label,
          payload: {
            url: (data.url as string) ?? p.url,
          },
        };
      }
      if (action === 'book_bounce_luggage' || action === 'BOOK_BOUNCE_LUGGAGE') {
        return {
          type: 'BOOK_BOUNCE_LUGGAGE' as const,
          label: b.label,
          payload: {
            url: (data.url as string) ?? p.url,
          },
        };
      }
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
      if (action === 'choice_tap' || action === 'CHOICE_TAP') {
        const label = String(data.label || b.label).trim();
        return {
          type: 'SHOW_MORE' as const,
          label: b.label.slice(0, 28),
          payload: {
            textPrompt: label,
            choiceTap: {
              parentTurnId: String(data.parentTurnId || ''),
              choiceId: String(data.choiceId || 'chip_0'),
              slotKey: String(data.slotKey || 'generic_fork'),
              label,
            },
          },
        };
      }
      if (action === 'show_plan_day' || action === 'SHOW_PLAN_DAY') {
        const dayKey = String(data.dayKey || '').trim();
        return {
          type: 'SHOW_MORE' as const,
          label: b.label.slice(0, 28) || '📅 Tagesplan',
          payload: {
            textPrompt: dayKey
              ? `__SHOW_PLAN_DAY__:${dayKey}`
              : '__SHOW_PLAN_DAY__',
          },
        };
      }
      if (
        action === 'start_plan_step_loop' ||
        action === 'START_PLAN_STEP_LOOP'
      ) {
        return {
          type: 'SHOW_MORE' as const,
          label: b.label.slice(0, 28) || 'Punkte durchgehen',
          payload: { textPrompt: '__START_PLAN_STEP_LOOP__' },
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
    }).filter((a) => {
      try {
        const { isBogusNavDestName } = require('../../services/research/htmlResearchGate') as {
          isBogusNavDestName: (n: string) => boolean;
        };
        const dest = a.payload?.destName || a.label;
        if (a.type === 'START_NAVIGATION' && dest && isBogusNavDestName(dest)) {
          return false;
        }
      } catch {
        /* soft */
      }
      return true;
    });

    const cardId = `m2_${Date.now()}`;
    let finalActions = quickActions;
    const startDeep = opts.startActionDeep !== false;
    let deepJobs: import('../../services/actionBoard/types').DeepJob[] = [];
    try {
      const {
        applyActionBoardToResponse,
        startActionBoardDeep,
      } = require('../../services/actionBoard') as typeof import('../../services/actionBoard');
      const boarded = applyActionBoardToResponse(
        {
          speechText: outSpeech,
          visualBullets: outBullets,
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
      deepJobs = boarded.deepJobs ?? [];
    } catch {
      /* board optional */
    }

    // Nav-Ziel sicher als Offer (auch wenn ActionBoard umschreibt)
    const navSeed = finalActions.find((a) => a.type === 'START_NAVIGATION');
    if (
      navSeed &&
      typeof navSeed.payload.destLat === 'number' &&
      typeof navSeed.payload.destLng === 'number'
    ) {
      const destName = (navSeed.payload.destName || navSeed.label || 'Ziel').trim();
      let ok = true;
      try {
        const { isBogusNavDestName } = require('../../services/research/htmlResearchGate') as {
          isBogusNavDestName: (n: string) => boolean;
        };
        ok = !isBogusNavDestName(destName);
      } catch {
        ok = true;
      }
      if (ok) {
        const prev = store.pendingNavOffer;
        store.setPendingNavOffer({
          poiId: -1,
          name: destName,
          lat: navSeed.payload.destLat,
          lng: navSeed.payload.destLng,
          awaitConfirm: prev?.awaitConfirm === true,
        });
      }
    }

    const publishCard = (actions: typeof finalActions) => {
      let safe = actions;
      try {
        const { stripUnbackedActions } = require('../../services/concierge/zeroFakeActions') as {
          stripUnbackedActions: (
            a: typeof actions,
            o?: { userText?: string; speechText?: string },
          ) => typeof actions;
        };
        safe = stripUnbackedActions(actions, {
          userText,
          speechText: outSpeech,
        });
      } catch {
        safe = actions;
      }
      store.setActiveConciergeCard({
        id: cardId,
        createdAtMs: Date.now(),
        speechText: outSpeech,
        visualBullets: clampVisualBullets(outBullets, {
          speechText: outSpeech,
          userText,
        }),
        quickActions: safe,
        cardTitle: (() => {
          try {
            const { deriveSpickzettelTitle } = require('../../services/concierge/spickzettelTitle') as {
              deriveSpickzettelTitle: (o: {
                userText?: string | null;
                speech?: string | null;
                bullets?: string[] | null;
                explicit?: string | null;
              }) => string;
            };
            return deriveSpickzettelTitle({
              userText,
              speech: outSpeech,
              bullets: outBullets,
              explicit: opts.cardTitle,
            });
          } catch {
            const t = (opts.cardTitle || '').trim();
            return t && !/^yorro\b/i.test(t) ? t : 'Spickzettel';
          }
        })(),
      });
      if (startDeep && deepJobs.length > 0) {
        try {
          const { startActionBoardDeep } = require('../../services/actionBoard') as typeof import('../../services/actionBoard');
          startActionBoardDeep({ jobs: deepJobs, cardId });
        } catch {
          /* soft */
        }
      }
    };

    // Explizite Nav: ZUERST starten (await), dann Card — Say–Do
    let actions = finalActions;
    try {
      const { autoStartNavigationIfCommitted, speechCommitsToNavigation } =
        await import('../../services/concierge/presentConcierge');
      const { stripFakeReservationClaims } = await import(
        '../../services/concierge/zeroFakeActions'
      );
      const { isExplicitNavIntent } = await import(
        '../../services/intent/poiInfoVsNav'
      );
      // Pre-Start schon ok → nicht nochmal retargeten (sonst stale Pending-POI)
      const force =
        opts.forceAutoNav === true ||
        (Boolean(userText) && isExplicitNavIntent(userText ?? ''));
      if (opts.forceAutoNav === false && useFinnusStore.getState().navActive) {
        navStarted = true;
      } else {
        const commit = await autoStartNavigationIfCommitted(
          {
            speechText: outSpeech,
            visualBullets: outBullets,
            quickActions: actions,
          },
          {
            userText,
            forceAutoNav: force,
          },
        );
        navStarted = commit.started;
        if (!navStarted && commit.confirmSpeech) {
          outSpeech = commit.confirmSpeech;
        }
      }
      if (navStarted) {
        const patch: {
          navActive: boolean;
          navVisible: boolean;
        } = {
          navActive: true,
          navVisible: true,
        };
        useFinnusStore.getState().patchNavigation(patch);
        try {
          const { bindSpeechToCommittedRoute } = require('../../services/navigation/navSpeechDistance') as {
            bindSpeechToCommittedRoute: (
              s: string,
              o?: { appendIfMissing?: boolean },
            ) => string;
          };
          outSpeech = bindSpeechToCommittedRoute(outSpeech, {
            appendIfMissing: true,
          });
        } catch {
          /* soft */
        }
        actions = actions.filter((a) => a.type !== 'START_NAVIGATION');
      } else if (speechCommitsToNavigation(outSpeech) || force) {
        outSpeech = stripFakeReservationClaims(outSpeech, actions, {
          navActuallyStarted: false,
        });
      }
    } catch (err) {
      console.warn('[presentToUi] auto-start nav failed', err);
    }

    // Placebo-„Noch mehr“ nie zeigen (Nav/Plan/Entscheidung)
    try {
      const {
        isExpandShowMoreAction,
        shouldOfferExpandMore,
      } = require('../../services/actionBoard/opportunityScan') as typeof import('../../services/actionBoard/opportunityScan');
      actions = actions.filter((a) => {
        if (a.type !== 'SHOW_MORE' || !isExpandShowMoreAction(a)) return true;
        return shouldOfferExpandMore({
          userText,
          speechText: outSpeech,
          module1: opts.boardModule1,
        });
      });
    } catch {
      /* soft */
    }

    store.addChatMessage({ role: 'assistant', content: outSpeech });
    publishCard(actions);
  } catch {
    /* UI optional */
  }
  return { speech: outSpeech, navStarted };
}
