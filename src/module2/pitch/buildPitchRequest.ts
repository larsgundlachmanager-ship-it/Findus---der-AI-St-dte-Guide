/**
 * Brief-Builder: Wish (M5) / User-Text (M2) → PitchRequest.
 */

import { anchorCoords, readRucksackSync } from '../rucksack/rucksackStore';
import { useFinnusStore } from '../../store/useFinnusStore';
import { usePlanCalendarUiStore } from '../timeline/planCalendarUiStore';
import type { IngestOpenWish } from '../planning/planningTypes';
import {
  buildPrefSliceForPitch,
  detectPitchKind,
  mergeProfileDietIntoWishes,
  parseWishesFromText,
  resolveSearchMode,
  resolveVisitAtMs,
} from './parentBrief';
import { looksLikePicnicQuery } from './picnicIntent';
import type { PitchRequest, PitchRouteBrief } from './types';

function activeNavRoute(): PitchRouteBrief | null {
  try {
    const s = useFinnusStore.getState();
    if (!s.navActive) return null;
    const bag = readRucksackSync();
    const origin = anchorCoords(bag);
    const tour = s.multiStopTour;
    const stop = tour?.stops?.[tour.currentIndex ?? 0];
    if (
      stop &&
      typeof stop.lat === 'number' &&
      typeof stop.lng === 'number'
    ) {
      return {
        start: { lat: origin.lat, lng: origin.lng },
        end: { lat: stop.lat, lng: stop.lng },
        user: { lat: origin.lat, lng: origin.lng },
        polyline: null,
      };
    }
    // Echte Nav-Zielkoordinaten — kein Fake-Endpunkt (sonst „auf dem Weg“-Müll)
    try {
      const { getActiveNavDestination } = require('../../services/navigation/navigationService') as {
        getActiveNavDestination: () => {
          lat: number;
          lng: number;
          name: string;
        } | null;
      };
      const dest = getActiveNavDestination();
      if (
        dest &&
        Number.isFinite(dest.lat) &&
        Number.isFinite(dest.lng)
      ) {
        return {
          start: { lat: origin.lat, lng: origin.lng },
          end: { lat: dest.lat, lng: dest.lng },
          user: { lat: origin.lat, lng: origin.lng },
          polyline: null,
        };
      }
    } catch {
      /* soft */
    }
    return null;
  } catch {
    return null;
  }
}

