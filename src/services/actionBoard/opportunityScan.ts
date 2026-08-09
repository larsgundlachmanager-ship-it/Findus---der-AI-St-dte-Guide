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
  const netBad =
    /\b(netz|wlan|wifi|roaming|offline|kein\s+empfang|schlechtes?\s+netz|daten)\b/iu.test(
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

  // Route / Maps für genannte Orte
  for (const ent of opts.entities) {
    if (wantsNav || foodish || hotelish || culture || opts.module1) {
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

  // Noch mehr — nicht bei Trivialfragen
  if (!isTrivialExpandQuery(user || speech)) {
    const expandScore =
      opts.module1 || knowledge || culture || foodish || hotelish ? 75 : 58;
    if (expandScore >= OPPORTUNITY_SCORE_MIN) {
      push(
        out,
        'expand',
        expandScore,
        opts.module1?.activity
          ? 'Mehr zum Aktivitäts-Ort'
          : knowledge
            ? 'Tiefere Antwort'
            : 'Mehr Historie / Tiefe',
        primary,
      );
    }
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
