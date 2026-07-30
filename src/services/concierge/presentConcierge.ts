/**
 * Voice-first Concierge Playback:
 * 1) Wenn Findus Navigation ankündigt → Kompass SOFORT
 * 2) TTS parallel (User kann schon losgehen)
 * 3) Spickzettel-Karte, sobald die Stimme läuft
 */

import type { GeminiConciergeResponse } from '../../types/concierge';
import type { ConciergeCardState } from '../../types/concierge';
import type { QuickAction } from '../../types/concierge';
import { useFinnusStore } from '../../store/useFinnusStore';
import { getVoiceSettingsForTour } from '../ttsService';
import { speakRuntimeText } from '../../runtime/speechModule';
import type { ConciergeContext } from './conciergeContext';
import {
  clampVisualBullets,
} from './parseConciergeResponse';
import type { TransitAdvice } from '../transit/transitAdvisor';
import { formatDelayStatus } from '../transit/transitAdvisor';
import { getAllPois, getPoiWithFacts } from '../../db/database';
import {
  normalizeNavActionsAndOffer,
  resolveAndStartNavigation,
} from '../navigation/resolveNavTarget';
import {
  buildBounceLuggageAction,
  buildCarRentalAction,
  buildStay22AccommodationAction,
  buildTourBookingAction,
  looksLikeFakeTourSlug,
  buildGetYourGuideSearchUrl,
  normalizeAffiliateUrl,
  isBounceAvailableForCity,
} from '../affiliate/affiliateService';
import {
  MAX_QUICK_ACTIONS,
  MAX_EVENT_QUICK_ACTIONS,
  prioritizeQuickActions,
} from '../affiliate/prioritizeActions';
import { pickPendingAffiliateOffer } from '../affiliate/pendingAffiliateOffer';
import { enrichPlaylistOffers } from '../playlistService';
import { getCachedUserProfile } from '../userProfileService';
import type { QuickActionType } from '../../types/concierge';
import { speechAsksForConfirmation } from './speechAsksConfirmation';
import {
  buildCityMapAction,
  getCityMapLink,
  isCityMapUrl,
  openCityMap,
  speechCommitsToMap,
  speechMentionsMap,
} from '../cityMapService';
import {
  buildPlaceChoiceActions,
  shouldForcePlaceChoiceChips,
  wantsMusicExplicitly,
  wantsUberExplicitly,
} from './quickActionPolicy';
import { namesAlign } from './canonicalDestination';
import {
  buildReservationQuickActions,
  evaluateReservationIntel,
} from '../../runtime/reservationIntel';
import {
  speechAdmitsNoActionableData,
  stripUnbackedActions,
} from './zeroFakeActions';
import { recordFindusActionsTriggered } from '../feedback/executionTracking';
import { applyHardGuardrails } from '../agi/speechGuardrails';
import { applyActionButtonJudge } from '../agi/actionButtonJudge';

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitUntilVoicePlaying(timeoutMs = 4000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (useFinnusStore.getState().isPlayingAudio) return true;
    await sleep(40);
  }
  return useFinnusStore.getState().isPlayingAudio;
}

