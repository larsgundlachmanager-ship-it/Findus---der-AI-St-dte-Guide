import { getCarRentalUrl } from '../../services/affiliate/affiliateService';
import {
  buildKiwiSearchPageUrl,
  buildKiwiTravelpayoutsUrl,
} from '../../services/affiliate/travelpayoutsPartners';
import { searchStay22HotelsInCity } from '../../services/concierge/hotelAvailabilityService';
import { offsetDateKey, todayDateKey } from '../../utils/dateKeys';
import { isBriefComplete, hasUserBudget } from '../completeness';
import { needsNight } from '../completeness';
import { useReisebueroStore } from '../store';
import type { FunnelLogLine, ReiseLedger, ReiseOption, StoryStop } from '../types';
import { driveHours, haversineKm, SEED_PLACES, type SeedPlace } from './candidates';
import {
  buildFacts,
  matchScore,
  perPersonPrice,
  priceIncludesLine,
  restBudget,
  tripNickname,
  whyBlurb,
} from './optionCard';
import {
  proCandidateToSeed,
  proFlightPriceHint,
  resolveNamedDestinationSeed,
  runReisebueroProDiscover,
  runReisebueroProRankOptions,
} from './proEnrich';
import { shouldUseReisebueroPro } from './proEnrichParse';
import { fetchWikiThumb } from './wikiThumb';

function originOf(ledger: ReiseLedger): { lat: number; lng: number; city: string } {
  return {
    lat: ledger.originLat?.value ?? 53.5511,
    lng: ledger.originLng?.value ?? 9.9937,
    city: ledger.originCity?.value || 'Hamburg',
  };
}

function stayWindow(ledger: ReiseLedger): { checkin: string; checkout: string } {
  const nights =
    ledger.stayNights?.value ??
    (ledger.dateStart?.value && ledger.dateEnd?.value
      ? Math.max(
          1,
          Math.round(
            (Date.parse(`${ledger.dateEnd.value}T12:00:00`) - Date.parse(`${ledger.dateStart.value}T12:00:00`)) /
              86_400_000,
          ),
        )
      : null) ??
    (ledger.stayDays?.value ? Math.max(1, ledger.stayDays.value - 1) : 2);
  const start = ledger.dateStart?.value || searchStartFromMonth(ledger) || todayDateKey();
  if (ledger.mode?.value === 'daytrip') {
    return { checkin: start, checkout: start };
  }
  const startMs = Date.parse(`${start}T12:00:00`);
  return { checkin: start, checkout: offsetDateKey(nights, startMs) };
}

