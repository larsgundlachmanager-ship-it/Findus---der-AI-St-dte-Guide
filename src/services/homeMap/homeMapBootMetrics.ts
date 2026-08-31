/**
 * Boot-Messpunkte für „Karte in ~5 s nutzbar“.
 * Ziel: displayHydrate → mapReady → roads → places ≤ 5 s nach markHomeMapBootStart.
 */

export type HomeMapBootMark =
  | 'start'
  | 'displayHydrate'
  | 'mapReady'
  | 'roads'
  | 'buildings'
  | 'places'
  | 'world';

type Marks = Partial<Record<HomeMapBootMark, number>>;

let bootStartedAt = 0;
const marks: Marks = {};

export function resetHomeMapBootMetrics(): void {
  bootStartedAt = 0;
  for (const k of Object.keys(marks) as HomeMapBootMark[]) {
    delete marks[k];
  }
}

export function markHomeMapBootStart(now = Date.now()): void {
  if (bootStartedAt) return;
  bootStartedAt = now;
  marks.start = 0;
}

export function markHomeMapBoot(mark: HomeMapBootMark, now = Date.now()): void {
  if (!bootStartedAt) markHomeMapBootStart(now);
  if (marks[mark] != null) return;
  const elapsed = Math.max(0, now - bootStartedAt);
  marks[mark] = elapsed;
  if (
    typeof __DEV__ !== 'undefined' &&
    __DEV__ &&
    (mark === 'roads' || mark === 'places' || mark === 'buildings')
  ) {
    // eslint-disable-next-line no-console
    console.log(`[homeMapBoot] ${mark}=${elapsed}ms`, peekHomeMapBootMarks());
  }
}

export function peekHomeMapBootMarks(): Readonly<Marks> & { startedAt: number } {
  return { ...marks, startedAt: bootStartedAt };
}

/** True wenn Straßen + Places innerhalb von budgetMs nach Start. */
export function homeMapBootCoreOk(budgetMs = 5_000): boolean {
  const roads = marks.roads;
  const places = marks.places;
  if (roads == null || places == null) return false;
  return Math.max(roads, places) <= budgetMs;
}
