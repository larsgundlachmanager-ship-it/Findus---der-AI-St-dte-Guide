import { getCarRentalUrl } from '../../services/affiliate/affiliateService';
import { buildKiwiSearchPageUrl } from '../../services/affiliate/travelpayoutsPartners';
import { searchStay22HotelsInCity } from '../../services/concierge/hotelAvailabilityService';
import { offsetDateKey, todayDateKey } from '../../utils/dateKeys';
import { isBriefComplete, hasUserBudget } from '../completeness';
import { needsNight } from '../completeness';
import { useReisebueroStore } from '../store';
import type { FunnelLogLine, ReiseLedger, ReiseOption, StoryStop } from '../types';
import { driveHours, haversineKm, SEED_PLACES, type SeedPlace } from './candidates';
import {
  isPartyLedger,
  isSpaLedger,
  pickDiversePlaces,
} from './diversity';
import {
  intentArcFromLedger,
  pickFromShortlist,
  prioritizeSeedsByTaste,
  shortlistSearchBrief,
} from './shortlistFunnel';
import {
  buildFacts,
  buildSoftFacts,
  fitLine,
  matchScore,
  perPersonPrice,
  priceIncludesLine,
  restBudget,
  speechTopTwoSummary,
  tripNickname,
  uniquifyMatchScores,
  whyBlurb,
} from './optionCard';
import {
  emitSpark,
  emitStep,
  finishStep,
  pivotStep,
  placeSparkEmoji,
  seedResearchTheater,
} from './stepEngine';
import {
  stayLodgingSearchOrder,
  type StayLodgingType,
} from './stayLodgingSearchOrder';
import {
  proCandidateToSeed,
  proFlightPriceHint,
  resolveNamedDestinationSeed,
  runAiInclusivesCheck,
  runReisebueroProDiscover,
  runReisebueroProRankOptions,
} from './proEnrich';
import { runGemHuntDiscover, isGemTagged } from './gemHunt';
import { shouldUseReisebueroPro } from './proEnrichParse';
import { fetchWikiThumb, wikiTitleCandidates } from './wikiThumb';
import { isJunkPlaceName, sanitizeTravelPlaceName } from '../placeNameSanity';

function originOf(ledger: ReiseLedger): { lat: number; lng: number; city: string } {
  const raw =
    ledger.originCity?.value || ledger.originCities?.value?.[0] || 'Hamburg';
  const city = sanitizeTravelPlaceName(raw, 'Hamburg');
  return {
    lat: ledger.originLat?.value ?? 53.5511,
    lng: ledger.originLng?.value ?? 9.9937,
    city,
  };
}

/** Junk-Start („Davon“) aus dem Ledger werfen — Brief ≠ 1:1 STT. */
export function scrubJunkPlacesFromLedger(ledger: ReiseLedger): ReiseLedger {
  const next = { ...ledger };
  if (next.originCity?.value && isJunkPlaceName(next.originCity.value)) {
    next.originCity = null;
  }
  if (next.originCities?.value?.length) {
    const cleaned = next.originCities.value.filter((c) => !isJunkPlaceName(c));
    next.originCities = cleaned.length
      ? { ...next.originCities, value: cleaned }
      : null;
  }
  if (next.destinationHint?.value && isJunkPlaceName(next.destinationHint.value)) {
    next.destinationHint = null;
  }
  return next;
}

function originAirports(ledger: ReiseLedger): string[] {
  const cities = ledger.originCities?.value?.length
    ? ledger.originCities.value
    : ledger.originCity?.value
      ? [ledger.originCity.value]
      : [];
  const map: Record<string, string> = {
    Hamburg: 'HAM',
    Bremen: 'BRE',
    Berlin: 'BER',
    Hannover: 'HAJ',
    Köln: 'CGN',
    Düsseldorf: 'DUS',
    Frankfurt: 'FRA',
    München: 'MUC',
    Stuttgart: 'STR',
    Dortmund: 'DTM',
  };
  const iatas = cities.map((c) => map[c]).filter(Boolean) as string[];
  if (ledger.airportIata?.value && !iatas.includes(ledger.airportIata.value)) {
    iatas.unshift(ledger.airportIata.value);
  }
  return iatas.length ? [...new Set(iatas)] : ledger.airportIata?.value ? [ledger.airportIata.value] : [];
}

