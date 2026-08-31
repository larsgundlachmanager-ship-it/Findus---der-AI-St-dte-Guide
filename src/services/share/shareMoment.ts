/**
 * Teilbare Momente — WhatsApp-fertig, ohne die App erklären zu müssen.
 * Kein gemeinsames Urlaubs-Planungs-Board: nur Text, den ein Freund versteht.
 */

import { Platform, Share } from 'react-native';
import { APP_BRAND_NAME, APP_WEBSITE_URL } from '../../constants/brand';
import { truncateToWholeWords } from '../../utils/wholeWords';

/** Öffentliche Share-/Marketing-URL (Markenname Yorro). */
export const FINDUS_SHARE_URL = APP_WEBSITE_URL;
export const FINDUS_SHARE_HOOK = 'Kopfhörer rein. Die Stadt läuft mit.';

export function firstSpokenLine(speech: string, max = 180): string {
  const clean = speech.replace(/\s+/g, ' ').trim();
  if (!clean) return '';
  const m = clean.match(/^[\s\S]{1,220}?(?:[.!?…]|$)/u);
  const line = (m?.[0] ?? clean).trim();
  if (line.length <= max) return line;
  return truncateToWholeWords(line, max);
}

export function buildPlaceShareText(opts: {
  placeName?: string | null;
  cityName?: string | null;
  speechText?: string | null;
}): string {
  const place = opts.placeName?.trim() || '';
  const city = opts.cityName?.trim() || '';
  const headline =
    place && city ? `${place}, ${city}` : place || city || 'Unterwegs';
  const line = firstSpokenLine(opts.speechText ?? '');
  const parts = [headline];
  if (line && line.toLowerCase() !== place.toLowerCase()) {
    parts.push('', line);
  }
  parts.push('', FINDUS_SHARE_HOOK, FINDUS_SHARE_URL);
  return parts.join('\n');
}

export function buildStampRecapShareText(opts: {
  cityName?: string | null;
  seenPlaces: number;
  areaPercent: number;
}): string {
  const city = opts.cityName?.trim() || 'dieser Stadt';
  const places =
    opts.seenPlaces === 1
      ? '1 Ort entdeckt'
      : `${Math.max(0, opts.seenPlaces)} Orte entdeckt`;
  const area =
    opts.areaPercent > 0 ? `, ${opts.areaPercent} % der Fläche erkundet` : '';
  return [
    `${city} — ${places}${area}.`,
    '',
    FINDUS_SHARE_HOOK,
    FINDUS_SHARE_URL,
  ].join('\n');
}

export function buildTripInviteShareText(opts: {
  cityName?: string | null;
}): string {
  const city = opts.cityName?.trim();
  const lead = city
    ? `Nimm Yorro mit nach ${city}.`
    : 'Nimm Yorro mit auf den Städtetrip.';
  return [
    lead,
    'Kopfhörer rein — am Ort erzählt er, was dich interessiert. Fragen, Weg, Essen: dieselbe Stimme.',
    '',
    FINDUS_SHARE_URL,
  ].join('\n');
}

export function isShareableMoment(opts: {
  cardTitle?: string | null;
  speechText?: string | null;
}): boolean {
  const title = opts.cardTitle?.trim() ?? '';
  const speech = opts.speechText?.trim() ?? '';
  if (title.length >= 2) return true;
  return speech.length >= 40;
}

export async function shareFindusText(
  message: string,
  title = APP_BRAND_NAME,
): Promise<boolean> {
  const text = message.trim();
  if (!text) return false;
  try {
    await Share.share(
      Platform.OS === 'ios'
        ? { message: text, title }
        : { message: text, title },
    );
    return true;
  } catch {
    return false;
  }
}
