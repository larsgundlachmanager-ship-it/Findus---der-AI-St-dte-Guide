/**
 * Founder weekly report — P&L + source defaults.
 * Override via env; never commit real credentials.
 */

export const PLAY_PACKAGE =
  process.env.PLAY_PACKAGE?.trim() || 'de.findus.app';

/** Google Play report GCS bucket (Play Console → Download reports → Financial). */
export const PLAY_REPORTS_BUCKET =
  process.env.PLAY_REPORTS_BUCKET?.trim() || '';

/**
 * Path to service-account JSON with storage.objects.get/list on the Play bucket.
 * Also accepts GOOGLE_APPLICATION_CREDENTIALS.
 */
export const PLAY_SERVICE_ACCOUNT_PATH =
  process.env.PLAY_SERVICE_ACCOUNT_JSON?.trim() ||
  process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim() ||
  '';

/** Play service fee on buyer price (standard 15 %; configure 0.30 for legacy). */
export const PLAY_FEE_RATE = numEnv('PLAY_FEE_RATE', 0.15);

/**
 * VAT / USt on net after Play fee.
 * Kleinunternehmer → set PLAY_VAT_RATE=0
 */
export const PLAY_VAT_RATE = numEnv('PLAY_VAT_RATE', 0.19);

/**
 * Manual weekly API cost override (€). If set, skips rate-based estimate.
 * Example: WEEKLY_API_COST_EUR=12.50
 */
export const WEEKLY_API_COST_EUR = optionalNum('WEEKLY_API_COST_EUR');

/** Same rates as src/services/diagnostics/apiCostLedger.ts */
export const API_RATES = {
  geminiInPerM: 0.1,
  geminiOutPerM: 0.4,
  mapsPerCall: 0.008,
  ttsPer1kChars: 0.065,
};

/** Optional usage counts for Phase-1 estimate (fleet not in cloud yet). */
export const WEEKLY_USAGE_ESTIMATE = {
  geminiCharsIn: intEnv('WEEKLY_GEMINI_CHARS_IN', 0),
  geminiCharsOut: intEnv('WEEKLY_GEMINI_CHARS_OUT', 0),
  mapsCalls: intEnv('WEEKLY_MAPS_CALLS', 0),
  ttsChars: intEnv('WEEKLY_TTS_CHARS', 0),
};

export const LOOKBACK_DAYS = intEnv('FOUNDER_REPORT_DAYS', 7);

export const PLAY_CONSOLE_FINANCIAL_URL =
  'https://play.google.com/console/u/0/developers/downloadReports';

export const AFFILIATE_PROGRAMS = [
  {
    id: 'expedia',
    label: 'Expedia / Partnerize (Unterkunft)',
    moment: 'hotel_night',
    dashboardHint: 'Partnerize → Findus Camref',
  },
  {
    id: 'stay22',
    label: 'Stay22 (Unterkunft Backup)',
    moment: 'hotel_night',
    dashboardHint: 'Stay22 dashboard',
  },
  {
    id: 'gyg',
    label: 'GetYourGuide (Touren)',
    moment: 'plan_gap_tour',
    dashboardHint: 'GYG Partner ID',
  },
  {
    id: 'tiqets',
    label: 'Tiqets / AWIN (Tickets)',
    moment: 'evening_free',
    dashboardHint: 'AWIN → Tiqets',
  },
  {
    id: 'discovercars',
    label: 'DiscoverCars (Mietwagen)',
    moment: 'roadtrip_car',
    dashboardHint: 'DiscoverCars affiliate',
  },
  {
    id: 'bounce',
    label: 'Bounce (Gepäck)',
    moment: 'pre_flight_luggage',
    dashboardHint: 'Bounce partner link',
  },
  {
    id: 'airalo',
    label: 'Airalo / Travelpayouts (eSIM)',
    moment: 'abroad_esim',
    dashboardHint: 'Travelpayouts marker',
  },
  {
    id: 'travelsecure',
    label: 'TravelSecure / AWIN',
    moment: 'travel_insurance',
    dashboardHint: 'AWIN → TravelSecure',
  },
];

function numEnv(key, fallback) {
  const raw = process.env[key];
  if (raw == null || raw === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function optionalNum(key) {
  const raw = process.env[key];
  if (raw == null || raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function intEnv(key, fallback) {
  return Math.max(0, Math.floor(numEnv(key, fallback)));
}

export function estimateApiCostEur() {
  if (WEEKLY_API_COST_EUR != null) {
    return {
      totalEur: WEEKLY_API_COST_EUR,
      source: 'WEEKLY_API_COST_EUR override',
      breakdown: {
        geminiEur: null,
        mapsEur: null,
        ttsEur: null,
      },
    };
  }
  const u = WEEKLY_USAGE_ESTIMATE;
  const geminiEur =
    (u.geminiCharsIn / 1e6) * API_RATES.geminiInPerM +
    (u.geminiCharsOut / 1e6) * API_RATES.geminiOutPerM;
  const mapsEur = u.mapsCalls * API_RATES.mapsPerCall;
  const ttsEur = (u.ttsChars / 1000) * API_RATES.ttsPer1kChars;
  const totalEur = geminiEur + mapsEur + ttsEur;
  return {
    totalEur,
    source:
      totalEur > 0
        ? 'usage env counts × ledger rates'
        : 'no usage env set — 0 € (set WEEKLY_API_COST_EUR or WEEKLY_* counts)',
    breakdown: { geminiEur, mapsEur, ttsEur },
  };
}
