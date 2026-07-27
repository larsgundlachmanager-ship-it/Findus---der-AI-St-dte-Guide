/**
 * Offizielle Stadt-/Inselkarten aus dem City-Pack (z. B. Wangerooge Ortsplan).
 */

import type { CityPackLink } from './cityPack';
import { getCityPackLinks } from './cityCatalogService';
import { getCachedUserProfile } from './userProfileService';
import type { QuickAction } from '../types/concierge';
import { useFinnusStore } from '../store/useFinnusStore';

export type CityMapView = {
  url: string;
  title: string;
};

const MAP_URL_HINT =
  /ortsplan|inselplan|wangerooge\.de\/orts|interaktiv.*karte|city.*map/i;

export function isCityMapUrl(url: string | undefined | null): boolean {
  if (!url?.trim()) return false;
  return MAP_URL_HINT.test(url.trim());
}

export function speechMentionsMap(speech: string): boolean {
  return /\b(karte|ortsplan|inselplan|inselkarte|auf\s+der\s+karte|interaktive\s+karte)\b/iu.test(
    speech.trim(),
  );
}

/** Findus sagt, er zeigt/öffnet die Karte — dann sofort anzeigen. */
export function speechCommitsToMap(speech: string): boolean {
  const t = speech.trim();
  if (!speechMentionsMap(t)) return false;
  return /\b(ich\s+(zeig|öffne|mach|schalt)|hier\s+ist\s+die\s+karte|karte\s+(ist\s+)?(an|auf|da|offen)|zeig\s+ich\s+dir\s+(die\s+)?karte|schau\s+auf\s+der\s+karte|auf\s+der\s+inselkarte)\b/iu.test(
    t,
  );
}

export async function getCityMapLink(): Promise<CityPackLink | null> {
  const cityId = getCachedUserProfile()?.cityId;
  const links = await getCityPackLinks(cityId);
  const map =
    links.find((l) => l.id === 'ortsplan_interaktiv') ||
    links.find((l) => isCityMapUrl(l.url)) ||
    links.find((l) => /\b(karte|plan|map)\b/i.test(l.title));
  return map ?? null;
}

export async function openCityMap(link?: CityPackLink | null): Promise<boolean> {
  const hit = link ?? (await getCityMapLink());
  if (!hit?.url) return false;
  useFinnusStore.getState().setCityMap({
    url: hit.url,
    title: hit.title || 'Inselkarte',
  });
  return true;
}

export function buildCityMapAction(link: CityPackLink): QuickAction {
  return {
    type: 'OPEN_URL',
    label: '🗺️ Inselkarte öffnen',
    payload: { url: link.url },
  };
}
