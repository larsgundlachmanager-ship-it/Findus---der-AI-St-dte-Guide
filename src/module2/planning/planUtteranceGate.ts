/**
 * Modul 5 — Erkennung: Tagesplan / Planung (SSOT für Mic-Gate).
 *
 * Outfit/Wetter („was anziehen“) ist KEIN Plan — sonst kapert „heute Abend“ Modul 5.
 * Einzelauftrag (Hotel / Restaurant / Museum …) ist Just-Do-It — keine Timeline.
 * Chaotische Multi-Wünsche (Meeting + Frühstück + Essen + Party …) → immer Modul 5.
 */

/** Kleidung / Wetter / Outfit — gehört zu umwelt, nicht Timeline. */
export function looksLikeOutfitOrWeatherUtterance(text: string): boolean {
  const t = (text ?? '').replace(/\s+/g, ' ').trim();
  if (!t) return false;
  return (
    /\b(anzieh(?:en)?|anziehen|outfit|kleidung|was\s+soll\s+ich\s+an|was\s+zieh)\b/i.test(
      t,
    ) ||
    (/\b(jacke|windjacke|pulli|hoodie|kurze\s+hose|lange\s+hose|schirm|sonnencreme)\b/i.test(
      t,
    ) &&
      /\b(soll|empfehl|brauch|mitnehm|wetter|abend|heute)\b/i.test(t)) ||
    (/\b(wetter|regen|temperatur|grad|wie\s+kalt|wie\s+warm)\b/i.test(t) &&
      !/\b(plan(e|en|ung)|einplanen|timeline|kalender)\b/i.test(t))
  );
}

/** Jetzt/Gerade — Nacht-Snap ok, kein Tages-Ausblick erzwingen. */
export function weatherAskIsImmediateNow(text: string): boolean {
  const t = (text ?? '').replace(/\s+/g, ' ').trim();
  if (!t) return false;
  return (
    /\b(jetzt|gerade|im moment|momentan|aktuell)\b/i.test(t) ||
    /\b(regnet|schneit's|schneit|gibt's regen|regnet es)\b/i.test(t)
  );
}

/**
 * Explizit lokal: „Wetter hier“ / „vor Ort“ → GPS.
 * Genannte Stadt im Satz schlägt „hier“ („Wetter hier in Athen“ → Athen).
 */
export function weatherAskWantsLocalGps(text: string): boolean {
  const t = (text ?? '').replace(/\s+/g, ' ').trim();
  if (!t) return false;
  try {
    const { extractCityFromText } = require('../context/shortTermContext') as {
      extractCityFromText: (s: string) => string | null;
    };
    if (extractCityFromText(t)) return false;
  } catch {
    /* soft */
  }
  return /\b(hier|vor\s+ort|wo\s+ich\s+(?:gerade\s+)?(?:bin|stehe)|an\s+meinem\s+standort|meine(?:r)?\s+(?:gps[-\s]?)?position)\b/iu.test(
    t,
  );
}

/**
 * Frühmorgens „heute“ = Tagesprognose, nicht 03-Uhr-Nachtmodus (außer „jetzt/gerade“).
 */
export function weatherAskIsTodayDayAhead(text: string, hour?: number): boolean {
  const t = (text ?? '').replace(/\s+/g, ' ').trim();
  if (!t) return false;
  const h = hour ?? new Date().getHours();
  if (h > 5) return false;
  if (weatherAskIsFutureDay(t)) return false;
  if (weatherAskIsImmediateNow(t)) return false;
  return (
    /\bheut(?:e|en)\b/i.test(t) ||
    (/\b(wetter|temperatur|grad|wie wird)\b/i.test(t) &&
      !/\b(morgen|übermorgen|uebermorgen)\b/i.test(t))
  );
}

/** Morgen/Übermorgen -- nicht den Jetzt-Snap als ganze Antwort nehmen. */
export function weatherAskIsFutureDay(text: string): boolean {
  const t = (text ?? '').replace(/\s+/g, ' ').trim();
  if (!t) return false;
  if (/\bheut(?:e)?\s+morgen\b/iu.test(t)) return false;
  return /\b(morgen|übermorgen|uebermorgen)\b/iu.test(t);
}

