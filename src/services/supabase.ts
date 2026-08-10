import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env } from '../config/env';

function readConfig(): { url: string; anonKey: string } {
  return {
    url: env.supabaseUrl(),
    anonKey: env.supabaseAnonKey(),
  };
}

let client: SupabaseClient | null = null;

/** AsyncStorage-Adapter für Session (Expo / RN), soft wenn Package fehlt. */
function createAuthStorage():
  | {
      getItem: (key: string) => Promise<string | null>;
      setItem: (key: string, value: string) => Promise<void>;
      removeItem: (key: string) => Promise<void>;
    }
  | undefined {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const AsyncStorage = require('@react-native-async-storage/async-storage')
      .default;
    return AsyncStorage;
  } catch {
    return undefined;
  }
}

export function getSupabase(): SupabaseClient | null {
  const { url, anonKey } = readConfig();

  if (
    !url ||
    !anonKey ||
    url.includes('your-project') ||
    anonKey.includes('your-anon')
  ) {
    return null;
  }

  if (!client) {
    const storage = createAuthStorage();
    client = createClient(url, anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
        ...(storage
          ? {
              storage: {
                getItem: (key: string) => storage.getItem(key),
                setItem: (key: string, value: string) =>
                  storage.setItem(key, value),
                removeItem: (key: string) => storage.removeItem(key),
              },
            }
          : {}),
      },
    });
  }

  return client;
}

export function isSupabaseConfigured(): boolean {
  return getSupabase() !== null;
}

/** Erwartetes Schema in Supabase (public) + optionale Geo-Felder aus City-Packs: */
export type RemotePoi = {
  id: number;
  name: string;
  lat: number;
  lng: number;
  radius_meters: number;
  spot_key?: string | null;
  parent_poi_id?: number | null;
  kind?: 'area' | 'approach' | 'sub' | 'legacy' | null;
  category?: string | null;
  tags_json?: string | null;
  polygon_json?: string | null;
  teaser_text?: string | null;
  condition_rule?: string | null;
  special_radius_m?: number | null;
};

export type RemoteFact = {
  id: number;
  poi_id: number;
  fact_text: string;
};
