import { useEffect, useRef } from 'react';
import { useFinnusStore } from '../store/useFinnusStore';
import {
  startWatchingLocation,
  stopWatchingLocation,
} from '../services/locationService';
import { handleLocationUpdate } from '../services/poiTriggerService';

/**
 * Real-GPS Geofencing – nur aktiv, wenn Simulation aus ist.
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
        return;
      }

      const ok = await startWatchingLocation(async ({ lat, lng }) => {
        if (!cancelled) {
          await handleLocationUpdate(lat, lng);
        }
      });
      watchingRef.current = ok;
    }

    start();

    return () => {
      cancelled = true;
      stopWatchingLocation();
      watchingRef.current = false;
    };
  }, [isSimulationMode]);
}