/**
 * Tipps was nachschlagen -- kein Script, keine Lane.
 * Stadtbummel/Wetter bleibt Antwort; Timeline nur lesen wenn gefüllt.
 */
export function weatherOutfitLookupTips(text: string): string {
  const future = weatherAskIsFutureDay(text);
  const outfitAsk =
    /\b(anzieh(?:en)?|outfit|kleidung|was\s+soll\s+ich\s+an|was\s+zieh)\b/i.test(
      text ?? '',
    );
  return [
    'GELÄNDER Wetter/Kleidung (Wortlaut frei, locker wie ein lokaler Freund, keine Timeline öffnen):',
    future
      ? '- Gefragter Tag ist nicht heute — Vorhersage für diesen Tag, nicht den Jetzt-Snap als ganze Antwort.'
      : '- Gefragter Tag: heute, Live-Zahlen.',
    '- Stadt: GPS/aktueller Ort, außer der User nennt eine andere.',
    '- Speech immer (nur belegt, nie erfinden): Himmel (Sonne/Wolken), Temperatur von–bis oder Spitze, wann Regen/Schauer, ein Kleidungstipp.',
    '- Stichpunkte dieselben drei: 1) Himmel 2) Temperatur 3) Kleidung (bei Nässe Jacke/Schirm im Tipp).',
    '- Ton: locker, flüssig — kein Behörden-Wetterbericht, keine Aufzählung wie eine Liste vorlesen.',
    '- VERBOTEN: Aushang, schwarzes Brett, Bahnhof, „selber nachgucken“ als Wetter-Antwort; kein Gewitter ohne Beleg.',
    outfitAsk
      ? '- Outfit gefragt: Kleidung etwas präsenter, Wetter kurz als Begründung.'
      : '- Nur Wetter gefragt: Wetter vorne, Kleidung ein kurzer Tipp hinten — Jacke nicht erzwingen wenn mild/trocken.',
    '- Timeline nur mitdenken wenn dort schon Stops stehen; leer → ignorieren, nichts eintragen.',
  ].join('\n');
}

const SINGLE_NEED_RE =
  /\b(hotel|übernacht|uebernacht|unterkunft|zimmer|hostel|airbnb|pension|motel|restaurant|essen\s+gehen|was\s+zu\s+essen|was\s+essen|zum\s+essen|mittagessen|abendessen|frühstück|fruehstueck|café|cafe|speisekarte|menükarte|menuekarte|bäckerei|baeckerei|bäcker|baecker|bakery|museum|bungee|aktivität|aktivitaet|wasserski|kletter|escape\s*room|welches\s+museum|kino|cinema|filmtheater|kinoprogramm|vorstellung|film\s+schauen|ins\s+kino|wanderweg|wanderung|lehrpfad|fahrradweg|radweg|radroute|radtour|fernradweg|veloroute|aldi|lidl|supermarkt|apotheke|tankstelle)\b/i;

