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
import { broadenDiningPitchRequest, diningExpandRingsFor, withLiveExpandRadius } from './searchBrief';
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
      criteriaChecklist: verified.criteriaChecklist,
    };
    const hasMustFoodFilter = activeReq.wishes.some(
      (w) =>
        w.hardness === 'must' &&
        (w.kind === 'dish' || w.kind === 'cuisine' || w.kind === 'amenity'),
    );
    if (
      !ranked.top.length &&
      !activeReq.wishes.some(
        (w) => w.hardness === 'must' && w.kind !== 'generic',
      )
    ) {
      ranked = filterAndRank(activeReq, pool);
    }
    // Must-Gericht: nie Rating-Fallback ohne Beleg (Pannfisch ≠ beliebiges Fischlokal)
    if (
      !ranked.top.length &&
      (activeReq.kind === 'food' || activeReq.kind === 'bar') &&
      pool.length &&
      !hasMustFoodFilter
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

  // On-route: klarer Unique-Ort → Stopp einfügen, KEIN Top-2-Pitch vor Call-1
  if (
    (req.searchMode === 'on_route' || req.searchMode === 'between_stops') &&
    namedVenueFromWishes(req.wishes)
  ) {
    const named = namedVenueFromWishes(req.wishes)!;
    const hardHits = (ranked.top.length ? ranked.top : pool).filter((c) => {
      try {
        const { venueNameMatches } = require('./namedVenueIntent') as {
          venueNameMatches: (a: string, b: string) => boolean;
        };
        return venueNameMatches(c.name, named);
      } catch {
        return (c.name || '').toLowerCase().includes(named.toLowerCase().slice(0, 8));
      }
    });
    const unique =
      hardHits.length === 1 ||
      (hardHits.length > 1 &&
        hardHits.every((h) =>
          (h.name || '').toLowerCase().includes(named.toLowerCase().slice(0, 6)),
        ));
    const pick = hardHits[0];
    if (unique && pick && Number.isFinite(pick.lat) && Number.isFinite(pick.lng)) {
      let keepName = '';
      try {
        const { getActiveNavDestination } = require('../../services/navigation/navigationService') as {
          getActiveNavDestination: () => { name: string } | null;
        };
        keepName = String(getActiveNavDestination()?.name || '').trim();
      } catch {
        keepName = '';
      }
      try {
        const { interruptAndNavigateToDiscovery } = await import(
          '../../services/navigation/contextualDiscovery'
        );
        const ok = await interruptAndNavigateToDiscovery(
          { name: pick.name, lat: pick.lat, lng: pick.lng },
          { skipClosingGate: true, skipDestVerify: false },
        );
        if (ok) {
          const after = keepName
            ? `Zwischenstopp klar — ich führ dich zu ${pick.name}, danach weiter zu ${keepName}.`
            : `Zwischenstopp klar — ich führ dich zu ${pick.name}.`;
          if (!req.bridgeAlreadySpoken) {
            void enqueueSpeech({
              kind: 'main',
              text: after,
              turnId: `on_route_insert_${req.requestId}`,
            });
          }
          return {
            requestId: req.requestId,
            softFail: false,
            spokenText: after,
            summary: after,
            options: [],
            outOfBoxHint: null,
            uiLayout: req.uiLayout,
          };
        }
      } catch {
        /* soft — Top-2 Fallback */
      }
    }
  }

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

  // Two-Lane: Pack/Places Perfect ≥2 ohne Hard-soft_miss → kein Harvest (LightVerify reicht).
  // Gap: DiscoveryHarvest (Guides) vor Radius-Expand.
  let harvestNearMisses: typeof pool = [];
  try {
    const {
      shouldRunDiscoveryHarvest,
      discoveryHarvest,
      harvestClaimsToSeedCandidates,
    } = await import('./discoveryHarvest');
    const packPerfect =
      pool.filter((c) => c.source === 'pack' || c.source === 'soft_seed').length >=
        2 &&
      ranked.top.length >= 2 &&
      !ranked.softFail &&
      !(ranked.criteriaChecklist ?? []).some(
        (s) =>
          (s.status === 'soft_miss' || s.status === 'only_one') &&
          !/^(open_at_visit|rating_floor|budget)$/i.test(s.key),
      );
    if (
      !packPerfect &&
      shouldRunDiscoveryHarvest({
        kind: req.kind,
        topLen: ranked.top.length,
        softFail: ranked.softFail,
        checklist: ranked.criteriaChecklist,
      })
    ) {
      const harvested = await discoveryHarvest(req);
      harvestNearMisses = harvestClaimsToSeedCandidates(
        harvested.claims.filter((c) => c.constraintFit === 'near_miss'),
        {
          lat: req.anchor?.lat ?? ranked.top[0]?.lat ?? 0,
          lng: req.anchor?.lng ?? ranked.top[0]?.lng ?? 0,
        },
      );
      const perfectSeeds = harvestClaimsToSeedCandidates(
        harvested.claims.filter((c) => c.constraintFit !== 'near_miss'),
        {
          lat: req.anchor?.lat ?? ranked.top[0]?.lat ?? 53.55,
          lng: req.anchor?.lng ?? ranked.top[0]?.lng ?? 9.99,
        },
      );
      if (perfectSeeds.length || harvested.rawNames.length) {
        // Namen → Places Resolve über bestehenden Pool-Pfad (Query mit Top-Namen)
        const nameBoost = harvested.rawNames.slice(0, 6).join(' ');
        if (nameBoost) {
          const harvestReq: PitchRequest = {
            ...req,
            title: `${req.title} ${nameBoost}`.slice(0, 160),
            context: `${req.context} harvest:${nameBoost}`.slice(0, 400),
          };
          const next = await rankDiningPool(harvestReq);
          const better =
            next.ranked.top.length > ranked.top.length ||
            (next.ranked.top.length >= 2 && ranked.top.length < 2);
          if (better || next.pool.length > pool.length) {
            ranked = {
              ...next.ranked,
              softFail: next.ranked.softFail || ranked.softFail,
              reason:
                next.ranked.reason ||
                'Web-Guides/Harvest — Hard-Musts erneut geprüft.',
            };
            pool = next.pool;
            req = harvestReq;
          }
        }
      }
    }
  } catch {
    /* soft — Ring-Expand bleibt Fallback */
  }

  // Soft-Miss / <2 Perfect: nicht nur Datensatz — online Places ringweise bis Treffer
  if (
    (req.kind === 'food' || req.kind === 'bar') &&
    (ranked.softFail ||
      ranked.top.length < 2 ||
      (ranked.criteriaChecklist ?? []).some(
        (s) => s.status === 'soft_miss' || s.status === 'only_one',
      ))
  ) {
    const already = req.liveExpandRadiusM ?? 0;
    const rings = diningExpandRingsFor(req);
    for (const ring of rings) {
      if (ring <= already) continue;
      try {
        const expandReq = withLiveExpandRadius(
          broadenDiningPitchRequest(req),
          ring,
        );
        const next = await rankDiningPool(expandReq);
        const betterTop =
          next.ranked.top.length > ranked.top.length ||
          (next.ranked.top.length >= 2 && ranked.top.length < 2) ||
          (next.ranked.top.length >= 1 && !ranked.top.length);
        const fewerMisses =
          (next.ranked.criteriaChecklist ?? []).filter(
            (s) => s.status === 'soft_miss',
          ).length <
          (ranked.criteriaChecklist ?? []).filter((s) => s.status === 'soft_miss')
            .length;
        if (!(betterTop || fewerMisses || next.pool.length > pool.length)) {
          continue;
        }
        ranked = {
          ...next.ranked,
          // Expand-Radius nur Backend — nie „in 10 km nichts, in 20 km…“ in Speech
          softFail: next.ranked.softFail,
          reason: next.ranked.reason,
        };
        pool = next.pool;
        req = expandReq;
        const stillSoft = (next.ranked.criteriaChecklist ?? []).some(
          (s) =>
            (s.status === 'soft_miss' || s.status === 'only_one') &&
            !/^(open_at_visit|rating_floor|budget)$/i.test(s.key),
        );
        // Perfect genug → stop; sonst nächster Ring
        if (next.ranked.top.length >= 1 && !stillSoft) break;
        if (next.ranked.top.length >= 2) break;
      } catch {
        /* soft — nächsten Ring */
      }
    }
  }
  // Open-World: zweiter Web-Harvest wenn nach Expand noch Thin (until_evidence)
  if (
    (req.kind === 'food' || req.kind === 'bar') &&
    (ranked.softFail || ranked.top.length < 2)
  ) {
    try {
      const {
        shouldRunDiscoveryHarvest,
        discoveryHarvest,
        harvestClaimsToSeedCandidates,
      } = await import('./discoveryHarvest');
      if (
        shouldRunDiscoveryHarvest({
          kind: req.kind,
          topLen: ranked.top.length,
          softFail: true,
          checklist: ranked.criteriaChecklist,
        })
      ) {
        const harvested = await discoveryHarvest(req);
        const seeds = harvestClaimsToSeedCandidates(
          harvested.claims.filter((c) => c.constraintFit !== 'rejected'),
          {
            lat: req.anchor?.lat ?? 53.55,
            lng: req.anchor?.lng ?? 9.99,
          },
        );
        const nameBoost = [
          ...harvested.rawNames.slice(0, 6),
          ...seeds.map((c) => c.name).slice(0, 4),
        ]
          .filter(Boolean)
          .join(' ');
        if (nameBoost) {
          const harvestReq: PitchRequest = {
            ...req,
            title: `${req.title} ${nameBoost}`.slice(0, 160),
            context: `${req.context} harvest2:${nameBoost}`.slice(0, 400),
            liveExpandRadiusM: Math.max(req.liveExpandRadiusM ?? 0, 100_000),
          };
          const next = await rankDiningPool(harvestReq);
          if (
            next.ranked.top.length > ranked.top.length ||
            (next.ranked.top.length >= 1 && ranked.top.length === 0)
          ) {
            ranked = next.ranked;
            pool = next.pool;
            req = harvestReq;
          }
        }
      }
    } catch {
      /* soft */
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
      ? `Für ${city} finde ich gerade kein Hotel, bei dem ${mustLabels} belegt ist. Oben kannst du weiter suchen — Live-Preise siehst du dort.`
      : `Hotels in ${city}${dateBit} — oben kannst du weiter suchen und Live-Preise vergleichen.`;
    const actions = [
      ...(primaryUrl
        ? [
            {
              type: 'OPEN_URL' as const,
              label: expediaUrl ? `🏨 Hotels suchen` : '🏨 Hotels suchen',
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
              label: '🏨 Mehr Optionen',
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
                  'Live-Preise in der Suche',
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
      openCalendar: false,
    });
    return result;
  }

  if (top.length === 0) {
    const mustLabels = req.wishes
      .filter((w) => {
        if (w.hardness !== 'must' || w.kind === 'generic') return false;
        try {
          const {
            isAtmosphereVibeLabel,
          } = require('./searchBrief') as {
            isAtmosphereVibeLabel: (s: string) => boolean;
          };
          const {
            isStructuralCriterionKey,
            isNegativeCuisineCriterion,
          } = require('./call1Criteria') as {
            isStructuralCriterionKey: (s: string) => boolean;
            isNegativeCuisineCriterion: (s: string) => boolean;
          };
          if (w.kind === 'vibe' || isAtmosphereVibeLabel(w.text)) return false;
          if (
            isStructuralCriterionKey(w.text) ||
            isNegativeCuisineCriterion(w.text)
          ) {
            return false;
          }
        } catch {
          if (w.kind === 'vibe') return false;
        }
        return true;
      })
      .map((w) => w.text)
      .join(', ');
    const spokenText =
      ranked.reason ||
      (mustLabels
        ? `Dazu habe ich in dem Umkreis gerade keinen passenden Treffer. Sag eine andere Richtung oder lockere die Filter — dann such ich weiter.`
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
      headline: pitchHeadlineFromContext({
        city: req.cityHint,
        userText: req.title,
        fallback: 'Auswahl',
      }),
      anchorTimeMs: req.visitAtMs,
      pitchKind: req.kind,
      pitchContext: `${req.title} ${req.context}`.trim(),
      openCalendar: false,
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
      await persistLivePitchResearch(req, shortlist.length ? shortlist : top, {
        includeNearMisses: harvestNearMisses,
      });
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
    criteriaChecklist: (
      ranked as {
        criteriaChecklist?: Array<{
          key: string;
          label: string;
          status: string;
          remaining: number;
        }>;
      }
    ).criteriaChecklist,
    signal: req.signal,
  });

  const options: PitchOptionCard[] = pitched.cards.map((card, i) => {
    const c = card.candidate;
    const role = roleFor(i, ranked.softFail);
    const mapsUrl = c.mapsUrl;
    const websiteUrl = c.websiteUrl ?? null;
    // Gastro: Website immer als Speisekarte-Seed (Deep-Append ersetzt später)
    const namedVenue = namedVenueFromWishes(req.wishes);
    const menuSeed =
      (req.kind === 'food' || req.kind === 'bar') && websiteUrl
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
    let bullets = [
      ...(priceBullet ? [priceBullet] : []),
      ...evidenceBullets,
      ...card.bullets,
    ]
      .filter((b, idx, arr) => arr.indexOf(b) === idx)
      .slice(0, 3);
    try {
      const { filterWeakCategoryBullets } = require('./weakCategoryBullet') as {
        filterWeakCategoryBullets: (xs: string[]) => string[];
      };
      bullets = filterWeakCategoryBullets(bullets).slice(0, 3);
    } catch {
      /* soft */
    }
    let speechPitch = card.speechPitch;
    try {
      const { syncPriceEvidence } = require('./priceEvidenceSync') as {
        syncPriceEvidence: (o: {
          speech: string;
          bullets: string[];
          dishPriceHint?: string | null;
          allowPriceInBullets?: boolean;
        }) => { speech: string; bullets: string[] };
      };
      const synced = syncPriceEvidence({
        speech: speechPitch,
        bullets,
        dishPriceHint: c.dishPriceHint ?? priceBullet,
        allowPriceInBullets: true,
      });
      speechPitch = synced.speech;
      bullets = synced.bullets;
    } catch {
      /* soft */
    }
    return {
      id: `pitch_${req.requestId}_${i === 0 ? 'a' : 'b'}`,
      name: c.name,
      lat: c.lat,
      lng: c.lng,
      placeId: c.placeId,
      role,
      speechPitch,
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

  // Open-World learn stage: belegte Treffer lokal/Inbox (fire-and-forget)
  if (!ranked.softFail && options.length) {
    void (async () => {
      try {
        const { persistDiscoveredPoiIntoDataset } = await import(
          '../../services/research/persistDiscoveredPoi'
        );
        for (const o of options.slice(0, 2)) {
          if (!o.name || !Number.isFinite(o.lat) || !Number.isFinite(o.lng)) continue;
          await persistDiscoveredPoiIntoDataset(
            {
              name: o.name,
              lat: o.lat,
              lng: o.lng,
              category: req.kind === 'hotel' ? 'hotel' : 'restaurant',
              cityId: req.cityHint ?? null,
              facts: (o.bullets ?? []).slice(0, 3).map((t) => ({
                text: t,
                sourceUrl: o.websiteUrl ?? o.menuUrl ?? null,
                confidence: 'medium' as const,
              })),
              promptBlock: '',
            },
            {
              skipWiki: true,
              tags: req.wishes?.map((w) => w.text).filter(Boolean).slice(0, 6),
              userText: `${req.title}`,
            },
          );
        }
      } catch {
        /* soft */
      }
    })();
  }

  // Dining/AYCE: live_split default — Calendar nur bei uiRequirements.openCalendar
  const uiLayout =
    req.kind === 'food' || req.kind === 'bar'
      ? 'live_split'
      : req.uiLayout;
  const result: PitchResult = {
    requestId: req.requestId,
    softFail: ranked.softFail,
    spokenText,
    summary: pitched.summary,
    options,
    outOfBoxHint,
    uiLayout,
  };

  publishPitchResult(result, {
    stepKey: req.requestId,
    headline: pitchHeadlineFromContext({ city: req.cityHint, userText: req.title, fallback: 'Zwei Optionen' }),
    anchorTimeMs: req.visitAtMs,
    pitchKind: req.kind,
    pitchContext: `${req.title} ${req.context}`.trim(),
    openCalendar: false,
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
