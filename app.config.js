/**
 * Expo SDK 52: lädt .env (via Expo CLI) und stellt EXPO_PUBLIC_* in
 * process.env + extra bereit – damit Dev Client / Metro sie zuverlässig sehen.
 */
const appJson = require('./app.json');

module.exports = () => {
  const expo = appJson.expo;

  return {
    expo: {
      ...expo,
      extra: {
        ...(expo.extra ?? {}),
        EXPO_PUBLIC_SUPABASE_URL: process.env.EXPO_PUBLIC_SUPABASE_URL ?? '',
        EXPO_PUBLIC_SUPABASE_ANON_KEY:
          process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '',
        EXPO_PUBLIC_CITY_ID: process.env.EXPO_PUBLIC_CITY_ID ?? 'prisdorf',
        EXPO_PUBLIC_OPENAI_API_KEY: process.env.EXPO_PUBLIC_OPENAI_API_KEY ?? '',
        EXPO_PUBLIC_GEMINI_API_KEY: process.env.EXPO_PUBLIC_GEMINI_API_KEY ?? '',
        EXPO_PUBLIC_GOOGLE_API_KEY: process.env.EXPO_PUBLIC_GOOGLE_API_KEY ?? '',
        EXPO_PUBLIC_GOOGLE_MAPS_API_KEY:
          process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY ??
          process.env.GOOGLE_MAPS_API_KEY ??
          '',
        EXPO_PUBLIC_KOKORO_MODEL_URL:
          process.env.EXPO_PUBLIC_KOKORO_MODEL_URL ?? '',
        EXPO_PUBLIC_KOKORO_VOICE_URL:
          process.env.EXPO_PUBLIC_KOKORO_VOICE_URL ?? '',
        EXPO_PUBLIC_KOKORO_VOCAB_URL:
          process.env.EXPO_PUBLIC_KOKORO_VOCAB_URL ?? '',
        EXPO_PUBLIC_LOCAL_MODEL_PATH:
          process.env.EXPO_PUBLIC_LOCAL_MODEL_PATH ?? '',
        EXPO_PUBLIC_GYG_PARTNER_ID:
          process.env.EXPO_PUBLIC_GYG_PARTNER_ID ?? 'ZVQGONB',
        EXPO_PUBLIC_MUSEMENT_AFFILIATE_ID:
          process.env.EXPO_PUBLIC_MUSEMENT_AFFILIATE_ID ?? 'findus-8445',
        EXPO_PUBLIC_UBER_CLIENT_ID:
          process.env.EXPO_PUBLIC_UBER_CLIENT_ID ??
          '4a6yecXWLriTzMd4uqp41cVz2dDdlpSB',
        EXPO_PUBLIC_VIATOR_PARTNER_ID:
          process.env.EXPO_PUBLIC_VIATOR_PARTNER_ID ?? 'P00311883',
        EXPO_PUBLIC_VIATOR_MCID:
          process.env.EXPO_PUBLIC_VIATOR_MCID ?? '42383',
        EXPO_PUBLIC_ECONOMY_BOOKINGS_REFERRAL_URL:
          process.env.EXPO_PUBLIC_ECONOMY_BOOKINGS_REFERRAL_URL ??
          'https://www.economybookings.com/de/referral/16yupj/l0j2ln',
        EXPO_PUBLIC_BOUNCE_LUGGAGE_URL:
          process.env.EXPO_PUBLIC_BOUNCE_LUGGAGE_URL ??
          'https://go.bounce.com/FINDUS64751223710664',
        EXPO_PUBLIC_STAY22_AFFILIATE_ID:
          process.env.EXPO_PUBLIC_STAY22_AFFILIATE_ID ?? 'findus',
        EXPO_PUBLIC_RESERVATION_EMAIL_ENDPOINT:
          process.env.EXPO_PUBLIC_RESERVATION_EMAIL_ENDPOINT ?? '',
        EXPO_PUBLIC_RESERVATION_AI_CALL_WEBHOOK:
          process.env.EXPO_PUBLIC_RESERVATION_AI_CALL_WEBHOOK ?? '',
        EXPO_PUBLIC_OPENTABLE_AFFILIATE_ID:
          process.env.EXPO_PUBLIC_OPENTABLE_AFFILIATE_ID ?? '',
        EXPO_PUBLIC_QUANDOO_PARTNER_ID:
          process.env.EXPO_PUBLIC_QUANDOO_PARTNER_ID ?? '',
      },
    },
  };
};
