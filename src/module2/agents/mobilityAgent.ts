import type { Module2Agent } from './types';
import { agentPromptLaws } from '../laws/lawLayers';
import {
  anchorCoords,
  isFallbackAnchor,
} from '../rucksack/rucksackStore';
import {
  geocodePlaceName,
  looksLikeOfficeOnlyPlace,
  searchPlacesByText,
  type DiscoveredPlace,
} from '../../services/navigation/googleMapsNav';
import {
  getShortTerm,
  resolveLocalAnchor,
  setLastPlaceName,
} from '../context/shortTermContext';
import { resolveWorkingPlace } from '../context/placeContext';
import {
  estimateTravelEtaRouted,
  formatBikeEtaSpeech,
  formatDistanceKmOrM,
  formatDurationMinutesDe,
  formatWalkBikeEtaSpeech,
  formatWalkEtaSpeech,
} from '../../services/navigation/travelEta';
import {
  detectTravelModeVoiceOverride,
  forceBikeModeFromVoice,
  setPreferredTravelMode,
} from '../../services/navigation/travelModeContext';
import { useFinnusStore } from '../../store/useFinnusStore';
import { useFuturePlanStore } from '../timeline/futurePlanState';
import { addPlanStop } from '../timeline/planLiveEdits';
import { insertTourStop } from '../../services/navigation/multiStopTour';
import { planJourney } from '../../services/transit/journeyPlanner';
import { journeyPlanTimeOpts } from '../../services/transit/journeyWhen';
import { formatJourneyForConcierge } from '../../services/transit/formatJourneyCard';
import { rememberJourneyForStart } from '../../services/navigation/journeyStartCache';
import {
  ACTION_LABEL_MAX_CHARS,
  compactPlaceForAction,
  shortenActionLabel,
  withMapsActionEmoji,
} from '../../services/concierge/actionLabelShorten';
import { haversineMeters } from '../../db/database';
import { isWeakNavDestLabel } from '../../services/navigation/streetAddressQuery';

/** Dest-Name zu schwach (Pronomen / Leer) — Kontext nutzen, nie User-GPS als Ziel. */
function isWeakDestName(name: string): boolean {
  return isWeakNavDestLabel(name);
}

function navButtonLabel(placeName: string, bike: boolean): string {
  const emojiBudget = bike ? 3 : 3; // 🚴 / 🗺️ + space
  const short = compactPlaceForAction(
    placeName,
    Math.max(8, ACTION_LABEL_MAX_CHARS - emojiBudget),
  );
  if (bike) return shortenActionLabel(`🚴 ${short}`);
  return shortenActionLabel(withMapsActionEmoji(short));
}

/** Explizites Navigieren → Sofort-Start, kein Route-Button nötig. */
function wantsExplicitNavStart(text: string): boolean {
  try {
    const { isExplicitNavIntent } = require('../../services/intent/poiInfoVsNav') as {
      isExplicitNavIntent: (t: string) => boolean;
    };
    return isExplicitNavIntent(text);
  } catch {
    return /\b(führ\s+mich|fuehr\s+mich|fahr\s+mich|navigier|navi(?:gation)?\s+(?:zu|nach|zum|zur)|bring\s+mich|start(?:e)?\s+(?:die\s+)?route)\b/i.test(
      text,
    );
  }
}

/** Reine Dauer-Frage — kein Auto-Start nur wegen kurzer ETA. */
function isPureEtaQuestion(text: string): boolean {
  const t = text.replace(/\s+/g, ' ').trim();
  if (wantsExplicitNavStart(t)) return false;
  if (/\b(los|route\s+starten|führ|fuehr|bring\s+mich|navigier)\b/i.test(t)) {
    return false;
  }
  return /\b(wie\s+(?:lange|weit|viel)|dauer|eta|minuten\s+(?:bis|nach)|wieviel\s+min)\b/i.test(
    t,
  );
}

/** Neue Route ≤ 10 Min → direkt berechnen & starten (Just-Do-It). */
function shouldAutoStartShortRoute(opts: {
  etaMin: number;
  text: string;
  offerTransit?: boolean;
  navLive?: boolean;
}): boolean {
  if (opts.offerTransit) return false;
  if (opts.navLive) return false;
  if (!Number.isFinite(opts.etaMin) || opts.etaMin > 10) return false;
  if (isPureEtaQuestion(opts.text)) return false;
  return true;
}

function wantsAppendToRoute(text: string): boolean {
  const t = text.toLowerCase();
  return (
    /hinzu(?:fügen|fuegen)?|mitnehmen|pack\s+.+\s+dazu|noch\s+mit\s+in|in\s+(?:mein(?:en?)?\s+)?(?:navi|plan|route|timeline)/i.test(
      t,
    ) ||
    /danach\s+(?:noch\s+)?(?:zum|zur|nach)|füge?\s+.+\s+hinzu|fuege?\s+.+\s+hinzu/i.test(
      t,
    )
  );
}

function wantsTransit(text: string): boolean {
  return /\b(öpnv|oepnv|bus|bahn|zug|s-?bahn|tram|verbindung|öffentlich|oeffentlich)\b/i.test(
    text,
  );
}

function wantsBike(text: string): boolean {
  return (
    detectTravelModeVoiceOverride(text) === 'bike' ||
    /\b(fahrrad|radeln|radele|mit\s+dem\s+rad|e-?bike|bike)\b/i.test(text)
  );
}

/** Rad und ÖPNV in einer Frage → Vergleich + Empfehlung. */
function wantsModeCompare(text: string): boolean {
  return wantsBike(text) && wantsTransit(text);
}

function clockDe(d: Date): string {
  return `${d.getHours().toString().padStart(2, '0')}:${d
    .getMinutes()
    .toString()
    .padStart(2, '0')}`;
}

function wantsEtaOnly(text: string): boolean {
  return (
    /\b(wie\s+lange|wieviel\s+zeit|dauer|brauch(?:e|st|en)?|minuten|eta)\b/i.test(
      text,
    ) && !/\b(führ\s+mich|fuehr\s+mich|navigier|bring\s+mich|start(?:e)?\s+(?:die\s+)?route)\b/i.test(text)
  );
}