export function toConciergeCardState(
  response: GeminiConciergeResponse,
): ConciergeCardState {
  return {
    ...response,
    id: `cc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    createdAtMs: Date.now(),
  };
}

/** Findus behauptet, Navigation zu starten (kein bloßes Angebot). */
export function speechCommitsToNavigation(speech: string): boolean {
  const t = speech.trim();
  if (!t) return false;

  const asksPermission =
    /\b(soll\s+ich|darf\s+ich|sollen\s+wir|wollen\s+wir|möchtest\s+du|moechtest\s+du|willst\s+du|solln\s+wir)\b/iu.test(
      t,
    ) &&
    /\b(kompass|navigation|route|führ|fuehr|hinnavig|anmachen)\b/iu.test(t);

  const commits =
    /\b(ich\s+(führ|fuehr|bring|schalt|mach|start)(?:e|en)?|folge(?:\s+\w+){0,3}\s+dem\s+pfeil|kompass\s+(?:ist\s+)?(?:an|aktiv)|navigation\s+(?:startet|läuft|laeuft|ist\s+an)|schalt(?:e|)\s+(?:dir\s+)?(?:sofort\s+)?den\s+kompass|mach(?:e|)\s+(?:dir\s+)?(?:sofort\s+)?den\s+kompass|route\s+(?:startet|läuft|laeuft)|gleich\s+los|direkt\s+los)\b/iu.test(
      t,
    );

  // Reine Frage → warten auf Button/Ja
  if (asksPermission && !commits) return false;
  return commits;
}

async function attachCityMapAction(
  response: GeminiConciergeResponse,
  actions: QuickAction[],
): Promise<QuickAction[]> {
  if (!speechMentionsMap(response.speechText)) return actions;
  const hasMap = actions.some(
    (a) => a.type === 'OPEN_URL' && isCityMapUrl(a.payload.url),
  );
  if (hasMap) return actions;
  const link = await getCityMapLink();
  if (!link) return actions;
  return [...actions, buildCityMapAction(link)];
}

/**
 * Kompass sofort aktivieren, wenn Speech das zusagt.
 * Blockiert die Stimme nicht länger als nötig.
 */
export async function autoStartNavigationIfCommitted(
  response: GeminiConciergeResponse,
  opts?: { skipAutoNav?: boolean; userText?: string },
): Promise<boolean> {
  if (opts?.skipAutoNav) return false;
  // Tagesplan-Fragen dürfen nie den Kompass starten
  if (opts?.userText && /\b(plan|ablauf|wie\s+sieht)\b/iu.test(opts.userText)) {
    const { isDayPlanQuery } = await import('../intent/poiInfoVsNav');
    if (isDayPlanQuery(opts.userText)) return false;
  }
  const store = useFinnusStore.getState();
  const navActions = response.quickActions.filter(
    (a) => a.type === 'START_NAVIGATION',
  );
  const commits = speechCommitsToNavigation(response.speechText);
  const mentionsNav =
    /\b(führ|fuehr|kompass|pfeil|route|bring\s+dich|navigation)\b/iu.test(
      response.speechText,
    );
  const onlyAsking =
    /\b(soll\s+ich|darf\s+ich|wollen\s+wir|möchtest\s+du)\b/iu.test(
      response.speechText,
    ) && !commits;

  const singleTargetGo =
    navActions.length === 1 && mentionsNav && !onlyAsking;

  if (!commits && !singleTargetGo) return false;

  // Laufende Navigation nicht durch Rückfragen neu starten
  if (store.navActive && !commits) return false;

  const navAction = navActions[0];
  const offer = store.pendingNavOffer;
  const started = await resolveAndStartNavigation({
    poiId: navAction?.payload.targetPoiId ?? offer?.poiId,
    name:
      navAction?.payload.destName ||
      navAction?.label ||
      offer?.name ||
      null,
    lat: navAction?.payload.destLat ?? offer?.lat ?? null,
    lng: navAction?.payload.destLng ?? offer?.lng ?? null,
  });

  if (!started.ok) {
    console.warn(
      '[concierge] Speech sagt Navigation zu, aber Ziel nicht auflösbar',
      started.message,
    );
    return false;
  }

  if (__DEV__) {
    console.log(
      `[concierge] auto-start nav via=${started.via} name=${started.name} ok=true`,
    );
  }
  return true;
}

/** Event-Turns: bis 4 Buttons; sonst Default-Cap. */
function actionCap(ctx: ConciergeContext | null): number {
  return (
    ctx?.maxQuickActions ??
    (ctx?.eventResearch?.events?.length ? MAX_EVENT_QUICK_ACTIONS : MAX_QUICK_ACTIONS)
  );
}

function navCap(ctx: ConciergeContext | null): number {
  return ctx?.eventResearch?.events?.length ? 3 : 2;
}

/** Ergänzt Nav-/Partner-Actions — progressive disclosure, voice-first. */
export async function enrichWithConciergeOffers(
  response: GeminiConciergeResponse,
  ctx: ConciergeContext | null,
): Promise<GeminiConciergeResponse> {
  // Event-Recherche: Buttons aus Research (Route + PDF + Tickets), Speech sync
  if (ctx?.eventResearch?.events?.length) {
    const { eventResearchToActions, synthesizeEventSpeech } = await import(
      './eventResearchService'
    );
    let speechText = response.speechText.trim();
    const research = ctx.eventResearch;
    const mentionsAny = research.events.some(
      (e) => namesAlign(speechText, e.venue) || namesAlign(speechText, e.title),
    );
    if (!speechText || !mentionsAny) {
      speechText = synthesizeEventSpeech(research);
    }
    const fromResearch = eventResearchToActions(research);
    const geminiAligned = response.quickActions.filter((a) => {
      if (a.type === 'START_NAVIGATION') {
        return research.events.some((e) =>
          namesAlign(a.payload.destName || a.label, e.venue),
        );
      }
      if (a.type === 'OPEN_URL') {
        return research.events.some(
          (e) =>
            (e.infoUrl && a.payload.url === e.infoUrl) ||
            (e.ticketUrl && a.payload.url === e.ticketUrl),
        );
      }
      return false;
    });
    const merged: QuickAction[] = [];
    const seen = new Set<string>();
    for (const a of [...fromResearch, ...geminiAligned]) {
      const key = `${a.type}:${a.payload.url ?? ''}:${a.payload.destName ?? a.label}`;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(a);
    }
    const cap = actionCap(ctx);
    const ranked = prioritizeQuickActions(merged, {
      maxActions: cap,
      maxNavActions: navCap(ctx),
      primaryIntentTypes: ['START_NAVIGATION', 'OPEN_URL'],
    });
    const normalized = await normalizeNavActionsAndOffer({
      actions: ranked,
      fallbackOffer: ctx.primaryOffer,
    });
    if (ctx.primaryOffer) {
      useFinnusStore.getState().setPendingNavOffer(
        normalized.offer ?? ctx.primaryOffer,
      );
      useFinnusStore
        .getState()
        .setPendingNavAlternatives(ctx.alternatives.slice(0, 2));
    }
    return {
      ...response,
      speechText,
      cardTitle: response.cardTitle || 'Heute vor Ort',
      visualBullets: clampVisualBullets(
        response.visualBullets.length > 0
          ? response.visualBullets
          : ctx.fallbackBullets ?? [],
      ),
      quickActions: normalized.actions.slice(0, cap) as QuickAction[],
    };
  }

  // Wahl-Turn: Spickzettel = genau die 2 gesprochenen Orte (Tap = Auswahl)
  if (shouldForcePlaceChoiceChips(response.speechText, ctx) && ctx?.primaryOffer) {
    const choiceActions = buildPlaceChoiceActions(
      ctx.primaryOffer,
      ctx.alternatives,
    ).map((action) =>
      ctx.kind === 'food'
        ? {
            ...action,
            payload: {
              ...action.payload,
              autoFollowUp: 'reservation' as const,
            },
          }
        : action,
    );
    const normalized = await normalizeNavActionsAndOffer({
      actions: choiceActions,
      fallbackOffer: ctx.primaryOffer,
    });
    let speechText = response.speechText.trim();
    if (!speechText && ctx.fallbackSpeech?.trim()) {
      speechText = ctx.fallbackSpeech.trim();
    }
    return {
      ...response,
      speechText,
      visualBullets: clampVisualBullets(
        response.visualBullets.length > 0
          ? response.visualBullets
          : ctx.fallbackBullets ?? [],
      ),
      cardTitle:
        response.cardTitle ||
        (ctx.kind === 'general' ? 'Was heute geht' : titleForKind(ctx.kind)),
      quickActions: normalized.actions.slice(0, 2) as QuickAction[],
    };
  }

  let actions = [...response.quickActions];

  if (ctx?.namedDestination && ctx.primaryOffer) {
    // SSOT: strip foreign nav chips, bind Route starten + Tisch/Speisekarte to named place
    const offer = ctx.primaryOffer;
    actions = actions.filter(
      (a) =>
        a.type !== 'START_NAVIGATION' &&
        a.type !== 'BOOK_STAY22', // open Stay22 only via hotel pack if needed
    );
    actions.unshift({
      type: 'START_NAVIGATION',
      label: '📍 Route starten',
      payload: {
        targetPoiId: offer.poiId,
        destName: offer.name,
        destLat: offer.lat,
        destLng: offer.lng,
      },
    });

    // Named hotel: why + availability check + booking button
    const looksHotel =
      ctx.kind === 'accommodation' ||
      /\b(hotel|pension|hostel|apartment|ferienwohnung|unterkunft)\b/iu.test(
        offer.name,
      );
    if (looksHotel) {
      try {
        const { buildHotelBookingPack } = await import('./hotelBookingPack');
        const pack = await buildHotelBookingPack(offer, {
          userText: response.speechText,
          suggestWhy: true,
        });
        // Only researched booking actions — never static Stay22-without-check
        for (const a of pack.actions) {
          if (!actions.some((x) => x.type === a.type && x.label === a.label)) {
            actions.push(a);
          }
        }
        if (pack.speechExtra) {
          (response as { _hotelSpeech?: string })._hotelSpeech =
            pack.available === false
              ? pack.speechExtra
              : pack.speechExtra;
        }
      } catch (err) {
        if (__DEV__) console.warn('[concierge] hotel booking pack', err);
      }
    }

    if (
      (ctx.kind === 'food' || ctx.kind === 'reservation') &&
      offer.poiId > 0
    ) {
      try {
        const poi = await getPoiWithFacts(offer.poiId);
        if (poi) {
          const intel = await evaluateReservationIntel(poi, '');
          const resActions = buildReservationQuickActions(intel, null, {
            lat: offer.lat ?? poi.lat,
            lng: offer.lng ?? poi.lng,
          }).filter((a) => a.type !== 'START_NAVIGATION');
          for (const a of resActions) {
            const exists = actions.some(
              (x) =>
                x.type === a.type ||
                (x.type === 'OPEN_URL' &&
                  a.type === 'OPEN_URL' &&
                  /speisekarte|karte|menu/i.test(x.label)),
            );
            if (!exists) actions.push(a);
          }
          // Ensure Speisekarte / Reservieren labels are clear
          actions = actions.map((a) => {
            if (a.type === 'OPEN_URL' && /speisekarte|menu|karte/i.test(a.label)) {
              return { ...a, label: '🍽 Speisekarte' };
            }
            if (a.type === 'CONFIRM_API_RESERVATION') {
              return { ...a, label: '🍽 Tisch reservieren' };
            }
            if (a.type === 'SEND_RESERVATION_EMAIL') {
              return { ...a, label: '🍽 Tisch anfragen' };
            }
            return a;
          });
        }
      } catch (err) {
        if (__DEV__) console.warn('[concierge] named dest reservation pack', err);
      }
    }

    // Speech must mention the named place — else use fallback
    let speechText = response.speechText.trim();
    if (
      !namesAlign(speechText, offer.name) &&
      ctx.fallbackSpeech?.trim()
    ) {
      speechText = ctx.fallbackSpeech.trim();
    } else if (!speechText && ctx.fallbackSpeech?.trim()) {
      speechText = ctx.fallbackSpeech.trim();
    }
    const hotelExtra = (response as { _hotelSpeech?: string })._hotelSpeech;
    if (hotelExtra?.trim()) {
      speechText = `${speechText} ${hotelExtra.trim()}`.trim();
    }

    const normalized = await normalizeNavActionsAndOffer({
      actions,
      fallbackOffer: offer,
    });
    useFinnusStore.getState().setPendingNavOffer(
      normalized.offer ?? offer,
    );
    useFinnusStore.getState().setPendingNavAlternatives([]);

    return {
      ...response,
      speechText,
      cardTitle: response.cardTitle || offer.name,
      visualBullets: clampVisualBullets(
        response.visualBullets.length > 0
          ? response.visualBullets
          : ctx.fallbackBullets ?? [offer.name],
      ),
      quickActions: prioritizeQuickActions(
        normalized.actions as QuickAction[],
        {
          maxActions: actionCap(ctx),
          maxNavActions: navCap(ctx),
        },
      ).slice(0, actionCap(ctx)),
    };
  }

  if (ctx?.primaryOffer) {
    const hasNav = actions.some((a) => a.type === 'START_NAVIGATION');
    if (!hasNav) {
      actions.unshift({
        type: 'START_NAVIGATION',
        label: ctx.primaryOffer.name,
        payload: {
          targetPoiId: ctx.primaryOffer.poiId,
          destName: ctx.primaryOffer.name,
          destLat: ctx.primaryOffer.lat,
          destLng: ctx.primaryOffer.lng,
        },
      });
    } else {
      // Retarget mismatched nav chips toward primary when speech aligns with primary
      actions = actions.map((a) => {
        if (a.type !== 'START_NAVIGATION') return a;
        const id = String(a.payload.targetPoiId ?? '');
        if (id === String(ctx.primaryOffer!.poiId)) {
          return {
            ...a,
            label: `📍 Route: ${ctx.primaryOffer!.name}`,
            payload: {
              ...a.payload,
              targetPoiId: ctx.primaryOffer!.poiId,
              destName: ctx.primaryOffer!.name,
              destLat: ctx.primaryOffer!.lat,
              destLng: ctx.primaryOffer!.lng,
            },
          };
        }
        const alt = ctx.alternatives.find((x) => String(x.poiId) === id);
        if (alt) return { ...a, label: alt.name };
        // Speech names primary but chip names something else → force primary
        const chipName = String(a.payload.destName || a.label || '');
        if (
          namesAlign(response.speechText, ctx.primaryOffer!.name) &&
          !namesAlign(chipName, ctx.primaryOffer!.name)
        ) {
          return {
            ...a,
            label: `📍 Route starten`,
            payload: {
              targetPoiId: ctx.primaryOffer!.poiId,
              destName: ctx.primaryOffer!.name,
              destLat: ctx.primaryOffer!.lat,
              destLng: ctx.primaryOffer!.lng,
            },
          };
        }
        return a;
      });
    }

    // Sekundär: Uber erst nach Zusagen / explizitem Fahrt-Wunsch
    const offerUber =
      wantsUberExplicitly(response.speechText) ||
      ((ctx.kind === 'food' || ctx.kind === 'reservation') &&
        speechCommitsToNavigation(response.speechText));

    if (offerUber) {
      let destLat: number | undefined = ctx.primaryOffer.lat;
      let destLng: number | undefined = ctx.primaryOffer.lng;
      let destName = ctx.primaryOffer.name;
      const pois = await getAllPois();
      const poi = pois.find((p) => p.id === ctx.primaryOffer!.poiId);
      if (poi) {
        destLat = poi.lat;
        destLng = poi.lng;
        destName = poi.name;
      }
      const hasUber = actions.some((a) => a.type === 'BOOK_UBER');
      if (!hasUber && destLat != null && destLng != null) {
        actions.push({
          type: 'BOOK_UBER',
          label: 'Uber',
          payload: { destLat, destLng, destName },
        });
      }
    } else {
      actions = actions.filter((a) => a.type !== 'BOOK_UBER');
    }
  }

  const offerCar =
    ctx?.wantsCarRental === true ||
    actions.some((a) => a.type === 'BOOK_CAR_RENTAL') ||
    /\b(mietwagen|leihwagen|auto\s+mieten|wagen\s+mieten)\b/iu.test(
      response.speechText,
    );

  if (offerCar) {
    const carIdx = actions.findIndex((a) => a.type === 'BOOK_CAR_RENTAL');
    const carAction = buildCarRentalAction();
    if (carIdx >= 0) {
      actions[carIdx] = {
        ...actions[carIdx],
        label: actions[carIdx].label || carAction.label,
        payload: {
          ...actions[carIdx].payload,
          url: carAction.payload.url,
        },
      };
    } else {
      actions.push(carAction);
    }
  }

  const profileForBounce = getCachedUserProfile();
  const bounceAvailable = isBounceAvailableForCity(
    profileForBounce?.cityId,
    profileForBounce?.cityName,
  );
  const offerBounce =
    bounceAvailable &&
    (ctx?.wantsBounceLuggage === true ||
      actions.some((a) => a.type === 'BOOK_BOUNCE_LUGGAGE') ||
      /\b(gepäck|gepaeck|kofferfrei|bounce|aufbewahrung|früheincheck|frueheincheck|spätabflug|spaetabflug)\b/iu.test(
        response.speechText,
      ));

  if (offerBounce) {
    const bounceIdx = actions.findIndex((a) => a.type === 'BOOK_BOUNCE_LUGGAGE');
    const bounceAction = buildBounceLuggageAction();
    if (bounceAction) {
      if (bounceIdx >= 0) {
        actions[bounceIdx] = {
          ...actions[bounceIdx],
          label: actions[bounceIdx].label || bounceAction.label,
          payload: {
            ...actions[bounceIdx].payload,
            url: bounceAction.payload.url,
          },
        };
      } else {
        actions.push(bounceAction);
      }
    }
  } else {
    // Kein Bounce vor Ort — Partner-Button entfernen
    for (let i = actions.length - 1; i >= 0; i--) {
      if (actions[i]?.type === 'BOOK_BOUNCE_LUGGAGE') actions.splice(i, 1);
    }
  }

  const offerStay22 =
    !ctx?.namedDestination &&
    (ctx?.wantsStay22 === true ||
      actions.some((a) => a.type === 'BOOK_STAY22') ||
      (/\b(hotel|ferienwohnung|apartment|unterkunft|übernacht|uebernacht|stay22)\b/iu.test(
        response.speechText,
      ) &&
        !/\b(führ|fuehr|bring|navigier|route\s+zu)\b/iu.test(response.speechText)));

  if (offerStay22) {
    const existing = actions.find((a) => a.type === 'BOOK_STAY22');
    const dest =
      ctx?.stay22Destination?.trim() ||
      existing?.payload.destination?.trim() ||
      getCachedUserProfile()?.cityName?.trim() ||
      'Germany';
    // Never use a single hotel proper name as Stay22 address
    const safeDest =
      /\bhotel\b/i.test(dest) && !/\b(in|umgebung|nähe|naehe)\b/i.test(dest)
        ? getCachedUserProfile()?.cityName?.trim() || dest
        : dest;
    const stayAction = buildStay22AccommodationAction(safeDest);
    stayAction.label = '🏨 Mehr Unterkünfte';
    const stayIdx = actions.findIndex((a) => a.type === 'BOOK_STAY22');
    if (stayIdx >= 0) {
      actions[stayIdx] = {
        ...actions[stayIdx],
        label: '🏨 Mehr Unterkünfte',
        payload: {
          ...actions[stayIdx].payload,
          ...stayAction.payload,
          destination: safeDest,
        },
      };
    } else {
      actions.push(stayAction);
    }
  } else {
    actions = actions.filter((a) => a.type !== 'BOOK_STAY22');
  }

  // Konkrete Hotel-Stichpunkte nur wenn die KI gar keine geliefert hat
  let bullets = [...response.visualBullets];
  if (
    ctx?.accommodationHints &&
    ctx.accommodationHints.length > 0 &&
    bullets.length === 0
  ) {
    bullets = ctx.accommodationHints.slice(0, 3).map((h) => {
      const dist =
        h.distanceM != null
          ? h.distanceM < 1000
            ? `${h.distanceM} m`
            : `${(h.distanceM / 1000).toFixed(1)} km`
          : null;
      const whyShort = h.why.split(':')[0]?.trim() || 'Unterkunft';
      return dist
        ? `${h.name} — ${dist} — ${whyShort}`
        : `${h.name} — ${whyShort}`;
    });
  }

  // Tour-Partner: Fake-Slugs → Suche; Intent → preferTicketSource / OPEN_URL
  const offerTours =
    ctx?.wantsTours === true ||
    actions.some(
      (a) =>
        a.type === 'OPEN_GYG_WIDGET' ||
        (a.type === 'OPEN_URL' &&
          /getyourguide|musement|viator|tripadvisor/i.test(
            a.payload.url ?? a.payload.gygTourSlug ?? '',
          )),
    ) ||
    /\b(tour|museum|ausflug|stadtführung|stadtfuehrung|getyourguide|musement|viator)\b/iu.test(
      response.speechText,
    );

  const city =
    ctx?.tourDestination?.trim() ||
    ctx?.stay22Destination?.trim() ||
    getCachedUserProfile()?.cityName?.trim() ||
    '';

  if (offerTours) {
    for (let i = 0; i < actions.length; i++) {
      const a = actions[i];
      if (a.type === 'OPEN_URL' && a.payload.url) {
        const url = a.payload.url;
        if (/getyourguide\.com/i.test(url)) {
          const path = url.replace(/^https?:\/\/(www\.)?getyourguide\.com\/?/i, '');
          if (looksLikeFakeTourSlug(path)) {
            actions[i] = {
              ...a,
              payload: {
                ...a.payload,
                url: buildGetYourGuideSearchUrl(city || path),
              },
            };
          } else {
            actions[i] = {
              ...a,
              payload: { ...a.payload, url: normalizeAffiliateUrl(url) },
            };
          }
        } else if (/musement|viator|tripadvisor/i.test(url)) {
          actions[i] = {
            ...a,
            payload: { ...a.payload, url: normalizeAffiliateUrl(url) },
          };
        }
      }
      if (
        a.type === 'OPEN_GYG_WIDGET' &&
        a.payload.gygTourSlug &&
        looksLikeFakeTourSlug(a.payload.gygTourSlug)
      ) {
        actions[i] = {
          type: 'OPEN_URL',
          label: a.label || '🎟️ Touren suchen',
          payload: {
            url: buildGetYourGuideSearchUrl(
              city || a.payload.gygTourSlug.replace(/[-_/]+/g, ' '),
            ),
          },
        };
      }
    }

    const hasTourLink = actions.some(
      (a) =>
        a.type === 'OPEN_GYG_WIDGET' ||
        (a.type === 'OPEN_URL' &&
          /getyourguide|musement|viator|tripadvisor/i.test(a.payload.url ?? '')),
    );
    if (!hasTourLink) {
      const tourAction = buildTourBookingAction({
        kind:
          ctx?.tourKind === 'museum'
            ? 'museum'
            : ctx?.tourKind === 'vip'
              ? 'vip'
              : 'tour',
        city: city || undefined,
        query: city || undefined,
      });
      actions.push(tourAction);
    }
  }

  const primaryIntent: QuickActionType[] = [];
  if (offerStay22) primaryIntent.push('BOOK_STAY22');
  if (offerBounce) primaryIntent.push('BOOK_BOUNCE_LUGGAGE');
  if (offerCar) primaryIntent.push('BOOK_CAR_RENTAL');
  if (offerTours) {
    primaryIntent.push('OPEN_URL', 'OPEN_GYG_WIDGET');
  }

  // Allgemeine „was geht“-Tipps: nur Nav-Chips — Partner/Playlist nicht mitfluten.
  // Event-Recherche: OPEN_URL (PDF/Flyer/Tickets) behalten.
  if (ctx?.kind === 'general' && !offerCar && !offerBounce && !offerStay22 && !offerTours) {
    const keepEventUrls = Boolean(ctx.eventResearch?.events?.length);
    actions = actions.filter(
      (a) =>
        a.type === 'START_NAVIGATION' ||
        a.type === 'SHOW_MORE' ||
        a.type === 'DIAL_PHONE' ||
        (keepEventUrls &&
          a.type === 'OPEN_URL' &&
          Boolean(a.payload.url?.trim())),
    );
  }

  const cap = actionCap(ctx);
  const ranked = prioritizeQuickActions(actions, {
    primaryIntentTypes: primaryIntent,
    maxActions: cap,
    maxNavActions: navCap(ctx),
  });

  // Gemini-IDs prüfen / unbekannte Orte geocoden → pendingNavOffer setzen
  const normalized = await normalizeNavActionsAndOffer({
    actions: ranked,
    fallbackOffer:
      ctx?.primaryOffer ?? useFinnusStore.getState().pendingNavOffer,
  });
  actions = normalized.actions as typeof actions;

  if (
    !ctx?.primaryOffer &&
    !offerCar &&
    !offerBounce &&
    !offerStay22 &&
    !offerTours &&
    !actions.some((a) => a.type === 'START_NAVIGATION')
  ) {
    const withMap = await attachCityMapAction(response, response.quickActions);
    const base = {
      ...response,
      quickActions: withMap,
    };
    const enriched =
      ctx?.kind === 'general' || !wantsMusicExplicitly(response.speechText)
        ? base
        : enrichPlaylistOffers(base);
    return {
      ...enriched,
      speechText:
        enriched.speechText.trim() ||
        ctx?.fallbackSpeech?.trim() ||
        response.speechText,
      quickActions: prioritizeQuickActions(enriched.quickActions, {
        maxActions: cap,
        maxNavActions: navCap(ctx),
      }),
    };
  }

  const withMap = await attachCityMapAction(
    response,
    actions.slice(0, cap),
  );
  const base = {
    ...response,
    visualBullets: clampVisualBullets(
      bullets.length > 0
        ? bullets
        : ctx?.fallbackBullets?.length
          ? ctx.fallbackBullets
          : bullets,
    ),
    quickActions: withMap,
    cardTitle:
      response.cardTitle || (ctx ? titleForKind(ctx.kind) : undefined),
  };
  const enriched =
    ctx?.kind === 'general' || !wantsMusicExplicitly(response.speechText)
      ? base
      : enrichPlaylistOffers(base);

  let speechText = enriched.speechText.trim();
  if (!speechText && ctx?.fallbackSpeech?.trim()) {
    speechText = ctx.fallbackSpeech.trim();
  }

  return {
    ...enriched,
    speechText,
    visualBullets: clampVisualBullets(
      enriched.visualBullets.length > 0
        ? enriched.visualBullets
        : ctx?.fallbackBullets ?? [],
    ),
    quickActions: prioritizeQuickActions(enriched.quickActions, {
      primaryIntentTypes: primaryIntent,
      maxActions: cap,
      maxNavActions: navCap(ctx),
    }),
  };
}

function titleForKind(kind: ConciergeContext['kind']): string {
  switch (kind) {
    case 'food':
    case 'reservation':
      return 'Empfehlungen in deiner Nähe';
    case 'weather':
      return 'Wetter & Plan B';
    case 'infra':
      return 'In der Nähe';
    case 'flight':
      return 'Flug & Anreise';
    case 'travel':
      return 'Reise & Mietwagen';
    case 'luggage':
      return 'Gepäck & Bounce';
    case 'accommodation':
      return 'Unterkunft & Stay22';
    case 'tours':
      return 'Touren & Tickets';
    case 'general':
      return 'Heute vor Ort';
    default:
      return 'Findus Spickzettel';
  }
}

export function transitAdviceToConcierge(
  advice: TransitAdvice,
  speechText: string,
  offerNavigation = true,
): GeminiConciergeResponse {
  const first =
    advice.departures.find((d) => !d.cancelled) ?? advice.departures[0];
  const second =
    advice.departures.find((d) => d !== first && !d.cancelled) ??
    advice.departures[1];
  const bullets: string[] = [];

  if (first) {
    const h = first.when.getHours().toString().padStart(2, '0');
    const m = first.when.getMinutes().toString().padStart(2, '0');
    const status = formatDelayStatus(first);
    // Ein kompakter Stichpunkt reicht oft: Zug + Zeit + Status + Richtung
    bullets.push(
      `${first.line} ${h}:${m} · ${status} → ${first.direction}`,
    );
  }

  // Zweite Abfahrt nur, wenn sie wirklich eine Alternative ist
  if (
    second &&
    first &&
    second.when.getTime() !== first.when.getTime()
  ) {
    const h = second.when.getHours().toString().padStart(2, '0');
    const m = second.when.getMinutes().toString().padStart(2, '0');
    bullets.push(
      `Danach: ${second.line} ${h}:${m} · ${formatDelayStatus(second)}`,
    );
  }

  // Dritter Punkt nur wenn sinnvoll (kein Live / langer Fußweg)
  if (advice.source === 'takt') {
    bullets.push('Live-Verspätung gerade nicht verfügbar');
  } else if (advice.pacing?.scenario === 'relaxed' && bullets.length < 3) {
    bullets.push(`Entwarnung · +${advice.pacing.delayMin ?? '?'} Min Verspätung`);
  } else if (advice.pacing?.scenario === 'tight' && bullets.length < 3) {
    bullets.push('Knapp — lieber Tempo machen');
  } else if (advice.walkMinutes >= 8 && bullets.length < 3) {
    bullets.push(`Fußweg ca. ${advice.walkMinutes} Min`);
  }

  const actions: QuickAction[] = offerNavigation
    ? [
        {
          type: 'START_NAVIGATION',
          label: '📍 Kompass zum Bahnhof',
          payload: { targetPoiId: advice.stationPoi.id },
        },
      ]
    : [];

  return {
    speechText,
    cardTitle: 'Nächste Bahn',
    visualBullets: clampVisualBullets(bullets),
    quickActions: actions,
  };
}

/**
 * Zero Dead-Ends: nur wenn ein echter nächster Klick existiert.
 * Kein Placebo-Chip, wenn Speech zugibt dass keine Daten da sind.
 */
function ensureZeroDeadEndActions(
  response: GeminiConciergeResponse,
  skipNav: boolean,
): GeminiConciergeResponse {
  if (response.quickActions.length > 0) return response;

  if (speechAdmitsNoActionableData(response.speechText)) {
    return response;
  }

  const offer = useFinnusStore.getState().pendingNavOffer;
  if (!skipNav && offer) {
    return {
      ...response,
      quickActions: [
        {
          type: 'START_NAVIGATION',
          label: `📍 Route zu ${offer.name}`,
          payload: {
            targetPoiId: offer.poiId,
            destName: offer.name,
            destLat: offer.lat,
            destLng: offer.lng,
          },
        },
      ],
    };
  }

  // Info-only / Mitdenken ohne Tool → kein erzwungener „Weiterhelfen“-Chip
  return response;
}

/**
 * Kompass zuerst (wenn zugesagt) → Stimme parallel → Card wenn Audio läuft.
 */
export async function presentConciergeResponse(
  response: GeminiConciergeResponse,
  opts?: { skipAutoNav?: boolean; userText?: string },
): Promise<void> {
  const store = useFinnusStore.getState();

  // Pipeline-Ende: NUR sync Code-Judge + Guardrails (kein LLM — LLM-Judge nur 1× in twoPass)
  {
    const judged = applyActionButtonJudge(response, {
      userText: opts?.userText ?? response.speechText,
    });
    response = judged.response;
    if (__DEV__ && judged.changed) {
      console.log(
        '[present] action-button-judge (sync-only)',
        judged.notes
          .filter((n) => n.action !== 'kept')
          .map((n) => `${n.action}:${n.reason}`)
          .join(' | '),
      );
    }
  }

  {
    const guarded = applyHardGuardrails(response, { userText: opts?.userText });
    response = guarded.response;
  }

  // Context Action Policy: keine proaktive Nav im Hotel nachts
  try {
    const { filterActionsForContext } = await import(
      '../ui/contextTriggerMatrix'
    );
    const explicitNav = /\b(bring\s+mich|navigier|führ\s+mich|fuehr\s+mich|route)\b/iu.test(
      response.speechText,
    );
    response = {
      ...response,
      quickActions: filterActionsForContext(response.quickActions, {
        explicitNav,
      }),
    };
  } catch {
    /* ignore */
  }

  // Zero-Fake: Turnierplan-Chips ohne URL etc. weg
  response = {
    ...response,
    quickActions: stripUnbackedActions(response.quickActions),
  };

  // Zero Dead-Ends: nur echte nächste Klicks
  response = ensureZeroDeadEndActions(response, opts?.skipAutoNav === true);

  // 1) Navigation SOFORT — Kompass sichtbar, User kann losgehen
  //    Stimme startet danach und läuft parallel weiter (kein Warten auf TTS-Ende).
  const navStarted = await autoStartNavigationIfCommitted(response, opts);
  if (navStarted) {
    useFinnusStore.getState().patchNavigation({
      navActive: true,
      navVisible: true,
    });
  }

  if (speechCommitsToMap(response.speechText)) {
    await openCityMap();
  }

  const hasVisual =
    response.visualBullets.length > 0 ||
    response.quickActions.length > 0 ||
    speechAsksForConfirmation(response.speechText);
  const card = hasVisual ? toConciergeCardState(response) : null;

  // Voice-Follow-up: letztes Partner-Angebot merken („Ja, buchen“)
  useFinnusStore
    .getState()
    .setPendingAffiliateOffer(pickPendingAffiliateOffer(response.quickActions));

  const voiceSettings = await getVoiceSettingsForTour();

  let speech = response.speechText.trim();
  if (speech.length < 8) {
    const { generateUniversalFallbackReply } = await import(
      '../../runtime/approachVisualCue'
    );
    speech =
      (await generateUniversalFallbackReply({
        userQuestion: speech || store.chatHistory.slice(-1)[0]?.content || '',
        placeName: store.currentLocationName,
        intentKind: 'concierge',
      })) ??
      'Kurz nochmal: wobei kann ich dir gerade helfen?';
  }

  useFinnusStore.getState().setIsGenerating(false);

  const speakPromise = speakRuntimeText(speech, {
    voiceId: voiceSettings.voiceId,
    speechRate: voiceSettings.speechRate,
  });

  // 3) Spickzettel sobald Stimme startet — nicht auf TTS-Ende warten
  if (card) {
    // Deep Exec Telemetry: generated action buttons (what Findus put into the UI).
    recordFindusActionsTriggered(card.quickActions, Date.now());
    await waitUntilVoicePlaying(2500);
    useFinnusStore.getState().setActiveConciergeCard(card);
  } else {
    useFinnusStore.getState().setActiveConciergeCard(null);
  }

  try {
    await speakPromise;
  } catch (err: unknown) {
    console.warn('[concierge] TTS failed:', err);
  } finally {
    try {
      const {
        releaseSpeakingUiIfIdle,
        getActiveTtsSessionCount,
        forceClearSpeakingUi,
      } = await import('../AudioVoiceService');
      if (getActiveTtsSessionCount() === 0) {
        releaseSpeakingUiIfIdle();
        forceClearSpeakingUi();
      }
    } catch {
      useFinnusStore.getState().setIsPlayingAudio(false);
      useFinnusStore.getState().setSubtitleText(null);
    }
  }
}
