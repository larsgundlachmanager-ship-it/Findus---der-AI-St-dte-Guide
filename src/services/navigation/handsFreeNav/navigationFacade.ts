/**
 * Navigation-Fassade — Progressive Route + Hands-Free Start.
 * Hosts/Tests importieren hier; navigationService bleibt Legacy-Einstieg.
 */
export { fetchProgressiveRoute } from './routeEngine';
export {
  commitHandsFreeNavStart,
  progressiveEnrichRoute,
  bumpProgressiveEnrichEpoch,
  getLastProgressiveStartMeta,
} from './startNav';
export type { ProgressiveStartMeta } from './startNav';
