/**
 * Venue-Offer Discovery — weltweit, kein Stadt-/Venue-Script.
 *
 * Für Theater, Konzerthalle, Hafen, Dungeon, Museum, Attraction:
 * live prüfen was man JETZT/HEUTE/MORGEN machen kann → Speech-Fakten + Buttons.
 * Partner-Feeds (GYG / Viator / Musement) primär, offizielle Links sekundär.
 */

import { generateGeminiText, hasGeminiApiKey } from '../geminiService';
import { isDeviceOffline } from '../navigation/networkState';
import {
  buildGetYourGuideSearchUrl,
  buildMusementSearchUrl,
  buildViatorSearchUrl,
  preferTicketSource,
} from '../affiliate/affiliateService';
import { shortenActionLabel } from '../concierge/actionLabelShorten';
import type { Module2ActionButton } from '../../module2/types';

export type VenueOfferKind =
  | 'theater'
  | 'concert_hall'
  | 'harbor'
  | 'attraction_tour'
  | 'museum'
  | 'sightseeing'
  | 'none';

export type VenueOfferItem = {
  /** show | tour | boat | concert | ticket | plaza | other */
  type: string;
  title: string;
  whenLabel: string | null;
  summary: string;
  infoUrl: string | null;
  ticketUrl: string | null;
};

export type VenueOfferDiscovery = {
  kind: VenueOfferKind;
  /** Speech-Faktenblock für Synthese (nicht wörtlich vorlesen) */
  promptBlock: string;
  offers: VenueOfferItem[];
  buttons: Module2ActionButton[];
  notes: string;
};

const THEATER_RE =
  /\b(theater|theatre|oper|opera|schauspiel|bühne|buehne|musical|kabarett|revue)\b/i;
const CONCERT_RE =
  /\b(philharmon|konzerthaus|konzertsaal|konzerthalle|elphi|elbphil|arena|stadion|musikhalle|symphony|concert\s*hall)\b/i;
const HARBOR_RE =
  /\b(hafen|harbour|harbor|landungsbrücken|landungsbruecken|kai|quay|ferry|fähre|faehre|marina|hafenrundfahrt|boat\s*tour|ausflugsdampfer|hadag)\b/i;
const TOUR_ATTR_RE =
  /\b(dungeon|panoptikum|wax|wachsfiguren|seilbahn|cable\s*car|aussichtsturm|observation|zoo|tierpark|aquarium|legoland|europapark|theme\s*park|freizeitpark|funpark)\b/i;
const MUSEUM_RE =
  /\b(museum|galerie|ausstellung|gallery|memorial|denkmal|schloss|castle|kirche|dom|cathedral|basilika)\b/i;

export function classifyVenueOfferKind(
  subject: string,
  extra = '',
): VenueOfferKind {
  const blob = `${subject} ${extra}`;
  if (THEATER_RE.test(blob)) return 'theater';
  if (CONCERT_RE.test(blob)) return 'concert_hall';
  if (HARBOR_RE.test(blob)) return 'harbor';
  if (TOUR_ATTR_RE.test(blob)) return 'attraction_tour';
  if (MUSEUM_RE.test(blob)) return 'museum';
  if (
    /\b(plaza|aussicht|sehenswürdig|attraktion|turm|brücke|bruecke|denkmal|kirche|dom|michel|plattform|observation)\b/i.test(
      blob,
    )
  ) {
    return 'sightseeing';
  }
  return 'none';
}

/** Ob für diesen Ort Offer-Discovery überhaupt Sinn macht. */
export function shouldDiscoverVenueOffers(
  subject: string,
  userText = '',
): boolean {
  const kind = classifyVenueOfferKind(subject, userText);
  if (kind !== 'none') return true;
  // Explizite User-Absicht: Tickets / Programm / Tour / Fähre / hoch / Aussicht
  return /\b(ticket|tickets|eintritt|programm|aufführung|auffuehrung|konzert|führung|fuehrung|tour|rundfahrt|rundführung|rundfuehrung|dampfer|fähre|faehre|hoch|hinauf|aussicht|plattform|stufen|turm)\b/i.test(
    userText,
  );
}

