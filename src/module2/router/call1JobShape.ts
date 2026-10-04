/**
 * Call-1 JobShape — Intention → Engine (härten, kein Rewrite).
 * SSOT: docs/rfc/agent-harden-contract.md
 */

export type Call1JobShape =
  | 'flight_only'
  | 'trip_package'
  | 'fact_lookup'
  | 'place_dining'
  | 'logistics'
  | 'logistics_multi'
  | 'arrival_home'
  | 'schedule_write'
  | 'weather_info'
  | 'weather_rain'
  | 'weather_outfit'
  | 'unknown';

const SHAPES: Call1JobShape[] = [
  'flight_only',
  'trip_package',
  'fact_lookup',
  'place_dining',
  'logistics',
  'logistics_multi',
  'arrival_home',
  'schedule_write',
  'weather_info',
  'weather_rain',
  'weather_outfit',
  'unknown',
];

export function asCall1JobShape(raw: unknown): Call1JobShape | null {
  const s = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/-/g, '_');
  return SHAPES.includes(s as Call1JobShape) ? (s as Call1JobShape) : null;
}

/** Soft-Heuristik — Call-1 JSON gewinnt; Safety hinter Steal-Fixes. */
export function inferCall1JobShape(userText: string): Call1JobShape {
  const t = (userText || '').replace(/\s+/g, ' ').trim();
  if (!t) return 'unknown';

  try {
    const { isFindusReisebueroHandoff } = require('../../reisebuero/handoff') as {
      isFindusReisebueroHandoff: (s: string) => boolean;
    };
    if (isFindusReisebueroHandoff(t)) return 'trip_package';
  } catch {
    /* soft */
  }

  try {
    const { looksLikeTravelScheduleWriteJob } = require('../timeline/travelScheduleHarden') as {
      looksLikeTravelScheduleWriteJob: (s: string) => boolean;
    };
    if (looksLikeTravelScheduleWriteJob(t)) return 'schedule_write';
  } catch {
    /* soft */
  }

  if (
    /\b(trag|eintragen|timeline|kalender|terminplaner|hinzufüg|packliste|packen)\b/iu.test(t) &&
    /\b(ein|rein|dazu|programm|flug|bahn|zug|hotel|check[\s-]?in|frühstück|fruehstueck|kreuzfahrt|flix|fernbus|konzert|festival|event|kino|packliste|reisepass|badhose|sonnencreme)\b/iu.test(
      t,
    )
  ) {
    return 'schedule_write';
  }

  if (
    /\b(anziehen|outfit|kleidung|was\s+soll\s+ich\s+an|was\s+zieh)\b/iu.test(t)
  ) {
    return 'weather_outfit';
  }
  if (
    /\b(regnet|regnen|regen|schauer|niederschlag)\b/iu.test(t) &&
    !/\b(anziehen|outfit|kleidung)\b/iu.test(t)
  ) {
    return 'weather_rain';
  }
  if (/\b(wetter|temperatur|sonne|bewölkt|bewoelkt|°|grad)\b/iu.test(t)) {
    return 'weather_info';
  }

  if (
    /\b(wann\s+bin\s+ich\s+(?:zu\s+hause|zuhause|heim)|zu\s+hause\s+(?:an|sein)|heimkommen|ankunft.{0,24}heim)\b/iu.test(
      t,
    )
  ) {
    return 'arrival_home';
  }
  if (
    /\b(zwischenstopp|stopp\s+dazwischen|noch\s+einen?\s+stopp|add\s+stop)\b/iu.test(
      t,
    )
  ) {
    return 'logistics_multi';
  }
  if (
    /\b(wie\s+lange\s+(?:brauch|hin|dauert)|eta|anreise|verbindung\s+nach|seilbahn)\b/iu.test(
      t,
    )
  ) {
    return 'logistics';
  }

  if (
    /\b(essen|restaurant|pizzeria|pizza|mittag|abendessen|frühstück|fruehstueck|hunger|speisekarte|rucola|steak|sushi|café|cafe)\b/iu.test(
      t,
    )
  ) {
    return 'place_dining';
  }

  try {
    const { isSoloFlightAbSearch } = require('../../services/flights/flightTripIntent') as {
      isSoloFlightAbSearch: (s: string) => boolean;
    };
    if (isSoloFlightAbSearch(t)) return 'flight_only';
  } catch {
    /* soft */
  }

  if (
    /\b(fähre|faehre|skilift|letzte\s+abfahrt|spikeball|größter\s+strand|groesster\s+strand|öffnungszeit|oeffnungszeit|noch\s+auf)\b/iu.test(
      t,
    )
  ) {
    return 'fact_lookup';
  }

  return 'unknown';
}

export function jobShapeNeedsCompose(shape: Call1JobShape): boolean {
  return shape === 'arrival_home' || shape === 'logistics_multi';
}

/**
 * Wetter-Sub-Shapes: Outfit schlägt Regen; reiner Regen ≠ generisches weather_info.
 */
export function reconcileWeatherJobShape(
  parsed: Call1JobShape | null | undefined,
  userText: string,
): Call1JobShape {
  const t = (userText || '').replace(/\s+/g, ' ').trim();
  const inferred = inferCall1JobShape(t);
  const hasOutfit = /\b(anziehen|outfit|kleidung|was\s+soll\s+ich\s+an|was\s+zieh)\b/iu.test(
    t,
  );
  const hasRain =
    /\b(regnet|regnen|regen|schauer|niederschlag)\b/iu.test(t) && !hasOutfit;
  if (hasOutfit) return 'weather_outfit';
  if (hasRain) {
    if (parsed === 'weather_outfit') return 'weather_outfit';
    return 'weather_rain';
  }
  if (parsed && parsed !== 'unknown' && parsed.startsWith('weather_')) {
    return parsed;
  }
  if (inferred.startsWith('weather_')) return inferred;
  return parsed && parsed !== 'unknown' ? parsed : inferred;
}

export function jobShapeToExecutionHint(
  shape: Call1JobShape,
): string | null {
  switch (shape) {
    case 'flight_only':
      return 'flight_advisor';
    case 'trip_package':
      return 'reisebuero';
    case 'place_dining':
      return 'pitch_module';
    case 'arrival_home':
    case 'logistics_multi':
      return 'task_fanout';
    case 'logistics':
      return 'nav_execute';
    case 'weather_info':
    case 'weather_rain':
    case 'weather_outfit':
      return 'chat_lane';
    case 'schedule_write':
      return 'plan_module';
    case 'fact_lookup':
      return 'task_fanout';
    default:
      return null;
  }
}
