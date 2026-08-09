/**
 * Modul 5 — Smart Mobility (ÖPNV vs. Taxi, 5/10-Min-Regeln).
 */

import { estimateTravelEtaRouted } from '../../services/navigation/travelEta';
import { fetchRouteDirectionsResult } from '../../services/navigation/googleMapsNav';
import { walkingDistanceFromSteps } from '../../services/navigation/googleMapsNav';
import { getPlanWalkMPerMin } from '../../services/mobility/paceProfile';
import {
  resolveActiveTravelMode,
  travelModeNavPrefs,
} from '../../services/navigation/travelModeContext';
import type {
  NavigationLeg,
  PlanNavNode,
  TransportMode,
} from './planningTypes';

function checkUserContextForBike(): boolean {
  try {
    const active = resolveActiveTravelMode();
    if (active.mode === 'bike') return true;
    return travelModeNavPrefs(active.mode).preferBike;
  } catch {
    return false;
  }
}

async function durationMinsForMode(
  start: { lat: number; lng: number },
  end: { lat: number; lng: number },
  mode: 'walking' | 'bicycling' | 'transit',
): Promise<number> {
  const timeoutMs = 3500;
  const work = async (): Promise<number> => {
    try {
      if (mode === 'walking' || mode === 'bicycling') {
        const eta = await estimateTravelEtaRouted({
          userLat: start.lat,
          userLng: start.lng,
          destLat: end.lat,
          destLng: end.lng,
          mode,
        });
        return Math.max(
          1,
          mode === 'bicycling' ? eta.bikeMinutes : eta.directWalkMinutes,
        );
      }
      const result = await fetchRouteDirectionsResult(start, end, 'transit');
      if (result?.steps?.length) {
        const m = walkingDistanceFromSteps(result.steps);
        const transitSpeed = 280;
        return Math.max(1, Math.round(m / transitSpeed));
      }
    } catch {
      /* soft */
    }
    const walkPace = getPlanWalkMPerMin();
    const dx = end.lat - start.lat;
    const dy = end.lng - start.lng;
    const meters =
      Math.sqrt(dx * dx + dy * dy) *
      111_000 *
      Math.cos((start.lat * Math.PI) / 180);
    if (mode === 'bicycling') return Math.max(1, Math.round(meters / (walkPace * 3)));
    if (mode === 'transit') return Math.max(1, Math.round(meters / 280));
    return Math.max(1, Math.round(meters / walkPace));
  };
  return Promise.race([
    work(),
    new Promise<number>((resolve) => {
      setTimeout(() => {
        const walkPace = getPlanWalkMPerMin();
        const dx = end.lat - start.lat;
        const dy = end.lng - start.lng;
        const meters =
          Math.sqrt(dx * dx + dy * dy) *
          111_000 *
          Math.cos((start.lat * Math.PI) / 180);
        if (mode === 'bicycling') {
          resolve(Math.max(1, Math.round(meters / (walkPace * 3))));
        } else if (mode === 'transit') {
          resolve(Math.max(1, Math.round(meters / 280)));
        } else {
          resolve(Math.max(1, Math.round(meters / walkPace)));
        }
      }, timeoutMs);
    }),
  ]);
}

export async function fetchAllOSRMModes(
  start: { lat: number; lng: number },
  end: { lat: number; lng: number },
): Promise<{
  walk: { durationMins: number };
  transit: { durationMins: number };
  bicycle: { durationMins: number };
  taxi: { durationMins: number };
}> {
  const [walkMins, transitMins, bikeMins] = await Promise.all([
    durationMinsForMode(start, end, 'walking'),
    durationMinsForMode(start, end, 'transit'),
    durationMinsForMode(start, end, 'bicycling'),
  ]);
  // Taxi ≈ 0.35× Fußzeit, Floor 5
  const taxiMins = Math.max(5, Math.round(walkMins * 0.35));
  return {
    walk: { durationMins: walkMins },
    transit: { durationMins: transitMins },
    bicycle: { durationMins: bikeMins },
    taxi: { durationMins: taxiMins },
  };
}

/**
 * Masterplan-Mathematik:
 * - Bike wenn (walk/3) ≤ 20
 * - Taxi wenn walk > 30 UND ÖPNV nicht ≥10 Min schneller
 * - Transit wenn walk > 20 UND ÖPNV ≥5 Min schneller
 * - Dauer: ceil/5*5 + 10 Puffer
 */
export async function calculateNavigation(
  startNode: PlanNavNode,
  endNode: PlanNavNode,
): Promise<NavigationLeg> {
  const routingModes = await fetchAllOSRMModes(
    startNode.coords,
    endNode.coords,
  );

  const walkMins = routingModes.walk.durationMins;
  const transitMins = routingModes.transit.durationMins;
  const hasBike = checkUserContextForBike();

  let selectedMode: TransportMode = 'WALKING';

  if (hasBike && walkMins / 3 <= 20) {
    selectedMode = 'BICYCLE';
  } else if (walkMins > 30 && walkMins - transitMins < 10) {
    // Fußweg über 30 Min UND ÖPNV ist NICHT mind. 10 Min schneller
    selectedMode = 'TAXI';
  } else if (walkMins > 20 && walkMins - transitMins >= 5) {
    // Fußweg über 20 Min UND ÖPNV ist mind. 5 Min schneller
    selectedMode = 'TRANSIT';
  }

  const rawDuration =
    selectedMode === 'WALKING'
      ? routingModes.walk.durationMins
      : selectedMode === 'BICYCLE'
        ? routingModes.bicycle.durationMins
        : selectedMode === 'TRANSIT'
          ? routingModes.transit.durationMins
          : routingModes.taxi.durationMins;

  const roundedDuration = Math.ceil(rawDuration / 5) * 5;
  const bufferedDuration = roundedDuration + 10; // Standard-Puffer

  return {
    id: `nav_${startNode.id}_${endNode.id}_${Date.now()}`,
    mode: selectedMode,
    duration: bufferedDuration,
    fromId: startNode.id,
    toId: endNode.id,
    start: startNode.coords,
    end: endNode.coords,
  };
}
