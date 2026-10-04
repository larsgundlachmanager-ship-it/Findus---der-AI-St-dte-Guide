/**
 * Live-Tagesprogramm: echte Locations + Öffnungsfenster + Ticket-/Web-Links.
 * Soft-Gerüst bleibt Fallback — Treffer nur belegt (Places), nie Fantasie-Orte.
 */

import type { DayBlock, DayPlan, ReiseLedger } from '../types';
import type { SoftDayTheme } from './softCityDayPlan';

export type LiveSlotKind =
  | 'restaurant'
  | 'club'
  | 'bar'
  | 'sight'
  | 'museum'
  | 'spa'
  | 'tour'
  | 'market'
  | 'viewpoint'
  | 'activity';

type SlotSpec = {
  id: string;
  kind: LiveSlotKind;
  /** Soft-Titel falls Suche leer */
  softTitle: string;
  query: string;
  includedType?: string | null;
  /** HH:MM Vorschlag wenn keine Opens-At */
  defaultTime: string;
  evening?: boolean;
};

function placeShort(placeName: string): string {
  return (placeName || '').split(',')[0]!.trim() || 'city';
}

function vibe(ledger: ReiseLedger): {
  party: boolean;
  spa: boolean;
  active: boolean;
  chill: boolean;
  food: boolean;
} {
  const blob = [
    ledger.purpose?.value,
    ledger.highlightWant?.value,
    ledger.extraWishes?.value,
    ledger.energy?.value,
    ledger.partyGrain?.value,
    ledger.spaStyle?.value,
    ...(ledger.mustHaves?.value ?? []),
    ...(ledger.wishHaves?.value ?? []),
    ...(ledger.mustActivities?.value ?? []),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return {
    party:
      ledger.partyGrain?.value === 'clubs' ||
      ledger.partyGrain?.value === 'bars' ||
      /\b(party|club|feier|nightlife)\b/.test(blob),
    spa: Boolean(ledger.spaStyle?.value) || /\b(spa|thermal|sauna|baden)\b/.test(blob),
    active:
      ledger.energy?.value === 'active_out' ||
      /\b(wandern|hike|klettern|action|sport|padel)\b/.test(blob),
    chill: ledger.energy?.value === 'chill_pool' || /\b(chill|pool|entspann)\b/.test(blob),
    food: /\b(essen|food|kulinar|markt|street.?food)\b/.test(blob),
  };
}

/** Theme aus Soft-Tages-Titel ableiten. */
export function themeFromDayTitle(title: string): SoftDayTheme {
  const t = (title || '').toLowerCase();
  if (/anreise/.test(t)) return 'arrival_evening';
  if (/feier|party|club/.test(t)) return 'party';
  if (/action/.test(t)) return 'action';
  if (/spa|bad/.test(t)) return 'spa';
  if (/food|essen/.test(t)) return 'food';
  if (/ausklang/.test(t)) return 'wind_down';
  return 'explore';
}

/** Suche-Slots pro Tag — stadt-agnostisch, User-Vibe steuert Query. */
export function liveSlotsForTheme(
  theme: SoftDayTheme,
  placeName: string,
  ledger: ReiseLedger,
): SlotSpec[] {
  const city = placeShort(placeName);
  const v = vibe(ledger);
  const acts = (ledger.mustActivities?.value ?? [])
    .map((a) => String(a).trim())
    .filter((a) => a && !/^e-?sim$/i.test(a));

  if (theme === 'arrival_evening') {
    return [
      {
        id: 'arr-food',
        kind: 'restaurant',
        softTitle: 'Abendessen lokal',
        query: v.food
          ? `best local restaurant ${city}`
          : `traditional restaurant ${city} dinner`,
        includedType: 'restaurant',
        defaultTime: '19:00',
        evening: true,
      },
      {
        id: 'arr-night',
        kind: v.party ? 'bar' : 'sight',
        softTitle: v.party ? 'Warm-up Bar' : 'Abendspaziergang',
        query: v.party
          ? `popular bar nightlife ${city}`
          : `old town evening walk viewpoint ${city}`,
        includedType: v.party ? 'bar' : 'tourist_attraction',
        defaultTime: '21:30',
        evening: true,
      },
    ];
  }

  if (theme === 'party') {
    return [
      {
        id: 'day-act',
        kind: v.active ? 'activity' : 'sight',
        softTitle: 'Tagsüber Stadt',
        query: acts[0]
          ? `${acts[0]} ${city}`
          : v.active
            ? `outdoor activity adventure ${city}`
            : `must see landmark ${city}`,
        includedType: v.active ? null : 'tourist_attraction',
        defaultTime: '11:00',
      },
      {
        id: 'night-club',
        kind: 'club',
        softTitle: 'Abend Feiern',
        query: `best nightclub ${city}`,
        includedType: 'night_club',
        defaultTime: '23:00',
        evening: true,
      },
    ];
  }

  if (theme === 'action') {
    return [
      {
        id: 'am-action',
        kind: 'activity',
        softTitle: 'Vormittag Action',
        query: acts[0]
          ? `${acts[0]} ${city}`
          : `adventure tour outdoor ${city}`,
        defaultTime: '10:00',
      },
      {
        id: 'pm',
        kind: v.spa ? 'spa' : 'sight',
        softTitle: v.spa ? 'Thermal / Bad' : 'Nachmittag',
        query: v.spa
          ? `thermal bath spa ${city}`
          : `viewpoint park ${city}`,
        includedType: v.spa ? null : 'park',
        defaultTime: '15:30',
      },
    ];
  }

  if (theme === 'spa') {
    return [
      {
        id: 'spa',
        kind: 'spa',
        softTitle: 'Thermal / Spa',
        query: `thermal bath spa wellness ${city}`,
        defaultTime: '11:00',
      },
      {
        id: 'eve',
        kind: 'restaurant',
        softTitle: 'Ruhiges Abendessen',
        query: `quiet restaurant ${city}`,
        includedType: 'restaurant',
        defaultTime: '19:00',
        evening: true,
      },
    ];
  }

  if (theme === 'food') {
    return [
      {
        id: 'market',
        kind: 'market',
        softTitle: 'Markt / Streetfood',
        query: `food market street food hall ${city}`,
        defaultTime: '11:00',
      },
      {
        id: 'view',
        kind: 'viewpoint',
        softTitle: 'Aussicht',
        query: `best viewpoint lookout ${city}`,
        includedType: 'tourist_attraction',
        defaultTime: '16:00',
      },
    ];
  }

  if (theme === 'wind_down') {
    return [
      {
        id: 'slow',
        kind: v.chill ? 'spa' : 'sight',
        softTitle: 'Langsamer Tag',
        query: v.chill
          ? `cafe garden park ${city}`
          : `quiet museum gallery ${city}`,
        includedType: v.chill ? 'cafe' : 'museum',
        defaultTime: '11:00',
      },
      {
        id: 'dinner',
        kind: 'restaurant',
        softTitle: 'Abschluss-Essen',
        query: `nice dinner restaurant ${city}`,
        includedType: 'restaurant',
        defaultTime: '19:00',
        evening: true,
      },
    ];
  }

  // explore
  const explore: SlotSpec[] = [
    {
      id: 'am',
      kind: acts.some((a) => /museum/i.test(a)) ? 'museum' : 'sight',
      softTitle: 'Vormittag Erkunden',
      query: acts.some((a) => /museum/i.test(a))
        ? `museum ${city}`
        : `old town landmark must see ${city}`,
      includedType: acts.some((a) => /museum/i.test(a))
        ? 'museum'
        : 'tourist_attraction',
      defaultTime: '10:30',
    },
    {
      id: 'pm',
      kind: 'sight',
      softTitle: 'Nachmittag Kontrast',
      query: `park hill viewpoint ${city}`,
      includedType: 'park',
      defaultTime: '15:00',
    },
  ];
  if (v.party) {
    explore.push({
      id: 'eve',
      kind: 'bar',
      softTitle: 'Abend Bars',
      query: `popular nightlife bar district ${city}`,
      includedType: 'bar',
      defaultTime: '21:00',
      evening: true,
    });
  } else {
    explore.push({
      id: 'eve',
      kind: 'restaurant',
      softTitle: 'Abendessen',
      query: `local restaurant ${city}`,
      includedType: 'restaurant',
      defaultTime: '19:00',
      evening: true,
    });
  }
  return explore;
}

function minToHhmm(min: number | null | undefined, fallback: string): string {
  if (min == null || !Number.isFinite(min)) return fallback;
  const m = ((Math.round(min) % 1440) + 1440) % 1440;
  const hh = String(Math.floor(m / 60)).padStart(2, '0');
  const mm = String(m % 60).padStart(2, '0');
  return `${hh}:${mm}`;
}

function bookUrlForPlace(opts: {
  kind: LiveSlotKind;
  name: string;
  websiteUri?: string | null;
  placeName: string;
  dateIso: string | null;
  adults: number;
}): string | null {
  const site = (opts.websiteUri || '').trim();
  if (/^https?:\/\//i.test(site) && !/facebook|instagram|twitter/i.test(site)) {
    return site;
  }
  try {
    const { wishChapterBookUrl } = require('./wishBookLink') as typeof import('./wishBookLink');
    const stubOpt = { placeName: opts.placeName, comboWindows: [] } as any;
    const stubLed = {
      dateStart: opts.dateIso ? { value: opts.dateIso } : null,
      adults: { value: opts.adults },
    } as any;
    return wishChapterBookUrl(
      opts.kind === 'club' || opts.kind === 'bar'
        ? 'club'
        : opts.kind === 'museum'
          ? 'museum'
          : opts.kind === 'tour' || opts.kind === 'activity'
            ? 'tour'
            : opts.kind === 'sight' || opts.kind === 'viewpoint'
              ? 'sight'
              : 'activity',
      { mustHaveId: opts.kind, name: opts.name, met: true, onProperty: false },
      stubOpt,
      stubLed,
    );
  } catch {
    return null;
  }
}

function isTransportBlock(b: DayBlock): boolean {
  return /^(flug|bahn|fernbus|camper|anreise|check-in|check-out|transfer|e-?sim)/i.test(
    b.title || '',
  );
}

/**
 * Soft-Tagespläne mit echten Places anreichern (parallel pro Tag/Slot).
 */
export async function enrichDayPlansWithLivePlaces(opts: {
  days: DayPlan[];
  lat: number;
  lng: number;
  placeName: string;
  ledger: ReiseLedger;
  /** Ankunftszeit Tag 1 — Abend-Slots danach. */
  arriveAt?: string | null;
}): Promise<DayPlan[]> {
  if (!opts.days.length || !Number.isFinite(opts.lat) || !Number.isFinite(opts.lng)) {
    return opts.days;
  }
  let searchPlacesByText: typeof import('../../services/navigation/googleMapsNav').searchPlacesByText;
  try {
    ({ searchPlacesByText } = await import('../../services/navigation/googleMapsNav'));
  } catch {
    return opts.days;
  }

  const adults = opts.ledger.adults?.value ?? 2;
  const usedNames = new Set<string>();

  const enrichDay = async (day: DayPlan, dayIndex: number): Promise<DayPlan> => {
    if (/abreise/i.test(day.title)) return day;
    const theme = themeFromDayTitle(day.title);
    const slots = liveSlotsForTheme(theme, opts.placeName, opts.ledger);
    const visitMs = Date.parse(`${day.dayKey}T12:00:00`);
    const keepTransport = (day.blocks ?? []).filter(isTransportBlock);

    const liveBlocks: DayBlock[] = [];
    for (const slot of slots) {
      try {
        const hits = await searchPlacesByText({
          query: slot.query,
          lat: opts.lat,
          lng: opts.lng,
          radiusM: 14_000,
          includedType: slot.includedType ?? undefined,
          enrich: true,
          forVisitMs: Number.isFinite(visitMs) ? visitMs : null,
        });
        const pick = hits.find((h) => {
          const k = (h.name || '').toLowerCase().slice(0, 28);
          if (!k || usedNames.has(k)) return false;
          if (h.closedOnVisitDay) return false;
          if (/atm|parking|parkplatz|gas station|tankstelle/i.test(h.name)) return false;
          return true;
        });
        if (!pick) {
          liveBlocks.push({
            id: `${day.dayKey}-${slot.id}-soft`,
            time: slot.defaultTime,
            title: slot.softTitle,
            detail: `Noch kein belegter Treffer — ${placeShort(opts.placeName)}`,
            bookUrl: null,
          });
          continue;
        }
        usedNames.add((pick.name || '').toLowerCase().slice(0, 28));
        let time = slot.defaultTime;
        if (slot.evening && pick.opensAtMin != null) {
          time = minToHhmm(Math.max(pick.opensAtMin, 18 * 60), slot.defaultTime);
        } else if (pick.opensAtMin != null && !slot.evening) {
          time = minToHhmm(Math.max(pick.opensAtMin, 9 * 60), slot.defaultTime);
        }
        if (dayIndex === 0 && opts.arriveAt && /^\d{1,2}:\d{2}/.test(opts.arriveAt)) {
          const [ah, am] = opts.arriveAt.split(':').map(Number);
          const arriveMin = (ah || 0) * 60 + (am || 0) + 90;
          const [th, tm] = time.split(':').map(Number);
          const slotMin = (th || 0) * 60 + (tm || 0);
          if (slotMin < arriveMin) {
            time = minToHhmm(arriveMin, slot.defaultTime);
          }
        }
        const detailBits = [
          pick.rating != null && (pick.ratingCount ?? 0) >= 20
            ? `${pick.rating.toFixed(1)}★`
            : null,
          pick.distanceM != null && pick.distanceM < 20_000
            ? pick.distanceM < 1000
              ? `${pick.distanceM} m`
              : `${(pick.distanceM / 1000).toFixed(1)} km`
            : null,
          pick.closesAtMin != null
            ? `bis ${minToHhmm(pick.closesAtMin, '')}`.replace(/bis $/, '')
            : null,
        ].filter(Boolean);
        liveBlocks.push({
          id: `${day.dayKey}-${slot.id}`,
          time,
          title: pick.name,
          detail: detailBits.join(' · ') || slot.softTitle,
          bookUrl: bookUrlForPlace({
            kind: slot.kind,
            name: pick.name,
            websiteUri: pick.websiteUri,
            placeName: opts.placeName,
            dateIso: day.dayKey,
            adults,
          }),
          costEur: null,
        });
      } catch {
        liveBlocks.push({
          id: `${day.dayKey}-${slot.id}-soft`,
          time: slot.defaultTime,
          title: slot.softTitle,
          detail: 'Suche kurz fehlgeschlagen — Soft-Slot',
          bookUrl: null,
        });
      }
    }

    return {
      ...day,
      blocks: [...keepTransport, ...liveBlocks],
    };
  };

  // Parallel Tage (max ~5), sequentiell Slots pro Tag wegen usedNames
  const out: DayPlan[] = [];
  for (let i = 0; i < opts.days.length; i++) {
    out.push(await enrichDay(opts.days[i]!, i));
  }
  try {
    const { normalizeDayPlans } = await import('./composePlan');
    return normalizeDayPlans(out);
  } catch {
    return out;
  }
}
