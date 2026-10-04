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
  | 'cruise_quick'
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
    'GELÄNDER Flug Leave-by (Tipp): Staging — (1) Ziel würdigen in Bridge. Fehlt Abflugzeit/Nummer → sofort nur danach fragen, KEINE Abflugtafel-/Preis-Recherche vorher. (2) Mit Uhr/Nummer: Flug matchen (±45 Min) → Gepäck-Chips (Aufgabe/Hand) VOR Leave-by. (3) Timeline rückwärts + Terminal-Zeit → Puffer-Frage. (4) Dann ÖPNV vs Taxi. (5) Taxi → Uber Deep-Link. Explizites morgen/heute nicht überschreiben. Wortlaut frei.',
  ],
};

const WEATHER: Call1AnswerContract = {
  family: 'weather',
  // Neuer Wetter-Opener ≠ Follow-up an Nav/Pitch-POI (Tennis-Sticky).
  topicCut: true,
  neededSlots: ['temp_c', 'sky', 'rain_timing', 'clothing_hint'],
  researchSlots: ['weather_live'],
  call2Tips: [
    'GELÄNDER Wetter: Speech flüssig (Himmel + °C + Regen belegt), dann kurze Kleidung. Stichpunkte = FACT-CHIPS (z. B. „Wechselhaft · bis 24°“, „Heute kein Regen“) — nie Prosa-Sätze. Regen-Frage: zuerst nur Regen-Antwort. Strand/Tour-Frage: Slot beach_ok / rain_timing + Intent beantworten („passt für die Tour“). Nie Navigation starten. Kein Hilfe-Katalog, kein Abendplan/Sunset, kein Sticky-POI. Wortlaut frei.',
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
    'GELÄNDER Reisebüro (Tipp): Call 1 fragt sich: Geht’s um die REISE AN SICH (Flug/Hotel/Anreise/Inspiration/„was davor?“)? Dann execution=reisebuero — Board füllen, eine Lücke. Reines Hotel+Amenity ohne Zielstadt = lokal pitch_module/Stay22. Produkt „im Angebot“ = chat_lane, nie Reisebüro. Wortlaut frei.',
    'Gegenpol (selbst erkennen): Ort/Fenster schon klar und Frage nur „was geht / was ist möglich“ → events_research bzw. stay_day_interactive — nicht Reisebüro nur wegen Datum+Stadt.',
  ],
};

