import Constants from 'expo-constants';

type Extra = Record<string, string | undefined>;

function getExtra(): Extra {
  const extra =
    (Constants.expoConfig?.extra as Extra | undefined) ??
    ((Constants as { manifest?: { extra?: Extra } }).manifest?.extra as
      | Extra
      | undefined) ??
    {};
  return extra ?? {};
}

/**
 * Liest EXPO_PUBLIC_* aus process.env (Metro-Inline) mit Fallback auf
 * app.config.js → extra (Dev Client / Constants).
 */
export function getPublicEnv(key: string): string {
  const fromProcess = process.env[key];
  if (typeof fromProcess === 'string' && fromProcess.length > 0) {
    return fromProcess;
  }

  const fromExtra = getExtra()[key];
  if (typeof fromExtra === 'string' && fromExtra.length > 0) {
    return fromExtra;
  }

  return '';
}

export const env = {
  get: (key: string) => getPublicEnv(key),
  supabaseUrl: () => getPublicEnv('EXPO_PUBLIC_SUPABASE_URL'),
  supabaseAnonKey: () => getPublicEnv('EXPO_PUBLIC_SUPABASE_ANON_KEY'),
  /** Stadt-Pack im Bucket `staedte` (z. B. prisdorf → prisdorf.json) */
  cityId: () => getPublicEnv('EXPO_PUBLIC_CITY_ID') || 'prisdorf',
  openAiApiKey: () => getPublicEnv('EXPO_PUBLIC_OPENAI_API_KEY'),
  /** Cartesia sonic-3.5 TTS (primäre Stimme). */
  cartesiaApiKey: () => getPublicEnv('EXPO_PUBLIC_CARTESIA_API_KEY'),
  /**
   * Optional: Cartesia Pronunciation Dictionary ID (Playground).
   * Gilt request-weit für alle Stimmen.
   */
  cartesiaPronunciationDictId: () =>
    getPublicEnv('EXPO_PUBLIC_CARTESIA_PRONUNCIATION_DICT_ID').trim(),
  geminiApiKey: () =>
    getPublicEnv('EXPO_PUBLIC_GEMINI_API_KEY') ||
    getPublicEnv('EXPO_PUBLIC_GOOGLE_API_KEY'),
  /**
   * P0: Gemini + Cartesia über Supabase Edge Proxy (Keys nur serverseitig).
   * Setze EXPO_PUBLIC_USE_LLM_PROXY=1 und deploye gemini-proxy / cartesia-proxy.
   */
  useLlmProxy: () => {
    const v = getPublicEnv('EXPO_PUBLIC_USE_LLM_PROXY').toLowerCase();
    return v === '1' || v === 'true' || v === 'yes';
  },
  geminiProxyUrl: () => {
    const override = getPublicEnv('EXPO_PUBLIC_GEMINI_PROXY_URL').replace(
      /\/$/,
      '',
    );
    if (override) return override;
    const base = getPublicEnv('EXPO_PUBLIC_SUPABASE_URL').replace(/\/$/, '');
    return base ? `${base}/functions/v1/gemini-proxy` : '';
  },
  cartesiaProxyUrl: () => {
    const override = getPublicEnv('EXPO_PUBLIC_CARTESIA_PROXY_URL').replace(
      /\/$/,
      '',
    );
    if (override) return override;
    const base = getPublicEnv('EXPO_PUBLIC_SUPABASE_URL').replace(/\/$/, '');
    return base ? `${base}/functions/v1/cartesia-proxy` : '';
  },
  /**
   * OSRM Directions Base (`…/route/v1`).
   * Prod: eigene Yorro-OSRM-URL via EXPO_PUBLIC_OSRM_BASE setzen.
   * Leer → FOSSGIS Fuß-Routing (googleMapsNav wählt foot/bike).
   * Nie project-osrm.org für Fuß/Rad — dort nur Auto-Graph.
   */
  osrmBaseUrl: () =>
    getPublicEnv('EXPO_PUBLIC_OSRM_BASE').replace(/\/$/, '') ||
    'https://routing.openstreetmap.de/routed-foot/route/v1',
  /**
   * Hands-Free Reboot: Google-first routing retired.
   * Always OSRM primary; Google Directions only as emergency fallback inside fetchRouteDirectionsResult.
   */
  preferGoogleRouting: () => false,
  usingPublicOsrm: () => !getPublicEnv('EXPO_PUBLIC_OSRM_BASE').trim(),
  localModelPath: () => getPublicEnv('EXPO_PUBLIC_LOCAL_MODEL_PATH'),
  /** Optional: Basis-URL für Dictionary-Cloud-Sync (`…/api/dictionary` oder Storage). */
  dictionaryApiUrl: () => getPublicEnv('EXPO_PUBLIC_DICTIONARY_API_URL'),
  /** Optional Sentry DSN — Crashes + Latenz-Breadcrumbs. */
  sentryDsn: () => getPublicEnv('EXPO_PUBLIC_SENTRY_DSN'),

  // --- Reservierung (3-Tier) — Keys in .env eintragen ---
  /** Backend-Endpoint für strukturierte Reservierungs-Mails (Resend/SendGrid-Proxy). */
  reservationEmailEndpoint: () =>
    getPublicEnv('EXPO_PUBLIC_RESERVATION_EMAIL_ENDPOINT'),
  /** Webhook, der Vapi/Bland-Anruf startet (empfohlen statt Keys in der App). */
  reservationAiCallWebhook: () =>
    getPublicEnv('EXPO_PUBLIC_RESERVATION_AI_CALL_WEBHOOK'),
  vapiApiKey: () => getPublicEnv('EXPO_PUBLIC_VAPI_API_KEY'),
  vapiAssistantId: () => getPublicEnv('EXPO_PUBLIC_VAPI_ASSISTANT_ID'),
  blandApiKey: () => getPublicEnv('EXPO_PUBLIC_BLAND_API_KEY'),
  openTableAffiliateId: () =>
    getPublicEnv('EXPO_PUBLIC_OPENTABLE_AFFILIATE_ID'),
  quandooPartnerId: () => getPublicEnv('EXPO_PUBLIC_QUANDOO_PARTNER_ID'),
  /** Airalo eSIM Affiliate — ohne Key: keine BOOK_ESIM-Buttons. */
  airaloAffiliateId: () => getPublicEnv('EXPO_PUBLIC_AIRALO_AFFILIATE_ID'),
  /** GetYourGuide Partner-ID (Default ZVQGONB). */
  gygPartnerId: () =>
    getPublicEnv('EXPO_PUBLIC_GYG_PARTNER_ID') || 'ZVQGONB',
  /** Musement / TUI Affiliate-ID (Default findus-8445). */
  musementAffiliateId: () =>
    getPublicEnv('EXPO_PUBLIC_MUSEMENT_AFFILIATE_ID') || 'findus-8445',
  /** Uber Client-ID für Deep Links. */
  uberClientId: () =>
    getPublicEnv('EXPO_PUBLIC_UBER_CLIENT_ID') ||
    '4a6yecXWLriTzMd4uqp41cVz2dDdlpSB',
  /** Viator (TripAdvisor) Partner-ID. */
  viatorPartnerId: () =>
    getPublicEnv('EXPO_PUBLIC_VIATOR_PARTNER_ID') || 'P00311883',
  /** Viator Media Campaign ID. */
  viatorMcid: () => getPublicEnv('EXPO_PUBLIC_VIATOR_MCID') || '42383',
  /** Economy Bookings Mietwagen-Referral-URL. */
  economyBookingsReferralUrl: () =>
    getPublicEnv('EXPO_PUBLIC_ECONOMY_BOOKINGS_REFERRAL_URL') ||
    'https://www.economybookings.com/de/referral/16yupj/l0j2ln',
  /** DiscoverCars Mietwagen Affiliate (Primär für BOOK_CAR_RENTAL). */
  discoverCarsAffiliateUrl: () =>
    getPublicEnv('EXPO_PUBLIC_DISCOVER_CARS_AFFILIATE_URL') ||
    'https://www.discovercars.com/?a_aid=Yorro-Ai',
  /** Expedia Partnerize camref (Affiliate). */
  expediaCamref: () =>
    getPublicEnv('EXPO_PUBLIC_EXPEDIA_CAMREF') || '1101l5Qcvp',
  /** Expedia Partnerize creativeref (Werbemittel). */
  expediaCreativeref: () =>
    getPublicEnv('EXPO_PUBLIC_EXPEDIA_CREATIVEREF') || '1100l86803',
  /** Expedia affiliate siteid (meist 1). */
  expediaSiteId: () =>
    getPublicEnv('EXPO_PUBLIC_EXPEDIA_SITE_ID') || '20',
  /** Optional: Expedia adref aus Link-Builder. */
  expediaAdref: () => getPublicEnv('EXPO_PUBLIC_EXPEDIA_ADREF') || '',
  /** AWIN Publisher-ID (Yorro). */
  awinPublisherId: () =>
    getPublicEnv('EXPO_PUBLIC_AWIN_PUBLISHER_ID') || '3021215',
  /** TravelSecure AWIN Tracking-URL (optional Override). */
  travelSecureAffiliateUrl: () =>
    getPublicEnv('EXPO_PUBLIC_TRAVELSECURE_AFFILIATE_URL'),
  /** travSIM AWIN Tracking-URL (optional Override). */
  travSimAffiliateUrl: () =>
    getPublicEnv('EXPO_PUBLIC_TRAVSIM_AFFILIATE_URL'),
  /** Tiqets AWIN Merchant-ID (Default 12428). */
  tiqetsAwinMid: () =>
    getPublicEnv('EXPO_PUBLIC_TIQETS_AWIN_MID') || '12428',
  /** Tiqets AWIN Tracking-URL (optional volle Override). */
  tiqetsAffiliateUrl: () =>
    getPublicEnv('EXPO_PUBLIC_TIQETS_AFFILIATE_URL'),
  /** Konfetti / gokonfetti AWIN Merchant-ID (Default 31804). */
  konfettiAwinMid: () =>
    getPublicEnv('EXPO_PUBLIC_KONFETTI_AWIN_MID') || '31804',
  /** Konfetti AWIN Tracking-URL (optional volle Override). */
  konfettiAffiliateUrl: () =>
    getPublicEnv('EXPO_PUBLIC_KONFETTI_AFFILIATE_URL'),
  reservixAwinMid: () =>
    getPublicEnv('EXPO_PUBLIC_RESERVIX_AWIN_MID') || '31293',
  reservixAffiliateUrl: () =>
    getPublicEnv('EXPO_PUBLIC_RESERVIX_AFFILIATE_URL'),
  /** camping.info AWIN Tracking-URL (optional Override). */
  campingInfoAffiliateUrl: () =>
    getPublicEnv('EXPO_PUBLIC_CAMPING_INFO_AFFILIATE_URL'),
  /** Solmar DE AWIN Tracking-URL (optional Override). */
  solmarAffiliateUrl: () =>
    getPublicEnv('EXPO_PUBLIC_SOLMAR_AFFILIATE_URL'),
  check24PackageAffiliateUrl: () =>
    getPublicEnv('EXPO_PUBLIC_CHECK24_PACKAGE_AFFILIATE_URL'),
  check24CarAffiliateUrl: () =>
    getPublicEnv('EXPO_PUBLIC_CHECK24_CAR_AFFILIATE_URL'),
  /** ab-in-den-urlaub DE AWIN Tracking-URL (optional Override). */
  abInDenUrlaubAffiliateUrl: () =>
    getPublicEnv('EXPO_PUBLIC_AB_IN_DEN_URLAUB_AFFILIATE_URL'),
  /** weg.de DE AWIN Tracking-URL (optional Override). */
  wegDeAffiliateUrl: () =>
    getPublicEnv('EXPO_PUBLIC_WEG_DE_AFFILIATE_URL'),
  /** Bounce Gepäckaufbewahrung Affiliate-URL. */
  bounceLuggageUrl: () =>
    getPublicEnv('EXPO_PUBLIC_BOUNCE_LUGGAGE_URL') ||
    'https://go.bounce.com/FINDUS64751223710664',
  /** Stay22 Affiliate-ID (Unterkünfte). */
  stay22AffiliateId: () =>
    getPublicEnv('EXPO_PUBLIC_STAY22_AFFILIATE_ID') || 'findus',
  /** Stay22 Direct Travel API key (optional — demo mode without key, rate-limited). */
  stay22ApiKey: () => getPublicEnv('EXPO_PUBLIC_STAY22_API_KEY') || '',
  /** Travelpayouts Partner-Marker (Default 760293). */
  travelpayoutsMarker: () =>
    getPublicEnv('EXPO_PUBLIC_TRAVELPAYOUTS_MARKER') || '760293',
  /**
   * Google Maps Platform (Directions / Places / Street View) für
   * freihändige Landmarken-Navigation. Optional.
   */
  googleMapsApiKey: () =>
    getPublicEnv('EXPO_PUBLIC_GOOGLE_MAPS_API_KEY') ||
    getPublicEnv('EXPO_PUBLIC_GOOGLE_API_KEY') ||
    // Dev: auch non-EXPO Key aus .env (Metro lädt GOOGLE_MAPS_API_KEY)
    (typeof process !== 'undefined'
      ? String(process.env.GOOGLE_MAPS_API_KEY ?? '').trim()
      : ''),
  /** OpenWeather One Call — auch non-EXPO Fallback. */
  openWeatherApiKey: () =>
    getPublicEnv('EXPO_PUBLIC_OPENWEATHER_API_KEY') ||
    (typeof process !== 'undefined'
      ? String(
          process.env.OPENWEATHER_API_KEY ??
            process.env.EXPO_PUBLIC_OPENWEATHER_API_KEY ??
            '',
        ).trim()
      : ''),
  /** Optional: GTFS-Realtime TripUpdates (JSON-Proxy empfohlen). */
  gtfsRtUrl: () => getPublicEnv('EXPO_PUBLIC_GTFS_RT_URL'),
  /** De Lijn (Belgien) — nur mit Partner-Key. */
  delijnApiKey: () => getPublicEnv('EXPO_PUBLIC_DELIJN_API_KEY'),
  delijnBaseUrl: () => getPublicEnv('EXPO_PUBLIC_DELIJN_BASE_URL'),
  /** Parkopedia Partner-Key (optional; sonst Places + Pack). */
  parkopediaApiKey: () => getPublicEnv('EXPO_PUBLIC_PARKOPEDIA_API_KEY'),
  /** Optionaler Override für DB/HAFAS transport.rest Basis-URL. */
  dbHafasBaseUrl: () =>
    getPublicEnv('EXPO_PUBLIC_DB_HAFAS_BASE_URL') ||
    getPublicEnv('EXPO_PUBLIC_DB_API_BASE_URL'),
  /** Offizielle DB-API (falls gesetzt; transport.rest braucht i. d. R. keinen Key). */
  dbApiKey: () =>
    getPublicEnv('EXPO_PUBLIC_DB_API_KEY') ||
    getPublicEnv('EXPO_PUBLIC_DEUTSCHE_BAHN_API_KEY'),
  dbClientId: () => getPublicEnv('EXPO_PUBLIC_DB_CLIENT_ID'),
  /**
   * Nie als EXPO_PUBLIC_* bundlen — immer '' im Client (P0).
   * Server-only Secrets gehören in Edge Functions / Scripts.
   */
  dbClientSecret: () => '',
  /**
   * Transitous MOTIS 2 API (EU ÖPNV + GTFS-RT).
   * Default: https://api.transitous.org/api
   */
  transitousBaseUrl: () =>
    getPublicEnv('EXPO_PUBLIC_TRANSITOUS_BASE_URL') ||
    'https://api.transitous.org/api',
  /** FlightAware AeroAPI v4 (x-apikey). */
  flightAwareApiKey: () => getPublicEnv('EXPO_PUBLIC_FLIGHTAWARE_API_KEY'),
};
