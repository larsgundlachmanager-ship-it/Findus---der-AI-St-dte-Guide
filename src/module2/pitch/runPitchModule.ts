/**
 * Auswahl-Pitch Orchestrierung — keine Bridge, Parent liefert Brief.
 */

import { collectCandidates } from './candidatePool';
import { filterAndRank, filterAndRankPool } from './wishFilterRank';
import { verifyHardMatches } from './hardMatchVerify';
import { isGroceryOrMarketCounterVenue, isParkingOrForestLotVenue } from './nonFoodVenueGate';
import { mixLiveResearchSeed } from './liveFoodResearch';
import { generatePitchSpeech } from './pitchSpeech';
import { buildPitchActions } from './pitchActions';
import {
  startPitchDeepAppend,
  type PitchSession,
} from './pitchDeepAppend';
import { publishPitchResult, useLivePitchStore } from './publishPitchUi';
import { pitchHeadlineFromContext } from './pitchHeadline';
import { namedVenueFromWishes } from './namedVenueIntent';
import { broadenDiningPitchRequest } from './searchBrief';
import { enqueueSpeech } from '../speech/speechQueue';
import { buildPitchHotelBookingUrl } from './pitchBookingUrl';
import type {
  PitchDeepAppend,
  PitchOptionCard,
  PitchRequest,
  PitchResult,
} from './types';

function roleFor(
  i: number,
  softFail: boolean,
): PitchOptionCard['role'] {
  if (i === 0) return 'favorite';
  return softFail ? 'alternative' : 'alternative';
}

