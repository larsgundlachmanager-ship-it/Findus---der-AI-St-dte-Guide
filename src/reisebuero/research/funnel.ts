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

function originOf(ledger: ReiseLedger): { lat: number; lng: number; city: string } {
  return {
    lat: ledger.originLat?.value ?? 53.5511,
    lng: ledger.originLng?.value ?? 9.9937,
    city: ledger.originCity?.value || ledger.originCities?.value?.[0] || 'Hamburg',
  };
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
  // Parallel: Hotels + Apartments wenn offen — mehr Auswahl, Foto-first
  if (overnight) {
    try {
      const types: Array<'hotel' | 'apartment' | 'any'> =
        lodging === 'any'
          ? researchPath === 'stay_first'
            ? ['apartment', 'hotel']
            : ['hotel', 'apartment']
          : [lodging];
      const batches = await Promise.all(
        types.map((lt) =>
          searchStay22HotelsInCity({
            city: place.name,
            checkin,
            checkout,
            adults,
            lodgingType: lt,
            lat: anchorLat ?? place.lat,
            lng: anchorLng ?? place.lng,
            pageSize: researchPath === 'stay_first' ? 32 : 24,
            amenityHint,
          }),
        ),
      );
      const seen = new Set<string>();
      const merged = [];
      for (const live of batches) {
        for (const s of live.stays) {
          const key = s.id || s.name;
          if (seen.has(key)) continue;
          seen.add(key);
          merged.push(s);
        }
      }
      const live = { stays: merged };
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
        const withPool = ranked.filter((s) => /pool/i.test((s.amenities ?? []).join(' ')));
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
          bookUrl: pick.bookUrl,
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
        stayAmen = (raw?.amenities ?? []).join(' ');
        const amenHits = amenityHitsForStay(
          stayName || '',
          raw?.amenities ?? null,
          amenityMustSpecs,
        );
        amenHitsForWish = amenHits;
        gaps.push(...gapsFromAmenityHits(amenHits));
        mustBoost += hardMustScoreBoost(amenHits);
        if (must.has('pool') && !/pool/i.test(stayAmen) && !amenHits.some((h) => h.id === 'pool')) {
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
      flightUrl = buildKiwiTravelpayoutsUrl(
        buildKiwiSearchPageUrl({
          fromIata: originUsed,
          toIata: place.iata,
          dateKey: checkin,
        }),
        { subId: 'reisebuero' },
      );
    } catch {
      flightUrl = null;
    }
  } else if (ledger.mode?.value === 'fly' && place.iata && ledger.airportIata?.value) {
    originUsed = ledger.airportIata.value;
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
  const facts = buildFacts({ place, ledger, gaps, stayAmenities: stayAmen });
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

  const carUrl =
    ledger.rentalCar?.value === false
      ? null
      : ledger.mode?.value === 'drive' || ledger.mode?.value === 'daytrip' || ledger.rentalCar?.value
        ? getCarRentalUrl({
            pickupLocation: origin.city,
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
      });
    }
  } catch {
    /* soft */
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
    ledger.rentalCar?.value === true &&
    !(driveEur > 0) &&
    !camperPriced
  ) {
    driveEur = estimateRentalCarGroupEur(nightsForCar);
  }
  const carEur =
    camperPriced ||
    ledger.mode?.value === 'drive' ||
    ledger.mode?.value === 'camping' ||
    ledger.rentalCar?.value
      ? driveEur > 0
        ? driveEur
        : null
      : null;

  const { filterRealStays } = await import('./packagePartner');
  const { REAL_STAY_CHOICE_MAX } = await import('./composePlan');
  const realStayChoices = filterRealStays(stayChoices).slice(0, REAL_STAY_CHOICE_MAX);
  const primaryStay = realStayChoices[0];
  if (primaryStay && (!stayName || /check24|ab-in-den|pauschal/i.test(stayName))) {
    stayName = primaryStay.name;
    stayBookUrl = primaryStay.bookUrl;
    stayPrice = primaryStay.priceEur;
    stayPhoto = primaryStay.photoUrl;
    stayLat = primaryStay.lat ?? place.lat;
    stayLng = primaryStay.lng ?? place.lng;
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
  const buyRaw = buyInFromParts({
    flightPerPersonEur: flightPrice,
    stayEur: stayPrice,
    transferEur: overnight ? transferEur : null,
    carEur,
    extrasEur: null,
    adults,
  });
  // Unvollständiges Overnight-Paket (nur Flug o.ä.) nicht als Fixpreis verkaufen
  const buy = credible
    ? buyRaw
    : { buyInEur: null as number | null, buyInLabel: buyRaw.buyInLabel, totalPackage: buyRaw.totalPackage };
  if (overnight && !credible && stayPrice == null) {
    gaps.push('Unterkunftspreis fehlt — Buy-in noch nicht final');
  }
  const { userWantsProgramDays } = await import('./storyMagazine');
  const days = userWantsProgramDays(ledger)
    ? buildDayPlans({
        checkin,
        checkout,
        placeName: place.name,
        transport: transports[0] ?? null,
        stay: stayChoices[0] ?? null,
        transferEur: overnight ? transferEur : null,
        activities: ledger.mustActivities?.value ?? [],
      })
    : [];
  let packageBookUrl: string | null = null;
  let packageAidUrl: string | null = null;
  try {
    const { buildCheck24PackageAction, getAbInDenUrlaubUrl } = await import(
      '../../services/affiliate/affiliateService'
    );
    const { preferAffiliateIfSameOffer } = await import(
      '../../services/affiliate/preferAffiliateIfSameOffer'
    );
    const fromIata = originUsed || froms[0] || ledger.airportIata?.value || null;
    packageBookUrl = buildCheck24PackageAction({
      departureDate: checkin,
      returnDate: checkout,
      airport: fromIata,
      adults,
      label: 'Pauschal CHECK24',
    }).payload.url;
    packageAidUrl = getAbInDenUrlaubUrl(null, 'de', {
      dateMin: checkin,
      dateMax: checkout,
      airports: fromIata || undefined,
      adults,
    });
    // Direkt-Stay-URL schlägt Affiliate, wenn nicht dasselbe Angebot
    if (stayBookUrl) {
      stayBookUrl = preferAffiliateIfSameOffer({
        affiliateUrl: packageBookUrl,
        directUrl: stayBookUrl,
        sameOffer: false,
      });
    }
  } catch {
    /* soft */
  }
  const checklist = buildBookingChecklist({
    transports,
    stays: realStayChoices,
    transferUrl,
    carUrl,
    packageBookUrl,
    packageUrls: [
      ...(packageBookUrl ? [{ label: 'Pauschal CHECK24', url: packageBookUrl }] : []),
      ...(packageAidUrl ? [{ label: 'Pauschal ab-in-den-urlaub', url: packageAidUrl }] : []),
    ],
  });

  const base: import('../types').ReiseOption = {
    id: place.id,
    title,
    placeName: place.name,
    lat: stayLat,
    lng: stayLng,
    totalEur: buy.totalPackage ?? total,
    budgetDeltaEur: budgetDeltaVsBuyIn(
      buy.buyInEur,
      budget,
      ledger.budgetScope?.value ?? 'per_person',
      buy.totalPackage ?? total,
    ) ?? budgetDelta,
    pricePerPerson: buy.buyInEur ?? (credible ? pp : null),
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
    photoUrl: stayPhoto || photo,
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
    extrasEur: null,
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
    });
  } else if (packageBookUrl || packageAidUrl) {
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
    wishEvidence = await harvestWishEvidence({
      lat: stayLat,
      lng: stayLng,
      placeName: place.name,
      stayPhotoUrl: stayPhoto || photo,
      stayAmenities: stayAmen,
      ledger,
      amenityHits: amenHitsForWish,
    });
  } catch {
    wishEvidence = [];
  }
  return enrichOptionMagazine(base, ledger, {
    transferMinutes: overnight ? transferMinutes : null,
    destPhotoUrl: photo,
    wishEvidence,
  });
}