export function buildPitchRequestFromText(opts: {
  text: string;
  requestId?: string;
  uiLayout?: PitchRequest['uiLayout'];
  signal?: AbortSignal;
  continueFromBridge?: string | null;
  /** Call-1 Must-Haves / authorIntent — Backend-Filter + Call-2-Brief */
  call1MustHaves?: string[] | null;
  call1Criteria?: import('./call1Criteria').Call1Criterion[] | null;
  authorIntent?: string | null;
  /** Call-1 destCity / researchCity — Anker der Äußerung */
  call1DestCity?: string | null;
  /** Call-1 when-Slots → visitAtMs */
  call1When?: Array<{
    kind?: string;
    at?: string | null;
    dateKey?: string | null;
    label?: string | null;
  }> | null;
  /** Call-1 Order-Ticket (search/need/ui/bulletBudget) */
  call1Order?: {
    must?: string[];
    avoid?: string[];
    search?: {
      mode?: string;
      stages?: Array<'pack' | 'neighbor' | 'metro' | 'web' | 'verify'>;
      maxRadiusKm?: number;
      forbidSoftFill?: boolean;
    };
    need?: PitchRequest['orderNeed'];
    ui?: PitchRequest['orderUi'];
    bulletBudget?: PitchRequest['bulletBudget'];
  } | null;
}): { request: PitchRequest; bridge: string } {
  let text = opts.text || '';
  try {
    const { normalizeAyceStt } = require('./ayceIntent') as {
      normalizeAyceStt: (s: string) => string;
    };
    text = normalizeAyceStt(text);
  } catch {
    /* soft */
  }
  const bag = readRucksackSync();
  const anchor = anchorCoords(bag);
  const route = activeNavRoute();
  const calendarOpen = usePlanCalendarUiStore.getState().calendarVisible;
  const navActive = useFinnusStore.getState().navActive === true;
  const searchMode = resolveSearchMode({
    text,
    hasActiveNav: navActive || Boolean(route),
    hasTimelineNext: calendarOpen,
  });
  let visitAtMs = resolveVisitAtMs(text);
  try {
    const { visitAtMsFromCall1When } = require('./call1Criteria') as {
      visitAtMsFromCall1When: (
        w: typeof opts.call1When,
        n?: number,
      ) => number | null;
    };
    const fromCall1 = visitAtMsFromCall1When(opts.call1When);
    if (typeof fromCall1 === 'number' && Number.isFinite(fromCall1)) {
      visitAtMs = fromCall1;
    }
  } catch {
    /* soft */
  }
  const packCity = (() => {
    try {
      const id = String((bag as { cityId?: string; cityHint?: string }).cityId || '')
        .replace(/_/g, ' ')
        .trim();
      return id && !/^\d+$/.test(id) ? id : '';
    } catch {
      return '';
    }
  })();
  const explicitCity = (() => {
    try {
      const { extractCityFromText } = require('../context/shortTermContext') as {
        extractCityFromText: (s: string) => string | null;
      };
      return extractCityFromText(text);
    } catch {
      return null as string | null;
    }
  })();
  // Partition wie Stadt-Chat: fremder Sticky (London) fällt bei neuer Suche zugunsten Active/Pack.
  const scopeCity = (() => {
    try {
      const { resolveCityChatScope } = require('../context/placeContext') as {
        resolveCityChatScope: (t?: string | null) => { cityHint: string | null };
      };
      return (resolveCityChatScope(text).cityHint || '').trim();
    } catch {
      return '';
    }
  })();
  const rawCity = (explicitCity || scopeCity || packCity || '').trim();
  const cityHint =
    rawCity &&
    !/\d/.test(rawCity) &&
    !/\b(straße|strasse|weg|allee|platz|hoop|gasse)\b/i.test(rawCity)
      ? rawCity
      : packCity || null;
  // Explizite Stadt in der Frage schlägt Sticky/Pack und GPS-Anker-Label
  const effectiveSearchMode =
    explicitCity && searchMode === 'here_now' ? 'city_best' : searchMode;
  let kind = detectPitchKind(text);
  // Phase 5a: Amenity-Ort (Whitelist) ODER Open-Find/Erlebnis → Pitch
  let amenityMusts: string[] = [];
  let themeMusts: string[] = [];
  let regionalOpenPlace = false;
  try {
    const {
      isAmenityPlaceFindQuery,
      amenityPlaceMustLabels,
    } = require('../mission/amenityPlaceFind') as {
      isAmenityPlaceFindQuery: (s: string) => boolean;
      amenityPlaceMustLabels: (s: string) => string[];
    };
    const {
      isRegionalOpenPlaceFind,
      isOpenPlaceFindQuery,
      isOpenExperienceQuery,
      extractOpenThemeNeed,
    } = require('../mission/openPlaceFind') as {
      isRegionalOpenPlaceFind: (
        s: string,
        musts: string[],
        o?: { fromWhitelist?: boolean },
      ) => boolean;
      isOpenPlaceFindQuery: (s: string) => boolean;
      isOpenExperienceQuery: (s: string) => boolean;
      extractOpenThemeNeed: (s: string) => string | null;
    };
    if (isAmenityPlaceFindQuery(text)) {
      const labels = amenityPlaceMustLabels(text);
      const theme = extractOpenThemeNeed(text);
      if (theme && labels.includes(theme)) {
        themeMusts = [theme];
        if (
          kind !== 'food' &&
          kind !== 'hotel' &&
          kind !== 'cinema' &&
          kind !== 'bar'
        ) {
          kind = 'sight';
        }
      } else {
        amenityMusts = labels;
        kind = 'generic';
      }
      regionalOpenPlace = isRegionalOpenPlaceFind(
        text,
        [...amenityMusts, ...themeMusts],
        {
          fromWhitelist: !isOpenPlaceFindQuery(text) && !isOpenExperienceQuery(text),
        },
      );
    }
  } catch {
    /* soft */
  }
  // Specialty-Food (Croque/…) nie als Sight/Generic — sonst Pack-Brücken als „Zwei Optionen“
  try {
    const { looksLikeSpecialtyFoodAsk } = require('./specializedFoodMatch') as {
      looksLikeSpecialtyFoodAsk: (s: string) => boolean;
    };
    if (
      looksLikeSpecialtyFoodAsk(text) &&
      kind !== 'food' &&
      kind !== 'bar' &&
      kind !== 'hotel' &&
      kind !== 'cinema'
    ) {
      kind = 'food';
      amenityMusts = [];
    }
  } catch {
    /* soft */
  }
  const prefs = buildPrefSliceForPitch(text);
  let baseWishes = mergeProfileDietIntoWishes(
    parseWishesFromText(text),
    prefs,
    kind,
    text,
  );
  // Amenity-Musts + Theme-Musts (Open-Erlebnis) + Hotel-Constraints aus Mission mergen
  for (const label of amenityMusts) {
    if (!baseWishes.some((w) => w.text.toLowerCase() === label.toLowerCase())) {
      baseWishes.push({
        text: label,
        hardness: 'must',
        kind: 'amenity',
        weight: 36,
      });
    }
  }
  for (const label of themeMusts) {
    if (!baseWishes.some((w) => w.text.toLowerCase() === label.toLowerCase())) {
      baseWishes.push({
        text: label,
        hardness: 'must',
        kind: 'theme',
        weight: 40,
      });
    }
  }
  if (kind === 'hotel') {
    try {
      const { buildMissionChecklist } = require('../mission/buildMissionChecklist') as {
        buildMissionChecklist: (o: { userText: string }) => {
          must: string[];
          factsToProve: Array<{ id: string; value?: string | null }>;
        };
      };
      const mission = buildMissionChecklist({ userText: text });
      for (const m of mission.must) {
        if (!baseWishes.some((w) => w.text.toLowerCase() === m.toLowerCase())) {
          const amenity =
            /pool|sauna|spa|tischtennis|frühstück|fruehstueck|parkplatz/i.test(m);
          baseWishes.push({
            text: m,
            hardness: 'must',
            kind: amenity ? 'amenity' : 'generic',
            weight: 28,
          });
        }
      }
    } catch {
      /* soft */
    }
  }
  const mergedMustHaves = [
    ...(opts.call1MustHaves ?? []),
    ...amenityMusts,
  ];
  const { buildPitchSearchBrief } = require('./searchBrief') as {
    buildPitchSearchBrief: (o: {
      userText: string;
      kind: typeof kind;
      baseWishes: typeof baseWishes;
      call1MustHaves?: string[] | null;
      call1Criteria?: import('./call1Criteria').Call1Criterion[] | null;
      authorIntent?: string | null;
    }) => {
      wishes: typeof baseWishes;
      mustHaves: string[];
      criteria: import('./call1Criteria').Call1Criterion[];
      authorIntent: string | null;
      shortlistSize: number;
      avoidFromCall1: string[];
    };
  };
  // Compound: Sonnenuntergang → visitAt nahe Sunset (Puffer −45 Min für Ankommen)
  if (
    /\b(sonnenuntergang|sunset)\b/iu.test(text) &&
    (kind === 'food' || kind === 'bar' || kind === 'sight')
  ) {
    try {
      const { getLastWeatherSnapshot } = require('../../services/weatherService') as {
        getLastWeatherSnapshot: () => { sunsetMs?: number | null } | null;
      };
      const sunset = getLastWeatherSnapshot?.()?.sunsetMs;
      if (typeof sunset === 'number' && sunset > Date.now()) {
        visitAtMs = sunset - 45 * 60_000;
      }
    } catch {
      /* soft */
    }
  }

  const brief = buildPitchSearchBrief({
    userText: text,
    kind,
    baseWishes,
    call1MustHaves: mergedMustHaves.length ? mergedMustHaves : opts.call1MustHaves,
    call1Criteria: opts.call1Criteria,
    authorIntent: opts.authorIntent,
  });
  try {
    const { diningDishNeedFromText } = require('./diningHarden') as {
      diningDishNeedFromText: (s: string) => string | null;
    };
    const dishNeed = diningDishNeedFromText(text);
    if (
      dishNeed &&
      (kind === 'food' || kind === 'bar') &&
      !brief.wishes.some(
        (w) =>
          w.kind === 'dish' &&
          w.text.toLowerCase() === dishNeed.toLowerCase(),
      )
    ) {
      brief.wishes.push({
        text: dishNeed,
        hardness: 'must',
        kind: 'dish',
        weight: 28,
      });
      if (!brief.mustHaves.some((m) => m.toLowerCase() === dishNeed.toLowerCase())) {
        brief.mustHaves.push(dishNeed);
      }
    }
  } catch {
    /* soft */
  }
  // Call-1-Ablehnungen („kein Asiatisch“) → Avoid, nicht Hard-Must-Text
  if (brief.avoidFromCall1?.length) {
    prefs.avoidCategories = [
      ...new Set([...(prefs.avoidCategories ?? []), ...brief.avoidFromCall1]),
    ];
  }
  // Expliziter Cuisine-Wunsch schlägt Avoid derselben Familie (User override)
  const mustCuisine = brief.wishes
    .filter((w) => w.hardness === 'must' && w.kind === 'cuisine')
    .map((w) => w.text.toLowerCase());
  if (mustCuisine.length && prefs.avoidCategories?.length) {
    prefs.avoidCategories = prefs.avoidCategories.filter((a) => {
      const al = a.toLowerCase();
      return !mustCuisine.some(
        (c) =>
          al.includes(c) ||
          c.includes(al) ||
          (/asiatisch|asian|sushi|thai|indisch|japan|china|vietnam|korea/.test(c) &&
            /asiatisch|asian|sushi|thai|indisch|japan|china|vietnam|korea|ramen|poke/.test(
              al,
            )),
      );
    });
  }
  // Compound topic-cut: authorIntent markieren
  try {
    const { detectCall1Situation } = require('../reboot/pipeline/call1AnswerContract') as {
      detectCall1Situation: (t: string) => string;
    };
    if (detectCall1Situation(text) === 'dining_compound' && !brief.authorIntent) {
      brief.authorIntent =
        'Compound-Abend: Gericht + Blick/Sunset — Top-2 nach Kriterien, kein alter Chat-Faden.';
    }
  } catch {
    /* soft */
  }
  // Multi-Lane Plan an Request hängen
  let multiLane: import('../router/call1MultiLane').MultiLanePlan | null = null;
  try {
    const {
      detectMultiLanePlan,
      multiLaneAuthorIntent,
    } = require('../router/call1MultiLane') as {
      detectMultiLanePlan: (
        t: string,
      ) => import('../router/call1MultiLane').MultiLanePlan | null;
      multiLaneAuthorIntent: (
        p: import('../router/call1MultiLane').MultiLanePlan,
      ) => string;
    };
    multiLane = detectMultiLanePlan(text);
    if (multiLane) {
      brief.authorIntent = multiLaneAuthorIntent(multiLane);
      if (multiLane.kind === 'fetch_then_spot') {
        kind = 'food';
        for (const label of multiLane.lanes[0]?.mustLabels ?? []) {
          if (
            !brief.wishes.some(
              (w) => w.text.toLowerCase() === label.toLowerCase(),
            )
          ) {
            brief.wishes.push({
              text: label,
              hardness: 'must',
              kind: /eis|to_go|pizza/i.test(label) ? 'dish' : 'amenity',
              weight: 30,
            });
          }
        }
      }
      if (multiLane.kind === 'or_either' || multiLane.kind === 'outdoor_program_weather') {
        kind = 'cinema';
        for (const label of multiLane.sharedMust) {
          if (
            !brief.wishes.some(
              (w) => w.text.toLowerCase() === label.toLowerCase(),
            )
          ) {
            brief.wishes.push({
              text: label,
              hardness: 'must',
              kind: 'theme',
              weight: 32,
            });
          }
        }
      }
    }
  } catch {
    multiLane = null;
  }
  const call1City = (opts.call1DestCity || '').replace(/\s+/g, ' ').trim();
  // Specialty (Gericht+Blick o. ä.): nicht am Dorf-GPS stecken — Metro-Datensatz
  let searchModeOut = effectiveSearchMode;
  let cityHintOut: string | null = call1City || explicitCity || cityHint;
  // Hotel-Follow-up ohne neue Stadt: Sticky-Ziel (Amsterdam) schlägt GPS-Heimat
  if (kind === 'hotel' && !explicitCity) {
    let mentioned: string | null = null;
    try {
      const { getLastMentionedCity } = require('../context/shortTermContext') as {
        getLastMentionedCity: () => string | null;
      };
      mentioned = getLastMentionedCity();
    } catch {
      mentioned = null;
    }
    const sticky =
      call1City ||
      mentioned ||
      (cityHint && cityHint !== packCity ? cityHint : null);
    if (sticky) {
      cityHintOut = sticky;
      if (searchModeOut === 'here_now') searchModeOut = 'city_best';
    }
  }
  if (kind === 'food' || kind === 'bar') {
    try {
      const { resolveSpecialtyResearchCity } = require('./specialtyResearchCity') as {
        resolveSpecialtyResearchCity: (o: {
          text: string;
          lat: number;
          lng: number;
          explicitCity?: string | null;
          call1DestCity?: string | null;
          wishes?: typeof brief.wishes;
          mustHaves?: string[] | null;
          criteria?: typeof brief.criteria;
        }) => { city: string; promoted: boolean } | null;
      };
      const promo = resolveSpecialtyResearchCity({
        text: text,
        lat: anchor.lat,
        lng: anchor.lng,
        explicitCity,
        call1DestCity: call1City,
        wishes: brief.wishes,
        mustHaves: brief.mustHaves,
        criteria: brief.criteria,
      });
      if (promo?.city) {
        cityHintOut = promo.city;
        if (
          searchModeOut === 'here_now' ||
          searchModeOut === 'future_place'
        ) {
          searchModeOut = 'city_best';
        }
      }
    } catch {
      /* soft */
    }
  }
  const ayceMust = brief.wishes.some(
    (w) =>
      w.hardness === 'must' &&
      w.kind === 'amenity' &&
      /all_you_can_eat|ayce|buffet|schlemmer/i.test(w.text),
  );
  if (ayceMust && searchModeOut === 'here_now') {
    searchModeOut = 'city_best';
  }
  const steakMust = brief.wishes.some(
    (w) =>
      w.hardness === 'must' &&
      (w.kind === 'dish' || w.kind === 'cuisine') &&
      /steak/i.test(w.text),
  );
  if (steakMust && searchModeOut === 'here_now') {
    searchModeOut = 'city_best';
  }
  const request: PitchRequest = {
    requestId: opts.requestId ?? `pitch_${Date.now()}`,
    title: text.slice(0, 80),
    context: text,
    kind,
    searchMode: searchModeOut,
    visitAtMs,
    wishes: brief.wishes,
    prefs,
    anchor: { lat: anchor.lat, lng: anchor.lng },
    cityHint: cityHintOut,
    route:
      searchModeOut === 'on_route' || searchModeOut === 'between_stops'
        ? route
        : null,
    landmark: null,
    uiLayout: (() => {
      try {
        const { resolvePitchUiLayout } = require('./pitchAmenityUi') as {
          resolvePitchUiLayout: (o: {
            kind: typeof kind;
            text: string;
            mustHaves?: string[] | null;
            requested?: 'live_split' | 'timeline_stack' | null;
            orderOpenCalendar?: boolean;
            orderOpenTimeline?: boolean;
          }) => 'live_split' | 'timeline_stack';
        };
        return resolvePitchUiLayout({
          kind,
          text,
          mustHaves: brief.mustHaves,
          requested:
            opts.uiLayout ??
            (looksLikePicnicQuery(text) || ayceMust
              ? 'live_split'
              : calendarOpen
                ? 'timeline_stack'
                : 'live_split'),
          orderOpenCalendar: Boolean(opts.call1Order?.ui?.openCalendar),
          orderOpenTimeline: Boolean(opts.call1Order?.ui?.openTimeline),
        });
      } catch {
        return (
          opts.uiLayout ??
          (looksLikePicnicQuery(text) || ayceMust
            ? 'live_split'
            : calendarOpen
              ? 'timeline_stack'
              : 'live_split')
        );
      }
    })(),
    bridgeAlreadySpoken: true,
    continueFromBridge: (opts.continueFromBridge || '').trim() || null,
    signal: opts.signal,
    authorIntent: brief.authorIntent,
    call1MustHaves: brief.mustHaves,
    call1Criteria: brief.criteria,
    shortlistSize: brief.shortlistSize,
    // Order.search oder AYCE: erste Suche schon Metro-Radius
    ...((): Partial<PitchRequest> => {
      const order = opts.call1Order;
      const maxKm =
        typeof order?.search?.maxRadiusKm === 'number' &&
        Number.isFinite(order.search.maxRadiusKm)
          ? Math.min(120, Math.max(5, order.search.maxRadiusKm))
          : regionalOpenPlace
            ? 100
            : null;
      const forbid =
        order?.search?.forbidSoftFill === true ||
        String(order?.search?.mode || '').toLowerCase() === 'hard' ||
        ayceMust;
      // Open-Find: sofort 25 km, Mission-Stages bis 100 km — nicht am 2-km-Dorf-Ring hängen
      const radiusM = maxKm
        ? Math.round(
            regionalOpenPlace && !order?.search?.maxRadiusKm
              ? Math.min(maxKm, 25) * 1000
              : maxKm * 1000,
          )
        : ayceMust
          ? 55_000
          : undefined;
      return {
        ...(radiusM ? { liveExpandRadiusM: radiusM } : {}),
        ...(forbid ? { forbidSoftFill: true } : {}),
        ...(maxKm ? { maxRadiusKm: maxKm } : {}),
        ...(order?.search?.stages?.length
          ? { searchStages: order.search.stages }
          : {}),
        ...(order?.need ? { orderNeed: order.need } : {}),
        ...(order?.ui ? { orderUi: order.ui } : {}),
        ...(order?.bulletBudget
          ? { bulletBudget: order.bulletBudget }
          : {}),
      };
    })(),
    ...(multiLane ? { multiLane } : {}),
  };
  const bridge = (opts.continueFromBridge || '').replace(/\s+/g, ' ').trim();
  return { request, bridge };
}