export async function runPitchModule(
  reqIn: PitchRequest,
): Promise<PitchResult> {
  let req = reqIn;
  // Kino: Programm-Research (Filme zuerst), nie nackte „Kino in der Nähe“-Venue-Suche
  if (req.kind === 'cinema') {
    const { runCinemaPitch } = await import('./runCinemaPitch');
    return runCinemaPitch(req);
  }
  if (req.kind === 'hotel') {
    try {
      const { promptDestinationCitySwitch } = await import(
        '../../services/cityPackOffer'
      );
      const switched = await promptDestinationCitySwitch({
        text: `${req.title} ${req.context}`,
        intent: 'hotel',
      });
      if (switched?.cityName) {
        req = {
          ...req,
          cityHint: switched.cityName,
          searchMode: 'city_best',
        };
      }
    } catch {
      /* soft — Suche läuft in der genannten Stadt weiter */
    }
  }
  async function rankDiningPool(activeReq: PitchRequest) {
    const pool = await collectCandidates(activeReq);
    const pre = filterAndRankPool(activeReq, pool, 8);
    const seed = mixLiveResearchSeed(activeReq, pool, pre.top, 12);
    const verified = await verifyHardMatches({
      req: activeReq,
      candidates: seed,
    });
    let ranked = {
      top: verified.top,
      shortlist: verified.shortlist ?? verified.top,
      softFail: verified.softFail,
      outOfBox: pre.outOfBox,
      reason: verified.reason ?? pre.reason,
    };
    if (
      !ranked.top.length &&
      !activeReq.wishes.some(
        (w) => w.hardness === 'must' && w.kind !== 'generic',
      )
    ) {
      ranked = filterAndRank(activeReq, pool);
    }
    const hasMustFoodFilter = activeReq.wishes.some(
      (w) =>
        w.hardness === 'must' &&
        (w.kind === 'dish' || w.kind === 'cuisine' || w.kind === 'amenity'),
    );
    if (
      !ranked.top.length &&
      (activeReq.kind === 'food' || activeReq.kind === 'bar') &&
      pool.length
    ) {
      ranked = filterAndRank(activeReq, pool);
    }
    // Must-Gericht/Küche: nie „Top-Rating egal was“ (Steak ≠ Döner)
    if (
      !ranked.top.length &&
      (activeReq.kind === 'food' || activeReq.kind === 'bar') &&
      !hasMustFoodFilter
    ) {
      const live = pool
        .filter(
          (c) =>
            !isParkingOrForestLotVenue(c.name, (c.softTags ?? []).join(' ')),
        )
        .sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0))
        .slice(0, activeReq.shortlistSize ?? 5);
      if (live.length) {
        ranked = {
          top: live,
          shortlist: live,
          softFail: true,
          outOfBox: null,
          reason:
            live.every(
              (c) => c.openNow === false || c.closedOnVisitDay === true,
            )
              ? 'Alle Treffer gerade zu — Optionen für morgen.'
              : 'Wunsch nicht hart belegt — ehrliche Alternativen aus der Live-Suche.',
        };
      }
    }
    return { ranked, pool };
  }

  let { ranked, pool } = await rankDiningPool(req);
  // Empty→Retry (wie named schedule): Vibe lockern, Query/Stadt breiter, Cuisine behalten
  if (
    !ranked.top.length &&
    (req.kind === 'food' || req.kind === 'bar')
  ) {
    try {
      const retryReq = broadenDiningPitchRequest(req);
      const second = await rankDiningPool(retryReq);
      if (second.ranked.top.length) {
        ranked = {
          ...second.ranked,
          softFail: true,
          reason:
            second.ranked.reason ||
            'Zweite Suche (breitere Query) — Cuisine/Zeit behalten.',
        };
        pool = second.pool;
        req = retryReq;
      } else if (second.pool.length > pool.length) {
        pool = second.pool;
        ranked = second.ranked;
        req = retryReq;
      }
    } catch {
      /* soft — erstes Result behalten */
    }
  }
  // Shortlist (bis 5) → Kriterien-Score → Speak Top-2
  let shortlist = (ranked.shortlist ?? ranked.top).slice(
    0,
    req.shortlistSize ?? 5,
  );
  try {
    const { scoreCandidateCriteria } = require('../reboot/pipeline/researchPack') as {
      scoreCandidateCriteria: (
        c: (typeof shortlist)[0],
        wishes: typeof req.wishes,
        userText: string,
        visitAtMs: number,
      ) => { metCount: number; total: number };
    };
    const blob = `${req.title} ${req.context}`;
    shortlist = [...shortlist].sort((a, b) => {
      const sa = scoreCandidateCriteria(a, req.wishes, blob, req.visitAtMs);
      const sb = scoreCandidateCriteria(b, req.wishes, blob, req.visitAtMs);
      if (sb.metCount !== sa.metCount) return sb.metCount - sa.metCount;
      return (b.rating ?? 0) - (a.rating ?? 0);
    });
  } catch {
    /* soft */
  }
  const top = shortlist.slice(0, 2);

  if (req.kind === 'hotel' && top.length === 0) {
    const city = (req.cityHint || '').trim() || 'hier';
    const mustLabels = req.wishes
      .filter((w) => w.hardness === 'must' && (w.kind === 'amenity' || w.kind === 'vibe'))
      .map((w) => w.text)
      .join(', ');
    let url = '';
    let expediaUrl = '';
    let dates: { checkin?: string; checkout?: string } | undefined;
    let adults: number | undefined;
    try {
      const {
        getStay22AccommodationUrl,
        getExpediaAccommodationUrl,
      } = require('../../services/affiliate/affiliateService') as {
        getStay22AccommodationUrl: (
          dest: string,
          o?: { checkin?: string; checkout?: string },
        ) => string;
        getExpediaAccommodationUrl: (
          dest: string,
          o?: { checkin?: string; checkout?: string; adults?: number },
        ) => string;
      };
      const { parseHotelStayDates, parseHotelAdults } = require('../../services/concierge/hotelAvailabilityService') as {
        parseHotelStayDates: (t: string) => { checkin: string; checkout: string };
        parseHotelAdults: (t: string) => number;
      };
      dates = parseHotelStayDates(`${req.title} ${req.context}`);
      adults = parseHotelAdults(`${req.title} ${req.context}`);
      url = getStay22AccommodationUrl(city, dates) || '';
      expediaUrl =
        getExpediaAccommodationUrl(city, {
          checkin: dates.checkin,
          checkout: dates.checkout,
          adults,
        }) || '';
    } catch {
      /* Stay22/Expedia optional */
    }
    const primaryUrl = expediaUrl || url;
    const dateBit =
      dates?.checkin && dates?.checkout
        ? ` vom ${dates.checkin} bis ${dates.checkout}`
        : '';
    const spokenText = mustLabels
      ? `Für ${city} finde ich gerade kein Hotel, bei dem ${mustLabels} belegt ist. Oben ist die Partnersuche mit Tracking — Live-Preise siehst du dort.`
      : `Hotels in ${city}${dateBit} — oben ist die Partnersuche mit Tracking, Live-Preise siehst du direkt dort.`;
    const actions = [
      ...(primaryUrl
        ? [
            {
              type: 'OPEN_URL' as const,
              label: expediaUrl ? `🏨 Hotels in ${city}` : '🏨 Stay22 öffnen',
              payload: {
                url: primaryUrl,
                destName: city,
                destination: city,
                checkin: dates?.checkin,
                checkout: dates?.checkout,
                adults,
              },
            },
          ]
        : []),
      ...(url && expediaUrl
        ? [
            {
              type: 'OPEN_URL' as const,
              label: '🏨 Mehr bei Stay22',
              payload: {
                url,
                destName: city,
                destination: city,
                checkin: dates?.checkin,
                checkout: dates?.checkout,
                adults,
              },
            },
          ]
        : []),
    ];
    const options: PitchOptionCard[] = primaryUrl
      ? [
          {
            id: `pitch_${req.requestId}_stay`,
            name: `Hotels in ${city}`,
            lat: req.anchor.lat,
            lng: req.anchor.lng,
            role: 'favorite',
            speechPitch: spokenText,
            bullets: mustLabels
              ? ['Kein Voll-Match', mustLabels, city]
              : [
                  city,
                  dates?.checkin && dates?.checkout
                    ? `${dates.checkin} – ${dates.checkout}`
                    : 'Zeitraum in der Suche',
                  'Partner-Suche mit Tracking',
                ],
            mapsUrl: primaryUrl,
            bookingUrl: primaryUrl,
            actions,
          },
        ]
      : [];
    const result: PitchResult = {
      requestId: req.requestId,
      softFail: true,
      spokenText,
      summary: mustLabels ? 'Kein Hard-Match' : `Hotels in ${city}`,
      options,
      outOfBoxHint: null,
      uiLayout: req.uiLayout,
    };
    publishPitchResult(result, {
      stepKey: req.requestId,
      headline: pitchHeadlineFromContext({ city: req.cityHint, userText: req.title, fallback: 'Hotels' }),
      anchorTimeMs: req.visitAtMs,
      pitchKind: req.kind,
      pitchContext: `${req.title} ${req.context}`.trim(),
    });
    return result;
  }

  if (top.length === 0) {
    const mustLabels = req.wishes
      .filter((w) => w.hardness === 'must' && w.kind !== 'generic')
      .map((w) => w.text)
      .join(', ');
    const spokenText =
      ranked.reason ||
      (mustLabels
        ? `Zu „${mustLabels}“ habe ich in dem Umkreis gerade keinen Treffer. Sag eine Stadt oder Richtung — dann such ich weiter.`
        : 'In dem Umkreis gerade keine Treffer. Sag eine Stadt oder Richtung, dann such ich weiter.');
    const result: PitchResult = {
      requestId: req.requestId,
      softFail: true,
      spokenText,
      summary: mustLabels ? `Kein Treffer: ${mustLabels}` : 'Kein Hard-Match',
      options: [],
      outOfBoxHint: null,
      uiLayout: req.uiLayout,
    };
    publishPitchResult(result, {
      stepKey: req.requestId,
      headline:
        mustLabels
          ? `Kein Treffer: ${mustLabels}`
          : pitchHeadlineFromContext({
              city: req.cityHint,
              userText: req.title,
              fallback: 'Auswahl',
            }),
      anchorTimeMs: req.visitAtMs,
      pitchKind: req.kind,
      pitchContext: `${req.title} ${req.context}`.trim(),
    });
    return result;
  }
  // Insider aus Places/Website-Summary — nur für die 2 Finalisten
  try {
    const { fetchPlacePitchDetails } = await import(
      '../../services/navigation/placePitchDetails'
    );
    await Promise.all(
      top.map(async (c) => {
        try {
          if (c.hookNotes?.length) return;
          const details = await fetchPlacePitchDetails({
            query: c.name,
            lat: c.lat,
            lng: c.lng,
            placeId: c.placeId ?? undefined,
            signal: req.signal,
            includeAtmosphere: true,
          });
          if (!details) return;
          const hooks = [
            details.editorialSummary,
            details.generativeSummary,
            ...(details.reviews ?? []).slice(0, 3).map((r) => r.text),
          ]
            .map((x) => String(x ?? '').replace(/\s+/g, ' ').trim())
            .filter((x) => x.length >= 24)
            .map((x) => (x.length > 220 ? `${x.slice(0, 217)}…` : x))
            .slice(0, 3);
          if (hooks.length) c.hookNotes = hooks;
          if (!c.websiteUrl && details.websiteUri) {
            c.websiteUrl = details.websiteUri;
          }
        } catch {
          /* soft */
        }
      }),
    );
  } catch {
    /* soft */
  }
  void (async () => {
    try {
      const { persistLivePitchResearch } = await import(
        '../../services/research/persistLiveResearch'
      );
      // Shortlist (Places/OSM) → Pack; Pack-Hits werden übersprungen
      await persistLivePitchResearch(req, shortlist.length ? shortlist : top);
    } catch {
      /* soft — Pitch nicht blockieren */
    }
  })();
  try {
    const {
      fetchRouteDirectionsResult,
      walkingDistanceFromSteps,
    } = await import('../../services/navigation/googleMapsNav');
    await Promise.all(
      top.map(async (c) => {
        try {
          const r = await fetchRouteDirectionsResult(
            req.anchor,
            { lat: c.lat, lng: c.lng },
            'walking',
          );
          if (!r?.steps?.length) return;
          const m = walkingDistanceFromSteps(r.steps);
          if (Number.isFinite(m) && m > 40) c.distFromAnchorM = Math.round(m);
        } catch {
          /* Luftlinie bleibt */
        }
      }),
    );
  } catch {
    /* soft */
  }
  const pitched = await generatePitchSpeech({
    req,
    top,
    shortlist,
    softFail: ranked.softFail,
    softFailReason: ranked.reason,
    signal: req.signal,
  });

  const options: PitchOptionCard[] = pitched.cards.map((card, i) => {
    const c = card.candidate;
    const role = roleFor(i, ranked.softFail);
    const mapsUrl = c.mapsUrl;
    const websiteUrl = c.websiteUrl ?? null;
    // Nur echte Menü-URLs als Seed — Homepage erst nach Deep-Harvest
    const namedVenue = namedVenueFromWishes(req.wishes);
    const menuSeed =
      (req.kind === 'food' || req.kind === 'bar') &&
      websiteUrl &&
      (() => {
        if (namedVenue) return true;
        try {
          const { isMenuAssetUrl } = require('../planning/offerActionUtils') as {
            isMenuAssetUrl: (u: string) => boolean;
          };
          return isMenuAssetUrl(websiteUrl);
        } catch {
          return /speisekarte|speisen|\/ugd\/|\.pdf/i.test(websiteUrl);
        }
      })()
        ? websiteUrl
        : null;
    const bookingUrl =
      req.kind === 'hotel'
        ? c.bookingUrl ??
          buildPitchHotelBookingUrl(
            c.name,
            `${req.title} ${req.context}`,
            req.cityHint,
          )
        : null;
    const suppressNav = !namedVenue;
    const actions = buildPitchActions({
      kind: req.kind,
      name: c.name,
      lat: c.lat,
      lng: c.lng,
      mapsUrl,
      menuUrl: menuSeed,
      bookingUrl,
      websiteUrl,
      role: role === 'out_of_box' ? 'alternative' : role,
      suppressNav,
    });
    const evidenceBullets = (c.hardEvidence ?? []).slice(0, 2);
    const priceBullet =
      c.dishPriceHint ||
      (c.priceTotalEur != null
        ? `${Math.round(c.priceTotalEur)} € live`
        : null);
    const bullets = [
      ...(priceBullet ? [priceBullet] : []),
      ...evidenceBullets,
      ...card.bullets,
    ]
      .filter((b, idx, arr) => arr.indexOf(b) === idx)
      .slice(0, 3);
    return {
      id: `pitch_${req.requestId}_${i === 0 ? 'a' : 'b'}`,
      name: c.name,
      lat: c.lat,
      lng: c.lng,
      placeId: c.placeId,
      role,
      speechPitch: card.speechPitch,
      bullets,
      mapsUrl,
      rating: c.rating,
      websiteUrl,
      menuUrl: menuSeed,
      bookingUrl,
      actions,
      showNavBeforeSelect: Boolean(namedVenue),
    };
  });

  // Out-of-box als dritte Karte nur in Hint, nicht erzwingen
  let outOfBoxHint: string | null = null;
  if (ranked.outOfBox && ranked.softFail) {
    const oob = ranked.outOfBox;
    if (
      !isGroceryOrMarketCounterVenue(oob.name, oob.softTags ?? [])
    ) {
      outOfBoxHint = `Out-of-the-box: ${oob.name} — ungewöhnlich, aber eine Chance.`;
    }
  }

  const spokenText = [pitched.spokenText, outOfBoxHint]
    .filter(Boolean)
    .join(' ')
    .trim();

  const result: PitchResult = {
    requestId: req.requestId,
    softFail: ranked.softFail,
    spokenText,
    summary: pitched.summary,
    options,
    outOfBoxHint,
    uiLayout: req.uiLayout,
  };

  publishPitchResult(result, {
    stepKey: req.requestId,
    headline: pitchHeadlineFromContext({ city: req.cityHint, userText: req.title, fallback: 'Zwei Optionen' }),
    anchorTimeMs: req.visitAtMs,
    pitchKind: req.kind,
    pitchContext: `${req.title} ${req.context}`.trim(),
  });

  startPitchDeepAppend({
    req,
    options,
    onAppend: (append) => applyDeepAppend(append),
  });

  return result;
}

