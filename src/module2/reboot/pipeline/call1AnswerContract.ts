/**
 * Call-1 → Call-2 Antwort-Vertrag: Tipps/Geländer, keine Pflicht-Sätze.
 * Call 1 sagt, WAS Call 2 braucht; Backend füllt Fakten; Call 2 entscheidet Wortlaut.
 */

export type Call1SituationFamily =
  | 'flight_leave_by'
  | 'weather'
  | 'day_plan'
  | 'reisebuero_collect'
  | 'stay_day_interactive'
  | 'dining_compound'
  | 'dining_simple'
  | 'interest_activity'
  | 'cinema'
  | 'alarm_timer'
  | 'navigation'
  | 'history_poi'
  | 'correction'
  | 'product_offer'
  | 'generic';

export type Call1AnswerContract = {
  family: Call1SituationFamily;
  /** Was Call 2 aus dem Backend erwarten darf (Slots) */
  neededSlots: string[];
  /** Tipps zur Antwort-Form — Hang-on, Wortlaut frei */
  call2Tips: string[];
  /** topicScope: neues Thema → keine Chat-Historie */
  topicCut: boolean;
  /** Research-Slots die parallel laufen sollen */
  researchSlots: string[];
};

const FLIGHT_LEAVE_BY: Call1AnswerContract = {
  family: 'flight_leave_by',
  topicCut: false,
  neededSlots: [
    'flight_number',
    'origin_iata',
    'destination_iata',
    'scheduled_departure',
    'terminal',
    'gate',
    'checkin_desk',
    'baggage_type',
    'leave_by_ms',
    'security_buffer_min',
  ],
  researchSlots: [
    'nearest_airport_gps',
    'origin_board_or_api',
    'flight_match_clock_snap',
    'leave_by_math',
    'timeline_upsert',
    'access_oepnv_taxi',
  ],
  call2Tips: [
    'GELÄNDER Flug Leave-by (Tipp): Staging — (1) Ziel würdigen in Bridge, keine Uhrzeit-Frage in Bridge. (2) Fehlt Abflug/Nummer → nur nachfragen, keine Actions. (3) Flug matchen (±45 Min) → Gepäck-Chips (Aufgabe/Hand) VOR Leave-by. (4) Timeline rückwärts + Terminal-Zeit → Puffer-Frage (mehr/weniger/passt). (5) Dann ÖPNV vs Taxi mit Startzeiten/Preis. (6) Taxi → Uber Deep-Link mit Abholzeit. Neues Essen-Thema = topicCut. Wortlaut frei.',
  ],
};

const WEATHER: Call1AnswerContract = {
  family: 'weather',
  topicCut: false,
  neededSlots: ['temp_c', 'sky', 'rain_timing', 'clothing_hint'],
  researchSlots: ['weather_live'],
  call2Tips: [
    'GELÄNDER Wetter: Himmel + Temperatur + Regen nur belegt, dann Kleidung. Stichpunkte mit Ziffern. Wortlaut frei.',
  ],
};

const DAY_PLAN: Call1AnswerContract = {
  family: 'day_plan',
  topicCut: true,
  neededSlots: [
    'dest_city',
    'depart_hm',
    'travel_eta',
    'breakfast_slot',
    'dinner_slot',
    'sunset_hm',
    'landmark_qa',
    'explore_tour',
    'pitch_walk_order',
    'stay_or_home',
  ],
  researchSlots: [
    'timeline_seed',
    'transit_eta',
    'dest_city_pack',
    'breakfast_pitch',
    'sunset_time',
    'dinner_pitch',
    'landmark_facts_ticket',
    'explore_between_stops',
    'hotel_or_return',
  ],
  call2Tips: [
    'GELÄNDER Tagesplan (Tipp): Bridge = Plan würdigen + step-by-step. Backend öffnet Timeline mit Gerüst (Los → Frühstück-Pitch → Sunset/Abend-Pitch → Landmarke als Q&A ohne Top-2 → offene Tour). Call 2 walked offenen Pitch zuerst (Frühstück Top-2). Nach Wahl: Slot fest, Leave-by/Anreise. Ablehnung → neue Filter, gleiches Thema. Landmarke = Fakten/Ticket/Reviews, dann „Ticket gekauft?“ Zum Schluss: Übernachten vs Heimfahrt. Wortlaut frei.',
  ],
};