export function buildPitchRequestFromWish(
  wish: IngestOpenWish,
  opts?: { signal?: AbortSignal; uiLayout?: PitchRequest['uiLayout'] },
): { request: PitchRequest; bridge: string } {
  const blob = `${wish.title} ${wish.context}`;
  let wishLayout: 'live_split' | 'timeline_stack' =
    opts?.uiLayout ?? 'timeline_stack';
  try {
    const { isAmenitySinglePlacePitch } = require('./pitchAmenityUi') as {
      isAmenitySinglePlacePitch: (o: { text: string }) => boolean;
    };
    if (isAmenitySinglePlacePitch({ text: blob })) {
      wishLayout = 'live_split';
    }
  } catch {
    /* soft */
  }
  const built = buildPitchRequestFromText({
    text: blob,
    requestId: wish.id ?? `wish_${Date.now()}`,
    uiLayout: wishLayout,
    signal: opts?.signal,
  });
  if (wish.estimatedTime) {
    // Uhrzeit am Plan-Tag (nicht „heute +1 wenn vorbei“)
    try {
      const dayKey =
        usePlanCalendarUiStore.getState().requestedDayKey ||
        useFuturePlanDayKey();
      const m = wish.estimatedTime.match(/^(\d{1,2}):(\d{2})$/);
      if (m && dayKey) {
        const [y, mo, d] = dayKey.split('-').map(Number);
        built.request.visitAtMs = new Date(
          y!,
          mo! - 1,
          d!,
          Number(m[1]),
          Number(m[2]),
          0,
          0,
        ).getTime();
      } else {
        built.request.visitAtMs = resolveVisitAtMs(
          `um ${wish.estimatedTime} Uhr ${blob}`,
        );
      }
    } catch {
      built.request.visitAtMs = resolveVisitAtMs(
        `um ${wish.estimatedTime} Uhr ${blob}`,
      );
    }
  }
  // Abendessen ohne Uhr → ~19:00 am Plan-Tag
  if (
    !wish.estimatedTime &&
    /\b(abend|dinner|tonight|abendessen)\b/i.test(blob)
  ) {
    try {
      const dayKey =
        usePlanCalendarUiStore.getState().requestedDayKey ||
        useFuturePlanDayKey();
      if (dayKey) {
        const [y, mo, d] = dayKey.split('-').map(Number);
        built.request.visitAtMs = new Date(
          y!,
          mo! - 1,
          d!,
          19,
          0,
          0,
          0,
        ).getTime();
      }
    } catch {
      /* soft */
    }
  }
  // Planung: Stadt aus Plan/Anker — nicht GPS-Heimat (Prisdorf-Müll)
  try {
    const { extractCityFromText } = require('../context/shortTermContext') as {
      extractCityFromText: (s: string) => string | null;
    };
    const { usePlanSessionStore } = require('../planning/planSessionState') as {
      usePlanSessionStore: {
        getState: () => {
          cityHint: string | null;
          plan: {
            destinationCity?: string | null;
            geoAnchor?: { name?: string } | null;
          } | null;
        };
      };
    };
    const session = usePlanSessionStore.getState();
    const planCity =
      extractCityFromText(blob) ||
      session.plan?.destinationCity ||
      session.cityHint ||
      null;
    if (
      planCity &&
      (built.request.kind === 'food' ||
        built.request.kind === 'bar' ||
        built.request.kind === 'hotel' ||
        opts?.uiLayout === 'timeline_stack')
    ) {
      built.request.searchMode = 'city_best';
      built.request.cityHint = planCity;
    }
  } catch {
    /* soft */
  }
  // Freier Slot + Anker (vorheriger Stop) vor dem Pitch
  try {
    const dayKey =
      usePlanCalendarUiStore.getState().requestedDayKey ||
      useFuturePlanDayKey();
    if (dayKey && opts?.uiLayout === 'timeline_stack') {
      const {
        dayBoundsMs,
        findFreeSlotStartMs,
        hardIntervalsFromStops,
      } = require('../planning/planHardLock') as typeof import('../planning/planHardLock');
      const { useFuturePlanStore } = require('../timeline/futurePlanState') as {
        useFuturePlanStore: {
          getState: () => {
            getPlanForDay: (k: string) => { stops: unknown[] };
          };
        };
      };
      const bounds = dayBoundsMs(dayKey);
      const dayStops = useFuturePlanStore.getState().getPlanForDay(dayKey).stops;
      const stayMs =
        (built.request.kind === 'food' ? 75 : 45) * 60_000;
      const free = findFreeSlotStartMs({
        preferredStartMs: built.request.visitAtMs,
        durationMs: stayMs,
        hardIntervals: hardIntervalsFromStops(dayStops as never),
        dayStartMs: bounds.start,
        dayEndMs: bounds.end,
        nowFloorMs:
          dayKey ===
          (() => {
            try {
              const { todayDateKey } = require('../../utils/dateKeys') as {
                todayDateKey: () => string;
              };
              return todayDateKey();
            } catch {
              return '';
            }
          })()
            ? Date.now() + 20 * 60_000
            : bounds.start,
      });
      if (free != null) built.request.visitAtMs = free;
    }
  } catch {
    /* soft */
  }
  if (wish.lat != null && wish.lng != null) {
    built.request.anchor = { lat: wish.lat, lng: wish.lng };
  }
  built.request.title = wish.title;
  built.request.context = wish.context;
  try {
    const { looksLikeLandmarkPitchText } = require('../planning/planWalkOrder') as {
      looksLikeLandmarkPitchText: (s: string) => boolean;
    };
    if (looksLikeLandmarkPitchText(wish.title) || looksLikeLandmarkPitchText(blob)) {
      built.request.kind = 'sight';
      built.request.searchMode = 'city_best';
    }
  } catch {
    /* soft */
  }
  return built;
}

function useFuturePlanDayKey(): string | null {
  try {
    const { useFuturePlanStore } = require('../timeline/futurePlanState') as {
      useFuturePlanStore: {
        getState: () => { plan: { dayKey: string } };
      };
    };
    return useFuturePlanStore.getState().plan.dayKey;
  } catch {
    return null;
  }
}
