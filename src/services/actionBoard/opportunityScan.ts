/**
 * Opportunity-Scan — „Kann ich hier etwas Produktives anbieten?“
 * Struktur-Blaupause, keine ortsfesten Scripts.
 */

import type {
  ActionEntity,
  ActionOpportunity,
  ActionOpportunityKind,
} from './types';
import { OPPORTUNITY_SCORE_MIN } from './types';
import { inferCategoryFromBlob } from './entityBind';

function blobOf(speech: string, user: string): string {
  return `${speech} ${user}`.replace(/\s+/g, ' ');
}

function looksHotelUrl(url?: string | null): boolean {
  if (!url) return false;
  return /expedia|stay22|booking\.com|hotels\.com|vrbo|affiliate/i.test(url);
}

function push(
  out: ActionOpportunity[],
  kind: ActionOpportunityKind,
  score: number,
  reason: string,
  entity?: ActionEntity,
): void {
  if (score < OPPORTUNITY_SCORE_MIN) return;
  out.push({ kind, score, reason, entity });
}

/** Trivial / kein Expand lohnenswert. */
export function isTrivialExpandQuery(userText: string): boolean {
  const t = userText.replace(/\s+/g, ' ').trim();
  if (!t) return true;
  if (/^\s*\d+\s*[\+\-\*\/×÷]\s*\d+\s*$/u.test(t)) return true;
  if (/^(ja|nein|ok|okay|danke|thanks)\.?$/iu.test(t)) return true;
  return false;
}

/** SHOW_MORE-Buttons die „Noch mehr / Mehr Historie“ meinen (nicht Reservieren/Timer). */
export function isExpandShowMoreAction(a: {
  label?: string;
  payload?: {
    module1DeepDive?: boolean;
    expandKind?: string;
    textPrompt?: string;
  };
}): boolean {
  if (a.payload?.module1DeepDive || a.payload?.expandKind) return true;
  const label = a.label ?? '';
  const prompt = a.payload?.textPrompt ?? '';
  if (
    /\b(noch\s+mehr|mehr\s+historie|mehr\s+dazu|mehr\s+zum)\b/iu.test(label)
  ) {
    return true;
  }
  if (
    /\b(erzähl\s+mir\s+noch\s+mehr|mehr\s+zur\s+geschichte|mehr\s+historie|max\s*3000)\b/iu.test(
      prompt,
    )
  ) {
    return true;
  }
  return false;
}

/**
 * „Noch mehr“ nur wenn wirklich noch Substanz möglich ist.
 * - Modul 1 (POI-Story): ja
 * - Geschichte / Kultur / Sight: ja
 * - Nav (M3), Planung (M5), Pitch/Entscheidung, Einkauf, Uhr: nein
 * Suppress-Regeln am User-Text; Speech allein öffnet keinen Expand.
 */