/** Trip mit Flug/Hotel/Wochenende/Urlaub — immer Reisebüro-Collect + finale Recherche. */
const REISEBUERO: Call1AnswerContract = {
  family: 'reisebuero_collect',
  topicCut: true,
  neededSlots: [
    'dest_city_or_open',
    'start_date',
    'end_date_or_nights',
    'pax',
    'budget',
    'flight_or_train_or_car',
    'hotel_or_apt',
    'rental_car',
    'mood_activities',
    'must_haves',
    'nice_to_haves',
  ],
  researchSlots: [
    'open_overlay',
    'seed_known_slots',
    'call1_gap_one_question',
    'board_insert',
    'funnel_when_complete',
    'pro_enrich_mandatory',
    'massive_live_backend',
  ],
  call2Tips: [
    'GELÄNDER Reisebüro (Tipp): Sobald Reise = Flug und/oder Hotel-in-Zielstadt und/oder Wochenende/Woche/Urlaub mit Ziel und/oder unscharfes Ziel → execution=reisebuero. Reines Hotel+Amenity ohne Zielstadt = lokal pitch_module/Stay22, kein Funnel. Genanntes Produkt/Prospekt „im Angebot“ / Supermarkt-Preise = chat_lane + Knowledge-Research, nie Reisebüro. Call 1 denkt: was haben wir, was fehlt. Code fragt nur die genannte Lücke. Finale erste Auswahl = Gemini Pro + Live. Wortlaut frei.',
    'Getrennt davon: Wenn Ort+Daten schon fest und User nur den Tag füllt (Highlights, Live-Musik Samstag) → nicht neu Reisebüro öffnen, sondern Timeline/Pitch/Events am bestehenden Aufenthalt (stay_day_interactive).',
  ],
};

/** Ort+Daten schon klar — interaktiv Timeline/Tour/Events am Tag, kein neues Reisebüro. */
const STAY_DAY: Call1AnswerContract = {
  family: 'stay_day_interactive',
  topicCut: false,
  neededSlots: [
    'day_key',
    'slot_wish',
    'highlights_or_event',
    'timeline_fit',
  ],
  researchSlots: [
    'dest_pack_or_live',
    'pitch_or_events',
    'tour_gap_fill',
    'timeline_insert',
  ],
  call2Tips: [
    'GELÄNDER Aufenthalts-Tag (Tipp): User ist schon „in Lissabon / am Wochenende“ eingeplant. Step-by-step: Highlights, Tour-Vorschläge, Abend (Live-Musik etc.) in die Timeline. Pitch/Events/Tour — kein Flug/Hotel-Funnel. Wortlaut frei.',
  ],
};

const DINING_COMPOUND: Call1AnswerContract = {
  family: 'dining_compound',
  topicCut: true,
  neededSlots: [
    'sunset_hm',
    'weather_at_sunset',
    'shortlist_top5',
    'criteria_scores',
    'timeline_nearby',
    'speak_top2',
  ],
  researchSlots: [
    'sunset_time',
    'weather_fit',
    'dining_filter_pack',
    'open_at_visit',
    'timeline_proximity',
  ],
  call2Tips: [
    'GELÄNDER Compound-Abend (Tipp): Bridge war nur Verstehen. Hauptantwort = 2 Orte mit Warum (Kriterien erfüllt). Sonnenuntergang + Wetter kurz einweben. Call 2 darf unter Shortlist umranken (Preis-Leistung, Blick) — Begründung intern, Speech menschlich. Wortlaut frei.',
    'Nach Wahl: jetzt Nav oder später Timeline + Leave-by — nicht beides erzwingen.',
  ],
};

