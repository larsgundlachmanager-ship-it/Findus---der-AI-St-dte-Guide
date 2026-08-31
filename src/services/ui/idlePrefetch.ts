/**
 * Homescreen-Overlays sofort vorwärmen (erster Tap ohne Spinner).
 * Schweres (Pin-Index, Visit-Log) erst nach Interactive Window / Lane frei.
 * Premount: Settings/Timeline/Orte einmal unsichtbar mounten.
 */

import { AppState } from 'react-native';
import { getCachedUserProfile } from '../userProfileService';
import { useGpsStore } from '../../store/useGpsStore';
import { useHomeOverlayStore } from '../../store/useHomeOverlayStore';
import { usePlanCalendarUiStore } from '../../module2/timeline/planCalendarUiStore';
import {
  runHydrateWhenFree,
  waitUntilInteractiveSettled,
} from '../boot/interactiveBootGate';

let scheduled = false;
let overlaysWarmed = false;
let overlaysPremounted = false;
let heavyWarmed = false;

/** Settings / Timeline / Orte — synchron starten, kein InteractionManager-Warten. */
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
  overlaysPremounted = true;
  useHomeOverlayStore.getState().premountOverlays();
  usePlanCalendarUiStore.getState().premountCalendar();
}

export function prefetchSettingsScreen(): void {
  prefetchOverlayBundles();
}

export function scheduleIdleUiPrefetch(): void {
  if (scheduled) return;
  scheduled = true;
  prefetchOverlayBundles();

  // Sofort + kurzer Retry — nicht auf InteractionManager warten (Karte hält den oft busy).
  setTimeout(() => premountOverlayHosts(), 0);
  setTimeout(() => premountOverlayHosts(), 150);
  setTimeout(() => premountOverlayHosts(), 600);

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
      .then((m) =>
        m.warmNearbyPinIndexes({
          activeCityId: cityId,
          lat,
          lng,
        }),
      )
      .catch(() => undefined);
  };

  void waitUntilInteractiveSettled().then(() => {
    runHydrateWhenFree(runHeavy);
  });
}