function stayWindow(ledger: ReiseLedger): { checkin: string; checkout: string } {
  // Datumsspanne schlägt stale stayNights (z. B. Wochenende=2 trotz 16.–20.10.)
  const fromDates =
    ledger.dateStart?.value && ledger.dateEnd?.value
      ? Math.max(
          1,
          Math.round(
            (Date.parse(`${ledger.dateEnd.value}T12:00:00`) -
              Date.parse(`${ledger.dateStart.value}T12:00:00`)) /
              86_400_000,
          ),
        )
      : null;
  const nights =
    fromDates ??
    ledger.stayNights?.value ??
    (ledger.stayDays?.value ? Math.max(1, ledger.stayDays.value - 1) : 2);
  const start = ledger.dateStart?.value || searchStartFromMonth(ledger) || todayDateKey();
  if (ledger.mode?.value === 'daytrip') {
    return { checkin: start, checkout: start };
  }
  // Beide Daten gesetzt → checkout = dateEnd (nicht start+staleNights)
  if (ledger.dateStart?.value && ledger.dateEnd?.value) {
    return { checkin: ledger.dateStart.value, checkout: ledger.dateEnd.value };
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
  // Party ohne Strand-Must: Stadt-/Club-Ziele nicht wegen sand/sea rauswerfen
  if (isPartyLedger(ledger) && !must.has('sand') && !must.has('sea')) {
    /* allow city/party seeds */
  }
  // Spa: Strand-Must nicht erzwingen
  if (isSpaLedger(ledger) && must.has('spa') && !place.tags.includes('spa') && !place.tags.includes('city')) {
    return false;
  }
  const mode = ledger.mode?.value;
  if (mode === 'daytrip' && !place.tags.includes('daytrip') && !place.tags.includes('ostsee')) {
    return false;
  }
  if (mode === 'fly' && ledger.mode?.hardness === 'must' && !corridor) {
    return (
      place.tags.includes('fly') ||
      place.tags.includes('warm') ||
      place.tags.includes('named') ||
      place.tags.includes('party') ||
      place.tags.includes('spa')
    );
  }
  if (mode === 'bike' && !place.tags.includes('bike') && corridor !== 'niederlande') return false;
  if (mode === 'hike' && !place.tags.includes('hike') && !place.tags.includes('train') && !place.tags.includes('alpen')) {
    // soft: allow spa/train hinterland
    if (!place.tags.includes('spa')) return false;
  }
  if (mode === 'camping' && !place.tags.includes('camping') && !place.tags.includes('sand') && !place.tags.includes('hike')) {
    return false;
  }
  return true;
}

/** Party/Spa zuerst im Pool — dann Rest. */
function biasPoolForIntent(pool: SeedPlace[], ledger: ReiseLedger): SeedPlace[] {
  if (isPartyLedger(ledger)) {
    const hot = pool.filter((p) => p.tags.includes('party'));
    const rest = pool.filter((p) => !p.tags.includes('party'));
    return [...hot, ...rest];
  }
  if (isSpaLedger(ledger)) {
    const hot = pool.filter((p) => p.tags.includes('spa'));
    const rest = pool.filter((p) => !p.tags.includes('spa'));
    return [...hot, ...rest];
  }
  return pool;
}

function amenityBlob(s: { name?: string; amenities?: string[] | null }): string {
  return `${s.name || ''} ${(s.amenities ?? []).join(' ')}`.toLowerCase();
}

function looksAllInclusive(s: { name?: string; amenities?: string[] | null }): boolean {
  return /all[\s-]?inclusive|ultra\s*all|alles\s+inklusive|pauschal/.test(amenityBlob(s));
}

function looksAlcoholIncluded(blob: string): boolean {
  return /alkohol|alcohol|open\s*bar|drinks?\s+included|inklusive\s+(?:alkohol|getränke|getraenke)|unlimited\s+drinks|getränke\s+inklusive|getraenke\s+inklusive/.test(
    blob,
  );
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
  researchPath?: import('./researchPath').ResearchPathKind;
  /** Stay22-Fallback per Grounding (Quota) — erst in QA/Nachziehen an */
  allowGroundedStay?: boolean;
}): Promise<ReiseOption> {
  const {
    place,
    ledger,
    origin,
    checkin,
    checkout,
    adults,
    lodging,
    overnight,
    must,
    proWhy,
    researchPath = 'flight_first',
    allowGroundedStay = false,
  } = opts;
  const hours = driveHours(haversineKm(origin, place));
  const gaps: string[] = [];
  const {
    extractStayMustSpecs,
    rankStaysByAmenityMusts,
    amenityHitsForStay,
    gapsFromAmenityHits,
    gapsFromProximityHits,
    verifyProximityMusts,
    amenityHintFromSpecs,
    hardMustScoreBoost,
  } = await import('./stayMustVerify');
  const stayMustSpecs = extractStayMustSpecs(ledger);
  const amenityMustSpecs = stayMustSpecs.filter(
    (s): s is import('./stayMustVerify').AmenityMustSpec => s.kind === 'amenity',
  );
  const proximityMustSpecs = stayMustSpecs.filter(
    (s): s is import('./stayMustVerify').ProximityMustSpec => s.kind === 'proximity',
  );
  // Soft placeholders only when not covered by hard amenity verify
  if (must.has('paddle') && !amenityMustSpecs.some((s) => s.id === 'paddle')) {
    gaps.push('Paddeln: Station in der Nähe nicht belegt');
  }
  if (must.has('spikeball')) gaps.push('Spikeball: Sandstrand als Proxy');
  if (must.has('boat')) gaps.push('Boot mieten nicht belegt');

  let stayName: string | null = null;
  let stayBookUrl: string | null = null;
  let stayPrice: number | null = null;
  let stayLat = place.lat;
  let stayLng = place.lng;
  let stayAmen = '';
  let stayPhoto: string | null = null;
  let mustBoost = 0;
  let amenHitsForWish: import('./stayMustVerify').AmenityVerifyHit[] = [];
  let wishEvidence: import('./wishEvidenceHarvest').WishEvidence[] = [];
  const stayChoices: import('../types').StayChoice[] = [];
  const radiusM = ledger.radiusM?.value ?? null;
  let anchorLat: number | null = null;
  let anchorLng: number | null = null;
  if (ledger.anchorPoi?.value) {
    try {
      const { geocodePlaceName } = await import('../../services/navigation/googleMapsNav');
      const geo = await geocodePlaceName(
        `${ledger.anchorPoi.value} ${place.name}`,
        { cityHint: place.name },
      );
      if (geo) {
        anchorLat = geo.lat;
        anchorLng = geo.lng;
      }
    } catch {
      /* soft */
    }
  }
  const amenityHint =
    amenityHintFromSpecs(stayMustSpecs) ||
    (must.has('pool') || (ledger.wishHaves?.value ?? []).includes('pool')
      ? 'pool'
      : null);
  // Multi-Provider: Stay22 → Hotellook → Grounding (+ Stadt-Aliase Krakau/Krakow)
  // Immer im Enrich — Magazin braucht Stay-Preis direkt, nicht erst QA-Nachziehen.
  // Ausnahme: Unterkunft schon gebucht → nur Flug/Zugang.
  if (overnight && ledger.bookedStay?.value !== true) {
    try {
      const fallbackKind = ledger.lodgingFallback?.value;
      const fb: StayLodgingType | null =
        fallbackKind === 'hotel' || fallbackKind === 'apartment' ? fallbackKind : null;
      const budgetPp = ledger.budgetEur?.value;
      const maxStayTotalEur =
        budgetPp != null && budgetPp > 0
          ? Math.round(budgetPp * adults * 0.72)
          : null;
      const { searchLiveStaysMulti } = await import('./liveStaySearch');
      const found = await searchLiveStaysMulti({
        city: place.name,
        checkin,
        checkout,
        adults,
        preferredLodging: lodging,
        lodgingFallback: fb,
        researchPath,
        amenityHint,
        amenityBlob: [
          ...(ledger.mustHaves?.value ?? []),
          ...(ledger.wishHaves?.value ?? []),
          ledger.lodgingKind?.value,
          ledger.meals?.value,
          ledger.highlightWant?.value,
          ledger.extraWishes?.value,
        ]
          .filter(Boolean)
          .join(' '),
        preferAllInclusive: ledger.meals?.value === 'all',
        maxStayTotalEur,
        lat: anchorLat ?? place.lat,
        lng: anchorLng ?? place.lng,
        pageSize: researchPath === 'stay_first' ? 32 : 24,
        allowGrounded: true,
        originIata: originAirports(ledger)[0] || ledger.airportIata?.value || null,
      });
      const live = { stays: found.stays };
      if (found.source === 'hotellook') {
        gaps.push('Stay-Preise Hotellook/Travelpayouts · Affiliate gesetzt');
      } else if (found.source === 'grounded') {
        gaps.push('Stay-Preise web-belegt (Hotel/Fewo/Villa/Resort) · Affiliate');
      } else if (found.source === 'partner') {
        gaps.push('Stay über CHECK24/Expedia/Stay22-Partner · Preis belegt');
      } else if (found.source === 'none' && found.detail) {
        gaps.push(`Unterkunfts-API leer (${found.detail})`);
      }
      const peers = live.stays
        .map((s) => s.priceTotal)
        .filter((p): p is number => p != null && p > 0);
      const { isDealAnomaly, dealHuntRatio, dealLabel } = await import('./dealAnomaly');
      const { haversineKm: hk } = await import('./comboOptimizer');
      const { isPackagePartnerStay } = await import('./packagePartner');
      let ranked = live.stays.slice();
      const dealRatio = dealHuntRatio(ledger);
      if (amenityMustSpecs.length) {
        ranked = rankStaysByAmenityMusts(ranked, amenityMustSpecs);
      }
      if (must.has('pool') || (ledger.wishHaves?.value ?? []).includes('pool')) {
        const withPool = ranked.filter((s) => /pool|schwimm/i.test(amenityBlob(s)));
        if (withPool.length) ranked = withPool;
      }
      const wantAi = ledger.meals?.value === 'all';
      const wantSpa =
        must.has('spa') ||
        (ledger.wishHaves?.value ?? []).includes('spa') ||
        isSpaLedger(ledger);
      const wantJacuzzi = /whirlpool|jacuzzi|whirl\s*pool/i.test(
        `${ledger.highlightWant?.value || ''} ${ledger.extraWishes?.value || ''} ${ledger.spaStyle?.value || ''}`,
      );
      const preferHostel =
        ledger.lodgingKind?.value === 'hostel' ||
        (isPartyLedger(ledger) &&
          (ledger.budgetVibe?.value === 'cheap' || ledger.lodgingQuality?.value === 'cheap_box'));
      if (wantAi) {
        const withAi = ranked.filter(looksAllInclusive);
        // Soft AI: nicht alles Non-AI töten — nur AI nach vorne
        if (ledger.meals?.hardness === 'must' && withAi.length) ranked = withAi;
        else if (withAi.length) {
          ranked = [...withAi, ...ranked.filter((s) => !looksAllInclusive(s))];
        }
      }
      if (wantSpa) {
        const withSpa = ranked.filter((s) => /spa|wellness|thermal/i.test(amenityBlob(s)));
        if (withSpa.length) {
          ranked = [...withSpa, ...ranked.filter((s) => !/spa|wellness|thermal/i.test(amenityBlob(s)))];
        }
      }
      if (radiusM != null && anchorLat != null && anchorLng != null) {
        const preRadius = ranked;
        ranked = ranked
          .map((s) => {
            const dist =
              s.lat != null && s.lng != null
                ? hk({ lat: anchorLat!, lng: anchorLng! }, { lat: s.lat, lng: s.lng }) * 1000
                : null;
            return { s, dist };
          })
          .filter((x) => x.dist == null || x.dist <= radiusM * 1.25)
          .sort((a, b) => (a.dist ?? 9e9) - (b.dist ?? 9e9))
          .map((x) => x.s);
        // Soft-fail: radius zeroed the pool — keep best stays with honest gap note
        if (ranked.length === 0 && preRadius.length > 0) {
          ranked = preRadius;
          gaps.push('Unterkunft etwas weiter als Radius — trotzdem beste Option');
        }
      }
      // Best-of: AI/Spa-Boost > Foto > Rating > Preis (Budget-Fit)
      const budgetCap = ledger.budgetEur?.value ?? null;
      ranked = ranked.slice().sort((a, b) => {
        if (wantAi) {
          const aiA = looksAllInclusive(a) ? 1 : 0;
          const aiB = looksAllInclusive(b) ? 1 : 0;
          if (aiB !== aiA) return aiB - aiA;
        }
        if (wantSpa) {
          const spaA = /spa|wellness|thermal/i.test(amenityBlob(a)) ? 1 : 0;
          const spaB = /spa|wellness|thermal/i.test(amenityBlob(b)) ? 1 : 0;
          if (spaB !== spaA) return spaB - spaA;
        }
        if (wantJacuzzi) {
          const jA = /whirl|jacuzzi|hot\s*tub/i.test(amenityBlob(a)) ? 1 : 0;
          const jB = /whirl|jacuzzi|hot\s*tub/i.test(amenityBlob(b)) ? 1 : 0;
          if (jB !== jA) return jB - jA;
        }
        if (preferHostel) {
          const hA = /hostel|backpack/i.test(amenityBlob(a)) ? 1 : 0;
          const hB = /hostel|backpack/i.test(amenityBlob(b)) ? 1 : 0;
          if (hB !== hA) return hB - hA;
        }
        const pa = a.photoUrl ? 1 : 0;
        const pb = b.photoUrl ? 1 : 0;
        if (pb !== pa) return pb - pa;
        const ra = a.rating ?? 0;
        const rb = b.rating ?? 0;
        if (rb !== ra) return rb - ra;
        const sa = a.stars ?? 0;
        const sb = b.stars ?? 0;
        if (sb !== sa) return sb - sa;
        const prA = a.priceTotal ?? 9e9;
        const prB = b.priceTotal ?? 9e9;
        if (budgetCap != null) {
          const fitA = Math.abs(prA / Math.max(1, adults) - budgetCap);
          const fitB = Math.abs(prB / Math.max(1, adults) - budgetCap);
          if (fitA !== fitB) return fitA - fitB;
        }
        return prA - prB;
      });
      for (const pick of ranked) {
        if (stayChoices.length >= 4) break;
        const distM =
          pick.lat != null &&
          pick.lng != null &&
          anchorLat != null &&
          anchorLng != null
            ? Math.round(hk({ lat: anchorLat, lng: anchorLng }, { lat: pick.lat, lng: pick.lng }) * 1000)
            : null;
        const aiTag = looksAllInclusive(pick) ? ' · AI' : '';
        const hardDeal = isDealAnomaly(pick.priceTotal, peers, 0.55);
        const softDeal = isDealAnomaly(pick.priceTotal, peers, dealRatio);
        const dealHit = hardDeal || softDeal;
        if (
          isPackagePartnerStay({
            id: pick.id,
            name: pick.name,
            bookUrl: pick.bookUrl,
          })
        ) {
          continue; // Pauschal-Partner nie als Fake-Stay
        }
        stayChoices.push({
          id: `stay-${pick.id}`,
          name: pick.name,
          priceEur: pick.priceTotal,
          bookUrl: (() => {
            try {
              const { finalizeHotelBookAffiliateUrl } = require('../../services/affiliate/hotelPropertyDeepLink') as {
                finalizeHotelBookAffiliateUrl: (o: {
                  hotelName: string;
                  city?: string | null;
                  bookUrl?: string | null;
                  checkin: string;
                  checkout: string;
                  adults?: number;
                  expediaPropertyId?: string | null;
                  priceEur?: number | null;
                }) => string;
              };
              return finalizeHotelBookAffiliateUrl({
                hotelName: pick.name,
                city: place.name,
                bookUrl: pick.bookUrl,
                checkin,
                checkout,
                adults,
                expediaPropertyId: pick.expediaPropertyId,
                priceEur: pick.priceTotal,
              });
            } catch {
              return pick.bookUrl;
            }
          })(),
          expediaPropertyId: pick.expediaPropertyId ?? null,
          photoUrl: pick.photoUrl ?? null,
          why:
            distM != null && ledger.anchorPoi?.value
              ? `${distM} m zu ${ledger.anchorPoi.value}${aiTag}`
              : pick.rating != null
                ? `Rating ${pick.rating}${aiTag}`
                : `Live Stay22${aiTag}`,
          lat: pick.lat,
          lng: pick.lng,
          distToAnchorM: distM,
          dealHit,
          checkInFrom: '15:00',
          checkOutUntil: '11:00',
        });
        if (dealHit && stayChoices.length <= 2) {
          const label = dealLabel(true, !hardDeal);
          if (label) gaps.push(label);
        }
      }
      const pick = stayChoices[0];
      if (pick) {
        stayName = pick.name;
        stayBookUrl = pick.bookUrl;
        stayPrice = pick.priceEur;
        stayLat = pick.lat ?? place.lat;
        stayLng = pick.lng ?? place.lng;
        stayPhoto = pick.photoUrl;
        const raw = ranked[0];
        stayAmen = amenityBlob({ name: stayName || raw?.name, amenities: raw?.amenities ?? null });
        const amenHits = amenityHitsForStay(
          stayName || '',
          raw?.amenities ?? null,
          amenityMustSpecs,
        );
        amenHitsForWish = amenHits;
        gaps.push(...gapsFromAmenityHits(amenHits));
        mustBoost += hardMustScoreBoost(amenHits);
        if (must.has('pool') && !/pool|schwimm/i.test(stayAmen) && !amenHits.some((h) => h.id === 'pool')) {
          gaps.push('Pool nicht in Stay22-Amenities belegt');
        }
        if (radiusM != null && pick.distToAnchorM != null && pick.distToAnchorM > radiusM) {
          gaps.push(`Lage ${pick.distToAnchorM} m > Wunsch ${radiusM} m`);
        }
        // Hard proximity (Supermarkt ≤500m …) nur für Top-Stay
        if (proximityMustSpecs.length && stayLat != null && stayLng != null) {
          try {
            const proxHits = await verifyProximityMusts({
              lat: stayLat,
              lng: stayLng,
              specs: proximityMustSpecs,
            });
            gaps.push(...gapsFromProximityHits(proxHits));
            for (const h of proxHits) {
              if (h.hardness !== 'hard') continue;
              if (h.status === 'perfect') mustBoost += 3;
              else if (h.status === 'near') mustBoost += 0;
              else if (h.status === 'fail') mustBoost -= 7;
            }
            const perfectProx = proxHits.filter((h) => h.status === 'perfect');
            for (const h of perfectProx.slice(0, 2)) {
              if (h.detail) {
                stayChoices[0] = {
                  ...pick,
                  why: `${pick.why || 'Live'} · ${h.detail}`.slice(0, 80),
                };
              }
            }
          } catch {
            /* soft */
          }
        }
      } else {
        gaps.push('Noch keine Unterkunft mit Preis gefunden');
      }
    } catch {
      gaps.push('Unterkunft-Suche gerade nicht gelaufen');
    }
  }

  let flightUrl: string | null = null;
  let flightPrice: number | null = null;
  const froms = originAirports(ledger);
  let originUsed: string | null = froms[0] ?? ledger.airportIata?.value ?? null;
  if ((ledger.mode?.value === 'fly' || !ledger.mode?.value || ledger.mode?.value === 'mix') && place.iata && froms.length) {
    originUsed = froms[0]!;
    try {
      flightUrl = buildKiwiSearchPageUrl({
        fromIata: originUsed,
        toIata: place.iata,
        dateKey: checkin,
        returnDateKey: checkout !== checkin ? checkout : null,
        adults,
        infants: Math.max(0, ledger.infants?.value ?? 0),
        children: Math.max(
          0,
          (ledger.children?.value ?? 0) - Math.max(0, ledger.infants?.value ?? 0),
        ),
        cabinBags: ledger.cabinBags?.value ?? null,
        checkedBags: ledger.checkedBags?.value ?? null,
        directOnly: ledger.directFlight?.value === true,
      });
    } catch {
      flightUrl = null;
    }
  } else if (ledger.mode?.value === 'fly' && place.iata && ledger.airportIata?.value) {
    originUsed = ledger.airportIata.value;
    try {
      flightUrl = buildKiwiSearchPageUrl({
        fromIata: ledger.airportIata.value,
        toIata: place.iata,
        dateKey: checkin,
        returnDateKey: checkout !== checkin ? checkout : null,
        adults,
        infants: Math.max(0, ledger.infants?.value ?? 0),
        children: Math.max(
          0,
          (ledger.children?.value ?? 0) - Math.max(0, ledger.infants?.value ?? 0),
        ),
        cabinBags: ledger.cabinBags?.value ?? null,
        checkedBags: ledger.checkedBags?.value ?? null,
        directOnly: ledger.directFlight?.value === true,
      });
    } catch {
      flightUrl = null;
    }
  }

  const photo = await fetchWikiThumb(
    place.wiki || place.name,
    wikiTitleCandidates(place.name, [place.iata ? `${place.name} Airport` : ''].filter(Boolean)),
  );
  let driveEur = overnight ? 0 : Math.round(hours * 18);
  const total =
    stayPrice != null
      ? stayPrice + driveEur
      : ledger.mode?.value === 'fly'
        ? null
        : driveEur || null;
  const budget = hasUserBudget(ledger) ? ledger.budgetEur?.value ?? null : null;
  const budgetDelta = budget != null && total != null ? total - budget : null;
  const facts = buildFacts({ place, ledger, gaps, stayAmenities: stayAmen, stayName: stayName || '' });
  const softFacts = buildSoftFacts({
    place,
    ledger,
    gaps,
    stayAmenities: stayAmen,
    stayName: stayName || '',
  });
  const met = facts.filter((f) => f.met).length;
  const softMet = softFacts.filter((f) => f.met).length;
  const nogoHits = (ledger.hardNos?.value ?? []).filter((id) =>
    place.tags.includes(id === 'party' ? 'party' : id),
  ).length;
  const title = tripNickname(place, stayName, ledger, overnight);
  const blurb = proWhy?.trim() || whyBlurb(facts, place, hours);
  const why: string[] = [blurb];
  if (why.length < 2) why.push(`Start ${origin.city}`);

  const rest = restBudget(budget, total, ledger);
  const pp = perPersonPrice(total, adults);
  const score = matchScore({
    hardWanted: facts.length,
    hardMet: met,
    softWanted: softFacts.length,
    softMet,
    nogoHits,
    budgetDeltaEur: budgetDelta,
    boost: mustBoost,
    incompletePackage:
      overnight &&
      ledger.bookedStay?.value !== true &&
      !(stayPrice != null && stayPrice > 0),
  });
  const line = fitLine({
    hardWanted: facts.length,
    hardMet: met,
    softBits: softFacts.filter((f) => f.met).map((f) => f.label),
    gaps,
  });

  const decisionNotes: string[] = [];
  if (ledger.cheapDrinks?.value) {
    decisionNotes.push(
      softFacts.find((f) => f.id === 'cheap_drinks')?.met
        ? 'Bier-Preis-Niveau eher günstig eingeschätzt'
        : 'Bier-Preise vor Ort noch live prüfen',
    );
  }
  if (/geheim|exklusiv|exclusive|hidden/i.test(proWhy || '')) {
    decisionNotes.push('Gem-Hunt: Geheimtipp / besondere Idee');
  }
  if (place.tags.some((t) => /geheim|exclusive|deal|bargain/i.test(t))) {
    decisionNotes.push(
      place.tags.some((t) => /deal|bargain/i.test(t))
        ? 'Schnäppchen-Korridor im Shortlist'
        : 'Geheimtipp / Exklusiv im Shortlist',
    );
  }
  if (ledger.meals?.value === 'all') {
    const aiMet = softFacts.find((f) => f.id === 'meals_ai')?.met === true;
    const blob = `${stayAmen} ${stayName || ''}`.toLowerCase();
    if (aiMet) {
      decisionNotes.push('All Inclusive als Option gefunden');
      if (looksAlcoholIncluded(blob)) {
        decisionNotes.push('Alkohol/Drinks inklusive — belegt in Amenities');
      } else if (isPartyLedger(ledger)) {
        decisionNotes.push('AI: Alkohol inklusive? — Paket noch prüfen');
        gaps.push('All Inclusive: Alkohol/Open-Bar nicht in Amenities belegt');
      } else {
        decisionNotes.push('AI-Inklusivleistungen vor Buchung prüfen');
      }
    } else if (ledger.meals.hardness === 'must') {
      decisionNotes.push('All Inclusive gewünscht — hier noch kein klarer AI-Treffer');
      gaps.push('All Inclusive nicht belegt');
    } else {
      decisionNotes.push('All Inclusive soft geprüft — hier eher ohne AI (Budget/Fit)');
    }
  }
  if (isSpaLedger(ledger)) {
    const spaMet =
      softFacts.find((f) => f.id === 'spa')?.met === true ||
      /spa|wellness|thermal/i.test(stayAmen);
    decisionNotes.push(
      spaMet ? 'Spa/Wellness-Signal in der Unterkunft' : 'Spa: Beleg in Amenities noch dünn',
    );
  }
  if (ledger.directFlight?.value) {
    decisionNotes.push('Direktflug gewünscht — Link prüfen');
  }
  if (froms.length > 1) {
    decisionNotes.push(`Starts geprüft: ${froms.join(', ')}`);
  }

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

  const wantCar =
    ledger.bookedCar?.value !== true &&
    ledger.rentalCar?.value !== false &&
    (ledger.needCar?.value === true ||
      ledger.rentalCar?.value === true ||
      ledger.mode?.value === 'drive' ||
      ledger.mode?.value === 'daytrip' ||
      ledger.localMovePref?.value === 'rental' ||
      ledger.transferPref?.value === 'rental');

  const carUrl = wantCar
    ? getCarRentalUrl({
        pickupLocation: overnight ? place.name : origin.city,
        pickupDate: checkin,
        dropoffDate: checkout,
      })
    : null;

  const { estimateTaxiEur, haversineKm: hk2 } = await import('./comboOptimizer');
  const { estimateTransferMinutes } = await import('./storyMagazine');
  // Transfer = Flughafen/Ort → Unterkunft (nicht Heimat → Ziel!)
  const transferKm = overnight
    ? hk2({ lat: place.lat, lng: place.lng }, { lat: stayLat, lng: stayLng })
    : 0;
  const distFromHomeKm = hk2(
    { lat: origin.lat, lng: origin.lng },
    { lat: place.lat, lng: place.lng },
  );
  // Flug-Pflicht: fly-Tag (Inseln) oder einfach zu weit für Bahn-Wochenende
  const flyLikely = place.tags.includes('fly') || distFromHomeKm > 700;
  const transferOneWay =
    !overnight || ledger.localMovePref?.value === 'walk'
      ? 0
      : ledger.localMovePref?.value === 'oepnv' || ledger.transferPref?.value === 'public'
        ? Math.max(6, Math.round(Math.min(transferKm, 25) * 0.45))
        : estimateTaxiEur(Math.min(Math.max(transferKm, flyLikely ? 8 : 3), 35));
  // Hin + Rück Flughafen/Bahnhof ↔ Stay — Fixpreis soll beide Wege tragen
  const transferEur =
    transferOneWay > 0 && (flyLikely || ledger.mode?.value === 'fly' || Boolean(place.iata))
      ? transferOneWay * 2
      : transferOneWay;
  const transferMinutes =
    overnight && transferOneWay > 0
      ? estimateTransferMinutes(Math.min(Math.max(transferKm, flyLikely ? 8 : 3), 45))
      : overnight
        ? estimateTransferMinutes(Math.min(Math.max(transferKm, 3), 45))
        : null;

  const transferUrl = overnight
    ? `https://www.google.com/maps/dir/?api=1&destination=${stayLat},${stayLng}&travelmode=${
        ledger.localMovePref?.value === 'oepnv' || ledger.transferPref?.value === 'public'
          ? 'transit'
          : 'driving'
      }`
    : null;

  let transports: import('../types').TransportChoice[] = [];
  try {
    const {
      buildFlightTransportChoices,
      buildTrainTransportChoices,
      buildMultimodalTransportChoices,
    } = await import('./transportMatrix');
    const mode = ledger.mode?.value;
    // Insel / >700 km / fly-Tag: immer Flug — nie Bahn nach Malta & Co.
    const wantFlight =
      Boolean(place.iata) && (flyLikely || mode === 'fly' || mode === 'mix' || !mode);
    const wantTrain =
      !flyLikely &&
      !place.tags.includes('fly') &&
      (mode === 'train' || (mode === 'mix' && !place.iata));
    const preferEco =
      researchPath === 'route_tour' ||
      mode === 'train' ||
      mode === 'bike' ||
      mode === 'hike' ||
      /öko|oeko|bahn|kein\s+flug/.test(
        `${ledger.highlightWant?.value || ''} ${ledger.mode?.value || ''}`,
      );
    const useMultimodal =
      preferEco ||
      mode === 'mix' ||
      mode === 'camping' ||
      researchPath === 'route_tour' ||
      (wantFlight && wantTrain);

    if (useMultimodal) {
      transports = await buildMultimodalTransportChoices({
        ledger,
        originCity: origin.city,
        destCity: place.name,
        checkin,
        checkout,
        placeIata: place.iata ?? null,
        fromIata: originUsed || froms[0] || ledger.airportIata?.value || null,
        preferEco,
        allowCamper: mode === 'camping' || researchPath === 'route_tour',
        flyLikely,
      });
      const fly = transports.find((t) => t.kind === 'flight');
      if (fly?.priceEur != null) flightPrice = fly.priceEur;
      if (fly?.bookUrl) flightUrl = fly.bookUrl;
      // Bus/Camper Live-Preise für Buy-in (Flug fehlt oder Eco-Pfad)
      const busLive = transports.find((t) => t.kind === 'bus' && t.priceEur != null);
      if (flightPrice == null && busLive?.priceEur != null) {
        flightPrice = busLive.priceEur;
      }
      const trainLive = transports.find((t) => t.kind === 'train' && t.priceEur != null);
      if (flightPrice == null && trainLive?.priceEur != null) {
        flightPrice = trainLive.priceEur;
      }
      const camperLive = transports.find(
        (t) => t.kind === 'car' && t.priceEur != null && /camper/i.test(t.id),
      );
      if (camperLive?.priceEur != null) {
        driveEur = camperLive.priceEur;
      }
    } else if (wantFlight && place.iata) {
      const { findBestCalendarSlots } = await import('./travelpayoutsCalendar');
      const slots = await findBestCalendarSlots({
        ledger: {
          ...ledger,
          dateStart: { value: checkin, source: 'inferred', hardness: 'inferred' },
        },
        fromIatas: froms.length ? froms : originUsed ? [originUsed] : ['HAM'],
        toIata: place.iata,
        maxSlots: 1,
      });
      const slot = slots[0] ?? {
        id: 'one',
        checkin,
        checkout,
        fromIata: originUsed || 'HAM',
        toIata: place.iata,
        priceEur: flightPrice,
        label: `${originUsed}→${place.iata}`,
        source: 'synthetic' as const,
      };
      transports = await buildFlightTransportChoices({ ledger, slot, placeIata: place.iata });
      if (transports[0]?.priceEur != null) flightPrice = transports[0].priceEur;
      if (transports[0]?.bookUrl) flightUrl = transports[0].bookUrl;
    } else if (wantTrain) {
      transports = await buildTrainTransportChoices({
        ledger,
        originCity: origin.city,
        destCity: place.name,
        checkin,
        checkout,
      });
      const trainLive = transports.find((t) => t.kind === 'train' && t.priceEur != null);
      if (trainLive?.priceEur != null) flightPrice = trainLive.priceEur;
      if (trainLive?.bookUrl) flightUrl = trainLive.bookUrl;
    }
  } catch {
    /* soft */
  }

  let hubPreNightStay: import('../types').StayChoice | null = null;
  try {
    const { tagHubPreNightOnTransports, lookupHubPreNightStay } = await import('./hubPreNight');
    transports = tagHubPreNightOnTransports(transports, ledger);
    const hubTr = transports.find((t) => t.hubPreNight);
    if (hubTr) {
      hubPreNightStay = await lookupHubPreNightStay({
        fromIata: hubTr.fromIata,
        originCity: origin.city,
        departDateKey: hubTr.departDateKey || checkin,
        departAt: hubTr.departAt,
        adults,
      });
      if (hubPreNightStay) {
        decisionNotes.push('Vornacht am Hub vor frühem Start');
      }
    }
  } catch {
    /* soft */
  }

  let bookendStartStay: import('../types').StayChoice | null = null;
  try {
    const {
      needsBookendHotels,
      lookupBookendStartStay,
      reuseHubAsBookendStart,
      sameStayRef,
    } = await import('./bookendHotels');
    if (needsBookendHotels(ledger)) {
      const reused = reuseHubAsBookendStart(hubPreNightStay);
      bookendStartStay = await lookupBookendStartStay({
        ledger,
        originCity: origin.city,
        destCity: place.name,
        dateStart: checkin,
        adults,
        existing: reused,
      });
      if (bookendStartStay && sameStayRef(bookendStartStay, hubPreNightStay)) {
        /* Hub-Nacht ist das Start-Hotel */
      } else if (bookendStartStay) {
        decisionNotes.push('Hotel vor der Tour / vor dem Zug (zweites Live-Hotel)');
      }
    }
  } catch {
    /* soft */
  }

  /** Grobe Land-Slug-Schaetzung fuer Airalo — nur Hint, nie Fake-Preis. */
function guessEsimCountrySlug(placeName?: string | null, hint?: string | null): string | null {
  const blob = `${placeName || ''} ${hint || ''}`.toLowerCase();
  if (/hellfest|frankreich|france|paris|lyon|nantes|cannes|nice|marseille/.test(blob)) return 'france';
  if (/griech|greece|athen|kreta|korfu|rhodos|santorini|naxos/.test(blob)) return 'greece';
  if (/spanien|spain|mallorca|ibiza|barcelona|madrid|valencia|malaga/.test(blob)) return 'spain';
  if (/italien|italy|rom|milan|florenz|venedig|sizilien/.test(blob)) return 'italy';
  if (/tuerkei|türkei|turkey|antalya|istanbul|bodrum/.test(blob)) return 'turkey';
  if (/portugal|lissabon|porto|algarve/.test(blob)) return 'portugal';
  if (/niederlande|holland|amsterdam/.test(blob)) return 'netherlands';
  if (/oesterreich|österreich|austria|wien|salzburg/.test(blob)) return 'austria';
  if (/kroatien|croatia|split|dubrovnik/.test(blob)) return 'croatia';
  if (/deutschland|germany|berlin|hamburg|muenchen|münchen/.test(blob)) return 'germany';
  return null;
}


const {
    buyInFromParts,
    buildDayPlans,
    buildBookingChecklist,
    enrichOptionMagazine,
    isCrediblePackageBuyIn,
    budgetDeltaVsBuyIn,
    estimateRentalCarGroupEur,
  } = await import('./composePlan');
  const camperPriced = transports.some(
    (t) => t.kind === 'car' && t.priceEur != null && /camper/i.test(t.id),
  );
  // Fly + Mietwagen: Gruppenpreis schätzen/live, sonst fehlt der Share im Fixpreis
  const nightsForCar = Math.max(
    1,
    ledger.stayNights?.value ??
      (Math.round(
        (Date.parse(`${checkout}T12:00:00`) - Date.parse(`${checkin}T12:00:00`)) / 86_400_000,
      ) || 2),
  );
  if (
    overnight &&
    (ledger.rentalCar?.value === true || ledger.needCar?.value === true) &&
    !(driveEur > 0) &&
    !camperPriced
  ) {
    driveEur = estimateRentalCarGroupEur(nightsForCar);
  }
  const carEur =
    camperPriced ||
    ledger.mode?.value === 'drive' ||
    ledger.mode?.value === 'camping' ||
    ledger.rentalCar?.value ||
    ledger.needCar?.value === true
      ? driveEur > 0
        ? driveEur
        : null
      : null;

  const { filterRealStays } = await import('./packagePartner');
  const { REAL_STAY_CHOICE_MAX } = await import('./composePlan');
  let realStayChoices = filterRealStays(stayChoices).slice(0, REAL_STAY_CHOICE_MAX);
  const primaryStay = realStayChoices[0];
  if (primaryStay && (!stayName || /check24|ab-in-den|pauschal/i.test(stayName))) {
    stayName = primaryStay.name;
    stayBookUrl = primaryStay.bookUrl;
    stayPrice = primaryStay.priceEur;
    stayPhoto = primaryStay.photoUrl;
    stayLat = primaryStay.lat ?? place.lat;
    stayLng = primaryStay.lng ?? place.lng;
  }

  // Camping-Modus: Platz-Buchung immer camping.info + Camping-and-Co vergleichen
  const campingStayMode =
    ledger.mode?.value === 'camping' || must.has('camping');
  if (campingStayMode) {
    try {
      const {
        buildCampingPartnerCandidates,
        pickCampingBookingOffer,
      } = await import('../../services/affiliate/campingPartnerPick');
      const userBlob = [
        ledger.highlightWant?.value,
        ...(ledger.mustHaves?.value ?? []),
        ...(ledger.wishHaves?.value ?? []),
        place.name,
      ]
        .filter(Boolean)
        .join(' ');
      const campOpts = {
        city: place.name,
        arrival: checkin,
        departure: checkout,
        adults,
        userText: userBlob,
      };
      const cands = buildCampingPartnerCandidates(campOpts);
      const campPick = pickCampingBookingOffer(campOpts);
      const campStays: import('../types').StayChoice[] = cands.map((c) => ({
        id: `camp-${c.id}`,
        name:
          c.id === 'camping_and_co'
            ? `Campingplatz · Camping-and-Co (${place.name})`
            : `Campingplatz · camping.info (${place.name})`,
        priceEur: c.partnerPriceEur,
        bookUrl: c.url,
        photoUrl: null,
        why: 'Camping-Partner vergleichen',
        lat: place.lat,
        lng: place.lng,
      }));
      realStayChoices = [
        ...campStays,
        ...realStayChoices.filter((s) => !/^camp-/.test(s.id)),
      ].slice(0, Math.max(REAL_STAY_CHOICE_MAX, campStays.length));
      if (campPick?.url) {
        stayBookUrl = campPick.url;
        stayName = `Camping · ${place.name}`;
        stayPrice = campPick.partnerPriceEur;
      }
    } catch {
      /* soft */
    }
  }


  // Airbnb — explizit (lodgingKind/Must/\bairbnb\b) ODER Soft-Probe bei Apartment + dünnem Stay-Inventar
  const children = Math.max(0, ledger.children?.value ?? 0);
  const userBlobAirbnb = [
    ledger.highlightWant?.value,
    ...(ledger.mustHaves?.value ?? []),
    ...(ledger.wishHaves?.value ?? []),
    ledger.lodgingKind?.value,
  ]
    .filter(Boolean)
    .join(' ');
  const airbnbStayMode =
    ledger.lodgingKind?.value === 'airbnb' ||
    must.has('airbnb') ||
    /\bairbnb\b/iu.test(userBlobAirbnb);
  const apartmentStayMode =
    ledger.lodgingKind?.value === 'apartment' ||
    ledger.lodgingKind?.value === 'ferienhaus' ||
    must.has('apartment') ||
    must.has('ferienhaus') ||
    /\b(ferienwohnung|wohnung|apartment|appartement|fewo|ferienhaus)\b/iu.test(
      userBlobAirbnb,
    );
  const airbnbEnrich =
    airbnbStayMode || (apartmentStayMode && realStayChoices.length < 2);
  const airbnbDatesLabel =
    checkin && checkout ? `${checkin}–${checkout}` : null;
  const airbnbChecklistLabel = (opts?: {
    name?: string | null;
    priceEur?: number | null;
  }) => {
    const listingName = String(opts?.name || '').trim() || place.name;
    const parts = [`Airbnb · ${listingName}`];
    if (
      opts?.priceEur != null &&
      Number.isFinite(opts.priceEur) &&
      opts.priceEur > 0
    ) {
      parts.push(`${Math.round(opts.priceEur)}€`);
    }
    if (airbnbDatesLabel) parts.push(airbnbDatesLabel);
    else {
      parts.push(`${adults} Erw.`);
      if (children > 0) {
        parts.push(children === 1 ? '1 Kind' : `${children} Kinder`);
      }
    }
    return parts.join(' · ');
  };
  if (airbnbEnrich && !campingStayMode) {
    try {
      const {
        pickAirbnbStayActions,
        buildAirbnbStayCandidates,
      } = await import('../../services/affiliate/airbnbStayPick');
      const {
        getAirbnbSearchUrl,
        withAirbnbStayPrefill,
        extractAirbnbRoomId,
        normalizeAirbnbListingUrl,
      } = await import('../../services/affiliate/airbnbDeepLink');
      const airbnbPrefill = {
        city: place.name,
        checkin,
        checkout,
        adults,
        children,
      };
      const airbnbSearchUrl = getAirbnbSearchUrl(airbnbPrefill);

      // 1) Grounded /rooms/ + Live-Preis (nie erfinden)
      let groundedRooms: import('../types').StayChoice[] = [];
      if (checkin && checkout) {
        try {
          const { searchGroundedAirbnbListings } = await import(
            './groundedAirbnbListings'
          );
          const g = await searchGroundedAirbnbListings({
            city: place.name,
            checkin,
            checkout,
            adults,
            children,
            max: 3,
          });
          groundedRooms = (g.stays || [])
            .filter(
              (s) =>
                s.priceTotal != null &&
                s.priceTotal > 0 &&
                Boolean(extractAirbnbRoomId(s.bookUrl)),
            )
            .slice(0, 3)
            .map((s) => {
              const short = s.name.split(/[|,]/)[0]!.trim();
              return {
                id: s.id.startsWith('airbnb-') ? s.id : `airbnb-${s.id}`,
                name: airbnbChecklistLabel({
                  name: short,
                  priceEur: s.priceTotal,
                }),
                priceEur: s.priceTotal,
                bookUrl: normalizeAirbnbListingUrl(s.bookUrl, airbnbPrefill),
                photoUrl: s.photoUrl ?? null,
                why: 'Airbnb Rooms · Live-Preis (Grounding)',
                lat: place.lat,
                lng: place.lng,
              };
            });
        } catch {
          /* soft */
        }
      }

      const liveStays = [
        ...groundedRooms.map((s) => ({
          name: s.name,
          priceEur: s.priceEur,
          bookUrl: s.bookUrl,
        })),
        ...realStayChoices
          .filter((s) => s.bookUrl)
          .map((s) => ({
            name: s.name,
            priceEur: s.priceEur,
            bookUrl: s.bookUrl,
          })),
      ];
      const pickOpts = {
        city: place.name,
        checkin,
        checkout,
        adults,
        children,
        // Soft enrich: kein Brand-Force in Pick (Search-Primary nur bei airbnbStayMode)
        userText: airbnbStayMode
          ? `airbnb ${userBlobAirbnb}`
          : userBlobAirbnb || 'apartment',
        liveStays,
      };
      const airbnbActs = pickAirbnbStayActions(pickOpts);
      const cands = buildAirbnbStayCandidates(pickOpts);

      const abnbStays: import('../types').StayChoice[] =
        groundedRooms.length > 0
          ? [
              ...groundedRooms,
              ...cands
                .filter(
                  (c) =>
                    !(c.id === 'airbnb' && c.deepLinkLevel === 'search') &&
                    !extractAirbnbRoomId(c.url || ''),
                )
                .slice(0, 2)
                .map((c, i) => ({
                  id: `airbnb-alt-${i}`,
                  name: c.label,
                  priceEur: c.partnerPriceEur,
                  bookUrl: withAirbnbStayPrefill(c.url || airbnbSearchUrl, airbnbPrefill),
                  photoUrl: null,
                  why: 'Live-Partner-Vergleich (same-house günstiger)',
                  lat: place.lat,
                  lng: place.lng,
                })),
            ]
          : airbnbStayMode
            ? [
                {
                  id: 'airbnb-search',
                  name: airbnbChecklistLabel(),
                  priceEur: null,
                  bookUrl: airbnbSearchUrl,
                  photoUrl: null,
                  why: 'Airbnb-Suche (keine Fake-Preise)',
                  lat: place.lat,
                  lng: place.lng,
                },
                ...cands
                  .filter((c) => !(c.id === 'airbnb' && c.deepLinkLevel === 'search'))
                  .slice(0, 2)
                  .map((c, i) => ({
                    id: `airbnb-alt-${i}`,
                    name: c.label,
                    priceEur: c.partnerPriceEur,
                    bookUrl: withAirbnbStayPrefill(c.url || airbnbSearchUrl, airbnbPrefill),
                    photoUrl: null,
                    why: 'Live-Partner-Vergleich',
                    lat: place.lat,
                    lng: place.lng,
                  })),
              ]
            : []; // Soft probe ohne Grounding → kein hohler Airbnb-Search-Stay
      if (abnbStays.length > 0) {
        realStayChoices = [
          ...abnbStays,
          ...realStayChoices.filter((s) => !/^airbnb-/.test(s.id)),
        ].slice(0, Math.max(REAL_STAY_CHOICE_MAX, abnbStays.length));

        // Best pick: günstigstes same-house Partner-URL gewinnt; sonst günstigstes Rooms
        const primaryUrl = airbnbActs[0]?.payload.url;
        if (primaryUrl) {
          stayBookUrl = withAirbnbStayPrefill(primaryUrl, airbnbPrefill);
          const roomsHit = groundedRooms.find(
            (s) =>
              extractAirbnbRoomId(s.bookUrl || '') ===
              extractAirbnbRoomId(primaryUrl),
          );
          if (roomsHit) {
            stayName = roomsHit.name;
            stayPrice = roomsHit.priceEur;
          } else if (/airbnb\./i.test(primaryUrl) && extractAirbnbRoomId(primaryUrl)) {
            const byUrl = groundedRooms.find((s) => s.bookUrl === stayBookUrl);
            stayName = byUrl?.name || airbnbChecklistLabel();
            stayPrice = byUrl?.priceEur ?? null;
          } else if (/airbnb\./i.test(primaryUrl)) {
            // Soft: ignore hollow search primary
            if (airbnbStayMode) {
              stayName = airbnbChecklistLabel();
              stayPrice = null;
            } else if (groundedRooms[0]?.bookUrl) {
              stayBookUrl = groundedRooms[0].bookUrl;
              stayName = groundedRooms[0].name;
              stayPrice = groundedRooms[0].priceEur;
            }
          } else if (primaryStay?.bookUrl === primaryUrl) {
            stayName = primaryStay.name;
            stayPrice = primaryStay.priceEur;
          } else {
            const hit = liveStays.find((s) => s.bookUrl === primaryUrl);
            stayName = hit?.name || stayName;
            stayPrice = hit?.priceEur ?? stayPrice;
          }
        } else if (groundedRooms[0]?.bookUrl) {
          stayBookUrl = groundedRooms[0].bookUrl;
          stayName = groundedRooms[0].name;
          stayPrice = groundedRooms[0].priceEur;
        }
      }
    } catch {
      /* soft */
    }
  }

  const surfaceTravel =
    carEur != null ||
    transports.some((t) => (t.kind === 'train' || t.kind === 'bus' || t.kind === 'car') && (t.priceEur ?? 0) > 0);
  const credible = isCrediblePackageBuyIn({
    overnight,
    stayEur: stayPrice,
    flightPerPersonEur: flightPrice,
    hasSurfaceTravel: surfaceTravel,
  });
  const hubNightEur =
    hubPreNightStay?.priceEur != null && hubPreNightStay.priceEur > 0
      ? hubPreNightStay.priceEur
      : 0;
  const bookendEur =
    bookendStartStay?.priceEur != null && bookendStartStay.priceEur > 0
      ? bookendStartStay.priceEur
      : 0;
  const sameHubBookend =
    Boolean(hubPreNightStay && bookendStartStay && hubPreNightStay.id === bookendStartStay.id);
  const extrasSum = (sameHubBookend ? Math.max(hubNightEur, bookendEur) : hubNightEur + bookendEur) || null;
  const buyRaw = buyInFromParts({
    flightPerPersonEur: flightPrice,
    stayEur: stayPrice,
    transferEur: overnight ? transferEur : null,
    carEur,
    extrasEur: extrasSum,
    adults,
  });
  // Unvollständiges Overnight-Paket (nur Flug o.ä.) nie als „Paket gesamt“ verkaufen
  const buy = credible
    ? buyRaw
    : {
        buyInEur: null as number | null,
        buyInLabel: buyRaw.buyInLabel,
        totalPackage: null as number | null,
      };
  if (overnight && !credible && stayPrice == null) {
    gaps.push('Unterkunftspreis fehlt — Buy-in noch nicht final');
  }
  const { userWantsProgramDays } = await import('./storyMagazine');
  const { wishChapterBookUrl } = await import('./wishBookLink');
  const { extraNearbyFromLedger } = await import('./wishEvidenceHarvest');
  const stubOpt = {
    placeName: place.name,
    comboWindows: [{ checkin, checkout }],
    transports: [] as import('../types').TransportChoice[],
  } as import('../types').ReiseOption;
  const activityUrls: Array<{ label: string; url: string }> = [];
  const activityBookByTitle: Record<string, string> = {};
  for (const act of (ledger.mustActivities?.value ?? []).slice(0, 6)) {
    const label = String(act || '').trim();
    if (!label || /^e-?sim$/i.test(label)) continue;
    const kind = /museum/i.test(label)
      ? 'museum'
      : /konzert|festival|hellfest/i.test(label)
        ? 'concert'
        : /club/i.test(label)
          ? 'club'
          : /stadion|arena/i.test(label)
            ? 'stadium'
            : /tour|boots|ausflug/i.test(label)
              ? 'tour'
              : 'activity';
    const url = wishChapterBookUrl(kind, { mustHaveId: kind, name: label, met: false, onProperty: false }, stubOpt, ledger);
    if (url) {
      activityUrls.push({ label, url });
      activityBookByTitle[label] = url;
    }
  }
  for (const extra of extraNearbyFromLedger(ledger)) {
    if (activityUrls.some((a) => a.label === extra.title)) continue;
    const url = wishChapterBookUrl(extra.id, undefined, stubOpt, ledger);
    if (url) {
      activityUrls.push({ label: extra.title, url });
      activityBookByTitle[extra.title] = url;
    }
  }
  let esimUrl: string | null = null;
  if (ledger.needEsim?.value || (ledger.mustActivities?.value ?? []).some((a) => /e-?sim/i.test(a))) {
    try {
      const { getAiraloAffiliateUrl } = await import('../../services/affiliate/affiliateService');
      const slugGuess = guessEsimCountrySlug(place.name, ledger.corridor?.value || ledger.destinationHint?.value);
      esimUrl = getAiraloAffiliateUrl(slugGuess || undefined);
      if (esimUrl) activityUrls.push({ label: 'eSIM Airalo', url: esimUrl });
    } catch {
      /* soft */
    }
  }
  const days = userWantsProgramDays(ledger)
    ? buildDayPlans({
        checkin,
        checkout,
        placeName: place.name,
        transport: transports[0] ?? null,
        stay: stayChoices[0] ?? null,
        transferEur: overnight ? transferEur : null,
        activities: (ledger.mustActivities?.value ?? []).filter((a) => !/^e-?sim$/i.test(a)),
        activityBookByTitle,
        ledger,
        wishHints: activityUrls.map((a) => a.label).slice(0, 8),
      })
    : [];
  // eSIM als eigener Block am Anreisetag
  if (esimUrl && days[0]) {
    days[0] = {
      ...days[0],
      blocks: [
        ...days[0].blocks,
        {
          id: `${days[0].dayKey}-esim`,
          title: 'eSIM',
          detail: 'Daten am Ziel — Partner-Link aus dem Brief',
          bookUrl: esimUrl,
        },
      ],
    };
  }
  let packageBookUrl: string | null = null;
  let packageCompareUrls: Array<{ label: string; url: string }> = [];
  try {
    const { preferAffiliateIfSameOffer } = await import(
      '../../services/affiliate/preferAffiliateIfSameOffer'
    );
    const { buildPackageCompareLinks } = await import('./packageCompareLinks');
    const fromIata = originUsed || froms[0] || ledger.airportIata?.value || null;
    const compare = buildPackageCompareLinks({
      ledger,
      placeName: place.name,
      checkin,
      checkout,
      fromIata,
      adults,
    });
    packageCompareUrls = compare.map((p) => ({ label: p.label, url: p.url }));
    packageBookUrl = compare.find((p) => p.id === 'pkg-check24')?.url ?? compare[0]?.url ?? null;
    // Direkt-Stay-URL schlägt Affiliate, wenn nicht dasselbe Angebot
    // Camping + Airbnb (explizit oder Rooms aus Soft-Probe): Partner-URL nie durch CHECK24-Pauschal ersetzen
    const hasAirbnbRoomStay = realStayChoices.some((s) => {
      try {
        const { extractAirbnbRoomId } = require('../../services/affiliate/airbnbDeepLink') as {
          extractAirbnbRoomId: (u?: string | null) => string | null;
        };
        return Boolean(extractAirbnbRoomId(s.bookUrl));
      } catch {
        return /airbnb\.(?:com|de)\/rooms\//i.test(String(s.bookUrl || ''));
      }
    });
    if (
      stayBookUrl &&
      packageBookUrl &&
      !campingStayMode &&
      !airbnbStayMode &&
      !hasAirbnbRoomStay
    ) {
      stayBookUrl = preferAffiliateIfSameOffer({
        affiliateUrl: packageBookUrl,
        directUrl: stayBookUrl,
        sameOffer: false,
      });
    }
  } catch {
    /* soft */
  }
  // Airbnb-Stay-URLs vor Checklist nochmal mit Prefill härten (explizit + Soft-Rooms)
  if ((airbnbStayMode || airbnbEnrich) && !campingStayMode) {
    try {
      const { getAirbnbSearchUrl, isAirbnbUrl, withAirbnbStayPrefill, extractAirbnbRoomId } =
        await import('../../services/affiliate/airbnbDeepLink');
      const airbnbPrefill = {
        city: place.name,
        checkin,
        checkout,
        adults,
        children,
      };
      realStayChoices = realStayChoices.map((s) => {
        if (!s.bookUrl) return s;
        // Search-URL nur bei explizitem Airbnb-Mode
        if (s.id === 'airbnb-search') {
          if (!airbnbStayMode) return s;
          return { ...s, bookUrl: getAirbnbSearchUrl(airbnbPrefill) };
        }
        if (!isAirbnbUrl(s.bookUrl)) return s;
        // Soft: nur /rooms/ härten, keine Search-URLs erzwingen
        if (!airbnbStayMode && !extractAirbnbRoomId(s.bookUrl)) return s;
        return {
          ...s,
          bookUrl: withAirbnbStayPrefill(s.bookUrl, airbnbPrefill),
        };
      });
      if (stayBookUrl && isAirbnbUrl(stayBookUrl)) {
        if (airbnbStayMode || extractAirbnbRoomId(stayBookUrl)) {
          stayBookUrl = withAirbnbStayPrefill(stayBookUrl, airbnbPrefill);
        }
      }
    } catch {
      /* soft */
    }
  }
  const checklist = buildBookingChecklist({
    transports,
    selectedTransportId: transports[0]?.id ?? null,
    stays: realStayChoices,
    selectedStayId: realStayChoices[0]?.id ?? null,
    hubStay: hubPreNightStay,
    bookendStartStay:
      bookendStartStay &&
      !(hubPreNightStay && bookendStartStay.id === hubPreNightStay.id)
        ? bookendStartStay
        : null,
    transferUrl,
    carUrl,
    activityUrls,
    packageBookUrl,
    packageUrls: packageCompareUrls.length
      ? packageCompareUrls
      : packageBookUrl
        ? [{ label: 'Pauschal CHECK24', url: packageBookUrl }]
        : [],
    alreadyBookedFlight: ledger.bookedFlight?.value === true,
    alreadyBookedStay: ledger.bookedStay?.value === true,
    alreadyBookedTransfer: ledger.bookedTransfer?.value === true,
    alreadyBookedCar: ledger.bookedCar?.value === true,
    alreadyBookedRail: ledger.bookedRail?.value === true,
    alreadyBookedBus: ledger.bookedBus?.value === true,
    alreadyBookedActivities: ledger.bookedActivities?.value ?? undefined,
  });

  const base: import('../types').ReiseOption = {
    id: place.id,
    title,
    placeName: place.name,
    lat: stayLat,
    lng: stayLng,
    totalEur: buy.totalPackage,
    budgetDeltaEur: budgetDeltaVsBuyIn(
      buy.buyInEur,
      budget,
      ledger.budgetScope?.value ?? 'per_person',
      buy.totalPackage,
    ) ?? (credible ? budgetDelta : null),
    pricePerPerson: buy.buyInEur,
    priceIncludes: priceIncludesLine(overnight, stayPrice != null, ledger.mode?.value, {
      hasFlight: flightPrice != null,
      hasTransfer: overnight && transferEur > 0,
      hasCar: carEur != null,
    }),
    restBudgetEur: rest?.eur ?? null,
    restBudgetHint: rest?.hint ?? null,
    matchScore: score,
    fitLine: line,
    whyBlurb: blurb,
    facts,
    softFacts,
    whyMatch: why.length >= 2 ? [why[0]!, why[1]!] : [why[0]!],
    gaps,
    photoUrl: photo,
    stayName,
    stayBookUrl,
    stayPriceEur: stayPrice,
    carBookUrl: carUrl,
    transferBookUrl: transferUrl,
    packageBookUrl,
    flightBookUrl: flightUrl,
    flightPriceEur: flightPrice,
    originUsed,
    decisionNotes,
    stops,
    buyInEur: buy.buyInEur,
    buyInLabel: buy.buyInLabel,
    extrasEur: extrasSum,
    hubPreNightStay,
    bookendStartStay,
    carPriceEur: carEur,
    stays: realStayChoices,
    selectedStayId: realStayChoices[0]?.id ?? null,
    transports,
    selectedTransportId: transports[0]?.id ?? null,
    days,
    bookingChecklist: checklist,
    dealHit: realStayChoices.some((s) => s.dealHit) || Boolean(ledger.dealHunt?.value),
    transferEur: overnight ? transferEur : null,
    transferMinutes: overnight ? transferMinutes : null,
  };
  if (stayName) {
    emitSpark({
      kind: 'stay',
      emoji: looksAllInclusive({ name: stayName, amenities: stayAmen.split(/\s+/) })
        ? '🍽️'
        : '🏡',
      label: stayName.slice(0, 22),
      sub:
        stayPrice != null
          ? `€${Math.round(stayPrice)}${place.name ? ` · ${place.name}` : ''}`
          : place.name,
      lat: place.lat,
      lng: place.lng,
    });
  } else if (packageBookUrl || packageCompareUrls.length > 0) {
    emitSpark({
      kind: 'deal',
      emoji: '📦',
      label: 'Pauschal-Links',
      sub: 'nur Buchung',
    });
  }
  if (flightPrice != null && place.iata) {
    emitSpark({
      kind: 'flight',
      emoji: '✈️',
      label: `${originUsed || '…'} → ${place.iata}`,
      sub: `${Math.round(flightPrice)}€ p.P.`,
      lat: place.lat,
      lng: place.lng,
    });
  }
  if (base.dealHit) {
    emitSpark({
      kind: 'deal',
      emoji: '🔥',
      label: place.name,
      sub: 'Deal-Signal',
    });
  }
  try {
    const { harvestWishEvidence } = await import('./wishEvidenceHarvest');
    const stayAnchor =
      Boolean(realStayChoices[0]?.lat != null && realStayChoices[0]?.lng != null) &&
      Boolean(stayName || realStayChoices[0]?.name);
    wishEvidence = await harvestWishEvidence({
      lat: stayAnchor ? stayLat : place.lat,
      lng: stayAnchor ? stayLng : place.lng,
      placeName: place.name,
      stayPhotoUrl: stayPhoto,
      stayAmenities: stayAmen,
      stayName,
      ledger,
      amenityHits: amenHitsForWish,
      distanceAnchor: stayAnchor ? 'stay' : 'city',
    });
  } catch {
    wishEvidence = [];
  }
  // Soft-Tagesplan mit belegten Wish-Hints nachziehen
  if (userWantsProgramDays(ledger) && (base.days?.length ?? 0) > 0) {
    try {
      const rebuilt = buildDayPlans({
        checkin,
        checkout,
        placeName: place.name,
        transport: transports[0] ?? null,
        stay: stayChoices[0] ?? null,
        transferEur: overnight ? transferEur : null,
        activities: (ledger.mustActivities?.value ?? []).filter((a) => !/^e-?sim$/i.test(a)),
        activityBookByTitle,
        ledger,
        wishHints: [
          ...wishEvidence.filter((e) => e.met && e.name).map((e) => String(e.name)),
          ...activityUrls.map((a) => a.label),
        ].slice(0, 8),
      });
      if (esimUrl && rebuilt[0]) {
        rebuilt[0] = {
          ...rebuilt[0],
          blocks: [
            ...rebuilt[0].blocks,
            {
              id: `${rebuilt[0].dayKey}-esim`,
              title: 'eSIM',
              detail: 'Daten am Ziel — Partner-Link aus dem Brief',
              bookUrl: esimUrl,
            },
          ],
        };
      }
      base.days = rebuilt;
    } catch {
      /* soft */
    }
  }
  // Live: echte Locations / Öffnungsfenster / Ticket-Links pro Tag
  if (userWantsProgramDays(ledger) && (base.days?.length ?? 0) > 0) {
    try {
      const { enrichDayPlansWithLivePlaces } = await import('./liveDayProgram');
      const liveDays = await enrichDayPlansWithLivePlaces({
        days: base.days ?? [],
        lat: stayLat,
        lng: stayLng,
        placeName: place.name,
        ledger,
        arriveAt: transports[0]?.arriveAt || transports[0]?.departAt || null,
      });
      if (liveDays.length) base.days = liveDays;
    } catch {
      /* soft Soft-Plan bleibt */
    }
  }
  let mag = enrichOptionMagazine(base, ledger, {
    transferMinutes: overnight ? transferMinutes : null,
    destPhotoUrl: photo,
    wishEvidence,
  });
  try {
    const { fetchDestinationTripWeather } = await import('./destinationTripWeather');
    const wx = await fetchDestinationTripWeather({
      lat: mag.lat,
      lng: mag.lng,
      dateStart: ledger.dateStart?.value,
      dateEnd: ledger.dateEnd?.value,
    });
    if (wx?.line) {
      const facts = [
        ...(mag.facts ?? []).filter((f) => f.id !== 'weather'),
        {
          id: 'weather',
          emoji: wx.emoji || '🌡️',
          label: `${wx.lowC === wx.highC ? `${wx.highC}°` : `${wx.lowC}–${wx.highC}°`} · ${wx.condition}${
            wx.kind === 'typical' ? ' (typisch)' : ''
          }`,
          met: true,
        },
      ].slice(0, 8);
      mag = {
        ...mag,
        weatherLine: wx.line,
        weatherTempHighC: wx.highC,
        weatherTempLowC: wx.lowC,
        weatherKind: wx.kind,
        facts,
      };
    }
  } catch {
    /* soft */
  }
  try {
    const { enrichOptionAsPackage } = await import('./enrichOptionAsPackage');
    mag = enrichOptionAsPackage(mag, ledger);
    try {
      const {
        buildHubFeederPlan,
        enrichHubFeederLivePrices,
      } = await import('./hubFeederPlan');
      const tr =
        mag.transports?.find((t) => t.id === mag.selectedTransportId) ||
        mag.transports?.find((t) => t.kind === 'flight') ||
        null;
      let plan = buildHubFeederPlan({ ledger, transport: tr });
      if (plan?.needed) {
        plan = await enrichHubFeederLivePrices(plan);
        const note = `Zubringer ${plan.home}→${plan.boardingCity}→${plan.hubCity}→${plan.hubIata} (FlixBus/FlixTrain/DB)`;
        mag = {
          ...mag,
          decisionNotes: [...(mag.decisionNotes ?? []).filter((n) => !/^Zubringer /i.test(n)), note].slice(
            0,
            12,
          ),
        };
      }
    } catch {
      /* soft */
    }
  } catch {
    /* soft */
  }
  return mag;
}

