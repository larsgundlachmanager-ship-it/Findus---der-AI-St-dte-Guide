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
import { enqueueSpeech } from '../speech/speechQueue';
import { humanizeBullets } from '../speech/draftToHumanSpeech';
import { buildPitchHotelBookingUrl } from './pitchBookingUrl';
import { runMissionStages } from '../mission/runMissionStages';
import {
  verifyMissionPass,
} from '../mission/verifyMissionPass';
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
  // Multi-Lane: parallele Worker-Recherchen vor Single-Kind-Pfaden
  if (req.multiLane && req.multiLane.lanes?.length) {
    const { runMultiLanePitch } = await import('./runMultiLanePitch');
    return runMultiLanePitch(req, req.multiLane);
  }
  try {
    const { detectMultiLanePlan } = require('../router/call1MultiLane') as {
      detectMultiLanePlan: (
        t: string,
      ) => import('../router/call1MultiLane').MultiLanePlan | null;
    };
    const plan = detectMultiLanePlan(`${req.title} ${req.context}`);
    if (plan && plan.lanes.length >= 1) {
      const { runMultiLanePitch } = await import('./runMultiLanePitch');
      return runMultiLanePitch(req, plan);
    }
  } catch {
    /* soft */
  }
  // Vier Recherche-Zustände: installed / ghost / requires_download / exempt
  try {
    const { promptDestinationCitySwitch } = await import(
      '../../services/cityPackOffer'
    );
    const gateText = `${req.title} ${req.context}`.trim();
    const switched = await promptDestinationCitySwitch({
      text: gateText,
      intent: req.kind === 'hotel' ? 'hotel' : 'research',
    });
    if (switched?.blocked) {
      const spokenText =
        switched.cityName
          ? `Lad dir bitte zuerst den Datensatz für ${switched.cityName} herunter — dann starte ich die Recherche.`
          : 'Lad dir bitte zuerst den Datensatz für diese Stadt herunter — dann starte ich die Recherche.';
      const blocked: PitchResult = {
        requestId: req.requestId,
        softFail: true,
        spokenText,
        summary: 'Pack-Download nötig',
        options: [],
        outOfBoxHint: null,
        uiLayout: req.uiLayout,
      };
      publishPitchResult(blocked, {
        stepKey: req.requestId,
        headline: pitchHeadlineFromContext({
          city: switched.cityName,
          userText: req.title,
          fallback: 'Datensatz',
        }),
        anchorTimeMs: req.visitAtMs,
        pitchKind: req.kind,
        pitchContext: gateText,
        openCalendar: false,
      });
      return blocked;
    }
    if (switched?.cityName) {
      req = {
        ...req,
        cityHint: switched.cityName,
        searchMode:
          switched.lane === 'ghost' ||
          switched.lane === 'installed' ||
          switched.lane === 'requires_download'
            ? 'city_best'
            : req.searchMode === 'here_now'
              ? 'city_best'
              : req.searchMode,
      };
    }
  } catch {
    /* soft — Suche läuft weiter */
  }
  // Kino: Programm-Research (Filme zuerst), nie nackte „Kino in der Nähe“-Venue-Suche
  if (req.kind === 'cinema') {
    const { runCinemaPitch } = await import('./runCinemaPitch');
    return runCinemaPitch(req);
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

  // P9: Open-now härten (here_now) — geschlossene raus außer alle zu
  try {
    const { filterOpenNowHard } = require('./diningHarden') as {
      filterOpenNowHard: <T extends { openNow?: boolean | null; closedOnVisitDay?: boolean | null }>(
        list: T[],
        mode: string,
      ) => { kept: T[]; allClosed: boolean };
    };
    if (req.searchMode === 'here_now' || req.searchMode === 'open_now') {
      const filtered = filterOpenNowHard(ranked.top, req.searchMode);
      if (filtered.kept.length && filtered.kept.length < ranked.top.length) {
        ranked = {
          ...ranked,
          top: filtered.kept as typeof ranked.top,
          shortlist: filterOpenNowHard(ranked.shortlist, req.searchMode)
            .kept as typeof ranked.shortlist,
          reason: filtered.allClosed
            ? ranked.reason
            : ranked.reason || 'Nur geöffnete Treffer jetzt.',
        };
      }
    }
  } catch {
    /* soft */
  }

  // P9: Budget/Person — soft demote teure wenn Budget gesetzt
  try {
    const { parseBudgetPerPersonEur } = require('./diningHarden') as {
      parseBudgetPerPersonEur: (s: string) => number | null;
    };
    const budget = parseBudgetPerPersonEur(`${req.title} ${req.context}`);
    if (budget != null && ranked.top.length) {
      const under = ranked.top.filter(
        (c) =>
          c.priceTotalEur == null ||
          !(c.priceTotalEur > 0) ||
          c.priceTotalEur <= budget * 1.15,
      );
      if (under.length) {
        ranked = { ...ranked, top: under, shortlist: under };
      } else {
        ranked = {
          ...ranked,
          softFail: true,
          reason:
            ranked.reason ||
            `Nichts klar unter ca. ${budget} €/Person — hier die nächsten Optionen.`,
        };
        try {
          const { broadenDiningPitchRequest } = require('./searchBrief') as {
            broadenDiningPitchRequest: (r: typeof req) => typeof req;
          };
          const wider = broadenDiningPitchRequest({
            ...req,
            liveExpandRadiusM: Math.max(req.liveExpandRadiusM ?? 8000, 18_000),
          });
          const retry = await rankDiningPool(wider);
          if (retry.ranked.top.length) {
            req = wider;
            ranked = retry.ranked;
            pool = retry.pool;
          }
        } catch {
          /* soft */
        }
      }
    }
  } catch {
    /* soft */
  }

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
          { skipClosingGate: true, skipDestVerify: false, insertStop: true },
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

  // Empty→Retry / Harvest / Expand — Mission Stage-Runner (alle Find-Kinds)
  let harvestNearMisses: typeof pool = [];
  {
    const staged = await runMissionStages({
      req,
      ranked,
      pool,
      rank: rankDiningPool,
    });
    req = staged.req;
    ranked = staged.ranked;
    pool = staged.pool;
    harvestNearMisses = staged.harvestNearMisses;
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
  // Belt: AYCE never publish non-evidence venues (Goldschaetzchen Soft-Fill)
  try {
    const { looksLikeAyceQuery } = require('./ayceIntent') as {
      looksLikeAyceQuery: (t: string) => boolean;
    };
    const { scoreAyceEvidence } = require('./hardMatchVerify') as {
      scoreAyceEvidence: (b: string) => number;
    };
    const q = `${req.title} ${req.context}`;
    const checklistAyce = (ranked.criteriaChecklist ?? []).some((s) =>
      /all_you_can_eat|ayce|must_ayce|schlemmer|buffet/i.test(
        `${s.key} ${s.label}`,
      ),
    );
    const ayceTurn =
      looksLikeAyceQuery(q) ||
      checklistAyce ||
      req.wishes.some((w) =>
        /all_you_can_eat|ayce|must_ayce|schlemmer|buffet|rodiz/i.test(w.text),
      );
    if (ayceTurn) {
      const { looksLikeAsianCuisineVenue, prefsAvoidAsianCuisine } =
        require('./specializedFoodMatch') as {
          looksLikeAsianCuisineVenue: (b: string) => boolean;
          prefsAvoidAsianCuisine: (a: string[] | null | undefined) => boolean;
        };
      const avoidAsia = prefsAvoidAsianCuisine(req.prefs.avoidCategories);
      const ok = shortlist.filter((c) => {
        const blob = `${c.name} ${(c.softTags ?? []).join(' ')} ${(c.hardEvidence ?? []).join(' ')} ${(c.hookNotes ?? []).join(' ')}`;
        if (scoreAyceEvidence(blob) < 2) return false;
        if (avoidAsia && looksLikeAsianCuisineVenue(blob)) return false;
        return true;
      });
      if (ok.length !== shortlist.length || !ok.length) {
        shortlist = ok;
        if (!ok.length) {
          ranked = {
            ...ranked,
            top: [],
            shortlist: [],
            softFail: true,
            reason:
              ranked.reason ||
              'Kein belegtes All-you-can-eat — Expand/Web weiter, kein Soft-Fill.',
          };
        } else {
          ranked = { ...ranked, top: ok.slice(0, 2), shortlist: ok };
        }
      }
    }
  } catch {
    /* soft */
  }

  // Phase 4: Mission Verify-Pass — Musts belegt, Soft-Fill weg, whyChosen
  let whyByName: Record<string, { id: string; label: string; evidence: string }[]> =
    {};
  try {
    const verified = verifyMissionPass({
      req,
      candidates: shortlist,
      priorSoftFail: ranked.softFail,
    });
    whyByName = verified.whyByName;
    if (verified.survivors.length !== shortlist.length || verified.softFail) {
      shortlist = verified.survivors;
      ranked = {
        ...ranked,
        top: verified.survivors.slice(0, 2),
        shortlist: verified.survivors,
        softFail: verified.softFail || ranked.softFail,
        reason: verified.reason || ranked.reason,
      };
    } else {
      shortlist = verified.survivors;
    }
  } catch {
    /* soft — Hard-Match bleibt */
  }

  // Reisebegleiter: Hard-Publish-Gate — AYCE / kein Asiatisch / Open-Air nie Soft-Fill
  try {
    const { gatePitchCandidatesForPublish } = require('./pitchHardPublishGate') as {
      gatePitchCandidatesForPublish: (
        r: typeof req,
        c: typeof shortlist,
      ) => { kept: typeof shortlist; reason: string | null };
    };
    const gated = gatePitchCandidatesForPublish(req, shortlist);
    if (gated.kept.length !== shortlist.length) {
      shortlist = gated.kept;
      ranked = {
        ...ranked,
        top: gated.kept.slice(0, 2),
        shortlist: gated.kept,
        softFail: ranked.softFail || !gated.kept.length,
        reason:
          gated.reason === 'ayce_hard_gate'
            ? 'Kein belegtes All-you-can-eat — weiter live suchen.'
            : gated.reason === 'avoid_asian_gate'
              ? 'Asiatisch ausgeschlossen — andere Küchen live suchen.'
              : gated.reason === 'open_air_hard_gate'
                ? 'Kein Open-Air-Beleg — Indoor verworfen, weiter suchen.'
                : ranked.reason,
      };
    }
  } catch {
    /* soft */
  }

  const top = shortlist.slice(0, 2);

  if (req.kind === 'hotel' && top.length === 0) {
    const cityRaw = (req.cityHint || '').trim();
    const cityOk =
      cityRaw.length >= 2 &&
      !/^hier$/i.test(cityRaw) &&
      !/^in der nähe$/i.test(cityRaw);
    const city = cityOk ? cityRaw : '';
    const mustLabels = req.wishes
      .filter((w) => w.hardness === 'must' && (w.kind === 'amenity' || w.kind === 'vibe'))
      .map((w) => w.text)
      .join(', ');
    // Honesty first: ohne verifizierte Stadt kein Fake-Hotel-Pitch mit Expedia-Karte
    if (!cityOk || (req.forbidSoftFill && mustLabels)) {
      const spokenText = mustLabels
        ? `Dazu finde ich gerade kein Hotel, bei dem ${mustLabels} belegt ist. Sag Stadt oder Zeitraum klarer — oder lockere den Filter.`
        : cityOk
          ? `In ${city} gerade kein passendes Hotel mit den Musts. Sag Zeitraum oder lockere den Filter — dann such ich weiter.`
          : 'Für die Hotelsuche brauche ich noch die Stadt (oder einen klaren Ort). Dann prüfe ich Preise und Amenities live.';
      const result: PitchResult = {
        requestId: req.requestId,
        softFail: true,
        spokenText,
        summary: mustLabels ? 'Kein Hard-Match' : 'Hotel: Stadt/Musts fehlen',
        options: [],
        outOfBoxHint: null,
        uiLayout: req.uiLayout,
      };
      publishPitchResult(result, {
        stepKey: req.requestId,
        headline: pitchHeadlineFromContext({
          city: req.cityHint,
          userText: req.title,
          fallback: 'Hotels',
        }),
        anchorTimeMs: req.visitAtMs,
        pitchKind: req.kind,
        pitchContext: `${req.title} ${req.context}`.trim(),
        openCalendar: false,
      });
      return result;
    }
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
      // Suche-Link nur mit Stadt + idealerweise Daten (verifiziert)
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
              label: '🏨 Hotels suchen',
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
    // Soft-Fail-Karte = Such-Hilfe, kein verifiziertes Hotel
    const options: PitchOptionCard[] = primaryUrl
      ? [
          {
            id: `pitch_${req.requestId}_stay`,
            name: `Hotels in ${city} (Suche)`,
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
            whyChosen: ['Stadt verifiziert', 'kein belegtes Einzel-Hotel'],
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
    whyByName,
    signal: req.signal,
  });

  const options: PitchOptionCard[] = pitched.cards.map((card, i) => {
    const c = card.candidate;
    const role = roleFor(i, ranked.softFail);
    const mapsUrl = c.mapsUrl;
    const websiteUrl = c.websiteUrl ?? null;
    const need = req.orderNeed;
    // Gastro: Website als Speisekarte-Seed nur wenn Order.need.menuUrl (Default: ja bei food)
    const wantMenu =
      need?.menuUrl === true ||
      (need?.menuUrl !== false && (req.kind === 'food' || req.kind === 'bar'));
    const wantMaps = need?.maps !== false;
    const wantPrices =
      need?.prices === true ||
      (need?.prices !== false && (req.kind === 'food' || req.kind === 'bar'));
    const namedVenue = namedVenueFromWishes(req.wishes);
    const menuFromCandidate =
      wantMenu && (c.menuUrl || '').trim().startsWith('http')
        ? String(c.menuUrl).trim()
        : null;
    const menuSeed =
      menuFromCandidate ||
      (wantMenu && (req.kind === 'food' || req.kind === 'bar') && websiteUrl
        ? websiteUrl
        : null);
    const bookingUrl =
      req.kind === 'hotel'
        ? c.bookingUrl ??
          buildPitchHotelBookingUrl(
            c.name,
            `${req.title} ${req.context}`,
            req.cityHint,
          )
        : null;
    let amenityPlace = false;
    try {
      const { isAmenitySinglePlacePitch } = require('./pitchAmenityUi') as {
        isAmenitySinglePlacePitch: (o: Record<string, unknown>) => boolean;
      };
      amenityPlace = isAmenitySinglePlacePitch({
        kind: req.kind,
        text: `${req.title} ${req.context}`,
        mustHaves: req.call1MustHaves,
        wishes: req.wishes,
      });
    } catch {
      amenityPlace = false;
    }
    const suppressNav =
      amenityPlace ? false : !namedVenue;
    const actions = buildPitchActions({
      kind: req.kind,
      name: c.name,
      lat: c.lat,
      lng: c.lng,
      mapsUrl: wantMaps ? mapsUrl : '',
      menuUrl: menuSeed,
      bookingUrl: need?.bookingLink === false ? null : bookingUrl,
      websiteUrl,
      role: role === 'out_of_box' ? 'alternative' : role,
      suppressNav:
        (suppressNav && !amenityPlace) || req.orderUi?.startNav === false,
    });
    const evidenceBullets = (c.hardEvidence ?? []).slice(0, 2);
    const whyLines = (whyByName[c.name] ?? []).map((w) => w.evidence);
    const priceBullet =
      wantPrices &&
      (c.dishPriceHint ||
        (c.priceTotalEur != null
          ? `${Math.round(c.priceTotalEur)} € live`
          : null));
    const bulletMax = req.bulletBudget?.max ?? 3;
    let bullets = [
      ...(priceBullet ? [priceBullet] : []),
      ...whyLines.slice(0, 2),
      ...evidenceBullets,
      ...card.bullets,
    ]
      .filter((b, idx, arr) => arr.indexOf(b) === idx)
      .slice(0, bulletMax);
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
    // Gold/Contract-Meta nie in PitchOptionCard (Spickzettel/Choice-Slot)
    bullets = humanizeBullets(bullets, 3);
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
      showNavBeforeSelect: Boolean(namedVenue) || amenityPlace,
      allowCoordsMaps: amenityPlace,
      whyChosen: whyLines.slice(0, 5),
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
  // Phase 7: auch softFail — recherchierte Hits trotzdem schreiben
  if (options.length) {
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
              category:
                req.kind === 'hotel'
                  ? 'hotel'
                  : req.kind === 'cinema'
                    ? 'cinema'
                    : req.kind === 'sight'
                      ? 'sight'
                      : 'restaurant',
              cityId: (() => {
                try {
                  const {
                    ghostCityIdFromName,
                  } = require('../../services/cityResearchLane') as {
                    ghostCityIdFromName: (n: string) => string;
                  };
                  const hint = (req.cityHint || '').trim();
                  return hint ? ghostCityIdFromName(hint) : null;
                } catch {
                  return req.cityHint ?? null;
                }
              })(),
              cityName: (req.cityHint || '').trim() || null,
              facts: (o.bullets ?? []).slice(0, 3).map((t) => ({
                text: t,
                sourceUrl: o.websiteUrl ?? o.menuUrl ?? null,
                confidence: 'medium' as const,
              })),
              promptBlock: '',
            },
            {
              skipWiki: true,
              tags: [
                ...(req.wishes?.map((w) => w.text).filter(Boolean).slice(0, 6) ??
                  []),
                ...(req.call1MustHaves ?? []).slice(0, 4),
                ...(req.multiLane?.hardOutdoorOnly ? ['open_air'] : []),
                'pitch_verified',
              ],
              userText: `${req.title}`,
            },
          );
        }
      } catch {
        /* soft */
      }
    })();
  }

  // Phase 8: Amenity single-place nie Timeline; Calendar nur bei echtem Tour/Plan
  let wantCalendar =
    req.orderUi?.openCalendar === true || req.orderUi?.openTimeline === true;
  let uiLayout: typeof req.uiLayout = req.uiLayout;
  try {
    const { resolvePitchUiLayout, isAmenitySinglePlacePitch } = require('./pitchAmenityUi') as {
      resolvePitchUiLayout: (o: Record<string, unknown>) => 'live_split' | 'timeline_stack';
      isAmenitySinglePlacePitch: (o: Record<string, unknown>) => boolean;
    };
    const amenity = isAmenitySinglePlacePitch({
      kind: req.kind,
      text: `${req.title} ${req.context}`,
      mustHaves: req.call1MustHaves,
      wishes: req.wishes,
    });
    if (amenity) wantCalendar = false;
    uiLayout = resolvePitchUiLayout({
      kind: req.kind,
      text: `${req.title} ${req.context}`,
      mustHaves: req.call1MustHaves,
      wishes: req.wishes,
      requested: req.uiLayout,
      orderOpenCalendar: wantCalendar,
      orderOpenTimeline: false,
    });
  } catch {
    uiLayout = wantCalendar
      ? 'timeline_stack'
      : req.kind === 'food' || req.kind === 'bar'
        ? 'live_split'
        : req.uiLayout;
  }
  const result: PitchResult = {
    requestId: req.requestId,
    softFail: ranked.softFail,
    spokenText,
    summary: pitched.summary,
    options,
    outOfBoxHint,
    uiLayout,
  };

  const publish = () =>
    publishPitchResult(result, {
      stepKey: req.requestId,
      headline: pitchHeadlineFromContext({ city: req.cityHint, userText: req.title, fallback: 'Zwei Optionen' }),
      anchorTimeMs: req.visitAtMs,
      pitchKind: req.kind,
      pitchContext: `${req.title} ${req.context}`.trim(),
      openCalendar: wantCalendar,
    });
  const delayMs = req.orderUi?.delayMs;
  if (typeof delayMs === 'number' && delayMs > 0) {
    setTimeout(publish, Math.min(15_000, delayMs));
  } else {
    publish();
  }

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
