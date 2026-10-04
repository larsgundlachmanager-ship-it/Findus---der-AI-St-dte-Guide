/**
 * MissionChecklist Builder — Phase 1 SSOT.
 *
 * Aus User-Text + Call-1 Order → ein Board: family, anchor, factsToProve,
 * still Ambiguity lösen, Ask-Back nur bei echten Blockern.
 */

import { deriveEvidenceNeeds } from '../evidence/evidenceNeeds';
import { looksLikeAyceQuery, normalizeAyceStt } from '../pitch/ayceIntent';
import type { Call1OrderTicket } from '../router/call1OrderTicket';
import {
  askBackCopyForFact,
  firstCriticalBlocker,
  hasCriticalBlocker,
  MISSION_DEFAULT_STAGES,
  MISSION_FACT_STAGES,
  MISSION_FLIGHT_STAGES,
  MISSION_HOTEL_STAGES,
  MISSION_SCHEDULE_STAGES,
  MISSION_TRANSIT_STAGES,
  type MissionAnchor,
  type MissionChecklist,
  type MissionChecklistItem,
  type MissionFamily,
  type MissionStage,
} from './missionContract';

export type BuildMissionChecklistOpts = {
  userText: string;
  order?: Partial<Call1OrderTicket> | null;
  mustHaves?: string[] | null;
  avoid?: string[] | null;
  /** sticky / research city if known */
  researchCity?: string | null;
  /** last topic place name (Alster, …) */
  stickyPlace?: string | null;
  authorIntent?: string | null;
};

function uniq(list: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const x of list) {
    const k = String(x || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 64);
    if (!k) continue;
    const key = k.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(k);
  }
  return out;
}

function fact(
  id: string,
  label: string,
  opts?: Partial<MissionChecklistItem>,
): MissionChecklistItem {
  return {
    id,
    label,
    critical: false,
    status: 'pending',
    value: null,
    source: 'infer',
    ...opts,
  };
}

/**
 * Stille Ambiguity-Normalisierung — nie nachfragen wenn Kontext reicht.
 */
export function normalizeMissionAmbiguity(userText: string): {
  text: string;
  rewrites: string[];
} {
  let text = normalizeAyceStt(userText || '')
    .replace(/\s+/g, ' ')
    .trim();
  const rewrites: string[] = [];
  if (!text) return { text: '', rewrites };

  // Venedig „Nusschale“ / Nussschale → Gondel
  if (
    /\b(nuss[\s-]?schale|nusschale|nussschale|nuss[\s-]?schalen)\b/iu.test(
      text,
    ) &&
    /\b(venedig|venezia|venice)\b/iu.test(text)
  ) {
    text = text.replace(
      /\b(nuss[\s-]?schale|nusschale|nussschale|nuss[\s-]?schalen)\b/giu,
      'Gondel',
    );
    rewrites.push('nusschale→gondel (Venedig)');
  } else if (
    /\b(nuss[\s-]?schale|nusschale|nussschale)\b/iu.test(text) &&
    /\b(boot|fahren|preis|teuer|kanal)\b/iu.test(text)
  ) {
    text = text.replace(
      /\b(nuss[\s-]?schale|nusschale|nussschale)\b/giu,
      'Gondel',
    );
    rewrites.push('nusschale→gondel');
  }

  // STT: „Aster“ / „Alsta“ → Alster bei Größenfragen
  if (
    /\b(aster|alsta|alstern)\b/iu.test(text) &&
    /\b(wie\s+(?:groß|gross)|fläche|flaeche|quadrat|hektar)\b/iu.test(text)
  ) {
    text = text.replace(/\b(aster|alsta|alstern)\b/giu, 'Alster');
    rewrites.push('aster→alster');
  }

  // STT: „Past“ / „Pabst“ → Papst (Alter-Fragen)
  if (
    /\b(past|pabst)\b/iu.test(text) &&
    /\b(wie\s+alt|alter|leo|xiv|14)\b/iu.test(text)
  ) {
    text = text.replace(/\b(past|pabst)\b/giu, 'Papst');
    rewrites.push('past/pabst→papst');
  }

  // Papst ohne Spezifikation → aktuell
  if (
    /\b(papst|pope)\b/iu.test(text) &&
    !/\b(franziskus|benedikt|johannes|leo|pius|aktuell|jetzige|derzeit)\b/iu.test(
      text,
    )
  ) {
    text = `${text} (aktueller Papst)`;
    rewrites.push('papst→aktueller Papst');
  }

  // Hauptstadt Niederlande + Boot → Amsterdam Grachtenboot
  if (
    /\b(niederlande|holland|netherlands)\b/iu.test(text) &&
    /\b(hauptstadt|boot|gracht|kanal|rundfahrt)\b/iu.test(text) &&
    !/\b(amsterdam|rotterdam|den\s+haag|utrecht)\b/iu.test(text)
  ) {
    text = text.replace(/\bhauptstadt\b/giu, 'Amsterdam');
    if (!/\bamsterdam\b/iu.test(text)) text = `${text} Amsterdam`;
    if (/\bboot\b/iu.test(text) && !/\bgrachten|kanal\b/iu.test(text)) {
      text = text.replace(/\bboot\b/giu, 'Grachtenboot');
      rewrites.push('NL-Hauptstadt+Boot→Amsterdam Grachtenboot');
    } else {
      rewrites.push('NL-Hauptstadt→Amsterdam');
    }
  }

  // „Steg“-Boot in NL-Kontext oft Grachten/Steg-Anleger — nicht nach Stadt fragen
  if (
    /\b(steg|grachten?\s*boot|canal\s*cruise)\b/iu.test(text) &&
    /\b(amsterdam|niederlande|holland)\b/iu.test(text)
  ) {
    if (!rewrites.some((r) => /Grachten|Amsterdam/i.test(r))) {
      rewrites.push('boot/steg→grachten-kontext');
    }
  }

  return { text: text.replace(/\s+/g, ' ').trim(), rewrites };
}

