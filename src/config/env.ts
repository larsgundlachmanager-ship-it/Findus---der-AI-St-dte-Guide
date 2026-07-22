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
  kokoroModelUrl: () => getPublicEnv('EXPO_PUBLIC_KOKORO_MODEL_URL'),
  kokoroVoiceUrl: () => getPublicEnv('EXPO_PUBLIC_KOKORO_VOICE_URL'),
  kokoroVocabUrl: () => getPublicEnv('EXPO_PUBLIC_KOKORO_VOCAB_URL'),
  localModelPath: () => getPublicEnv('EXPO_PUBLIC_LOCAL_MODEL_PATH'),
  /** Optional: Basis-URL für Dictionary-Cloud-Sync (`…/api/dictionary` oder Storage). */
  dictionaryApiUrl: () => getPublicEnv('EXPO_PUBLIC_DICTIONARY_API_URL'),
};
