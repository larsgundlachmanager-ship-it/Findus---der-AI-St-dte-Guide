/**
 * Stadt → Verbund-/Adapter-Konfiguration (HAFAS-ähnlich via transport.rest,
 * GTFS-RT, Delijn, DB).
 */

import { env } from '../../../config/env';
import { getTransitPackConfig } from '../stationRegistry';
import type { TransitAdapterKind } from './types';

export type CityTransitProfile = {
  cityId: string;
  kind: TransitAdapterKind;
  label: string;
  /** transport.rest Basis, z. B. https://v6.db.transport.rest */
  hafasBaseUrl?: string;
  gtfsRtUrl?: string;
  delijnBaseUrl?: string;
  defaultStopId?: string;
};

/**
 * Bekannte Städte ohne Pack-Override.
 * Delijn nur für BE-Städte; DE → DB / regionale transport.rest.
 */
const BUILTIN: Record<string, Omit<CityTransitProfile, 'cityId'>> = {
  prisdorf: {
    kind: 'db_rest',
    label: 'DB / HVV-Korridor (transport.rest)',
    hafasBaseUrl: 'https://v6.db.transport.rest',
    defaultStopId: '8004888',
  },
  hamburg: {
    kind: 'hafas',
    label: 'HVV / DB (transport.rest)',
    hafasBaseUrl: 'https://v6.db.transport.rest',
  },
  berlin: {
    kind: 'hafas',
    label: 'BVG / VBB (transport.rest)',
    hafasBaseUrl: 'https://v6.bvg.transport.rest',
  },
  muenchen: {
    kind: 'hafas',
    label: 'MVV / DB (transport.rest)',
    hafasBaseUrl: 'https://v6.db.transport.rest',
  },
  koeln: {
    kind: 'hafas',
    label: 'VRS / DB (transport.rest)',
    hafasBaseUrl: 'https://v6.db.transport.rest',
  },
  /** Beispiel Belgien — nur aktiv wenn Stadt-ID delijn_* / antwerpen */
  antwerpen: {
    kind: 'delijn',
    label: 'De Lijn',
    delijnBaseUrl: 'https://api.delijn.be/gic/v1',
  },
};

export function resolveCityTransitProfile(
  cityIdRaw?: string | null,
): CityTransitProfile {
  const cityId = (cityIdRaw || env.cityId() || 'prisdorf')
    .toString()
    .trim()
    .toLowerCase();
  const pack = getTransitPackConfig();
  const builtin = BUILTIN[cityId];

  const rawKind = (
    pack?.provider?.trim().toLowerCase() ||
    builtin?.kind ||
    'db_rest'
  ).toString();
  const kind: TransitAdapterKind =
    rawKind === 'none'
      ? 'takt'
      : (rawKind as TransitAdapterKind);

  return {
    cityId,
    kind,
    label:
      builtin?.label ||
      (kind === 'gtfs_rt'
        ? 'GTFS-Realtime'
        : kind === 'delijn'
          ? 'De Lijn'
          : kind === 'transitous'
            ? 'Transitous (MOTIS / EU)'
            : kind === 'hafas'
              ? 'HAFAS / Verbund'
              : 'DB transport.rest'),
    hafasBaseUrl:
      pack?.hafas_base_url?.trim() ||
      env.dbHafasBaseUrl?.() ||
      builtin?.hafasBaseUrl ||
      'https://v6.db.transport.rest',
    gtfsRtUrl:
      pack?.gtfs_rt_url?.trim() ||
      env.get('EXPO_PUBLIC_GTFS_RT_URL') ||
      builtin?.gtfsRtUrl,
    delijnBaseUrl:
      pack?.delijn_base_url?.trim() ||
      env.get('EXPO_PUBLIC_DELIJN_BASE_URL') ||
      builtin?.delijnBaseUrl,
    defaultStopId:
      pack?.default_ibnr?.trim() ||
      builtin?.defaultStopId ||
      undefined,
  };
}
