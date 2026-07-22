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
        EXPO_PUBLIC_KOKORO_MODEL_URL:
          process.env.EXPO_PUBLIC_KOKORO_MODEL_URL ?? '',
        EXPO_PUBLIC_KOKORO_VOICE_URL:
          process.env.EXPO_PUBLIC_KOKORO_VOICE_URL ?? '',
        EXPO_PUBLIC_KOKORO_VOCAB_URL:
          process.env.EXPO_PUBLIC_KOKORO_VOCAB_URL ?? '',
        EXPO_PUBLIC_LOCAL_MODEL_PATH:
          process.env.EXPO_PUBLIC_LOCAL_MODEL_PATH ?? '',
      },
    },
  };
};
