/**
 * Modul 5 — Erkennung: Tagesplan / Planung (SSOT für Mic-Gate).
 *
 * Outfit/Wetter („was anziehen“) ist KEIN Plan — sonst kapert „heute Abend“ Modul 5.
 * Einzelauftrag (Hotel / Restaurant / Museum …) ist Just-Do-It — keine Timeline.
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

const SINGLE_NEED_RE =
  /\b(hotel|übernacht|uebernacht|unterkunft|zimmer|hostel|airbnb|pension|motel|restaurant|essen\s+gehen|mittagessen|abendessen|frühstück|fruehstueck|café|cafe|museum|bungee|aktivität|aktivitaet|wasserski|kletter|escape\s*room|welches\s+museum|kino|cinema|filmtheater|kinoprogramm|vorstellung|film\s+schauen|ins\s+kino|wanderweg|wanderung|lehrpfad|fahrradweg|radweg|radroute|radtour|fernradweg|veloroute)\b/i;

/**
 * Klarer Einzelauftrag — sofort erfüllen, keine Timeline / kein „Passt der Plan?“.
 * Mehrere Stops / „Plan machen“ → false (Modul 5).
 */
export function looksLikeSingleJustDoItRequest(text: string): boolean {
  const t = (text ?? '').replace(/\s+/g, ' ').trim();
  if (!t) return false;
  if (looksLikeOutfitOrWeatherUtterance(t)) return false;

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
    !/\b(tagesplan|durchplanen|und\s+dann.{0,40}(theater|museum))\b/i.test(t)
  ) {
    return true;
  }

  const hasMultiStop =
    /\b(und\s+dann|danach|zuerst).{0,50}\b(essen|café|cafe|museum|theater|hotel|spazier)\b/i.test(
      t,
    ) ||
    (/\b(mittag(essen)?|abendessen|frühstück|fruehstueck)\b/i.test(t) &&
      /\b(hotel|museum|spazier|und\s+dann|danach)\b/i.test(t) &&
      /\b(um\s+\d{1,2}|dann|danach)\b/i.test(t));
  if (hasMultiStop) return false;

  if (!SINGLE_NEED_RE.test(t)) return false;

  // Kino/Film: immer Just-Do-It (Spielzeiten + Route), nie leere Timeline
  if (
    /\b(kino|cinema|filmtheater|kinoprogramm|vorstellung|ins\s+kino|film\s+schauen)\b/i.test(
      t,
    ) ||
    (/\bfilm\b/i.test(t) &&
      /\b(schauen|laufen|ticket|kino|neu(?:e[rn]?)?|rausgekommen)\b/i.test(t))
  ) {
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
 * Echte Planungs-Absicht — nicht nur „heute Abend“ + Smalltalk.
 * Spazier-/Sightseeing-Routen mit Dauer oder expliziter Route → Modul 5
 * (sonst landet „zwei Stunden spazieren“ in Knowledge und sagt nur „loslegen“).
 */
export function looksLikeModul5PlanUtterance(text: string): boolean {
  const t = (text ?? '').replace(/\s+/g, ' ').trim();
  if (!t) return false;

  if (looksLikeOutfitOrWeatherUtterance(t)) return false;
  if (looksLikeSingleJustDoItRequest(t)) return false;

  const hasLocalWalkTour =
    /\b(spazier\w*|bummel\w*|rundgang|wanderung|wanderweg|highlight[-\s]?route|sehensw(?:ü|ue)rdigkeit(?:en)?|stadt\s*tour|stadt\s+erkunden|\w+\s+erkunden)\b/i.test(
      t,
    ) &&
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
    /\b(plan(e|en|ung|st)?|einplanen|tagesplan|timeline|kalender|durchplanen|organisiere|orga(nisiere)?\s+(mir|den)|mach\s+mir\s+(einen\s+)?plan|route\s+(erstell\w*|bau\w*|mach\w*|plan\w*)|tour\s+erstell\w*|(?:erstell|bau|mach)\w*.{0,20}\broute)\b/i.test(
      t,
    );
  const hasHardAnchor =
    /\b(termin|meeting|sonnenuntergang|sunset|flug|abflug)\b/i.test(t) ||
    (/\breservier\b/i.test(t) &&
      /\b(plan|einplanen|timeline|tagesplan|und\s+dann)\b/i.test(t));
  const hasMultiStop =
    /\b(und\s+dann|danach|zuerst).{0,40}\b(essen|café|cafe|museum|theater|hotel|spazier\w*)\b/i.test(
      t,
    ) ||
    (/\b(mittag(essen)?|abendessen|frühstück|fruehstueck)\b/i.test(t) &&
      /\b(um\s+\d{1,2}|dann|danach|und)\b/i.test(t));

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
