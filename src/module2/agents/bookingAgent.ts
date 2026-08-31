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
  parseLodgingTypePreference,
  searchStay22HotelsInCity,
  type HotelLiveStay,
} from '../../services/concierge/hotelAvailabilityService';
import {
  filterHotelsByAmenityNeeds,
  enrichHotelStaysForAmenityNeeds,
  nightsBetween,
  parseHotelAmenityNeeds,
  pickTwoHotelStays,
  pricePerNight,
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

function partnerHotelFallbackButtons(opts: {
  city: string;
  stay22Url: string;
  checkin?: string;
  checkout?: string;
  adults: number;
}): Module2ActionButton[] {
  const buttons: Module2ActionButton[] = [];
  const expediaUrl = getExpediaAccommodationUrl(opts.city, {
    checkin: opts.checkin,
    checkout: opts.checkout,
    adults: opts.adults,
  });
  if (expediaUrl) {
    buttons.push({
      id: 'expedia_city',
      label: `🏨 Hotels in ${opts.city}`,
      payload: {
        kind: 'deep_link',
        url: expediaUrl,
        destName: opts.city,
        destination: opts.city,
        checkin: opts.checkin,
        checkout: opts.checkout,
        adults: opts.adults,
      },
    });
  }
  if (opts.stay22Url) {
    buttons.push({
      id: 'stay22_city',
      label: expediaUrl ? '🏨 Mehr bei Stay22' : '🏨 Stay22 öffnen',
      payload: {
        kind: 'ui',
        action: 'book_stay22',
        data: {
          destination: opts.city,
          url: opts.stay22Url,
          checkin: opts.checkin,
          checkout: opts.checkout,
          adults: opts.adults,
        },
      },
    });
  }
  return buttons;
}

function amenityHighlights(amenities: string[] | undefined): string | null {
  if (!amenities?.length) return null;
  const want =
    /pool|sauna|spa|jacuzzi|whirl|dampf|frühstück|fruehstueck|breakfast|wifi|wlan|park|fitness|wellness|küche|kueche|balkon/i;
  const hits = amenities.filter((a) => want.test(a)).slice(0, 6);
  if (!hits.length) return amenities.slice(0, 3).join(', ');
  return hits.join(', ');
}

/** Live-Book-URL oder Property-Deep-Link mit Daten — immer klickfertig. */
function resolveHotelBookUrl(
  stay: HotelLiveStay,
  city: string,
  checkin: string,
  checkout: string,
  adults: number,
): string {
  try {
    const {
      finalizeHotelBookAffiliateUrl,
    } = require('../../services/affiliate/hotelPropertyDeepLink') as {
      finalizeHotelBookAffiliateUrl: (o: {
        hotelName: string;
        city?: string | null;
        bookUrl?: string | null;
        checkin: string;
        checkout: string;
        adults?: number;
      }) => string;
    };
    return finalizeHotelBookAffiliateUrl({
      hotelName: stay.name,
      city,
      bookUrl: stay.bookUrl,
      checkin,
      checkout,
      adults,
    });
  } catch {
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
  try {
    const { mapsUrlForGooglePlace } = require('../../services/research/eventInfoUrl') as {
      mapsUrlForGooglePlace: (o: {
        placeName?: string | null;
        placeId?: string | null;
      }) => string | null;
    };
    return mapsUrlForGooglePlace({
      placeName: stay.name,
      placeId: (stay as { placeId?: string | null }).placeId,
    });
  } catch {
    return null;
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
    let city =
      namedCity && place.city
        ? place.city
        : place.city && !/hier\s+in\s+der\s+nähe/i.test(place.city)
          ? place.city
          : `${a.lat.toFixed(5)},${a.lng.toFixed(5)}`;
    let speechCity = place.speechPlace;
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
      const bounceUrl = getBounceLuggageUrl({
        cityName: place.city,
        fromDate: new Date().toISOString().slice(0, 10),
        standardBags: 2,
      });
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

    try {
      const { promptDestinationCitySwitch } = await import(
        '../../services/cityPackOffer'
      );
      const switched = await promptDestinationCitySwitch({
        text,
        intent: 'hotel',
      });
      if (switched?.cityName) {
        city = switched.cityName;
        speechCity = switched.cityName;
      }
    } catch {
      /* soft */
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
    const lodgingType = parseLodgingTypePreference(text);
    const lodgingLabel =
      lodgingType === 'apartment'
        ? 'Apartment/Ferienwohnung'
        : lodgingType === 'any'
          ? 'Unterkunft (Hotel & Ferienwohnung)'
          : 'Hotel';

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
          `Für eine konkrete, buchbare ${lodgingLabel} ${speechCity === 'hier in der Nähe' ? 'hier' : `in ${speechCity}`} brauche ich noch deinen Zeitraum: ` +
          `von wann bis wann möchtest du bleiben? Dann prüfe ich Live-Preise` +
          (amenityNeeds.length
            ? ` mit deinen Must-Haves (${amenityNeeds.map((n) => n.label).join(', ')})`
            : '') +
          ` über Hotels, Apartments und Ferienwohnungen, pitche dir zwei passende Optionen ` +
          `und gebe dir die Buchungs-Buttons — du musst nichts selbst durchklicken.`,
        bullets: [
          speechCity,
          `${adults} Erwachsene`,
          lodgingLabel,
          amenityNeeds.length
            ? amenityNeeds.map((n) => n.label).join(' + ')
            : 'Zeitraum noch offen',
        ],
        buttons: partnerHotelFallbackButtons({
          city,
          stay22Url: searchUrl,
          adults,
        }),
        meta: { city, adults, awaitingDates: true, lodgingType },
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
        lodgingType,
        pageSize: amenityNeeds.length || lodgingType === 'any' ? 40 : 24,
      });
      stays = live.stays;
      searchError = live.error;
    } catch (err) {
      searchError = err instanceof Error ? err.message : String(err);
    }

    if (stays.length && amenityNeeds.length) {
      stays = await enrichHotelStaysForAmenityNeeds(stays, amenityNeeds, city, signal);
    }

    const filtered = filterHotelsByAmenityNeeds(stays, amenityNeeds);
    // Hard-Reject: Must-Haves → nur Voll-Matches pitchen/buchen (nie Partial als „Empfehlung“)
    const inventory =
      amenityNeeds.length > 0 ? filtered.matched : stays;
    const hardMiss =
      amenityNeeds.length > 0 && filtered.matched.length === 0;

    if (hardMiss || (!inventory.length && !stays.length)) {
      const needTxt = amenityNeeds.map((n) => n.label).join(' + ');
      return {
        agent: 'booking',
        ok: true,
        draftText:
          hardMiss
            ? `Für ${fmtDateDe(checkin)}–${fmtDateDe(checkout)} ${speechCity === 'hier in der Nähe' ? 'hier' : `in ${speechCity}`} finde ich gerade kein Hotel, bei dem ${needTxt} belegt ist. Oben ist die Partnersuche mit Tracking — Live-Preise siehst du dort.`
            : `Hotels ${speechCity === 'hier in der Nähe' ? 'hier' : `in ${speechCity}`} vom ${fmtDateDe(checkin)} bis ${fmtDateDe(checkout)} — oben ist die Partnersuche mit Tracking, Live-Preise siehst du direkt dort.`,
        bullets: [
          speechCity,
          `${fmtDateDe(checkin)}–${fmtDateDe(checkout)}`,
          amenityNeeds.length ? needTxt : `${adults} Erwachsene`,
          ...(hardMiss
            ? [
                filtered.missingLabels.length
                  ? `Fehlt belegt: ${filtered.missingLabels.join(', ')}`
                  : 'Kein Voll-Match',
              ]
            : []),
        ],
        buttons: partnerHotelFallbackButtons({
          city,
          stay22Url: searchUrl,
          checkin,
          checkout,
          adults,
        }),
        meta: {
          city,
          checkin,
          checkout,
          adults,
          hardAmenityReject: hardMiss,
          missingAmenities: filtered.missingLabels,
          searchError: searchError || null,
        },
      };
    }

    const pool = inventory;
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
              ? `HARD Must-Haves: ${needLabels.join(', ')} — nur belegte Amenities nennen. Beide Optionen erfüllen ALLE Must-Haves.\n`
              : '') +
            `Live-Optionen (Stay22: Hotels/Apartments/Ferienwohnungen) — IMMER beide verkaufen:\n${factLines.map((l, i) => `${i + 1}) ${l}`).join('\n')}\n` +
            `Struktur: zwei Optionen flüssig weben — Name, Typ wenn erkennbar (Hotel/Apartment), warum es passt (Amenities konkret wenn belegt), ` +
            `Gesamtpreis + ca. Preis/Nacht für genau diesen Zeitraum in 1–2 Sätzen je Ort, weicher Übergang zur zweiten. ` +
            `Kein Telegramm „Erstens/Oder“. Abschluss: kurze Frage wie „Wie klingt das für dich?“ — NIE „klick dich selbst durch / schau selbst nach“. ` +
            `Yorro hat recherchiert; Buttons = Sofort-Buchung. ` +
            (wantCheap
              ? `User wollte günstig → zwei günstigste passende Optionen.`
              : `Beide Optionen lebendig, Unterschied klar.`) +
            (lodgingType === 'apartment'
              ? ` Fokus Apartment/Ferienwohnung.`
              : lodgingType === 'any'
                ? ` Mix aus Hotel und Ferienwohnung ok.`
                : '') +
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
        `Für ${fmtDateDe(checkin)} bis ${fmtDateDe(checkout)} ${speechCity === 'hier in der Nähe' ? 'hier' : `in ${speechCity}`} ` +
        `(${nights} Nacht${nights === 1 ? '' : 'e'}, ${adults} Erwachsene` +
        (needLabels.length ? `, ${needLabels.join(' + ')}` : '') +
        `) live geprüft — zwei Optionen:\n` +
        lines.map((l, i) => `${i === 0 ? '' : 'Oder '}${l}.`).join(' ') +
        ` Was hört sich für dich besser an?`;
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
          destination: city,
          checkin,
          checkout,
          adults,
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
        `${needLabels.join(' + ')} · ${fmtDateDe(checkin)}–${fmtDateDe(checkout)}`,
      );
    } else if (dualBullets.length < 3) {
      dualBullets.push(
        `${fmtDateDe(checkin)}–${fmtDateDe(checkout)} · ${nights} Nächte`,
      );
    }

    // Mehrtages-Trip / Planungsfrage → Tage im Kalender anlegen
    let calendarHint = '';
    const wantsTripSeed =
      nights >= 1 &&
      namedCity &&
      /\b(plan|urlaub|trip|aufenthalt|will|möcht|nach\s+\w+|in\s+(die\s+)?stadt|tage)\b/iu.test(
        text,
      );
    if (wantsTripSeed) {
      try {
        const { activateTripStay } = require('../../services/trip/activateTripStay') as {
          activateTripStay: (p: {
            dayCount: number;
            cityName: string | null;
            startDayKey: string;
            sourceText: string;
          }) => { ok: boolean; speechHint?: string };
        };
        const seeded = activateTripStay({
          dayCount: Math.min(14, Math.max(1, nights)),
          cityName: city,
          startDayKey: checkin,
          sourceText: text,
        });
        if (seeded.ok) {
          calendarHint =
            ' Die Tage liegen schon im Kalender — Unterkunft und Programm können wir als Nächstes füllen.';
        }
      } catch {
        /* soft */
      }
    }

    if (calendarHint && !/kalender/i.test(draft)) {
      draft = `${draft}${calendarHint}`.trim();
    }

    return {
      agent: 'booking',
      ok: true,
      draftText: [
        'FAKTEN Unterkunft Maps-Pitch + Stay22 (nicht wörtlich vorlesen):',
        draft,
        'FLOW: Immer 2 Optionen flüssig weben (Name + warum + Preis, weicher Übergang) → Buttons je Unterkunft (Buchen + Maps). Nie „selbst durchklicken“.',
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
        lodgingType,
        amenityNeeds: needLabels,
        partialAmenityFallback: false,
        hardAmenityReject: false,
        primaryId: primary.id,
        affiliate: 'stay22',
        hardMatch: needLabels.length > 0,
        booking_deep_link: true,
        mapsPitch: true,
        pitchKind: 'hotel',
        tripCalendarSeeded: Boolean(calendarHint),
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