/** Kategorien für Multi-Wunsch-Chaos (Hamburg-Tag-Stil). */
const NEED_BUCKETS: Array<{ id: string; re: RegExp }> = [
  {
    id: 'meeting',
    re: /\b(meeting|termin|besprechung|call|laptop|homeoffice|arbeitstreffen)\b/i,
  },
  {
    id: 'breakfast',
    re: /\b(frühstück(?:en)?|fruehstueck(?:en)?|breakfast)\b/i,
  },
  {
    id: 'lunch',
    re: /\b(mittag(essen)?|lunch)\b/i,
  },
  {
    id: 'dinner',
    re: /\b(abendessen|dinner|restaurant|essen\s+gehen|pann(?:en)?\s*fisch|pfann(?:en)?fisch|italiener|grieche)\b/i,
  },
  {
    id: 'cafe',
    re: /\b(café|cafe|kaffee)\b/i,
  },
  {
    id: 'explore',
    re: /\b(erkunden|anschauen|sightseeing|rundgang|bummel|stadt\s*tour|highlights?|sehensw|michel|must[-\s]?have|kennenlernen)/i,
  },
  {
    id: 'party',
    re: /\b(party|feier|feiern|club|bar|nightlife|ausgehen|tanzen)\b/i,
  },
  {
    id: 'hotel',
    re: /\b(hotel|übernacht|uebernacht|check-?in|unterkunft)\b/i,
  },
  {
    id: 'museum',
    re: /\b(museum|theater|kino|cinema|ausstellung)\b/i,
  },
  {
    id: 'travel',
    re: /\b(nach\s+[\p{L}]{3,}|morgen\s+nach|will\s+nach|anreise|hin\s*fahr|rein\s*fahr|von\s+\w+\s+nach|nach\s+[\p{L}]{3,}.{0,80}\blos\b)\b/iu,
  },
];

function countNeedBuckets(t: string): number {
  let n = 0;
  for (const b of NEED_BUCKETS) {
    if (b.re.test(t)) n += 1;
  }
  return n;
}

function countClockHints(t: string): number {
  const a =
    t.match(/\b(?:um|ab|gegen)\s+\d{1,2}(?::\d{2})?\s*(?:uhr)?\b/gi) ?? [];
  const b = t.match(/\b\d{1,2}:\d{2}\b/g) ?? [];
  return a.length + b.length;
}

/**
 * Langer, chaotischer Tageswunsch mit mehreren Themen — immer Modul 5.
 * Auch ohne exaktes „und dann“ / „planen“ (STT-Realität).
 */
export function looksLikeChaoticDayPlanUtterance(text: string): boolean {
  const t = (text ?? '').replace(/\s+/g, ' ').trim();
  if (!t || t.length < 40) return false;
  if (looksLikeOutfitOrWeatherUtterance(t)) return false;

  const buckets = countNeedBuckets(t);
  const clocks = countClockHints(t);
  const helpPlan =
    /\b(hilf(st)?\s+mir|organisie|zusammenstell|was\s+mach\s+ich|wie\s+bau|tag\s+durch|durch den tag)\b/i.test(
      t,
    );

  // 3+ Wunsch-Arten → Chaos-Tag. 2 Arten + andere Stadt auch —
  // sonst wird „Frühstück + Michel in Hamburg“ zum Gastro-Pitch am GPS.
  if (buckets >= 3) return true;
  if (buckets >= 2 && t.length >= 40) {
    try {
      const { destinationCityFromUtterance } = require('./planDestinationCity') as {
        destinationCityFromUtterance: (s: string, gps?: string | null) => string | null;
      };
      if (destinationCityFromUtterance(t, null)) return true;
    } catch {
      /* soft */
    }
  }
  // 1 starke Anker-Art + Uhrzeit + weiterer Kontext (lang)
  if (buckets >= 1 && clocks >= 1 && t.length >= 80) return true;
  // 2+ Uhrzeiten im Satz
  if (clocks >= 2) return true;
  // Explizite Hilfe bei langem Wunschkatalog
  if (helpPlan && buckets >= 1 && t.length >= 60) return true;
  try {
    const { userWantsDestinationDay } = require('./planDestinationCity') as {
      userWantsDestinationDay: (s: string) => boolean;
    };
    if (
      userWantsDestinationDay(t) &&
      (clocks >= 1 || buckets >= 1) &&
      t.length >= 60
    ) {
      return true;
    }
  } catch {
    /* soft */
  }

  return false;
}

/**
 * Klarer Einzelauftrag — sofort erfüllen, keine Timeline / kein „Passt der Plan?“.
 * Mehrere Stops / Chaos-Tag → false (Modul 5).
 */
