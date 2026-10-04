/**
 * Pauschal-Partner: CHECK24 · AIDU · Lidl · Magic Life — nur wenn der User
 * wirklich Pauschal/AI/Club will. Nie als leerer Compare-Link auf DIY-Reisen.
 */

import type { ReiseLedger } from '../types';

export type PackageCompareLink = {
  id: string;
  label: string;
  url: string;
};

function packageIntentBlob(ledger: ReiseLedger, placeName?: string | null): string {
  return [
    ledger.purpose?.value,
    ledger.extraWishes?.value,
    ledger.highlightWant?.value,
    ledger.meals?.value,
    ledger.partyGrain?.value,
    placeName,
    ...(ledger.mustHaves?.value ?? []),
    ...(ledger.wishHaves?.value ?? []),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

/** Club-/AI-Kontext → Magic Life statt generischem Portal. */
export function wantsMagicLifeCompare(ledger: ReiseLedger, placeName?: string | null): boolean {
  const blob = packageIntentBlob(ledger, placeName);
  if (/\bmagic\s*life\b/.test(blob)) return true;
  if (ledger.meals?.value === 'all') return true;
  if (/\b(cluburlaub|club\s*all|all[\s-]?inclusive|ultra\s*all|alles\s+inklusive)\b/.test(blob)) {
    return true;
  }
  if (
    (ledger.mustHaves?.value ?? []).some((id) => id === 'all_inclusive' || id === 'club') ||
    (ledger.wishHaves?.value ?? []).some((id) => id === 'all_inclusive' || id === 'club')
  ) {
    return true;
  }
  return false;
}

/**
 * Pauschal-Buchungslink nur bei echtem Pauschal-/AI-/Club-Intent.
 * DIY (Apartment + Flug getrennt) → keine CHECK24-Leer-Suche.
 */
export function wantsPackageBookLinks(
  ledger: ReiseLedger,
  placeName?: string | null,
): boolean {
  if (wantsMagicLifeCompare(ledger, placeName)) return true;
  if (ledger.transferPref?.value === 'package') return true;
  const blob = packageIntentBlob(ledger, placeName);
  if (
    /\b(pauschal\w*|paketreise|fertigpaket|all[\s-]?inclusive|cluburlaub|club\s*all)\b/.test(blob)
  ) {
    return true;
  }
  if (
    (ledger.mustHaves?.value ?? []).some(
      (id) => id === 'all_inclusive' || id === 'club' || id === 'package',
    ) ||
    (ledger.wishHaves?.value ?? []).some(
      (id) => id === 'all_inclusive' || id === 'club' || id === 'package',
    )
  ) {
    return true;
  }
  return false;
}

/** Welche Pauschal-Partner in der Checklist (ohne URL-Build — Node-smokefähig). */
export function listPackageComparePartnerIds(
  ledger: ReiseLedger,
  placeName?: string | null,
): string[] {
  if (!wantsPackageBookLinks(ledger, placeName)) return [];
  // Ein Partner — Yorro hat „verglichen“, User bucht nicht drei Portale
  if (wantsMagicLifeCompare(ledger, placeName)) return ['pkg-magiclife'];
  return ['pkg-check24'];
}

/**
 * Pauschal-Partner-Links — nur bei Intent; sonst leere Liste.
 */
export function buildPackageCompareLinks(opts: {
  ledger: ReiseLedger;
  placeName: string;
  checkin: string;
  checkout: string;
  fromIata?: string | null;
  adults?: number | null;
}): PackageCompareLink[] {
  const adults = opts.adults ?? opts.ledger.adults?.value ?? 2;
  const fromIata = opts.fromIata || opts.ledger.airportIata?.value || null;
  const wanted = new Set(listPackageComparePartnerIds(opts.ledger, opts.placeName));
  const out: PackageCompareLink[] = [];
  if (!wanted.size) return out;

  if (wanted.has('pkg-check24') || wanted.has('pkg-aidu')) {
    try {
      const { buildCheck24PackageAction, getAbInDenUrlaubUrl } = require('../../services/affiliate/affiliateService') as {
        buildCheck24PackageAction: (o: {
          departureDate?: string | null;
          returnDate?: string | null;
          airport?: string | null;
          adults?: number | null;
          label?: string;
        }) => { payload: { url: string } };
        getAbInDenUrlaubUrl: (
          dest: string | null,
          marketHint: string,
          prefill: {
            dateMin?: string | null;
            dateMax?: string | null;
            airports?: string | null;
            adults?: number | null;
          },
        ) => string;
      };
      if (wanted.has('pkg-check24')) {
        const c24 = buildCheck24PackageAction({
          departureDate: opts.checkin,
          returnDate: opts.checkout,
          airport: fromIata,
          adults,
          label: 'Pauschal CHECK24',
        }).payload.url;
        if (c24) out.push({ id: 'pkg-check24', label: 'Pauschal CHECK24', url: c24 });
      }
      if (wanted.has('pkg-aidu')) {
        const aid = getAbInDenUrlaubUrl(null, opts.placeName || 'de', {
          dateMin: opts.checkin,
          dateMax: opts.checkout,
          airports: fromIata || undefined,
          adults,
        });
        if (aid) out.push({ id: 'pkg-aidu', label: 'Pauschal ab-in-den-urlaub', url: aid });
      }
    } catch {
      /* soft */
    }
  }

  if (wanted.has('pkg-lidl')) {
    try {
      const { getLidlReisenUrl } = require('../../services/affiliate/lidlReisenAffiliate') as {
        getLidlReisenUrl: (dest?: string | null, q?: string | null) => string;
      };
      const lidl = getLidlReisenUrl(null, opts.placeName || null);
      if (lidl) out.push({ id: 'pkg-lidl', label: 'Pauschal Lidl Reisen', url: lidl });
    } catch {
      /* soft */
    }
  }

  if (wanted.has('pkg-magiclife')) {
    try {
      const { getMagicLifeUrl } = require('../../services/affiliate/magicLifeAffiliate') as {
        getMagicLifeUrl: (dest?: string | null, q?: string | null) => string;
      };
      const ml = getMagicLifeUrl(null, opts.placeName || 'Club All Inclusive');
      if (ml) {
        out.push({
          id: 'pkg-magiclife',
          label: 'TUI Magic Life',
          url: ml,
        });
      }
    } catch {
      /* soft */
    }
  }

  return out;
}