const DINING_SIMPLE: Call1AnswerContract = {
  family: 'dining_simple',
  topicCut: false,
  neededSlots: ['shortlist_top5', 'speak_top2', 'hard_match'],
  researchSlots: ['places_plus_pack', 'hard_match_verify'],
  call2Tips: [
    'GELÄNDER Gastro: Favorit = Hard-Match + Reviews/Tags/Distanz/Öffnung. Alternative daneben. Speisekarte/Maps als Buttons. Wortlaut frei.',
  ],
};

const INTEREST_ACTIVITY: Call1AnswerContract = {
  family: 'interest_activity',
  topicCut: true,
  neededSlots: [
    'theme',
    'indoor_outdoor',
    'price_ticket',
    'distance_m',
    'access_mode',
    'duration_hint',
    'timeline_fit',
    'speak_top2',
  ],
  researchSlots: [
    'local_pack',
    'expand_50_100km',
    'places_live',
    'ticket_price',
    'route_eta',
  ],
  call2Tips: [
    'GELÄNDER Lust-auf-Aktivität (Tipp): Bridge verstehen. Backend: zuerst Pack am Ort, wenn leer → Umkreis 50–100 km / Live-Places bis ≥2 Optionen. Nie nur „nichts gefunden“. Call 2 = Pitch Top-2 mit Distanz, Preis/Ticket, Anreise. Follow-up gleiches Thema → Tickets/Preise vertiefen. Wortlaut frei.',
    'KOHÄRENZ (nur wenn’s passt): Outdoor/Wetter/Kleidung dosiert einweben — wenn Aktivität draußen ist und heute noch nicht gesagt. Nie erzwingen, nie bei Indoor-Museum Pflicht-Outfit. Timeline-Fit nur wenn Plan offen und Slot sinnvoll.',
  ],
};

const CINEMA: Call1AnswerContract = {
  family: 'cinema',
  topicCut: false,
  neededSlots: ['film_picks', 'venues', 'program_urls'],
  researchSlots: ['cinema_program'],
  call2Tips: [
    'GELÄNDER Kino Orient: Filme/Programm zuerst, Kinos als Träger. Zeiten nach Film-Wahl. Wortlaut frei.',
  ],
};

const ALARM: Call1AnswerContract = {
  family: 'alarm_timer',
  topicCut: false,
  neededSlots: ['alarm_time', 'label'],
  researchSlots: ['alarm_commit'],
  call2Tips: [
    'GELÄNDER Wecker/Timer: Eine klare Bestätigung der gesetzten Zeit — kurz wie ein Beleg. Wortlaut frei.',
  ],
};

const NAV: Call1AnswerContract = {
  family: 'navigation',
  topicCut: false,
  neededSlots: ['dest_name', 'eta_min', 'mode'],
  researchSlots: ['route_eta'],
  call2Tips: [
    'GELÄNDER Nav: Ziel + ETA aus Backend. Keine Fake-Route. Wortlaut frei.',
  ],
};

const HISTORY: Call1AnswerContract = {
  family: 'history_poi',
  topicCut: false,
  neededSlots: ['poi_name', 'story_facts'],
  researchSlots: ['pack_story', 'm1'],
  call2Tips: [
    'GELÄNDER Historie: Belegte Fakten aus Pack/Wiki, immersiv, max Länge laut Modul-1. Wortlaut frei.',
  ],
};

const CORRECTION: Call1AnswerContract = {
  family: 'correction',
  topicCut: false,
  neededSlots: ['previous_topic', 'reject_reason', 'new_filters'],
  researchSlots: ['re_search_same_family'],
  call2Tips: [
    'GELÄNDER Korrektur: User lehnt ab → gleicher Faden, neue Filter/Optionen. Kein Themen-Sprung ohne klaren Cut. Wortlaut frei.',
  ],
};