function searchStartFromMonth(ledger: ReiseLedger): string | null {
  const ym = ledger.dateMonth?.value;
  if (!ym || !/^\d{4}-\d{2}$/.test(ym)) return null;
  const [y, m] = ym.split('-').map(Number) as [number, number];
  const part = ledger.datePart?.value;
  let day = 12;
  if (part === 'early') day = 5;
  if (part === 'late') day = 22;
  const d = new Date(y, m - 1, day, 12, 0, 0);
  const add = (5 - d.getDay() + 7) % 7;
  d.setDate(d.getDate() + add);
  if (d.getMonth() !== m - 1) d.setDate(d.getDate() - 7);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function tagMatch(place: SeedPlace, ledger: ReiseLedger): boolean {
  const must = new Set(ledger.mustHaves?.value ?? []);
  const corridor = (ledger.corridor?.value || '').toLowerCase();
  if (corridor && !place.tags.some((t) => corridor.includes(t) || t.includes(corridor.replace(/see$/, 'see')))) {
    if (corridor === 'ostsee' && !place.tags.includes('ostsee')) return false;
    if (corridor === 'nordsee' && !place.tags.includes('nordsee')) return false;
    if (corridor === 'niederlande' && !place.tags.includes('niederlande')) return false;
    if (corridor === 'mallorca' && place.id !== 'palma') return false;
    if (corridor === 'antalya' && place.id !== 'antalya') return false;
    if (corridor === 'griechenland' && !place.tags.includes('griechenland')) return false;
  }
  if (must.has('sand') && !place.tags.includes('sand') && !place.tags.includes('sea')) return false;
  if (must.has('sea') && !place.tags.includes('sea') && !place.tags.includes('ostsee') && !place.tags.includes('nordsee')) {
    return false;
  }
  const mode = ledger.mode?.value;
  if (mode === 'daytrip' && !place.tags.includes('daytrip') && !place.tags.includes('ostsee')) {
    return false;
  }
  if (mode === 'fly' && ledger.mode?.hardness === 'must' && !corridor) {
    return place.tags.includes('fly') || place.tags.includes('warm') || place.tags.includes('named');
  }
  if (mode === 'bike' && !place.tags.includes('bike') && corridor !== 'niederlande') return false;
  return true;
}

function visitedNames(): string[] {
  try {
    const { useFinnusStore } = require('../../store/useFinnusStore') as {
      useFinnusStore: { getState: () => { visitedHistory: Array<{ name?: string }> } };
    };
    return useFinnusStore
      .getState()
      .visitedHistory.map((v) => (v.name || '').toLowerCase())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function mergePlacePool(
  base: SeedPlace[],
  extras: SeedPlace[],
  max: number,
): SeedPlace[] {
  const seen = new Set<string>();
  const out: SeedPlace[] = [];
  for (const p of [...extras, ...base]) {
    const key = p.id || p.name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
    if (out.length >= max) break;
  }
  return out;
}

async function enrichOnePlace(opts: {
  place: SeedPlace;
  ledger: ReiseLedger;
  origin: { lat: number; lng: number; city: string };
  checkin: string;
  checkout: string;
  adults: number;
  lodging: 'apartment' | 'hotel' | 'any';
  overnight: boolean;
  must: Set<string>;
  proWhy?: string;
}): Promise<ReiseOption> {
  const { place, ledger, origin, checkin, checkout, adults, lodging, overnight, must, proWhy } =
    opts;
  const hours = driveHours(haversineKm(origin, place));
  const gaps: string[] = [];
  if (must.has('padel')) gaps.push('Padel: Places-Beleg folgt, nicht garantiert nebenan');
  if (must.has('paddle')) gaps.push('Paddeln: Station in der Nähe nicht belegt');
  if (must.has('spikeball')) gaps.push('Spikeball: Sandstrand als Proxy');
  if (must.has('grill')) gaps.push('Grill am Haus nicht belegt');
  if (must.has('boat')) gaps.push('Boot mieten nicht belegt');

  let stayName: string | null = null;
  let stayBookUrl: string | null = null;
  let stayPrice: number | null = null;
  let stayLat = place.lat;
  let stayLng = place.lng;
  let stayAmen = '';
  if (overnight) {
    try {
      const live = await searchStay22HotelsInCity({
        city: place.name,
        checkin,
        checkout,
        adults,
        lodgingType: lodging,
        lat: place.lat,
        lng: place.lng,
        pageSize: 16,
        amenityHint:
          must.has('pool') || (ledger.wishHaves?.value ?? []).includes('pool') ? 'pool' : null,
      });
      const pick = live.stays[0] ?? null;
      if (pick) {
        stayName = pick.name;
        stayBookUrl = pick.bookUrl;
        stayPrice = pick.priceTotal;
        stayLat = pick.lat ?? place.lat;
        stayLng = pick.lng ?? place.lng;
        stayAmen = (pick.amenities ?? []).join(' ');
        if (must.has('pool') && !/pool/i.test(stayAmen)) {
          gaps.push('Pool nicht in Stay22-Amenities belegt');
        }
      } else {
        gaps.push('Keine live bepreisbare Unterkunft');
      }
    } catch {
      gaps.push('Unterkunft-Suche fehlgeschlagen');
    }
  }

  let flightUrl: string | null = null;
  let flightPrice: number | null = null;
  if (ledger.mode?.value === 'fly' && place.iata && ledger.airportIata?.value) {
    try {
      flightUrl = buildKiwiTravelpayoutsUrl(
        buildKiwiSearchPageUrl({
          fromIata: ledger.airportIata.value,
          toIata: place.iata,
          dateKey: checkin,
        }),
        { subId: 'reisebuero' },
      );
    } catch {
      flightUrl = null;
    }
  }

  const photo = await fetchWikiThumb(place.wiki);
  const driveEur = overnight ? 0 : Math.round(hours * 18);
  const total =
    stayPrice != null
      ? stayPrice + driveEur
      : ledger.mode?.value === 'fly'
        ? null
        : driveEur || null;
  const budget = hasUserBudget(ledger) ? ledger.budgetEur?.value ?? null : null;
  const budgetDelta = budget != null && total != null ? total - budget : null;
  const facts = buildFacts({ place, ledger, gaps, stayAmenities: stayAmen });
  const met = facts.filter((f) => f.met).length;
  const title = tripNickname(place, stayName, ledger, overnight);
  const blurb = proWhy?.trim() || whyBlurb(facts, place, hours);
  const why: string[] = [blurb];
  if (why.length < 2) why.push(`Start ${origin.city}`);

  const rest = restBudget(budget, total, ledger);
  const pp = perPersonPrice(total, adults);

  const stops: StoryStop[] = [
    {
      id: 'origin',
      title: origin.city,
      why: 'Start',
      lat: origin.lat,
      lng: origin.lng,
      kind: 'origin',
    },
    {
      id: 'place',
      title: place.name,
      why: why[0] || '',
      lat: stayLat,
      lng: stayLng,
      photoUrl: photo,
      kind: overnight ? 'stay' : 'poi',
    },
  ];
  if (stayName) {
    stops.push({
      id: 'stay',
      title: stayName,
      why: stayPrice != null ? `${Math.round(stayPrice)} €` : 'Unterkunft',
      lat: stayLat,
      lng: stayLng,
      kind: 'stay',
    });
  }

  const carUrl =
    ledger.mode?.value === 'drive' || ledger.mode?.value === 'daytrip'
      ? getCarRentalUrl({
          pickupLocation: origin.city,
          pickupDate: checkin,
          dropoffDate: checkout,
        })
      : null;

  return {
    id: place.id,
    title,
    placeName: place.name,
    lat: stayLat,
    lng: stayLng,
    totalEur: total,
    budgetDeltaEur: budgetDelta,
    pricePerPerson: pp,
    priceIncludes: priceIncludesLine(overnight, stayPrice != null, ledger.mode?.value),
    restBudgetEur: rest?.eur ?? null,
    restBudgetHint: rest?.hint ?? null,
    matchScore: matchScore({
      gaps: gaps.length,
      wanted: facts.length,
      met,
      budgetDeltaEur: budgetDelta,
    }),
    whyBlurb: blurb,
    facts,
    whyMatch: why.length >= 2 ? [why[0]!, why[1]!] : [why[0]!],
    gaps,
    photoUrl: photo,
    stayName,
    stayBookUrl,
    stayPriceEur: stayPrice,
    carBookUrl: carUrl,
    flightBookUrl: flightUrl,
    flightPriceEur: null,
    stops,
  };
}

export async function runReisebueroFunnel(): Promise<void> {
  const store = useReisebueroStore.getState();
  const { trip } = store;
  store.setSearching(true);
  const log: FunnelLogLine[] = [];
  const ledger = trip.ledger;
  const usePro = shouldUseReisebueroPro(trip);
  log.push({
    stage: '0',
    detail: `Brief ${isBriefComplete(ledger) ? 'komplett' : 'mit Defaults'} — Modus ${ledger.mode?.value ?? '?'} → ${usePro ? 'Pro+Live (erste Auswahl)' : 'Lite+Live (Korrektur)'}`,
  });

  const origin = originOf(ledger);
  const maxH = ledger.maxDriveHours?.value ?? (ledger.mode?.value === 'daytrip' ? 2.2 : 12);
  const visited = visitedNames();

  // Parallel: Discover (Pro nur 1×) + Named-Geocode
  const [pro, namedSeed] = await Promise.all([
    runReisebueroProDiscover(ledger, { usePro }),
    resolveNamedDestinationSeed(ledger),
  ]);
  log.push({
    stage: '0b',
    detail: pro.destinations.length
      ? `Discover(${usePro ? 'Pro' : 'Lite'}) ${pro.destinations.length}${pro.researchNotes ? ` — ${pro.researchNotes}` : ''}`
      : `Discover(${usePro ? 'Pro' : 'Lite'}) leer/soft`,
  });
  if (namedSeed) {
    log.push({ stage: '0c', detail: `Named dest ${namedSeed.name}` });
  }

  const proSeeds = pro.destinations
    .map(proCandidateToSeed)
    .filter((p): p is SeedPlace => !!p);
  const whyById = new Map(
    pro.destinations.map((d) => [d.id, d.whyFit] as const),
  );

  let pool = SEED_PLACES.filter((p) => tagMatch(p, ledger));
  log.push({ stage: '1', detail: `Seed-Geografie ${pool.length}` });

  pool = pool.filter((p) => {
    const hours = driveHours(haversineKm(origin, p));
    if (ledger.mode?.value === 'fly') return true;
    return hours <= maxH + 0.4;
  });
  log.push({ stage: '1b', detail: `Anreise-Cap ${maxH}h → ${pool.length}` });

  pool = pool.filter((p) => !visited.some((n) => n.includes(p.name.toLowerCase()) || p.name.toLowerCase().includes(n)));
  log.push({ stage: '1c', detail: `Passport-Filter → ${pool.length}` });

  if (!pool.length) {
    pool = SEED_PLACES.filter((p) => tagMatch(p, ledger)).slice(0, 6);
    log.push({ stage: '1d', detail: 'Fallback ohne Passport-Cut' });
  }

  const extras: SeedPlace[] = [];
  if (namedSeed) extras.push(namedSeed);
  extras.push(...proSeeds);
  const sliced = mergePlacePool(pool, extras, 12);
  log.push({
    stage: '2',
    detail: `Pool ${sliced.length} (Seed+Pro+Named) — parallele Stay22/Flug`,
  });

  const must = new Set(ledger.mustHaves?.value ?? []);
  const overnight = needsNight(ledger);
  const { checkin, checkout } = stayWindow(ledger);
  const adults = ledger.adults?.value ?? 2;
  const lodging =
    must.has('ferienhaus') || must.has('apartment') || ledger.lodgingQuality?.value === 'nicer_base'
      ? 'apartment'
      : must.has('hotel')
        ? 'hotel'
        : 'any';

  const options = await Promise.all(
    sliced.map((place) =>
      enrichOnePlace({
        place,
        ledger,
        origin,
        checkin,
        checkout,
        adults,
        lodging,
        overnight,
        must,
        proWhy: whyById.get(place.id),
      }),
    ),
  );

  log.push({
    stage: '3',
    detail: `Live-Backend fertig: ${options.filter((o) => o.stayBookUrl || o.flightBookUrl).length}/${options.length} mit Buchungs-URL`,
  });

  // Flug-Hints: Pro nur erste Auswahl; Korrektur = Lite, max 4
  if (ledger.mode?.value === 'fly' && ledger.airportIata?.value) {
    const flyTargets = options
      .filter((o) => !!sliced.find((p) => p.id === o.id)?.iata)
      .slice(0, usePro ? 4 : 3);
    await Promise.all(
      flyTargets.map(async (o) => {
        const place = sliced.find((p) => p.id === o.id);
        if (!place?.iata || !ledger.airportIata?.value) return;
        try {
          const tip = await proFlightPriceHint({
            fromIata: ledger.airportIata.value,
            toIata: place.iata,
            destName: place.name,
            dateKey: checkin,
            usePro,
          });
          if (tip.priceEur != null) {
            o.flightPriceEur = tip.priceEur;
            const flightPart = tip.priceEur * adults;
            if (o.stayPriceEur != null) {
              o.totalEur = o.stayPriceEur + flightPart;
            } else {
              o.totalEur = flightPart;
            }
            o.pricePerPerson = perPersonPrice(o.totalEur, adults);
            const budget = hasUserBudget(ledger) ? ledger.budgetEur?.value ?? null : null;
            o.budgetDeltaEur =
              budget != null && o.totalEur != null ? o.totalEur - budget : null;
          }
          if (tip.note) o.gaps.push(`Flug-Hinweis: ${tip.note}`);
        } catch {
          /* soft */
        }
      }),
    );
    log.push({
      stage: '3b',
      detail: `Flug-Hints(${usePro ? 'Pro' : 'Lite'}) ${flyTargets.length}`,
    });
  }

  // Rank: Pro nur erste Auswahl
  const ranks = await runReisebueroProRankOptions({ ledger, options, usePro });
  for (const o of options) {
    const patch = ranks.get(o.id);
    if (!patch) continue;
    o.whyBlurb = patch.whyBlurb || o.whyBlurb;
    o.whyMatch = patch.whyMatch;
    o.matchScore = Math.max(0, Math.min(100, o.matchScore + patch.boost * 4));
  }
  log.push({
    stage: '4',
    detail: ranks.size
      ? `Rank(${usePro ? 'Pro' : 'Lite'}) ${ranks.size} Optionen`
      : 'Rank soft-fail — Score aus Live-Facts',
  });

  const scored = options.sort((a, b) => b.matchScore - a.matchScore || a.gaps.length - b.gaps.length);

  const top = scored.slice(0, 4);
  log.push({
    stage: '5',
    detail: `${top.length} Szenarien (${usePro ? 'Pro' : 'Lite'}+Live)`,
  });
  if (!top.length) {
    store.setSearching(false, 'Keine belegten Treffer im Trichter — Brief lockern oder Korridor ändern.');
    return;
  }
  store.setOptions(top, log);
}
