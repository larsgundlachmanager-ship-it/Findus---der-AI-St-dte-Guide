/**
 * Nav-Geocode Prefetch parallel zu Call-1 Bridge — Karte darf schon „laden“.
 * Treffer landen im normalen Geocode-Cache; hardOverride nutzt sie ohne Extra-Wartezeit.
 */

import type { GeocodeResult } from './googleMapsNav';

type PrefetchEntry = {
  query: string;
  startedAt: number;
  promise: Promise<GeocodeResult | null>;
  hit: GeocodeResult | null;
};

let current: PrefetchEntry | null = null;

const TTL_MS = 45_000;

export function clearNavDestPrefetch(): void {
  current = null;
}

/**
 * Fire-and-forget: Loading-Flag + Geocode-Kandidaten.
 * Call-1 wartet nicht.
 */
export function kickNavDestPrefetch(opts: {
  destLabel: string;
  userText?: string | null;
}): void {
  const label = (opts.destLabel || '').replace(/\s+/g, ' ').trim();
  if (label.length < 2) return;

  try {
    const { useFinnusStore } = require('../../store/useFinnusStore') as {
      useFinnusStore: { getState: () => { setNavRouteLoading: (v: boolean) => void } };
    };
    useFinnusStore.getState().setNavRouteLoading(true);
  } catch {
    /* soft */
  }

  let queries = [label];
  try {
    const { expandNavGeocodeQueries, repairNavDestLabel } = require('./navDestFuzzyRepair') as {
      expandNavGeocodeQueries: (
        raw: string,
        o?: { userText?: string | null },
      ) => string[];
      repairNavDestLabel: (
        raw: string,
        o?: { userText?: string | null },
      ) => string;
    };
    const repaired = repairNavDestLabel(label, { userText: opts.userText });
    queries = expandNavGeocodeQueries(repaired, { userText: opts.userText });
    if (repaired !== label) {
      queries = expandNavGeocodeQueries(label, { userText: opts.userText }).concat(
        queries,
      );
    }
    // dedupe
    const seen = new Set<string>();
    queries = queries.filter((q) => {
      const k = q.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  } catch {
    queries = [label];
  }

  const key = queries[0] || label;
  if (
    current &&
    current.query.toLowerCase() === key.toLowerCase() &&
    Date.now() - current.startedAt < TTL_MS
  ) {
    return;
  }

  const promise = (async (): Promise<GeocodeResult | null> => {
    try {
      const { useGpsStore } = require('../../store/useGpsStore') as {
        useGpsStore: {
          getState: () => { lat: number | null; lng: number | null };
        };
      };
      const gps = useGpsStore.getState();
      const bias =
        gps.lat != null && gps.lng != null
          ? { biasLat: gps.lat, biasLng: gps.lng }
          : {};
      // Pack zuerst (TC Prisdorf ≠ Stadt-Mitte / Fremd-Treffer).
      try {
        const { resolvePlacePackOsmGoogle } = require('./packPlaceResolve') as {
          resolvePlacePackOsmGoogle: (o: {
            query: string;
            biasLat?: number;
            biasLng?: number;
            cityHint?: string | null;
          }) => Promise<{
            lat: number;
            lng: number;
            label: string;
          } | null>;
        };
        let cityHint: string | null = null;
        try {
          const { getCachedUserProfile } = require('../userProfileService') as {
            getCachedUserProfile: () => { cityId?: string | null } | null;
          };
          cityHint = getCachedUserProfile()?.cityId ?? null;
        } catch {
          /* soft */
        }
        for (const q of queries.slice(0, 4)) {
          const packHit = await resolvePlacePackOsmGoogle({
            query: q,
            cityHint,
            ...bias,
          });
          if (packHit?.lat != null && packHit?.lng != null) {
            return {
              lat: packHit.lat,
              lng: packHit.lng,
              label: packHit.label || q,
            };
          }
        }
      } catch {
        /* soft — OSM/Google fallback */
      }
      const { geocodePlaceNameOsmFirst } = require('./googleMapsNav') as {
        geocodePlaceNameOsmFirst: (
          q: string,
          o?: {
            biasLat?: number;
            biasLng?: number;
            cityHint?: string | null;
            userText?: string | null;
            skipFuzzyExpand?: boolean;
            preferStreetAddress?: boolean;
          },
        ) => Promise<GeocodeResult | null>;
      };
      let preferStreetAddress = false;
      try {
        const { looksLikeStreetAddress } = require('./streetAddressQuery') as {
          looksLikeStreetAddress: (s: string) => boolean;
        };
        preferStreetAddress = looksLikeStreetAddress(label);
      } catch {
        /* soft */
      }
      for (const q of queries.slice(0, 6)) {
        const hit = await geocodePlaceNameOsmFirst(q, {
          ...bias,
          userText: opts.userText ?? label,
          skipFuzzyExpand: true,
          preferStreetAddress,
        });
        if (hit?.lat != null && hit?.lng != null) return hit;
      }
    } catch {
      /* soft */
    }
    return null;
  })();

  const entry: PrefetchEntry = {
    query: key,
    startedAt: Date.now(),
    promise,
    hit: null,
  };
  current = entry;
  void promise.then((hit) => {
    if (current === entry) entry.hit = hit;
  });
}

export async function awaitNavDestPrefetch(
  destLabel?: string | null,
): Promise<GeocodeResult | null> {
  if (!current) return null;
  if (Date.now() - current.startedAt > TTL_MS) {
    current = null;
    return null;
  }
  if (destLabel) {
    const normalize = (s: string) =>
      s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    const d = normalize(destLabel);
    const q = normalize(current.query);
    if (
      !q.includes(d.slice(0, 8)) &&
      !d.includes(q.slice(0, 8))
    ) {
      return null;
    }
  }
  try {
    return await current.promise;
  } catch {
    return null;
  }
}


/**
 * Bridge spricht noch → Geocode + Dest-Pin/Preview + Commit sofort.
 * Hard-Override überspringt denselben Dest (kein clear+restart).
 */
export function kickInstantMapNav(opts: {
  destLabel: string;
  userText?: string | null;
}): void {
  const label = (opts.destLabel || '').replace(/\s+/g, ' ').trim();
  if (label.length < 2) return;
  kickNavDestPrefetch(opts);
  void (async () => {
    try {
      const hit = await awaitNavDestPrefetch(label);
      if (!hit || hit.lat == null || hit.lng == null) return;

      const destName = (hit.label || label).replace(/\s+/g, ' ').trim() || label;

      let previewRoute: Array<{ lat: number; lng: number }> | undefined;
      try {
        const { useGpsStore } = require('../../store/useGpsStore') as {
          useGpsStore: {
            getState: () => { lat: number | null; lng: number | null };
          };
        };
        const gps = useGpsStore.getState();
        if (gps.lat != null && gps.lng != null) {
          previewRoute = [
            { lat: gps.lat, lng: gps.lng },
            { lat: hit.lat, lng: hit.lng },
          ];
        }
      } catch {
        /* soft */
      }

      // Pin + Preview-Linie → HomePresenceMap malt sofort (pendingNavOffer-Deps).
      try {
        const { useFinnusStore } = require('../../store/useFinnusStore') as {
          useFinnusStore: {
            getState: () => {
              navActive?: boolean;
              navTargetName?: string | null;
              setPendingNavOffer: (o: {
                poiId: number;
                name: string;
                lat?: number;
                lng?: number;
                previewRoute?: Array<{ lat: number; lng: number }>;
                source?: string;
              } | null) => void;
            };
          };
        };
        const st = useFinnusStore.getState();
        if (!st.navActive) {
          st.setPendingNavOffer({
            poiId: -1,
            name: destName,
            lat: hit.lat,
            lng: hit.lng,
            previewRoute,
            source: 'concierge',
          });
        }
      } catch {
        /* soft */
      }

      // Schon live zum selben Ziel → kein zweiter Commit
      try {
        const { useFinnusStore } = require('../../store/useFinnusStore') as {
          useFinnusStore: {
            getState: () => { navActive?: boolean; navTargetName?: string | null };
          };
        };
        const { getActiveNavDestination } = require('./navigationService') as {
          getActiveNavDestination: () => {
            name?: string | null;
            lat?: number | null;
            lng?: number | null;
          } | null;
        };
        const { isSameNavDestination } = require('./sameNavDestination') as {
          isSameNavDestination: (o: {
            liveName?: string | null;
            nextName?: string | null;
            liveLat?: number | null;
            liveLng?: number | null;
            nextLat?: number | null;
            nextLng?: number | null;
          }) => boolean;
        };
        const st = useFinnusStore.getState();
        const live = getActiveNavDestination();
        if (
          st.navActive &&
          live &&
          isSameNavDestination({
            liveName: live.name || st.navTargetName,
            nextName: destName,
            liveLat: live.lat,
            liveLng: live.lng,
            nextLat: hit.lat,
            nextLng: hit.lng,
          })
        ) {
          return;
        }
      } catch {
        /* soft */
      }

      const { commitHandsFreeNavStart } = require('./handsFreeNav') as {
        commitHandsFreeNavStart: (
          i: {
            name: string;
            poiId: null;
            lat: number;
            lng: number;
            userQuery?: string | null;
          },
          o?: { skipClosingGate?: boolean; skipDestVerify?: boolean },
        ) => Promise<unknown>;
      };
      await commitHandsFreeNavStart(
        {
          name: destName,
          poiId: null,
          lat: hit.lat,
          lng: hit.lng,
          userQuery: opts.userText ?? label,
        },
        { skipClosingGate: true, skipDestVerify: true },
      );
    } catch {
      /* soft */
    }
  })();
}
