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
  geminiApiKey: () =>
    getPublicEnv('EXPO_PUBLIC_GEMINI_API_KEY') ||
    getPublicEnv('EXPO_PUBLIC_GOOGLE_API_KEY'),
  kokoroModelUrl: () => getPublicEnv('EXPO_PUBLIC_KOKORO_MODEL_URL'),
  kokoroVoiceUrl: () => getPublicEnv('EXPO_PUBLIC_KOKORO_VOICE_URL'),
  kokoroVocabUrl: () => getPublicEnv('EXPO_PUBLIC_KOKORO_VOCAB_URL'),
  localModelPath: () => getPublicEnv('EXPO_PUBLIC_LOCAL_MODEL_PATH'),
  /** Optional: Basis-URL für Dictionary-Cloud-Sync (`…/api/dictionary` oder Storage). */
  dictionaryApiUrl: () => getPublicEnv('EXPO_PUBLIC_DICTIONARY_API_URL'),

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
  /** Bounce Gepäckaufbewahrung Affiliate-URL. */
  bounceLuggageUrl: () =>
    getPublicEnv('EXPO_PUBLIC_BOUNCE_LUGGAGE_URL') ||
    'https://go.bounce.com/FINDUS64751223710664',
  /** Stay22 Affiliate-ID (Unterkünfte). */
  stay22AffiliateId: () =>
    getPublicEnv('EXPO_PUBLIC_STAY22_AFFILIATE_ID') || 'findus',
  /**
   * Google Maps Platform (Directions / Places / Street View) für
   * freihändige Landmarken-Navigation. Optional.
   */
  googleMapsApiKey: () =>
    getPublicEnv('EXPO_PUBLIC_GOOGLE_MAPS_API_KEY') ||
    getPublicEnv('EXPO_PUBLIC_GOOGLE_API_KEY'),
};
