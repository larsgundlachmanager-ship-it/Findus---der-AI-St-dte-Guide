/**
 * Freihändige Landmarken-Navigation:
 * baut konkrete Sprach-Hinweise („an der Apotheke rechts …“)
 * aus Google Directions/Places/Street View + lokalen POIs.
 */

import { getAllPois } from '../../db/database';
import { env } from '../../config/env';
import { useFinnusStore } from '../../store/useFinnusStore';
import {
  speakAssistantText,
  getVoiceSettingsForTour,
  stopSpeaking,
} from '../ttsService';
import { GEMINI_API_BASE, GEMINI_MODEL } from '../../constants/gemini';
import {
  bearingDegrees,
  directionsToWaypoints,
  fetchNearbyPlaceLandmarks,
  fetchRouteDirections,
  fetchStreetViewImageBase64,
  hasGoogleMapsNavKey,
  reverseGeocodeStreet,
  streetViewAvailable,
  type PedestrianTravelMode,
  type PlaceLandmark,
} from './googleMapsNav';
import { distanceMeters } from './bearing';
import type { NavWaypoint, NavigationTick } from './navigationTypes';
import {
  estimateEtaMinutes,
  isTransitMode,
} from './transportMode';
import {
  markHandsFreeNavExplained,
  shouldExplainHandsFreeNav,
} from '../ai/featureTips';

type CoachSession = {
  destinationName: string;
  destLat: number;
  destLng: number;
  lastSpokenWpIndex: number;
  lastSpokenAt: number;
  openingSpoken: boolean;
  enrichEpoch: number;
  /** Letzte gesprochene ETA (Minuten), für Tempo-Hinweise. */
  lastEtaSpokenMin: number | null;
  lastEtaSpokenAt: number;
};

let session: CoachSession | null = null;
let enrichEpoch = 0;

const MIN_SPEAK_GAP_MS = 7_000;
const TURN_SPEAK_M = 28;
/** ETA-Hinweis höchstens alle 3 Minuten, und nur wenn Tempo sinnvoll. */
const ETA_SPEAK_GAP_MS = 180_000;
const ETA_MIN_DISTANCE_M = 120;

function turnWordFromManeuver(maneuver: string | null | undefined): string {
  const m = (maneuver ?? '').toLowerCase();
  if (m.includes('sharp-left') || m.includes('sharp_left')) return 'scharf links';
  if (m.includes('sharp-right') || m.includes('sharp_right')) return 'scharf rechts';
  if (m.includes('slight-left') || m.includes('slight_left')) return 'leicht links';
  if (m.includes('slight-right') || m.includes('slight_right')) return 'leicht rechts';
  if (m.includes('left')) return 'links';
  if (m.includes('right')) return 'rechts';
  if (m.includes('uturn') || m.includes('u-turn')) return 'umdrehen';
  return 'geradeaus';
}

/**
 * Links/Rechts immer relativ zur Blickrichtung (bearingRelDeg),
 * nicht absolut zur Kartenroute — sonst irreführend wenn User falsch steht.
 */
function turnWord(
  maneuver: string | null | undefined,
  bearingRelDeg?: number,
): string {
  if (typeof bearingRelDeg === 'number' && Number.isFinite(bearingRelDeg)) {
    if (bearingRelDeg > 55) return 'scharf rechts';
    if (bearingRelDeg > 25) return 'rechts';
    if (bearingRelDeg < -55) return 'scharf links';
    if (bearingRelDeg < -25) return 'links';
    // Blickrichtung ≈ Ziel → Maneuver nur wenn keine klare Drehung nötig
    const fromRoute = turnWordFromManeuver(maneuver);
    if (fromRoute.includes('links') || fromRoute.includes('rechts')) {
      return 'geradeaus';
    }
    return fromRoute;
  }
  return turnWordFromManeuver(maneuver);
}