function extractBudgetMaxEur(text: string): number | null {
  const m =
    text.match(
      /\b(?:unter|max(?:imal)?\.?|bis\s+zu|höchstens|hoechstens|budget)\s*(\d{2,5})\s*(?:€|euro)?\b/iu,
    ) || text.match(/\b(\d{2,5})\s*(?:€|euro)\b/iu);
  if (!m?.[1]) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n >= 10 && n <= 50000 ? n : null;
}

function extractNamedCity(text: string): string | null {
  const m = text.match(
    /\b(?:in|nach|bei|um|für|fuer)\s+([A-ZÄÖÜ][\wÄÖÜäöüß-]{2,28}(?:\s+[A-ZÄÖÜ][\wÄÖÜäöüß-]{2,20})?)/u,
  );
  if (m?.[1] && !/^(Heute|Morgen|Abend|Nacht|Nähe|Naehe|Hotel)$/i.test(m[1])) {
    return m[1].trim();
  }
  // Bekannte Städte am Satzanfang / freistehend (Smoke-Cases)
  const known = text.match(
    /\b(Amsterdam|Berlin|Hamburg|Venedig|Venezia|Venice|München|Muenchen|Prisdorf|Lübeck|Luebeck|Wien|Paris|Rom|London)\b/u,
  );
  return known?.[1] ?? null;
}

function extractLandmark(text: string): string | null {
  if (/\b(hauptbahnhof|hbf|central\s+station)\b/iu.test(text)) {
    return 'Hauptbahnhof';
  }
  if (/\b(barclaycard\s*arena|barclays?\s*arena)\b/iu.test(text)) {
    return 'Barclaycard Arena';
  }
  if (/\b(alster)\b/iu.test(text)) return 'Alster';
  const nahe = text.match(
    /\b(?:nähe|nahe|nah\s+am|am|beim)\s+([A-ZÄÖÜ][\wÄÖÜäöüß-]{2,40}(?:\s+[A-ZÄÖÜ\wÄÖÜäöüß-]{2,24}){0,3})/u,
  );
  if (nahe?.[1]) return nahe[1].replace(/\s+/g, ' ').trim().slice(0, 48);
  return null;
}