export function looksLikeSingleJustDoItRequest(text: string): boolean {
  const t = (text ?? '').replace(/\s+/g, ' ').trim();
  if (!t) return false;
  if (looksLikeOutfitOrWeatherUtterance(t)) return false;
  // Chaos schlägt Einzel-Just-Do-It (sonst fasst Manager nur zusammen)
  if (looksLikeChaoticDayPlanUtterance(t)) return false;

  const hasPlanVerb =
    /\b(plan(e|en|ung|st)?|einplanen|tagesplan|timeline|kalender|durchplanen|organisiere|orga(nisiere)?\s+(mir|den)|mach\s+mir\s+(einen\s+)?plan|ganzer\s+tag|den\s+tag\s+(durch)?planen)\b/i.test(
      t,
    );
  if (hasPlanVerb) return false;

  // Outdoor-Budget früh: bevor SINGLE_NEED_RE (kein „Wanderweg“-Wort nötig)
  try {
    const { isOpenOutdoorBudgetQuery } = require('../../services/research/trailPathResearch') as {
      isOpenOutdoorBudgetQuery: (s: string) => boolean;
    };
    if (isOpenOutdoorBudgetQuery(t)) return true;
  } catch {
    if (
      /\b(\d+(?:[.,]\d+)?\s*km|(?:ein(?:e)?|zwei|drei|1|2|3)\s*(?:stunden?|std\.?|h)|halbe\s*stunde)\b/i.test(
        t,
      ) &&
      /\b(unterwegs|spazier\w*|wandern|radeln|raus|runde|tour|ausflug)\b/i.test(t)
    ) {
      return true;
    }
  }

  // Ein Abendziel (Grillen etc.) → Manager-Blaupause, nie Modul 5
  if (
    /\b(grill|grillen|bbq|picknick)\b/i.test(t) &&
    !/\b(tagesplan|durchplanen|und\s+dann.{0,40}(theater|museum))\b/i.test(t) &&
    countNeedBuckets(t) < 2
  ) {
    return true;
  }

  const hasMultiStop =
    /\b(und\s+dann|danach|zuerst|außerdem|ausserdem|vorher|später|spaeter)\b/i.test(
      t,
    ) &&
    countNeedBuckets(t) >= 2;
  if (hasMultiStop) return false;

  if (
    /\b(und\s+dann|danach|zuerst).{0,50}\b(essen|café|cafe|museum|theater|hotel|spazier|party|frühstück|fruehstueck)\b/i.test(
      t,
    )
  ) {
    return false;
  }

  if (!SINGLE_NEED_RE.test(t)) return false;

  // Kino/Film: immer Just-Do-It (Spielzeiten + Route), nie leere Timeline
  if (
    /\b(kino|cinema|filmtheater|kinoprogramm|vorstellung|ins\s+kino|film\s+schauen)\b/i.test(
      t,
    ) ||
    (/\bfilm\b/i.test(t) &&
      /\b(schauen|laufen|ticket|kino|neu(?:e[rn]?)?|rausgekommen)\b/i.test(t))
  ) {
    // außer kombiniert mit Essen/Party u.ä.
    if (countNeedBuckets(t) >= 2) return false;
    return true;
  }

  // Wander-/Fahrradweg-Vorschlag: Just-Do-It + Nav zum Einstieg (kein Tagesplan)
  if (
    /\b(wanderweg|wanderung|lehrpfad|fahrradweg|radweg|radroute|radtour|fernradweg|veloroute)\b/i.test(
      t,
    ) ||
    (/\b(wandern|radeln)\b/i.test(t) &&
      /\b(wo|schön|schoen|empfehl|vorschlag|nähe|naehe|route)\b/i.test(t))
  ) {
    if (countNeedBuckets(t) >= 2) return false;
    return true;
  }

  // Restaurant / Speisekarte in einer Stadt — auch ohne „suche/zeig“
  if (
    /\b(speisekarte|menükarte|menuekarte)\b/i.test(t) ||
    (/\b(restaurant|italiener|grieche|pann(?:en)?fisch)\b/i.test(t) &&
      /\bin\s+[\p{L}]{3,}/u.test(t))
  ) {
    if (countNeedBuckets(t) >= 2) return false;
    return true;
  }

  const asks =
    /\b(brauch|suche|find|empfehl|zeig|muss|will|möcht|moecht|unbedingt|heute\s+(abend|nacht)|für\s+heute|in\s+der\s+nähe|in\s+der\s+naehe|wo\s+(kann|soll)|welches?)\b/i.test(
      t,
    ) ||
    /\b(hotel|unterkunft|zimmer).{0,40}\b(heute|abend|nacht|nähe|naehe)\b/i.test(
      t,
    ) ||
    /\b(heute|abend|nacht).{0,40}\b(hotel|unterkunft|zimmer)\b/i.test(t);

  return asks;
}

