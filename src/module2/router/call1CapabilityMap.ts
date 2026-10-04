/**
 * Call-1 Capability-Katalog → Worker-IDs.
 * Eine Maschine, viele Worker — kein separates Gehirn pro Absicht.
 */

export type Call1WorkerId =
  | 'place'
  | 'fact'
  | 'weather'
  | 'nav'
  | 'transit'
  | 'taxi'
  | 'flight'
  | 'deep_web'
  | 'hotel'
  | 'package_quick'
  | 'events'
  | 'plan'
  | 'tour'
  | 'reisebuero'
  | 'm1_poi'
  | 'identify_nearby'
  | 'memory_prefs'
  | 'memory_recall'
  | 'timer_alarm'
  | 'timeline_reminder'
  | 'map_pin'
  | 'voice_settings'
  | 'device_action'
  | 'chat'
  /** Legacy TurnFrame workers (Compat) */
  | 'dining'
  | 'pitch'
  | 'm1';

export type Call1CapabilityRow = {
  worker: Call1WorkerId;
  /** Kurz: was der Worker liefert */
  delivers: string;
  /** Typische Absichten (nur Doku/Geländer, kein Keyword-Zwang) */
  examples: string[];
};

/** Vollständiger Katalog — Phase A3 SSOT. */
export const CALL1_CAPABILITY_CATALOG: Call1CapabilityRow[] = [
  {
    worker: 'timer_alarm',
    delivers: 'Timer/Wecker setzen',
    examples: ['Timer 10 Min', 'Wecker 7 Uhr'],
  },
  {
    worker: 'timeline_reminder',
    delivers: 'Erinnerung / Timeline-Eintrag',
    examples: ['Erinner mich später', 'in Timeline'],
  },
  {
    worker: 'memory_prefs',
    delivers: 'Pref/Allergie speichern',
    examples: ['Nussallergie', 'mag kein Asiatisch'],
  },
  {
    worker: 'memory_recall',
    delivers: 'Vergangene Besuche/Threads',
    examples: ['Wo waren wir gestern essen?'],
  },
  {
    worker: 'voice_settings',
    delivers: 'Stimme umstellen',
    examples: ['Stell die Stimme um'],
  },
  {
    worker: 'device_action',
    delivers: 'Mode-Switch / Geräteaktion',
    examples: ['Ich bin mit dem Rad'],
  },
  {
    worker: 'identify_nearby',
    delivers: 'GPS+Facing → was sehe ich',
    examples: ['Was ist das für ein Turm?', 'Wo bin ich?'],
  },
  {
    worker: 'm1_poi',
    delivers: 'POI-Story / Wissenswertes',
    examples: ['Erzähl über diesen Ort'],
  },
  {
    worker: 'map_pin',
    delivers: 'Karte pin + zoom',
    examples: ['Zeig X auf der Karte'],
  },
  {
    worker: 'place',
    delivers: 'Ort suchen/wählen Pack→Live',
    examples: ['Spaghetti-Eis', 'SUP Alster', 'Hotel Sauna adults-only'],
  },
  {
    worker: 'dining',
    delivers: 'Legacy Gastro → place',
    examples: ['Essen gehen'],
  },
  {
    worker: 'pitch',
    delivers: 'Legacy Auswahl → place',
    examples: ['Empfehl mir was'],
  },
  {
    worker: 'fact',
    delivers: 'Fakt Pack→Web',
    examples: ['Wie hoch ist der Michel?', 'Öffnungszeiten'],
  },
  {
    worker: 'weather',
    delivers: 'Wetter-Slots',
    examples: ['Regnet es?', 'Strand heute?', 'Tour + Regen'],
  },
  {
    worker: 'nav',
    delivers: 'Navigation start/stop/reroute',
    examples: ['Bring mich hin', 'Stopp Navigation'],
  },
  {
    worker: 'transit',
    delivers: 'ÖPNV / Verbindung',
    examples: ['Wie komme ich am schnellsten?'],
  },
  {
    worker: 'taxi',
    delivers: 'Taxi/Uber jetzt oder vorbestellen',
    examples: ['Taxi bestellen', 'Uber zum Bahnhof'],
  },
  {
    worker: 'flight',
    delivers: 'Flug Leave-by / Match',
    examples: ['Wann muss ich los zum Flug?'],
  },
  {
    worker: 'deep_web',
    delivers: 'Web + Buchungslinks (Novel/Specialty Pflicht)',
    examples: ['Wangerooge Festland fliegen', 'Hop-on Hop-off Tickets'],
  },
  {
    worker: 'hotel',
    delivers: 'Hotel heute / Stay Suche',
    examples: ['Hotel für heute', '5 Sterne Whirlpool Sauna'],
  },
  {
    worker: 'package_quick',
    delivers: 'Pauschal/Stay Schnelllinks — kein Wizard',
    examples: ['Pauschalreise schnell', 'All-inclusive Link'],
  },
  {
    worker: 'events',
    delivers: 'Events/Sport/Fixtures',
    examples: ['Hamburg Towers Barclays'],
  },
  {
    worker: 'plan',
    delivers: 'Tagesplan',
    examples: ['Plan den Tag'],
  },
  {
    worker: 'tour',
    delivers: 'Tourenplaner',
    examples: ['Tour zusammenstellen'],
  },
  {
    worker: 'reisebuero',
    delivers: 'Reise an sich',
    examples: ['Kurztrip planen', 'Flug+Hotel'],
  },
  {
    worker: 'chat',
    delivers: 'Leichte Chat-/Kombi-Antwort',
    examples: ['Smalltalk', 'Kombi-Synth'],
  },
];