export async function runReisebueroFunnel(): Promise<void> {
  const { RESEARCH_HARD_CAP_MS } = await import('./progressPace');
  const RESEARCH_DEADLINE_MS = RESEARCH_HARD_CAP_MS;
  const started = Date.now();
  const deadline = started + RESEARCH_DEADLINE_MS;
  const timedOut = () => Date.now() >= deadline;
  const hardStop = () => Date.now() >= deadline;
  const msLeft = () => Math.max(0, deadline - Date.now());
  /** Letzte 3 Min: aggressiv kürzen. */
  const squeeze = () => msLeft() > 0 && msLeft() < 3 * 60_000;

  /** Arbeit abbrechen wenn Cap erreicht — liefert Fallback (oft Partial). */
  async function raceCap<T>(work: Promise<T>, fallback: () => T): Promise<T> {
    const left = msLeft();
    if (left <= 0) return fallback();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        work,
        new Promise<T>((resolve) => {
          timer = setTimeout(() => resolve(fallback()), left);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  const store = useReisebueroStore.getState();
  const { trip } = store;
  // STT-Müll („Davon“) nie als Bahn-Start — Brief nachdenken, nicht 1:1
  const ledger = scrubJunkPlacesFromLedger(trip.ledger);
  if (
    (trip.ledger.originCity?.value && isJunkPlaceName(trip.ledger.originCity.value)) ||
    (trip.ledger.originCities?.value ?? []).some((c) => isJunkPlaceName(c))
  ) {
    try {
      useReisebueroStore.setState({
        trip: { ...trip, ledger, updatedAtMs: Date.now() },
      });
    } catch {
      /* soft — lokal scrubbed ledger reicht für die Suche */
    }
  }

  // Hard-Gate: ohne Brief-Pack (inkl. Gepäck bei Flug) keine Suche
  try {
    const { firstBookingBriefBlocker, isBriefComplete } = await import('../completeness');
    if (!isBriefComplete(ledger)) {
      const block = firstBookingBriefBlocker(ledger);
      store.setSearching(false);
      store.setPhase('briefing');
      store.syncSearchReadySticky();
      const label = block?.label || 'Angaben';
      const ask =
        block?.key === 'bags'
          ? 'Bevor ich suche: Handgepäck und Aufgabegepäck — wie viel braucht ihr?'
          : `Bevor ich suche, fehlt noch: ${label}.`;
      try {
        store.appendAssistant(ask, label);
      } catch {
        /* soft */
      }
      return;
    }
  } catch {
    /* soft — Recherche darf bei Import-Fehler weiter */
  }

  store.setSearching(true);
  seedResearchTheater({ path: 'default' });
  try {
    const { beginReiseResearchLifecycle } = await import('./researchLifecycle');
    await beginReiseResearchLifecycle();
  } catch {
    /* soft — Recherche läuft trotzdem */
  }
  const log: FunnelLogLine[] = [];
  let researchPath: import('./researchPath').ResearchPathKind = 'flight_first';
  let ecoAccess = false;
  let adaptiveBrief: import('./adaptiveBrief').AdaptiveBrief | null = null;
  let researchStrategy: import('./researchStrategy').ConstrainedComparePlan | null = null;
  let routeTour: import('./routeTourInventory').RouteTourPlan | null = null;
  let stayInventoryHits: import('./stayFirstInventory').StayInventoryHit[] = [];
  let inspirationPlaces: import('./candidates').SeedPlace[] = [];
  try {
    const {
      resolveResearchPath,
      preferEcoAccess,
      relaxConstraintsForBudget,
    } = await import('./researchPath');
    researchPath = resolveResearchPath(ledger);
    ecoAccess = preferEcoAccess(ledger);
    try {
      const { startResearchProgress } = await import('./progressController');
      startResearchProgress({ path: researchPath });
    } catch {
      /* soft */
    }
    const { buildAdaptiveBrief } = await import('./adaptiveBrief');
    adaptiveBrief = buildAdaptiveBrief(ledger);
    const { resolveResearchStrategy } = await import('./researchStrategy');
    researchStrategy = resolveResearchStrategy(ledger);
    const { resolveResearchLead } = await import('./researchLead');
    const researchLead = resolveResearchLead(ledger);
    // Constrained Compare: Access+Stay parallel, nicht Stay-Inventar-Weite.
    if (researchStrategy.strategy === 'constrained_compare' && researchPath === 'stay_first') {
      researchPath = 'flight_first';
    }
    // Lead gewinnt über Path, wenn klarer (Cruise/Stay/…).
    if (researchLead.weight >= 80) {
      researchPath = researchLead.path;
    }
    if (adaptiveBrief.preferEco) ecoAccess = true;
    if (adaptiveBrief.preferEco) {
      try {
        const { rememberStablePref } = await import('../tasteMemory');
        await rememberStablePref('eco');
      } catch {
        /* soft */
      }
    }
    log.push({
      stage: '0a',
      detail: `Lead ${researchLead.kind} · Pfad ${researchPath}${ecoAccess ? ' · eco' : ''} · Strategie ${researchStrategy.strategy}${researchStrategy.family ? `/${researchStrategy.family}` : ''} · Archetype ${adaptiveBrief.archetype}${researchLead.valueFloor ? ' · Value-Floor' : ''}`,
    });
    const leadEmoji =
      researchLead.kind === 'cruise' || researchLead.kind === 'ferry'
        ? '🛳️'
        : researchLead.kind === 'stay'
          ? '🏠'
          : researchLead.kind === 'event' || researchStrategy.strategy === 'constrained_compare'
            ? '⚖️'
            : researchLead.kind === 'route'
              ? '🥾'
              : researchLead.kind === 'climate'
                ? '🌤️'
                : researchLead.kind === 'place'
                  ? '📍'
                  : '✈️';
    emitSpark({
      kind: 'vibe',
      emoji: leadEmoji,
      label: researchLead.label,
      sub: researchLead.moneySecondary ? 'Geld zweitrangig' : 'Preis mit im Lead',
    });
    for (const h of (
      researchStrategy.strategy === 'constrained_compare'
        ? researchStrategy.briefHints
        : researchLead.searchOrder
    ).slice(0, 3)) {
      emitSpark({ kind: 'vibe', emoji: '🧭', label: h, sub: 'Reihenfolge' });
    }
    if (researchLead.valueFloor) {
      emitSpark({
        kind: 'vibe',
        emoji: '⚖️',
        label: 'Preis-Leistung',
        sub: 'günstig sinnvoll, kein Dump',
      });
    }
    // Optimalfall→Kürzen: Nice droppen, AI schwächt Bier-Nähe
    const hardBits = [
      ...(ledger.mustHaves?.value ?? []).map(String),
      ...(ledger.mustActivities?.value ?? []).map(String),
    ];
    const niceBits = [
      ...(ledger.wishHaves?.value ?? []).map(String),
      ...(ledger.niceHaves?.value ?? []).map(String),
    ];
    const relaxed = relaxConstraintsForBudget({
      hard: hardBits,
      nice: niceBits,
      hasAllInclusive: ledger.meals?.value === 'all',
    });
    if (relaxed.note) {
      emitSpark({ kind: 'vibe', emoji: '✂️', label: 'Constraints gekürzt', sub: relaxed.note.slice(0, 48) });
      log.push({ stage: '0a', detail: relaxed.note });
    }
    // Stable prefs in Funnel injizieren
    try {
      const { listStablePrefs } = await import('../tasteMemory');
      const prefs = listStablePrefs().slice(0, 6);
      for (const p of prefs) {
        emitSpark({ kind: 'vibe', emoji: '🧠', label: p, sub: 'stabile Pref' });
      }
      if (prefs.length) {
        log.push({ stage: '0a', detail: `Stable prefs: ${prefs.join(', ')}` });
      }
    } catch {
      /* soft */
    }
    const { regionSeasonForQuery } = await import('./regionalSeasonTables');
    const season = regionSeasonForQuery(
      [
        ledger.destinationHint?.value,
        ledger.corridor?.value,
        ledger.dateMonth?.value,
      ]
        .filter(Boolean)
        .join(' '),
    );
    if (season) {
      emitSpark({
        kind: 'vibe',
        emoji: '📊',
        label: season.label,
        sub: season.climateNote.slice(0, 48),
      });
    }
    const {
      inspirationSeedsForLedgerTags,
      ensureInspirationCatalogFresh,
    } = await import('./inspirationCatalog');
    const tags = [
      ...(ledger.mustHaves?.value ?? []).map(String),
      ledger.partyStyle?.value === 'no' || ledger.partyStyle?.value === 'kein'
        ? 'anti_party'
        : '',
    ].filter(Boolean) as string[];
    if (researchStrategy?.strategy === 'constrained_compare') {
      // Klarer Orts-Set: kein breiter Inspiration-Katalog — Venue-Seeds reichen.
      for (const s of researchStrategy.seeds.slice(0, 4)) {
        emitSpark({
          kind: 'place',
          emoji: placeSparkEmoji([], s.name),
          label: s.name,
          sub: 'Vergleichs-Ort',
          lat: s.lat,
          lng: s.lng,
        });
      }
      inspirationPlaces = researchStrategy.seeds.slice();
      log.push({
        stage: '0i',
        detail: `Constrained Compare · ${researchStrategy.family || 'event'} · ${researchStrategy.seeds.length} Venue-Seeds`,
      });
    } else {
    const catalog = await ensureInspirationCatalogFresh({
      tags,
      timedOut,
      allowPaidRefresh: !timedOut(),
    });
    const seeds = (catalog.seeds.length
      ? catalog.seeds
      : inspirationSeedsForLedgerTags(tags)
    ).slice(0, 6);
    for (const s of seeds) {
      emitSpark({
        kind: 'place',
        emoji: '✨',
        label: s.destLabel,
        sub: `Katalog ${s.vibe}${s.source && s.source !== 'seed' ? ` · ${s.source}` : ''}`,
      });
    }
    log.push({
      stage: '0i',
      detail: `Inspiration-Katalog ${catalog.source}${catalog.refreshed ? ' · refreshed' : ''} · ${seeds.length} Sparks · ${catalog.places.length} Places`,
    });
    inspirationPlaces = catalog.places;
    }
  } catch {
    /* soft */
  }
  emitStep({
    stage: 'brief_plan',
    title: 'Brief-Plan',
    detail: 'Suchplan aus dem Brief',
    status: 'active',
    progress: 0.04,
  });
  try {
    const { buildResearchBriefJson } = await import('../researchBriefJson');
    const brief = buildResearchBriefJson(ledger);
    emitSpark({
      kind: 'vibe',
      emoji: '📋',
      label: `${brief.targetOptions} Pakete · ${brief.optionGrain}`,
      sub: brief.dest || brief.corridor || brief.purpose || 'offen',
    });
    if (brief.when.preferOutbound || brief.when.preferReturn) {
      emitSpark({
        kind: 'vibe',
        emoji: '🗓️',
        label: [
          brief.when.preferOutbound ? `Los ${brief.when.preferOutbound}` : null,
          brief.when.preferReturn ? `Rück ${brief.when.preferReturn}` : null,
        ]
          .filter(Boolean)
          .join(' · '),
        sub: 'Prefer-Fenster',
      });
    }
    if (brief.hops.length >= 2) {
      emitSpark({
        kind: 'vibe',
        emoji: '🗺️',
        label: brief.hops.map((h) => h.city).join(' → '),
        sub: 'Multi-City',
      });
    }
    log.push({
      stage: 'brief_plan',
      detail: `Brief ${brief.optionGrain} → ${brief.targetOptions} Optionen · Pfad ${researchPath}`,
    });
  } catch {
    /* soft */
  }
  finishStep('brief_plan', 'Suchplan steht');
  emitStep({
    stage: 'climate',
    title: 'Wetter & Klima',
    detail: 'Zeitraum + Wetter matchen',
    status: 'active',
    progress: 0.08,
  });
  emitSpark({
    kind: 'vibe',
    emoji: '🌤️',
    label: 'Wetterdaten',
    sub: ledger.dateWindow?.value || ledger.dateMonth?.value || ledger.weatherWant?.value || 'Zeitraum',
  });
  if (ledger.weatherWant?.value) {
    emitSpark({
      kind: 'vibe',
      emoji: ledger.weatherWant.value === 'warm' ? '☀️' : '🌡️',
      label: String(ledger.weatherWant.value),
      sub: 'Wunsch-Wetter',
    });
  }
  if (ledger.dateStart?.value || ledger.dateEnd?.value) {
    emitSpark({
      kind: 'vibe',
      emoji: '📅',
      label: [ledger.dateStart?.value, ledger.dateEnd?.value].filter(Boolean).join(' → '),
      sub: 'Reisezeitraum',
    });
  }
  // Echte Temps (Open-Meteo) für Climate-Stage — max 2 Orte, überspringen nahe Cap
  if (!hardStop() && !squeeze()) {
  try {
    const { fetchDestinationTripWeather } = await import('./destinationTripWeather');
    const preferIds = new Set(['palma', 'budapest', 'amsterdam', 'kreta', 'lisbon', 'berlin']);
    const wxSeeds = [
      ...SEED_PLACES.filter((p) => preferIds.has(p.id)),
      ...SEED_PLACES.filter((p) => !preferIds.has(p.id)),
    ]
      .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng))
      .slice(0, 2);
    const monthMid = ledger.dateMonth?.value
      ? `${String(ledger.dateMonth.value).slice(0, 7)}-15`
      : null;
    const wxHits = await raceCap(
      Promise.all(
        wxSeeds.map(async (p) => {
          const wx = await fetchDestinationTripWeather({
            lat: p.lat,
            lng: p.lng,
            dateStart: ledger.dateStart?.value || monthMid,
            dateEnd: ledger.dateEnd?.value || null,
          });
          return wx ? { place: p, wx } : null;
        }),
      ),
      () => [] as Array<{ place: (typeof SEED_PLACES)[number]; wx: NonNullable<Awaited<ReturnType<typeof fetchDestinationTripWeather>>> } | null>,
    );
    for (const hit of wxHits) {
      if (!hit) continue;
      const range =
        hit.wx.lowC === hit.wx.highC ? `${hit.wx.highC}°` : `${hit.wx.lowC}–${hit.wx.highC}°`;
      emitSpark({
        kind: 'vibe',
        emoji: hit.wx.emoji || '🌡️',
        label: `${hit.place.name} ${range}`,
        sub: `${hit.wx.condition}${hit.wx.kind === 'typical' ? ' · typisch' : ''}`,
        lat: hit.place.lat,
        lng: hit.place.lng,
      });
    }
  } catch {
    /* soft — Climate ohne Live-Temps */
  }
  }
  const usePro = shouldUseReisebueroPro(trip);
  log.push({
    stage: '0',
    detail: `Brief ${isBriefComplete(ledger) ? 'komplett' : 'mit Defaults'} — Modus ${ledger.mode?.value ?? '?'} → ${usePro ? 'Pro+Live (erste Auswahl)' : 'Lite+Live (Korrektur)'} · Cap 15 Min`,
  });

  try {
    const { discoverHintsFromLedger } = await import('./discoveryIntent');
    const disc = discoverHintsFromLedger(ledger);
    if (disc) {
      log.push({ stage: '0d', detail: `Discover-Intent ${disc.intent}: ${disc.searchQuery}` });
      emitStep({
        stage: 'discover',
        title: 'Szene finden',
        detail: disc.searchQuery.slice(0, 80),
        progress: 0.15,
      });
      emitSpark({
        kind: 'vibe',
        emoji: '🔟',
        label: 'Top-Orte suchen',
        sub: disc.intent,
      });
    } else {
      const brief = shortlistSearchBrief(ledger);
      emitSpark({
        kind: 'vibe',
        emoji: '🔟',
        label: 'Shortlist bauen',
        sub: intentArcFromLedger(ledger),
      });
      log.push({ stage: '0d', detail: `Arc-Brief ${brief.slice(0, 100)}` });
    }
  } catch {
    /* soft */
  }

  const origin = originOf(ledger);
  const maxH = ledger.maxDriveHours?.value ?? (ledger.mode?.value === 'daytrip' ? 2.2 : 12);
  const visited = visitedNames();

  finishStep('climate', 'Zeitraum & Klima gesetzt');
  emitStep({
    stage: 'discover',
    title: researchStrategy?.strategy === 'constrained_compare' ? 'Orte fixieren' : 'Orte finden',
    detail:
      researchStrategy?.strategy === 'constrained_compare'
        ? 'Vergleichs-Set aus Event/Anker'
        : 'Kandidaten suchen',
    progress: 0.2,
  });
  if (researchStrategy?.strategy !== 'constrained_compare') {
    emitSpark({ kind: 'vibe', emoji: '💎', label: 'Gem-Hunt', sub: 'Geheim · Exklusiv · Deals' });
  } else {
    emitSpark({
      kind: 'vibe',
      emoji: '⚖️',
      label: 'Paket-Vergleich',
      sub: 'Flug + Stay je Ort',
    });
  }
  // Parallel: Discover + Gem-Hunt + Named-Geocode (Compare: Discover soft/kurz)
  const [pro, gem, namedSeed] = await Promise.all([
    researchStrategy?.strategy === 'constrained_compare'
      ? Promise.resolve({ destinations: [] as Awaited<ReturnType<typeof runReisebueroProDiscover>>['destinations'], researchNotes: 'constrained_skip' })
      : runReisebueroProDiscover(ledger, { usePro }),
    researchStrategy?.strategy === 'constrained_compare'
      ? Promise.resolve({ destinations: [] as Awaited<ReturnType<typeof runGemHuntDiscover>>['destinations'], dealHints: [] as string[], notes: 'constrained_skip' })
      : runGemHuntDiscover(ledger, { usePro: false }),
    resolveNamedDestinationSeed(ledger),
  ]);
  log.push({
    stage: '0b',
    detail: pro.destinations.length
      ? `Discover(${usePro ? 'Pro' : 'Lite'}) ${pro.destinations.length}${pro.researchNotes ? ` — ${pro.researchNotes}` : ''}`
      : `Discover(${usePro ? 'Pro' : 'Lite'}) leer/soft`,
  });
  if (gem.destinations.length || gem.dealHints.length) {
    log.push({
      stage: '0g',
      detail: `Gem-Hunt ${gem.destinations.length} Tipps${gem.notes ? ` — ${gem.notes}` : ''}`,
    });
    for (const h of gem.dealHints.slice(0, 3)) {
      emitSpark({ kind: 'deal', emoji: '🔥', label: h.slice(0, 28), sub: 'Schnäppchen-Hinweis' });
    }
    for (const d of gem.destinations.slice(0, 5)) {
      emitSpark({
        kind: isGemTagged(d.tags) ? 'deal' : 'place',
        emoji: d.tags?.includes('exclusive')
          ? '✨'
          : d.tags?.some((t) => /deal|bargain/i.test(t))
            ? '🔥'
            : '💎',
        label: d.name,
        sub: d.whyFit?.slice(0, 36) || 'Geheimtipp',
        lat: d.lat,
        lng: d.lng,
      });
    }
  }
  if (namedSeed) {
    log.push({ stage: '0c', detail: `Named dest ${namedSeed.name}` });
    emitSpark({
      kind: 'place',
      emoji: placeSparkEmoji([], namedSeed.name),
      label: namedSeed.name,
      sub: 'dein Ziel',
      lat: namedSeed.lat,
      lng: namedSeed.lng,
    });
  }
  for (const d of pro.destinations.slice(0, 10)) {
    emitSpark({
      kind: 'place',
      emoji: placeSparkEmoji(d.tags || [], d.name),
      label: d.name,
      sub: d.whyFit?.slice(0, 36) || undefined,
      lat: d.lat,
      lng: d.lng,
    });
  }
  if (pro.destinations.length) {
    emitSpark({
      kind: 'vibe',
      emoji: '📋',
      label: `${pro.destinations.length} Orte shortlist`,
      sub: 'jetzt Preise prüfen',
    });
  }

  // Katalog wächst mit jeder Recherche (Assist-Overlay + Cache + Inbox)
  try {
    const { writeBackInspirationFromDiscover } = await import('./inspirationWriteBack');
    const wb = await writeBackInspirationFromDiscover({
      ledger,
      destinations: [...pro.destinations, ...gem.destinations],
      sourceLabel: 'funnel_discover',
    });
    if (wb.added > 0) {
      log.push({
        stage: '0w',
        detail: `Inspiration-WriteBack +${wb.added} (${wb.vibes.join(',') || '—'})`,
      });
      emitSpark({
        kind: 'vibe',
        emoji: '📚',
        label: `Katalog +${wb.added}`,
        sub: 'lernt aus dieser Suche',
      });
    }
  } catch {
    /* soft */
  }

  const proSeeds = [
    ...pro.destinations.map(proCandidateToSeed),
    ...gem.destinations.map(proCandidateToSeed),
  ].filter((p): p is SeedPlace => !!p);
  const whyById = new Map(
    [...pro.destinations, ...gem.destinations].map((d) => [d.id, d.whyFit] as const),
  );

  finishStep('discover', 'Kandidaten geladen');
  emitStep({ stage: 'events', title: 'Events', detail: 'Was geht im Fenster?', progress: 0.28 });
  emitSpark({
    kind: 'vibe',
    emoji: '🎟️',
    label: 'Schaue nach Events…',
    sub: ledger.dateWindow?.value || ledger.dateMonth?.value || 'im Zeitraum',
  });
  const wantClubs =
    ledger.partyGrain?.value === 'clubs' ||
    ledger.partyGrain?.value === 'mix' ||
    /club|party|feier/i.test(
      `${ledger.partyStyle?.value || ''} ${ledger.purpose?.value || ''} ${ledger.highlightWant?.value || ''}`,
    );
  if (wantClubs) {
    emitSpark({
      kind: 'vibe',
      emoji: '🎶',
      label: 'Schaue nach Clubs…',
      sub: 'Nightlife im Korridor',
    });
  }
  if (ledger.purpose?.value) {
    emitSpark({ kind: 'vibe', emoji: '🎉', label: ledger.purpose.value, sub: 'Reise-Hook' });
  }
  // Gefundene Venue-Seeds sichtbar machen („Ah — das hab ich hier“)
  try {
    const venueSeeds = (researchStrategy?.seeds ?? []).slice(0, 4);
    for (const s of venueSeeds) {
      emitSpark({
        kind: 'place',
        emoji: wantClubs ? '🎶' : '🎟️',
        label: `Ah — ${s.name}`,
        sub: (s.tags || []).slice(0, 2).join(' · ') || 'passt zum Brief',
        lat: s.lat,
        lng: s.lng,
      });
    }
    if (!venueSeeds.length && wantClubs) {
      emitSpark({
        kind: 'vibe',
        emoji: '🔎',
        label: 'Clubs weiter scannen',
        sub: 'konkrete Namen folgen mit Stay',
      });
    }
  } catch {
    /* soft */
  }
  finishStep('events', wantClubs ? 'Events + Clubs gescannt' : 'Event-Hints notiert');
  // Hart: Flüge erst nach Events (Rail-SSOT) — Soft dazwischen ok
  emitStep({ stage: 'soft', title: 'Wünsche', detail: 'Prefs & Soft-Fit', progress: 0.35 });
  for (const w of [...(ledger.mustHaves?.value ?? []), ...(ledger.wishHaves?.value ?? [])].slice(0, 5)) {
    emitSpark({ kind: 'vibe', emoji: '✨', label: w, sub: 'Wunsch' });
  }
  if (ledger.partyGrain?.value) {
    emitSpark({ kind: 'vibe', emoji: '🍻', label: ledger.partyGrain.value, sub: 'Feier-Style' });
  }
  if (ledger.meals?.value) {
    emitSpark({ kind: 'vibe', emoji: '🍽️', label: ledger.meals.value, sub: 'Essen' });
  }
  let pool = biasPoolForIntent(
    SEED_PLACES.filter((p) => tagMatch(p, ledger)),
    ledger,
  );
  try {
    const { orderPoolForResearchPath } = await import('./researchPath');
    pool = orderPoolForResearchPath(pool, researchPath);
  } catch {
    /* soft */
  }
  log.push({ stage: '1', detail: `Seed-Geografie ${pool.length} · Pfad ${researchPath}` });

  pool = pool.filter((p) => {
    const hours = driveHours(haversineKm(origin, p));
    if (ledger.mode?.value === 'fly') return true;
    if (researchPath === 'stay_first' && p.iata) return true;
    if (researchPath === 'route_tour') return true;
    return hours <= maxH + 0.4;
  });
  log.push({ stage: '1b', detail: `Anreise-Cap ${maxH}h → ${pool.length}` });

  emitStep({
    stage: 'access_filter',
    title: 'Zugang-Filter',
    detail: `Erreichbar in ~${maxH}h · ${pool.length} Kandidaten`,
    progress: 0.32,
  });

  pool = pool.filter((p) => !visited.some((n) => n.includes(p.name.toLowerCase()) || p.name.toLowerCase().includes(n)));
  log.push({ stage: '1c', detail: `Passport-Filter → ${pool.length}` });
  finishStep('access_filter', `${pool.length} nach Zugang`);

  if (!pool.length) {
    pool = biasPoolForIntent(
      SEED_PLACES.filter((p) => tagMatch(p, ledger)).slice(0, 8),
      ledger,
    );
    log.push({ stage: '1d', detail: 'Fallback ohne Passport-Cut' });
  }

  const extras: SeedPlace[] = [];
  if (researchStrategy?.strategy === 'constrained_compare' && researchStrategy.seeds.length) {
    extras.unshift(...researchStrategy.seeds);
    log.push({
      stage: '1cmp',
      detail: `Compare-Seeds ${researchStrategy.seeds.map((s) => s.name).join(', ')}`,
    });
  }
  if (namedSeed) extras.push(namedSeed);
  extras.push(...proSeeds);
  if (inspirationPlaces.length && researchStrategy?.strategy !== 'constrained_compare') {
    extras.unshift(...inspirationPlaces.slice(0, 6));
    log.push({
      stage: '1insp',
      detail: `Inspiration-Places ${Math.min(6, inspirationPlaces.length)} in Shortlist-Pool`,
    });
  } else if (
    researchStrategy?.strategy === 'constrained_compare' &&
    inspirationPlaces.length &&
    !researchStrategy.seeds.length
  ) {
    extras.unshift(...inspirationPlaces.slice(0, 4));
  }

  // Stay-first: globales Amenity-Inventar vor Shortlist (nicht bei Event-Compare)
  if (
    researchPath === 'stay_first' &&
    needsNight(ledger) &&
    !timedOut() &&
    researchStrategy?.strategy !== 'constrained_compare'
  ) {
    try {
      emitSpark({
        kind: 'stay',
        emoji: '🏠',
        label: 'Stay-Inventar',
        sub: 'Amenities zuerst',
      });
      const { harvestStayFirstInventory, inventoryHitsToSeeds } = await import(
        './stayFirstInventory'
      );
      const win = stayWindow(ledger);
      stayInventoryHits = await harvestStayFirstInventory({
        ledger,
        checkin: win.checkin,
        checkout: win.checkout,
        adults: ledger.adults?.value ?? 2,
        maxRegions: timedOut() ? 3 : 8,
        timedOut,
      });
      extras.unshift(...inventoryHitsToSeeds(stayInventoryHits));
      const groundedN = stayInventoryHits.filter((h) => h.source === 'grounded').length;
      for (const h of stayInventoryHits.slice(0, 5)) {
        emitSpark({
          kind: 'stay',
          emoji: h.hardFit > 0 ? '✅' : h.source === 'grounded' ? '🌍' : '🏨',
          label: h.stayName.slice(0, 28),
          sub: `${h.regionName}${h.hardFit ? ` · ${h.hardFit} Must` : ''}${h.source === 'grounded' ? ' · weltweit' : ''}`,
          lat: h.lat,
          lng: h.lng,
        });
      }
      log.push({
        stage: '1e',
        detail: `Stay-first Inventory ${stayInventoryHits.length} Hits · ${new Set(stayInventoryHits.map((h) => h.regionId)).size} Regionen · grounded ${groundedN}`,
      });
    } catch (e) {
      log.push({ stage: '1e', detail: `Stay-Inventory soft-fail ${String(e).slice(0, 60)}` });
    }
  }

  // Route-Tour: Live Etappen (Grounded + Hütten/Places + Trail) · Seed-Fallback
  if (researchPath === 'route_tour' && !timedOut()) {
    try {
      const { buildRouteTourPlanLive } = await import('./routeTourInventory');
      routeTour = await buildRouteTourPlanLive({
        ledger,
        origin,
        nights: ledger.stayNights?.value,
        timedOut,
      });
      extras.unshift(...routeTour.lodgingSeeds);
      const liveTag = routeTour.liveEnriched ? 'live' : 'seed';
      const hutN = routeTour.stages.filter((s) => s.source === 'hut_places').length;
      const trailN = routeTour.stages.filter((s) => s.source === 'trail').length;
      emitSpark({
        kind: 'vibe',
        emoji: '🥾',
        label: `${routeTour.stages.length} Etappen`,
        sub: `${routeTour.mode} · ${liveTag}`,
      });
      for (const s of routeTour.stages.slice(1, 4)) {
        emitSpark({ kind: 'place', emoji: '📍', label: s.name, sub: s.why });
      }
      log.push({
        stage: '1f',
        detail: `Route-Tour ${routeTour.mode} · ${routeTour.stages.length} Stages · ${liveTag}${hutN ? ` · ${hutN} Hütten` : ''}${trailN ? ` · ${trailN} Trail` : ''}${routeTour.trailNotes ? ` · ${routeTour.trailNotes.slice(0, 80)}` : ''}`,
      });
    } catch (e) {
      log.push({ stage: '1f', detail: `Route-Tour soft-fail ${String(e).slice(0, 60)}` });
    }
  }

  const targetN =
    researchStrategy != null
      ? (
          await import('./researchStrategy')
        ).shortlistTargetForStrategy(researchStrategy, researchPath, timedOut() || squeeze())
      : hardStop()
        ? 3
        : squeeze()
          ? 5
          : researchPath === 'stay_first'
            ? 8
            : 10;
  // Constrained: Venue-Seeds zuerst, nicht am Drive-Cap sterben.
  let merged =
    researchStrategy?.strategy === 'constrained_compare' && researchStrategy.seeds.length
      ? prioritizeSeedsByTaste(mergePlacePool(researchStrategy.seeds, extras, 8), ledger)
      : prioritizeSeedsByTaste(mergePlacePool(pool, extras, timedOut() ? 10 : 18), ledger);
  try {
    const { orderPoolForResearchPath } = await import('./researchPath');
    merged = orderPoolForResearchPath(merged, researchPath);
    if (routeTour) {
      const { biasPoolForRouteTour } = await import('./routeTourInventory');
      merged = biasPoolForRouteTour(merged, routeTour);
    }
  } catch {
    /* soft */
  }
  const sliced = pickDiversePlaces(merged, targetN);
  log.push({
    stage: '2',
    detail:
      researchStrategy?.strategy === 'constrained_compare'
        ? `Compare-Shortlist ${sliced.length}/${targetN} · ${researchStrategy.family || 'event'} — Flug+Stay parallel`
        : `Shortlist ${sliced.length}/${targetN} divers (Taste+Seed+Pro·${researchPath}) — parallele Stay22/Flug${timedOut() ? ' · TIMEOUT-TRIM' : ''}`,
  });
  finishStep('soft', 'Wünsche gesetzt');
  emitStep({
    stage: 'shortlist',
    title: 'Shortlist',
    detail: `${sliced.length} echte Kandidaten`,
    progress: 0.4,
  });
  finishStep('shortlist', `${sliced.length} Shortlist`);
  for (const p of sliced.slice(0, 8)) {
    emitSpark({
      kind: 'place',
      emoji: placeSparkEmoji(p.tags, p.name),
      sub: p.iata ? `✈️ ${p.iata}` : 'im Rennen',
      lat: p.lat,
      lng: p.lng,
    });
  }
  emitSpark({
    kind: 'compare',
    emoji: '🧮',
    label: `${sliced.length} Orte durchrechnen`,
    sub:
      researchPath === 'stay_first'
        ? 'Stay · Amenities · Zugang'
        : researchPath === 'route_tour'
          ? 'Route · Hütten · Etappen'
          : 'Flug · Stay · Budget',
  });
  if (researchPath === 'stay_first' || researchPath === 'route_tour') {
    emitStep({
      stage: 'stay',
      title: ledger.bookedStay?.value === true ? 'Unterkunft schon da' : 'Unterkünfte zuerst',
      detail: ledger.bookedStay?.value === true ? 'Skip Stay-Live' : 'Hard-Musts prüfen',
      progress: 0.48,
    });
    emitStep({
      stage: 'flights',
      title: ledger.bookedFlight?.value === true ? 'Flug schon da' : 'Zugang danach',
      detail:
        ledger.bookedFlight?.value === true
          ? 'Skip Flug-Live'
          : ecoAccess
            ? 'Bahn/Bus priorisiert'
            : 'Flug/Anreise',
      progress: 0.62,
    });
  } else {
    const invMode = ledger.inventoryMode?.value;
    let researchFocus: import('../gapInventory').ResearchFocus = 'full';
    try {
      const { effectiveResearchFocus } = require('../gapInventory') as typeof import('../gapInventory');
      researchFocus = effectiveResearchFocus(ledger);
    } catch {
      /* soft */
    }
    const gapFlightOnly =
      researchFocus === 'flight' ||
      (ledger.bookedStay?.value === true && ledger.bookedFlight?.value !== true);
    const gapStayOnly =
      researchFocus === 'stay' ||
      (ledger.bookedFlight?.value === true && ledger.bookedStay?.value !== true);
    const gapActivityOnly = researchFocus === 'activity';
    const gapCarOnly = ledger.needCar?.value === true && ledger.bookedFlight?.value === true && ledger.bookedStay?.value === true;
    if (gapActivityOnly) {
      emitStep({
        stage: 'flights',
        title: 'Nur Aktivitäten',
        detail: 'Flug/Stay Skip — Events & Ausflüge',
        progress: 0.5,
      });
      emitSpark({
        kind: 'compare',
        emoji: '🎟️',
        label: 'Aktivitäten & Events',
        sub: ledger.destinationHint?.value || 'vor Ort',
      });
      emitStep({
        stage: 'stay',
        title: 'Unterkunft Skip',
        detail: 'Focus: nur Aktivitäten',
        progress: 0.55,
      });
    } else {
    emitStep({
      stage: 'flights',
      title: gapStayOnly || gapCarOnly || ledger.bookedFlight?.value === true
        ? 'Flug schon da'
        : gapFlightOnly
          ? researchFocus === 'flight'
            ? 'Nur Flüge'
            : 'Nur noch Flug'
          : 'Günstige Flüge',
      detail:
        ledger.bookedFlight?.value === true
          ? 'Skip — schon gebucht'
          : researchFocus === 'flight'
            ? 'Fast-Scope Flug'
            : invMode === 'gap_fill'
              ? 'Lücke Anreise'
              : 'Multi-Start & Preise',
      progress: 0.5,
    });
    if (ledger.bookedFlight?.value !== true && researchFocus !== 'stay') {
      emitSpark({
        kind: 'flight',
        emoji: '✈️',
        label: 'Flüge vergleichen',
        sub: originAirports(ledger).slice(0, 3).join('/') || ledger.originCity?.value || 'ab Start',
      });
    }
    emitStep({
      stage: 'stay',
      title: gapFlightOnly || ledger.bookedStay?.value === true
        ? researchFocus === 'flight'
          ? 'Hotel Skip'
          : 'Hotel schon da'
        : gapStayOnly
          ? researchFocus === 'stay'
            ? 'Nur Hotels'
            : 'Nur noch Hotel'
          : gapCarOnly
            ? 'Stay schon da · Mietwagen'
            : 'Unterkünfte',
      detail:
        ledger.bookedStay?.value === true || researchFocus === 'flight'
          ? researchFocus === 'flight'
            ? 'Fast-Scope — kein Stay'
            : 'Skip — schon gebucht'
          : invMode === 'gap_fill'
            ? 'Lücke Unterkunft'
            : 'Live-Preise',
      progress: 0.55,
    });
    }
  }

  const must = new Set(ledger.mustHaves?.value ?? []);
  const overnight = needsNight(ledger);
  let searchStayLive = overnight && ledger.bookedStay?.value !== true;
  let searchFlightLive = ledger.bookedFlight?.value !== true;
  try {
    const gi = require('../gapInventory') as typeof import('../gapInventory');
    searchStayLive = gi.searchStayLive(ledger);
    searchFlightLive = gi.searchFlightLive(ledger);
  } catch {
    /* soft */
  }
  const { checkin, checkout } = stayWindow(ledger);
  const adults = (() => {
    try {
      const { pinnedAdults } = require('./hardPins') as typeof import('./hardPins');
      return pinnedAdults(ledger);
    } catch {
      return ledger.adults?.value ?? 2;
    }
  })();
  let lodging: 'apartment' | 'hotel' | 'any' =
    must.has('ferienhaus') || must.has('apartment') || ledger.lodgingQuality?.value === 'nicer_base'
      ? 'apartment'
      : must.has('hotel')
        ? 'hotel'
        : 'any';
  try {
    const { lodgingBiasForPath } = await import('./researchPath');
    lodging = lodgingBiasForPath(researchPath, lodging);
    if (adaptiveBrief?.lodgingBias === 'apartment') lodging = 'apartment';
    if (adaptiveBrief?.lodgingBias === 'hotel' && lodging === 'any') lodging = 'hotel';
  } catch {
    /* soft */
  }

  let comboWindows: import('../types').ComboWindow[] = [];
  try {
    const flyPlace = sliced.find((p) => p.iata) || sliced[0];
    const skipCalendar =
      !searchFlightLive ||
      researchPath === 'route_tour' ||
      (researchPath === 'stay_first' && ecoAccess && !flyPlace?.iata);
    if (
      !skipCalendar &&
      flyPlace?.iata &&
      (ledger.mode?.value === 'fly' || ledger.dateWindow || ledger.dateMonth || researchPath === 'flight_first')
    ) {
      emitStep({ stage: 'calendar', title: 'Kalender', detail: 'Beste Zeitfenster', progress: 0.42 });
      emitSpark({ kind: 'flight', emoji: '📅', label: 'Kalender', sub: flyPlace.name });
      const { findBestCalendarSlots } = await import('./travelpayoutsCalendar');
      const { rankCombos } = await import('./comboOptimizer');
      const { dealHuntRatio } = await import('./dealAnomaly');
      const { calendarSlotBudget } = await import('./researchPath');
      const maxSlots = calendarSlotBudget(researchPath, timedOut());
      const slots = await findBestCalendarSlots({
        ledger,
        fromIatas: originAirports(ledger).length ? originAirports(ledger) : ['HAM'],
        toIata: flyPlace.iata,
        maxSlots,
      });
      const cands: Array<{
        id: string;
        checkin: string;
        checkout: string;
        label: string;
        flightEur: number | null;
        stayEur: number | null;
        transferEur: number | null;
      }> = [];
      for (const slot of slots.slice(0, maxSlots)) {
        // Nach Deadline: keine weiteren Stay22-Calls — mit Flugfenstern weiter
        if (timedOut()) break;
        let stayEur: number | null = null;
        try {
          if (searchStayLive) {
            const live = await searchStay22HotelsInCity({
              city: flyPlace.name,
              checkin: slot.checkin,
              checkout: slot.checkout,
              adults,
              lodgingType: lodging,
              lat: flyPlace.lat,
              lng: flyPlace.lng,
              pageSize: 12,
              amenityHint: must.has('pool') || must.has('tennis') ? (must.has('tennis') ? 'tennis' : 'pool') : null,
            });
            stayEur = live.stays[0]?.priceTotal ?? null;
          }
        } catch {
          stayEur = null;
        }
        cands.push({
          id: slot.id,
          checkin: slot.checkin,
          checkout: slot.checkout,
          label: slot.label,
          flightEur: slot.priceEur != null ? slot.priceEur * adults : null,
          stayEur,
          transferEur: 15,
        });
      }
      comboWindows = rankCombos(cands, { dealRatio: dealHuntRatio(ledger) });
      finishStep('calendar', `${comboWindows.length} Fenster`);
      log.push({
        stage: '2c',
        detail: `Calendar-Kombi ${comboWindows.length} Fenster${comboWindows[0]?.dealHit ? ' · DEAL' : ''} · ${researchPath}`,
      });
      if (comboWindows[0]) {
        emitSpark({
          kind: comboWindows[0].dealHit ? 'deal' : 'flight',
          emoji: comboWindows[0].dealHit ? '🔥' : '📅',
          label: comboWindows[0].label || 'Zeitfenster',
          sub: comboWindows[0].dealHit ? 'Kalender-Deal' : flyPlace.name,
        });
      }
    } else if (skipCalendar) {
      log.push({ stage: '2c', detail: `Calendar übersprungen (${researchPath})` });
    }
  } catch (e) {
    log.push({ stage: '2c', detail: `Calendar soft-fail ${String(e).slice(0, 60)}` });
  }

  let windowCheckin = checkin;
  let windowCheckout = checkout;
  try {
    const { resolvePinnedTravelWindow } = await import('./hardPins');
    const pinnedWin = resolvePinnedTravelWindow(
      ledger,
      { checkin, checkout },
      comboWindows,
    );
    windowCheckin = pinnedWin.checkin;
    windowCheckout = pinnedWin.checkout;
    if (pinnedWin.checkin !== (comboWindows[0]?.checkin || checkin)) {
      log.push({
        stage: '2c',
        detail: `Hard-Pin Datum ${windowCheckin}→${windowCheckout} (Kalender-Deal verworfen)`,
      });
    }
  } catch {
    const bestWindow = comboWindows[0];
    windowCheckin = bestWindow?.checkin || checkin;
    windowCheckout = bestWindow?.checkout || checkout;
  }

  // Stay/Flug-Anreicherung — Wanduhr-Cap: fertige Orte behalten, Rest abbrechen
  const enrichBatch = sliced.slice(0, hardStop() ? Math.min(3, sliced.length) : sliced.length);
  const optionsAcc: ReiseOption[] = [];
  const options = await raceCap(
    (async () => {
      await Promise.all(
        enrichBatch.map(async (place) => {
          if (hardStop()) return;
          try {
            const o = await enrichOnePlace({
              place,
              ledger,
              origin,
              checkin: windowCheckin,
              checkout: windowCheckout,
              adults,
              lodging,
              overnight,
              must,
              proWhy: whyById.get(place.id),
              researchPath,
            });
            if (!hardStop()) optionsAcc.push(o);
          } catch {
            /* soft */
          }
        }),
      );
      return optionsAcc;
    })(),
    () => optionsAcc,
  );
  for (const o of options) {
    if (comboWindows.length) {
      try {
        const { isDateHardPinned, filterSlotsToHardPin } = await import('./hardPins');
        if (isDateHardPinned(ledger)) {
          const pinnedFirst = filterSlotsToHardPin(ledger, comboWindows);
          const baseFirst = [
            ...pinnedFirst.filter((w) => w.checkin.slice(0, 10) === windowCheckin.slice(0, 10)),
            ...pinnedFirst.filter((w) => w.checkin.slice(0, 10) !== windowCheckin.slice(0, 10)),
          ];
          o.comboWindows = baseFirst.length ? baseFirst : pinnedFirst;
        } else {
          o.comboWindows = comboWindows;
        }
      } catch {
        o.comboWindows = comboWindows;
      }
    }
  }
  if (hardStop()) {
    log.push({
      stage: '3-cap',
      detail: `HARD_CAP — Enrich gestoppt mit ${options.length}/${enrichBatch.length} Orten`,
    });
  }

  // Stay-Nachzug nur VOR Cap
  if (searchStayLive && !hardStop()) {
    const byId = new Map(options.map((o) => [o.id, o]));
    const needStay = sliced
      .map((place) => ({ place, opt: byId.get(place.id) }))
      .filter(({ opt }) => {
        if (!opt) return false;
        if (opt.stayPriceEur != null && opt.stayPriceEur > 0) return false;
        const pricedStay = (opt.stays ?? []).some(
          (s) => s.priceEur != null && s.priceEur > 0,
        );
        return !pricedStay;
      })
      .sort((a, b) => {
        const ia = a.place.iata ? 1 : 0;
        const ib = b.place.iata ? 1 : 0;
        if (ib !== ia) return ib - ia;
        return (b.opt!.matchScore ?? 0) - (a.opt!.matchScore ?? 0);
      })
      .slice(0, squeeze() ? 2 : 6);

    if (needStay.length) {
      emitStep({
        stage: 'stay',
        title: 'Unterkunftspreise',
        detail: `Live · ${needStay.length} Orte`,
        progress: 0.72,
      });
      emitSpark({
        kind: 'stay',
        emoji: '🏨',
        label: 'Stay-Preise nachziehen',
        sub: needStay.map((x) => x.place.name).slice(0, 3).join(' · '),
      });
      const filledAcc: ReiseOption[] = [];
      await raceCap(
        (async () => {
          await Promise.all(
            needStay.map(async ({ place }) => {
              if (hardStop()) return;
              try {
                const o = await enrichOnePlace({
                  place,
                  ledger,
                  origin,
                  checkin: windowCheckin,
                  checkout: windowCheckout,
                  adults,
                  lodging,
                  overnight,
                  must,
                  proWhy: whyById.get(place.id),
                  researchPath,
                  allowGroundedStay: true,
                });
                if (!hardStop()) filledAcc.push(o);
              } catch {
                /* soft */
              }
            }),
          );
          return filledAcc;
        })(),
        () => filledAcc,
      );
      for (const o of filledAcc) {
        if (comboWindows.length) o.comboWindows = comboWindows;
        byId.set(o.id, o);
      }
      options.length = 0;
      options.push(...sliced.map((p) => byId.get(p.id)!).filter(Boolean));
      const withStay = options.filter((o) => (o.stayPriceEur ?? 0) > 0).length;
      log.push({
        stage: '3s',
        detail: `Stay-Backfill ${withStay}/${options.length} mit Preis`,
      });
      finishStep('stay', `${withStay} mit Preis`);
    }
  }

  log.push({
    stage: '3',
    detail: `Live-Backend fertig: ${options.filter((o) => o.stayBookUrl || o.flightBookUrl).length}/${options.length} mit Buchungs-URL · Stay ${options.filter((o) => (o.stayPriceEur ?? 0) > 0).length}`,
  });

  finishStep('flights', 'Flug-Links');
  if (!options.some((o) => (o.stayPriceEur ?? 0) > 0)) {
    finishStep('stay', 'Unterkünfte live');
  }
  // Übersprungene Rail-Steps aus der ETA nehmen (nie aktiv = nicht in Restzeit)
  {
    const done = new Set(
      useReisebueroStore
        .getState()
        .trip.researchSteps.filter((s) => s.status === 'done')
        .map((s) => s.stage),
    );
    if (!done.has('calendar') && !done.has('flight_matrix')) {
      finishStep('calendar', 'kein Extra-Fenster');
    }
    if (!done.has('transfer') && !done.has('feeder')) {
      finishStep('transfer', 'Transfer mitgedacht');
    }
  }
  emitStep({ stage: 'compare', title: 'Vergleich', detail: 'Top-Optionen', progress: 0.85 });
  const ranked = uniquifyMatchScores(options);
  emitSpark({
    kind: 'compare',
    emoji: '⚖️',
    label: 'Vergleich läuft',
    sub: `${ranked.length} Kandidaten`,
  });
  for (const o of ranked.slice(0, 6)) {
    emitSpark({
      kind: 'compare',
      emoji: o.dealHit ? '🔥' : '⭐',
      label: o.placeName,
      sub:
        o.buyInEur != null
          ? `Buy-in €${o.buyInEur} · ${o.matchScore}%`
          : `${o.matchScore}% Match`,
      lat: o.lat,
      lng: o.lng,
      photoUrl: o.photoUrl,
    });
  }
  // Flug-Hints: Magazin-Beats/Buy-in aktualisieren (Pro erste Ausgabe; sonst Lite)
  const flyHintTargets = options
    .filter(
      (o) =>
        (o.transports ?? []).some((t) => t.kind === 'flight') ||
        Boolean(sliced.find((p) => p.id === o.id)?.iata),
    )
    .slice(0, usePro ? 4 : 4);
  if (
    searchFlightLive &&
    flyHintTargets.length &&
    !hardStop() &&
    (ledger.airportIata?.value || ledger.mode?.value === 'fly')
  ) {
    await raceCap(
      Promise.all(
        flyHintTargets.map(async (o) => {
          if (hardStop()) return;
          const place = sliced.find((p) => p.id === o.id);
          const toIata = place?.iata || o.transports?.find((t) => t.kind === 'flight')?.toIata;
          const originIata =
            ledger.airportIata?.value ||
            o.transports?.find((t) => t.kind === 'flight')?.fromIata ||
            null;
          if (!toIata || !originIata) return;
          try {
            const tip = await proFlightPriceHint({
              fromIata: originIata,
              toIata,
              destName: place?.name || o.placeName,
              dateKey: checkin,
              usePro,
            });
            if (tip.priceEur != null) {
              const { applyFlightPriceHintToOption } = await import('./composePlan');
              const patched = applyFlightPriceHintToOption(o, ledger, tip.priceEur, adults);
              Object.assign(o, patched);
            }
            if (tip.note) o.gaps.push(`Flug-Hinweis: ${tip.note}`);
          } catch {
            /* soft */
          }
        }),
      ),
      () => undefined,
    );
    log.push({
      stage: '3b',
      detail: `Flug-Hints(${usePro ? 'Pro' : 'Lite'}) ${flyHintTargets.length} → Magazin-Beats`,
    });
  }

  // Rank: Pro nur erste Auswahl
  const ranks = await runReisebueroProRankOptions({ ledger, options, usePro });
  for (const o of options) {
    const patch = ranks.get(o.id);
    if (!patch) continue;
    o.whyBlurb = patch.whyBlurb || o.whyBlurb;
    o.whyMatch = patch.whyMatch;
    o.matchScore = Math.max(0, Math.min(100, o.matchScore + Math.round(patch.boost * 3)));
  }
  log.push({
    stage: '4',
    detail: ranks.size
      ? `Rank(${usePro ? 'Pro' : 'Lite'}) ${ranks.size} Optionen`
      : 'Rank soft-fail — Score aus Live-Facts',
  });

  const scored = options.sort((a, b) => b.matchScore - a.matchScore || a.gaps.length - b.gaps.length);

  // Package-Score: Flug+Stay+Transfer+Must → Top-4 blend
  let packaged = scored;
  try {
    const { rankOptionsAsPackages } = await import('./packageScore');
    const { adaptiveScoreBoost } = await import('./adaptiveBrief');
    const { isOvernightOption } = await import('./qualityGates');
    packaged = rankOptionsAsPackages(scored, ledger, 8);
    if (adaptiveBrief) {
      for (const o of packaged) {
        const facts = o.facts ?? [];
        const mustRatio = facts.length
          ? facts.filter((f) => f.met).length / facts.length
          : 0.5;
        const boost = adaptiveScoreBoost(adaptiveBrief, {
          mustRatio,
          budgetOk:
            !hasUserBudget(ledger) ||
            (o.buyInEur != null &&
              ledger.budgetEur?.value != null &&
              o.buyInEur <= ledger.budgetEur.value),
          hasEcoAccess: (o.transports ?? []).some(
            (t) => t.kind === 'train' || t.kind === 'bus',
          ),
        });
        const overnightOpt = isOvernightOption(ledger, o);
        const incomplete = overnightOpt && o.buyInEur == null;
        o.matchScore = Math.max(
          35,
          Math.min(96, o.matchScore + (incomplete ? Math.min(0, boost) : boost)),
        );
      }
      packaged.sort((a, b) => b.matchScore - a.matchScore);
    }
    // Route-Tour stops an Optionen hängen
    if (routeTour) {
      const { routeTourStops } = await import('./routeTourInventory');
      const tourStops = routeTourStops(routeTour);
      for (const o of packaged) {
        const existing = o.stops ?? [];
        o.stops = [
          ...existing.filter((s) => s.kind === 'origin' || s.kind === 'stay'),
          ...tourStops.filter((s) => s.kind !== 'origin'),
        ];
        if (routeTour.activities.length) {
          o.decisionNotes = [
            ...(o.decisionNotes ?? []),
            `Route: ${routeTour.activities.slice(0, 3).join(' → ')}`,
          ];
        }
        if (routeTour.liveEnriched) {
          o.decisionNotes = [
            ...(o.decisionNotes ?? []),
            routeTour.trailNotes
              ? `Route-Inventar live · ${routeTour.trailNotes.slice(0, 100)}`
              : 'Route-Inventar live (Grounded/Hütten/Trail)',
          ];
        }
      }
    }
    // Stay-Inventory Why an passende Regionen — fill stay even if hardFit===0
    if (stayInventoryHits.length) {
      for (const o of packaged) {
        const regionHits = stayInventoryHits.filter(
          (h) =>
            h.regionName.toLowerCase() === o.placeName.toLowerCase() ||
            o.placeName.toLowerCase().includes(h.regionName.toLowerCase().slice(0, 5)),
        );
        const hit = regionHits
          .slice()
          .sort((a, b) => {
            if (b.hardFit !== a.hardFit) return b.hardFit - a.hardFit;
            return (a.stayPrice ?? 9e9) - (b.stayPrice ?? 9e9);
          })[0];
        if (!o.stayName && hit?.stayName) {
          o.decisionNotes = [
            ...(o.decisionNotes ?? []),
            hit.hardFit > 0
              ? `Stay-Inventar: ${hit.stayName} · ${hit.hardFit} Hard-Musts`
              : `Stay-Inventar: ${hit.stayName}`,
          ];
          o.stayName = hit.stayName;
          o.stayBookUrl = hit.bookUrl;
          o.stayPriceEur = hit.stayPrice;
        }
      }
    }
    log.push({
      stage: '4p',
      detail: `Package-Score Top ${Math.min(4, packaged.length)} · Archetype ${adaptiveBrief?.archetype ?? '?'}`,
    });
  } catch (e) {
    log.push({ stage: '4p', detail: `Package soft-fail ${String(e).slice(0, 60)}` });
  }

  const {
    runEndControls,
    applyGateScorePenalty,
  } = await import('./qualityGates');

  let working = [...packaged];
  let top: import('../types').ReiseOption[] = [];
  let shortlist: import('../types').ReiseOption[] = [];
  let cutReason = '';
  let gatePass = false;
  let gateSummary = '';
  const MAX_QA_ROUNDS = 2;

  for (let round = 0; round <= MAX_QA_ROUNDS; round += 1) {
    if (hardStop() && round > 0) {
      log.push({ stage: '5q-cap', detail: 'HARD_CAP — QA-Nachzug übersprungen' });
      break;
    }
    const picked = pickFromShortlist(
      working,
      ledger,
      (() => {
        try {
          const { targetOptionCount } = require('../optionPolicy') as typeof import('../optionPolicy');
          return targetOptionCount(ledger);
        } catch {
          return 4;
        }
      })(),
    );
    top = picked.finalists;
    shortlist = picked.shortlist;
    cutReason = picked.cutReason;

    if (round === 0) {
      emitSpark({
        kind: 'vibe',
        emoji: '💸',
        label: 'Budget-Check',
        sub: `${shortlist.length} durchgerechnet`,
      });
      for (const o of shortlist.slice(0, 8)) {
        const pp = o.buyInEur ?? o.pricePerPerson;
        const utopian = (o.decisionNotes ?? []).some((n) => /utopisch/i.test(n));
        emitSpark({
          kind: 'compare',
          emoji: utopian ? '🚫' : '💶',
          label: o.placeName,
          sub: pp != null ? `€${Math.round(pp)} p.P.` : 'Preis live',
        });
      }
      log.push({
        stage: '5',
        detail: `${cutReason} (${usePro ? 'Pro' : 'Lite'}+Live)`,
      });
    }

    if (!top.length) break;

    emitStep({
      stage: 'qa',
      title: 'Doppel-Check',
      detail: round === 0 ? 'Paket + Wünsche' : `Nachzieh-Runde ${round}`,
      progress: 0.9 + round * 0.02,
    });
    emitSpark({
      kind: 'vibe',
      emoji: '✅',
      label: round === 0 ? 'Kontrolle 1+2' : `Nochmals prüfen (${round})`,
      sub: 'Komplett? Wunschfit?',
    });

    const report = runEndControls(top, ledger, Math.min(2, top.length));
    gatePass = report.pass;
    gateSummary = report.summary;
    log.push({ stage: `5q${round}`, detail: report.summary });
    emitSpark({
      kind: 'vibe',
      emoji: report.pass ? '🟢' : '🟡',
      label: report.pass ? 'Kontrolle ok' : 'Kontrolle: nachziehen',
      sub: `${report.passingIds.length}/${top.length} fit`,
    });

    // Nach 15-Min-Cap: sofort schließen — kein Enrich-Retry mehr
    if (hardStop() || report.pass || round >= MAX_QA_ROUNDS || timedOut()) {
      if (report.passingIds.length) {
        const passSet = new Set(report.passingIds);
        top = [
          ...top.filter((o) => passSet.has(o.id)),
          ...top.filter((o) => !passSet.has(o.id)),
        ].slice(0, 4);
      }
      if (hardStop() || timedOut()) {
        log.push({ stage: '5q-cap', detail: 'HARD_CAP 15 Min — mit aktuellem Stand schließen' });
      }
      break;
    }

    pivotStep('qa', report.summary);
    working = working.map((o) => applyGateScorePenalty(o, report));

    // Nachziehen: schwache Finalisten neu anreichern + nächste Kandidaten aus dem Pool
    const failIds = new Set(report.failingIds);
    const flyMode = ledger.mode?.value === 'fly';
    const preferFlyCapable = (p: SeedPlace) => !flyMode || Boolean(p.iata);
    const retryPlaces = [
      ...sliced.filter((p) => failIds.has(p.id) && preferFlyCapable(p)),
      ...sliced.filter((p) => failIds.has(p.id)),
      ...sliced.filter((p) => !top.some((t) => t.id === p.id) && preferFlyCapable(p)),
      ...sliced.filter((p) => !top.some((t) => t.id === p.id)),
    ]
      .filter((p, i, arr) => arr.findIndex((x) => x.id === p.id) === i)
      .slice(0, squeeze() ? 2 : 3);

    if (!retryPlaces.length) break;

    emitSpark({
      kind: 'vibe',
      emoji: '🔄',
      label: 'Noch mal ran',
      sub: retryPlaces.map((p) => p.name).slice(0, 3).join(' · '),
    });

    const refreshedAcc: ReiseOption[] = [];
    await raceCap(
      (async () => {
        await Promise.all(
          retryPlaces.map(async (place) => {
            if (hardStop()) return;
            try {
              const o = await enrichOnePlace({
                place,
                ledger,
                origin,
                checkin: windowCheckin,
                checkout: windowCheckout,
                adults,
                lodging: must.has('pool') || researchPath === 'stay_first' ? 'apartment' : lodging,
                overnight,
                must,
                proWhy: whyById.get(place.id),
                researchPath,
                allowGroundedStay: true,
              });
              if (!hardStop()) refreshedAcc.push(o);
            } catch {
              /* soft */
            }
          }),
        );
        return refreshedAcc;
      })(),
      () => refreshedAcc,
    );
    const refreshed = refreshedAcc;
    if (comboWindows.length) {
      for (const o of refreshed) o.comboWindows = comboWindows;
    }

    const byId = new Map(working.map((o) => [o.id, o]));
    for (const o of refreshed) byId.set(o.id, o);
    working = [...byId.values()].sort(
      (a, b) => b.matchScore - a.matchScore || a.gaps.length - b.gaps.length,
    );
  }

  emitSpark({
    kind: 'vibe',
    emoji: '🏆',
    label: `Final ${top.length}`,
    sub: gatePass ? 'Kontrolle grün' : gateSummary.slice(0, 40) || 'best effort',
  });
  if (!top.length) {
    try {
      const { stopResearchProgress } = await import('./progressController');
      stopResearchProgress({ complete: false });
    } catch {
      /* soft */
    }
    store.setSearching(false, 'Keine belegten Treffer im Trichter — Brief lockern oder Korridor ändern.');
    try {
      const { endReiseResearchLifecycle } = await import('./researchLifecycle');
      await endReiseResearchLifecycle({ ok: false, optionCount: 0 });
    } catch {
      /* soft */
    }
    return;
  }
  try {
    await runAiInclusivesCheck({ options: top, ledger, usePro: false });
  } catch {
    /* soft */
  }
  finishStep('compare', top.length + ' Optionen');
  emitStep({
    stage: 'package_pick',
    title: '2–4 Pakete',
    detail: `${top.length} wasserfeste Optionen`,
    progress: 0.95,
  });
  finishStep('qa', gatePass ? 'Beide Kontrollen ok' : 'Best effort nach Nachziehen');
  finishStep('package_pick', `${top.length} Pakete bereit`);
  try {
    const { stopResearchProgress } = await import('./progressController');
    stopResearchProgress({ complete: true });
  } catch {
    /* soft */
  }
  for (const o of top) {
    emitSpark({
      kind: 'compare',
      emoji: '🎯',
      label: o.placeName,
      sub: 'Finalist',
    });
  }
  try {
    const { deepEnrichMagazineFinalists } = await import('./magazineEnsure');
    const { applyFlightPriceHintToOption } = await import('./composePlan');
    const { enrichOptionAsPackage } = await import('./enrichOptionAsPackage');
    const enriched = await deepEnrichMagazineFinalists(top, ledger);
    for (let i = 0; i < enriched.length; i++) {
      let next = enriched[i]!;
      // Flugpreis-Hints erneut in Magazin-Beats spiegeln (nach Deep-Enrich)
      if (next.flightPriceEur != null && next.flightPriceEur > 0) {
        next = applyFlightPriceHintToOption(next, ledger, next.flightPriceEur, adults);
      }
      next = enrichOptionAsPackage(next, ledger);
      top[i] = next;
    }
  } catch {
    try {
      const { enrichOptionMagazine, applyFlightPriceHintToOption } = await import('./composePlan');
      const { enrichOptionAsPackage } = await import('./enrichOptionAsPackage');
      for (let i = 0; i < top.length; i++) {
        let o = enrichOptionMagazine(top[i]!, ledger);
        if (o.flightPriceEur != null && o.flightPriceEur > 0) {
          o = applyFlightPriceHintToOption(o, ledger, o.flightPriceEur, adults);
        }
        o = enrichOptionAsPackage(o, ledger);
        top[i] = o;
      }
    } catch {
      /* soft */
    }
  }
  // Wetter/Temp für Magazin nachziehen (Deep-Enrich kann Felder verlieren)
  try {
    const { fetchDestinationTripWeather } = await import('./destinationTripWeather');
    await Promise.all(
      top.map(async (o, i) => {
        if (o.weatherLine) return;
        const wx = await fetchDestinationTripWeather({
          lat: o.lat,
          lng: o.lng,
          dateStart: ledger.dateStart?.value,
          dateEnd: ledger.dateEnd?.value,
        });
        if (!wx?.line) return;
        top[i] = {
          ...o,
          weatherLine: wx.line,
          weatherTempHighC: wx.highC,
          weatherTempLowC: wx.lowC,
          weatherKind: wx.kind,
          facts: [
            ...(o.facts ?? []).filter((f) => f.id !== 'weather'),
            {
              id: 'weather',
              emoji: wx.emoji || '🌡️',
              label: `${wx.lowC === wx.highC ? `${wx.highC}°` : `${wx.lowC}–${wx.highC}°`} · ${wx.condition}${
                wx.kind === 'typical' ? ' (typisch)' : ''
              }`,
              met: true,
            },
          ].slice(0, 8),
        };
      }),
    );
  } catch {
    /* soft */
  }
  const speech = speechTopTwoSummary(top);
  store.appendDecision('result', speech);
  if (gateSummary) store.appendDecision('qa', gateSummary);
  let policySlice = top;
  try {
    const { targetOptionCount } = await import('../optionPolicy');
    const { finalizeMagazineOptions } = await import('../magazineOptionPolicy');
    // Falls pick noch hart auf 4 lief: Ziel aus Brief (offen 4 / spez 2)
    const want = targetOptionCount(ledger);
    if (top.length > want) {
      policySlice = top.slice(0, want);
    }
    policySlice = finalizeMagazineOptions(policySlice, ledger, shortlist);
  } catch {
    try {
      const { expandFlightWindowOptions } = await import('../flightWindowVariants');
      policySlice = expandFlightWindowOptions(top, ledger);
    } catch {
      policySlice = top;
    }
    try {
      const { expandLodgingTrackOptions } = await import('../magazineOptionKind');
      policySlice = expandLodgingTrackOptions(policySlice, ledger);
    } catch {
      /* soft */
    }
    try {
      const { sliceOptionsToPolicy } = await import('../optionPolicy');
      policySlice = sliceOptionsToPolicy(policySlice, ledger);
    } catch {
      policySlice = policySlice.slice(0, 4);
    }
  }
  // Magazin: weekdayLabels + Map-Pins vorbereiten
  try {
    const { ensureDayWeekdayLabels } = await import('../magazineMapPins');
    policySlice = policySlice.map((o) => ({
      ...o,
      days: ensureDayWeekdayLabels(o.days ?? []),
    }));
  } catch {
    /* soft */
  }
  const finalOpts = uniquifyMatchScores(policySlice);
  store.setOptions(finalOpts, log);
  try {
    const { endReiseResearchLifecycle } = await import('./researchLifecycle');
    await endReiseResearchLifecycle({ ok: finalOpts.length > 0, optionCount: finalOpts.length });
  } catch {
    /* soft */
  }
  // Favorit öffnet automatisch (resultsCover); Alternativen über „Alle Optionen“.
}

