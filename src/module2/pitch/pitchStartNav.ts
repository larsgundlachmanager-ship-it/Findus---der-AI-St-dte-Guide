/**
 * Pitch-Auswahl / Route-Button: Navigation starten.
 *
 * Explizite Wahl (preferWalk / preferTransit / preferBike) schlägt Auto-ÖPNV.
 * Ohne Flag: bei >~20 Min Fuß weiter ÖPNV zuerst (bestehende Pitch-Routen).
 */

import { haversineMeters } from '../../db/database';
import { PLAN_SOFT_MODE_MAX_MIN } from '../planning/planMobilityPolicy';
import { useFinnusStore } from '../../store/useFinnusStore';

export type PitchNavTarget = {
  name: string;
  lat: number;
  lng: number;
};

export type PitchNavIntent = {
  preferWalk?: boolean;
  preferTransit?: boolean;
  preferBike?: boolean;
};

export function pitchNavIntentFromPayload(payload: {
  preferWalk?: boolean;
  preferTransit?: boolean;
  preferBike?: boolean;
  journeyNav?: boolean;
  destName?: string;
  destLat?: number;
  destLng?: number;
} | undefined | null): PitchNavIntent {
  if (!payload) return {};
  return {
    preferWalk: payload.preferWalk === true,
    preferTransit:
      payload.preferTransit === true || payload.journeyNav === true,
    preferBike: payload.preferBike === true,
  };
}

function approxWalkMin(fromLat: number, fromLng: number, toLat: number, toLng: number): number {
  const distM = haversineMeters(fromLat, fromLng, toLat, toLng);
  if (!Number.isFinite(distM) || distM < 40) return 1;
  return Math.max(1, Math.round(distM / 80));
}

function clearLoadingIfIdle(): void {
  try {
    const st = useFinnusStore.getState();
    if (!st.navActive) st.setNavRouteLoading(false);
  } catch {
    /* soft */
  }
}

async function commitChosenWalkOrBike(
  target: PitchNavTarget,
  mode: 'foot' | 'bike',
): Promise<{ ok: boolean; message?: string }> {
  try {
    const { clearRememberedJourney } = require('../../services/navigation/journeyStartCache') as {
      clearRememberedJourney: () => void;
    };
    clearRememberedJourney();
  } catch {
    /* soft */
  }
  try {
    const { startHomeMapNavigation } = await import(
      '../../services/homeMap/homeMapNavStart'
    );
    const res = await startHomeMapNavigation(
      { name: target.name, lat: target.lat, lng: target.lng },
      undefined,
      { commitMode: mode },
    );
    if (res.ok) return { ok: true };
    return {
      ok: false,
      message: 'Route konnte nicht starten — bitte nochmal tippen.',
    };
  } catch (err) {
    clearLoadingIfIdle();
    return {
      ok: false,
      message:
        err instanceof Error
          ? err.message
          : 'Route konnte nicht starten — bitte nochmal tippen.',
    };
  }
}

async function commitChosenTransit(
  target: PitchNavTarget,
): Promise<{ ok: boolean; message?: string }> {
  const store = useFinnusStore.getState();
  store.setNavRouteLoading(true);

  try {
    try {
      const {
        peekRememberedJourney,
        takeRememberedJourney,
      } = require('../../services/navigation/journeyStartCache') as {
        peekRememberedJourney: () => {
          itinerary: unknown;
          destName: string;
          destLat: number;
          destLng: number;
        } | null;
        takeRememberedJourney: () => {
          itinerary: unknown;
          destName: string;
          destLat: number;
          destLng: number;
        } | null;
      };
      const remembered = peekRememberedJourney();
      if (
        remembered &&
        Math.abs(remembered.destLat - target.lat) < 0.008 &&
        Math.abs(remembered.destLng - target.lng) < 0.008
      ) {
        const { startJourneyNavigation } = require('../../services/navigation/startJourneyNavigation') as {
          startJourneyNavigation: (o: typeof remembered) => Promise<{
            ok: boolean;
            reply: string;
          }>;
        };
        takeRememberedJourney();
        const jr = await startJourneyNavigation(remembered);
        if (jr.ok) {
          try {
            const { useLivePitchStore } = require('./publishPitchUi') as {
              useLivePitchStore: { getState: () => { clear: (force?: boolean) => void } };
            };
            useLivePitchStore.getState().clear(true);
          } catch {
            /* soft */
          }
          try {
            const { enqueueSpeech } = require('../speech/speechQueue') as {
              enqueueSpeech: (j: { kind: string; text: string; turnId: string }) => void;
            };
            if (jr.reply?.trim()) {
              enqueueSpeech({
                kind: 'main',
                text: jr.reply.slice(0, 420),
                turnId: `journey_commit_${Date.now()}`,
              });
            }
          } catch {
            /* soft */
          }
          return { ok: true, message: jr.reply };
        }
      }
    } catch {
      /* fall through */
    }

    const fromLat = store.lastGpsLat;
    const fromLng = store.lastGpsLng;
    if (fromLat == null || fromLng == null) {
      return { ok: false, message: 'GPS hängt kurz — ÖPNV kann ich so nicht planen.' };
    }

    const { startTransitHandsFree } = await import(
      '../../services/navigation/handsFreeNav/transitBridge'
    );
    const tr = await startTransitHandsFree({
      from: { lat: fromLat, lng: fromLng },
      to: { lat: target.lat, lng: target.lng },
      destName: target.name,
    });
    if (tr.ok) {
      try {
        const { useLivePitchStore } = require('./publishPitchUi') as {
          useLivePitchStore: { getState: () => { clear: (force?: boolean) => void } };
        };
        useLivePitchStore.getState().clear(true);
      } catch {
        /* soft */
      }
      return { ok: true, message: tr.message };
    }
    return {
      ok: false,
      message: tr.message || 'Keine ÖPNV-Verbindung gefunden.',
    };
  } catch (err) {
    return {
      ok: false,
      message:
        err instanceof Error
          ? err.message
          : 'ÖPNV-Route konnte nicht starten — bitte nochmal tippen.',
    };
  } finally {
    try {
      useFinnusStore.getState().setNavRouteLoading(false);
    } catch {
      /* soft */
    }
  }
}