function extractDestName(text: string): string {
  const m =
    text.match(
      /\bnach\s+([A-Za-zÄÖÜäöüß][\w\-ÄÖÜäöüß]*(?:\s+[A-Za-zÄÖÜäöüß][\w\-ÄÖÜäöüß]*){0,2})(?=\s|$|[.?!]|,|brauch|mit|zu\s+fu)/i,
    ) ||
    text.match(
      /\b(?:zu(?:m|r)?|nach)\s+(.+?)(?:\s*[.?!]|$)/i,
    ) ||
    text.match(
      /navigier\w*\s+(?:mich\s+)?(?:zu(?:m|r)?\s+)?(.+)/i,
    ) ||
    text.match(
      /(?:hinzu(?:fügen|fuegen)?|mitnehmen|pack)\s+(?:noch\s+)?(?:den\s+|die\s+|das\s+|einen?\s+)?(.+?)(?:\s+(?:hinzu|dazu|in\s+)|$)/i,
    ) ||
    text.match(
      /(?:füge?\s+|fuege?\s+)(?:bitte\s+)?(.+?)\s+(?:hinzu|in\s+)/i,
    );
  let name = (m?.[1] ?? text)
    .replace(/\s+/g, ' ')
    .replace(/\b(zu\s+mein(?:em|en)?\s+navi|bitte|brauch(?:e|st|en)?|wie\s+lange|mit\s+dem\s+(?:fahrrad|rad))\b/gi, '')
    .trim();
  // Elphi / Elphi-Harmonie / STT „A Harmonie“ → Elbphilharmonie Hamburg
  try {
    const {
      canonicalizeLandmarkQuery,
    } = require('../../services/navigation/packPlaceResolve') as {
      canonicalizeLandmarkQuery: (s: string) => {
        query: string;
        matchedLandmark: boolean;
      };
    };
    const c = canonicalizeLandmarkQuery(`${name} ${text}`);
    if (c.matchedLandmark) return c.query;
  } catch {
    if (
      /\belphi\b|\belphi[-\s]?harmonie\b|\belbphil\w*|\ba[-\s]?harmonie\b/i.test(
        name,
      ) ||
      /\belphi\b|\belphi[-\s]?harmonie\b|\belbphil\w*|\ba[-\s]?harmonie\b/i.test(
        text,
      )
    ) {
      name = 'Elbphilharmonie Hamburg';
    }
  }
  return name;
}

/** „ganz in der Nähe“ nur unter 1 km. */
function nearPhrase(distanceM: number): string {
  if (distanceM < 1000) return 'ganz in der Nähe';
  if (distanceM < 2500) return 'etwas weiter weg';
  return 'deutlich weiter';
}

/** ÖPNV vorschlagen ab ~20 Min Fuß (Plan-SSOT), nicht erst ab 30. */
function shouldOfferTransit(opts: {
  walkMin: number;
  bikeMin: number;
  transitMin?: number | null;
}): boolean {
  try {
    const { PLAN_SOFT_MODE_MAX_MIN } = require('../planning/planMobilityPolicy') as {
      PLAN_SOFT_MODE_MAX_MIN: number;
    };
    if (opts.walkMin >= PLAN_SOFT_MODE_MAX_MIN || opts.bikeMin >= PLAN_SOFT_MODE_MAX_MIN) {
      return true;
    }
  } catch {
    if (opts.walkMin >= 20 || opts.bikeMin >= 20) return true;
  }
  if (
    opts.transitMin != null &&
    opts.bikeMin - opts.transitMin >= 5
  ) {
    return true;
  }
  return false;
}

/** Anker = letzter geplanter/aktiver Stopp, sonst GPS. */
function resolveRouteAnchor(gps: { lat: number; lng: number }): {
  lat: number;
  lng: number;
  name: string;
} {
  const tour = useFinnusStore.getState().multiStopTour;
  if (tour?.stops?.length) {
    const upcoming = tour.stops
      .slice(tour.currentIndex)
      .filter((s) => !s.done);
    const last = upcoming[upcoming.length - 1] ?? tour.stops[tour.stops.length - 1];
    if (last) {
      return { lat: last.lat, lng: last.lng, name: last.name };
    }
  }
  const active = useFinnusStore.getState().navTargetName;
  const planStops = useFuturePlanStore
    .getState()
    .plan.stops.filter(
      (s) =>
        s.kind !== 'nav_leg' &&
        typeof s.lat === 'number' &&
        typeof s.lng === 'number',
    );
  const lastPlan = planStops[planStops.length - 1];
  if (lastPlan?.lat != null && lastPlan.lng != null) {
    return {
      lat: lastPlan.lat,
      lng: lastPlan.lng,
      name: lastPlan.title,
    };
  }
  if (active) {
    return { lat: gps.lat, lng: gps.lng, name: active };
  }
  return { lat: gps.lat, lng: gps.lng, name: 'hier' };
}

async function resolvePlace(opts: {
  query: string;
  lat: number;
  lng: number;
  cityHint: string | null;
}): Promise<DiscoveredPlace | null> {
  const query = opts.cityHint
    ? `${opts.query} ${opts.cityHint}`
    : opts.query;
  try {
    const hits = await searchPlacesByText({
      query,
      lat: opts.lat,
      lng: opts.lng,
      radiusM: 25_000,
    });
    const near = hits
      .filter((h) => h.distanceM <= 40_000)
      .filter((h) => !/kunst|museum|galerie/i.test(h.name))
      .filter(
        (h) => !looksLikeOfficeOnlyPlace({ name: h.name, types: h.types }),
      );
    const open = near.filter((h) => h.openNow === true);
    return open[0] ?? near[0] ?? null;
  } catch {
    return null;
  }
}

