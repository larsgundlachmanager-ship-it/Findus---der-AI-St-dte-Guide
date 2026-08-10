/**
 * Playlist-Links: user- & ortsbezogen (Spotify-Suche + Radio).
 * Keine feste Kuratier-Playlist — Gemini-IDs sind oft tot.
 */

import type { QuickAction } from '../types/concierge';
import type { GeminiConciergeResponse } from '../types/concierge';
import { getCachedUserProfile } from './userProfileService';
import { useFinnusStore } from '../store/useFinnusStore';
import { spotifyArtistsFromProfile } from './persona/spotifyConnect';

const PLAYLIST_RE =
  /\b(playlist|spotify|musik|song|songs|feier|party|überfahrt|ueberfahrt|fähre|faehre|radio)\b/iu;

export function looksLikePlaylistRequest(text: string): boolean {
  return /\b(playlist|spotify|musik\s+(zum|für|fuer)|feier.?vibe|party.?musik|radio)\b/iu.test(
    text,
  );
}

export function isPlaylistQuickAction(action: QuickAction): boolean {
  if (action.type !== 'OPEN_URL') return false;
  const blob = `${action.label} ${action.payload.url ?? ''} ${action.payload.destName ?? ''}`.toLowerCase();
  return (
    /playlist|spotify|musik|music\.apple|deezer|youtube\.com\/playlist|radio/i.test(
      blob,
    ) || /🎵|🎶/.test(action.label)
  );
}

export function buildSpotifySearchUrl(query: string): string {
  const q = query.trim() || 'entspannt deutsch playlist';
  return `https://open.spotify.com/search/${encodeURIComponent(q)}`;
}

export function buildSpotifyRadioSearchUrl(seed: string): string {
  const q = `radio ${seed.trim() || 'deutsch chill'}`;
  return `https://open.spotify.com/search/${encodeURIComponent(q)}`;
}

/** Kontextuelle Spotify-Suche — frei, ohne feste Program-Playlist. */
export function buildContextualPlaylistQuery(opts?: {
  userText?: string;
  city?: string | null;
  mood?: string | null;
}): string | null {
  const profile = getCachedUserProfile();
  const bits: string[] = [];
  const artists = spotifyArtistsFromProfile(profile);
  if (artists.length > 0) {
    bits.push(artists.slice(0, 3).join(' '));
  }
  const city =
    opts?.city?.trim() ||
    profile?.cityName?.trim() ||
    useFinnusStore.getState().currentLocationName?.trim() ||
    '';
  if (city) bits.push(city);
  if (opts?.mood?.trim()) bits.push(opts.mood.trim());
  if (opts?.userText?.trim()) {
    const t = opts.userText.trim();
    if (/party|feier|chill|roadtrip|fähre|strand|regen|workout/iu.test(t)) {
      bits.push(t.split(/\s+/).slice(0, 4).join(' '));
    }
  }
  if (bits.length === 0) return null;
  if (!/playlist|radio|mix/i.test(bits.join(' '))) bits.push('playlist');
  return bits.join(' ').slice(0, 80);
}

export function hasPlaylistIntent(
  response: GeminiConciergeResponse,
  userText?: string,
): boolean {
  if (userText && looksLikePlaylistRequest(userText)) return true;
  return (
    looksLikePlaylistRequest(response.speechText) ||
    PLAYLIST_RE.test(response.cardTitle ?? '') ||
    response.visualBullets.some((b) => PLAYLIST_RE.test(b)) ||
    response.quickActions.some(isPlaylistQuickAction)
  );
}

