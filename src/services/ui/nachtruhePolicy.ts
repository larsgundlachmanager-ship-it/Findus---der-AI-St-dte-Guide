/**
 * Nachtruhe-Policy (SSOT)
 *
 * Aktiv-Fenster 10:30–19:30: nur Vorschläge „was man machen könnte“.
 * Außerhalb: Nachtruhe — keine proaktiven Tips/Reminder (User-Initiiertes bleibt).
 */

/** Start inklusiv (Minuten seit Mitternacht). */
export const NACHTRUHE_ACTIVE_START_MIN = 10 * 60 + 30; // 10:30
/** Ende exklusiv. */
export const NACHTRUHE_ACTIVE_END_MIN = 19 * 60 + 30; // 19:30

export function minutesOfLocalDay(nowMs = Date.now()): number {
  const d = new Date(nowMs);
  return d.getHours() * 60 + d.getMinutes();
}

/** Außerhalb 10:30–19:30 → Nachtruhe. */
export function isNachtruhe(nowMs = Date.now()): boolean {
  const m = minutesOfLocalDay(nowMs);
  return m < NACHTRUHE_ACTIVE_START_MIN || m >= NACHTRUHE_ACTIVE_END_MIN;
}

/** Tagsüber im Aktiv-Fenster: Aktivitätsvorschläge erlaubt. */
export function isActivitySuggestionWindow(nowMs = Date.now()): boolean {
  return !isNachtruhe(nowMs);
}

/**
 * Tip-Kinds die „was man machen könnte“ sind (tagsüber ok).
 * Deadlines/Leave bleiben auch in Nachtruhe nur wenn zeitkritisch gefiltert separat.
 */
export const ACTIVITY_HUD_TIP_KINDS = new Set([
  'hotel_breakfast',
  'weather_summary',
  'open_task',
  'generic',
  'weather_rain',
  'battery_charge',
  'wake_alarm',
  'parking_ticket',
  'nav_eta',
  'transit_depart',
]);

/** Context-Trigger-IDs die Aktivitätsvorschläge sind. */
export const ACTIVITY_TRIGGER_IDS = new Set([
  'weather_briefing',
  'hotel_breakfast',
  'lunch_nearby',
  'toilet_nearby',
  'drinking_water_nearby',
  'ice_cream_hot',
  'park_pause',
  'photo_spots',
  'dinner_reservation',
  'sunset_spot',
  'supermarket_evening',
  'day_summary',
  'profile_burger',
  'profile_tennis',
  'pack_list',
  'route_by_weather',
  'sudden_rain_indoor',
  'bike_stand_pump',
  'low_battery_charge',
  'poi_dwell_fact',
]);

/** Zeitkritische Tip-Kinds — auch in Nachtruhe nur bei hohem Score (Leave/Deadline). */
export const NACHTRUHE_CRITICAL_HUD_KINDS = new Set([
  'session_deadline',
  'shopping_closing',
  'hotel_checkin',
  'weather_rain',
  'battery_charge',
  'wake_alarm',
  'parking_ticket',
  'nav_eta',
  'transit_depart',
]);

export function allowProactiveHudTip(opts: {
  kind: string;
  score: number;
  nowMs?: number;
}): boolean {
  const now = opts.nowMs ?? Date.now();
  if (isNachtruhe(now)) {
    // Nur harte Deadlines / Check-in kurz vorher
    if (!NACHTRUHE_CRITICAL_HUD_KINDS.has(opts.kind)) return false;
    return opts.score >= 88;
  }
  // Tagsüber: vor allem Aktivitäts-/Orientierungs-Tips — Deadlines trotzdem ok
  if (NACHTRUHE_CRITICAL_HUD_KINDS.has(opts.kind)) return true;
  return ACTIVITY_HUD_TIP_KINDS.has(opts.kind) || opts.kind === 'generic';
}

export function allowProactiveReminder(opts: {
  kind: string;
  score: number;
  nowMs?: number;
}): boolean {
  return allowProactiveHudTip(opts);
}

export function allowActivitySoftTips(nowMs = Date.now()): boolean {
  return isActivitySuggestionWindow(nowMs);
}

export function allowProactiveVoice(nowMs = Date.now()): boolean {
  // In Nachtruhe keine proaktive Stimme (außer kritische Caller mit force)
  return isActivitySuggestionWindow(nowMs);
}

/** Kritische Voice-Ausnahmen in Nachtruhe (Deadline Score ≥ 88). */
export function allowCriticalProactiveVoice(opts: {
  kind: string;
  score: number;
  nowMs?: number;
}): boolean {
  if (allowProactiveVoice(opts.nowMs)) return true;
  if (!NACHTRUHE_CRITICAL_HUD_KINDS.has(opts.kind)) return false;
  return opts.score >= 88;
}
