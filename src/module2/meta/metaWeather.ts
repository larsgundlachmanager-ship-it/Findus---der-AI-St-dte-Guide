/**
 * Meta: Wetter/Outfit — Wrapper um outfitWeatherPresent.
 */

export {
  isOutfitWeatherTurn,
  looksLikeRainAsk,
  stripOutfitWeatherTourActions,
  deriveWeatherFactChips,
  finalizeOutfitWeatherBullets,
} from '../../services/concierge/outfitWeatherPresent';

export function metaWeatherLaneHint(userText: string): 'weather_outfit' | 'weather_rain' | 'weather_info' | null {
  try {
    const { reconcileWeatherJobShape, inferCall1JobShape } =
      require('../router/call1JobShape') as typeof import('../router/call1JobShape');
    const shape = reconcileWeatherJobShape(inferCall1JobShape(userText), userText);
    if (shape === 'weather_outfit' || shape === 'weather_rain' || shape === 'weather_info') {
      return shape;
    }
  } catch {
    /* soft */
  }
  return null;
}

/** Router-Härten: Regen vs Outfit vs allgemeines Wetter trennen. */
export function diffWeatherJobShapes(
  userText: string,
): { inferred: string; rain: boolean; outfit: boolean } {
  const t = String(userText || '');
  const rain =
    /\b(regnet|regnen|regen|schauer|niederschlag)\b/iu.test(t) &&
    !/\b(anziehen|outfit|kleidung)\b/iu.test(t);
  const outfit = /\b(anziehen|outfit|kleidung|was\s+soll\s+ich\s+an|was\s+zieh)\b/iu.test(
    t,
  );
  let inferred = 'weather_info';
  try {
    const { reconcileWeatherJobShape, inferCall1JobShape } =
      require('../router/call1JobShape') as typeof import('../router/call1JobShape');
    inferred = reconcileWeatherJobShape(inferCall1JobShape(t), t);
  } catch {
    inferred = outfit ? 'weather_outfit' : rain ? 'weather_rain' : 'weather_info';
  }
  return { inferred, rain, outfit };
}