/**
 * Touristen-Trip („4 Tage München“, „Wochenende in Lübeck“) → Modul 5.
 */
export function looksLikeTouristTripUtterance(text: string): boolean {
  try {
    const { looksLikeTripStayUtterance } = require('../../services/trip/parseTripStay') as {
      looksLikeTripStayUtterance: (s: string) => boolean;
    };
    return looksLikeTripStayUtterance(text);
  } catch {
    return false;
  }
}

/**
 * Echte Planungs-Absicht — nicht nur „heute Abend“ + Smalltalk.
 */
export function looksLikeModul5PlanUtterance(text: string): boolean {
  const t = (text ?? '').replace(/\s+/g, ' ').trim();
  if (!t) return false;

  if (looksLikeOutfitOrWeatherUtterance(t)) return false;

  // Chaos ZUERST — bevor Single-Just-Do-It den Tag killt
  if (looksLikeChaoticDayPlanUtterance(t)) return true;
  try {
    const { userWantsDestinationDay } = require('./planDestinationCity') as {
      userWantsDestinationDay: (s: string) => boolean;
    };
    if (userWantsDestinationDay(t)) {
      // Reiner Gastro-/Hotel-Wunsch in anderer Stadt = Pitch, kein M5-Tagesplan.
      if (looksLikeSingleJustDoItRequest(t)) return false;
      return true;
    }
  } catch {
    /* soft */
  }

  // Flug-Leave-by / Check-in / Security ist die Flug-Blaupause, kein Stadt-Tagesplan.
  try {
    const { isFlightTripQuery } = require('../../services/flights/flightTripIntent') as {
      isFlightTripQuery: (s: string) => boolean;
    };
    if (isFlightTripQuery(t) && !looksLikeTouristTripUtterance(t)) {
      return false;
    }
  } catch {
    /* soft */
  }

  // N-Tage-Aufenthalt / Tagestrip-Stadt
  if (looksLikeTouristTripUtterance(t)) return true;

  if (looksLikeSingleJustDoItRequest(t)) return false;

  const hasLocalWalkTour =
    /\b(spazier\w*|bummel\w*|rundgang|wanderung|wanderweg|highlight[-\s]?route|sehensw(?:ü|ue)rdigkeit(?:en)?|stadt\s*tour|stadt\s+erkunden|\w+\s+erkunden)\b/i.test(
      t,
    ) &&
    !/\b(?:\d+|zwei|drei|vier|paar)\s*stops?\b/i.test(t) &&
    !/\b(?:kleine|kurze|schnelle)\s+tour\b/i.test(t) &&
    (/\b(\d+(?:[.,]\d+)?|ein(?:e)?|zwei|drei|vier)\s*(?:stunden?|std\.?|h)\b/i.test(
      t,
    ) ||
      /\b(route|tour|stopps?|punkte|entlang|anschauen|hier\s+bleiben)\b/i.test(
        t,
      ) ||
      /\b(mach|erstell|bau|leg|plan)\w*.{0,40}\b(route|tour|spazier\w*|rundgang)\b/i.test(
        t,
      ) ||
      /\b(spazier\w*|bummel\w*|rundgang).{0,50}\b(sehensw(?:ü|ue)rdigkeit(?:en)?|highlights?|orte|park(?:s|en)?)\b/i.test(
        t,
      ));

  const hasPlanVerb =
    /\b(plan(e|en|ung|st)?|einplanen|tagesplan|timeline|kalender|durchplanen|organisiere|orga(nisiere)?\s+(mir|den)|mach\s+mir\s+(einen\s+)?plan|route\s+(erstell\w*|bau\w*|mach\w*|plan\w*)|tour\s+erstell\w*|(?:erstell|bau|mach)\w*.{0,20}\broute|hilf(st)?\s+mir\s+(dabei|beim|den\s+tag))\b/i.test(
      t,
    );
  let arriveByAppointment = false;
  try {
    const { looksLikeArriveByAppointment } = require('../kernel/utteranceFamily') as {
      looksLikeArriveByAppointment: (s: string) => boolean;
    };
    arriveByAppointment = looksLikeArriveByAppointment(t);
  } catch {
    arriveByAppointment = false;
  }
  const hasHardAnchor =
    /\b(termin|meeting|sonnenuntergang|sunset|flug|abflug)\b/i.test(t) ||
    arriveByAppointment ||
    (/\breservier\b/i.test(t) &&
      /\b(plan|einplanen|timeline|tagesplan|und\s+dann)\b/i.test(t));
  const hasMultiStop =
    /\b(und\s+dann|danach|zuerst|außerdem|ausserdem|vorher).{0,60}\b(essen|café|cafe|museum|theater|hotel|spazier\w*|party|frühstück|fruehstueck|erkunden)\b/i.test(
      t,
    ) ||
    (/\b(mittag(essen)?|abendessen|frühstück(?:en)?|fruehstueck(?:en)?)\b/i.test(t) &&
      /\b(?:(?:um|ab|gegen)\s+\d{1,2}|dann|danach|und|meeting|party|erkunden)\b/i.test(
        t,
      ));

  const bareEveningSlot =
    /\b(heute\s+abend|morgen\s+früh|morgen\s+frueh|heute\s+mittag)\b/i.test(t) &&
    !/\b(was\s+(soll|kann)\s+ich\s+an|anziehen|outfit|kleidung|wetter)\b/i.test(
      t,
    ) &&
    (hasPlanVerb ||
      hasHardAnchor ||
      hasMultiStop ||
      hasLocalWalkTour ||
      /\b(einplanen|in\s+die\s+(timeline|planung)|als\s+termin)\b/i.test(t) ||
      /\b(was\s+(soll|können)\s+wir\s+(heute\s+abend\s+)?machen|was\s+unternehmen|wohin\s+(gehen|raus))\b/i.test(
        t,
      ));

  return (
    hasPlanVerb ||
    hasHardAnchor ||
    hasMultiStop ||
    hasLocalWalkTour ||
    bareEveningSlot
  );
}

/**
 * Guided Step-Loop: bestehende Plan-Punkte nacheinander — kein neuer Tages-Monolog.
 * Stadt-agnostisch; Struktur-Detect, kein Script.
 */
export function looksLikePlanWalkthroughUtterance(text: string): boolean {
  const t = (text ?? '').replace(/\s+/g, ' ').trim();
  if (!t || t.length > 160) return false;
  if (looksLikeOutfitOrWeatherUtterance(t)) return false;
  return (
    /\b(jeden\s+punkt|alle\s+punkte|punkt\s+für\s+punkt|punkte?\s+durchgehen|stück\s+für\s+stück|stueck\s+für\s+stueck|eins\s+nach\s+dem\s+anderen|schritt\s+für\s+schritt|nacheinander\s+durch|plan\s+starten|loslegen\s+mit\s+dem\s+plan|walkthrough|step[\s-]?by[\s-]?step)\b/iu.test(
      t,
    ) ||
    /\b(geh(?:en)?|geh(?:en)?\s+wir|lass\s+uns).{0,24}\b(punkt|punkte|plan|schritte?)\b.{0,16}\b(durch|nacheinander)\b/iu.test(
      t,
    ) ||
    t === '__START_PLAN_STEP_LOOP__'
  );
}