export const mobilityAgent: Module2Agent = {
  id: 'mobility',
  intents: ['mobility'],
  async run({ task, rucksack }) {
    void agentPromptLaws('mobility');
    try {
      const { runTaxiRideshare } = require('./taxiRideshare') as {
        runTaxiRideshare: (o: {
          task: typeof task;
          rucksack: typeof rucksack;
        }) => Promise<import('../types').AgentResult | null>;
      };
      const taxi = await runTaxiRideshare({ task, rucksack });
      if (taxi) return taxi;
    } catch {
      /* fall through to walk/transit */
    }
    const a = anchorCoords(rucksack);
    const place = resolveWorkingPlace(
      task.rewrittenText,
      rucksack.cityHint,
      task.city,
    );
    const softCity =
      place.biasMode === 'named_city' ? place.city : null;
    const append = wantsAppendToRoute(task.rewrittenText);
    const transitAsk = wantsTransit(task.rewrittenText);
    const bikeAsk = wantsBike(task.rewrittenText);
    const etaOnly = wantsEtaOnly(task.rewrittenText);
    if (bikeAsk) {
      forceBikeModeFromVoice();
    } else {
      const modeHit = detectTravelModeVoiceOverride(task.rewrittenText);
      if (modeHit === 'foot') setPreferredTravelMode('foot');
    }
    const routeMode: 'walking' | 'bicycling' = bikeAsk ? 'bicycling' : 'walking';

    try {
      const { wantsTransitTicketFare, researchTransitTicketFare } = await import(
        '../../services/transit/transitTicketResearch'
      );
      if (wantsTransitTicketFare(task.rewrittenText)) {
        const hit = await researchTransitTicketFare({
          userText: task.rewrittenText,
          lat: a.lat,
          lng: a.lng,
          cityHint: softCity,
        });
        return {
          agent: 'mobility',
          ok: true,
          draftText: hit.speech,
          bullets: hit.bullets,
          buttons: hit.actions
            .filter((act) => act.type === 'OPEN_URL' && act.payload.url)
            .map((act, i) => ({
              id: `oepnv_tix_${i}`,
              label: act.label,
              payload: {
                kind: 'deep_link' as const,
                url: act.payload.url!,
              },
            })),
          meta: {
            transit: true,
            priceEur: hit.price,
            ticketUrl: hit.actions[0]?.payload.url,
            hasTicketBtn: hit.actions.length > 0,
          },
        };
      }
    } catch {
      /* fall through */
    }

    // Aktive Navigation: HUD-ETA/Distanz sofort — kein Re-Geocode / „keine Route“
    if (etaOnly && !append && !transitAsk) {
      try {
        const st = useFinnusStore.getState();
        if (
          st.navActive &&
          typeof st.navEtaMin === 'number' &&
          st.navEtaMin > 0 &&
          typeof st.navDistanceM === 'number' &&
          st.navDistanceM > 0
        ) {
          const destLabel =
            (st.navTargetName || '').trim() || 'dein Ziel';
          const weakOrSame =
            isWeakDestName(extractDestName(task.rewrittenText)) ||
            (() => {
              const q = extractDestName(task.rewrittenText).toLowerCase();
              const n = destLabel.toLowerCase();
              return (
                !q ||
                n.includes(q.slice(0, Math.min(q.length, 8))) ||
                q.includes(n.slice(0, Math.min(n.length, 8)))
              );
            })();
          if (weakOrSame) {
            const km = formatDistanceKmOrM(st.navDistanceM);
            const etaMin = Math.max(1, Math.round(st.navEtaMin));
            const modeNow = (() => {
              try {
                const {
                  resolveActiveTravelMode,
                } = require('../../services/navigation/travelModeContext') as {
                  resolveActiveTravelMode: () => { mode: string };
                };
                return resolveActiveTravelMode().mode;
              } catch {
                return 'foot';
              }
            })();
            const durSpeech = formatDurationMinutesDe(etaMin, 'speech');
            const lead = bikeAsk
              ? `Mit dem Rad brauchst du ${durSpeech} (${km})`
              : modeNow === 'bike'
                ? `Noch ${durSpeech} mit dem Rad (${km})`
                : `Noch ${durSpeech} (${km})`;
            const switchBike =
              bikeAsk && modeNow !== 'bike'
                ? ' Soll ich die Navigation aufs Fahrrad umstellen?'
                : '';
            const buttons =
              bikeAsk && modeNow !== 'bike'
                ? [
                    {
                      id: 'switch_bike_nav',
                      label: 'Navigation auf Rad',
                      payload: {
                        kind: 'switch_nav_mode' as const,
                        preferBike: true,
                      },
                    },
                  ]
                : [];
            return {
              agent: 'mobility',
              ok: true,
              draftText: `${lead} nach ${destLabel}.${switchBike}`,
              bullets: [
                destLabel,
                `Noch ${formatDurationMinutesDe(etaMin, 'short')}`,
                km,
              ].slice(0, 3),
              buttons,
              meta: {
                etaOnly: true,
                liveNavEta: true,
                bike: bikeAsk,
                distanceM: st.navDistanceM,
                destName: destLabel,
                switchNavToBike: Boolean(switchBike),
              },
            };
          }
        }
      } catch {
        /* soft — normaler ETA-Pfad */
      }
    }

    // Ziel-Koordinaten: Pack/SQLite → lokaler Anker → Offer → OSM → Google
    // Nie User-GPS als Ziel. Start/Origin bleibt User-Standort (für ETA/Route).
    const local = resolveLocalAnchor(task.rewrittenText);
    const shortCtx = getShortTerm();
    const pendingOffer = useFinnusStore.getState().pendingNavOffer;
    let destName = extractDestName(task.rewrittenText);
    if (isWeakDestName(destName)) {
      destName =
        pendingOffer?.name ||
        shortCtx.lastPlaceName ||
        local?.name ||
        destName;
    }
    let resolved = '';
    let lat: number | null = null;
    let lng: number | null = null;
    let openNow: boolean | null = null;
    let closedPick: DiscoveredPlace | null = null;
    let packPoiId: number | null = null;

    // 1) Pack / SQLite (Stadt-Datensatz)
    if (!isWeakDestName(destName)) {
      try {
        const { resolveExistingPoiId } = await import(
          '../../services/navigation/resolveNavTarget'
        );
        const { getPoiWithFacts } = await import('../../db/database');
        const poiId = await resolveExistingPoiId(destName);
        if (poiId != null) {
          const poi = await getPoiWithFacts(poiId);
          if (
            poi &&
            Number.isFinite(poi.lat) &&
            Number.isFinite(poi.lng)
          ) {
            packPoiId = poi.id;
            lat = poi.lat;
            lng = poi.lng;
            resolved = poi.name;
          }
        }
      } catch {
        /* soft */
      }
      if (lat == null || lng == null) {
        try {
          const { lookupPackFactsForSubject } = await import('./packFactLookup');
          const hit = await lookupPackFactsForSubject({
            subject: destName,
            cityHint: softCity,
            lat: a.lat,
            lng: a.lng,
          });
          if (
            hit?.poi &&
            hit.poi.id > 0 &&
            Number.isFinite(hit.poi.lat) &&
            Number.isFinite(hit.poi.lng)
          ) {
            packPoiId = hit.poi.id;
            lat = hit.poi.lat;
            lng = hit.poi.lng;
            resolved = hit.poi.name;
          }
        } catch {
          /* soft */
        }
      }
    }

    // 2) Hardcoded Local-Anchor (nur wenn Pack nichts hatte)
    if ((lat == null || lng == null) && local) {
      lat = local.lat;
      lng = local.lng;
      resolved = local.name;
    }

    // 3) Pending Offer / letzter Ort
    if (
      (lat == null || lng == null) &&
      pendingOffer?.name &&
      typeof pendingOffer.lat === 'number' &&
      typeof pendingOffer.lng === 'number'
    ) {
      lat = pendingOffer.lat;
      lng = pendingOffer.lng;
      resolved = pendingOffer.name;
    }

    // 4) Pack (aktive SQLite + gecachte Städte z. B. Hamburg) → OSM → Google
    if ((lat == null || lng == null) && !isWeakDestName(destName)) {
      try {
        const { resolvePlacePackOsmGoogle } = await import(
          '../../services/navigation/packPlaceResolve'
        );
        const hit = await resolvePlacePackOsmGoogle({
          query: destName,
          cityHint: softCity,
          biasLat: a.lat,
          biasLng: a.lng,
        });
        if (hit) {
          lat = hit.lat;
          lng = hit.lng;
          resolved = hit.label;
          if (hit.source === 'active_sqlite' || hit.source === 'cached_pack') {
            // Pack-Koordinaten: kein Places-Bias nötig
          }
        }
      } catch {
        /* soft */
      }
    }

    // 5) Places-Fallback (Öffnungsstatus) — nur wenn noch nichts
    if ((lat == null || lng == null) && !isWeakDestName(destName)) {
      const pick = await resolvePlace({
        query: destName,
        lat: a.lat,
        lng: a.lng,
        cityHint: softCity,
      });
      if (pick) {
        lat = pick.lat;
        lng = pick.lng;
        resolved = pick.name;
        openNow = pick.openNow === true;
        if (pick.openNow === false) closedPick = pick;
      } else {
        const g = await geocodePlaceName(destName, {
          biasLat: a.lat,
          biasLng: a.lng,
          cityHint: softCity,
        });
        if (g) {
          lat = g.lat;
          lng = g.lng;
          resolved = g.label;
        }
      }
    }

    if (!resolved && !isWeakDestName(destName)) resolved = destName;

    // Gleicher Name in mehreren Städten: fragen, bevor eine Stadt startet.
    if (!isWeakDestName(destName) && !softCity) {
      try {
        const { geocodeNamedPlaceHits } = await import(
          '../../services/navigation/googleMapsNav'
        );
        const { analyzePlaceCityHits } = await import(
          '../../services/navigation/placeCityDisambiguate'
        );
        const { parkAmbiguousPlaceChoice } = await import(
          '../../services/navigation/resolveNavTarget'
        );
        const core = destName.split(',')[0]?.trim() || destName;
        const hits = await geocodeNamedPlaceHits(core);
        const analysis = analyzePlaceCityHits(task.rewrittenText, hits);
        if (analysis.kind === 'choice') {
          const parked = parkAmbiguousPlaceChoice(
            analysis.place,
            analysis.options,
          );
          return {
            agent: 'mobility',
            ok: true,
            draftText: parked.message,
            bullets: analysis.options.map((o) => o.city).slice(0, 3),
            buttons: analysis.options.slice(0, 4).map((o) => ({
              id: `place_city_${o.city}`,
              label: o.city,
              payload: {
                kind: 'navigate' as const,
                lat: o.lat,
                lng: o.lng,
                label: `${analysis.place}, ${o.city}`,
              },
            })),
            meta: {
              autoStartNav: false,
              forceAutoNav: false,
              needsNavConfirm: true,
              destName: analysis.place,
            },
          };
        }
      } catch {
        /* soft */
      }
    }

    // Nie User-GPS als Ziel missbrauchen → Fake-„17 m“
    if (
      lat == null ||
      lng == null ||
      !Number.isFinite(lat) ||
      !Number.isFinite(lng) ||
      !resolved ||
      isWeakDestName(resolved)
    ) {
      return {
        agent: 'mobility',
        ok: true,
        draftText:
          'Wohin genau soll die Route? Sag den Ortsnamen nochmal — dann starte ich die Navigation.',
        bullets: ['Ziel unklar'],
        buttons: [],
        meta: { unresolvedDest: true },
      };
    }

    // Plausibilität: Ziel ≈ User ohne Pack-Treffer → Geocode-Müll
    const airM0 = haversineMeters(a.lat, a.lng, lat, lng);
    const suspiciousNear =
      packPoiId == null &&
      airM0 < 80 &&
      (isFallbackAnchor(a) || airM0 < 40 || !local);
    if (suspiciousNear && resolved) {
      const retryQ = softCity ? `${resolved} ${softCity}` : resolved;
      try {
        const { resolveDestination } = await import(
          '../../runtime/navigationModule'
        );
        const dest = await resolveDestination({ name: retryQ });
        if (
          dest &&
          haversineMeters(a.lat, a.lng, dest.lat, dest.lng) >= 40
        ) {
          lat = dest.lat;
          lng = dest.lng;
          resolved = dest.label || resolved;
        }
      } catch {
        const g = await geocodePlaceName(retryQ, {
          biasLat: a.lat,
          biasLng: a.lng,
          cityHint: softCity,
        });
        if (g && haversineMeters(a.lat, a.lng, g.lat, g.lng) >= 40) {
          lat = g.lat;
          lng = g.lng;
          resolved = g.label || resolved;
        }
      }
      const airM1 = haversineMeters(a.lat, a.lng, lat, lng);
      if (airM1 < 25) {
        return {
          agent: 'mobility',
          ok: true,
          draftText:
            'Die Koordinaten fürs Ziel wirken noch unklar — sag den Ortsnamen nochmal, dann berechne ich die echte Distanz.',
          bullets: ['Ziel-Koordinaten unklar'],
          buttons: [],
          meta: { unresolvedDest: true },
        };
      }
    }

    setLastPlaceName(resolved);
    try {
      const { maybeParkFarDestConfirm } = await import(
        '../../services/navigation/resolveNavTarget'
      );
      const parked = maybeParkFarDestConfirm({
        name: destName,
        lat,
        lng,
        poiId: packPoiId,
      });
      if (parked) {
        setLastPlaceName(parked.labeledName);
        return {
          agent: 'mobility',
          ok: true,
          draftText: parked.message,
          bullets: [parked.labeledName, parked.destCity]
            .filter((x): x is string => Boolean(x))
            .slice(0, 3),
          buttons: [
            {
              id: 'confirm_far_nav',
              label: 'Ja, dorthin',
              payload: {
                kind: 'navigate' as const,
                lat,
                lng,
                label: parked.labeledName,
              },
            },
          ],
          meta: {
            autoStartNav: false,
            destName: parked.labeledName,
            needsNavConfirm: true,
          },
        };
      }
    } catch {
      /* soft */
    }
    try {
      useFinnusStore.getState().setPendingNavOffer({
        poiId: packPoiId ?? -1,
        name: resolved,
        lat,
        lng,
      });
    } catch {
      /* soft */
    }

    // Geschlossen → Alternative mit ETA + Buttons für beide
    if ((closedPick || openNow === false) && !/trotzdem/i.test(task.rewrittenText)) {
      const closedName = closedPick?.name ?? resolved;
      let alt: DiscoveredPlace | null = null;
      try {
        const alts = await searchPlacesByText({
          query: softCity
            ? `Supermarkt geöffnet 24 Stunden ${softCity}`
            : 'Supermarkt geöffnet',
          lat: a.lat,
          lng: a.lng,
          radiusM: 12_000,
        });
        alt =
          alts.find(
            (h) =>
              h.openNow === true &&
              !looksLikeOfficeOnlyPlace({ name: h.name, types: h.types }) &&
              h.name.toLowerCase() !== closedName.toLowerCase(),
          ) ??
          alts.find(
            (h) =>
              h.openNow === true &&
              h.name.toLowerCase() !== closedName.toLowerCase(),
          ) ??
          null;
      } catch {
        /* soft */
      }

      let altEtaLine = '';
      let altNear = '';
      if (alt) {
        const distM = haversineMeters(a.lat, a.lng, alt.lat, alt.lng);
        altNear = nearPhrase(distM);
        try {
          const eta = await estimateTravelEtaRouted({
            userLat: a.lat,
            userLng: a.lng,
            destLat: alt.lat,
            destLng: alt.lng,
            destName: alt.name,
            mode: 'walking',
          });
          altEtaLine = formatWalkBikeEtaSpeech(eta);
        } catch {
          altEtaLine = '';
        }
      }

      const buttons = [
        {
          id: 'plan_closed',
          label: shortenActionLabel(`📅 ${closedName}`),
          payload: {
            kind: 'ui' as const,
            action: 'prompt',
            data: {
              text: `Plane ${closedName} für später in meiner Timeline`,
            },
          },
        },
        ...(alt
          ? [
              {
                id: 'nav_alt',
                label: shortenActionLabel(`📍 ${alt.name}`),
                payload: {
                  kind: 'navigate' as const,
                  lat: alt.lat,
                  lng: alt.lng,
                  label: alt.name,
                },
              },
            ]
          : [
              {
                id: 'find_open',
                label: shortenActionLabel('🔓 Offener Markt'),
                payload: {
                  kind: 'ui' as const,
                  action: 'prompt',
                  data: {
                    text: 'Finde den nächsten offenen Supermarkt und navigiere mich hin',
                  },
                },
              },
            ]),
      ];

      return {
        agent: 'mobility',
        ok: true,
        draftText: [
          'FAKTEN Mobility geschlossen (nicht wörtlich):',
          `${closedName}: geschlossen`,
          alt
            ? `Alternative: ${alt.name} — ${altNear}${altEtaLine ? ` · ${altEtaLine}` : ''}`
            : 'Keine offene Alternative gefunden',
          'FLOW: Geschlossen ehrlich sagen → Alternative nennen (Nähe nur wenn <1 km als „ganz in der Nähe“) → ETA Fuß/Rad → Buttons: geschlossen später planen + Alternative navigieren. Kein Roman.',
        ].join('\n'),
        bullets: [
          closedName,
          'Geschlossen',
          alt ? alt.name : 'Alternative suchen',
        ],
        buttons,
      };
    }

    const anchor = append
      ? resolveRouteAnchor(a)
      : { lat: a.lat, lng: a.lng, name: 'hier' };

    // Rad + ÖPNV in einer Frage: echte Zeiten, Ankunft, Leave-by, klare Empfehlung
    if (wantsModeCompare(task.rewrittenText) && !append) {
      try {
        const eta = await estimateTravelEtaRouted({
          userLat: anchor.lat,
          userLng: anchor.lng,
          destLat: lat,
          destLng: lng,
          destName: resolved,
          mode: 'walking',
          skipObstacles: true,
        });
        const plan = await planJourney({
          from: { lat: anchor.lat, lng: anchor.lng },
          to: { lat, lng },
          travelMode: 'transit',
          numItineraries: 2,
          ...journeyPlanTimeOpts(task.rewrittenText),
        });
        const best = plan.itineraries[0] ?? null;
        const walkMin = eta.directWalkMinutes;
        const bikeMin = eta.bikeMinutes;
        const transitMin = best
          ? Math.max(1, Math.round(best.durationSec / 60))
          : null;
        const arriveWalk = new Date(Date.now() + walkMin * 60_000);
        const arriveBike = new Date(Date.now() + bikeMin * 60_000);
        const arriveTransit = best?.endTime ?? null;

        let card: ReturnType<typeof formatJourneyForConcierge> | null = null;
        if (best) {
          card = formatJourneyForConcierge(best, resolved);
          rememberJourneyForStart({
            itinerary: best,
            destName: resolved,
            destLat: lat,
            destLng: lng,
          });
        }

        const ranked: Array<{
          id: 'bike' | 'transit' | 'walk';
          min: number;
          arrive: Date;
        }> = [
          { id: 'bike', min: bikeMin, arrive: arriveBike },
          { id: 'walk', min: walkMin, arrive: arriveWalk },
        ];
        if (transitMin != null && arriveTransit) {
          ranked.push({
            id: 'transit',
            min: transitMin,
            arrive: arriveTransit,
          });
        }
        ranked.sort((x, y) => x.min - y.min);
        const bestMode = ranked[0]?.id ?? 'bike';

        const km = formatDistanceKmOrM(eta.distanceM);
        const transitBit =
          best && card && transitMin != null && arriveTransit
            ? `ÖPNV ${formatDurationMinutesDe(transitMin, 'speech')}, Ankunft gegen ${clockDe(arriveTransit)} Uhr` +
              (card.leaveInMin != null
                ? card.leaveInMin <= 0
                  ? ' — dafür jetzt sofort zur Haltestelle'
                  : card.leaveInMin >= 60
                    ? ` — in ${formatDurationMinutesDe(card.leaveInMin, 'speech')} los zur Haltestelle`
                    : ` — in ca. ${card.leaveInMin} Minuten los zur Haltestelle`
                : '') +
              `. `
            : 'ÖPNV-Verbindung gerade nicht sauber geladen. ';

        const rec =
          bestMode === 'bike'
            ? 'Klarste Empfehlung: Fahrrad — aktuell der schnellste Weg.'
            : bestMode === 'transit'
              ? 'ÖPNV ist hier die bessere Wahl — wenn du jetzt den Leave-by mitnimmst.'
              : 'Zu Fuß geht, dauert aber am längsten.';

        const draft =
          `Route ca. ${km}: Rad ${formatDurationMinutesDe(bikeMin, 'speech')} (Ankunft ~${clockDe(arriveBike)}), ` +
          `zu Fuß ${formatDurationMinutesDe(walkMin, 'speech')} (~${clockDe(arriveWalk)}). ` +
          transitBit +
          rec;

        return {
          agent: 'mobility',
          ok: true,
          draftText:
            draft +
            ' FLOW: Zeiten belegen → Leave-by wenn ÖPNV → eine klare Empfehlung. Buttons: Rad-Route + ÖPNV starten.',
          bullets: [
            `Rad ${formatDurationMinutesDe(bikeMin, 'short')} · Ankunft ${clockDe(arriveBike)}`,
            transitMin != null && arriveTransit
              ? `ÖPNV ${formatDurationMinutesDe(transitMin, 'short')} · Ankunft ${clockDe(arriveTransit)}`
              : `Fuß ${formatDurationMinutesDe(walkMin, 'short')}`,
            `Empfehlung: ${
              bestMode === 'bike'
                ? 'Fahrrad'
                : bestMode === 'transit'
                  ? 'ÖPNV'
                  : 'zu Fuß'
            }`,
          ].slice(0, 3),
          buttons: [
            {
              id: 'start_bike',
              label: navButtonLabel(resolved, true),
              payload: {
                kind: 'navigate' as const,
                lat,
                lng,
                label: resolved,
                preferBike: true,
              },
            },
            ...(best
              ? [
                  {
                    id: 'start_transit',
                    label: shortenActionLabel('🚌 ÖPNV starten'),
                    payload: {
                      kind: 'ui' as const,
                      action: 'start_journey_nav',
                      data: { dest: resolved },
                    },
                  },
                ]
              : []),
            {
              id: 'start_walk',
              label: navButtonLabel(resolved, false),
              payload: {
                kind: 'navigate' as const,
                lat,
                lng,
                label: resolved,
              },
            },
          ].slice(0, 4),
          meta: {
            openNow,
            modeCompare: true,
            distanceM: eta.distanceM,
            destName: resolved,
            destLat: lat,
            destLng: lng,
            bikeMinutes: bikeMin,
            walkMinutes: walkMin,
            transitMinutes: transitMin,
            recommend: bestMode,
            journeyEndMs: best?.endTime.getTime() ?? null,
            firstTransitWhen: card?.firstTransitWhen?.getTime() ?? null,
          },
        };
      } catch {
        /* fall through */
      }
    }

    // ÖPNV-Verbindung + Störungs-/Bau-Check
    if (transitAsk) {
      try {
        const { researchTransitDisruption } = await import(
          '../../services/research/transitDisruptionResearch'
        );
        const disruption = await researchTransitDisruption({
          userText: task.rewrittenText,
          lat: anchor.lat,
          lng: anchor.lng,
          cityHint: softCity,
        });

        const plan = await planJourney({
          from: { lat: anchor.lat, lng: anchor.lng },
          to: { lat, lng },
          travelMode: 'transit',
          numItineraries: 3,
          ...journeyPlanTimeOpts(task.rewrittenText),
        });
        const best = plan.itineraries[0];
        if (best || disruption.hasDisruption) {
          const card = best
            ? formatJourneyForConcierge(best, resolved)
            : null;
          const fromHint =
            append && anchor.name !== 'hier'
              ? `Von ${anchor.name} weiter `
              : '';
          if (best) {
            rememberJourneyForStart({
              itinerary: best,
              destName: resolved,
              destLat: lat,
              destLng: lng,
            });
          }
          const disruptLead = disruption.hasDisruption
            ? `${disruption.spokenDraft} `
            : '';
          const buttons = [
            ...(card
              ? [
                  {
                    id: 'start_transit',
                    label: shortenActionLabel('🚌 ÖPNV starten'),
                    payload: {
                      kind: 'ui' as const,
                      action: 'start_journey_nav',
                      data: { dest: resolved },
                    },
                  },
                ]
              : []),
            ...disruption.buttons.filter((b) => b.id !== 'start_transit'),
            {
              id: 'later_conn',
              label: shortenActionLabel('Spätere Fahrt'),
              payload: {
                kind: 'ui' as const,
                action: 'prompt',
                data: {
                  text: `Suche eine spätere ÖPNV-Verbindung zu ${resolved}`,
                },
              },
            },
          ].slice(0, 4);

          return {
            agent: 'mobility',
            ok: true,
            draftText:
              fromHint +
              (disruptLead || '') +
              (card?.speech ?? disruption.spokenDraft),
            bullets: [
              ...(disruption.hasDisruption
                ? disruption.bullets.slice(0, 1)
                : []),
              ...(card?.bullets ?? disruption.bullets),
            ].slice(0, 3),
            buttons,
            meta: {
              openNow,
              transit: true,
              alternative: disruption.alternativeOffered,
              journeyEndMs: best?.endTime.getTime() ?? null,
              firstTransitWhen: card?.firstTransitWhen?.getTime() ?? null,
              station: card?.firstTransitStation,
              disruption: disruption.hasDisruption,
            },
          };
        }
      } catch {
        /* fall through to walk */
      }
    }

    const eta = await estimateTravelEtaRouted({
      userLat: anchor.lat,
      userLng: anchor.lng,
      destLat: lat,
      destLng: lng,
      destName: resolved,
      mode: routeMode,
      skipObstacles: etaOnly || bikeAsk,
    });
    const km = eta.distanceM / 1000;
    const etaLine = bikeAsk
      ? formatBikeEtaSpeech(eta)
      : routeMode === 'walking' && !transitAsk
        ? formatWalkBikeEtaSpeech(eta)
        : formatWalkBikeEtaSpeech(eta);
    const offerTransit =
      !bikeAsk &&
      shouldOfferTransit({
        walkMin: eta.directWalkMinutes,
        bikeMin: eta.bikeMinutes,
      });
    const fromBit =
      append && anchor.name !== 'hier'
        ? `Von ${anchor.name} sind es noch `
        : '';

    // Reine ETA-Frage (z. B. Fahrrad nach Uetersen): sofort Zahl + Los-Frage
    if (etaOnly && !append && !transitAsk) {
      const lead = bikeAsk
        ? formatBikeEtaSpeech(eta)
        : formatWalkEtaSpeech(eta);
      const navLive = useFinnusStore.getState().navActive === true;
      const goNow =
        wantsExplicitNavStart(task.rewrittenText) ||
        shouldAutoStartShortRoute({
          etaMin: bikeAsk ? eta.bikeMinutes : eta.directWalkMinutes,
          text: task.rewrittenText,
          navLive,
        });
      let modeNow: string = 'foot';
      try {
        const {
          resolveActiveTravelMode,
        } = require('../../services/navigation/travelModeContext') as {
          resolveActiveTravelMode: () => { mode: string };
        };
        modeNow = resolveActiveTravelMode().mode;
      } catch {
        /* soft */
      }
      const ask = goNow
        ? 'Ich führ dich hin.'
        : navLive && bikeAsk && modeNow !== 'bike'
          ? 'Soll ich die Navigation aufs Fahrrad umstellen?'
          : bikeAsk
            ? 'Wollen wir direkt losradeln?'
            : navLive
              ? ''
              : 'Wollen wir direkt los?';
      const buttons =
        navLive && bikeAsk && modeNow !== 'bike'
          ? [
              {
                id: 'switch_bike_nav',
                label: 'Navigation auf Rad',
                payload: {
                  kind: 'switch_nav_mode' as const,
                  preferBike: true,
                },
              },
            ]
          : [
              {
                id: 'start_nav',
                label: navButtonLabel(resolved, bikeAsk),
                payload: {
                  kind: 'navigate' as const,
                  lat,
                  lng,
                  label: resolved,
                  preferBike: bikeAsk,
                },
              },
            ];
      return {
        agent: 'mobility',
        ok: true,
        draftText:
          `${lead} nach ${resolved}. ${ask} `.trim() +
          (goNow
            ? ' FLOW: Bei Ja → Route starten, erster Abbiegehinweis.'
            : navLive && bikeAsk && modeNow !== 'bike'
              ? ' FLOW: Bei Ja → aktuelle Navigation auf Rad umstellen (gleiche Zielkoordinaten).'
              : !navLive && !goNow
                ? ` FLOW: Bei Ja → Route starten (${bikeAsk ? 'Rad' : 'Fuß'}), erster Abbiegehinweis. Kein Roman, kein Fuß-Fallback wenn Rad gefragt.`
                : ''),
        bullets: [
          resolved,
          bikeAsk
            ? eta.routed === false
              ? `Rad — Distanz ${formatDistanceKmOrM(eta.distanceM)}`
              : `Rad ~${eta.bikeMinutes} Min`
            : eta.routed === false
              ? `Fuß — Distanz ${formatDistanceKmOrM(eta.distanceM)}`
              : `Fuß ~${eta.directWalkMinutes} Min`,
          eta.routed
            ? `Route ${formatDistanceKmOrM(eta.distanceM)}`
            : `~${km.toFixed(1)} km`,
        ].slice(0, 3),
        buttons,
        meta: {
        openNow,
        bike: bikeAsk,
        etaOnly: true,
        distanceM: eta.distanceM,
        destName: resolved,
        destLat: lat,
        destLng: lng,
        packPoiId: packPoiId ?? undefined,
        autoStartNav: goNow,
        switchNavToBike: navLive && bikeAsk && modeNow !== 'bike',
      },
      };
    }

    // Stopp anhängen: Timeline + Multi-Stop
    if (append) {
      addPlanStop({
        title: resolved,
        lat,
        lng,
        kind: 'stop',
        notes: openNow === false ? 'geschlossen' : undefined,
      });
      try {
        await insertTourStop(
          {
            poiId: -1,
            name: resolved,
            lat,
            lng,
            done: false,
            priority: 'soft',
          },
          { position: 'end', startNow: false },
        );
      } catch {
        /* soft */
      }

      let draft =
        `Klar — ${resolved} kommt hinter ${anchor.name} in deinen Plan. ` +
        `${fromBit}${etaLine}.`;
      if (offerTransit) {
        draft +=
          ' ÖPNV kann sich lohnen — Tippe unten für die konkrete Verbindung.';
      } else {
        draft += ' Schau in der Timeline nach — der Stopp ist eingetragen.';
      }

      return {
        agent: 'mobility',
        ok: true,
        draftText: draft,
        bullets: [
          `+ ${resolved}`,
          eta.routed
            ? `Weiter ${eta.distanceM >= 1000 ? `${(eta.distanceM / 1000).toFixed(1).replace('.', ',')} km` : `${Math.round(eta.distanceM)} m`}`
            : `Weiter ~${km.toFixed(1).replace('.', ',')} km`,
          `Fuß ~${eta.directWalkMinutes} Min · Rad ~${eta.bikeMinutes} Min`,
        ],
        buttons: [
          {
            id: 'view_plan',
            label: shortenActionLabel('📅 Timeline'),
            payload: { kind: 'ui', action: 'show_future_plan' },
          },
          ...(offerTransit
            ? [
                {
                  id: 'transit',
                  label: shortenActionLabel('🚌 ÖPNV checken'),
                  payload: {
                    kind: 'ui' as const,
                    action: 'ask_transit',
                    data: { dest: resolved, from: anchor.name },
                  },
                },
              ]
            : [
                {
                  id: 'start_nav',
                  label: navButtonLabel(resolved, false),
                  payload: {
                    kind: 'navigate' as const,
                    lat,
                    lng,
                    label: resolved,
                  },
                },
              ]),
        ],
        meta: {
          openNow,
          append: true,
          distanceM: eta.distanceM,
          destName: resolved,
          destLat: lat,
          destLng: lng,
        },
      };
    }

    let draft: string;
    const goNow =
      wantsExplicitNavStart(task.rewrittenText) ||
      shouldAutoStartShortRoute({
        etaMin: bikeAsk ? eta.bikeMinutes : eta.directWalkMinutes,
        text: task.rewrittenText,
        offerTransit,
      });
    if (goNow) {
      // Lange Strecke: nicht blind zu Fuß auto-starten — ÖPNV zuerst anbieten
      draft = offerTransit
        ? `${etaLine} nach ${resolved}. Das ist zu weit zu Fuß — ich schlage ÖPNV vor.`
        : `${etaLine} nach ${resolved}. Ich führ dich hin.`;
    } else if (bikeAsk) {
      draft = `${formatBikeEtaSpeech(eta)} nach ${resolved}. Rad-Route liegt bereit.`;
    } else if (offerTransit) {
      draft =
        `${resolved} — ${etaLine}. ` +
        `Zu Fuß wäre das unnötig lang — unten startest du die ÖPNV-Verbindung.`;
    } else {
      draft = `${etaLine} nach ${resolved}. Route liegt bereit.`;
    }

    try {
      const { withFacingPrefix } = require('./facingSpeech') as {
        withFacingPrefix: (
          d: string,
          lat: number,
          lng: number,
          max?: number,
        ) => string;
      };
      // Sichtweite / kurze Strecke: Facing vor dem ETA-Satz
      if (!offerTransit && eta.distanceM < 400) {
        draft = withFacingPrefix(draft, lat, lng, 400);
      }
    } catch {
      /* soft */
    }

    // Bei sinnvoller ÖPNV-Distanz sofort Journey mitliefern
    if (offerTransit) {
      try {
        const plan = await planJourney({
          from: { lat: a.lat, lng: a.lng },
          to: { lat, lng },
          travelMode: 'transit',
          numItineraries: 2,
          ...journeyPlanTimeOpts(task.rewrittenText),
        });
        const best = plan.itineraries[0];
        if (best) {
          const transitMin = Math.round(best.durationSec / 60);
          if (
            !shouldOfferTransit({
              walkMin: eta.directWalkMinutes,
              bikeMin: eta.bikeMinutes,
              transitMin,
            })
          ) {
            /* keep walk if transit not worth it */
          } else {
            const card = formatJourneyForConcierge(best, resolved);
            rememberJourneyForStart({
              itinerary: best,
              destName: resolved,
              destLat: lat,
              destLng: lng,
            });
            // ÖPNV klar besser als Fußmarsch: nur eine Option — niemand will 3 Std laufen
            return {
              agent: 'mobility',
              ok: true,
              draftText: `${resolved}: ${card.speech}`,
              bullets: card.bullets,
              buttons: [
                {
                  id: 'start_transit',
                  label: shortenActionLabel('🚌 ÖPNV starten'),
                  payload: {
                    kind: 'ui',
                    action: 'start_journey_nav',
                    data: { dest: resolved },
                  },
                },
              ],
              meta: {
                openNow,
                distanceM: eta.distanceM,
                destName: resolved,
                destLat: lat,
                destLng: lng,
                offerUber: false,
              },
            };
          }
        }
      } catch {
        /* keep walk draft */
      }
    }

    // Einfache Navigation: Ziel auch in Timeline (nicht nur Multi-Stop)
    if (!append) {
      addPlanStop({
        title: resolved,
        lat,
        lng,
        kind: 'stop',
        notes: openNow === false ? 'geschlossen' : undefined,
      });
    }

    return {
      agent: 'mobility',
      ok: true,
      draftText: draft,
      bullets: [
        resolved,
        eta.routed
          ? `Route ${Math.round(eta.distanceM)} m`
          : `~${km.toFixed(1)} km`,
        bikeAsk
          ? `Rad ${formatDurationMinutesDe(eta.bikeMinutes, 'short')}`
          : `Fuß ${formatDurationMinutesDe(eta.directWalkMinutes, 'short')} · Rad ${formatDurationMinutesDe(eta.bikeMinutes, 'short')}`,
      ].slice(0, 3),
      // Immer Nav-Button mit Koordinaten (Auto-Start strippt ihn danach aus der UI)
      buttons: [
        {
          id: 'start_nav',
          label: navButtonLabel(resolved, bikeAsk),
          payload: {
            kind: 'navigate',
            lat,
            lng,
            label: resolved,
            preferBike: bikeAsk,
          },
        },
        ...(offerTransit
          ? [
              {
                id: 'transit',
                label: shortenActionLabel('🚌 ÖPNV checken'),
                payload: {
                  kind: 'ui' as const,
                  action: 'ask_transit',
                  data: { dest: resolved },
                },
              },
            ]
          : []),
      ],
      meta: {
        openNow,
        bike: bikeAsk,
        distanceM: eta.distanceM,
        destName: resolved,
        destLat: lat,
        destLng: lng,
        packPoiId: packPoiId ?? undefined,
        // Lange Walk + ÖPNV verfügbar → nicht auto-Fuß; User wählt oder Transit-Return oben
        autoStartNav: goNow && !offerTransit,
      },
    };
  },
};