export async function runReisebueroFunnel(): Promise<void> {
  const RESEARCH_DEADLINE_MS = 15 * 60_000;
  const started = Date.now();
  const deadline = started + RESEARCH_DEADLINE_MS;
  const timedOut = () => Date.now() >= deadline;

  const store = useReisebueroStore.getState();
  const { trip } = store;
  const ledger = trip.ledger;
  store.setSearching(true);
  seedResearchTheater();
  const log: FunnelLogLine[] = [];
  let researchPath: import('./researchPath').ResearchPathKind = 'flight_first';
  let ecoAccess = false;
  let adaptiveBrief: import('./adaptiveBrief').AdaptiveBrief | null = null;
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
    const { buildAdaptiveBrief } = await import('./adaptiveBrief');
    adaptiveBrief = buildAdaptiveBrief(ledger);
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
      detail: `Research-Pfad ${researchPath}${ecoAccess ? ' · eco/Bahn-priorisiert' : ''} · Archetype ${adaptiveBrief.archetype} — Regionen wählt Yorro`,
    });
    emitSpark({
      kind: 'vibe',
      emoji: researchPath === 'stay_first' ? '🏠' : researchPath === 'route_tour' ? '🥾' : '✈️',
      label:
        researchPath === 'stay_first'
          ? 'Stay-first'
          : researchPath === 'route_tour'
            ? 'Route-Tour'
            : 'Fenster-first',
      sub: ecoAccess ? 'umweltfreundlich' : adaptiveBrief.archetype,
    });
    for (const h of adaptiveBrief.briefHints.slice(0, 3)) {
      emitSpark({ kind: 'vibe', emoji: '🧭', label: h, sub: 'Brief' });
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
  } catch {
    /* soft */
  }
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
  emitStep({ stage: 'discover', title: 'Orte finden', detail: 'Kandidaten suchen', progress: 0.2 });
  emitSpark({ kind: 'vibe', emoji: '💎', label: 'Gem-Hunt', sub: 'Geheim · Exklusiv · Deals' });
  // Parallel: Discover + Gem-Hunt + Named-Geocode
  const [pro, gem, namedSeed] = await Promise.all([
    runReisebueroProDiscover(ledger, { usePro }),
    runGemHuntDiscover(ledger, { usePro: false }),
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
      });
    }
  }
  if (namedSeed) {
    log.push({ stage: '0c', detail: `Named dest ${namedSeed.name}` });
    emitSpark({
      kind: 'place',
      emoji: '📌',
      label: namedSeed.name,
      sub: 'dein Ziel',
    });
  }
  for (const d of pro.destinations.slice(0, 10)) {
    emitSpark({
      kind: 'place',
      emoji: placeSparkEmoji(d.tags || []),
      label: d.name,
      sub: d.whyFit?.slice(0, 36) || undefined,
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
    label: 'Events scannen',
    sub: ledger.dateWindow?.value || ledger.dateMonth?.value || 'im Zeitraum',
  });
  if (ledger.purpose?.value) {
    emitSpark({ kind: 'vibe', emoji: '🎉', label: ledger.purpose.value, sub: 'Reise-Hook' });
  }
  finishStep('events', 'Event-Hints notiert');
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

  pool = pool.filter((p) => !visited.some((n) => n.includes(p.name.toLowerCase()) || p.name.toLowerCase().includes(n)));
  log.push({ stage: '1c', detail: `Passport-Filter → ${pool.length}` });

  if (!pool.length) {
    pool = biasPoolForIntent(
      SEED_PLACES.filter((p) => tagMatch(p, ledger)).slice(0, 8),
      ledger,
    );
    log.push({ stage: '1d', detail: 'Fallback ohne Passport-Cut' });
  }

  const extras: SeedPlace[] = [];
  if (namedSeed) extras.push(namedSeed);
  extras.push(...proSeeds);
  if (inspirationPlaces.length) {
    extras.unshift(...inspirationPlaces.slice(0, 6));
    log.push({
      stage: '1insp',
      detail: `Inspiration-Places ${Math.min(6, inspirationPlaces.length)} in Shortlist-Pool`,
    });
  }

  // Stay-first: globales Amenity-Inventar vor Shortlist
  if (researchPath === 'stay_first' && needsNight(ledger) && !timedOut()) {
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

  const targetN = timedOut() ? 5 : researchPath === 'stay_first' ? 8 : 10;
  let merged = prioritizeSeedsByTaste(
    mergePlacePool(pool, extras, timedOut() ? 10 : 18),
    ledger,
  );
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
    detail: `Shortlist ${sliced.length}/${targetN} divers (Taste+Seed+Pro·${researchPath}) — parallele Stay22/Flug${timedOut() ? ' · TIMEOUT-TRIM' : ''}`,
  });
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
  finishStep('soft', 'Wünsche gesetzt');
  if (researchPath === 'stay_first' || researchPath === 'route_tour') {
    emitStep({ stage: 'stay', title: 'Unterkünfte zuerst', detail: 'Hard-Musts prüfen', progress: 0.48 });
    emitStep({ stage: 'flights', title: 'Zugang danach', detail: ecoAccess ? 'Bahn/Bus priorisiert' : 'Flug/Anreise', progress: 0.62 });
  } else {
    emitStep({ stage: 'flights', title: 'Günstige Flüge', detail: 'Multi-Start & Preise', progress: 0.5 });
    emitSpark({
      kind: 'flight',
      emoji: '✈️',
      label: 'Flüge vergleichen',
      sub: originAirports(ledger).slice(0, 3).join('/') || ledger.originCity?.value || 'ab Start',
    });
    emitStep({ stage: 'stay', title: 'Unterkünfte', detail: 'Live-Preise', progress: 0.55 });
  }
  for (const p of sliced.slice(0, 8)) {
    emitSpark({
      kind: 'place',
      emoji: placeSparkEmoji(p.tags),
      label: p.name,
      sub: p.iata ? `✈️ ${p.iata}` : 'vor Ort',
    });
  }

  const must = new Set(ledger.mustHaves?.value ?? []);
  const overnight = needsNight(ledger);
  const { checkin, checkout } = stayWindow(ledger);
  const adults = ledger.adults?.value ?? 2;
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
        if (timedOut()) break;
        let stayEur: number | null = null;
        try {
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

  const bestWindow = comboWindows[0];
  const windowCheckin = bestWindow?.checkin || checkin;
  const windowCheckout = bestWindow?.checkout || checkout;

  const options = await Promise.all(
    sliced.map((place) =>
      enrichOnePlace({
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
      }),
    ),
  );
  for (const o of options) {
    if (comboWindows.length) o.comboWindows = comboWindows;
  }

  log.push({
    stage: '3',
    detail: `Live-Backend fertig: ${options.filter((o) => o.stayBookUrl || o.flightBookUrl).length}/${options.length} mit Buchungs-URL`,
  });

  finishStep('flights', 'Flug-Links');
  finishStep('stay', 'Unterkünfte live');
  emitStep({ stage: 'compare', title: 'Vergleich', detail: 'Top-Optionen', progress: 0.85 });
  emitSpark({
    kind: 'compare',
    emoji: '⚖️',
    label: 'Vergleich läuft',
    sub: `${options.length} Kandidaten`,
  });
  for (const o of options.slice(0, 6)) {
    emitSpark({
      kind: 'compare',
      emoji: o.dealHit ? '🔥' : '⭐',
      label: o.placeName,
      sub:
        o.buyInEur != null
          ? `Buy-in €${o.buyInEur} · ${o.matchScore}%`
          : `${o.matchScore}% Match`,
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
  if (flyHintTargets.length && (ledger.airportIata?.value || ledger.mode?.value === 'fly')) {
    await Promise.all(
      flyHintTargets.map(async (o) => {
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
        o.matchScore = Math.max(42, Math.min(99, o.matchScore + boost));
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
    // Stay-Inventory Why an passende Regionen
    if (stayInventoryHits.length) {
      for (const o of packaged) {
        const hit = stayInventoryHits.find(
          (h) =>
            h.regionName.toLowerCase() === o.placeName.toLowerCase() ||
            o.placeName.toLowerCase().includes(h.regionName.toLowerCase().slice(0, 5)),
        );
        if (hit?.hardFit) {
          o.decisionNotes = [
            ...(o.decisionNotes ?? []),
            `Stay-Inventar: ${hit.stayName} · ${hit.hardFit} Hard-Musts`,
          ];
          if (!o.stayName && hit.stayName) {
            o.stayName = hit.stayName;
            o.stayBookUrl = hit.bookUrl;
            o.stayPriceEur = hit.stayPrice;
          }
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
    const picked = pickFromShortlist(working, ledger, 4);
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
          sub: pp != null ? `€${Math.round(pp)} p.P. · ${o.matchScore}%` : `${o.matchScore}%`,
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

    if (report.pass || round >= MAX_QA_ROUNDS || timedOut()) {
      // Prefer passing finalists first
      if (report.passingIds.length) {
        const passSet = new Set(report.passingIds);
        top = [
          ...top.filter((o) => passSet.has(o.id)),
          ...top.filter((o) => !passSet.has(o.id)),
        ].slice(0, 4);
      }
      break;
    }

    pivotStep('qa', report.summary);
    working = working.map((o) => applyGateScorePenalty(o, report));

    // Nachziehen: schwache Finalisten neu anreichern + nächste Kandidaten aus dem Pool
    const failIds = new Set(report.failingIds);
    const retryPlaces = [
      ...sliced.filter((p) => failIds.has(p.id)),
      ...sliced.filter((p) => !top.some((t) => t.id === p.id)),
    ].slice(0, timedOut() ? 2 : 4);

    if (!retryPlaces.length) break;

    emitSpark({
      kind: 'vibe',
      emoji: '🔄',
      label: 'Noch mal ran',
      sub: retryPlaces.map((p) => p.name).slice(0, 3).join(' · '),
    });

    const refreshed = await Promise.all(
      retryPlaces.map((place) =>
        enrichOnePlace({
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
        }),
      ),
    );
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
    store.setSearching(false, 'Keine belegten Treffer im Trichter — Brief lockern oder Korridor ändern.');
    return;
  }
  try {
    await runAiInclusivesCheck({ options: top, ledger, usePro: false });
  } catch {
    /* soft */
  }
  finishStep('compare', top.length + ' Optionen');
  finishStep('qa', gatePass ? 'Beide Kontrollen ok' : 'Best effort nach Nachziehen');
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
    const enriched = await deepEnrichMagazineFinalists(top, ledger);
    for (let i = 0; i < enriched.length; i++) {
      let next = enriched[i]!;
      // Flugpreis-Hints erneut in Magazin-Beats spiegeln (nach Deep-Enrich)
      if (next.flightPriceEur != null && next.flightPriceEur > 0) {
        next = applyFlightPriceHintToOption(next, ledger, next.flightPriceEur, adults);
      }
      top[i] = next;
    }
  } catch {
    try {
      const { enrichOptionMagazine, applyFlightPriceHintToOption } = await import('./composePlan');
      for (let i = 0; i < top.length; i++) {
        let o = enrichOptionMagazine(top[i]!, ledger);
        if (o.flightPriceEur != null && o.flightPriceEur > 0) {
          o = applyFlightPriceHintToOption(o, ledger, o.flightPriceEur, adults);
        }
        top[i] = o;
      }
    } catch {
      /* soft */
    }
  }
  const speech = speechTopTwoSummary(top);
  store.appendDecision('result', speech);
  if (gateSummary) store.appendDecision('qa', gateSummary);
  store.setOptions(top.slice(0, 4), log);
  // Results: max. 4 Covers via setOptions — Magazin + Option-Speech erst nach Tap
}