export function shouldOfferExpandMore(opts: {
  userText?: string;
  speechText?: string;
  module1?: boolean | { activity?: boolean; hotel?: boolean };
  /** Deep-Dive schon gelaufen */
  deepAlready?: boolean;
  /** Kultur-/Sight-Kontext (z. B. Museum-Subject im Knowledge-Agent) */
  culturePlace?: boolean;
}): boolean {
  if (opts.deepAlready) return false;
  const user = (opts.userText ?? '').replace(/\s+/g, ' ').trim();
  const speech = (opts.speechText ?? '').replace(/\s+/g, ' ').trim();
  const blob = `${user} ${speech}`;

  // Modul-1 Arrival / Activity-Story → „Mehr Historie“ / „Mehr dazu“
  // (vor Trivial-Check: Karte oft ohne User-Utterance)
  if (opts.module1) return true;

  if (isTrivialExpandQuery(user || speech)) return false;

  // Suppress: User-Intent (nicht Speech — sonst blockiert Plan-Wort in der Antwort fälschlich)
  if (
    /\b(bring\s+mich|navigier|navi(?:gation)?\s+(?:zu|nach|zum|zur)|führ\s+mich|fuehr\s+mich|route\s+(?:zu|nach|zum|zur)|stopp\s+nav|navigation\s+stopp)\b/iu.test(
      user,
    )
  ) {
    return false;
  }

  if (
    /\b(plane?\s+mir|planen|planung|tagesplan|timeline|kalender|einplanen|durchplanen|termin\s+(?:um|ein|machen|für|fuer)|wecker\b|timer\b|erinner\s+mich|leave[\s-]?by|abreisen)\b/iu.test(
      user,
    )
  ) {
    return false;
  }

  if (
    /\b(welche[srn]?\s+(?:pizza|burger|sushi|restaurant|hotel|option|ist|wäre|waere)|was\s+empfiehl|zwei\s+option|option\s+[ab]|🥇|🥈)\b/iu.test(
      user,
    ) ||
    (/\b(pizza|burger|sushi)\b/iu.test(user) &&
      /\b(empfehl|beste|oder|welche)\b/iu.test(user) &&
      !/\b(geschichte|historie|museum)\b/iu.test(user))
  ) {
    return false;
  }

  if (
    /\b(zahnbürste|zahnbuerste|kaufen|besorgen|einkauf|rossmann|\bdm\b|gutschein|wie\s+spät|wie\s+spaet|uhrzeit|wetter\s+heute|guten\s+(morgen|tag|abend))\b/iu.test(
      user,
    )
  ) {
    return false;
  }

  // Kultur-Ort / Sight vom Agenten
  if (opts.culturePlace) return true;

  // Echte Tiefenfrage / Ortsgeschichte
  if (
    /\b(mehr\s+(?:dazu|historie|geschichte)|erzähl\s+mehr|erzaehl\s+mehr|vertief|geschichte|historie|wie\s+alt\b|wer\s+(?:hat|war)\b|was\s+ist\s+das|warum\s+steht)\b/iu.test(
      user,
    )
  ) {
    return true;
  }

  // „Erzähl mir von X“ nur mit Kultur-/Geschichts-Anker
  if (
    /\b(erzähl|erzaehl|was\s+ist|wer\s+ist)\b/iu.test(user) &&
    /\b(museum|denkmal|kirche|schloss|turm|dom|galerie|ausstellung|geschichte|historie|sehenswürdig)\b/iu.test(
      blob,
    )
  ) {
    return true;
  }

  // Alltag / Concierge-Default: kein Placebo-„Noch mehr“
  return false;
}

