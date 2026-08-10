/**
 * Spotify Connect — Top-Artists (Stub ohne Credentials = no-op).
 */

import type { UserProfile } from '../../types/userProfile';
import { useUserProfileStore } from '../../store/useUserProfileStore';

export type SpotifyConnectResult = {
  ok: boolean;
  artists: string[];
  message?: string;
};

/** Lädt Top-20-Artists — ohne Client-ID/Secret nur Cache/Profil. */
export async function syncSpotifyTopArtists(_opts?: {
  accessToken?: string;
}): Promise<SpotifyConnectResult> {
  const token = _opts?.accessToken?.trim();
  if (!token) {
    return {
      ok: false,
      artists: [],
      message: 'Spotify nicht verbunden — keine Credentials.',
    };
  }
  return {
    ok: false,
    artists: [],
    message: 'Spotify-API noch nicht angebunden.',
  };
}

export async function applySpotifyArtistsToProfile(
  artists: string[],
): Promise<void> {
  const clean = artists.map((a) => a.trim()).filter(Boolean).slice(0, 20);
  if (!clean.length) return;
  await useUserProfileStore.getState().patchProfile({
    spotifyTopArtists: clean,
  });
}

export function spotifyArtistsFromProfile(
  profile?: UserProfile | null,
): string[] {
  return (profile?.spotifyTopArtists ?? []).filter(Boolean).slice(0, 20);
}
