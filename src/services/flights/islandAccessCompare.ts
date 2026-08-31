/**
 * Insel-Zugang Wangerooge — Fähre vs. Inselflieger (Vergleich, stadt-agnostisch für ähnliche Inseln erweiterbar).
 * Keine erfundenen Fährpreise; Flug-Tarife nur als belegte „ab“-Struktur aus Inselflieger-Advisor.
 * Pure Detect/Speech — kein RN-Import (Advisor nur dynamisch bei Flight-Branch).
 */

import type { QuickAction } from '../../types/concierge';

const ISLAND_RE =
  /\b(wangerooge|harle(?:siel)?|flugplatz\s*harle|inselflieger|frisia\s*luft)\b/iu;

const COMPARE_RE =
  /\b(oder|vs\.?|versus|vergleich(?:en)?|was\s+ist\s+besser|was\s+ist\s+günstiger|was\s+ist\s+guenstiger|günstiger|guenstiger|schneller|welche(?:r|s)?\s+(?:lohnt|besser)|wie\s+(?:komme|komm)\s+ich|anreise|hinkommen)\b/iu;

/** Spiegel ferryTicketResearch FERRY_QUERY_RE — ohne Concierge-Import-Kette. */
const FERRY_HINT_RE =
  /fähr(?:e|anleger|hafen|ticket)|faehr(?:e|anleger|hafen|ticket)|ferry|überfahrt|ueberfahrt|watt\s*sprinter|harlesiel/iu;

/** Spiegel inselfliegerAdvisor INSELFLIEGER_RE (Kern) — ohne Store-Import. */
const ISLAND_FLIGHT_HINT_RE =
  /\b(inselflieger|insel\s*flieger|frisia\s*luft|\bfln\b|harle\s*(?:nach|⇄|↔)?\s*wangerooge|wangerooge\s*(?:flug|flieger)|flug\s*(?:nach|auf|von)\s*wangerooge|flugplatz\s*(?:harle|wangerooge))\b/iu;

const FERRY_URL = 'https://ticket.siw-wangerooge.de/';
const FERRY_INFO_URL = 'https://www.siw-wangerooge.de/siw-de';
const FLIGHT_INFO_URL = 'https://www.inselflieger.de/wangerooge';
const FLIGHT_BOOK_URL =
  'https://www.frisonaut.de/de/mobilitaet/assistent?tripType=ONEWAY&destination=wangerooge&origin=harle&findus_dir=harle-wangerooge';

/** Belegte Inselflieger-Tarife (ab) — SSOT-Spiegel zu inselfliegerAdvisor TARIFFS. */
export const ISLAND_FLIGHT_TARIFF_AB = {
  basicAdultFromEur: 55,
  flexAdultFromEur: 65,
  plusAdultFromEur: 79,
  airMinApprox: 7,
} as const;

export type IslandAccessIntent = 'compare' | 'flight' | 'ferry' | null;

export function isWangeroogeIslandAccessQuery(text: string): boolean {
  return ISLAND_RE.test((text || '').replace(/\s+/g, ' ').trim());
}

export function detectIslandAccessIntent(text: string): IslandAccessIntent {
  const t = (text || '').replace(/\s+/g, ' ').trim();
  if (!t || !isWangeroogeIslandAccessQuery(t)) return null;

  const ferry = FERRY_HINT_RE.test(t);
  const flight =
    ISLAND_FLIGHT_HINT_RE.test(t) ||
    /\b(flug|flieger|fliegen|luft)\b/iu.test(t);

  if (COMPARE_RE.test(t) && (ferry || flight || /\bwangerooge\b/iu.test(t))) {
    // „Wie komme ich nach Wangerooge?“ → immer Vergleich
    if (/\bwie\s+(?:komme|komm)\s+ich\b/iu.test(t) || /\banreise\b/iu.test(t)) {
      return 'compare';
    }
    if (ferry && flight) return 'compare';
    if (COMPARE_RE.test(t) && /\b(oder|vs|vergleich|günstiger|guenstiger|besser)\b/iu.test(t)) {
      return 'compare';
    }
  }
  if (ferry && flight) return 'compare';
  if (flight && !ferry) return 'flight';
  if (ferry && !flight) return 'ferry';
  // Nur Inselname + Anreise-Kontext
  if (COMPARE_RE.test(t)) return 'compare';
  return null;
}

export function wantsIslandAccessCompare(text: string): boolean {
  return detectIslandAccessIntent(text) === 'compare';
}

export type IslandAccessFollowUp = {
  speech: string;
  bullets: string[];
  quickActions: QuickAction[];
  cardTitle: string;
};

/**
 * Side-by-side: Ablauf + Flug-ab-Preise (belegt) + ehrliche Fähre ohne Fake-Preis.
 */