/** Legacy TurnFrame-Worker → kanonische WorkerId. */
export function normalizeWorkerId(raw: string): Call1WorkerId | null {
  const s = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/-/g, '_');
  const aliases: Record<string, Call1WorkerId> = {
    place: 'place',
    dining: 'dining',
    pitch: 'pitch',
    fact: 'fact',
    weather: 'weather',
    nav: 'nav',
    transit: 'transit',
    taxi: 'taxi',
    uber: 'taxi',
    flight: 'flight',
    deep_web: 'deep_web',
    web: 'deep_web',
    hotel: 'hotel',
    package_quick: 'package_quick',
    package: 'package_quick',
    pauschal: 'package_quick',
    events: 'events',
    event: 'events',
    plan: 'plan',
    tour: 'tour',
    reisebuero: 'reisebuero',
    m1: 'm1',
    m1_poi: 'm1_poi',
    identify_nearby: 'identify_nearby',
    memory_prefs: 'memory_prefs',
    memory_recall: 'memory_recall',
    memory: 'memory_recall',
    timer_alarm: 'timer_alarm',
    timer: 'timer_alarm',
    alarm: 'timer_alarm',
    timeline_reminder: 'timeline_reminder',
    reminder: 'timeline_reminder',
    map_pin: 'map_pin',
    map: 'map_pin',
    voice_settings: 'voice_settings',
    voice: 'voice_settings',
    device_action: 'device_action',
    chat: 'chat',
  };
  return aliases[s] ?? null;
}

/** place-Familie (Suche/Auswahl). */
export function isPlaceFamilyWorker(w: Call1WorkerId): boolean {
  return (
    w === 'place' ||
    w === 'dining' ||
    w === 'pitch' ||
    w === 'hotel' ||
    w === 'package_quick'
  );
}

export type Call1ExecutionHint =
  | 'chat_lane'
  | 'pitch_module'
  | 'flight_advisor'
  | 'plan_module'
  | 'tour_module'
  | 'events_research'
  | 'nav_execute'
  | 'm1_poi'
  | 'memory'
  | 'task_fanout'
  | 'reisebuero';

