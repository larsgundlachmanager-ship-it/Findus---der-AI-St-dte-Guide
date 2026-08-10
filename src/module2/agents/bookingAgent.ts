import type { Module2Agent } from './types';
import type { Module2ActionButton } from '../types';
import { anchorCoords } from '../rucksack/rucksackStore';
import { resolveWorkingPlace } from '../context/placeContext';
import {
  getBounceLuggageUrl,
  getExpediaAccommodationUrl,
  getStay22AccommodationUrl,
  isBounceAvailableForCity,
  normalizeAffiliateUrl,
} from '../../services/affiliate/affiliateService';
import {
  hasExplicitStayDates,
  parseHotelAdults,
  parseHotelStayDates,
  searchStay22HotelsInCity,
  type HotelLiveStay,
} from '../../services/concierge/hotelAvailabilityService';
import {
  filterHotelsByAmenityNeeds,
  mergeAmenityEvidence,
  nightsBetween,
  parseHotelAmenityNeeds,
  pickTwoHotelStays,
  pricePerNight,
  type HotelAmenityNeed,
} from '../../services/concierge/hotelHardMatch';
import { haversineMeters } from '../../db/database';
import { shortenActionLabel } from '../../services/concierge/actionLabelShorten';
import { generateGeminiText, hasGeminiApiKey } from '../../services/geminiService';
import {
  FINDUS_FEW_SHOT_DISCLAIMER,
  FINDUS_MAPS_PITCH_BLOCK,
} from '../../services/concierge/findusResponsePolicy';

function fmtEur(n: number): string {
  return `${Math.round(n).toLocaleString('de-DE')} €`;
}

function fmtDateDe(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  return `${String(d).padStart(2, '0')}.${String(m).padStart(2, '0')}.${y}`;
}

function distanceHint(
  stay: HotelLiveStay,
  lat: number,
  lng: number,
  namedCity: boolean,
): string | null {
  if (stay.lat == null || stay.lng == null) return null;
  if (namedCity) return null; // Stadt-Suche: nicht „km von dir“ am Home-GPS
  const m = haversineMeters(lat, lng, stay.lat, stay.lng);
  if (!Number.isFinite(m)) return null;
  if (m < 1000) return `${Math.round(m / 50) * 50} m von dir`;
  return `${(m / 1000).toFixed(1).replace('.', ',')} km von dir`;
}

function amenityHighlights(amenities: string[] | undefined): string | null {
  if (!amenities?.length) return null;
  const want =
    /pool|sauna|spa|jacuzzi|whirl|dampf|frühstück|fruehstueck|breakfast|wifi|wlan|park|fitness|wellness|küche|kueche|balkon/i;
  const hits = amenities.filter((a) => want.test(a)).slice(0, 6);
  if (!hits.length) return amenities.slice(0, 3).join(', ');
  return hits.join(', ');
}

/** Live-Book-URL oder Hotel-Suche mit Daten — immer klickfertig. */
function resolveHotelBookUrl(
  stay: HotelLiveStay,
  city: string,
  checkin: string,
  checkout: string,
  adults: number,
): string {
  const raw = (stay.bookUrl || '').trim();
  if (raw && /^https?:\/\//i.test(raw)) {
    return normalizeAffiliateUrl(raw);
  }
  return getExpediaAccommodationUrl(`${stay.name}, ${city}`.trim(), {
    checkin,
    checkout,
    adults,
  });
}

function describeStayFacts(
  stay: HotelLiveStay,
  role: 'günstigste' | 'qualität' | 'empfehlung',
  dist: string | null,
  nights: number,
  needLabels: string[],
): string {
  const perNight = pricePerNight(stay, nights);
  const bits = [
    role === 'günstigste'
      ? 'Günstigste Live-Option'
      : role === 'qualität'
        ? 'Qualitäts-Wahl'
        : 'Empfehlung',
    stay.name,
    stay.stars != null ? `${stay.stars} Sterne` : null,
    stay.rating != null
      ? `Gastbewertung ${String(stay.rating).replace('.', ',')}`
      : null,
    stay.priceTotal != null
      ? `${fmtEur(stay.priceTotal)} gesamt für ${nights} Nacht${nights === 1 ? '' : 'e'}` +
        (perNight != null ? ` (ca. ${fmtEur(perNight)}/Nacht)` : '') +
        ' — verfügbar'
      : 'Preis gerade nicht live',
    dist,
    amenityHighlights(stay.amenities),
    needLabels.length
      ? `User-Must-Haves belegt: ${needLabels.join(', ')}`
      : null,
    stay.supplier ? `über ${stay.supplier}` : null,
  ].filter(Boolean);
  return bits.join(' · ');
}

