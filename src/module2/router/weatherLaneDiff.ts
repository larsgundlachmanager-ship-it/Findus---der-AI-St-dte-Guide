/**
 * Wetter-Lane Diff — wraps outfitWeatherPresent (kein Rewrite).
 */

export type WeatherLane = 'weather_info' | 'weather_rain' | 'weather_outfit';

export function resolveWeatherLane(userText: string): WeatherLane | null {
  try {
    const { inferCall1JobShape } = require('../router/call1JobShape') as {
      inferCall1JobShape: (s: string) => string;
    };
    const shape = inferCall1JobShape(userText);
    if (
      shape === 'weather_info' ||
      shape === 'weather_rain' ||
      shape === 'weather_outfit'
    ) {
      return shape;
    }
  } catch {
    /* soft */
  }
  try {
    const {
      looksLikeRainAsk,
      isOutfitWeatherTurn,
    } = require('../../services/concierge/outfitWeatherPresent') as {
      looksLikeRainAsk: (s?: string | null) => boolean;
      isOutfitWeatherTurn: (s?: string | null) => boolean;
    };
    if (isOutfitWeatherTurn(userText)) return 'weather_outfit';
    if (looksLikeRainAsk(userText)) return 'weather_rain';
    if (/\b(wetter|temperatur|grad|°)\b/iu.test(userText)) return 'weather_info';
  } catch {
    /* soft */
  }
  return null;
}