const PRODUCT_OFFER: Call1AnswerContract = {
  family: 'product_offer',
  topicCut: true,
  neededSlots: [
    'nearby_markets',
    'prospect_offers',
    'product_prices',
    'prospect_deep_links',
  ],
  researchSlots: ['supermarket_prospect'],
  call2Tips: [
    'GELÄNDER Supermarkt-Prospekt: GPS-nahe Märkte → aktueller Prospekt → genanntes Produkt filtern → Preise nur belegt + Deep-Link-Buttons. Nie Ambient-/Dining-Pitch, nie toter Flug/Stadt-Sticky. Hollow-Homepages weglassen. Wortlaut frei.',
  ],
};

const GENERIC: Call1AnswerContract = {
  family: 'generic',
  topicCut: false,
  neededSlots: ['answer_fact'],
  researchSlots: ['knowledge_or_chat'],
  call2Tips: [
    'GELÄNDER: Answer-First aus belegten Fakten. Bridge nicht wiederholen. Wortlaut frei.',
  ],
};

const TRIVIA: Call1AnswerContract = {
  family: 'generic',
  topicCut: true,
  neededSlots: ['answer_fact'],
  researchSlots: ['knowledge_or_chat'],
  call2Tips: [
    'GELÄNDER Trivia: Direkte Antwort zuerst (Zahl/Name). 1–2 kurze Fun-Facts nur belegt. Keine Regie/Stimm-Anweisungen. Stichpunkte: Alter/Name/Datum — keine nackten Gattungs-Labels. Wortlaut frei.',
  ],
};