function mapsUrlForStay(stay: HotelLiveStay): string | null {
  if (stay.lat == null || stay.lng == null) return null;
  const q = encodeURIComponent(`${stay.name}@${stay.lat},${stay.lng}`);
  return `https://www.google.com/maps/search/?api=1&query=${q}`;
}

/** Maps/Reviews nachziehen, wenn Stay22-Amenities dünn sind. */
async function enrichStaysForNeeds(
  stays: HotelLiveStay[],
  needs: HotelAmenityNeed[],
  city: string,
  signal?: AbortSignal,
): Promise<HotelLiveStay[]> {
  if (!needs.length || stays.length === 0) return stays;
  const thin = stays.filter(
    (s) => !s.amenities?.length || !needs.every((n) => n.evidence.test((s.amenities ?? []).join(' '))),
  );
  if (!thin.length) return stays;

  try {
    const { fetchPlacePitchDetails } = await import(
      '../../services/navigation/placePitchDetails'
    );
    const sample = thin.slice(0, 10);
    const enriched = await Promise.all(
      sample.map(async (s) => {
        try {
          const lat = s.lat ?? 53.55;
          const lng = s.lng ?? 9.99;
          const details = await fetchPlacePitchDetails({
            query: `${s.name} ${city} hotel`,
            lat,
            lng,
            signal,
            includeAtmosphere: true,
          });
          if (!details) return s;
          const evidence = [
            details.editorialSummary,
            details.generativeSummary,
            ...details.reviews.map((r) => r.text),
            details.types.join(' '),
          ]
            .filter(Boolean)
            .join('\n');
          return mergeAmenityEvidence(s, evidence);
        } catch {
          return s;
        }
      }),
    );
    const byId = new Map(enriched.map((s) => [s.id, s]));
    return stays.map((s) => byId.get(s.id) ?? s);
  } catch {
    return stays;
  }
}