/** Kreuzfahrt-Schnellsuche — Top-Struktur + Partner-Links, kein Briefing-Marathon. */
const CRUISE_QUICK: Call1AnswerContract = {
  family: 'cruise_quick',
  topicCut: true,
  neededSlots: [
    'when_or_month',
    'embark_bias_or_port',
    'pax',
    'cabin_or_suite',
    'amenities_party_family_spa',
    'budget_or_cheapest',
  ],
  researchSlots: [
    'cruise_search_brief',
    'partner_links_check24_aida',
    'top2_sailings_if_priced',
    'optional_reisebuero_chip',
  ],
  call2Tips: [
    'GELÄNDER Kreuzfahrt Quick: Wünsche (Pool/Rutsche/Laufbahn/Sauna/Kids/Teens/Party/Rentner) → 1–2 passende Schiffe + warum, sonst ehrliche Gap + Vergleichs-Links. Inklusiv-FAQ: belegte Inkl./Extra/Pakete. Kein Hotel-Briefing. Preise/Segeltermine nur belegt. Chip „Als Reise planen“ wenn Flug/Vornacht nötig. Wortlaut frei.',
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
    'GELÄNDER Aufenthalts-Tag (Tipp): Ort/Fenster klar, Frage = was vor Ort möglich (Highlights, Events, Abend) — nicht die Reise buchen. Pitch/Events/Tour in Timeline. Call 1 erkennt die Absicht selbst. Wortlaut frei.',
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
    'GELÄNDER Compound / Multi-Lane (Tipp): Bridge war nur Verstehen. Call 1 startet parallele Recherchen (z. B. Kino+Theater Genre, oder Fetch+Aussicht). Backend: Cascade Zwei-Strang Perfect+Backtrack — alle Hard-Musts parallel abhaken. Fetch→Spot: Fetch nah am Spot ranken; nach Wahl Multi-Stop + Speisekarte. Shortlist ~3–5 → Call-2 filtert hart → Speak Top-2 Must-Fit (ein Perfect reicht nicht). Soft leer → nachschärfen, kein Soft-Fill. Fehlende Slots in Speech weglassen (kein „leider keine Preise“). Call 3 = Speisekarte/Gerichtspreis. Nach Wahl: jetzt Nav oder später Timeline + Leave-by. Wortlaut frei.',
    'Leer lokal: nächste gecachte Packs / Live-Expand / Discovery-Harvest / Radius wächst — weit gefunden → Distanz ehrlich nennen. Nie Fake-Treffer am Heimatdorf.',
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

const THEATRE: Call1AnswerContract = {
  family: 'cinema',
  topicCut: false,
  neededSlots: ['venues', 'program_urls', 'show_times'],
  researchSlots: ['cinema_program'],
  call2Tips: [
    'GELÄNDER Theater/Spielplan: Stücke/Vorstellungen zuerst (nicht Kino), 1–2 Häuser mit Uhrzeiten wenn belegt, Programm/Ticket-Buttons. Wortlaut frei.',
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
  topicCut: true,
  neededSlots: ['dest_name', 'eta_min', 'mode'],
  researchSlots: ['route_eta'],
  call2Tips: [
    'GELÄNDER Nav: Nur Zusagen + Ziel + ETA aus Backend. Keine Pack-/M1-Story, keine Historie, keine Fake-Route. Wortlaut frei.',
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
    'GELÄNDER Trivia/Kurzfakt: 1–2 knappe Sätze — Zahl/Name zuerst, optional eine Belegquelle. Kein Essay, keine Zusatz-Tour/Öffnungszeiten ungefragt. Stichpunkte: eine klare Zahl (z. B. ca. 2300 Einwohner) — deutsche Tausender nicht mit Punkt splitten. Rechenfragen: nur die Zahl. Wortlaut frei.',
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
  // Kreuzfahrt: Inklusiv-FAQ / Quick → chat_lane; Paket → Reisebüro
  try {
    const { looksLikeCruiseInclusionAsk } = require('../../planning/cruiseInclusionsFaq') as {
      looksLikeCruiseInclusionAsk: (s: string) => boolean;
    };
    if (looksLikeCruiseInclusionAsk(t)) return 'cruise_quick';
  } catch {
    /* soft */
  }
  try {
    const {
      isCruisePackageHandoff,
      isCruiseQuickPitch,
    } = require('../../../reisebuero/handoff') as {
      isCruisePackageHandoff: (s: string) => boolean;
      isCruiseQuickPitch: (s: string) => boolean;
    };
    if (isCruisePackageHandoff(t)) return 'reisebuero_collect';
    if (isCruiseQuickPitch(t)) return 'cruise_quick';
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
  // Flug + Taxi vorbestellen = Leave-by-Kette, kein Reisebüro / Explore
  try {
    const { looksLikeTaxiWithFlight } = require('../../router/call1MobilityCompound') as {
      looksLikeTaxiWithFlight: (s: string) => boolean;
    };
    if (looksLikeTaxiWithFlight(t)) return 'flight_leave_by';
  } catch {
    /* soft */
  }
  if (
    /\b(flug|fliegen|flieger|flieg(?:e|st|t)?|abflug|flughafen)\b/iu.test(t) &&
    /\b(taxi|uber|bolt)\b/iu.test(t)
  ) {
    return 'flight_leave_by';
  }
  if (
    /\b(wecker|timer|erinner\s+mich|weck\s+mich)\b/iu.test(t)
  ) {
    return 'alarm_timer';
  }
  if (/\b(navigier\w*|führ\s+mich|fuehr\s+mich|bring\s+mich|route\s+nach)\b/iu.test(t)) {
    return 'navigation';
  }
  if (/\b(kino|filme?\s+laufen|kinoprogramm|open[\s-]?air|freiluftkino)\b/iu.test(t)) {
    // Open-Air + Programm → Compound (Wetter-Gate parallel)
    if (
      /\b(open[\s-]?air|openair|freiluft|sommerkino|unter\s+freiem\s+himmel)\b/iu.test(
        t,
      )
    ) {
      return 'dining_compound';
    }
    // Kino + Theater in einem Satz → Multi-Lane or_either (nicht nur Kino)
    if (
      /\b(theater|theatre|schauspiel|musical|bühne|buehne|kabarett)\b/iu.test(t) &&
      /\b(oder|bzw\.?|beziehungsweise|entweder|egal\s+ob|heute|gehen|möcht)\b/iu.test(
        t,
      )
    ) {
      return 'dining_compound';
    }
    return 'cinema';
  }
  // Theater/Schauspiel → Events (nicht Kino-Pitch)
  if (
    /\b(theater|theatre|theaterstück|theaterstueck|schauspiel|musical|bühne|buehne)\b/iu.test(
      t,
    ) &&
    !/\b(kino|film|cinema)\b/iu.test(t)
  ) {
    return 'stay_day_interactive';
  }
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
  // Datumsspanne + was geht/Events in Stadt → Event-Recherche, kein Reisebüro
  let dateWindowWhatsOn = false;
  try {
    const { looksLikeDateWindowWhatsOnAsk } = require('../../../services/concierge/eventDateWindow') as {
      looksLikeDateWindowWhatsOnAsk: (s: string) => boolean;
    };
    dateWindowWhatsOn = looksLikeDateWindowWhatsOnAsk(t);
  } catch {
    dateWindowWhatsOn = false;
  }
  if (dateWindowWhatsOn) {
    return 'stay_day_interactive';
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
    /\b(essen|restaurant|pannfisch|steak|döner|doener|pizza|sushi|imbiss|abendessen|mittagessen|gastro|eis|gelato|eisdiele|eissalon|to[\s-]?go)\b/iu.test(
      t,
    );
  const compoundExtra =
    /\b(sonnenuntergang|sunset|elbblick|meerblick|hafen|hafenblic|aussicht|blick\s+auf|terrasse|live[\s-]?musik|live[\s-]?music|konzert|band|schön\s+sitzen|genießen|geniessen)\b/iu.test(
      t,
    );
  // Essen + Live-Musik / Aussicht = Compound — beide Musts parallel abhaken
  if (dining && compoundExtra) return 'dining_compound';
  if (
    /\b(live[\s-]?musik|live[\s-]?music)\b/iu.test(t) &&
    /\b(essen|restaurant|abend|gastro|kneipe|bar)\b/iu.test(t)
  ) {
    return 'dining_compound';
  }
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
    case 'cruise_quick':
      return CRUISE_QUICK;
    case 'stay_day_interactive':
      return STAY_DAY;
    case 'dining_compound':
      return DINING_COMPOUND;
    case 'dining_simple':
      return DINING_SIMPLE;
    case 'interest_activity':
      return INTEREST_ACTIVITY;
    case 'cinema':
      return /\b(theater|theatre|theaterstück|theaterstueck|schauspiel|musical|bühne|buehne)\b/iu.test(
        userText,
      )
        ? THEATRE
        : CINEMA;
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