/** Erkennt Situation aus User-Text + optionalen Flags. */
export function detectCall1Situation(
  userText: string,
  opts?: { correction?: boolean; pitchReject?: boolean },
): Call1SituationFamily {
  const t = (userText || '').replace(/\s+/g, ' ').trim();
  if (opts?.correction || opts?.pitchReject) return 'correction';
  // Produkt/Prospekt vor Flug-/Dining-/Reisebüro — nie Pitch
  try {
    const { isSupermarketOfferQuery } = require('../../../services/research/supermarketProspectGates') as {
      isSupermarketOfferQuery: (s: string) => boolean;
    };
    if (isSupermarketOfferQuery(t)) return 'product_offer';
  } catch {
    /* soft */
  }
  if (
    /\b(wann\s+(muss|soll)\s+ich\s+(los|aufbrechen|am\s+flughafen)|leave.?by|am\s+flughafen\s+sein)\b/iu.test(
      t,
    ) ||
    (/\b(flug|flughafen|gate|terminal|check-?in)\b/iu.test(t) &&
      /\b(wann|los|aufbrechen)\b/iu.test(t))
  ) {
    return 'flight_leave_by';
  }
  if (
    /\b(wecker|timer|erinner\s+mich|weck\s+mich)\b/iu.test(t)
  ) {
    return 'alarm_timer';
  }
  if (/\b(navigier|führ\s+mich|bring\s+mich|route\s+nach)\b/iu.test(t)) {
    return 'navigation';
  }
  if (/\b(kino|filme?\s+laufen|kinoprogramm)\b/iu.test(t)) return 'cinema';
  if (
    /\b(wetter|anziehen|outfit|regnet|sonne|grad)\b/iu.test(t) &&
    !/\b(restaurant|essen|pannfisch|steak)\b/iu.test(t)
  ) {
    return 'weather';
  }
  if (
    /\b(historie|geschichte|erzähl|mehr\s+dazu|wo\s+bin\s+ich)\b/iu.test(t) &&
    !/\b(plan|frühstück|fruehstueck|morgen\s+nach)\b/iu.test(t)
  ) {
    return 'history_poi';
  }
  // Multi-Slot-Tag (Stadt + Los + ≥2 Ziele) vor reinem Gastro-Compound
  // Remote-Wochenende (Lissabon …) nicht als lokaler day_plan
  // „Wochenendurlaub“ = ein Token — nicht nur \bwochenende\b
  const remoteWeekendCue =
    /\b(wochenende|wochenendurlaub|kurztrip|städtetrip|staedtetrip)\b/iu.test(
      t,
    ) &&
    /\b(nach|in)\s+[A-Za-zÄÖÜäöüß]{3,}/u.test(t) &&
    !/\b(frühstück|fruehstueck|pann(?:en)?fisch|michel)\b/iu.test(t);
  const dayPlan =
    !remoteWeekendCue &&
    (/\b(plan|stell\s+mir|durchgeh|timeline)\b/iu.test(t) ||
      (/\b(morgen|übermorgen|uebermorgen)\b/iu.test(t) &&
        /\b(nach\s+\w+|fahren|los)\b/iu.test(t) &&
        [
          /\b(frühstück|fruehstueck|breakfast)\b/iu,
          /\b(abend|dinner|pann(?:en)?fisch|elbblick|sonnenuntergang)\b/iu,
          /\b(michel|museum|erkunden|tour|aussicht)\b/iu,
        ].filter((rx) => rx.test(t)).length >= 2));
  if (dayPlan) return 'day_plan';
  const tripHorizon =
    /\b(wochenende|wochenendurlaub|kurztrip|städtetrip|staedtetrip|urlaub|ferien|urlaubsplan|eine\s+woche)\b/iu.test(
      t,
    ) ||
    /\b(\d+|zwei|drei|vier|fünf|fuenf)\s+tage?\b/iu.test(t) ||
    /\bin\s+(zwei|drei|\d+)\s+wochen?\b/iu.test(t) ||
    /\bnächste[rn]?\s+(woche|wochenende|monat)\b/iu.test(t);
  const tripStartCue =
    remoteWeekendCue ||
    /\b(wochenende|wochenendurlaub|urlaub|kurztrip)\s+(nach|in)\b/iu.test(t) ||
    /\bfür\s+(ein\s+)?wochenende\s+nach\b/iu.test(t) ||
    /\bplane\s+mir\b/iu.test(t) ||
    /\bin\s+(zwei|drei|\d+)\s+wochen?\b/iu.test(t);
  // Interaktiv am schon festen Aufenthalt (Tag füllen) — kein neues Reisebüro
  const stayDayFill =
    /\b(samstag|sonntag|freitag|heute\s+abend|am\s+abend).{0,48}(live\s*musik|konzert|was\s+geht|vorschlagen|highlights?)\b/iu.test(
      t,
    ) ||
    /\b(highlights?|was\s+kann\s+man\s+(noch\s+)?machen|tour\s+vorschlag|timeline\s+füll|füll.*timeline)\b/iu.test(
      t,
    );
  if (
    stayDayFill &&
    !tripStartCue &&
    !/\b(flug|fliegen|mietwagen|hotel\s+suchen|irgendwo|reisebüro|reisebuero)\b/iu.test(
      t,
    )
  ) {
    return 'stay_day_interactive';
  }
  // Produkt/Prospekt „irgendwo im Angebot“ ≠ Reiseziel — nie Reisebüro
  let namedProductOfferNearby = false;
  try {
    const { isSupermarketOfferQuery } = require('../../../services/research/supermarketProspectGates') as {
      isSupermarketOfferQuery: (s: string) => boolean;
    };
    namedProductOfferNearby = isSupermarketOfferQuery(t);
  } catch {
    /* soft */
  }
  // Reisebüro: Wochenende/Woche/Urlaub, Flug+Hotel, offenes Ziel — nicht Solo-Flug Leave-by
  // Nacktes „irgendwo“ (z. B. „Bier irgendwo im Angebot“) ist KEIN offenes Reiseziel.
  const openTrip =
    !namedProductOfferNearby &&
    /\b(inspiration|wo\s+hin|irgendwohin|irgendwo.{0,40}(?:warm|hin|weg|fliegen|urlaub)|warm\s+irgendwo|reisebüro|reisebuero|urlaubsplan)\b/iu.test(
      t,
    );
  const flightPlusStay =
    /\b(flug|fliegen|flieger)\b/iu.test(t) &&
    /\b(hotel|übernacht|uebernacht|unterkunft|mietwagen|ferienhaus)\b/iu.test(t);
  const namedTrip =
    tripHorizon &&
    /\b(nach|in)\s+[A-Za-zÄÖÜäöüß]{3,}/u.test(t) &&
    !/\b(jetzt|heute\s+abend|hier\s+in\s+der\s+nähe)\b/iu.test(t);
  if (
    !namedProductOfferNearby &&
    (openTrip || flightPlusStay || namedTrip || remoteWeekendCue)
  ) {
    return 'reisebuero_collect';
  }
  // Lust auf Aktivität / Sehen (Dinosaurier, Zoo, …) vor reinem Gastro
  if (
    /\b(lust|bock|möcht|moecht|will)\b/iu.test(t) &&
    /\b(sehen|anschauen|anschau|besuchen|hin)\b/iu.test(t) &&
    /\b(dinosaur|dinosaurier|dino\b|museum|zoo|aquarium|aussicht|turm)\b/iu.test(
      t,
    )
  ) {
    return 'interest_activity';
  }
  if (
    /\b(dinosaur|dinosaurier|dino\b|t[-\s]?rex)\b/iu.test(t) &&
    /\b(sehen|anschauen|lust|bock|museum|wo)\b/iu.test(t)
  ) {
    return 'interest_activity';
  }
  const dining =
    /\b(essen|restaurant|pannfisch|steak|döner|doener|pizza|sushi|imbiss)\b/iu.test(
      t,
    );
  const compoundExtra =
    /\b(sonnenuntergang|sunset|elbblick|meerblick|terrasse)\b/iu.test(t);
  if (dining && compoundExtra) return 'dining_compound';
  if (dining) return 'dining_simple';
  return 'generic';
}