export const bookingAgent: Module2Agent = {
  id: 'booking',
  intents: ['booking'],
  async run({ task, rucksack, signal }) {
    const place = resolveWorkingPlace(
      task.rewrittenText,
      rucksack.cityHint,
      task.city,
    );
    const a = anchorCoords(rucksack);
    const namedCity = place.biasMode === 'named_city' && !!place.city;
    const city =
      namedCity && place.city
        ? place.city
        : place.city && !/hier\s+in\s+der\s+nähe/i.test(place.city)
          ? place.city
          : `${a.lat.toFixed(5)},${a.lng.toFixed(5)}`;
    const speechCity = place.speechPlace;
    const text = task.rewrittenText;
    const amenityNeeds = parseHotelAmenityNeeds(text);
    const amenityHint = amenityNeeds.map((n) => n.label).join(' ').toLowerCase();

    if (/\b(koffer|gepäck|gepaeck|aufbewahr|bounce|luggage)\b/i.test(text)) {
      const bounceOk = isBounceAvailableForCity(
        typeof place.city === 'string'
          ? place.city.toLowerCase().replace(/\s+/g, '')
          : null,
        place.city,
      );
      const bounceUrl = getBounceLuggageUrl();
      if (bounceOk && bounceUrl) {
        return {
          agent: 'booking',
          ok: true,
          draftText:
            `Für Gepäckaufbewahrung ${speechCity === 'hier in der Nähe' ? 'hier' : `in oder bei ${speechCity}`} öffne ich dir direkt unseren Partner Bounce — dort buchst du den Spot ohne Umweg über Maps.`,
          bullets: ['Bounce Gepäck', speechCity],
          buttons: [
            {
              id: 'bounce',
              label: '🧳 Bounce öffnen',
              payload: {
                kind: 'ui',
                action: 'book_bounce',
                data: { url: bounceUrl },
              },
            },
          ],
          meta: { affiliate: 'bounce', city },
        };
      }
    }

    const adults = parseHotelAdults(text);
    const datesKnown = hasExplicitStayDates(text);
    const { checkin, checkout } = parseHotelStayDates(text);
    const nights = nightsBetween(checkin, checkout);
    const wantCheap =
      /\b(günstig|guenstig|billig|preiswert|günstigste|guenstigste)\b/i.test(
        text,
      );
    const wantQuality =
      /\b(luxus|hochwert|beste|qualität|qualitaet|5\s*stern|fünf\s*stern|fuenf\s*stern)\b/i.test(
        text,
      );

    const searchUrl = getStay22AccommodationUrl(city, {
      checkin: datesKnown ? checkin : undefined,
      checkout: datesKnown ? checkout : undefined,
      adults,
    });

    if (!datesKnown) {
      return {
        agent: 'booking',
        ok: true,
        draftText:
          `Für eine konkrete, buchbare Unterkunft ${speechCity === 'hier in der Nähe' ? 'hier' : `in ${speechCity}`} brauche ich noch deinen Zeitraum: ` +
          `von wann bis wann möchtest du bleiben? Dann prüfe ich Live-Verfügbarkeit` +
          (amenityNeeds.length
            ? ` mit deinen Must-Haves (${amenityNeeds.map((n) => n.label).join(', ')})`
            : '') +
          `, pitche dir zwei passende Hotels mit Preis und Ausstattung ` +
          `und gebe dir die Buchungs-Buttons — du musst nichts selbst durchklicken.`,
        bullets: [
          speechCity,
          `${adults} Erwachsene`,
          amenityNeeds.length
            ? amenityNeeds.map((n) => n.label).join(' + ')
            : 'Zeitraum noch offen',
        ],
        buttons: [
          {
            id: 'stay22_city',
            label: '🏨 Stay22 öffnen',
            payload: {
              kind: 'ui',
              action: 'book_stay22',
              data: {
                destination: city,
                url: searchUrl,
                adults,
              },
            },
          },
        ],
        meta: { city, adults, awaitingDates: true },
      };
    }

    let stays: HotelLiveStay[] = [];
    let searchError: string | undefined;
    try {
      const live = await searchStay22HotelsInCity({
        city,
        checkin,
        checkout,
        adults,
        amenityHint: amenityHint || null,
        pageSize: amenityNeeds.length ? 40 : 24,
      });
      stays = live.stays;
      searchError = live.error;
    } catch (err) {
      searchError = err instanceof Error ? err.message : String(err);
    }

    if (stays.length && amenityNeeds.length) {
      stays = await enrichStaysForNeeds(stays, amenityNeeds, city, signal);
    }

    const filtered = filterHotelsByAmenityNeeds(stays, amenityNeeds);
    const inventory =
      filtered.matched.length > 0 ? filtered.matched : filtered.partial;
    const usedPartialFallback =
      amenityNeeds.length > 0 && filtered.matched.length === 0;

    if (!inventory.length && !stays.length) {
      return {
        agent: 'booking',
        ok: true,
        draftText:
          `Für ${fmtDateDe(checkin)}–${fmtDateDe(checkout)} ${speechCity === 'hier in der Nähe' ? 'hier' : `in ${speechCity}`} finde ich gerade keine live bepreisbaren Zimmer` +
          (searchError ? ` (${searchError})` : '') +
          (amenityNeeds.length
            ? ` mit ${amenityNeeds.map((n) => n.label).join(' + ')}`
            : '') +
          `. Hier ist die Partner-Suche mit deinem Zeitraum — ich bleibe dran, sobald Live-Preise da sind.`,
        bullets: [
          speechCity,
          `${fmtDateDe(checkin)}–${fmtDateDe(checkout)}`,
          amenityNeeds.length
            ? amenityNeeds.map((n) => n.label).join(' + ')
            : `${adults} Erwachsene`,
        ],
        buttons: [
          {
            id: 'stay22_city',
            label: '🏨 Stay22 öffnen',
            payload: {
              kind: 'ui',
              action: 'book_stay22',
              data: {
                destination: city,
                url: searchUrl,
                checkin,
                checkout,
                adults,
              },
            },
          },
        ],
        meta: { city, checkin, checkout, adults },
      };
    }

    const pool = inventory.length ? inventory : stays;
    const byPrice = [...pool].sort(
      (x, y) => (x.priceTotal ?? 1e9) - (y.priceTotal ?? 1e9),
    );
    const picks = pickTwoHotelStays(pool, { wantCheap, wantQuality });
    const cheapId = byPrice[0]?.id;
    const qualityId = [...pool].sort((x, y) => {
      const r = (y.rating ?? 0) - (x.rating ?? 0);
      if (Math.abs(r) > 0.05) return r;
      return (y.stars ?? 0) - (x.stars ?? 0);
    })[0]?.id;

    const roleOf = (
      s: HotelLiveStay,
      index: number,
    ): 'günstigste' | 'qualität' | 'empfehlung' => {
      if (wantCheap) {
        return index === 0 ? 'günstigste' : 'empfehlung';
      }
      if (s.id === cheapId && s.id === qualityId) return 'empfehlung';
      if (s.id === cheapId) return 'günstigste';
      if (s.id === qualityId) return 'qualität';
      return index === 0 ? 'empfehlung' : 'günstigste';
    };

    const primary = picks[0]!;
    const secondary = picks[1] ?? null;
    const needLabels = amenityNeeds.map((n) => n.label);

    let draft = '';
    if (hasGeminiApiKey()) {
      try {
        const factLines = picks.map((s, i) =>
          describeStayFacts(
            s,
            roleOf(s, i),
            distanceHint(s, a.lat, a.lng, namedCity),
            nights,
            needLabels,
          ),
        );
        draft = await generateGeminiText(
          `${FINDUS_MAPS_PITCH_BLOCK}\n${FINDUS_FEW_SHOT_DISCLAIMER}\n` +
            `Stadt: ${speechCity} (Suche NUR dort — nicht am User-GPS, wenn Stadt genannt)\n` +
            `Zeitraum: ${fmtDateDe(checkin)}–${fmtDateDe(checkout)} = ${nights} Nacht${nights === 1 ? '' : 'e'}, ${adults} Erwachsene\n` +
            (needLabels.length
              ? `HARD Must-Haves: ${needLabels.join(', ')} — nur belegte Amenities nennen.\n`
              : '') +
            (usedPartialFallback
              ? `HONEST FALLBACK: Kein Hotel mit ALLEN Must-Haves live. Fehlend oft: ${filtered.missingLabels.join(', ') || 'Teil der Amenities'}. ` +
                `Sag das klar, dann pitche die besten Teil-Treffer mit dem, was sie HABEN.\n`
              : '') +
            `Live-Optionen (Stay22) — IMMER beide verkaufen:\n${factLines.map((l, i) => `${i + 1}) ${l}`).join('\n')}\n` +
            `Struktur: Erstens Hotel 1 — Name, warum es passt (Amenities konkret: Pool/Sauna/Jacuzzi/Frühstück wenn belegt), ` +
            `Gesamtpreis + ca. Preis/Nacht für genau diesen Zeitraum → Oder Hotel 2 genauso vergleichen. ` +
            `Abschluss: kurze Frage wie „Wie klingt das für dich?“ — NIE „klick dich selbst durch / schau selbst nach“. ` +
            `Findus hat recherchiert; Buttons = Sofort-Buchung. ` +
            (wantCheap
              ? `User wollte günstig → zwei günstigste passende Optionen.`
              : `Beide Optionen lebendig, Unterschied klar.`) +
            ` Max ~220 Wörter. Keine erfundenen Amenities/Preise/Rezensionen.`,
          {
            temperature: 0.45,
            maxTokens: 700,
            useFindusSystem: true,
            signal,
          },
        );
      } catch {
        draft = '';
      }
    }

    if (!draft.trim()) {
      const lines = picks.map((s, i) =>
        describeStayFacts(
          s,
          roleOf(s, i),
          distanceHint(s, a.lat, a.lng, namedCity),
          nights,
          needLabels,
        ),
      );
      draft =
        (usedPartialFallback
          ? `Mit allen Must-Haves (${needLabels.join(' + ')}) finde ich live gerade nichts Passendes` +
            (filtered.missingLabels.length
              ? ` — oft fehlt ${filtered.missingLabels.join('/')}`
              : '') +
            `. Stattdessen die besten Teil-Treffer:\n`
          : `Für ${fmtDateDe(checkin)} bis ${fmtDateDe(checkout)} ${speechCity === 'hier in der Nähe' ? 'hier' : `in ${speechCity}`} ` +
            `(${nights} Nacht${nights === 1 ? '' : 'e'}, ${adults} Erwachsene` +
            (needLabels.length ? `, ${needLabels.join(' + ')}` : '') +
            `) live geprüft — zwei Optionen:\n`) +
        lines.map((l, i) => `${i === 0 ? 'Erstens' : 'Oder'}: ${l}.`).join(' ') +
        ` Buchungs-Buttons sind fertig — wie klingt das für dich?`;
    }

    // Anti-Selbstklick-Floskeln aus Modell-Ausgabe ziehen
    draft = draft
      .replace(
        /\b(klick(e)?\s+dich|schau\s+selbst|selber\s+durchklick\w*|am\s+besten\s+mal\s+selbst)\b[^.!?]*[.!?]?/gi,
        '',
      )
      .replace(/\s{2,}/g, ' ')
      .trim();

    const buttons: Module2ActionButton[] = [];
    for (let i = 0; i < picks.length; i++) {
      const s = picks[i]!;
      const shortName = s.name.split(/[|,]/)[0]!.trim();
      const bookUrl = resolveHotelBookUrl(s, city, checkin, checkout, adults);
      buttons.push({
        id: `book_hotel_${i}`,
        label: shortenActionLabel(
          `${i === 0 ? '🥇' : '🥈'} ${shortName}${
            s.priceTotal != null ? ` ${Math.round(s.priceTotal)}€` : ''
          }`,
        ),
        payload: {
          kind: 'deep_link',
          url: bookUrl,
          destName: shortName,
        },
      });
    }
    // Maps nach den Buchungs-Deeplinks (Produkt zuerst)
    for (let i = 0; i < picks.length; i++) {
      const s = picks[i]!;
      const shortName = s.name.split(/[|,]/)[0]!.trim();
      const maps = mapsUrlForStay(s);
      if (maps) {
        buttons.push({
          id: `maps_hotel_${i}`,
          label: shortenActionLabel(`🗺️ ${shortName.slice(0, 14)}`),
          payload: {
            kind: 'deep_link',
            url: maps,
          },
        });
      }
    }
    buttons.push({
      id: 'stay22_more',
      label: shortenActionLabel('🏨 Mehr bei Stay22'),
      payload: {
        kind: 'ui',
        action: 'book_stay22',
        data: {
          destination: city,
          url: searchUrl,
          checkin,
          checkout,
          adults,
        },
      },
    });
    try {
      const { getExpediaCamref } = require('../../services/affiliate/affiliateService') as {
        getExpediaCamref: () => string;
      };
      if (getExpediaCamref()) {
        buttons.push({
          id: 'expedia_more',
          label: shortenActionLabel('🏨 Expedia Preise'),
          payload: {
            kind: 'deep_link',
            url: getExpediaAccommodationUrl(city, {
              checkin,
              checkout,
              adults,
            }),
          },
        });
      }
    } catch {
      /* soft */
    }

    const dualBullets: string[] = [];
    for (let i = 0; i < picks.length; i++) {
      const s = picks[i]!;
      const per = pricePerNight(s, nights);
      const am = amenityHighlights(s.amenities);
      dualBullets.push(
        `${i === 0 ? '🥇' : '🥈'} ${s.name.split(/[|,]/)[0]!.trim()}${
          s.priceTotal != null
            ? ` · ${Math.round(s.priceTotal)}€${per != null ? ` (~${Math.round(per)}€/N)` : ''}`
            : ''
        }${am ? ` · ${am.split(', ').slice(0, 2).join(', ')}` : ''}`,
      );
    }
    if (needLabels.length && dualBullets.length < 3) {
      dualBullets.push(
        usedPartialFallback
          ? `Teil-Match · fehlend: ${filtered.missingLabels.join('/') || '?'}`
          : `${needLabels.join(' + ')} · ${fmtDateDe(checkin)}–${fmtDateDe(checkout)}`,
      );
    } else if (dualBullets.length < 3) {
      dualBullets.push(
        `${fmtDateDe(checkin)}–${fmtDateDe(checkout)} · ${nights} Nächte`,
      );
    }

    return {
      agent: 'booking',
      ok: true,
      draftText: [
        'FAKTEN Hotel Maps-Pitch + Stay22 (nicht wörtlich vorlesen):',
        draft,
        'FLOW: Immer 2 Optionen (Erstens/Oder) mit Amenities + Preis → Buttons je Hotel (Buchen + Maps). Nie „selbst durchklicken“.',
      ].join('\n'),
      bullets: dualBullets.slice(0, 3),
      buttons: buttons.slice(0, 6),
      money:
        primary.priceTotal != null
          ? [
              {
                amount: primary.priceTotal,
                currency: 'EUR',
                amountEur: primary.priceTotal,
              },
              ...(secondary?.priceTotal != null
                ? [
                    {
                      amount: secondary.priceTotal,
                      currency: 'EUR',
                      amountEur: secondary.priceTotal,
                    },
                  ]
                : []),
            ]
          : [],
      meta: {
        city,
        checkin,
        checkout,
        adults,
        nights,
        amenityNeeds: needLabels,
        partialAmenityFallback: usedPartialFallback,
        primaryId: primary.id,
        affiliate: 'stay22',
        hardMatch: needLabels.length > 0,
        booking_deep_link: true,
        mapsPitch: true,
        pitchKind: 'hotel',
        venues: picks.map((s) => ({
          name: s.name,
          lat: s.lat,
          lng: s.lng,
          bookUrl: resolveHotelBookUrl(s, city, checkin, checkout, adults),
          stay: s,
        })),
      },
    };
  },
};