/** Vorbereiteten Cue an aktuelle Blickrichtung anpassen. */
function alignCueToHeading(cue: string, bearingRelDeg: number): string {
  const turn = turnWord(null, bearingRelDeg);
  if (turn === 'geradeaus') {
    return cue
      .replace(/\bscharf\s+links\b/giu, 'weiter')
      .replace(/\bscharf\s+rechts\b/giu, 'weiter')
      .replace(/\bleicht\s+links\b/giu, 'weiter')
      .replace(/\bleicht\s+rechts\b/giu, 'weiter')
      .replace(/\blinks\b/giu, 'geradeaus')
      .replace(/\brechts\b/giu, 'geradeaus');
  }
  const wantLeft = turn.includes('links');
  const wantRight = turn.includes('rechts');
  if (!wantLeft && !wantRight) return cue;
  let out = cue;
  if (wantLeft) {
    out = out
      .replace(/\bscharf\s+rechts\b/giu, 'scharf links')
      .replace(/\bleicht\s+rechts\b/giu, 'leicht links')
      .replace(/\brechts\b/giu, 'links');
  } else if (wantRight) {
    out = out
      .replace(/\bscharf\s+links\b/giu, 'scharf rechts')
      .replace(/\bleicht\s+links\b/giu, 'leicht rechts')
      .replace(/\blinks\b/giu, 'rechts');
  }
  return out;
}

function sideWord(bearingRelDeg: number): 'linken' | 'rechten' | 'vorderen' {
  if (bearingRelDeg > 25) return 'rechten';
  if (bearingRelDeg < -25) return 'linken';
  return 'vorderen';
}

function placeKindLabel(types: string[]): string | null {
  const blob = types.join(' ');
  if (/pharmacy|drugstore/.test(blob)) return 'Apotheke';
  if (/bakery/.test(blob)) return 'Bäckerei';
  if (/cafe|cafe/.test(blob)) return 'Café';
  if (/church/.test(blob)) return 'Kirche';
  if (/park/.test(blob)) return 'Park';
  if (/school/.test(blob)) return 'Schule';
  if (/post_office/.test(blob)) return 'Post';
  if (/supermarket|grocery/.test(blob)) return 'Supermarkt';
  if (/convenience_store/.test(blob)) return 'Kiosk';
  if (/florist/.test(blob)) return 'Blumenladen';
  if (/hair_care/.test(blob)) return 'Friseur';
  if (/restaurant|meal_takeaway/.test(blob)) return 'Lokal';
  if (/train_station|transit_station/.test(blob)) return 'Bahnhof';
  return null;
}

function formatLandmarkName(p: PlaceLandmark): string {
  const kind = placeKindLabel(p.types);
  const name = p.name.trim();
  if (kind && !name.toLowerCase().includes(kind.toLowerCase())) {
    return `der ${kind} ${name}`;
  }
  if (kind) return `die ${kind}`;
  return name.startsWith('der ') || name.startsWith('die ') || name.startsWith('das ')
    ? name
    : name;
}