function looksLikeAirportEtaWithoutFlight(text: string): boolean {
  const airport =
    /\b(flughafen|airport|abflug|gate|boarding)\b/iu.test(text) &&
    /\b(wann|wie\s+früh|wie\s+spaet|wie\s+spät|sein\s+muss|ankommen|da\s+sein)\b/iu.test(
      text,
    );
  if (!airport) return false;
  // Flugzeit / Flugnummer / Uhrzeit bekannt → kein Blocker
  if (
    /\b(flug\s*(?:um|um\s*)?\d{1,2}[:.]\d{2}|\d{1,2}[:.]\d{2}\s*uhr|flugnummer|[A-Z]{2}\s?\d{2,4}|morgen\s+früh\s+um|abflug\s+um)\b/iu.test(
      text,
    )
  ) {
    return false;
  }
  if (/\b(mein\s+flug|der\s+flug|flug\s+nach|fliege\s+um)\b/iu.test(text)) {
    // „mein Flug“ ohne Zeit ist trotzdem oft blockiert für Leave-by
    return !/\b\d{1,2}[:.]\d{2}\b/.test(text);
  }
  return true;
}

export function inferMissionFamily(
  text: string,
  orderMust: string[] = [],
): MissionFamily {
  const t = text;
  const mustBlob = orderMust.join(' ').toLowerCase();

  if (
    looksLikeAirportEtaWithoutFlight(t) ||
    /\b(flug|fliegen|flieger|kiwi|leave[\s-]?by)\b/iu.test(t)
  ) {
    if (
      /\b(wann\s+.*flughafen|flughafen.*wann|am\s+flughafen\s+sein)\b/iu.test(t)
    ) {
      return 'flight';
    }
    if (/\b(flug|fliegen|flieger)\b/iu.test(t)) return 'flight';
  }

  if (
    /\b(bahn|zug|verbindung|bahnverbindung|zugverbindung|ICE|RE\b|S-Bahn|öpnv|oepnv|nach\s+Berlin\s+fahren|fähre|faehre|ferry)\b/iu.test(
      t,
    ) ||
    /\b(fahren|verbindung).*\b(berlin|hamburg|münchen|muenchen)\b/iu.test(t) ||
    (/\bnach\s+(berlin|hamburg|münchen|muenchen|köln|koeln|amsterdam|wien)\b/iu.test(
      t,
    ) &&
      /\b(spätestens|spaetestens|ankunft|ankommen|uhr|hauptbahnhof|hbf|verbindung|zug|bahn|fähre|faehre)\b/iu.test(
        t,
      ))
  ) {
    return 'transit';
  }

  if (
    /\b(hotel|übernacht|uebernacht|zimmer|ferienwohnung|apartment)\b/iu.test(
      t,
    ) ||
    /hotel|pool/.test(mustBlob)
  ) {
    return 'hotel';
  }

  if (
    /\b(towers|spielt|spielplan|gegen\s+wen|barclaycard|konzert|auftritt|wann\s+spielt|theater\s+gespielt|comedy\s+show)\b/iu.test(
      t,
    ) ||
    /\b(helene\s+fischer|live\s+musik|open[\s-]?air\s+kino|filmprogramm)\b/iu.test(
      t,
    )
  ) {
    if (
      /\b(wann\s+spielt|spielplan|gegen\s+wen|towers|helene|auftreten)\b/iu.test(
        t,
      )
    ) {
      return 'schedule';
    }
    return 'event';
  }

  // Öffentliche Plätze/Courts → Amenity-Pitch (nicht Verleih-Research)
  try {
    const { isAmenityPlaceFindQuery } = require('./amenityPlaceFind') as {
      isAmenityPlaceFindQuery: (s: string) => boolean;
    };
    if (isAmenityPlaceFindQuery(t)) return 'amenity';
  } catch {
    /* soft */
  }

  if (
    /\b(basketball|tischtennis|tisch\s*tennis|trinken\swasser|trinkwasser|grillplatz|picknick|baden\s+gehen|sonnenbaden|freibad|strandbad|briefkasten|packstation|toilette)\b/iu.test(
      t,
    ) ||
    /\b(wo\s+kann\s+ich\s+(?:spielen|baden|grillen|picknicken))\b/iu.test(t)
  ) {
    if (
      /\b(briefkasten|packstation|toilette|trinkwasser|trinken\s+wasser|freibad|strandbad|badestelle|basketball|tischtennis|grillplatz|picknick)\b/iu.test(
        t,
      )
    ) {
      return 'amenity';
    }
    return 'activity';
  }

  if (
    /\b(verleih|ausleihen|mieten|sup\b|stand[\s-]?up|paddle|gondel)\b/iu.test(t)
  ) {
    return 'rental';
  }

  if (
    looksLikeAyceQuery(t) ||
    /\b(restaurant|essen|eis|pizza|hotel|museum|aussicht|café|cafe|pannfisch|fischbrötchen|fischbroetchen|aperol|mittagsspezial\w*|frühstück|fruehstueck|skigebiet\w*|seilbahn|sonnenuntergang|postkarte)\b/iu.test(
      t,
    ) ||
    /\b(wo\s+(?:gibt|kann|finde)|suche|zeig\s+mir|beste[rn]?|günstigst|guenstigst)\b/iu.test(
      t,
    )
  ) {
    return 'place';
  }

  if (
    /\b(wie\s+alt|wie\s+groß|wie\s+gross|geburtstag|wetter|temperatur|wer\s+ist)\b/iu.test(
      t,
    )
  ) {
    return 'fact';
  }

  // Default open find → place mission (immer suchen)
  if (
    /\b(wo|find|suche|brauche|möchte|moechte|lust\s+auf)\b/iu.test(t)
  ) {
    return 'place';
  }

  return 'fact';
}