export function getCall1AnswerContract(
  userText: string,
  opts?: { correction?: boolean; pitchReject?: boolean },
): Call1AnswerContract {
  const family = detectCall1Situation(userText, opts);
  // Quick-Lookup / Trivia: immer Topic-Cut — keine fremde Chat-Historie.
  try {
    const { isQuickLookupQuery } = require('../../../services/concierge/celestialSkyQuery') as {
      isQuickLookupQuery: (s: string) => boolean;
    };
    if (isQuickLookupQuery(userText) && family === 'generic') {
      return TRIVIA;
    }
  } catch {
    /* soft */
  }
  switch (family) {
    case 'flight_leave_by':
      return FLIGHT_LEAVE_BY;
    case 'weather':
      return WEATHER;
    case 'day_plan':
      return DAY_PLAN;
    case 'reisebuero_collect':
      return REISEBUERO;
    case 'stay_day_interactive':
      return STAY_DAY;
    case 'dining_compound':
      return DINING_COMPOUND;
    case 'dining_simple':
      return DINING_SIMPLE;
    case 'interest_activity':
      return INTEREST_ACTIVITY;
    case 'cinema':
      return CINEMA;
    case 'alarm_timer':
      return ALARM;
    case 'navigation':
      return NAV;
    case 'history_poi':
      return HISTORY;
    case 'correction':
      return CORRECTION;
    case 'product_offer':
      return PRODUCT_OFFER;
    default:
      return GENERIC;
  }
}

/** Prompt-Block für Call 2 / Pitch-Speech. */
export function formatCall1AnswerContractForPrompt(
  contract: Call1AnswerContract,
): string {
  return [
    `=== CALL1→CALL2 VERTRAG (${contract.family}) ===`,
    `NEEDED_SLOTS: ${contract.neededSlots.join(', ')}`,
    `RESEARCH: ${contract.researchSlots.join(' → ')}`,
    contract.topicCut
      ? 'TOPIC: neu — keine fremde Chat-Historie mischen.'
      : 'TOPIC: Follow-up ok wenn gleicher Faden.',
    ...contract.call2Tips,
    'Call 2 = Hauptantwort aus Backend-Fakten. Bridge nicht wiederholen. Nichts erfinden.',
  ].join('\n');
}
