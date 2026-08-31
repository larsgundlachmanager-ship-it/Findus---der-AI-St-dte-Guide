import { useFinnusStore } from '../../store/useFinnusStore';

/** Karten-Polyline neu zeichnen, sobald sich Waypoints / Tour-Stopps ändern. */
export function notifyNavRouteGeometryChanged(): void {
  try {
    const cur = useFinnusStore.getState().navRouteRev ?? 0;
    useFinnusStore.setState({ navRouteRev: cur + 1 });
  } catch {
    /* soft */
  }
}
