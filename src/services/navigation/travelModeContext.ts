/**
 * Session-Transportmodus: Zu Fuß / Zweirad / Öffis.
 * Override → Profil → GPS-Geschwindigkeit.
 * Explizites Bike-Mode: sticky 10 Min, dann GPS-Recheck (Masterbook V5).
 */

import { useFinnusStore } from '../../store/useFinnusStore';
import type { MobilityMode } from '../../types/userProfile';
import { getCachedUserProfile } from '../userProfileService';
import { resolvePersonaEngine } from '../personaEngine';
import {
  directionsModeForNav,
  getSmoothedSpeedMs,
} from '../navigation/transportMode';
import type { PedestrianTravelMode } from '../navigation/googleMapsNav';

/** Die drei primären Travel-Modes für UI & Routing. */
export type TravelMode = 'foot' | 'bike' | 'transit';

export const TRAVEL_MODE_OPTIONS: Array<{
  id: TravelMode;
  label: string;
  hint: string;
}> = [
  { id: 'foot', label: 'Zu Fuß', hint: 'Gehen' },
  { id: 'bike', label: 'Zweirad', hint: 'Rad / E-Scooter' },
  { id: 'transit', label: 'Öffis', hint: 'Bahn, Bus, Tram' },
];

/** Masterbook: after explicit bike/foot claim, re-evaluate GPS after 10 min. */
const STICKY_RECHECK_MS = 10 * 60_000;

let stickyForcedAtMs = 0;
let stickyRecheckTimer: ReturnType<typeof setTimeout> | null = null;

export function mobilityToTravelMode(
  m: MobilityMode | null | undefined,
): TravelMode | null {
  if (m === 'foot') return 'foot';
  if (m === 'bike') return 'bike';
  if (m === 'public_transit') return 'transit';
  return null;
}

export function travelModeToMobility(m: TravelMode): MobilityMode {
  if (m === 'bike') return 'bike';
  if (m === 'transit') return 'public_transit';
  return 'foot';
}

/**
 * Inferiert Modus aus GPS-Geschwindigkeit (m/s).
 * ≥ ~9 km/h → Zweirad, ≥ ~22 km/h → ÖPNV, sonst Fuß.
 */
export function inferTravelModeFromSpeed(speedMs: number | null): TravelMode {
  if (speedMs == null || !Number.isFinite(speedMs)) return 'foot';
  if (speedMs >= 6.1) return 'transit'; // ~22 km/h
  // Align mit transportMode SPEED_WALK_MAX_MS (~10 km/h)
  if (speedMs >= 2.78) return 'bike';
  return 'foot';
}

function clearStickyRecheckTimer(): void {
  if (stickyRecheckTimer) {
    clearTimeout(stickyRecheckTimer);
    stickyRecheckTimer = null;
  }
}

/**
 * After sticky window: if GPS speed disagrees with forced bike/foot, clear override.
 */
function recheckStickyTravelMode(): void {
  stickyRecheckTimer = null;
  const session = useFinnusStore.getState().preferredTravelMode;
  if (session !== 'bike' && session !== 'foot') return;
  if (Date.now() - stickyForcedAtMs < STICKY_RECHECK_MS - 1_000) return;

  const speed = getSmoothedSpeedMs();
  const inferred = inferTravelModeFromSpeed(speed);
  // Still matching → keep sticky another window
  if (inferred === session) {
    stickyForcedAtMs = Date.now();
    stickyRecheckTimer = setTimeout(recheckStickyTravelMode, STICKY_RECHECK_MS);
    return;
  }
  // User switched (e.g. bike → walk): clear session override
  useFinnusStore.getState().setPreferredTravelMode(null);
  stickyForcedAtMs = 0;
}

/**
 * Aktiver Modus: Session-Override → Profil → GPS.
 */
export function resolveActiveTravelMode(): {
  mode: TravelMode;
  source: 'session' | 'profile' | 'speed' | 'default';
  explicit: boolean;
} {
  const session = useFinnusStore.getState().preferredTravelMode;
  if (session === 'foot' || session === 'bike' || session === 'transit') {
    return { mode: session, source: 'session', explicit: true };
  }

  const profile = getCachedUserProfile();
  const mobility = resolvePersonaEngine(profile).mobilityMode;
  const fromProfile = mobilityToTravelMode(mobility);
  if (fromProfile) {
    return { mode: fromProfile, source: 'profile', explicit: true };
  }

  const speed = getSmoothedSpeedMs();
  if (speed != null && speed > 0.5) {
    return {
      mode: inferTravelModeFromSpeed(speed),
      source: 'speed',
      explicit: false,
    };
  }

  return { mode: 'foot', source: 'default', explicit: false };
}

export function setPreferredTravelMode(mode: TravelMode | null): void {
  useFinnusStore.getState().setPreferredTravelMode(mode);
  clearStickyRecheckTimer();
  if (mode === 'bike' || mode === 'foot') {
    stickyForcedAtMs = Date.now();
    stickyRecheckTimer = setTimeout(recheckStickyTravelMode, STICKY_RECHECK_MS);
  } else {
    stickyForcedAtMs = 0;
  }
}