export function scanOpportunities(opts: {
  speechText: string;
  userText?: string;
  entities: ActionEntity[];
  module1?: {
    activity?: boolean;
    hotel?: boolean;
    category?: string | null;
  };
}): ActionOpportunity[] {
  const speech = opts.speechText ?? '';
  const user = opts.userText ?? '';
  const blob = blobOf(speech, user);
  const out: ActionOpportunity[] = [];
  const multi = opts.entities.length >= 2;
  const primary = opts.entities[0];
  const secondary = opts.entities[1];

  const cat =
    primary?.category ||
    opts.module1?.category ||
    inferCategoryFromBlob(blob);

  const wantsNav =
    /\b(bring\s+mich|navigier|führ\s+mich|fuehr\s+mich|route|wie\s+komme|geh(?:en)?\s+(?:wir\s+)?(?:zum|zur))\b/iu.test(
      blob,
    ) ||
    /\b(kann\s+ich\s+dich\s+dahin|soll\s+ich\s+dich|navigation)\b/iu.test(
      speech,
    );

  const foodish =
    cat === 'restaurant' ||
    cat === 'bar' ||
    /\b(restaurant|essen|gastro|café|cafe|bistro|speise|menü|menu|imbiss)\b/iu.test(
      blob,
    );
  const barish =
    cat === 'bar' ||
    /\b(bar|club|getränk|getraenk|cocktail|wein\s*karte)\b/iu.test(blob);
  const hotelish =
    opts.module1?.hotel ||
    cat === 'hotel' ||
    /\b(hotel|zimmer|übernacht|uebernacht|unterkunft|pension)\b/iu.test(blob);
  const culture =
    cat === 'museum' ||
    cat === 'attraction' ||
    /\b(museum|ticket|eintritt|ausstellung|führung|fuehrung|theater|konzert)\b/iu.test(
      blob,
    );

  // Reine Nav/ETA-Turns: kein WLAN-/Mehr-Spam
  const navOnlyTurn =
    wantsNav &&
    !foodish &&
    !hotelish &&
    !culture &&
    !opts.module1 &&
    !/\b(speise|menü|menu|ticket|eintritt|zimmer|hotel|erzähl|geschichte)\b/iu.test(
      blob,
    );

  const netBad =
    !navOnlyTurn &&
    /\b(wlan|wifi|wi-?fi|roaming|kein\s+empfang|schlechtes?\s+netz|kein\s+netz|offline\s+modus)\b/iu.test(
      blob,
    );
  const abroad =
    /\b(ausland|roaming|bangkok|thailand|usa|japan|china|esim|e-sim)\b/iu.test(
      blob,
    );
  const knowledge =
    /\b(wer\s+ist|was\s+ist|erzähl|erzaehl|geschichte|warum|wie\s+funktioniert)\b/iu.test(
      blob,
    ) && !foodish;

  // Route / Maps für genannte Orte — bei Hotel mit Book-URL nicht (Buchen ist Produkt)
  // Modul-1 Arrival: User steht schon am Ort — kein Self-Route / Self-Maps
  for (const ent of opts.entities) {
    if (hotelish && (ent.bookUrl || looksHotelUrl(ent.websiteUrl))) {
      continue;
    }
    if (opts.module1) {
      // Arrival-Karte: keine Navigation zum eigenen POI
      continue;
    }
    if (wantsNav || foodish || hotelish || culture) {
      push(
        out,
        'route',
        wantsNav ? 95 : 72,
        'Ort genannt — Navigation anbieten',
        ent,
      );
      push(out, 'maps', 68, 'Maps-Direktlink', ent);
    }
  }

  if (foodish && primary) {
    push(
      out,
      barish && !/\b(essen|restaurant|speise)\b/iu.test(blob)
        ? 'menu_drinks'
        : 'menu_food',
      88,
      'Gastro — Speise-/Getränkekarte lohnt',
      primary,
    );
    if (multi && secondary) {
      push(
        out,
        barish ? 'menu_drinks' : 'menu_food',
        80,
        'Zweite Gastro-Wahl — Karte',
        secondary,
      );
    }
    if (/\b(reserv|tisch|voll|exklusiv)\b/iu.test(blob) || foodish) {
      push(out, 'reserve_table', 70, 'Tischreservierung möglich', primary);
    }
  }

  if (hotelish && primary) {
    push(out, 'hotel_book', 92, 'Hotel — Affiliate-Buchung', primary);
    if (multi && secondary) {
      push(out, 'hotel_book', 85, 'Zweites Hotel', secondary);
    }
  }

  if (culture && primary) {
    push(out, 'tickets', 86, 'Tickets / Eintritt', primary);
    if (/\b(führung|fuehrung|tour|guide)\b/iu.test(blob)) {
      push(out, 'tour_guide', 78, 'Führung buchen', primary);
    }
  }

  if (netBad) {
    push(out, 'wifi_place', 90, 'Schlechtes Netz — WLAN-Ort', primary);
    if (abroad || /\besim|e-sim|sim\s*karte|roaming\b/iu.test(blob)) {
      push(out, 'esim', 88, 'Roaming/Ausland — eSIM Hilfe', primary);
    }
  } else if (abroad) {
    push(out, 'esim', 82, 'Auslandsreise — eSIM', primary);
  }

  if (/\b(taxi|uber|bolt)\b/iu.test(blob)) {
    push(out, 'taxi', 80, 'Taxi/Uber', primary);
  }
  if (/\b(park(?:en|platz)|parken)\b/iu.test(blob)) {
    push(out, 'parking', 75, 'Parken', primary);
  }
  if (/\b(gepäck|gepaeck|koffer|bounce)\b/iu.test(blob)) {
    push(out, 'luggage', 84, 'Gepäckaufbewahrung', primary);
  }
  if (/\b(öpnv|opnv|hvv|bus|bahn|zug|u-bahn|s-bahn)\b/iu.test(blob)) {
    push(out, 'transit', 78, 'ÖPNV', primary);
  }
  if (/\b(wetter|regen|regenradar)\b/iu.test(blob)) {
    push(out, 'weather', 70, 'Wetter', primary);
  }

  // Noch mehr — nur Modul-1 / echte Tiefenfrage (nie Nav/Plan/Pitch-Spam)
  if (
    shouldOfferExpandMore({
      userText: user,
      speechText: speech,
      module1: opts.module1,
    })
  ) {
    const expandScore = opts.module1 ? 88 : culture || knowledge ? 78 : 70;
    push(
      out,
      'expand',
      expandScore,
      opts.module1?.activity
        ? 'Mehr zum Aktivitäts-Ort'
        : opts.module1
          ? 'Mehr Historie am Ort'
          : knowledge
            ? 'Tiefere Antwort'
            : 'Mehr Historie / Tiefe',
      primary,
    );
  }

  // Dedup kind+entity
  const seen = new Set<string>();
  return out
    .sort((a, b) => b.score - a.score)
    .filter((o) => {
      const key = `${o.kind}:${o.entity?.name ?? ''}:${o.entity?.rank ?? 0}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}