function stagesForFamily(family: MissionFamily): MissionStage[] {
  switch (family) {
    case 'hotel':
      return [...MISSION_HOTEL_STAGES];
    case 'schedule':
    case 'event':
      return [...MISSION_SCHEDULE_STAGES];
    case 'transit':
      return [...MISSION_TRANSIT_STAGES];
    case 'flight':
      return [...MISSION_FLIGHT_STAGES];
    case 'fact':
      return [...MISSION_FACT_STAGES];
    default:
      return [...MISSION_DEFAULT_STAGES];
  }
}

function buildAnchor(
  text: string,
  opts: BuildMissionChecklistOpts,
  family: MissionFamily,
): MissionAnchor {
  const city = extractNamedCity(text) || opts.researchCity || null;
  const landmark = extractLandmark(text);
  const sticky = opts.stickyPlace || null;

  if (city && landmark) {
    return {
      kind: 'landmark',
      label: `${landmark}, ${city}`,
      name: city,
    };
  }
  if (city) {
    return { kind: 'named_city', label: city, name: city };
  }
  if (landmark) {
    return { kind: 'named_place', label: landmark, name: landmark };
  }
  if (sticky && family !== 'flight') {
    return { kind: 'sticky', label: sticky, name: sticky };
  }
  // Find-Missionen ohne Ort → GPS-Fallback (kein Ask-Back)
  if (
    family === 'place' ||
    family === 'amenity' ||
    family === 'activity' ||
    family === 'hotel' ||
    family === 'rental'
  ) {
    return { kind: 'gps', label: 'aktuelle Position', name: null };
  }
  return { kind: 'gps', label: null, name: null };
}

function pushUnique(
  list: MissionChecklistItem[],
  item: MissionChecklistItem,
): void {
  if (list.some((x) => x.id === item.id)) return;
  list.push(item);
}

/**
 * Baut die kanonische MissionChecklist.
 */