function kindBrief(kind: VenueOfferKind): string {
  switch (kind) {
    case 'theater':
      return 'Theater/Oper: aktuelles Programm HEUTE/MORGEN (Stück, Uhrzeit), Tickets wenn belegt.';
    case 'concert_hall':
      return 'Konzertort: nächste Konzerte, Führungen/Touren, öffentlich zugängliche Bereiche — nur Belegtes.';
    case 'harbor':
      return 'Hafen/Wasser: Fähr-/Hafenrundfahrten, Ausflugsdampfer, Touren — Partner-Feeds bevorzugen.';
    case 'attraction_tour':
      return 'Attraction/Tour: Eintritt/Tour-Tickets (Dungeon, Zoo, Turm…) — Partner-Feeds bevorzugen.';
    case 'museum':
      return 'Museum: Eintritt/Tickets, Sonderausstellung wenn belegt.';
    case 'sightseeing':
      return 'Sight: Führungen/Tickets/Aussicht wenn belegt — nichts erfinden.';
    default:
      return 'Prüfe ob Tickets, Touren, Programm oder Rundfahrten existieren.';
  }
}

function extractJsonObject(raw: string): unknown | null {
  const t = raw.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fence?.[1]?.trim() ?? t;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(body.slice(start, end + 1));
  } catch {
    return null;
  }
}

function asOffers(data: unknown): VenueOfferItem[] {
  if (!data || typeof data !== 'object') return [];
  const root = data as { offers?: unknown[] };
  if (!Array.isArray(root.offers)) return [];
  const out: VenueOfferItem[] = [];
  for (const row of root.offers) {
    if (!row || typeof row !== 'object') continue;
    const e = row as Record<string, unknown>;
    const title = String(e.title ?? e.name ?? '').trim();
    if (title.length < 3) continue;
    const infoUrl =
      typeof e.infoUrl === 'string' && /^https?:\/\//i.test(e.infoUrl)
        ? e.infoUrl
        : typeof e.url === 'string' && /^https?:\/\//i.test(e.url)
          ? e.url
          : null;
    const ticketUrl =
      typeof e.ticketUrl === 'string' && /^https?:\/\//i.test(e.ticketUrl)
        ? e.ticketUrl
        : null;
    out.push({
      type: String(e.type ?? 'other').toLowerCase().slice(0, 24),
      title: title.slice(0, 80),
      whenLabel:
        typeof e.whenLabel === 'string' && e.whenLabel.trim()
          ? e.whenLabel.trim().slice(0, 40)
          : null,
      summary: String(e.summary ?? '').trim().slice(0, 220),
      infoUrl,
      ticketUrl,
    });
  }
  return out.slice(0, 4);
}

function affiliateKindFor(
  offerKind: VenueOfferKind,
): 'museum' | 'tour' | 'attraction' | 'generic' {
  if (offerKind === 'museum') return 'museum';
  if (offerKind === 'harbor' || offerKind === 'attraction_tour') return 'tour';
  if (offerKind === 'sightseeing' || offerKind === 'concert_hall') {
    return 'attraction';
  }
  return 'generic';
}

function ticketSearchUrl(
  query: string,
  offerKind: VenueOfferKind,
): string {
  const picked = preferTicketSource({
    kind: affiliateKindFor(offerKind),
    query,
  });
  return picked.url;
}

function labelForOffer(o: VenueOfferItem, i: number): string {
  const when = o.whenLabel ? ` ${o.whenLabel}` : '';
  const base =
    o.type === 'boat' || /rundfahrt|dampfer|fähre/i.test(o.title)
      ? `⛴️ ${o.title}${when}`
      : o.type === 'concert' || o.type === 'show'
        ? `🎭 ${o.title}${when}`
        : o.type === 'tour'
          ? `🧭 ${o.title}${when}`
          : `🎫 ${o.title}${when}`;
  return shortenActionLabel(base || `Angebot ${i + 1}`);
}

/**
 * Baut Action-Buttons: zuerst „mehr wissen“ (Follow-up), dann Ticket/Partner.
 */
