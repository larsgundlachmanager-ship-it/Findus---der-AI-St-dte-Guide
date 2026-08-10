import type { Module2Agent } from './types';
import { agentPromptLaws } from '../laws/lawLayers';
import { anchorCoords } from '../rucksack/rucksackStore';
import {
  geocodePlaceName,
  looksLikeOfficeOnlyPlace,
  searchPlacesByText,
  type DiscoveredPlace,
} from '../../services/navigation/googleMapsNav';
import { resolveLocalAnchor } from '../context/shortTermContext';
import { resolveWorkingPlace } from '../context/placeContext';
import {
  estimateTravelEtaRouted,
  formatBikeEtaSpeech,
  formatDistanceKmOrM,
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
import { formatJourneyForConcierge } from '../../services/transit/formatJourneyCard';
import { rememberJourneyForStart } from '../../services/navigation/journeyStartCache';
import { shortenActionLabel } from '../../services/concierge/actionLabelShorten';
import { haversineMeters } from '../../db/database';

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
  // Elphi / Elphi-Harmonie → Elbphilharmonie (nicht Antwerpen etc.)
  if (
    /\belphi\b|\belphi[-\s]?harmonie\b|\belbphil\w*/i.test(name) ||
    /\belphi\b|\belphi[-\s]?harmonie\b|\belbphil\w*/i.test(text)
  ) {
    name = 'Elbphilharmonie Hamburg';
  }
  return name;
}

/** „ganz in der Nähe“ nur unter 1 km. */
function nearPhrase(distanceM: number): string {
  if (distanceM < 1000) return 'ganz in der Nähe';
  if (distanceM < 2500) return 'etwas weiter weg';
  return 'deutlich weiter';
}

/** ÖPNV vorschlagen wenn Fuß/Rad ≥30 Min oder ÖPNV ≥10 Min schneller als Rad. */
function shouldOfferTransit(opts: {
  walkMin: number;
  bikeMin: number;
  transitMin?: number | null;
}): boolean {
  if (opts.walkMin >= 30 || opts.bikeMin >= 30) return true;
  if (
    opts.transitMin != null &&
    opts.bikeMin - opts.transitMin >= 10
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

    const local = resolveLocalAnchor(task.rewrittenText);
    let resolved = local?.name ?? 'dein Ziel';
    let lat = local?.lat ?? a.lat;
    let lng = local?.lng ?? a.lng;
    let openNow: boolean | null = null;
    let closedPick: DiscoveredPlace | null = null;

    if (!local) {
      const destName = extractDestName(task.rewrittenText);
      // Städte/Orte: Geocode zuerst (schneller + treffsicherer als Places-POI)
      const looksLikeTown =
        destName.length >= 3 &&
        destName.length <= 48 &&
        !/\b(supermarkt|bäcker|baecker|café|cafe|restaurant|apotheke|toilette|klo|tennis|club|sport|museum|hotel|park|kneipe|bar|fitness|schwimm)\b/i.test(
          destName,
        );
      if (looksLikeTown || etaOnly || bikeAsk) {
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
      if (resolved === 'dein Ziel' || (!looksLikeTown && !etaOnly)) {
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
        } else if (resolved === 'dein Ziel') {
          const g = await geocodePlaceName(destName, {
            biasLat: a.lat,
            biasLng: a.lng,
            cityHint: softCity,
          });
          if (g) {
            lat = g.lat;
            lng = g.lng;
            resolved = g.label;
          } else {
            resolved = destName || resolved;
          }
        }
      }
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
      const ask = bikeAsk
        ? 'Wollen wir direkt losradeln?'
        : 'Wollen wir direkt los?';
      return {
        agent: 'mobility',
        ok: true,
        draftText:
          `${lead} nach ${resolved}. ${ask} ` +
          `FLOW: Bei Ja → Route starten (${bikeAsk ? 'Rad' : 'Fuß'}), erster Abbiegehinweis. Kein Roman, kein Fuß-Fallback wenn Rad gefragt.`,
        bullets: [
          resolved,
          bikeAsk
            ? `Rad ~${eta.bikeMinutes} Min`
            : `Fuß ~${eta.directWalkMinutes} Min`,
          eta.routed
            ? `Route ${formatDistanceKmOrM(eta.distanceM)}`
            : `~${km.toFixed(1)} km`,
        ].slice(0, 3),
        buttons: [
          {
            id: 'start_nav',
            label: shortenActionLabel(
              bikeAsk ? '🚴 Losradeln' : '🗺️ Route starten',
            ),
            payload: {
              kind: 'navigate',
              lat,
              lng,
              label: resolved,
              preferBike: bikeAsk,
            },
          },
        ],
        meta: { openNow, bike: bikeAsk, etaOnly: true },
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
                  label: shortenActionLabel('🗺️ Dorthin'),
                  payload: {
                    kind: 'navigate' as const,
                    lat,
                    lng,
                    label: resolved,
                  },
                },
              ]),
        ],
        meta: { openNow, append: true },
      };
    }

    let draft: string;
    if (bikeAsk) {
      draft = `${formatBikeEtaSpeech(eta)} nach ${resolved}. Wollen wir direkt losradeln?`;
    } else if (offerTransit) {
      draft =
        `${resolved} — ${etaLine}. ` +
        `ÖPNV kann sich lohnen (Fuß/Rad ab ~30 Min oder klar schneller). Tippe ÖPNV für die Verbindung.`;
    } else if (km > 2.5) {
      draft = `${etaLine} nach ${resolved}. Wollen wir direkt los?`;
    } else {
      draft = `${etaLine} nach ${resolved}. Wollen wir direkt los?`;
    }

    // Bei sinnvoller ÖPNV-Distanz sofort Journey mitliefern
    if (offerTransit) {
      try {
        const plan = await planJourney({
          from: { lat: a.lat, lng: a.lng },
          to: { lat, lng },
          travelMode: 'transit',
          numItineraries: 2,
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
                {
                  id: 'start_walk',
                  label: shortenActionLabel('🗺️ Fuß/Rad'),
                  payload: {
                    kind: 'navigate',
                    lat,
                    lng,
                    label: resolved,
                  },
                },
              ],
              meta: { openNow },
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
          ? `Rad ~${eta.bikeMinutes} Min`
          : `Fuß ~${eta.directWalkMinutes} · Rad ~${eta.bikeMinutes} Min`,
      ].slice(0, 3),
      buttons: [
        {
          id: 'start_nav',
          label: shortenActionLabel(
            bikeAsk ? '🚴 Losradeln' : '🗺️ Route starten',
          ),
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
      meta: { openNow, bike: bikeAsk },
    };
  },
};
