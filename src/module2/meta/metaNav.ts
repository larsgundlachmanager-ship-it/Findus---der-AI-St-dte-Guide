/**
 * Meta: Navigation — read-only / start wrappers um navigationService.
 */

export type MetaNavDestSnapshot = {
  name: string | null;
  lat: number | null;
  lng: number | null;
  navigating: boolean;
};

export function readMetaNavDestination(): MetaNavDestSnapshot {
  try {
    const { getActiveNavDestination } = require('../../services/navigation/navigationService') as {
      getActiveNavDestination: () => {
        name?: string | null;
        lat?: number;
        lng?: number;
      } | null;
    };
    const dest = getActiveNavDestination();
    return {
      name: dest?.name ?? null,
      lat: typeof dest?.lat === 'number' ? dest.lat : null,
      lng: typeof dest?.lng === 'number' ? dest.lng : null,
      navigating: Boolean(dest),
    };
  } catch {
    return { name: null, lat: null, lng: null, navigating: false };
  }
}

export async function metaStartNavigationToCoords(opts: {
  destName: string;
  destLat: number;
  destLng: number;
  mode?: 'foot' | 'bike' | 'transit' | 'drive';
}): Promise<{ ok: boolean; error?: string }> {
  try {
    const { startNavigationToCoords } = require('../../services/navigation/navigationService') as {
      startNavigationToCoords: (o: {
        destName: string;
        destLat: number;
        destLng: number;
        mode?: string;
      }) => Promise<unknown>;
    };
    await startNavigationToCoords({
      destName: opts.destName,
      destLat: opts.destLat,
      destLng: opts.destLng,
      mode: opts.mode,
    });
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message.slice(0, 120) : 'nav_failed',
    };
  }
}
