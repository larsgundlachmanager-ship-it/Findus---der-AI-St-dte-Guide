/**
 * OTA-/Reederei-Such-URLs + Search-Brief für Kreuzfahrt (shared M2 + Reisebüro).
 * Keine Fake-Preise — nur Links und strukturierte Query.
 * Affiliate: Lidl /kreuzfahrten (11773) · AIDA (9144) · CHECK24 Kreuzfahrt (9364).
 */

import type { ReiseLedger } from '../types';
import { isCruiseLedger } from './cruisePlan';

export type CruiseSearchBrief = {
  query: string;
  embarkBias: string | null;
  embarkPort: string | null;
  when: string | null;
  adults: number;
  children: number;
  cabinClass: string | null;
  fareBundle: string | null;
  seaDaysBias: string | null;
  amenities: string[];
  cheapest: boolean;
  regionHint: string | null;
};

export function buildCruiseSearchBrief(ledger: ReiseLedger): CruiseSearchBrief {
  const amenities = [
    ...(ledger.mustHaves?.value ?? []),
    ...(ledger.wishHaves?.value ?? []),
    ...(ledger.niceHaves?.value ?? []),
  ].filter((id) =>
    [
      'party',
      'pool',
      'spa',
      'sauna',
      'kids_club',
      'teens_club',
      'water_slide',
      'paddle_board',
      'culinary',
      'warm',
      'adult_only',
      'running_track',
      'seniors',
      'quiet',
    ].includes(id),
  );
  const when =
    ledger.dateStart?.value ||
    ledger.dateMonth?.value ||
    ledger.dateWindow?.value ||
    null;
  const cheapest =
    ledger.dealHunt?.value === true ||
    ledger.budgetVibe?.value === 'cheap' ||
    /günstigst|guenstigst|billigst/i.test(ledger.extraWishes?.value || '');
  const port =
    ledger.cruiseEmbarkPort?.value ||
    (ledger.cruiseEmbarkBias?.value === 'named_port'
      ? ledger.destinationHint?.value
      : null) ||
    null;
  const parts = [
    ledger.cruiseKind?.value === 'river' ? 'Flusskreuzfahrt' : 'Kreuzfahrt',
    ledger.cruiseShipName?.value && ledger.cruiseShipName.value !== 'open'
      ? ledger.cruiseShipName.value
      : ledger.cruiseLinePref?.value === 'aida'
        ? 'AIDA'
        : ledger.cruiseLinePref?.value === 'mein_schiff'
          ? 'Mein Schiff'
          : '',
    port ? `ab ${port}` : ledger.cruiseEmbarkBias?.value === 'near_home' ? 'ab Deutschland' : '',
    when || '',
    cheapest ? 'günstig' : '',
    ledger.cruiseCabinClass?.value === 'suite'
      ? 'Suite'
      : ledger.cruiseCabinClass?.value === 'balcony'
        ? 'Balkon'
        : '',
    ledger.cruiseFareBundle?.value === 'premium_ai' ||
    ledger.cruiseFareBundle?.value === 'drinks' ||
    ledger.meals?.value === 'all'
      ? 'All Inclusive Getränkepaket'
      : '',
    ledger.cruiseSeaDaysBias?.value === 'many_sea'
      ? 'viele Seetage'
      : ledger.cruiseSeaDaysBias?.value === 'many_ports'
        ? 'viele Häfen'
        : '',
    amenities.includes('party') ? 'Party' : '',
    amenities.includes('pool') ? 'Pool' : '',
    amenities.includes('water_slide') ? 'Wasserrutsche' : '',
    amenities.includes('running_track') ? 'Laufbahn' : '',
    amenities.includes('sauna') || amenities.includes('spa') ? 'Spa Sauna' : '',
    amenities.includes('kids_club') || amenities.includes('water_slide')
      ? 'Familie Kinder'
      : '',
    amenities.includes('teens_club') ? 'Teens' : '',
    amenities.includes('seniors') || amenities.includes('quiet') ? 'ruhig Senioren' : '',
    amenities.includes('culinary') ? 'kulinarisch' : '',
    amenities.includes('warm') ? 'warm' : '',
  ].filter(Boolean);

  return {
    query: parts.join(' '),
    embarkBias: ledger.cruiseEmbarkBias?.value ?? null,
    embarkPort: port,
    when,
    adults: Math.max(1, ledger.adults?.value ?? 2),
    children: ledger.children?.value ?? 0,
    cabinClass: ledger.cruiseCabinClass?.value ?? null,
    fareBundle: ledger.cruiseFareBundle?.value ?? null,
    seaDaysBias: ledger.cruiseSeaDaysBias?.value ?? null,
    amenities,
    cheapest,
    regionHint: ledger.corridor?.value || ledger.destinationHint?.value || null,
  };
}

function softQuery(brief: CruiseSearchBrief): string | null {
  const q = (brief.query || '').trim();
  return q.length >= 3 ? q : null;
}

export function buildCheck24CruiseSearchUrl(_brief: CruiseSearchBrief): string {
  const landing = 'https://kreuzfahrt.check24.de/';
  try {
    const { buildAwinClickUrl } = require('../../services/affiliate/awinClick') as {
      buildAwinClickUrl: (o: {
        merchantId: string;
        destinationUrl: string;
      }) => string;
    };
    return buildAwinClickUrl({
      merchantId: '9364',
      destinationUrl: landing,
    });
  } catch {
    return landing;
  }
}

