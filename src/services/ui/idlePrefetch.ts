/**
 * Homescreen-Overlays vorwärmen (erster Tap ohne Spinner).
 * Bundle-Import sofort; Host-Premount kurz nach Splash-Interactive
 * (Chrome/Mic zuerst — nicht hinter Hydrate/Settle warten).
 * Overlay-Tap → Gate parkt Polish (Chrome zuerst). Heavy erst nach Settle.
 */
import { AppState } from 'react-native';
import { getCachedUserProfile } from '../userProfileService';
import { useGpsStore } from '../../store/useGpsStore';
import { useHomeOverlayStore } from '../../store/useHomeOverlayStore';
import { usePlanCalendarUiStore } from '../../module2/timeline/planCalendarUiStore';
import {
  peekInteractiveBootGate,
  runHydrateWhenFree,
  waitUntilInteractiveSettled,
} from '../boot/interactiveBootGate';

/**
 * Kurz nach Splash-Interactive — Polish geparkt, Chrome-Shell warmhalten.
 * 0x0 Warm-Keep (kein absoluteFill/display:none) — kein Fabric-Blackscreen.
 * Frueher 100-160 ms; ein Frame Luft, dann Premount.
 */
export const CHROME_PREMOUNT_AFTER_SPLASH_MS = 48;

let scheduled = false;
let overlaysWarmed = false;
let overlaysPremounted = false;
let heavyWarmed = false;

/** Settings / Timeline / Orte — Bundle früh laden, Mount später. */
function prefetchOverlayBundles(): void {
  if (overlaysWarmed) return;
  overlaysWarmed = true;
  void import('../../screens/SettingsScreenLazy').then((m) =>
    m.prefetchSettingsScreen(),
  );
  void import('../../components/PlanCalendarModal');
  void import('../../components/PlaceSeekSheet');
  void import('../../components/VisitPassportModal');
}

/** Einmal mounten (sichtbar=false) — Tap = nur Visibility. */
function premountOverlayHosts(): void {
  if (overlaysPremounted) return;
  if (AppState.currentState !== 'active') return;
  try {
    const gate = peekInteractiveBootGate();
    if (gate.micActive || gate.module2TurnBusy || gate.overlayBusy) {
      // Mic/Turn hat Vorfahrt — später nochmal versuchen.
      setTimeout(() => {
        overlaysPremounted = false;
        premountOverlayHosts();
      }, 800);
      return;
    }
  } catch {
    /* soft */
  }
  overlaysPremounted = true;
  useHomeOverlayStore.getState().premountOverlays();
  usePlanCalendarUiStore.getState().premountCalendar();
}

/**
 * Bundle sofort; Host-Premount erst nach Interactive-Settle + Grace.
 * Nie unter Splash/Map-Boot (Android Fabric sonst leerer Root).
 */
function scheduleChromePremountAfterSplash(): void {
  const arm = () => {
    setTimeout(() => premountOverlayHosts(), CHROME_PREMOUNT_AFTER_SPLASH_MS);
    setTimeout(
      () => premountOverlayHosts(),
      CHROME_PREMOUNT_AFTER_SPLASH_MS + 400,
    );
  };
  if (peekInteractiveBootGate().splashInteractiveAt) {
    arm();
    return;
  }
  const started = Date.now();
  const poll = setInterval(() => {
    if (peekInteractiveBootGate().splashInteractiveAt) {
      clearInterval(poll);
      arm();
      return;
    }
    // Failsafe: nach 5 s trotzdem premounten (Splash-Cap).
    if (Date.now() - started > 5_000) {
      clearInterval(poll);
      arm();
    }
  }, 40);
}

export function prefetchSettingsScreen(): void {
  prefetchOverlayBundles();
}

export function scheduleIdleUiPrefetch(): void {
  if (scheduled) return;
  scheduled = true;
  // Bundle früh; Host-Premount direkt nach Splash-Interactive (Chrome zuerst).
  prefetchOverlayBundles();

  scheduleChromePremountAfterSplash();

  const runHeavy = () => {
    if (heavyWarmed) return;
    if (AppState.currentState !== 'active') return;
    heavyWarmed = true;
    void import('../timeline/visitLog')
      .then((m) => m.hydrateVisitLog())
      .catch(() => undefined);
    const cityId = getCachedUserProfile()?.cityId ?? null;
    const lat = useGpsStore.getState().lat;
    const lng = useGpsStore.getState().lng;
    void import('../homeMap/mapPinIndex')
      .then(async (m) => {
        let stickyCityId: string | null = null;
        try {
          const { listKnownCityCoverageBounds, smallestCityIdContainingPoint } =
            await import('../discovery/cityCoverageBounds');
          const { isCityPackCachedOnDevice } = await import('../cityCatalogService');
          if (
            typeof lat === 'number' &&
            typeof lng === 'number' &&
            Number.isFinite(lat) &&
            Number.isFinite(lng)
          ) {
            const at = smallestCityIdContainingPoint(
              lat,
              lng,
              listKnownCityCoverageBounds(),
            );
            if (at && (await isCityPackCachedOnDevice(at))) {
              stickyCityId = at.toLowerCase();
            }
          }
        } catch {
          /* soft */
        }
        return m.warmNearbyPinIndexes({
          activeCityId: cityId,
          stickyCityId,
          lat,
          lng,
        });
      })
      .catch(() => undefined);
  };

  void waitUntilInteractiveSettled().then(() => {
    runHydrateWhenFree(runHeavy);
  });
}
