import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env } from '../config/env';

function readConfig(): { url: string; anonKey: string } {
  return {
    url: env.supabaseUrl(),
    anonKey: env.supabaseAnonKey(),
  };
}

let client: SupabaseClient | null = null;

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
    client = createClient(url, anonKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });
  }

  return client;
}

export function isSupabaseConfigured(): boolean {
  return getSupabase() !== null;
}

/** Erwartetes Schema in Supabase (public): */
export type RemotePoi = {
  id: number;
  name: string;
  lat: number;
  lng: number;
  radius_meters: number;
};

export type RemoteFact = {
  id: number;
  poi_id: number;
  fact_text: string;
};