/**
 * Startet Route. Intent aus der gewählten Karte (Fuß / ÖPNV / Rad) hat Vorrang.
 */
export async function startPitchNavigation(
  target: PitchNavTarget,
  intent?: PitchNavIntent,
): Promise<{ ok: boolean; message?: string }> {
  const name = String(target.name ?? '').trim();
  const lat = target.lat;
  const lng = target.lng;
  if (
    !name ||
    !Number.isFinite(lat) ||
    !Number.isFinite(lng) ||
    (lat === 0 && lng === 0)
  ) {
    try {
      useFinnusStore.getState().setNavRouteLoading(false);
    } catch {
      /* soft */
    }
    return { ok: false, message: 'Für diesen Ort fehlen noch Koordinaten.' };
  }

  const store = useFinnusStore.getState();
  store.setNavRouteLoading(true);

  try {
    if (intent?.preferWalk) {
      return commitChosenWalkOrBike({ name, lat, lng }, 'foot');
    }
    if (intent?.preferBike) {
      return commitChosenWalkOrBike({ name, lat, lng }, 'bike');
    }
    if (intent?.preferTransit) {
      return commitChosenTransit({ name, lat, lng });
    }

    // Gecachte Journey vom Pitch/Event-ETA zuerst
    try {
      const {
        peekRememberedJourney,
        takeRememberedJourney,
      } = require('../../services/navigation/journeyStartCache') as {
        peekRememberedJourney: () => {
          itinerary: unknown;
          destName: string;
          destLat: number;
          destLng: number;
        } | null;
        takeRememberedJourney: () => {
          itinerary: unknown;
          destName: string;
          destLat: number;
          destLng: number;
        } | null;
      };
      const remembered = peekRememberedJourney();
      if (
        remembered &&
        Math.abs(remembered.destLat - lat) < 0.008 &&
        Math.abs(remembered.destLng - lng) < 0.008
      ) {
        const { startJourneyNavigation } = require('../../services/navigation/startJourneyNavigation') as {
          startJourneyNavigation: (o: typeof remembered) => Promise<{
            ok: boolean;
            reply: string;
          }>;
        };
        takeRememberedJourney();
        const jr = await startJourneyNavigation(remembered);
        if (jr.ok) {
          return { ok: true, message: jr.reply };
        }
      }
    } catch {
      /* fall through */
    }

    const fromLat = store.lastGpsLat;
    const fromLng = store.lastGpsLng;
    const walkMin =
      fromLat != null && fromLng != null
        ? approxWalkMin(fromLat, fromLng, lat, lng)
        : 1;

    if (
      walkMin > PLAN_SOFT_MODE_MAX_MIN &&
      fromLat != null &&
      fromLng != null
    ) {
      try {
        const { setPreferredTravelMode } = require('../../services/navigation/travelModeContext') as {
          setPreferredTravelMode: (m: 'transit' | 'foot' | 'bike' | null) => void;
        };
        setPreferredTravelMode('transit');
      } catch {
        /* soft */
      }

      try {
        const { startTransitHandsFree } = await import(
          '../../services/navigation/handsFreeNav/transitBridge'
        );
        const tr = await startTransitHandsFree({
          from: { lat: fromLat, lng: fromLng },
          to: { lat, lng },
          destName: name,
        });
        if (tr.ok) {
          return { ok: true, message: tr.message };
        }
      } catch {
        /* fall through to walk + auto-ÖPNV */
      }
    }

    const { interruptAndNavigateToDiscovery } = await import(
      '../../services/navigation/contextualDiscovery'
    );
    const ok = await interruptAndNavigateToDiscovery(
      { name, lat, lng },
      { skipDestVerify: true, skipClosingGate: true },
    );
    if (ok) {
      return { ok: true };
    }
    return {
      ok: false,
      message: 'Route konnte nicht starten — bitte nochmal tippen.',
    };
  } catch (err) {
    return {
      ok: false,
      message:
        err instanceof Error
          ? err.message
          : 'Route konnte nicht starten — bitte nochmal tippen.',
    };
  } finally {
    try {
      useFinnusStore.getState().setNavRouteLoading(false);
    } catch {
      /* soft */
    }
  }
}