export function buildMissionChecklist(
  opts: BuildMissionChecklistOpts,
): MissionChecklist {
  const raw = String(opts.userText || '').trim();
  const { text, rewrites } = normalizeMissionAmbiguity(raw);
  const orderMust = uniq([
    ...(opts.order?.must ?? []),
    ...(opts.mustHaves ?? []),
  ]);
  const orderAvoid = uniq([
    ...(opts.order?.avoid ?? []),
    ...(opts.avoid ?? []),
  ]);
  const need = opts.order?.need ?? {};

  const family = inferMissionFamily(text, orderMust);
  const anchor = buildAnchor(text, opts, family);
  const facts: MissionChecklistItem[] = [];
  const must = [...orderMust];
  const avoid = [...orderAvoid];
  const nice: string[] = [];

  // --- Familie-spezifische Belege ---
  if (family === 'hotel') {
    pushUnique(
      facts,
      fact('is_hotel', 'Treffer ist Hotel/Unterkunft', {
        source: 'infer',
      }),
    );
    if (anchor.name) {
      pushUnique(
        facts,
        fact('in_city', `In/bei ${anchor.name}`, {
          status: 'inferred',
          value: anchor.name,
          source: 'user',
        }),
      );
      if (!must.some((m) => new RegExp(anchor.name!, 'i').test(m))) {
        must.push(anchor.name);
      }
    }
    const landmark = extractLandmark(text);
    if (landmark) {
      pushUnique(
        facts,
        fact('near_landmark', `Nähe ${landmark}`, {
          status: 'inferred',
          value: landmark,
          source: 'user',
        }),
      );
      must.push(`nähe ${landmark}`);
    }
    const budget = extractBudgetMaxEur(text);
    if (budget != null) {
      pushUnique(
        facts,
        fact('budget_max', `Preis ≤ ${budget} €`, {
          status: 'inferred',
          value: String(budget),
          source: 'user',
        }),
      );
      must.push(`unter ${budget}€`);
    }
    if (/\b(pool|schwimmbad|schwimmen)\b/iu.test(text)) {
      pushUnique(
        facts,
        fact('amenity_pool', 'Mit Pool', {
          status: 'inferred',
          value: 'pool',
          source: 'user',
        }),
      );
      must.push('pool');
    }
    if (/\b(tischtennis|tisch\s*tennis|ping[\s-]?pong)\b/iu.test(text)) {
      pushUnique(
        facts,
        fact('amenity_table_tennis', 'Mit Tischtennis', {
          status: 'inferred',
          value: 'table_tennis',
          source: 'user',
        }),
      );
      must.push('tischtennis');
    }
    // Daten nur critical wenn explizit Zeitraum ohne Datum
    if (
      /\b(übernacht|uebernacht|zimmer|hotel)\b/iu.test(text) &&
      /\b(vom|bis|nächte|naechte|check[\s-]?in)\b/iu.test(text) &&
      !/\b\d{1,2}\.\d{1,2}\b|\b\d{4}-\d{2}-\d{2}\b/u.test(text)
    ) {
      pushUnique(
        facts,
        fact('travel_dates', 'Reisezeitraum', {
          critical: true,
          source: 'user',
        }),
      );
    } else {
      pushUnique(
        facts,
        fact('live_price', 'Live-Preis prüfen', { source: 'infer' }),
      );
    }
    pushUnique(facts, fact('two_options', 'Zwei passende Optionen'));
    nice.push('bewertung');
  }

  if (family === 'activity' || family === 'amenity') {
    if (/\bbasketball\b/iu.test(text)) {
      pushUnique(
        facts,
        fact('court_basketball', 'Basketballplatz', {
          status: 'inferred',
          value: 'basketball',
          source: 'user',
        }),
      );
      must.push('basketballplatz');
      if (!/\b(halle|indoor|überdacht|ueberdacht)\b/iu.test(text)) {
        nice.push('kostenlos');
        pushUnique(
          facts,
          fact('prefer_free', 'Bevorzugt kostenlos/öffentlich', {
            critical: false,
            status: 'inferred',
            value: 'free_preferred',
            source: 'infer',
          }),
        );
      }
    }
    if (/\b(tischtennis|tisch\s*tennis|ping[\s-]?pong)\b/iu.test(text)) {
      pushUnique(
        facts,
        fact('table_tennis', 'Tischtennisplatte', {
          status: 'inferred',
          value: 'table_tennis',
          source: 'user',
        }),
      );
      must.push('tischtennisplatte');
    }
    if (/\b(trinkwasser|trinken\s+wasser|trinkbrunnen)\b/iu.test(text)) {
      pushUnique(
        facts,
        fact('drinking_water', 'Trinkwasser-Stelle', {
          status: 'inferred',
          value: 'drinking_water',
          source: 'user',
        }),
      );
      must.push('trinkwasser');
    }
    if (/\b(grillplatz|grillen|grillstelle)\b/iu.test(text)) {
      must.push('grillplatz');
      pushUnique(
        facts,
        fact('bbq', 'Grillplatz', {
          status: 'inferred',
          value: 'bbq',
          source: 'user',
        }),
      );
    }
    pushUnique(facts, fact('two_options', 'Zwei Optionen vorstellen'));
    pushUnique(facts, fact('maps_link', 'Maps/Route anbieten'));
    if (anchor.kind === 'gps') {
      pushUnique(
        facts,
        fact('anchor_gps', 'Anker = aktuelle Position', {
          status: 'inferred',
          value: 'gps',
          source: 'gps',
          critical: false,
        }),
      );
    }
  }

  if (family === 'schedule' || family === 'event') {
    pushUnique(facts, fact('when', 'Datum/Zeitpunkt'));
    pushUnique(facts, fact('start_time', 'Startzeit'));
    pushUnique(facts, fact('venue', 'Spielort/Venue'));
    if (/\b(towers|spielt|gegen)\b/iu.test(text)) {
      pushUnique(facts, fact('opponent', 'Gegner/Matchup'));
    }
    pushUnique(facts, fact('ticket_price', 'Ticketpreis (live)'));
    pushUnique(facts, fact('booking_link', 'Buchungs-/Ticket-Link'));
    if (!need.ticket) {
      /* order may still set later */
    }
  }

  if (family === 'place' || family === 'rental') {
    if (looksLikeAyceQuery(text)) {
      must.unshift('all_you_can_eat');
      pushUnique(
        facts,
        fact('ayce_evidence', 'All-you-can-eat belegt', {
          status: 'inferred',
          value: 'ayce',
          source: 'user',
        }),
      );
    }
    if (/\b(kein\s+asiatisch|nicht\s+asiatisch|ohne\s+asia)\b/iu.test(text)) {
      if (!avoid.some((a) => /asian|asiatisch/i.test(a))) {
        avoid.push('avoid_cuisine_asian');
      }
      pushUnique(
        facts,
        fact('avoid_asian', 'Kein asiatisch', {
          status: 'inferred',
          value: 'avoid_asian',
          source: 'user',
        }),
      );
    }
    // Dish / specialty items from evidence helper
    try {
      const ev = deriveEvidenceNeeds({ userText: text });
      for (const item of ev.items.slice(0, 3)) {
        must.push(item);
        pushUnique(
          facts,
          fact(
            `item_${item.toLowerCase().replace(/\s+/g, '_').slice(0, 24)}`,
            `Angebot: ${item}`,
            { status: 'inferred', value: item, source: 'user' },
          ),
        );
      }
      if (ev.needs.includes('item_price') || need.prices) {
        pushUnique(facts, fact('live_price', 'Preis live prüfen'));
      }
      if (ev.needs.includes('menu_deeplink') || need.menuUrl) {
        pushUnique(facts, fact('menu_url', 'Speisekarte-URL'));
      }
      if (ev.needs.includes('two_options')) {
        pushUnique(facts, fact('two_options', 'Zwei Optionen'));
      }
    } catch {
      pushUnique(facts, fact('two_options', 'Zwei Optionen'));
    }
    if (/\b(gondel)\b/iu.test(text)) {
      must.push('gondel');
      pushUnique(
        facts,
        fact('gondola', 'Gondel-Fahrt', {
          status: 'inferred',
          value: 'gondel',
          source: 'infer',
        }),
      );
    }
    if (need.maps !== false) {
      pushUnique(facts, fact('maps_link', 'Maps/Route'));
    }
  }

  if (family === 'transit') {
    pushUnique(facts, fact('origin', 'Startbahnhof/Ort'));
    pushUnique(facts, fact('destination', 'Ziel'));
    // Ankunftsdeadline wenn genannt → inferred, sonst nice (suchen trotzdem)
    const deadline = text.match(
      /\b(?:spätestens|spaetestens|ankunft|ankommen)\s*(?:um\s*)?(\d{1,2}[:.]\d{2}|\d{1,2}\s*uhr)/iu,
    );
    if (deadline?.[1]) {
      pushUnique(
        facts,
        fact('arrival_deadline', `Ankunft ≤ ${deadline[1]}`, {
          status: 'inferred',
          value: deadline[1],
          source: 'user',
          critical: false,
        }),
      );
    } else {
      // Tageszeit fehlt → NICHT critical: trotzdem Verbindungen suchen
      pushUnique(
        facts,
        fact('time_preference', 'Tageszeit (falls bekannt)', {
          critical: false,
          status: 'pending',
        }),
      );
    }
    pushUnique(facts, fact('price_compare', 'Preis vergleichen'));
    pushUnique(facts, fact('duration', 'Fahrtdauer'));
    pushUnique(facts, fact('booking_link', 'Buchungslink'));
    pushUnique(facts, fact('two_options', 'Zwei Verbindungen'));
  }

  if (family === 'flight') {
    if (looksLikeAirportEtaWithoutFlight(text)) {
      pushUnique(
        facts,
        fact('flight_time', 'Abflugzeit / Flug', {
          critical: true,
          status: 'pending',
          source: 'user',
        }),
      );
    } else {
      pushUnique(facts, fact('leave_by', 'Leave-by berechnen'));
      pushUnique(facts, fact('flight_match', 'Flug matchen'));
    }
  }

  if (family === 'fact') {
    pushUnique(facts, fact('answer_fact', 'Belegte Faktenantwort'));
    if (/\bpapst\b/iu.test(text)) {
      pushUnique(
        facts,
        fact('pope_current', 'Aktueller Papst', {
          status: 'inferred',
          value: 'aktueller Papst',
          source: 'infer',
          critical: false,
        }),
      );
    }
  }

  // Order.need → facts
  if (need.prices) {
    pushUnique(facts, fact('live_price', 'Preis (need.prices)'));
  }
  if (need.openHours) {
    pushUnique(facts, fact('open_hours', 'Öffnungszeiten live'));
  }
  if (need.ticket) {
    pushUnique(facts, fact('booking_link', 'Ticket-Link'));
  }
  if (need.bookingLink) {
    pushUnique(facts, fact('booking_link', 'Buchungslink'));
  }
  if (need.eta) {
    pushUnique(facts, fact('eta', 'Anreise/ETA'));
  }

  // Phase 7: Crowd-promoted Slots (≥3) → Standard in dieser Checkliste
  try {
    const { mergePromotedSlotsIntoMission } = require('./promotedMissionSlots') as {
      mergePromotedSlotsIntoMission: (o: {
        family: MissionFamily;
        facts: MissionChecklistItem[];
        need: { prices?: boolean; openHours?: boolean; menu?: boolean };
      }) => {
        needPrices: boolean;
        needOpenHours: boolean;
        needMenu: boolean;
      };
    };
    const promoted = mergePromotedSlotsIntoMission({
      family,
      facts,
      need: {
        prices: need.prices,
        openHours: need.openHours,
        menu: Boolean((need as { menu?: boolean }).menu),
      },
    });
    if (promoted.needPrices) {
      pushUnique(facts, fact('live_price', 'Preis (Crowd-promoted)'));
    }
  } catch {
    /* soft */
  }

  // Musts aus Order die noch kein Fact haben
  for (const m of orderMust) {
    const id = `must_${m.toLowerCase().replace(/\s+/g, '_').slice(0, 28)}`;
    pushUnique(
      facts,
      fact(id, m, {
        status: 'inferred',
        value: m,
        source: 'order',
        critical: false,
      }),
    );
  }

  const forbidSoftFill =
    opts.order?.search?.forbidSoftFill === true ||
    String(opts.order?.search?.mode || '').toLowerCase() === 'hard' ||
    must.length > 0 ||
    family === 'hotel' ||
    family === 'activity' ||
    family === 'schedule';

  let stages = stagesForFamily(family);
  if (opts.order?.search?.stages?.length) {
    const mapped = opts.order.search.stages.map((s) => s as MissionStage);
    stages = uniq([...mapped, 'verify']) as MissionStage[];
  }

  const normalizedQuery = (
    opts.authorIntent && opts.authorIntent.trim().length > 8
      ? `${text} | ${opts.authorIntent.trim()}`
      : text
  ).slice(0, 280);

  const checklist: MissionChecklist = {
    family,
    userText: raw,
    normalizedQuery,
    anchor,
    must: uniq(must).slice(0, 10),
    avoid: uniq(avoid).slice(0, 8),
    nice: uniq(nice).slice(0, 6),
    factsToProve: facts.slice(0, 16),
    stages,
    forbidSoftFill,
    askBack: null,
    rewrites,
  };

  if (hasCriticalBlocker(checklist)) {
    const blocker = firstCriticalBlocker(checklist);
    checklist.askBack = blocker ? askBackCopyForFact(blocker) : null;
  }

  return checklist;
}

/** Residual critical facts — für Phase 3 Ask-Back. */
export function criticalUnresolvedFacts(
  checklist: MissionChecklist,
): MissionChecklistItem[] {
  return checklist.factsToProve.filter(
    (f) =>
      f.critical &&
      f.status === 'pending' &&
      !(f.value && String(f.value).trim()),
  );
}