function applyDeepAppend(append: PitchDeepAppend): void {
  const live = useLivePitchStore.getState();
  const selected = live.selectedOptionId ?? append.optionId;

  if (append.spokenAppend) {
    // Planung / Timeline: keine Auto-Speech — nur UI patchen
    let planningQuiet = false;
    try {
      const { isPlanningModuleActive } = require('../planning/planSessionState') as {
        isPlanningModuleActive: () => boolean;
      };
      const { usePlanCalendarUiStore } = require('../timeline/planCalendarUiStore') as {
        usePlanCalendarUiStore: { getState: () => { calendarVisible: boolean } };
      };
      planningQuiet =
        isPlanningModuleActive() ||
        usePlanCalendarUiStore.getState().calendarVisible;
    } catch {
      planningQuiet = false;
    }
    const text =
      selected && append.optionId && selected !== append.optionId
        ? ''
        : append.spokenAppend;
    if (text && !planningQuiet) {
      void enqueueSpeech({
        kind: 'main',
        text,
        turnId: `pitch_deep_${append.requestId}`,
      });
    }
  }

  if (live.requestId === append.requestId) {
    for (const opt of live.options) {
      if (selected && opt.id !== selected) {
        // nach Tap andere Option nicht mehr patchen
        if (live.selectedOptionId) continue;
      }
      const bullets = append.bulletUpdates?.[opt.id];
      const actions = append.actionUpdates?.[opt.id];
      const menuUrl = append.menuUrls?.[opt.id];
      live.patchOption(opt.id, {
        ...(bullets ? { bullets } : null),
        ...(actions ? { actions } : null),
        ...(menuUrl !== undefined ? { menuUrl } : null),
      });
    }
  }

  // Timeline mirrored actions
  try {
    const { usePlanCalendarUiStore } = require('../timeline/planCalendarUiStore') as {
      usePlanCalendarUiStore: {
        getState: () => {
          pendingChoice: {
            options: Array<{
              id: string;
              bullets?: string[];
              menuUrl?: string | null;
            }>;
            stepKey: string;
            headline: string;
            anchorTimeMs: number | null;
            anchorTimeLabel: string | null;
          } | null;
          setMirroredActions: (a: unknown[]) => void;
          setPendingChoice: (c: unknown) => void;
        };
      };
    };
    const ui = usePlanCalendarUiStore.getState();
    const pending = ui.pendingChoice;
    if (pending) {
      const nextOpts = pending.options.map((o) => {
        const bullets = append.bulletUpdates?.[o.id];
        const menuUrl = append.menuUrls?.[o.id];
        return {
          ...o,
          ...(bullets ? { bullets, subtitle: bullets.join('\n') } : null),
          ...(menuUrl ? { menuUrl } : null),
        };
      });
      ui.setPendingChoice({ ...pending, options: nextOpts });
      const acts = Object.values(append.actionUpdates ?? {}).flat();
      if (acts.length) ui.setMirroredActions(acts.slice(0, 6));
    }
  } catch {
    /* soft */
  }
}

export type { PitchSession };
