import { useEffect, useRef } from 'react';
import { useFinnusStore } from '../store/useFinnusStore';
import {
  refreshLocationDiagnostics,
  startWatchingLocation,
  stopWatchingLocation,
} from '../services/locationService';
import { handleLocationUpdate } from '../services/poiTriggerService';
import { checkCityProximity } from '../services/cityProximityService';

/**
 * Real-GPS Geofencing – still Orte suchen, sobald Simulation aus ist.
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
        void refreshLocationDiagnostics();
        return;
      }

      useFinnusStore.getState().setGpsStatus('searching', null);
      const ok = await startWatchingLocation(
        ({ lat, lng, accuracy, speedMs, headingDeg }) => {
          if (!cancelled) {
            // Nicht awaiten — sonst stauen sich Fixes hinter langen Story/TTS-Läufen
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
