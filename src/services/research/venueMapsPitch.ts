/**
 * Maps-Pitch: Rezensionen + Flair + (Hotels) Stay22-Livepreis lebendig verkaufen.
 */

import { generateGeminiText, hasGeminiApiKey } from '../geminiService';
import {
  fetchPlacePitchDetails,
  ratingSpeechLabel,
  type PlacePitchDetails,
} from '../navigation/placePitchDetails';
import type { HotelLiveStay } from '../concierge/hotelAvailabilityService';
import {
  FINDUS_FEW_SHOT_DISCLAIMER,
  FINDUS_MAPS_PITCH_BLOCK,
} from '../concierge/findusResponsePolicy';

export type MapsPitchKind =
  | 'hotel'
  | 'museum'
  | 'attraction'
  | 'restaurant'
  | 'generic';

export type HotelSellFacts = {
  stay: HotelLiveStay;
  role: 'günstigste' | 'qualität' | 'empfehlung';
  checkin: string;
  checkout: string;
  adults: number;
  distHint?: string | null;
};

export type BuiltMapsPitch = {
  place: PlacePitchDetails | null;
  speechFacts: string;
  spokenPitch: string;
  bullets: string[];
};

function fmtEur(n: number): string {
  return `${Math.round(n).toLocaleString('de-DE')} €`;
}

function fmtDateDe(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  return `${String(d).padStart(2, '0')}.${String(m).padStart(2, '0')}.${y}`;
}

function reviewFactsBlock(place: PlacePitchDetails): string {
  const rating = ratingSpeechLabel(place.rating, place.ratingCount);
  const bits = [
    `Name: ${place.name}`,
    place.types.slice(0, 4).join(', ') || null,
    rating,
    place.ratingCount != null && place.ratingCount >= 20
      ? `${place.ratingCount} Bewertungen (Zahl nicht vorlesen)`
      : null,
    place.editorialSummary
      ? `Editorial: ${place.editorialSummary.slice(0, 280)}`
      : null,
    place.generativeSummary
      ? `Kurzportrait: ${place.generativeSummary.slice(0, 280)}`
      : null,
    place.formattedAddress ? `Adresse: ${place.formattedAddress}` : null,
    place.openNow === true
      ? 'Jetzt offen'
      : place.openNow === false
        ? 'Jetzt geschlossen'
        : null,
  ].filter(Boolean);

  const reviews = place.reviews.slice(0, 5).map((r, i) => {
    const star = r.rating != null ? `${r.rating}/5` : '?';
    return `Review${i + 1} (${star}${r.relativeTime ? `, ${r.relativeTime}` : ''}): ${r.text.slice(0, 220)}`;
  });

  return [...bits, ...reviews].join('\n');
}

