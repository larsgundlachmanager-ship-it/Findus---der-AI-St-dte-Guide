# -*- coding: utf-8 -*-
from pathlib import Path
import os

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
        raise SystemExit(f"{label}: old not found")
    write_text(p, t.replace(old, new, 1))
    print(f"{label}: OK")


# --- Extend navDestPrefetch with kickInstantMapNav ---
pref = ROOT / "src/services/navigation/navDestPrefetch.ts"
pt = pref.read_text(encoding="utf-8")
if "kickInstantMapNav" in pt:
    print("kickInstantMapNav: already in file")
else:
    append = r'''

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
        const st = useFinnusStore.getState();
        const live = getActiveNavDestination();
        if (st.navActive && live) {
          const nameA = String(live.name || st.navTargetName || '').toLowerCase();
          const nameB = destName.toLowerCase();
          const nameHit =
            (nameA.length >= 4 && nameB.includes(nameA.slice(0, 10))) ||
            (nameB.length >= 4 && nameA.includes(nameB.slice(0, 10)));
          let near = false;
          if (typeof live.lat === 'number' && typeof live.lng === 'number') {
            const dLat = live.lat - hit.lat;
            const dLng = live.lng - hit.lng;
            near = dLat * dLat + dLng * dLng < 1e-7;
          }
          if (near || nameHit) return;
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
'''
    write_text(pref, pt.rstrip() + "\n" + append)
    print("kickInstantMapNav: OK")


# early address → kickInstantMapNav
patch_once(
    "src/module2/router/runConciergeTurn.ts",
    """      // Geocode sofort parallel zur Bridge — nicht erst nach setTimeout/Family-Classify.
      try {
        const { kickNavDestPrefetch } = require('../../services/navigation/navDestPrefetch') as {
          kickNavDestPrefetch: (o: {
            destLabel: string;
            userText?: string | null;
          }) => void;
        };
        kickNavDestPrefetch({
          destLabel: address,
          userText: rewritten || rawUserTextForCall1,
        });
      } catch {
        /* soft */
      }""",
    """      // Geocode + Pin/Route sofort parallel zur Bridge — Karte malt während TTS.
      try {
        const { kickInstantMapNav } = require('../../services/navigation/navDestPrefetch') as {
          kickInstantMapNav: (o: {
            destLabel: string;
            userText?: string | null;
          }) => void;
        };
        kickInstantMapNav({
          destLabel: address,
          userText: rewritten || rawUserTextForCall1,
        });
      } catch {
        /* soft */
      }""",
    "earlyInstantMap",
    "kickInstantMapNav",
)

# kickCall1 import + call
patch_once(
    "src/services/concierge/kickCall1ParallelWork.ts",
    """          const { kickNavDestPrefetch } = require('../navigation/navDestPrefetch') as {
            kickNavDestPrefetch: (o: {
              destLabel: string;
              userText?: string | null;
            }) => void;
          };""",
    """          const { kickInstantMapNav } = require('../navigation/navDestPrefetch') as {
            kickInstantMapNav: (o: {
              destLabel: string;
              userText?: string | null;
            }) => void;
          };""",
    "kickImportInstant",
    "kickInstantMapNav: (o: {\n              destLabel: string;\n              userText?: string | null;\n            }) => void;\n          };\n          const earlyDest",
)

# If first replace already happened partially, try alternate
p = ROOT / "src/services/concierge/kickCall1ParallelWork.ts"
kt = p.read_text(encoding="utf-8")
if "kickInstantMapNav" not in kt and "kickNavDestPrefetch" in kt:
    kt2 = kt.replace(
        """          if (!startedWithCoords && earlyDest) {
            kickNavDestPrefetch({
              destLabel: earlyDest,
              userText: raw || rewritten,
            });
          }""",
        """          if (!startedWithCoords && earlyDest) {
            kickInstantMapNav({
              destLabel: earlyDest,
              userText: raw || rewritten,
            });
          }""",
        1,
    )
    # also fix import if still kickNavDestPrefetch
    if "kickNavDestPrefetch" in kt2 and "kickInstantMapNav" in kt2:
        # mixed - replace import
        kt2 = kt2.replace(
            "kickNavDestPrefetch",
            "kickInstantMapNav",
        )
        # might have broken kickInstantMapNav name in require path comments - check
    elif "kickNavDestPrefetch" in kt2:
        kt2 = kt2.replace(
            """          const { kickNavDestPrefetch } = require('../navigation/navDestPrefetch') as {
            kickNavDestPrefetch: (o: {
              destLabel: string;
              userText?: string | null;
            }) => void;
          };""",
            """          const { kickInstantMapNav } = require('../navigation/navDestPrefetch') as {
            kickInstantMapNav: (o: {
              destLabel: string;
              userText?: string | null;
            }) => void;
          };""",
            1,
        )
    write_text(p, kt2)
    print("kickCall1: patched alt")
