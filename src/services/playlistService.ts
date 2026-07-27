/**
 * Playlist-Links: user- & ortsbezogen (Spotify-Suche + Radio).
 * Keine feste Kuratier-Playlist — Gemini-IDs sind oft tot.
 */

import type { QuickAction } from '../types/concierge';
import type { GeminiConciergeResponse } from '../types/concierge';
import { getCachedUserProfile } from './userProfileService';
import { useFinnusStore } from '../store/useFinnusStore';

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

/** Baut eine Suche aus Ort, User-Prefs und Kontext — keine feste Playlist-ID. */
export function buildPersonalizedPlaylistQuery(
  response?: GeminiConciergeResponse | null,
): string {
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
    bits.push('entspannt deutsch playlist');
  } else if (!/playlist|radio|mix/i.test(bits.join(' '))) {
    bits.push('playlist');
  }

  return bits.join(' ').slice(0, 80);
}

function extractPlaylistQuery(response: GeminiConciergeResponse): string {
  const title = response.cardTitle?.trim() ?? '';
  if (title && /playlist|musik|feier|radio/i.test(title)) {
    const cleaned = title.replace(/^🎵\s*/u, '').trim();
    // Titel mit Ort/User anreichern
    return buildPersonalizedPlaylistQuery({
      ...response,
      cardTitle: cleaned,
    });
  }
  const bullet = response.visualBullets.find((b) =>
    /playlist|feier|party|musik|radio/i.test(b),
  );
  if (bullet) {
    return buildPersonalizedPlaylistQuery({
      ...response,
      speechText: bullet,
    });
  }
  return buildPersonalizedPlaylistQuery(response);
}

/**
 * Playlist-OPEN_URL: personalisierte Suche + Radio, ohne Ja-Nachfrage.
 */
export function enrichPlaylistOffers(
  response: GeminiConciergeResponse,
): GeminiConciergeResponse {
  const playlistIdx = response.quickActions.findIndex(isPlaylistQuickAction);
  const speechWantsMusic =
    looksLikePlaylistRequest(response.speechText) ||
    PLAYLIST_RE.test(response.cardTitle ?? '') ||
    response.visualBullets.some((b) => PLAYLIST_RE.test(b));

  if (playlistIdx < 0 && !speechWantsMusic) return response;

  const query = extractPlaylistQuery(response);
  const primaryUrl = buildSpotifySearchUrl(query);
  const radioUrl = buildSpotifyRadioSearchUrl(query);
  const actions = [...response.quickActions];

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

  let speechText = response.speechText.trim();
  if (
    /\b(soll\s+ich|möchtest\s+du|moechtest\s+du|willst\s+du|öffnen|oeffnen)\b/iu.test(
      speechText,
    ) ||
    !/zusammengestellt|fertig|habe\s+dir|passend/iu.test(speechText)
  ) {
    speechText =
      'Ich hab dir eine Playlist zusammengestellt, die zu dir und dem Ort passt. ' +
      'Wenn du was anderes willst, sag mir einfach deinen Wunsch — sonst gibt\'s auch Radio zum passenden Vibe.';
  }

  const visualBullets =
    response.visualBullets.length > 0
      ? response.visualBullets.slice(0, 3)
      : [
          'Passend zu dir & dem Ort',
          'Oder Radio zum Song',
          'Sag mir deinen Wunsch',
        ];

  return {
    ...response,
    speechText,
    cardTitle: response.cardTitle?.trim() || 'Deine Playlist',
    visualBullets,
    quickActions: actions,
  };
}