export function buildIslandAccessComparePayload(
  text?: string | null,
): IslandAccessFollowUp {
  const t = (text || '').replace(/\s+/g, ' ').trim();
  const wantCheap = /\b(günstig|guenstig|billig|preiswert|sparen)\b/iu.test(t);
  const wantFast = /\b(schnell|eilig|kurz|zeit)\b/iu.test(t);

  const lead = wantFast
    ? 'Wenn es schnell gehen soll: Inselflieger Harle ⇄ Wangerooge in wenigen Minuten — tide-unabhängig.'
    : wantCheap
      ? 'Wenn Preis zählt: die Fähre über Harlesiel ist meist die günstigere Kette — dafür tideabhängig und mit Inselbahn.'
      : 'Nach Wangerooge hast du zwei echte Wege — Fähre oder Inselflieger. Kurz der Vergleich:';

  const speech = [
    lead,
    `Fähre: Harlesiel → Überfahrt (Gezeiten) → Inselbahn zum Dorf. Tickets live bei SIW — ich erfinde keinen Fährpreis.`,
    `Inselflieger: Harle ↔ Insel ca. ${ISLAND_FLIGHT_TARIFF_AB.airMinApprox} Minuten. Tarife ab ca. ${ISLAND_FLIGHT_TARIFF_AB.basicAdultFromEur} € Basic / ${ISLAND_FLIGHT_TARIFF_AB.flexAdultFromEur} € Flex / ${ISLAND_FLIGHT_TARIFF_AB.plusAdultFromEur} € Plus (Erwachsene, Stand Tarifblatt).`,
    'Buttons: Fährtickets und Flug-Buchungsassistent — nichts kaufen ohne dein OK.',
  ].join(' ');

  return {
    speech,
    bullets: [
      'Fähre: Harlesiel → Gezeiten → Inselbahn',
      `Flug: ca. ${ISLAND_FLIGHT_TARIFF_AB.airMinApprox} Min · ab ${ISLAND_FLIGHT_TARIFF_AB.basicAdultFromEur} €`,
      wantCheap ? 'Preis: eher Fähre (live prüfen)' : 'Tempo: eher Inselflieger',
    ],
    quickActions: [
      {
        type: 'OPEN_URL',
        label: '🎫 Fährtickets',
        payload: { url: FERRY_URL },
      },
      {
        type: 'OPEN_URL',
        label: '✈️ Inselflieger',
        payload: { url: FLIGHT_BOOK_URL },
      },
      {
        type: 'OPEN_URL',
        label: 'Fähre Info',
        payload: { url: FERRY_INFO_URL },
      },
      {
        type: 'OPEN_URL',
        label: 'Flug Info',
        payload: { url: FLIGHT_INFO_URL },
      },
    ].slice(0, 4),
    cardTitle: 'Wangerooge Anreise',
  };
}

export async function prepareIslandAccessFollowUp(
  text: string,
): Promise<IslandAccessFollowUp | null> {
  const intent = detectIslandAccessIntent(text);
  if (!intent) {
    // Reiner Inselflieger ohne Compare-Wörter
    if (ISLAND_FLIGHT_HINT_RE.test(text) || /\binselflieger\b/iu.test(text)) {
      const { prepareInselfliegerFollowUp } = await import('./inselfliegerAdvisor');
      const island = await prepareInselfliegerFollowUp(text);
      if (!island) return null;
      return {
        speech: island.reply,
        bullets: (island.concierge.visualBullets ?? []).slice(0, 3),
        quickActions: (island.concierge.quickActions ?? []).slice(0, 4),
        cardTitle: island.concierge.cardTitle || 'Inselflieger',
      };
    }
    return null;
  }

  if (intent === 'compare') {
    return buildIslandAccessComparePayload(text);
  }

  if (intent === 'flight') {
    const { prepareInselfliegerFollowUp } = await import('./inselfliegerAdvisor');
    const island = await prepareInselfliegerFollowUp(text);
    if (island) {
      return {
        speech: island.reply,
        bullets: (island.concierge.visualBullets ?? []).slice(0, 3),
        quickActions: (island.concierge.quickActions ?? []).slice(0, 4),
        cardTitle: island.concierge.cardTitle || 'Inselflieger',
      };
    }
    return buildIslandAccessComparePayload(text);
  }

  // ferry: Tickets + kurzer Hinweis auf Flug-Alternative
  return {
    speech:
      'Für die Fähre nach Wangerooge: Tickets und Fahrplan live bei SIW (Harlesiel, tideabhängig, danach Inselbahn). Wenn du lieber fliegen willst — Inselflieger ab Harle, Tarife ab ca. 55 €.',
    bullets: [
      'Fähre: Harlesiel · Gezeiten',
      'Danach Inselbahn ins Dorf',
      'Alternative: Inselflieger ab ~55 €',
    ],
    quickActions: [
      {
        type: 'OPEN_URL',
        label: '🎫 Fährtickets',
        payload: { url: FERRY_URL },
      },
      {
        type: 'OPEN_URL',
        label: 'Fähre Info',
        payload: { url: FERRY_INFO_URL },
      },
      {
        type: 'OPEN_URL',
        label: '✈️ Inselflieger',
        payload: { url: FLIGHT_BOOK_URL },
      },
    ],
    cardTitle: 'Wangerooge Fähre',
  };
}
