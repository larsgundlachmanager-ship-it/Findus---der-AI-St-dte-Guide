/**
 * Pre-Flight Side-Trip Feasibility — „Schaffe ich den Leuchtturm noch vor dem Flug?“
 *
 * Deterministisch: Deadline aus Memory/Session → POI auflösen → Hin+Rück+Aufenthalt
 * vs. Leave-by → Risiko (grün/gelb/rot) → ehrliche Antwort + Alternativen.
 */

import { getAllPois, haversineMeters } from '../../db/database';
import type { Poi } from '../../db/types';
import type { GeminiConciergeResponse, QuickAction } from '../../types/concierge';
import { useFinnusStore } from '../../store/useFinnusStore';
import { useUserMemoryStore } from '../../store/useUserMemoryStore';
import { useSessionPlanStore } from '../../store/useSessionPlanStore';
import { useOpenQuestionStore } from '../../store/useOpenQuestionStore';
import { estimateTravelEta } from '../navigation/travelEta';
import { findAirportPoi } from '../flights/findAirportPoi';
import { parseDepartureMsFromText } from '../notifications/reminderMath';
import { assessTimeBuffer } from '../planning/timeBufferPolicy';
import { fetchFlightByIdent, hasFlightAwareKey } from '../flights/FlightTrackingService';
import { extractFlightCode } from '../flights/flightAdvisor';
import { suggestNearbyUnvisited } from '../research/poiDiscoveryResearch';
import { geocodePlaceName, searchOpenPlacesAhead, hasGoogleMapsNavKey } from '../navigation/googleMapsNav';
import { getCachedUserProfile } from '../userProfileService';

export type SideTripRisk = 'green' | 'yellow' | 'red';

export type ResolvedSideTripPoi = {
  name: string;
  lat: number;
  lng: number;
  poiId: number | null;
  distanceM: number;
  walkOutMin: number;
  source: 'pack' | 'geocode' | 'places';
};

export type FlightDeadlineContext = {
  departureMs: number;
  departureLabel: string;
  leaveByMs: number;
  leaveByLabel: string;
  airportWalkMin: number;
  airportName: string | null;
  delayMin: number;
  source: 'session' | 'memory' | 'parsed';
};

export type SideTripFeasibilityResult = {
  risk: SideTripRisk;
  destination: ResolvedSideTripPoi | null;
  /** Mehrere Treffer — Rückfrage nötig */
  disambiguation: Array<{ name: string; distanceM: number; poiId: number | null }> | null;
  dwellMin: number;
  walkOutMin: number;
  walkBackMin: number;
  totalNeededMin: number;
  availableMin: number;
  bufferMin: number;
  deadline: FlightDeadlineContext;
  alternatives: Array<{ name: string; distanceM: number; poiId: number }>;
  promptBlock: string;
  response: GeminiConciergeResponse;
};

const SIDE_TRIP_RE =
  /\b(schaff(?:e|st|en)?\s+(?:ich\s+)?(?:das\s+)?(?:noch|irgendwie)|noch\s+(?:schnell\s+)?(?:zum|zur|an\s+den|an\s+die|den|die|ins|in\s+die)|vor\s+(?:dem|meinem)\s+flug|bevor\s+(?:ich\s+)?flieg|vor\s+(?:dem|meinem)\s+flieger|reicht\s+(?:die\s+)?zeit|noch\s+zeit\s+für|kurz\s+noch)\b/iu;

const POI_HINT_RE =
  /\b(leuchtturm|friedhof|grabstätte|grabstaette|strand|museum|kirche|schloss|denkmal|aussicht|hafen|mole|düne|duene|leuchtturm|westturm|ostturm)\b/iu;

const DEFAULT_DWELL_MIN = 20;
const BUFFER_GREEN_MIN = 25;
const BUFFER_YELLOW_MIN = 12;

export function isPreFlightSideTripQuery(text: string): boolean {
  const t = text.replace(/\s+/g, ' ').trim();
  if (!t) return false;
  if (SIDE_TRIP_RE.test(t)) return true;
  // „Leuchtturm vor dem Flug“ / „schaffe ich den Leuchtturm“
  if (POI_HINT_RE.test(t) && /\b(flug|flieger|abflug|noch|schaff|reicht|vorher)\b/iu.test(t)) {
    return true;
  }
  return false;
}

