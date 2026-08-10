import { useEffect, useRef } from 'react';
import * as Location from 'expo-location';
import { useFinnusStore } from '../store/useFinnusStore';
import {
  refreshLocationDiagnostics,
  startWatchingLocation,
  stopWatchingLocation,
} from '../services/locationService';
import { handleLocationUpdate } from '../runtime/exploreModule';
import { checkCityProximity } from '../services/cityProximityService';

/**
 * Real-GPS Geofencing – still Orte suchen, sobald Simulation aus ist.
 * Ohne Standort-Recht: wartet auf „Tour starten“ (Play Prominent Disclosure).
 */
export function useGeofencing(): void {
  const isSimulationMode = useFinnusStore((s) => s.isSimulationMode);
  const watchingRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    async function start() {
      if (isSimulationMode) {
        if (watchingRef.current) {
          await stopWatchingLocation();
          watchingRef.current = false;
        }
        useFinnusStore.getState().setGpsWatching(false);
        useFinnusStore.getState().setGpsStatus('idle', null);
        useFinnusStore.getState().setNeedsTourStart(false);
        void refreshLocationDiagnostics();
        return;
      }

      try {
        const { status } = await Location.getForegroundPermissionsAsync();
        if (status !== 'granted') {
          // Kein Systemdialog ohne User-Tap → Home zeigt „Tour starten“
          useFinnusStore.getState().setNeedsTourStart(true);
          useFinnusStore.getState().setGpsStatus('idle', null);
          useFinnusStore.getState().setGpsWatching(false);
          void refreshLocationDiagnostics();
          return;
        }
      } catch {
        useFinnusStore.getState().setNeedsTourStart(true);
        return;
      }

      useFinnusStore.getState().setNeedsTourStart(false);
      useFinnusStore.getState().setGpsStatus('searching', null);
      const ok = await startWatchingLocation(
        ({ lat, lng, accuracy, speedMs, headingDeg }) => {
          if (!cancelled) {
            void handleLocationUpdate(lat, lng, { speedMs, headingDeg });
            void checkCityProximity(lat, lng);
          }
          void accuracy;
        },
      );
      watchingRef.current = ok;
      if (!ok && !cancelled) {
        await refreshLocationDiagnostics();
      }
    }

    void start();

    return () => {
      cancelled = true;
      void stopWatchingLocation();
      watchingRef.current = false;
    };
  }, [isSimulationMode]);
}

/** Expliziter Tour-Start (User-Tap) → Disclosure → Systemdialog → FGS. */
export async function startTourWithLocationPermission(): Promise<boolean> {
  useFinnusStore.getState().setNeedsTourStart(false);
  useFinnusStore.getState().setGpsStatus('searching', null);
  const ok = await startWatchingLocation(
    ({ lat, lng, accuracy, speedMs, headingDeg }) => {
      void handleLocationUpdate(lat, lng, { speedMs, headingDeg });
      void checkCityProximity(lat, lng);
      void accuracy;
    },
  );
  if (!ok) {
    try {
      const { status } = await Location.getForegroundPermissionsAsync();
      if (status !== 'granted') {
        useFinnusStore.getState().setNeedsTourStart(true);
      }
    } catch {
      useFinnusStore.getState().setNeedsTourStart(true);
    }
    await refreshLocationDiagnostics();
  }
  return ok;
}