/**
 * Voice: „Ich bin mit dem Fahrrad unterwegs“ → force bike + 10-min GPS recheck.
 */
export function forceBikeModeFromVoice(): void {
  setPreferredTravelMode('bike');
}

/** Detect explicit bike / foot claims in user speech. */
export function detectTravelModeVoiceOverride(text: string): TravelMode | null {
  const t = text.trim().toLowerCase();
  if (
    /\b(ich\s+bin\s+)?(mit\s+dem\s+)?(fahrrad|rad|bike|e-?bike|e-?scooter|roller)\s*(unterwegs|unter\s*wegs)?\b/i.test(
      t,
    ) ||
    /\b(ich\s+)?(fahr|fahre|radel|radele)\s+(mit\s+dem\s+)?(rad|fahrrad|bike)\b/i.test(
      t,
    ) ||
    // „wie lange mit dem Fahrrad nach …“ / „Fahrrad nach Uetersen“
    (/\b(fahrrad|radeln|radele|e-?bike|bike|mit\s+dem\s+rad)\b/i.test(t) &&
      /\b(nach|zu|wie\s+lange|brauch|dauer|minuten|route|weg)\b/i.test(t))
  ) {
    return 'bike';
  }
  if (
    /\b(ich\s+bin\s+)?(zu\s+fu[sß]|zu\s*fuss|laufend|zu\s+fuße)\s*(unterwegs)?\b/i.test(
      t,
    ) ||
    /\bich\s+(geh|gehe|laufe|lauf)\s+(zu\s+fu[sß]|jetzt)\b/i.test(t) ||
    (/\b(zu\s+fu[sß]|zu\s*fuss|laufen|gehend)\b/i.test(t) &&
      /\b(nach|zu|wie\s+lange|brauch|dauer|minuten|route|weg)\b/i.test(t))
  ) {
    return 'foot';
  }
  return null;
}

export function travelModeToDirectionsMode(
  mode?: TravelMode | null,
): PedestrianTravelMode {
  const m = mode ?? resolveActiveTravelMode().mode;
  if (m === 'bike') return 'bicycling';
  if (m === 'transit') return 'transit';
  return 'walking';
}

export const CRUTCH_MAX_WALK_MIN = 7;
/** ~80 m/Min Fuß. */
export const CRUTCH_MAX_WALK_M = CRUTCH_MAX_WALK_MIN * 80;

/** Für navigationService preferTransit / preferBike. */
export function travelModeNavPrefs(
  mode?: TravelMode | null,
  opts?: { walkDistanceM?: number | null },
): {
  preferTransit: boolean;
  preferBike: boolean;
} {
  const m = mode ?? resolveActiveTravelMode().mode;
  let preferTransit = m === 'transit';
  try {
    const access = getCachedUserProfile()?.accessibility ?? [];
    if (access.includes('rollstuhl')) preferTransit = true;
    if (
      access.includes('kruecke') &&
      typeof opts?.walkDistanceM === 'number' &&
      opts.walkDistanceM > CRUTCH_MAX_WALK_M
    ) {
      preferTransit = true;
    }
  } catch {
    /* soft */
  }
  return {
    preferTransit,
    preferBike: m === 'bike',
  };
}

/** Prompt-Block für AI Voice Engine. */
export function buildTravelModePromptBlock(): string {
  const { mode, source, explicit } = resolveActiveTravelMode();
  const label =
    TRAVEL_MODE_OPTIONS.find((o) => o.id === mode)?.label ?? mode;
  const dirs = directionsModeForNav(travelModeNavPrefs(mode));
  const ask =
    !explicit
      ? 'Modus nicht explizit gesetzt — kurz nachfragen ODER anhand Tempo/Distanz annehmen.'
      : 'Modus explizit gesetzt — Routing & Tipps daran ausrichten.';

  return `
=== TRANSPORTMODUS (PFLICHT) ===
Aktiv: ${label} (${mode}) — Quelle: ${source}
Directions-Mode: ${dirs}
${ask}
- foot: Fußwege, keine Rad-Infra, ÖPNV nur auf Nachfrage.
- bike: Rad/E-Scooter, Radwege ok, kurze Strecken, keine Autofahrten.
- transit: Öffis priorisieren, Live-Verspätungen & Puffer nennen.

=== NAVI-STIMME (Human Co-Pilot) ===
- Alltagssprache (du, jo, schau mal, pass auf, gleich) — wie ein Freund neben dem User.
- Landmarke ZUERST, dann Aktion. Nie „in X Metern links abbiegen“, nie Himmelsrichtungen/Grad.
- Max. 1–2 kurze Sätze. Bei Schlenker: „Sollen wir da kurz einen Schlenker machen?“
`.trim();
}
