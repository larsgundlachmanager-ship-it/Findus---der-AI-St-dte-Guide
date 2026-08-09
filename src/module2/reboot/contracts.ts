/**
 * Reboot-Manager-Verträge — welche Module welche Jobs ziehen,
 * Think-Ahead, Bridge-Budget, Fast/Slow-Lane.
 *
 * Parallelismus: max 2 Fact-Jobs. Vorausdenken = Hints + Code-Care, nicht 20 Gemini-Calls.
 */

import type { FindusJobId } from '../jobs/types';
import type { ManagerModule, ThinkAheadHint } from './types';

export const REBOOT_MAX_PARALLEL_FACT_JOBS = 2;

export const REBOOT_MANAGER_MODULES: Record<
  ManagerModule,
  {
    label: string;
    /** Typische Job-IDs (bestehende Classify-Tabelle). */
    typicalJobs: FindusJobId[];
    defaultThinkAhead: ThinkAheadHint[];
  }
> = {
  story: {
    label: 'Ort / Historie / Was-ist-das (Modul 1 + manuell)',
    typicalJobs: ['poi_identify', 'museum_theme', 'sight_recommend', 'fact_number'],
    defaultThinkAhead: ['pref_filter_sights'],
  },
  nav: {
    label: 'Navigation / Amenity hin',
    typicalJobs: ['nav_route', 'friction_now', 'shopping_errand', 'transit_live'],
    defaultThinkAhead: ['mobility_mode'],
  },
  plan: {
    label: 'Timeline / später',
    typicalJobs: ['day_plan_budget', 'dining_hard_match', 'stay_search', 'tonight_live'],
    defaultThinkAhead: [
      'budget_filter',
      'diet_filter',
      'booking_deeplink_prefill',
      'menu_links_required',
    ],
  },
  tour: {
    label: 'Explore / unbesucht / 1-h-Tour / Strand-Vergleich',
    typicalJobs: ['sight_recommend', 'activity_sport', 'day_plan_budget'],
    defaultThinkAhead: ['pref_filter_sights', 'mobility_mode', 'combo_cluster'],
  },
  care: {
    label: 'Parken / Todos / Leave-by / Geofence',
    typicalJobs: ['parking_ev', 'shopping_errand', 'friction_now'],
    defaultThinkAhead: ['parking_leave_by', 'parking_invalidate_on_drive'],
  },
  live_q: {
    label: 'Jetzt-Frage (Aldi, Kino, Outfit, Party)',
    typicalJobs: [
      'shopping_errand',
      'tonight_live',
      'nightlife_vibe',
      'weather_outfit',
      'dining_open',
      'dining_hard_match',
    ],
    defaultThinkAhead: [
      'outfit_from_plan_and_weather',
      'diet_filter',
      'budget_filter',
      'menu_links_required',
      'age_safe_nightlife',
    ],
  },
  combo: {
    label: 'Multi-Constraint Cluster',
    typicalJobs: ['day_plan_budget', 'parking_ev', 'dining_hard_match', 'activity_sport'],
    defaultThinkAhead: ['combo_cluster', 'budget_filter', 'diet_filter', 'mobility_mode'],
  },
  smalltalk: {
    label: 'Smalltalk',
    typicalJobs: ['smalltalk_general'],
    defaultThinkAhead: [],
  },
};

/** Bridge: nur Call-1, nie Follow-up im selben topicId. */
export const REBOOT_BRIDGE_RULES = {
  maxPerTurn: 1 as const,
  /** Follow-up / continue Thread → bridgeOneLiner muss null sein. */
  suppressOnThreadContinue: true,
  /** Amenity-Suche: kurze Fact-Ack erlaubt („guck kurz“), kein Motivations-Essay. */
  amenityStyle: 'fact_ack' as const,
};

/** Fast = sofort Synthese; Slow = Buttons nachpoppen (Speisekarte, Tickets, Stay22). */
export const REBOOT_LANE_RULES = {
  fastMustNotBlockOn: [
    'ticket_or_info_url',
    'booking_deep_link',
    'menu_links_required',
  ] as const,
  slowMayFill: [
    'ticket_or_info_url',
    'booking_deep_link',
    'price_eur',
    'open_now_or_hours',
  ] as const,
  pendingActionStatus: 'pending' as const,
};

/**
 * Manager-Mitdenken (Prompt-Block für Call-1 + Call-2).
 * Vorausdenken ≠ Extra-Agents — Hints + Context-Rucksack + Care-Code.
 */
export const FINDUS_REBOOT_MANAGER_THINK_AHEAD_BLOCK = `MANAGER MITDENKEN (SSOT Reboot — kein Parallel-Gemini-Schwarm):
- Call-1 verteilt max. ${REBOOT_MAX_PARALLEL_FACT_JOBS} Fact-Jobs + ThinkAhead-Hints. Keine Stil-Antwort im Router.
- Outfit „was anziehen?“ → Plan heute Abend (5★ / Rooftop / Strand) + Wetter/Temperatur + Dresscode-Hint. Nicht nur Wetter allein.
- Aussage „Parkticket bis HH:MM“ → Care: Spot+Expiry speichern, Leave-by aus OSM-Wegzeit nachziehen, Reminder. Kein zweites „Soll ich merken?“.
- Auto weg / Geschwindigkeit hoch / Spot verlassen → Park-Reminder invalidieren (Code).
- Diet/Budget/Mobilität/Sight-Prefs aus Context-Rucksack sind Hard-Filter für Fact-Lane (kein Steakhaus für Vegetarier).
- Kombi (gratis parken + Pizza TA + Förde) → ein combo-Cluster, nicht drei lose Antworten.
- Speisekarte / Ticket / Stay22-Deep-Link: Fast-Antwort zuerst; Links dürfen als pending Actions nachpoppen (Slow-Lane).
- Bridge: höchstens eine pro neuem Topic. Follow-up im selben Topic: keine neue Bridge.
- 1 Amenity-Treffer im sinnvollen Radius → autoStartNav; 2+ → kurz wählen lassen.
- Laufende Multi-Stop-Tour: Spontan-Ziel (Aldi/Durst) EINWEBEN, nie die ganze Queue löschen. On-route Stop vor Spontan, Rest bleibt. Harter Cut nur bei explizitem „Route löschen / andere Tour“.
- Stop-Priorität: must → Reminder ~5 Min locker; high = jetzt oben; soft = Errand ohne Druck.
- Thread: neuer Ort = new/parallel Topic. Alter Ort (Marinedenkmal) darf Schwimmbad-Follow-ups nicht überschreiben.`;

export function moduleForPrimaryJob(jobId: FindusJobId): ManagerModule {
  for (const [mod, cfg] of Object.entries(REBOOT_MANAGER_MODULES) as Array<
    [ManagerModule, (typeof REBOOT_MANAGER_MODULES)[ManagerModule]]
  >) {
    if (cfg.typicalJobs.includes(jobId)) return mod;
  }
  return 'live_q';
}