/** Execution-Backend-Hinweis aus dominantem Worker (Compat). */
export function workerToExecutionHint(w: Call1WorkerId): Call1ExecutionHint {
  if (isPlaceFamilyWorker(w)) return 'pitch_module';
  if (w === 'flight') return 'flight_advisor';
  // Deep-Web (Insel/Charter/Buchung) → Fanout, nicht Flug-Leave-by-Silo
  if (w === 'deep_web') return 'task_fanout';
  if (w === 'plan') return 'plan_module';
  if (w === 'tour') return 'tour_module';
  if (w === 'events') return 'events_research';
  if (w === 'nav' || w === 'transit') return 'nav_execute';
  // Taxi/Uber Just-Do-It → Fanout (taxi_rideshare), nicht reine Nav-Route
  if (w === 'taxi') return 'task_fanout';
  if (w === 'm1' || w === 'm1_poi') return 'm1_poi';
  // Identify-Nearby: Fanout-Hook (Pack-Match), nicht voller M1-Story-Pfad
  if (w === 'identify_nearby') return 'task_fanout';
  // memory_recall braucht Fanout-Hook (Visit-Log Worker), nicht nur earlyJustDoIt
  if (w === 'memory_recall') return 'task_fanout';
  if (w === 'memory_prefs') return 'memory';
  if (w === 'reisebuero') return 'reisebuero';
  if (
    w === 'weather' ||
    w === 'timer_alarm' ||
    w === 'timeline_reminder' ||
    w === 'fact' ||
    w === 'map_pin' ||
    w === 'voice_settings' ||
    w === 'device_action'
  ) {
    return 'task_fanout';
  }
  if (w === 'chat') return 'chat_lane';
  return 'chat_lane';
}

/**
 * Phase C SSOT: mehrere Worker → eine Execution.
 * Unterschiedliche Hints → task_fanout; sonst dominante Familie.
 */
export function executionFromWorkers(
  workers: Call1WorkerId[],
): Call1ExecutionHint {
  const uniq = [...new Set(workers.filter(Boolean))];
  if (!uniq.length) return 'chat_lane';

  // Einzel-Wetter bleibt leichtgewichtig (Chat), Kombi → Fanout
  if (uniq.length === 1 && uniq[0] === 'weather') return 'chat_lane';

  const hints = uniq.map(workerToExecutionHint);
  const distinct = [...new Set(hints)];
  if (distinct.length >= 2) return 'task_fanout';

  // Priorität innerhalb einer Hint-Familie (falls gemischt gemappt)
  if (uniq.includes('flight')) return 'flight_advisor';
  if (uniq.includes('events')) return 'events_research';
  if (uniq.includes('reisebuero')) return 'reisebuero';
  if (uniq.includes('tour')) return 'tour_module';
  if (uniq.includes('plan')) return 'plan_module';
  if (uniq.some(isPlaceFamilyWorker)) return 'pitch_module';
  if (uniq.includes('taxi')) return 'task_fanout';
  if (uniq.includes('nav') || uniq.includes('transit')) return 'nav_execute';
  if (
    uniq.includes('m1') ||
    uniq.includes('m1_poi')
  ) {
    return 'm1_poi';
  }
  if (uniq.includes('identify_nearby')) {
    return 'task_fanout';
  }
  if (uniq.includes('memory_prefs') && !uniq.includes('memory_recall')) {
    return 'memory';
  }
  if (uniq.includes('memory_recall') || uniq.includes('deep_web')) {
    return 'task_fanout';
  }
  return hints[0] ?? 'chat_lane';
}

/** ManagerTask.lane aus Worker — für task_fanout. */
export function workerToManagerLane(
  w: Call1WorkerId,
):
  | 'weather'
  | 'pack'
  | 'places'
  | 'hours'
  | 'walk_eta'
  | 'web_events'
  | 'dining'
  | 'cinema'
  | 'amenity'
  | 'parking'
  | 'combo'
  | 'knowledge'
  | 'other' {
  if (w === 'weather') return 'weather';
  if (isPlaceFamilyWorker(w) || w === 'place') return 'dining';
  if (w === 'events') return 'web_events';
  if (w === 'fact' || w === 'deep_web') return 'knowledge';
  if (w === 'nav' || w === 'transit' || w === 'taxi') return 'walk_eta';
  if (w === 'm1' || w === 'm1_poi') return 'pack';
  if (w === 'identify_nearby') return 'pack';
  if (w === 'map_pin') return 'places';
  if (w === 'voice_settings' || w === 'device_action') return 'other';
  return 'other';
}