export function buildCruise24SearchUrl(_brief: CruiseSearchBrief): string {
  return `https://www.cruise24.de/`;
}

export function buildGoogleCruiseSearchUrl(brief: CruiseSearchBrief): string {
  return `https://www.google.com/search?q=${encodeURIComponent(brief.query)}`;
}

/** AIDA — AWIN mid=9144 (Landing aida.de, Soft-q). */
export function buildAidaSearchUrl(brief: CruiseSearchBrief): string {
  try {
    const { getAidaUrl } = require('../../services/affiliate/aidaAffiliate') as {
      getAidaUrl: (d?: string | null, q?: string | null) => string;
    };
    return getAidaUrl(null, softQuery(brief));
  } catch {
    return 'https://www.aida.de/';
  }
}

/** Lidl Reisen Kreuzfahrt — AWIN mid=11773, Deep-Link /kreuzfahrten. */
export function buildLidlCruiseSearchUrl(brief: CruiseSearchBrief): string {
  try {
    const { getLidlReisenCruiseUrl } = require('../../services/affiliate/lidlReisenAffiliate') as {
      getLidlReisenCruiseUrl: (q?: string | null) => string;
    };
    return getLidlReisenCruiseUrl(softQuery(brief));
  } catch {
    return 'https://www.lidl-reisen.de/kreuzfahrten';
  }
}

export function buildMeinSchiffSearchUrl(brief: CruiseSearchBrief): string {
  const named = brief.query.match(/\bMein\s+Schiff\s+(?:Relax|[1-7])\b/i)?.[0];
  const q = encodeURIComponent(
    [named || 'Mein Schiff', brief.embarkPort ? `ab ${brief.embarkPort}` : '', brief.when || '']
      .filter(Boolean)
      .join(' ')
      .trim() || 'Kreuzfahrt',
  );
  return `https://www.meinschiff.com/de/suche?q=${q}`;
}

/** Primäre Buchungs-/Vergleichs-Links für Checklist (Affiliate zuerst). */
export function cruisePartnerSearchLinks(ledger: ReiseLedger): Array<{
  id: string;
  label: string;
  url: string;
}> {
  if (!isCruiseLedger(ledger)) return [];
  const brief = buildCruiseSearchBrief(ledger);
  const isRiver = ledger.cruiseKind?.value === 'river';

  const links: Array<{ id: string; label: string; url: string }> = [
    {
      id: 'lidl_cruise',
      label: 'Lidl Kreuzfahrt',
      url: buildLidlCruiseSearchUrl(brief),
    },
    {
      id: 'c24',
      label: 'CHECK24 Kreuzfahrt vergleichen',
      url: buildCheck24CruiseSearchUrl(brief),
    },
  ];

  // Hochsee: AIDA + Mein Schiff immer; Fluss: nur wenn nicht klar Fluss-only
  if (!isRiver) {
    links.push({
      id: 'aida',
      label: 'AIDA Kreuzfahrt',
      url: buildAidaSearchUrl(brief),
    });
    links.push({
      id: 'meinschiff',
      label: 'Mein Schiff Angebote',
      url: buildMeinSchiffSearchUrl(brief),
    });
  }
  if (brief.amenities.includes('kids_club') || brief.amenities.includes('water_slide')) {
    links.push({
      id: 'family',
      label: 'Familienkreuzfahrt suchen',
      url: buildGoogleCruiseSearchUrl({
        ...brief,
        query: `${brief.query} Familie Wasserrutsche Kids Club`,
      }),
    });
  }
  if (brief.amenities.includes('party')) {
    links.push({
      id: 'party',
      label: 'Party-Kreuzfahrt suchen',
      url: buildGoogleCruiseSearchUrl({
        ...brief,
        query: `${brief.query} Party Entertainment`,
      }),
    });
  }
  if (brief.amenities.includes('seniors') || brief.amenities.includes('quiet')) {
    links.push({
      id: 'seniors',
      label: 'Ruhige Kreuzfahrt suchen',
      url: buildGoogleCruiseSearchUrl({
        ...brief,
        query: `${brief.query} ruhig Wellness Senioren`,
      }),
    });
  }
  return links;
}

/** Modul-2 / Funnel: kurzer Speech-Rahmen (kein Skript, Kultur: weben). */
export function cruiseQuickPitchSkeleton(brief: CruiseSearchBrief): string {
  const head = brief.cheapest ? 'Günstigste passende Kreuzfahrten' : 'Passende Kreuzfahrten';
  const extras: string[] = [];
  if (brief.embarkPort) extras.push(`ab ${brief.embarkPort}`);
  else if (brief.embarkBias === 'near_home') extras.push('ab deutschen Häfen');
  if (brief.when) extras.push(brief.when);
  if (brief.amenities.length) {
    const labels = brief.amenities.slice(0, 4).map((a) => {
      if (a === 'water_slide') return 'Rutsche';
      if (a === 'kids_club') return 'Kids';
      if (a === 'teens_club') return 'Teens';
      if (a === 'running_track') return 'Laufbahn';
      if (a === 'seniors') return 'ruhiges Tempo';
      return a;
    });
    extras.push(labels.join(', '));
  }
  const line = extras.length ? `${head} ${extras.join(', ')}` : head;
  return `${line}. Preise und Einschiffzeiten nur belegt. Bei Bahn: Gepäckabgabe am Bahnhof und Shuttle zum Terminal mitdenken — Details in den Reederei-Infos. Links zum Vergleichen.`.slice(
    0,
    420,
  );
}