elif "kickInstantMapNav" in kt:
    # ensure call site
    if "kickNavDestPrefetch({" in kt:
        write_text(
            p,
            kt.replace(
                "kickNavDestPrefetch({",
                "kickInstantMapNav({",
                1,
            ),
        )
        print("kickCall1: call site fixed")
    else:
        print("kickCall1: already ok")
else:
    print("kickCall1: unexpected state")


# hardOverride skip
patch_once(
    "src/services/navigation/hardNavOverride.ts",
    """  // Schon unterwegs zum gleichen Ziel → nicht clear+restart (Latenz)
  try {
    const { getActiveNavDestination } = require('./navigationService') as {
      getActiveNavDestination: () => {
        name?: string | null;
        lat?: number | null;
        lng?: number | null;
      } | null;
    };
    const live = getActiveNavDestination();
    if (
      live &&
      useFinnusStore.getState().navActive &&
      lat != null &&
      lng != null &&
      typeof live.lat === 'number' &&
      typeof live.lng === 'number'
    ) {
      const dLat = live.lat - lat;
      const dLng = live.lng - lng;
      const near = dLat * dLat + dLng * dLng < 1e-7; // ~30 m
      const nameHit =
        String(live.name || '')
          .toLowerCase()
          .includes(name.toLowerCase().slice(0, 10)) ||
        name.toLowerCase().includes(String(live.name || '').toLowerCase().slice(0, 10));
      if (near || nameHit) {
        return {
          ok: true,
          name: live.name || name,
          replaced: true,
          reply: `Alles klar — ich führ dich weiter zu ${live.name || name}.`,
        };
      }
    }
  } catch {
    /* soft */
  }
  await clearNavigationHard({ silent: true });""",
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
  // Schon unterwegs zum gleichen Ziel (Bridge-Instant-Commit) → kein clear+restart
  try {
    const { getActiveNavDestination } = require('./navigationService') as {
      getActiveNavDestination: () => {
        name?: string | null;
        lat?: number | null;
        lng?: number | null;
      } | null;
    };
    const live = getActiveNavDestination();
    if (live && useFinnusStore.getState().navActive) {
      const nameHit =
        String(live.name || '')
          .toLowerCase()
          .includes(name.toLowerCase().slice(0, 10)) ||
        name.toLowerCase().includes(String(live.name || '').toLowerCase().slice(0, 10));
      let near = false;
      if (
        lat != null &&
        lng != null &&
        typeof live.lat === 'number' &&
        typeof live.lng === 'number'
      ) {
        const dLat = live.lat - lat;
        const dLng = live.lng - lng;
        near = dLat * dLat + dLng * dLng < 1e-7;
      }
      if (near || nameHit) {
        return {
          ok: true,
          name: live.name || name,
          replaced: true,
          reply: `Alles klar — ich führ dich weiter zu ${live.name || name}.`,
        };
      }
    }
  } catch {
    /* soft */
  }
  await clearNavigationHard({ silent: true });""",
    "hardSkipRestart",
    "Bridge-Instant-Commit",
)


# HomePresenceMap: paint concierge instant preview while loading
patch_once(
    "src/components/homeMap/HomePresenceMap.tsx",
    """    if (!liveActive && !tourOpen) {
      const offer = useFinnusStore.getState().pendingNavOffer;
      const previewStore = useMapRouteStore.getState().route;
      const hasWegweiserPreview =
        offer?.source === 'wegweiser' &&
        offer.awaitConfirm === true &&
        (offer.previewRoute?.length ?? 0) >= 2;
      if (hasWegweiserPreview) {
        const street =
          (offer.previewRoute?.length ?? 0) >= 2 ? offer.previewRoute! : [];
        const payload =
          previewStore?.preview === true &&
          (previewStore.current?.length ?? 0) >= 2
            ? { ...previewStore, preview: true }
            : {
                current: street,
                ahead: [],
                pins: [
                  {
                    lat: offer.lat!,
                    lng: offer.lng!,
                    n: 1,
                    name: offer.name,
                  },
                ],
                arrows: [],
                preview: true,
                previewPin: { lat: offer.lat!, lng: offer.lng! },
              };
        const json = navRoutePayloadSig(payload);
        if (json !== lastRouteJson.current) {
          lastRouteJson.current = json;
          setMapRoute(payload);
        }
        return;
      }""",
    """    if (!liveActive && !tourOpen) {
      const offer = useFinnusStore.getState().pendingNavOffer;
      const previewStore = useMapRouteStore.getState().route;
      const loading = useFinnusStore.getState().navRouteLoading === true;
      const hasWegweiserPreview =
        offer?.source === 'wegweiser' &&
        offer.awaitConfirm === true &&
        (offer.previewRoute?.length ?? 0) >= 2;
      // Bridge-Instant: Dest-Pin (+ grobe Linie) schon während TTS / Geocode→Commit.
      const hasInstantBridgePreview =
        loading &&
        offer != null &&
        typeof offer.lat === 'number' &&
        typeof offer.lng === 'number' &&
        (offer.source === 'concierge' || offer.source === 'other');
      if (hasWegweiserPreview || hasInstantBridgePreview) {
        const street =
          (offer!.previewRoute?.length ?? 0) >= 2
            ? offer!.previewRoute!
            : [];
        const payload =
          previewStore?.preview === true &&
          (previewStore.current?.length ?? 0) >= 2
            ? { ...previewStore, preview: true }
            : {
                current: street,
                ahead: [],
                pins: [
                  {
                    lat: offer!.lat!,
                    lng: offer!.lng!,
                    n: 1,
                    name: offer!.name,
                  },
                ],
                arrows: [],
                preview: true,
                previewPin: { lat: offer!.lat!, lng: offer!.lng! },
              };
        const json = navRoutePayloadSig(payload);
        if (json !== lastRouteJson.current) {
          lastRouteJson.current = json;
          setMapRoute(payload);
        }
        return;
      }""",
    "mapInstantPreview",
    "hasInstantBridgePreview",
)

# also re-inject when navRouteLoading flips (so pin appears without waiting for offer effect only)
# pendingNavOffer already in deps - good when we setPendingNavOffer.
# Add navRouteLoading to the effect deps that call injectNavRoute
patch_once(
    "src/components/homeMap/HomePresenceMap.tsx",
    """  useEffect(() => {
    injectNavRoute();
    if (readyRef.current) injectPlacesOnly();
  }, [injectNavRoute, injectPlacesOnly, pendingNavOffer]);""",
    """  useEffect(() => {
    injectNavRoute();
    if (readyRef.current) injectPlacesOnly();
  }, [injectNavRoute, injectPlacesOnly, pendingNavOffer, navRouteLoading]);""",
    "mapLoadingDeps",
    "pendingNavOffer, navRouteLoading",
)


# smokes
patch_once(
    "src/services/concierge/call1ParallelWork.smoke.test.ts",
    """assert(/kickNavDestPrefetch/.test(kickSrc), 'nav kick');""",
    """assert(
  /kickInstantMapNav/.test(kickSrc) || /kickNavDestPrefetch/.test(kickSrc),
  'nav kick / instant map',
);""",
    "smokeKick",
    "instant map",
)

# replace older smoke asserts if present
p = ROOT / "src/services/concierge/call1ParallelWork.smoke.test.ts"
st = p.read_text(encoding="utf-8")
if "address bridge commits map nav" not in st:
    st2 = st.replace(
        """assert(
  /kickNavDestPrefetch/.test(turnSrc) &&
    /Geocode sofort parallel zur Bridge/.test(turnSrc),
  'address bridge starts geocode in same tick',
);""",
        """assert(
  /kickInstantMapNav/.test(turnSrc),
  'address bridge commits map nav while TTS speaks',
);
assert(
  /kickInstantMapNav/.test(prefetchSrc),
  'prefetch module exports instant map nav',
);""",
    )
    if st2 == st:
        # insert before console.log
        st2 = st.replace(
            "console.log('call1ParallelWork.smoke.test.ts OK');",
            """assert(
  /kickInstantMapNav/.test(turnSrc),
  'address bridge commits map nav while TTS speaks',
);
assert(
  /kickInstantMapNav/.test(prefetchSrc),
  'prefetch module exports instant map nav',
);

console.log('call1ParallelWork.smoke.test.ts OK');""",
        )
    write_text(p, st2)
    print("smokeTurn: OK")
else:
    print("smokeTurn: already")

print("ALL DONE")