export function buildVenueOfferButtons(opts: {
  subject: string;
  city?: string | null;
  kind: VenueOfferKind;
  offers: VenueOfferItem[];
  websiteUrl?: string | null;
}): Module2ActionButton[] {
  const { subject, city, kind, offers, websiteUrl } = opts;
  const buttons: Module2ActionButton[] = [];
  const qCity = city?.trim() || '';

  for (let i = 0; i < Math.min(2, offers.length); i++) {
    const o = offers[i]!;
    buttons.push({
      id: `venue_offer_${i}`,
      label: labelForOffer(o, i),
      payload: {
        kind: 'ui',
        action: 'more_offer',
        data: {
          topic: subject,
          offerTitle: o.title,
          whenLabel: o.whenLabel,
          summary: o.summary,
          infoUrl: o.infoUrl,
          ticketUrl: o.ticketUrl,
          prompt: `Erzähl mir mehr zu „${o.title}“${o.whenLabel ? ` (${o.whenLabel})` : ''} bei ${subject}${qCity ? ` in ${qCity}` : ''}. Was ist das genau, und wo kann ich Tickets buchen?`,
        },
      },
    });
  }

  // Partner-Ticket-Suche immer als klarer Kauf-Pfad (weltweit)
  if (kind !== 'none' || offers.length > 0) {
    const query = `${subject} ${qCity}`.trim();
    const hasBoat = offers.some(
      (o) =>
        o.type === 'boat' ||
        /rundfahrt|dampfer|fähre|boat|ferry|cruise/i.test(
          `${o.title} ${o.summary}`,
        ),
    );
    const ticketQ = hasBoat
      ? `${subject} ${qCity} Hafenrundfahrt OR boat tour`
      : kind === 'theater'
        ? `${subject} ${qCity} Tickets Aufführung`
        : kind === 'concert_hall'
          ? `${subject} ${qCity} Konzert Tickets OR Führung`
          : `${subject} ${qCity} Tickets`;

    buttons.push({
      id: 'venue_tickets_affiliate',
      label: shortenActionLabel(
        hasBoat ? '⛴️ Touren buchen' : '🎟️ Tickets',
      ),
      payload: {
        kind: 'deep_link',
        url: ticketSearchUrl(ticketQ.trim(), kind === 'none' ? 'attraction_tour' : kind),
      },
    });
  }

  // Direkt-Ticket-URL eines Offers (wenn Recherche eine echte URL fand)
  const direct = offers.find((o) => o.ticketUrl)?.ticketUrl;
  if (direct && !buttons.some((b) => b.payload.kind === 'deep_link' && b.payload.url === direct)) {
    buttons.push({
      id: 'venue_ticket_direct',
      label: shortenActionLabel('🎫 Ticket-Link'),
      payload: { kind: 'deep_link', url: direct },
    });
  }

  if (
    websiteUrl &&
    /^https?:\/\//i.test(websiteUrl) &&
    !buttons.some(
      (b) => b.payload.kind === 'deep_link' && b.payload.url === websiteUrl,
    )
  ) {
    buttons.push({
      id: 'venue_web',
      label: shortenActionLabel(`${subject} → Web`),
      payload: { kind: 'deep_link', url: websiteUrl },
    });
  }

  return buttons.slice(0, 4);
}

/**
 * Live: was kann man an DIESEM Ort machen? (weltweit, kein Hardcode).
 */
