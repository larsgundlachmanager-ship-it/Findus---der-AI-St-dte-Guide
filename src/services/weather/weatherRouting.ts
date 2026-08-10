/**
 * WMO Weather interpretation codes (Open-Meteo) + rain/storm helpers.
 * @see https://open-meteo.com/en/docs
 */

/** Drizzle / rain / freezing rain / showers / thunderstorm. */
const RAIN_OR_STORM_CODES = new Set<number>([
  51, 53, 55, 56, 57, // drizzle / freezing drizzle
  61, 63, 65, 66, 67, // rain / freezing rain
  80, 81, 82, // rain showers
  95, 96, 99, // thunderstorm
]);

/** Heavy rain / storm subset for stronger ETA + voice. */
const HEAVY_RAIN_OR_STORM_CODES = new Set<number>([
  63, 65, 67, // moderate/heavy rain
  81, 82, // heavy showers
  95, 96, 99, // thunderstorm
]);

export function isRainOrStormWeatherCode(code: number | null | undefined): boolean {
  if (code == null || !Number.isFinite(code)) return false;
  return RAIN_OR_STORM_CODES.has(Math.round(code));
}

export function isHeavyRainOrStormWeatherCode(
  code: number | null | undefined,
): boolean {
  if (code == null || !Number.isFinite(code)) return false;
  return HEAVY_RAIN_OR_STORM_CODES.has(Math.round(code));
}

export function describeWeatherCode(code: number | null | undefined): string {
  if (code == null || !Number.isFinite(code)) return 'unbekannt';
  const c = Math.round(code);
  if (c === 0) return 'klar';
  if (c === 1 || c === 2) return 'leicht bewölkt';
  if (c === 3) return 'bedeckt';
  if (c === 45 || c === 48) return 'Nebel';
  if (c >= 51 && c <= 57) return 'Nieselregen';
  if (c === 61 || c === 66) return 'leichter Regen';
  if (c === 63 || c === 67) return 'mäßiger Regen';
  if (c === 65) return 'starker Regen';
  if (c === 71 || c === 73 || c === 75 || c === 77) return 'Schnee';
  if (c === 80) return 'Regenschauer';
  if (c === 81 || c === 82) return 'starke Schauer';
  if (c === 85 || c === 86) return 'Schneeschauer';
  if (c === 95) return 'Gewitter';
  if (c === 96 || c === 99) return 'Gewitter mit Hagel';
  return `Wettercode ${c}`;
}

/**
 * Heavy rain / storm when WMO code indicates rain/storm OR precipitation > 2 mm.
 */
export function isHeavyRainScenario(opts: {
  weatherCode?: number | null;
  precipitationMm?: number | null;
}): boolean {
  if (
    opts.precipitationMm != null &&
    Number.isFinite(opts.precipitationMm) &&
    opts.precipitationMm > 2
  ) {
    return true;
  }
  return isHeavyRainOrStormWeatherCode(opts.weatherCode);
}

/** Walking ETA multiplier under heavy rain (~10–15%). */
export const HEAVY_RAIN_WALK_ETA_MULTIPLIER = 1.12;

export type WeatherRoutingAdjustment = {
  isHeavyRain: boolean;
  isClearOrGood: boolean;
  walkEtaMultiplier: number;
  weatherCode: number | null;
  precipitationMm: number | null;
  /** Short label for prompts / UI */
  conditionLabel: string;
  /** Voice line when heavy rain; null if good weather. */
  voiceAlert: string | null;
  /** Prompt block for multimodal / concierge injection. */
  promptBlock: string;
};

export function buildWeatherRoutingAdjustment(opts: {
  weatherCode?: number | null;
  precipitationMm?: number | null;
  stationName?: string | null;
}): WeatherRoutingAdjustment {
  const weatherCode =
    opts.weatherCode != null && Number.isFinite(opts.weatherCode)
      ? Math.round(opts.weatherCode)
      : null;
  const precipitationMm =
    opts.precipitationMm != null && Number.isFinite(opts.precipitationMm)
      ? opts.precipitationMm
      : null;
  const isHeavyRain = isHeavyRainScenario({ weatherCode, precipitationMm });
  const isClearOrGood =
    !isHeavyRain &&
    !isRainOrStormWeatherCode(weatherCode) &&
    (precipitationMm == null || precipitationMm < 0.2);
  const conditionLabel = describeWeatherCode(weatherCode);
  const station = opts.stationName?.trim();

  if (isHeavyRain) {
    const covered = station
      ? ` Empfehle dir den überdachten Weg zur Bus-Haltestelle ${station}.`
      : ' Empfehle dir wenn möglich einen überdachten Weg zur Haltestelle.';
    const voiceAlert =
      `Draußen regnet es aktuell stark. Ich habe dir etwas mehr Laufzeit eingeplant.${covered}`;
    return {
      isHeavyRain: true,
      isClearOrGood: false,
      walkEtaMultiplier: HEAVY_RAIN_WALK_ETA_MULTIPLIER,
      weatherCode,
      precipitationMm,
      conditionLabel,
      voiceAlert,
      promptBlock: [
        'WETTER-ROUTING (PFLICHT):',
        `- Aktuell: starker Regen/Sturm (${conditionLabel}` +
          `${precipitationMm != null ? `, Niederschlag ~${precipitationMm.toFixed(1)} mm` : ''}).`,
        `- Gehzeit-ETA um ~${Math.round((HEAVY_RAIN_WALK_ETA_MULTIPLIER - 1) * 100)}% erhöhen.`,
        station
          ? `- Überdachten Weg zur Haltestelle „${station}“ empfehlen.`
          : '- Überdachten Weg zur Haltestelle empfehlen, falls bekannt.',
        `- Voice-Alert-Sinne: „${voiceAlert}"`,
      ].join('\n'),
    };
  }

  return {
    isHeavyRain: false,
    isClearOrGood,
    walkEtaMultiplier: 1,
    weatherCode,
    precipitationMm,
    conditionLabel,
    voiceAlert: null,
    promptBlock: [
      'WETTER-ROUTING:',
      `- Aktuell: ${isClearOrGood ? 'gutes / klares Wetter' : conditionLabel} — Standard-Tempo, normale Verkehrsmittel-Vorschläge.`,
      '- Keine extra Laufzeit-Puffer wegen Regen.',
    ].join('\n'),
  };
}

/** Apply multiplier and ceil to whole minutes (min 1). */
export function applyWalkEtaWeatherMultiplier(
  walkMinutes: number,
  multiplier: number,
): number {
  const base = Math.max(1, Math.ceil(walkMinutes));
  if (!Number.isFinite(multiplier) || multiplier <= 1) return base;
  return Math.max(base, Math.ceil(base * multiplier));
}
