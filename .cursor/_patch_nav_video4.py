# -*- coding: utf-8 -*-
"""Pack-first nav geocode + defer city polygons for early smoothness."""
from __future__ import annotations

import os
from pathlib import Path

ROOT = Path(r"c:\Users\larsf\Findus 2.0")


def write_text(path: Path, text: str) -> None:
    tmp = path.with_suffix(path.suffix + ".tmpwrite")
    tmp.write_text(text, encoding="utf-8")
    os.replace(tmp, path)


def patch_once(rel: str, old: str, new: str, label: str, already: str | None = None) -> None:
    p = ROOT / rel
    t = p.read_text(encoding="utf-8")
    if already and already in t and old not in t:
        print(f"{label}: already")
        return
    if old not in t:
        raise SystemExit(f"{label}: old block not found ({rel})")
    write_text(p, t.replace(old, new, 1))
    print(f"{label}: OK")


patch_once(
    "src/services/navigation/navDestPrefetch.ts",
    """  const promise = (async (): Promise<GeocodeResult | null> => {
    try {
      const { geocodePlaceNameOsmFirst } = require('./googleMapsNav') as {
        geocodePlaceNameOsmFirst: (
          q: string,
          o?: {
            biasLat?: number;
            biasLng?: number;
            cityHint?: string | null;
            userText?: string | null;
            skipFuzzyExpand?: boolean;
          },
        ) => Promise<GeocodeResult | null>;
      };
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
""",
    """  const promise = (async (): Promise<GeocodeResult | null> => {
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
              source: 'pack',
            } as GeocodeResult;
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
""",
    "prefetch_pack_first",
    already="Pack zuerst (TC Prisdorf",
)

# hardNav: pack resolve before prefetch reuse
patch_once(
    "src/services/navigation/hardNavOverride.ts",
    """  // Prefetch-Coords (Bridge hat oft schon geocodet)
  if (lat == null || lng == null) {
    try {
      const { awaitNavDestPrefetch } = require('./navDestPrefetch') as {
        awaitNavDestPrefetch: (d?: string | null) => Promise<{
          lat: number;
          lng: number;
          label?: string;
        } | null>;
      };
      const pref = await awaitNavDestPrefetch(name);
      if (pref) {
        lat = pref.lat;
        lng = pref.lng;
        if (pref.label) name = pref.label;
      }
    } catch {
      /* soft */
    }
  }
""",
    """  // Pack-POI zuerst (Tennis-Club Prisdorf TCP etc.), dann Prefetch/Geocode.
  if (lat == null || lng == null) {
    try {
      const { resolvePlacePackOsmGoogle } = require('./packPlaceResolve') as {
        resolvePlacePackOsmGoogle: (o: {
          query: string;
          cityHint?: string | null;
          biasLat?: number;
          biasLng?: number;
        }) => Promise<{ lat: number; lng: number; label: string } | null>;
      };
      const { useGpsStore } = require('../../store/useGpsStore') as {
        useGpsStore: {
          getState: () => { lat: number | null; lng: number | null };
        };
      };
      const gps = useGpsStore.getState();
      let cityHint: string | null = null;
      try {
        const { getCachedUserProfile } = require('../userProfileService') as {
          getCachedUserProfile: () => { cityId?: string | null } | null;
        };
        cityHint = getCachedUserProfile()?.cityId ?? null;
      } catch {
        /* soft */
      }
      const packHit = await resolvePlacePackOsmGoogle({
        query: name,
        cityHint,
        biasLat: gps.lat ?? undefined,
        biasLng: gps.lng ?? undefined,
      });
      if (packHit) {
        lat = packHit.lat;
        lng = packHit.lng;
        name = packHit.label || name;
      }
    } catch {
      /* soft */
    }
  }
  // Prefetch-Coords (Bridge hat oft schon geocodet)
  if (lat == null || lng == null) {
    try {
      const { awaitNavDestPrefetch } = require('./navDestPrefetch') as {
        awaitNavDestPrefetch: (d?: string | null) => Promise<{
          lat: number;
          lng: number;
          label?: string;
        } | null>;
      };
      const pref = await awaitNavDestPrefetch(name);
      if (pref) {
        lat = pref.lat;
        lng = pref.lng;
        if (pref.label) name = pref.label;
      }
    } catch {
      /* soft */
    }
  }
""",
    "hardnav_pack_first",
    already="Pack-POI zuerst (Tennis-Club",
)

# Defer city polygons out of early polish ladder — big jank source
patch_once(
    "src/components/homeMap/HomePresenceMap.tsx",
    """                    if (yorroContentAt(warmLat, warmLng)) {
                      noteMapPlacesReady(warmActive);
                    }
                    citiesForceRef.current = true;
                    injectCitiesRef.current();
                    citiesForceRef.current = false;
                  });
                });
              }, HOME_MAP_PLACES_PAINT_AFTER_SPLASH_MS);
""",
    """                    if (yorroContentAt(warmLat, warmLng)) {
                      noteMapPlacesReady(warmActive);
                    }
                    // Städte-Polygone erst später — sonst 1–2 Min Ruckeln nach Boot.
                  });
                });
              }, HOME_MAP_PLACES_PAINT_AFTER_SPLASH_MS);
""",
    "defer_cities_polish",
    already="Städte-Polygone erst später",
)

# Inject cities with fog ladder (later)
patch_once(
    "src/components/homeMap/HomePresenceMap.tsx",
    """              setTimeout(() => {
                runIdle(() => {
                  yieldThen(() => {
                    if (__DEV__) console.log('[homeMapBoot] ladder:fog');
                    void loadWalkTrack()
                      .then((track) => {
                        walkTrackRef.current = track;
                        if (!isMapUserGesturing()) forceFogRecompute(track);
                      })
                      .catch(() => undefined);
                  });
                });
              }, HOME_MAP_FOG_AFTER_SPLASH_MS);
""",
    """              setTimeout(() => {
                runIdle(() => {
                  yieldThen(() => {
                    if (__DEV__) console.log('[homeMapBoot] ladder:fog');
                    void loadWalkTrack()
                      .then((track) => {
                        walkTrackRef.current = track;
                        if (!isMapUserGesturing()) forceFogRecompute(track);
                      })
                      .catch(() => undefined);
                    if (!isMapUserGesturing() && mapLayerDebugAllows('cities')) {
                      citiesForceRef.current = true;
                      injectCitiesRef.current();
                      citiesForceRef.current = false;
                    }
                  });
                });
              }, HOME_MAP_FOG_AFTER_SPLASH_MS);
""",
    "cities_with_fog_ladder",
    already="ladder:fog');\n                    void loadWalkTrack()\n                      .then((track) => {\n                        walkTrackRef.current = track;\n                        if (!isMapUserGesturing()) forceFogRecompute(track);\n                      })\n                      .catch(() => undefined);\n                    if (!isMapUserGesturing() && mapLayerDebugAllows('cities'))",
)

print("batch4 done")