export async function discoverVenueOffers(opts: {
  subject: string;
  city?: string | null;
  userText?: string;
  websiteUrl?: string | null;
  signal?: AbortSignal;
}): Promise<VenueOfferDiscovery | null> {
  const subject = opts.subject.trim();
  if (!subject || subject.length < 2) return null;
  if (!shouldDiscoverVenueOffers(subject, opts.userText ?? '')) return null;

  const kind = classifyVenueOfferKind(subject, opts.userText ?? '');
  const offline = await isDeviceOffline();
  if (offline || !hasGeminiApiKey()) {
    // Offline: trotzdem Affiliate-Suche anbieten
    const buttons = buildVenueOfferButtons({
      subject,
      city: opts.city,
      kind: kind === 'none' ? 'sightseeing' : kind,
      offers: [],
      websiteUrl: opts.websiteUrl,
    });
    return {
      kind,
      promptBlock: [
        '=== VENUE-OFFERS (offline / knapp) ===',
        `Ort: ${subject}${opts.city ? ` · ${opts.city}` : ''}`,
        'Keine Live-Recherche — Partner-Ticket-Suche anbieten, nichts erfinden.',
      ].join('\n'),
      offers: [],
      buttons,
      notes: 'offline_or_no_key',
    };
  }

  const today = new Date().toLocaleDateString('de-DE', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
  const city = opts.city?.trim() || 'vor Ort';

  const prompt = [
    `Du recherchierst LIVE Angebote für EINEN konkreten Ort — weltweit, kein vorgefertigtes Stadt-Script.`,
    `Ort: ${subject}`,
    `Stadt/Region-Kontext: ${city}`,
    `Heute: ${today}`,
    opts.userText ? `User-Frage: „${opts.userText.trim().slice(0, 180)}“` : '',
    '',
    `Ortstyp-Hinweis: ${kindBrief(kind === 'none' ? 'sightseeing' : kind)}`,
    '',
    'AUFGABE mit Google Search:',
    '- Was kann man HIER konkret machen? (Programm HEUTE/MORGEN, Touren, Tickets, Rundfahrten, Führungen)',
    '- Nur BELEGTE Angebote. Keine erfundenen Preise, keine Fake-URLs.',
    '- Partner-Portale (GetYourGuide, Viator, Musement, offizielle Venue-Seite) als Quellen ok.',
    '- Wenn nichts Belegtes: offers=[] und notes ehrlich.',
    '',
    'Antworte NUR JSON:',
    '{',
    '  "notes": "kurz was geprüft",',
    '  "offers": [',
    '    {',
    '      "type": "show|concert|tour|boat|ticket|plaza|other",',
    '      "title": "kurzer Name",',
    '      "whenLabel": "heute 20:00" | "morgen" | null,',
    '      "summary": "1 Satz",',
    '      "infoUrl": "https://..." | null,',
    '      "ticketUrl": "https://..." | null',
    '    }',
    '  ]',
    '}',
    'Max 4 offers.',
  ]
    .filter(Boolean)
    .join('\n');

  try {
    const raw = await generateGeminiText(prompt, {
      task: 'generic',
      enableGoogleSearch: true,
      maxTokens: 1100,
      temperature: 0.3,
      useFindusSystem: false,
      signal: opts.signal,
    });
    const parsed = extractJsonObject(raw);
    const offers = asOffers(parsed);
    const notes =
      parsed && typeof parsed === 'object' && 'notes' in parsed
        ? String((parsed as { notes?: string }).notes ?? '')
        : '';

    const effectiveKind = kind === 'none' ? 'sightseeing' : kind;
    const buttons = buildVenueOfferButtons({
      subject,
      city: opts.city,
      kind: effectiveKind,
      offers,
      websiteUrl: opts.websiteUrl,
    });

    const promptBlock = [
      '=== VENUE-OFFERS (LIVE, PFLICHT wenn belegt) ===',
      `Ort: ${subject} · Kontext: ${city} · Typ: ${effectiveKind}`,
      notes ? `Research: ${notes}` : '',
      offers.length
        ? offers
            .map(
              (o, i) =>
                `${i + 1}) [${o.type}] ${o.title}` +
                `${o.whenLabel ? ` · ${o.whenLabel}` : ''}` +
                `${o.summary ? ` — ${o.summary}` : ''}` +
                `${o.infoUrl ? ` · Info: ${o.infoUrl}` : ''}` +
                `${o.ticketUrl ? ` · Ticket: ${o.ticketUrl}` : ''}`,
            )
            .join('\n')
        : 'Keine belegten Angebote gefunden — ehrlich halten; Ticket-/Tour-Suche-Button trotzdem ok.',
      '',
      'SPEECH: 1–2 konkrete Angebote nennen (wann/was). Dann Buttons für Mehr-Info / Tickets.',
      'Keine Venue-Hardcodes (keine festen Elphi-/Stadt-Scripts). Partner-Feeds bevorzugen.',
    ]
      .filter(Boolean)
      .join('\n');

    return {
      kind: effectiveKind,
      promptBlock,
      offers,
      buttons,
      notes,
    };
  } catch {
    const buttons = buildVenueOfferButtons({
      subject,
      city: opts.city,
      kind: kind === 'none' ? 'sightseeing' : kind,
      offers: [],
      websiteUrl: opts.websiteUrl,
    });
    return {
      kind,
      promptBlock: [
        '=== VENUE-OFFERS (Recherche fehlgeschlagen) ===',
        `Ort: ${subject}`,
        'Partner-Ticket-Suche anbieten, nichts erfinden.',
      ].join('\n'),
      offers: [],
      buttons,
      notes: 'research_failed',
    };
  }
}

/** Prompt-SSOT-Fragment für Knowledge / Maps-Pitch. */
export const FINDUS_VENUE_OFFERS_BLOCK = `VENUE-OFFERS (SSOT — weltweit, kein Stadt-Datensatz):
- Bei Theater/Oper/Konzertort/Hafen/Dungeon/Museum/Attraction IMMER live prüfen: was kann man HIER machen?
- Theater → aktuelles Programm (heute/morgen) + Tickets.
- Konzertort → Konzerte + Führungen/Touren wenn belegt.
- Hafen → Rundfahrten/Fähren/Dampfer (Partner-Feeds).
- Attraction/Dungeon → Tour-/Eintritts-Tickets (Partner-Feeds).
- FLOW: kurz nennen → Action-Button „mehr wissen“ → dann Ticket-Button.
- Partner (GetYourGuide / Viator / Musement) primär; offizielle Links sekundär.
- VERBOTEN: feste Venue-Scripts, Fake-Preise, erfundene Programme.`;

/** @deprecated — nur noch für Tests / Debug */
export function debugAffiliateSearchUrls(query: string): {
  gyg: string;
  viator: string;
  musement: string;
} {
  return {
    gyg: buildGetYourGuideSearchUrl(query),
    viator: buildViatorSearchUrl(query),
    musement: buildMusementSearchUrl(query),
  };
}
