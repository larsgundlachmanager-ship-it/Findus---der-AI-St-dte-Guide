import * as Location from 'expo-location';
import type { LocationObject, LocationSubscription } from 'expo-location';

export type LocationUpdateHandler = (coords: {
  lat: number;
  lng: number;
}) => void;

let subscription: LocationSubscription | null = null;

export async function requestLocationPermission(): Promise<boolean> {
  const { status } = await Location.requestForegroundPermissionsAsync();
  return status === 'granted';
}

/**
 * Akkuschonendes GPS-Tracking mit 5 m Distanzintervall.
 */
export async function startWatchingLocation(
  onUpdate: LocationUpdateHandler,
): Promise<boolean> {
  const granted = await requestLocationPermission();
  if (!granted) {
    console.warn('[location] Permission denied');
    return false;
  }

  await stopWatchingLocation();

  subscription = await Location.watchPositionAsync(
    {
      accuracy: Location.Accuracy.Balanced,
      distanceInterval: 5,
      timeInterval: 3000,
    },
    (location: LocationObject) => {
      onUpdate({
        lat: location.coords.latitude,
        lng: location.coords.longitude,
      });
    },
  );

  return true;
}

export async function stopWatchingLocation(): Promise<void> {
  if (subscription) {
    subscription.remove();
    subscription = null;
  }
}

export async function getCurrentCoords(options?: {
  /** Timeout in ms – default 8s, damit UI nicht hängt */
  timeoutMs?: number;
}): Promise<{
  lat: number;
  lng: number;
} | null> {
  const timeoutMs = options?.timeoutMs ?? 8000;

  try {
    const granted = await requestLocationPermission();
    if (!granted) return null;

    const location = await Promise.race([
      Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      }),
      new Promise<null>((resolve) => {
        setTimeout(() => resolve(null), timeoutMs);
      }),
    ]);

    if (!location) {
      console.warn('[location] GPS Timeout');
      return null;
    }

    return {
      lat: location.coords.latitude,
      lng: location.coords.longitude,
    };
  } catch (err) {
    console.warn('[location] getCurrentCoords fehlgeschlagen:', err);
    return null;
  }
}