function hotelSellBlock(h: HotelSellFacts): string {
  const s = h.stay;
  return [
    `Stay22-Live ${h.role}: ${s.name}`,
    s.priceTotal != null
      ? `Preis gesamt Aufenthalt: ${fmtEur(s.priceTotal)} ${s.currency || 'EUR'} — VERFÜGBAR`
      : 'Preis: nicht live',
    `Zeitraum: ${fmtDateDe(h.checkin)}–${fmtDateDe(h.checkout)}, ${h.adults} Erwachsene`,
    s.stars != null ? `${s.stars} Sterne` : null,
    s.rating != null
      ? `Gastbewertung ${String(s.rating).replace('.', ',')}`
      : null,
    h.distHint,
    s.amenities?.slice(0, 5).join(', ') || null,
    s.supplier ? `über ${s.supplier}` : null,
    `Book-URL vorhanden: ${Boolean(s.bookUrl)}`,
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * Lädt Maps-Details und baut einen lebendigen Pitch (Gemini) oder Fakten-Fallback.
 */
export async function buildMapsVenuePitch(opts: {
  kind: MapsPitchKind;
  query: string;
  placeId?: string | null;
  lat: number;
  lng: number;
  userText?: string;
  hotelSell?: HotelSellFacts | null;
  signal?: AbortSignal;
}): Promise<BuiltMapsPitch> {
  const place = await fetchPlacePitchDetails({
    placeId: opts.placeId,
    query: opts.query,
    lat: opts.lat,
    lng: opts.lng,
    signal: opts.signal,
    includeAtmosphere: true,
  });

  const factsParts = [
    `Art: ${opts.kind}`,
    place ? reviewFactsBlock(place) : `Kein Places-Treffer für „${opts.query}“`,
    opts.hotelSell ? hotelSellBlock(opts.hotelSell) : null,
    opts.userText ? `User: ${opts.userText.slice(0, 240)}` : null,
  ].filter(Boolean);

  const speechFacts = factsParts.join('\n\n');

  let spokenPitch = '';
  if (hasGeminiApiKey() && (place || opts.hotelSell)) {
    try {
      spokenPitch = await generateGeminiText(
        `${FINDUS_MAPS_PITCH_BLOCK}\n\n` +
          `${FINDUS_FEW_SHOT_DISCLAIMER}\n\n` +
          `FAKTEN (nicht wörtlich vorlesen — lebendig verkaufen):\n${speechFacts}\n\n` +
          `Schreibe 70–110 Wörter auf Deutsch: Flair → warum lohnt sich's (Review-Themen, keine langen Zitate) → ` +
          (opts.kind === 'hotel' && opts.hotelSell
            ? `dann Stay22-Zimmer lebendig verkaufen (Preis/Zeitraum/Verfügbarkeit belegt) → Button-Hinweis.`
            : `Highlight + optional Website/Ticket-Hinweis.`) +
          ` Keine erfundenen Preise. Keine Roh-Sternzahlen. Keine anderen Städte erfinden.`,
        {
          useFindusSystem: true,
          temperature: 0.55,
          maxTokens: 340,
          allowProEscalate: false,
          signal: opts.signal,
        },
      );
    } catch {
      spokenPitch = '';
    }
  }

  if (!spokenPitch.trim()) {
    const rating = place
      ? ratingSpeechLabel(place.rating, place.ratingCount)
      : null;
    const name = place?.name ?? opts.query;
    const sell = opts.hotelSell;
    spokenPitch = [
      `${name}${rating ? ` — ${rating}` : ''}.`,
      place?.editorialSummary?.slice(0, 160) ||
        place?.generativeSummary?.slice(0, 160) ||
        null,
      sell?.stay.priceTotal != null
        ? `Live über Stay22: ${fmtEur(sell.stay.priceTotal)} für ${fmtDateDe(sell.checkin)}–${fmtDateDe(sell.checkout)} — Zimmer verfügbar, Button öffnet die Buchung.`
        : null,
    ]
      .filter(Boolean)
      .join(' ');
  }

  const bullets = [
    place?.name ?? opts.query,
    place ? ratingSpeechLabel(place.rating, place.ratingCount) : null,
    opts.hotelSell?.stay.priceTotal != null
      ? `${fmtEur(opts.hotelSell.stay.priceTotal)} live`
      : place?.editorialSummary?.slice(0, 48) || null,
  ].filter((x): x is string => Boolean(x));

  return {
    place,
    speechFacts: [
      'FAKTEN Maps-Pitch (nicht wörtlich vorlesen):',
      speechFacts,
      'FLOW: Flair → Review-Kern → ' +
        (opts.kind === 'hotel' ? 'Stay22-Preis verkaufen → Button.' : 'Highlight → Web/Ticket.'),
    ].join('\n'),
    spokenPitch: spokenPitch.replace(/\s+/g, ' ').trim(),
    bullets: bullets.slice(0, 3),
  };
}

export function detectMapsPitchKind(text: string): MapsPitchKind {
  const t = text.toLowerCase();
  if (/\b(hotel|übernacht|uebernacht|zimmer|hostel|pension|ferienwohnung)\b/.test(t)) {
    return 'hotel';
  }
  if (/\b(museum|galerie|ausstellung)\b/.test(t)) return 'museum';
  if (
    /\b(theater|theatre|oper|opera|philharmon|konzerthaus|konzertsaal|dungeon|hafen|harbour|harbor|aussichtsturm|zoo|aquarium|attraktion|sehenswürdig|denkmal|schloss|kirche|dom|plaza|aussicht)\b/.test(
      t,
    )
  ) {
    return 'attraction';
  }
  if (/\b(restaurant|essen|gastro|café|cafe|imbiss)\b/.test(t)) {
    return 'restaurant';
  }
  return 'generic';
}
