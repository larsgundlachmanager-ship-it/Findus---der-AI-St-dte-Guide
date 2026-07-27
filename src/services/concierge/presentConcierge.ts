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
import {
  speakAssistantText,
  getVoiceSettingsForTour,
} from '../ttsService';
import type { ConciergeContext } from './conciergeContext';
import {
  clampVisualBullets,
} from './parseConciergeResponse';
import type { TransitAdvice } from '../transit/transitAdvisor';
import { formatDelayStatus } from '../transit/transitAdvisor';
import { startNavigation } from '../navigation';
import { resolvePoiId } from '../actionHandlerService';
import { getActiveNavDestination } from '../navigation/navigationService';
import { getAllPois } from '../../db/database';
import {
  buildBounceLuggageAction,
  buildCarRentalAction,
  buildStay22AccommodationAction,
  buildTourBookingAction,
  buildUberRideAction,
  looksLikeFakeTourSlug,
  buildGetYourGuideSearchUrl,
  normalizeAffiliateUrl,
  isBounceAvailableForCity,
} from '../affiliate/affiliateService';
import {
  MAX_QUICK_ACTIONS,
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

async function resolveAutoNavPoiId(
  response: GeminiConciergeResponse,
): Promise<number | null> {
  for (const a of response.quickActions) {
    if (a.type !== 'START_NAVIGATION') continue;
    const id = await resolvePoiId(a.payload.targetPoiId);
    if (id != null) return id;
  }
  const offer = useFinnusStore.getState().pendingNavOffer;
  if (offer?.poiId != null) return offer.poiId;
  return null;
}

/**
 * Kompass sofort aktivieren, wenn Speech das zusagt.
 * Blockiert die Stimme nicht länger als nötig.
 */
export async function autoStartNavigationIfCommitted(
  response: GeminiConciergeResponse,
): Promise<boolean> {
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

  const poiId = await resolveAutoNavPoiId(response);
  if (poiId == null) {
    console.warn(
      '[concierge] Speech sagt Navigation zu, aber kein targetPoiId/Offer',
    );
    return false;
  }

  if (store.navActive && getActiveNavDestination()?.poiId === poiId) {
    return true;
  }

  const ok = await startNavigation(poiId);
  if (__DEV__) {
    console.log(
      `[concierge] auto-start nav poi=#${poiId} ok=${ok} (Kompass vor/parallel zur Stimme)`,
    );
  }
  return ok;
}

/** Ergänzt Nav-, Uber- und Mietwagen-Actions aus lokalem Concierge-Kontext. */
export async function enrichWithConciergeOffers(
  response: GeminiConciergeResponse,
  ctx: ConciergeContext | null,
): Promise<GeminiConciergeResponse> {
  const actions = [...response.quickActions];

  if (ctx?.primaryOffer) {
    const hasNav = actions.some((a) => a.type === 'START_NAVIGATION');
    if (!hasNav) {
      actions.unshift({
        type: 'START_NAVIGATION',
        label: `📍 Route: ${ctx.primaryOffer.name}`,
        payload: { targetPoiId: ctx.primaryOffer.poiId },
      });
    }
    for (const alt of ctx.alternatives.slice(0, 2)) {
      const exists = actions.some(
        (a) =>
          a.type === 'START_NAVIGATION' &&
          String(a.payload.targetPoiId) === String(alt.poiId),
      );
      if (!exists) {
        actions.push({
          type: 'START_NAVIGATION',
          label: `📍 Route: ${alt.name}`,
          payload: { targetPoiId: alt.poiId },
        });
      }
    }

    const offerUber =
      ctx.kind === 'food' ||
      ctx.kind === 'reservation' ||
      ctx.kind === 'infra' ||
      ctx.kind === 'general';

    if (offerUber) {
      let destLat: number | undefined;
      let destLng: number | undefined;
      try {
        const pois = await getAllPois();
        const poi = pois.find((p) => p.id === ctx.primaryOffer!.poiId);
        if (poi) {
          destLat = poi.lat;
          destLng = poi.lng;
        }
      } catch {
        /* coords optional — Handler löst über targetPoiId */
      }

      const uberIdx = actions.findIndex((a) => a.type === 'BOOK_UBER');
      if (uberIdx >= 0) {
        const existing = actions[uberIdx];
        const needCoords =
          existing.payload.destLat == null || existing.payload.destLng == null;
        if (needCoords && destLat != null && destLng != null) {
          actions[uberIdx] = {
            ...existing,
            payload: {
              ...existing.payload,
              ...buildUberRideAction(
                destLat,
                destLng,
                existing.payload.destName || ctx.primaryOffer.name,
                ctx.primaryOffer.poiId,
              ).payload,
            },
          };
        } else if (!existing.payload.targetPoiId) {
          actions[uberIdx] = {
            ...existing,
            payload: {
              ...existing.payload,
              targetPoiId: ctx.primaryOffer.poiId,
              destName: existing.payload.destName || ctx.primaryOffer.name,
            },
          };
        }
      } else if (destLat != null && destLng != null) {
        actions.push(
          buildUberRideAction(
            destLat,
            destLng,
            ctx.primaryOffer.name,
            ctx.primaryOffer.poiId,
          ),
        );
      } else {
        actions.push({
          type: 'BOOK_UBER',
          label: '🚗 Fahrt mit Uber buchen',
          payload: {
            targetPoiId: ctx.primaryOffer.poiId,
            destName: ctx.primaryOffer.name,
          },
        });
      }
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
  } else {
    // Kein Bounce vor Ort — Partner-Button entfernen
    for (let i = actions.length - 1; i >= 0; i--) {
      if (actions[i]?.type === 'BOOK_BOUNCE_LUGGAGE') actions.splice(i, 1);
    }
  }

  const offerStay22 =
    ctx?.wantsStay22 === true ||
    actions.some((a) => a.type === 'BOOK_STAY22') ||
    /\b(hotel|ferienwohnung|apartment|unterkunft|übernacht|uebernacht|stay22)\b/iu.test(
      response.speechText,
    );

  if (offerStay22) {
    const existing = actions.find((a) => a.type === 'BOOK_STAY22');
    const dest =
      existing?.payload.destination?.trim() ||
      ctx?.stay22Destination?.trim() ||
      getCachedUserProfile()?.cityName?.trim() ||
      'Germany';
    const stayAction = buildStay22AccommodationAction(dest);
    stayAction.label = '🏨 Mehr Unterkünfte';
    const stayIdx = actions.findIndex((a) => a.type === 'BOOK_STAY22');
    if (stayIdx >= 0) {
      actions[stayIdx] = {
        ...actions[stayIdx],
        label: actions[stayIdx].label.includes('Unterkunft')
          ? '🏨 Mehr Unterkünfte'
          : actions[stayIdx].label || stayAction.label,
        payload: {
          ...actions[stayIdx].payload,
          ...stayAction.payload,
        },
      };
    } else {
      actions.push(stayAction);
    }
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

  const ranked = prioritizeQuickActions(actions, {
    primaryIntentTypes: primaryIntent,
  });

  if (
    !ctx?.primaryOffer &&
    !offerCar &&
    !offerBounce &&
    !offerStay22 &&
    !offerTours
  ) {
    const withMap = await attachCityMapAction(response, response.quickActions);
    return enrichPlaylistOffers({
      ...response,
      quickActions: withMap,
    });
  }

  const withMap = await attachCityMapAction(response, ranked.slice(0, MAX_QUICK_ACTIONS));
  return enrichPlaylistOffers({
    ...response,
    visualBullets: clampVisualBullets(bullets),
    quickActions: withMap,
    cardTitle:
      response.cardTitle || (ctx ? titleForKind(ctx.kind) : undefined),
  });
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
 * Kompass zuerst (wenn zugesagt) → Stimme parallel → Card wenn Audio läuft.
 */
export async function presentConciergeResponse(
  response: GeminiConciergeResponse,
): Promise<void> {
  const store = useFinnusStore.getState();

  // 1) Navigation SOFORT — Kompass sichtbar, User kann losgehen
  //    Stimme startet danach und läuft parallel weiter (kein Warten auf TTS-Ende).
  const navStarted = await autoStartNavigationIfCommitted(response);
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

  // 2) Stimme — Navigation bleibt aktiv
  const speakPromise = speakAssistantText(response.speechText, {
    voiceId: voiceSettings.voiceId,
    speechRate: voiceSettings.speechRate,
  });

  // 3) Spickzettel, sobald die Stimme läuft
  if (card) {
    await waitUntilVoicePlaying(4500);
    useFinnusStore.getState().setActiveConciergeCard(card);
  }

  await speakPromise;

  if (!card) {
    useFinnusStore.getState().setActiveConciergeCard(null);
  }
}