async function describeStreetViewTurn(opts: {
  lat: number;
  lng: number;
  heading: number;
  turn: string;
  roadName: string | null;
  placeHint: string | null;
}): Promise<string | null> {
  const apiKey = env.geminiApiKey();
  if (!apiKey) return null;
  const ok = await streetViewAvailable(opts.lat, opts.lng);
  if (!ok) return null;
  const b64 = await fetchStreetViewImageBase64(opts.lat, opts.lng, opts.heading);
  if (!b64) return null;

  const prompt = `Du bist ein Fußgänger-Navi (zu Fuß / Rad / ÖPNV — kein Auto). Beschreibe in GENAU EINEM deutschen Satz eine konkrete Abbiege-Anweisung anhand des Street-View-Bildes.
Abbiegerichtung: ${opts.turn}.
${opts.roadName ? `Straße laut Karte: ${opts.roadName}.` : ''}
${opts.placeHint ? `Ort in der Nähe: ${opts.placeHint}.` : ''}
Regeln:
- Nenne sichtbare Landmarken (Farbe/Haus/Schild/Baum/Eingang/Gasse/Vordach) — keine abstrakten „jetzt rechts“.
- Stil: „Siehst du …? Direkt danach …“ oder „Hinter der weißen Hauswand …“.
- Kein Autoverkehr, keine Fahrbahn-/Autobahn-Sprache.
- Kein Markdown, keine Anführungszeichen, max. 28 Wörter.
- Wenn nichts Erkennbares: antworte nur mit NEIN.`;

  try {
    const url = `${GEMINI_API_BASE}/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [
              { text: prompt },
              {
                inline_data: {
                  mime_type: 'image/jpeg',
                  data: b64,
                },
              },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens: 80,
        },
      }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      candidates?: Array<{
        content?: { parts?: Array<{ text?: string }> };
      }>;
    };
    const text =
      data.candidates?.[0]?.content?.parts
        ?.map((p) => p.text ?? '')
        .join(' ')
        .trim() ?? '';
    if (!text || /^nein\b/i.test(text) || text.length < 12) return null;
    return text.replace(/^["„]|["“]$/g, '').trim();
  } catch {
    return null;
  }
}

function buildCueFromParts(opts: {
  turn: string;
  landmark: string | null;
  roadName: string | null;
  instruction: string | null;
  streetViewCue: string | null;
}): string {
  if (opts.streetViewCue) return opts.streetViewCue;

  const turn = opts.turn;
  if (opts.landmark && turn !== 'geradeaus') {
    const road = opts.roadName ? ` in die ${opts.roadName}` : '';
    return `Gleich an ${opts.landmark} ${turn} abbiegen${road}.`;
  }
  if (opts.landmark && turn === 'geradeaus') {
    return `Weiter geradeaus — du gehst an ${opts.landmark} vorbei.`;
  }
  if (opts.roadName && turn !== 'geradeaus') {
    return `Gleich ${turn} in die ${opts.roadName} abbiegen.`;
  }
  if (opts.instruction && opts.instruction.length > 8) {
    // Directions-Text ist oft schon brauchbar
    let t = opts.instruction;
    if (t.length > 110) t = `${t.slice(0, 100).trim()}…`;
    return t.endsWith('.') ? t : `${t}.`;
  }
  if (turn !== 'geradeaus') {
    return `Gleich ${turn} halten — schau nach einer klaren Abzweigung oder Gasse.`;
  }
  return 'Weiter geradeaus dem Weg folgen.';
}

async function resolveLocalPoiLandmark(
  lat: number,
  lng: number,
): Promise<string | null> {
  try {
    const pois = await getAllPois();
    let best: { name: string; d: number } | null = null;
    for (const p of pois) {
      if (p.kind === 'approach') continue;
      const d = distanceMeters(lat, lng, p.lat, p.lng);
      if (d > 55) continue;
      const name = p.name
        .replace(/\s*[·•|]\s*Wegweiser\s*$/i, '')
        .trim();
      if (name.length < 3) continue;
      if (!best || d < best.d) best = { name, d };
    }
    return best ? best.name : null;
  } catch {
    return null;
  }
}

async function enrichWaypoint(
  wp: NavWaypoint,
  prev: { lat: number; lng: number } | null,
): Promise<NavWaypoint> {
  const turn = turnWordFromManeuver(wp.maneuver);
  const heading = prev
    ? bearingDegrees(prev.lat, prev.lng, wp.lat, wp.lng)
    : 0;

  const [places, street, localName] = await Promise.all([
    fetchNearbyPlaceLandmarks(wp.lat, wp.lng, 50),
    wp.roadName
      ? Promise.resolve(wp.roadName)
      : reverseGeocodeStreet(wp.lat, wp.lng),
    resolveLocalPoiLandmark(wp.lat, wp.lng),
  ]);

  const top = places[0] ?? null;
  const landmark =
    localName ||
    (top ? formatLandmarkName(top) : null);

  let streetViewCue: string | null = null;
  // Nur bei echten Abbiegungen Street View + Vision (teuer)
  if (turn !== 'geradeaus' && hasGoogleMapsNavKey()) {
    streetViewCue = await describeStreetViewTurn({
      lat: wp.lat,
      lng: wp.lng,
      heading,
      turn,
      roadName: street ?? wp.roadName ?? null,
      placeHint: landmark,
    });
  }

  const cue = buildCueFromParts({
    turn,
    landmark,
    roadName: street ?? wp.roadName ?? null,
    instruction: wp.instruction ?? null,
    streetViewCue,
  });

  return {
    ...wp,
    roadName: street ?? wp.roadName ?? null,
    landmark,
    cue,
  };
}

/**
 * Session starten (vor Enrichment), damit Opening + Ticks greifen.
 */
export function beginLandmarkNavCoach(opts: {
  destinationName: string;
  destLat: number;
  destLng: number;
}): void {
  const myEpoch = ++enrichEpoch;
  session = {
    destinationName: opts.destinationName,
    destLat: opts.destLat,
    destLng: opts.destLng,
    lastSpokenWpIndex: -1,
    lastSpokenAt: 0,
    openingSpoken: false,
    enrichEpoch: myEpoch,
    lastEtaSpokenMin: null,
    lastEtaSpokenAt: 0,
  };
}

/**
 * Beim Nav-Start: Google-Route (Fuß/Rad/ÖPNV) + Landmarken vorbereiten.
 * Gibt angereicherte Waypoints zurück (oder null → Pack-Waypoints behalten).
 * Nie driving/Autoverkehr.
 */
export async function enrichNavigationRoute(opts: {
  originLat: number;
  originLng: number;
  destLat: number;
  destLng: number;
  destinationName: string;
  travelMode?: PedestrianTravelMode;
}): Promise<NavWaypoint[] | null> {
  if (!session || session.destLat !== opts.destLat || session.destLng !== opts.destLng) {
    beginLandmarkNavCoach({
      destinationName: opts.destinationName,
      destLat: opts.destLat,
      destLng: opts.destLng,
    });
  }
  const myEpoch = session!.enrichEpoch;

  if (!hasGoogleMapsNavKey()) {
    // Offline: lokale POI-Cues später on-the-fly
    return null;
  }

  const mode: PedestrianTravelMode =
    opts.travelMode === 'bicycling' || opts.travelMode === 'transit'
      ? opts.travelMode
      : 'walking';

  const steps = await fetchRouteDirections(
    { lat: opts.originLat, lng: opts.originLng },
    { lat: opts.destLat, lng: opts.destLng },
    mode,
  );
  if (!steps?.length || myEpoch !== enrichEpoch) return null;

  const raw = directionsToWaypoints(steps);
  // Max. 8 Abbiegungen mit Street-View anreichern, Rest nur Places/Straße
  const enriched: NavWaypoint[] = [];
  let prev: { lat: number; lng: number } | null = {
    lat: opts.originLat,
    lng: opts.originLng,
  };
  let visionBudget = 5;

  for (let i = 0; i < raw.length; i++) {
    if (myEpoch !== enrichEpoch) return null;
    const wp = raw[i];
    const isTurn = turnWordFromManeuver(wp.maneuver) !== 'geradeaus';
    if (isTurn && visionBudget > 0) {
      enriched.push(await enrichWaypoint(wp, prev));
      visionBudget -= 1;
    } else {
      // Schnell: Places + Straße ohne Vision
      const [places, street, localName] = await Promise.all([
        fetchNearbyPlaceLandmarks(wp.lat, wp.lng, 45),
        wp.roadName
          ? Promise.resolve(wp.roadName)
          : reverseGeocodeStreet(wp.lat, wp.lng),
        resolveLocalPoiLandmark(wp.lat, wp.lng),
      ]);
      const landmark =
        localName || (places[0] ? formatLandmarkName(places[0]) : null);
      const turn = turnWordFromManeuver(wp.maneuver);
      enriched.push({
        ...wp,
        roadName: street ?? wp.roadName ?? null,
        landmark,
        cue: buildCueFromParts({
          turn,
          landmark,
          roadName: street ?? wp.roadName ?? null,
          instruction: wp.instruction ?? null,
          streetViewCue: null,
        }),
      });
    }
    prev = { lat: wp.lat, lng: wp.lng };
  }

  return enriched.length ? enriched : null;
}

export function resetLandmarkNavCoach(): void {
  enrichEpoch += 1;
  session = null;
}

async function speakNav(text: string): Promise<void> {
  const trimmed = text.trim();
  if (!trimmed) return;
  const store = useFinnusStore.getState();
  // Keine Nav-Zwischenrufe während schwerer Generierung
  if (store.isGenerating) return;
  try {
    // Kurze Nav-Cues dürfen laufende Teaser unterbrechen — sonst verpasst man die Abbiegung
    if (store.isPlayingAudio) {
      await stopSpeaking();
    }
    const voice = await getVoiceSettingsForTour();
    await speakAssistantText(trimmed, {
      voiceId: voice.voiceId,
      speechRate: voice.speechRate,
    });
  } catch (err) {
    console.warn('[nav-coach] speak failed', err);
  }
}

export async function speakNavOpeningIfNeeded(
  destinationName: string,
): Promise<void> {
  if (!session || session.openingSpoken) return;
  session.openingSpoken = true;
  session.lastSpokenAt = Date.now();

  const explain = await shouldExplainHandsFreeNav();
  if (explain) {
    await markHandsFreeNavExplained();
    await speakNav(
      `Ich führ dich zu Fuß zu ${destinationName}. Du brauchst nicht aufs Display zu schauen — ` +
        `ich sag dir an Häusern, Läden und Abzweigungen, wo's langgeht.`,
    );
  } else {
    await speakNav(`Okay, ich führ dich zu ${destinationName}.`);
  }
}