/** Baut eine Suche aus Ort, User-Prefs und Kontext — keine feste Playlist-ID. */
export function buildPersonalizedPlaylistQuery(
  response?: GeminiConciergeResponse | null,
  userText?: string,
): string | null {
  const contextual = buildContextualPlaylistQuery({
    userText,
    city: getCachedUserProfile()?.cityName,
  });
  if (contextual) return contextual;

  const profile = getCachedUserProfile();
  const store = useFinnusStore.getState();
  const bits: string[] = [];

  const city =
    profile?.cityName?.trim() ||
    store.currentLocationName?.trim() ||
    '';
  if (city) bits.push(city);

  const about = (profile?.aboutMe ?? '').trim();
  if (/rap|hip.?hop/i.test(about)) bits.push('hip hop');
  else if (/rock|metal/i.test(about)) bits.push('rock');
  else if (/jazz|soul|funk/i.test(about)) bits.push('jazz soul');
  else if (/klassik|classic/i.test(about)) bits.push('klassik');
  else if (/elektro|techno|house/i.test(about)) bits.push('electronic');
  else if (/indie|alternative/i.test(about)) bits.push('indie');

  const prefs = profile?.experiencePrefs ?? {};
  if (prefs.nachtleben === 'yes') bits.push('party');
  if (prefs.natur === 'yes' && prefs.nachtleben !== 'yes') bits.push('chill akustisch');

  const speech = response?.speechText ?? '';
  const title = response?.cardTitle ?? '';
  if (/fähre|faehre|überfahrt|ueberfahrt/i.test(`${speech} ${title}`)) {
    bits.push('fähre überfahrt');
  }
  if (/strand|beach|meer/i.test(`${speech} ${title} ${city}`)) {
    bits.push('summer beach');
  }
  if (/party|feier|vibe/i.test(`${speech} ${title}`)) {
    bits.push('party deutsch');
  }

  if (bits.length === 0) {
    return null;
  } else if (!/playlist|radio|mix/i.test(bits.join(' '))) {
    bits.push('playlist');
  }

  return bits.join(' ').slice(0, 80);
}

function extractPlaylistQuery(
  response: GeminiConciergeResponse,
  userText?: string,
): string | null {
  const title = response.cardTitle?.trim() ?? '';
  if (title && /playlist|musik|feier|radio/i.test(title)) {
    const cleaned = title.replace(/^🎵\s*/u, '').trim();
    return buildPersonalizedPlaylistQuery(
      {
        ...response,
        cardTitle: cleaned,
      },
      userText,
    );
  }
  const bullet = response.visualBullets.find((b) =>
    /playlist|feier|party|musik|radio/i.test(b),
  );
  if (bullet) {
    return buildPersonalizedPlaylistQuery(
      {
        ...response,
        speechText: bullet,
      },
      userText,
    );
  }
  return buildPersonalizedPlaylistQuery(response, userText);
}

/**
 * Playlist-OPEN_URL: personalisierte Suche + Radio, ohne Ja-Nachfrage.
 */
export function enrichPlaylistOffers(
  response: GeminiConciergeResponse,
  userText?: string,
): GeminiConciergeResponse {
  if (!hasPlaylistIntent(response, userText)) return response;

  const query = extractPlaylistQuery(response, userText);
  // Schweigen wenn leer: kein Chip, kein Musik-Filler
  if (!query?.trim()) {
    return {
      ...response,
      quickActions: response.quickActions.filter((a) => !isPlaylistQuickAction(a)),
    };
  }
  const primaryUrl = buildSpotifySearchUrl(query);
  const radioUrl = buildSpotifyRadioSearchUrl(query);
  const actions = [...response.quickActions];
  const playlistIdx = actions.findIndex(isPlaylistQuickAction);

  if (playlistIdx >= 0) {
    const existing = actions[playlistIdx]!;
    actions[playlistIdx] = {
      ...existing,
      label: '🎵 Playlist öffnen',
      payload: {
        ...existing.payload,
        url: primaryUrl,
      },
    };
  } else {
    actions.push({
      type: 'OPEN_URL',
      label: '🎵 Playlist öffnen',
      payload: { url: primaryUrl },
    });
  }

  const hasRadio = actions.some(
    (a) =>
      a.type === 'OPEN_URL' &&
      /radio/i.test(`${a.label} ${a.payload.url ?? ''}`),
  );
  if (!hasRadio) {
    actions.push({
      type: 'OPEN_URL',
      label: '📻 Radio dazu',
      payload: { url: radioUrl },
    });
  }

  return {
    ...response,
    quickActions: actions,
  };
}