function formatClock(ms: number): string {
  try {
    return new Date(ms).toLocaleTimeString('de-DE', {
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}

function parseHmToday(label: string, nowMs: number): number | null {
  const m = label.match(/(\d{1,2})[:.](\d{2})/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  const d = new Date(nowMs);
  d.setHours(h, min, 0, 0);
  if (d.getTime() < nowMs - 2 * 60_000) d.setDate(d.getDate() + 1);
  return d.getTime();
}

/** Flug-Deadline aus Session-Plan, Open-Question-Fakten oder Chat. */
export async function resolveFlightDeadlineContext(
  nowMs: number = Date.now(),
): Promise<FlightDeadlineContext | null> {
  await useSessionPlanStore.getState().hydrate();
  await useOpenQuestionStore.getState().hydrate();

  const facts = useOpenQuestionStore.getState().userFacts;
  const plan = useSessionPlanStore.getState().getActivePlan();
  const store = useFinnusStore.getState();

  let departureMs: number | null = null;
  let leaveByMs: number | null = null;
  let source: FlightDeadlineContext['source'] = 'parsed';

  const depFact = facts.find((f) => f.key === 'flug_abflug')?.value;
  const leaveFact = facts.find((f) => f.key === 'flug_leave_by')?.value;

  if (depFact) {
    departureMs = parseHmToday(depFact, nowMs) ?? parseDepartureMsFromText(depFact, nowMs);
    source = 'memory';
  }
  if (leaveFact) {
    leaveByMs = parseHmToday(leaveFact, nowMs);
    source = 'memory';
  }

  if (plan?.active) {
    if (plan.leaveByMs != null) leaveByMs = plan.leaveByMs;
    const airportStop = plan.stops.find(
      (s) => s.kind === 'fixed' && /flug|airport|flugplatz/i.test(s.label),
    );
    if (airportStop?.arriveByMs != null) {
      departureMs = airportStop.arriveByMs;
    }
    if (plan.leaveByMs || airportStop) source = 'session';
  }

  // Chat-Fallback
  if (!departureMs) {
    const blob = store.chatHistory
      .slice(-8)
      .map((m) => m.content)
      .join(' ');
    departureMs = parseDepartureMsFromText(blob, nowMs);
  }

  if (!departureMs) return null;

  const hotel = useUserMemoryStore.getState().getConfirmedHotel();
  const userLat = store.lastGpsLat ?? hotel?.lat ?? null;
  const userLng = store.lastGpsLng ?? hotel?.lng ?? null;

  const airport = await findAirportPoi({
    lat: userLat,
    lng: userLng,
  });

  let airportWalkMin = 15;
  if (airport && userLat != null && userLng != null) {
    const eta = estimateTravelEta({
      userLat,
      userLng,
      destLat: airport.lat,
      destLng: airport.lng,
      destName: airport.name,
    });
    airportWalkMin = eta.totalMinutes;
  }

  const arriveEarlyMin = assessTimeBuffer({ kind: 'flight_island' }).minutes;
  if (!leaveByMs) {
    leaveByMs = departureMs - (airportWalkMin + arriveEarlyMin) * 60_000;
  }

  const delayMin = await resolveFlightDelayMinutes(nowMs, departureMs);

  return {
    departureMs: departureMs + delayMin * 60_000,
    departureLabel: formatClock(departureMs + delayMin * 60_000),
    leaveByMs: leaveByMs + delayMin * 60_000,
    leaveByLabel: formatClock(leaveByMs + delayMin * 60_000),
    airportWalkMin,
    airportName: airport?.name ?? null,
    delayMin,
    source,
  };
}

async function resolveFlightDelayMinutes(
  nowMs: number,
  departureMs: number,
): Promise<number> {
  const chat = useFinnusStore
    .getState()
    .chatHistory.slice(-10)
    .map((m) => m.content)
    .join(' ');
  const code = extractFlightCode(chat, { requireContext: true });
  if (code && hasFlightAwareKey()) {
    try {
      const status = await fetchFlightByIdent(code);
      if (status?.delayMin != null && status.delayMin > 0) {
        return status.delayMin;
      }
    } catch {
      /* soft */
    }
  }
  // Inselflieger: kein Live-Delay ohne Slot-API — ehrlich 0
  return 0;
}

function extractPoiQuery(text: string): string | null {
  const t = text.replace(/\s+/g, ' ').trim();
  const m1 = t.match(
    /\b(?:zum|zur|an\s+den|an\s+die|den|die|ins|in\s+die)\s+([A-ZÄÖÜa-zäöüß][\wäöüß\- ]{2,40}?)(?:\s+(?:noch|vor|bevor|schaff)|[?.!]|$)/iu,
  );
  if (m1?.[1]) return m1[1].trim();
  const m2 = t.match(POI_HINT_RE);
  if (m2?.[0]) return m2[0].trim();
  return null;
}

function poiMatchesQuery(poi: Poi, query: string): boolean {
  const q = query.toLowerCase();
  const blob = `${poi.name} ${poi.category ?? ''} ${poi.spot_key ?? ''} ${poi.tags_json ?? ''}`.toLowerCase();
  return blob.includes(q) || q.split(/\s+/).every((w) => w.length > 2 && blob.includes(w));
}

/** Pack-POIs für Side-Trip — ggf. mehrere Treffer. */
export async function resolveSideTripCandidates(
  query: string,
  origin: { lat: number; lng: number },
): Promise<ResolvedSideTripPoi[]> {
  const pois = await getAllPois();
  const matches: ResolvedSideTripPoi[] = [];

  for (const p of pois) {
    if (p.kind === 'approach') continue;
    if (!poiMatchesQuery(p, query)) continue;
    const d = haversineMeters(origin.lat, origin.lng, p.lat, p.lng);
    if (d > 8000) continue;
    const eta = estimateTravelEta({
      userLat: origin.lat,
      userLng: origin.lng,
      destLat: p.lat,
      destLng: p.lng,
      destName: p.name,
    });
    matches.push({
      name: p.name.replace(/\s*[·•|]\s*Wegweiser\s*$/i, '').trim(),
      lat: p.lat,
      lng: p.lng,
      poiId: p.id,
      distanceM: Math.round(d),
      walkOutMin: eta.totalMinutes,
      source: 'pack',
    });
  }

  matches.sort((a, b) => a.distanceM - b.distanceM);
  return matches;
}

async function resolveSingleSideTripPoi(
  query: string,
  origin: { lat: number; lng: number },
): Promise<ResolvedSideTripPoi | null> {
  const candidates = await resolveSideTripCandidates(query, origin);
  if (candidates.length === 1) return candidates[0];
  if (candidates.length > 1) return null;

  const profile = getCachedUserProfile();
  if (hasGoogleMapsNavKey()) {
    try {
      const places = await searchOpenPlacesAhead({
        lat: origin.lat,
        lng: origin.lng,
        placeType: 'tourist_attraction',
        radiusM: 4000,
        openNow: false,
      });
      const lower = query.toLowerCase();
      const hit =
        places.find((p) => p.name.toLowerCase().includes(lower)) ?? places[0];
      if (hit) {
        const d = haversineMeters(origin.lat, origin.lng, hit.lat, hit.lng);
        const eta = estimateTravelEta({
          userLat: origin.lat,
          userLng: origin.lng,
          destLat: hit.lat,
          destLng: hit.lng,
          destName: hit.name,
        });
        return {
          name: hit.name,
          lat: hit.lat,
          lng: hit.lng,
          poiId: null,
          distanceM: Math.round(d),
          walkOutMin: eta.totalMinutes,
          source: 'places',
        };
      }
    } catch {
      /* soft */
    }
  }

  try {
    const geo = await geocodePlaceName(query, {
      biasLat: origin.lat,
      biasLng: origin.lng,
      cityHint: profile?.cityName ?? null,
    });
    if (geo) {
      const d = haversineMeters(origin.lat, origin.lng, geo.lat, geo.lng);
      const eta = estimateTravelEta({
        userLat: origin.lat,
        userLng: origin.lng,
        destLat: geo.lat,
        destLng: geo.lng,
        destName: geo.label,
      });
      return {
        name: geo.label.split(',')[0]?.trim() || query,
        lat: geo.lat,
        lng: geo.lng,
        poiId: null,
        distanceM: Math.round(d),
        walkOutMin: eta.totalMinutes,
        source: 'geocode',
      };
    }
  } catch {
    /* soft */
  }

  return null;
}

function assessRisk(bufferMin: number): SideTripRisk {
  if (bufferMin >= BUFFER_GREEN_MIN) return 'green';
  if (bufferMin >= BUFFER_YELLOW_MIN) return 'yellow';
  return 'red';
}

function buildDisambiguationResponse(
  query: string,
  candidates: ResolvedSideTripPoi[],
  deadline: FlightDeadlineContext,
): SideTripFeasibilityResult {
  const list = candidates.slice(0, 4).map((c) => ({
    name: c.name,
    distanceM: c.distanceM,
    poiId: c.poiId,
  }));
  const speech =
    `Welchen ${query} meinst du genau? Ich hab ${list.length} Treffer — ` +
    list.map((c) => `${c.name} (${Math.round(c.distanceM / 100) / 10} km)`).join(', ') +
    `. Dein Flug ist um ${deadline.departureLabel} Uhr — sag mir welchen, dann rechne ich's durch.`;

  return {
    risk: 'yellow',
    destination: null,
    disambiguation: list,
    dwellMin: DEFAULT_DWELL_MIN,
    walkOutMin: 0,
    walkBackMin: 0,
    totalNeededMin: 0,
    availableMin: 0,
    bufferMin: 0,
    deadline,
    alternatives: [],
    promptBlock: `=== SIDE-TRIP DISAMBIGUATION ===\nOptionen: ${list.map((l) => l.name).join(' · ')}`,
    response: {
      speechText: speech,
      visualBullets: [
        `Flug ${deadline.departureLabel}`,
        `Los spätestens ${deadline.leaveByLabel}`,
        `${list.length} ${query}-Treffer`,
      ],
      quickActions: list.slice(0, 2).map((c) => ({
        type: 'SHOW_MORE' as const,
        label: `📍 ${c.name}`,
        payload: {
          textPrompt: `Ich meine ${c.name} — schaffe ich das noch vor meinem Flug um ${deadline.departureLabel}?`,
        },
      })),
      cardTitle: 'Welcher Ort?',
    },
  };
}

function buildFeasibilityResponse(input: {
  risk: SideTripRisk;
  destination: ResolvedSideTripPoi;
  dwellMin: number;
  walkOutMin: number;
  walkBackMin: number;
  totalNeededMin: number;
  availableMin: number;
  bufferMin: number;
  deadline: FlightDeadlineContext;
  alternatives: Array<{ name: string; distanceM: number; poiId: number; lat?: number; lng?: number }>;
}): SideTripFeasibilityResult {
  const {
    risk,
    destination,
    dwellMin,
    walkOutMin,
    walkBackMin,
    totalNeededMin,
    availableMin,
    bufferMin,
    deadline,
    alternatives,
  } = input;

  const distKm = (destination.distanceM / 1000).toFixed(1);
  const delayNote =
    deadline.delayMin > 0
      ? ` Dein Flug hat ${deadline.delayMin} Min Verspätung — du hast mehr Luft.`
      : '';

  let speech: string;
  if (risk === 'green') {
    speech =
      `Ja, ${destination.name} geht noch — ${distKm} km, etwa ${walkOutMin} Min hin. ` +
      `Mit ${dwellMin} Min dort und ${walkBackMin} Min zurück hast du noch ${bufferMin} Min Puffer bis du spätestens um ${deadline.leaveByLabel} los musst.${delayNote} Soll ich die Route starten?`;
  } else if (risk === 'yellow') {
    speech =
      `${destination.name} ist machbar, aber knapp: ${walkOutMin} Min hin, ${dwellMin} Min Aufenthalt, ${walkBackMin} Min zurück — nur ${bufferMin} Min Puffer bis ${deadline.leaveByLabel}.${delayNote} Nicht verlaufen, nicht trödeln. Ich kann die Navigation starten, wenn du willst.`;
  } else {
    speech =
      `Ehrlich: ${destination.name} ist ziemlich riskant.${delayNote} ` +
      `${walkOutMin} Min hin, ${dwellMin} Min dort, ${walkBackMin} Min zurück — nur ${bufferMin} Min Puffer bis du um ${deadline.leaveByLabel} los musst (Flug ${deadline.departureLabel}). ` +
      `Nicht verlaufen, nicht trödeln — sehr knapp kalkuliert. Wenn du es trotzdem willst, starte ich die Route. Sonst: Alternativen unten.`;
  }

  const bullets = [
    `${destination.name}: ~${walkOutMin} Min hin (${distKm} km)`,
    deadline.airportName
      ? `${deadline.airportName}: ~${deadline.airportWalkMin} Min zum Flugplatz`
      : `Flugplatz: ~${deadline.airportWalkMin} Min`,
    `Aufenthalt ~${dwellMin} Min · Puffer ${bufferMin} Min`,
    `Los spätestens ${deadline.leaveByLabel} · Flug ${deadline.departureLabel}`,
    deadline.delayMin > 0 ? `Verspätung +${deadline.delayMin} Min` : null,
  ].filter(Boolean) as string[];

  const quickActions: QuickAction[] = [];

  if (risk !== 'red' || bufferMin >= 5) {
    quickActions.push({
      type: 'START_NAVIGATION',
      label: `📍 Route ${destination.name}`,
      payload: {
        destLat: destination.lat,
        destLng: destination.lng,
        destName: destination.name,
        targetPoiId: destination.poiId ?? undefined,
      },
    });
  } else {
    quickActions.push({
      type: 'START_NAVIGATION',
      label: `⚠️ Route ${destination.name} (knapp)`,
      payload: {
        destLat: destination.lat,
        destLng: destination.lng,
        destName: destination.name,
        targetPoiId: destination.poiId ?? undefined,
      },
    });
  }

  if (alternatives[0]) {
    const alt = alternatives[0];
    if (alt.lat != null && alt.lng != null) {
      quickActions.push({
        type: 'START_NAVIGATION',
        label: `✨ ${alt.name}`,
        payload: {
          destLat: alt.lat,
          destLng: alt.lng,
          destName: alt.name,
          targetPoiId: alt.poiId,
        },
      });
    } else {
      quickActions.push({
        type: 'SHOW_MORE',
        label: `✨ ${alt.name}`,
        payload: {
          textPrompt: `Route zu ${alt.name} — passt vor meinem Flug um ${deadline.departureLabel}?`,
        },
      });
    }
  }

  quickActions.push({
    type: 'SHOW_MORE',
    label: '🍽 Entspannt essen',
    payload: {
      textPrompt: `Ich habe wenig Zeit vor dem Flug um ${deadline.departureLabel} — wo kann ich entspannt essen in der Nähe?`,
    },
  });

  const promptBlock = [
    '=== SIDE-TRIP FEASIBILITY (VERIFIZIERT) ===',
    `Ziel: ${destination.name} (${destination.distanceM} m, ${walkOutMin} Min hin)`,
    `Rückweg: ${walkBackMin} Min · Aufenthalt: ${dwellMin} Min · Gesamt: ${totalNeededMin} Min`,
    `Verfügbar bis Leave-by: ${availableMin} Min · Puffer: ${bufferMin} Min`,
    `Risiko: ${risk.toUpperCase()}`,
    `Flug ${deadline.departureLabel} · Leave-by ${deadline.leaveByLabel}`,
    deadline.delayMin > 0 ? `Verspätung: ${deadline.delayMin} Min` : '',
    alternatives.length
      ? `Alternativen: ${alternatives.map((a) => a.name).join(' · ')}`
      : '',
  ]
    .filter(Boolean)
    .join('\n');

  return {
    risk,
    destination,
    disambiguation: null,
    dwellMin,
    walkOutMin,
    walkBackMin,
    totalNeededMin,
    availableMin,
    bufferMin,
    deadline,
    alternatives,
    promptBlock,
    response: {
      speechText: speech,
      visualBullets: bullets.slice(0, 3),
      quickActions: quickActions.slice(0, 4),
      cardTitle: risk === 'red' ? 'Knapp vor dem Flug' : 'Side-Trip Check',
    },
  };
}

/**
 * Vollständiger Side-Trip-Feasibility-Lauf.
 */
export async function runPreFlightSideTripFeasibility(
  userText: string,
  opts?: { nowMs?: number; dwellMin?: number; explicitPoiName?: string },
): Promise<SideTripFeasibilityResult | null> {
  const nowMs = opts?.nowMs ?? Date.now();
  const dwellMin = opts?.dwellMin ?? DEFAULT_DWELL_MIN;

  const explicitFromText = userText.match(
    /\bich\s+meine\s+(.+?)(?:\s+—|\s+-|\?|\.|$)/iu,
  )?.[1]?.trim();

  const deadline = await resolveFlightDeadlineContext(nowMs);
  if (!deadline) return null;

  const store = useFinnusStore.getState();
  const lat = store.lastGpsLat;
  const lng = store.lastGpsLng;
  if (lat == null || lng == null) return null;

  const query =
    opts?.explicitPoiName?.trim() ||
    explicitFromText ||
    extractPoiQuery(userText) ||
    'Sehenswürdigkeit';

  const candidates = await resolveSideTripCandidates(query, { lat, lng });
  if (candidates.length > 1 && !opts?.explicitPoiName && !explicitFromText) {
    return buildDisambiguationResponse(query, candidates, deadline);
  }

  const destination =
    candidates[0] ?? (await resolveSingleSideTripPoi(query, { lat, lng }));
  if (!destination) {
    return {
      risk: 'yellow',
      destination: null,
      disambiguation: null,
      dwellMin,
      walkOutMin: 0,
      walkBackMin: 0,
      totalNeededMin: 0,
      availableMin: 0,
      bufferMin: 0,
      deadline,
      alternatives: [],
      promptBlock: `=== SIDE-TRIP ===\nOrt „${query}“ nicht gefunden.`,
      response: {
        speechText: `Ich finde „${query}“ gerade nicht in der Nähe. Meinst du einen bestimmten Ort — oder soll ich dir unbesuchte Highlights vorschlagen? Flug ist um ${deadline.departureLabel}, los spätestens ${deadline.leaveByLabel}.`,
        visualBullets: [`Flug ${deadline.departureLabel}`, `Leave-by ${deadline.leaveByLabel}`],
        quickActions: [],
        cardTitle: 'Ort unklar',
      },
    };
  }

  const walkOutMin = destination.walkOutMin;
  const backEta = estimateTravelEta({
    userLat: destination.lat,
    userLng: destination.lng,
    destLat: lat,
    destLng: lng,
    destName: 'Start',
  });
  const walkBackMin = backEta.totalMinutes;
  const totalNeededMin = walkOutMin + dwellMin + walkBackMin;
  const availableMin = Math.max(
    0,
    Math.floor((deadline.leaveByMs - nowMs) / 60_000),
  );
  const bufferMin = availableMin - totalNeededMin;
  const risk = assessRisk(bufferMin);

  const alternativesRaw = await suggestNearbyUnvisited(lat, lng, 4);
  const pois = await getAllPois();
  const filteredAlts = alternativesRaw
    .filter(
      (a) =>
        a.poiId !== destination.poiId &&
        !a.name
          .toLowerCase()
          .includes(destination.name.toLowerCase().slice(0, 8)),
    )
    .slice(0, 2)
    .map((a) => {
      const p = pois.find((x) => x.id === a.poiId);
      return {
        ...a,
        lat: p?.lat,
        lng: p?.lng,
      };
    });

  return buildFeasibilityResponse({
    risk,
    destination,
    dwellMin,
    walkOutMin,
    walkBackMin,
    totalNeededMin,
    availableMin,
    bufferMin,
    deadline,
    alternatives: filteredAlts,
  });
}