/** Concierge/Voice hat schon eröffnet — kein zweites Intro. */
export function markNavOpeningSpoken(): void {
  if (session) session.openingSpoken = true;
}

/**
 * Bei jedem Nav-Tick: bei Abbiegung konkrete Landmarken-Anweisung sprechen.
 */
export function onNavigationTickForCoach(
  tick: NavigationTick,
  ctx: {
    waypointIndex: number;
    waypoints: NavWaypoint[];
  },
): void {
  if (!session) return;
  const now = Date.now();
  if (now - session.lastSpokenAt < MIN_SPEAK_GAP_MS) return;

  const wp =
    ctx.waypoints[
      Math.min(ctx.waypointIndex, Math.max(0, ctx.waypoints.length - 1))
    ];

  const nearTurn =
    tick.turnImminent ||
    (tick.distanceToArrowM <= TURN_SPEAK_M &&
      Math.abs(tick.bearingRelDeg) >= 35);

  if (!nearTurn || !wp) {
    // Ziel-Nähe: einmaliger Hinweis
    if (
      tick.distanceToDestinationM <= 35 &&
      tick.distanceToDestinationM > 8 &&
      session.lastSpokenWpIndex !== 9999
    ) {
      session.lastSpokenWpIndex = 9999;
      session.lastSpokenAt = now;
      const side = sideWord(tick.bearingRelDeg);
      void speakNav(
        `Gleich bist du da — ${session.destinationName} liegt auf deiner ${side} Seite.`,
      );
      return;
    }

    // Tempo-ETA: „bei dem Tempo noch ca. X Minuten“
    if (
      !isTransitMode(tick.transportMode) &&
      tick.distanceToDestinationM >= ETA_MIN_DISTANCE_M &&
      now - session.lastSpokenAt >= MIN_SPEAK_GAP_MS &&
      now - session.lastEtaSpokenAt >= ETA_SPEAK_GAP_MS
    ) {
      const eta = estimateEtaMinutes(
        tick.distanceToDestinationM,
        tick.speedMs,
        tick.transportMode,
      );
      if (
        eta != null &&
        eta >= 2 &&
        (session.lastEtaSpokenMin == null ||
          Math.abs(eta - session.lastEtaSpokenMin) >= 2)
      ) {
        session.lastEtaSpokenMin = eta;
        session.lastEtaSpokenAt = now;
        session.lastSpokenAt = now;
        void speakNav(`Bei dem Tempo noch ca. ${eta} Minuten.`);
      }
    }
    return;
  }

  if (session.lastSpokenWpIndex === ctx.waypointIndex) return;
  session.lastSpokenWpIndex = ctx.waypointIndex;
  session.lastSpokenAt = now;

  const turn = turnWord(wp.maneuver, tick.bearingRelDeg);
  const rawCue =
    wp.cue?.trim() ||
    buildCueFromParts({
      turn,
      landmark: wp.landmark ?? null,
      roadName: wp.roadName ?? null,
      instruction: wp.instruction ?? null,
      streetViewCue: null,
    });
  const cue = alignCueToHeading(rawCue, tick.bearingRelDeg);

  void speakNav(cue);

  // Parallel async: falls noch kein guter Cue, lokal nachschärfen
  if (!wp.cue && !wp.landmark) {
    void (async () => {
      const local = await resolveLocalPoiLandmark(wp.lat, wp.lng);
      if (!local || !session) return;
      if (session.lastSpokenWpIndex !== ctx.waypointIndex) return;
      const better = alignCueToHeading(
        buildCueFromParts({
          turn,
          landmark: local,
          roadName: wp.roadName ?? null,
          instruction: null,
          streetViewCue: null,
        }),
        tick.bearingRelDeg,
      );
      await speakNav(better);
    })();
  }
}
