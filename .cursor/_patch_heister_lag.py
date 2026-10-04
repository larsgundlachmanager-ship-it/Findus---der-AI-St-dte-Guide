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


# 1) Early address bridge: start geocode in same tick as TTS (no setTimeout wait)
patch_once(
    "src/module2/router/runConciergeTurn.ts",
    """      const peek = buildExplicitNavBridgeSpeech(speechName);
      call1LeadEarly = peek;
      beat1Locked = true;
      try {
        useFinnusStore.getState().setNavRouteLoading(true);
      } catch {
        /* soft */
      }
      try {
        const { markBridgeFirst } = require('../reboot/pipeline/turnLatencyMetrics') as {
          markBridgeFirst: () => void;
        };
        markBridgeFirst();
      } catch {
        /* soft */
      }
      earlyBridgePromise = speakModuleWaitBridge(peek, turnId, {
        userText: rewritten || rawUserTextForCall1,
      }).then((spoken) => {
        if (spoken) bridgeSpokenDuringAnalyze = true;
        else beat1Locked = false;
        return spoken;
      });
    }""",
    """      const peek = buildExplicitNavBridgeSpeech(speechName);
      call1LeadEarly = peek;
      beat1Locked = true;
      try {
        useFinnusStore.getState().setNavRouteLoading(true);
      } catch {
        /* soft */
      }
      // Geocode sofort parallel zur Bridge — nicht erst nach setTimeout/Family-Classify.
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
      }
      try {
        const { markBridgeFirst } = require('../reboot/pipeline/turnLatencyMetrics') as {
          markBridgeFirst: () => void;
        };
        markBridgeFirst();
      } catch {
        /* soft */
      }
      earlyBridgePromise = speakModuleWaitBridge(peek, turnId, {
        userText: rewritten || rawUserTextForCall1,
      }).then((spoken) => {
        if (spoken) bridgeSpokenDuringAnalyze = true;
        else beat1Locked = false;
        return spoken;
      });
    }""",
    "bridgePrefetch",
    "Geocode sofort parallel zur Bridge",
)

# 2) kickCall1: street address / hard dest without requiring nav verb
patch_once(
    "src/services/concierge/kickCall1ParallelWork.ts",
    """    if (family === 'nav' || family === 'unknown') {
      try {
        const { isExplicitNavIntent } = require('../intent/poiInfoVsNav') as {
          isExplicitNavIntent: (s: string) => boolean;
        };
        if (isExplicitNavIntent(raw) || isExplicitNavIntent(rewritten)) {
          const { detectHardNavOverride } = require('../navigation/hardNavOverride') as {
            detectHardNavOverride: (t: string) => string | null;
          };
          const { extractNamedDestinationLabel } = require('../concierge/canonicalDestination') as {
            extractNamedDestinationLabel: (t: string) => string | null;
          };
          const { kickNavDestPrefetch } = require('../navigation/navDestPrefetch') as {
            kickNavDestPrefetch: (o: {
              destLabel: string;
              userText?: string | null;
            }) => void;
          };
          const earlyDest =
            detectHardNavOverride(rewritten) ||
            detectHardNavOverride(raw) ||
            extractNamedDestinationLabel(rewritten) ||
            extractNamedDestinationLabel(raw);""",
    """    if (family === 'nav' || family === 'unknown') {
      try {
        const { isExplicitNavIntent } = require('../intent/poiInfoVsNav') as {
          isExplicitNavIntent: (s: string) => boolean;
        };
        const { extractStreetAddressFromUtterance } = require('../navigation/streetAddressQuery') as {
          extractStreetAddressFromUtterance: (s: string) => string | null;
        };
        const streetAddr =
          extractStreetAddressFromUtterance(rewritten) ||
          extractStreetAddressFromUtterance(raw);
        // Adresse allein = Nav-Auftrag (Hard-Dest) — Prefetch nicht hinter Verb-Gate stellen.
        if (
          isExplicitNavIntent(raw) ||
          isExplicitNavIntent(rewritten) ||
          !!streetAddr
        ) {
          const { detectHardNavOverride } = require('../navigation/hardNavOverride') as {
            detectHardNavOverride: (t: string) => string | null;
          };
          const { extractNamedDestinationLabel } = require('../concierge/canonicalDestination') as {
            extractNamedDestinationLabel: (t: string) => string | null;
          };
          const { kickNavDestPrefetch } = require('../navigation/navDestPrefetch') as {
            kickNavDestPrefetch: (o: {
              destLabel: string;
              userText?: string | null;
            }) => void;
          };
          const earlyDest =
            streetAddr ||
            detectHardNavOverride(rewritten) ||
            detectHardNavOverride(raw) ||
            extractNamedDestinationLabel(rewritten) ||
            extractNamedDestinationLabel(raw);""",
    "kickStreet",
    "streetAddr",
)

# 3) smoke asserts
patch_once(
    "src/services/concierge/call1ParallelWork.smoke.test.ts",
    """assert(
  /early address nav bridge/.test(turnSrc) &&
    /extractStreetAddressFromUtterance/.test(turnSrc),
  'street+housenumber gets deterministic early bridge',
);""",
    """assert(
  /early address nav bridge/.test(turnSrc) &&
    /extractStreetAddressFromUtterance/.test(turnSrc),
  'street+housenumber gets deterministic early bridge',
);
assert(
  /kickNavDestPrefetch/.test(turnSrc) &&
    /Geocode sofort parallel zur Bridge/.test(turnSrc),
  'address bridge starts geocode in same tick',
);
assert(
  /streetAddr/.test(kickSrc) || /extractStreetAddressFromUtterance/.test(kickSrc),
  'kick prefetches bare street+housenumber without nav verb',
);""",
    "smokeStreet",
    "Geocode sofort parallel zur Bridge",
)

# 4) navigationService: await offline + cache overlap more cleanly
patch_once(
    "src/services/navigation/navigationService.ts",
    """  const isSimulation = useFinnusStore.getState().isSimulationMode;
  let offlineOnly = opts.offlineOnly === true;
  // Disk route lookup and network-state probe are independent. Starting both
  // together removes their former 400 ms + 800 ms serial delay before navActive,
  // GPS tracking and cue scheduling can commit.
  const cachedRouteP = Promise.race([
    getCachedRoute(opts.lat, opts.lng),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), 800)),
  ]).catch(() => null);

  if (!offlineOnly && !isSimulation) {
    try {
      const offline = await Promise.race([
        isDeviceOffline(),
        new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 400)),
      ]);
      if (offline) offlineOnly = true;
    } catch {
      /* online annehmen */
    }
  }

  const spotKey = opts.spotKey ?? null;
  let waypoints: NavWaypoint[] = [];
  try {
    waypoints = offlineOnly ? [] : getNavWaypointsForSpot(spotKey);
  } catch {
    waypoints = [];
  }
  // Online: Cache sofort zeigen — darf den Start nicht blockieren
  let cachedRoute: Awaited<ReturnType<typeof getCachedRoute>> = null;
  try {
    cachedRoute = await cachedRouteP;
  } catch {
    cachedRoute = null;
  }""",
    """  const isSimulation = useFinnusStore.getState().isSimulationMode;
  let offlineOnly = opts.offlineOnly === true;
  // Disk-Cache und Offline-Probe parallel — früher navActive / GPS / Cues.
  const cachedRouteP = Promise.race([
    getCachedRoute(opts.lat, opts.lng),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), 800)),
  ]).catch(() => null);
  const offlineP =
    !offlineOnly && !isSimulation
      ? Promise.race([
          isDeviceOffline(),
          new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 400)),
        ]).catch(() => false)
      : Promise.resolve(false);

  const [cachedRouteSettled, offlineSettled] = await Promise.all([
    cachedRouteP,
    offlineP,
  ]);
  if (offlineSettled) offlineOnly = true;

  const spotKey = opts.spotKey ?? null;
  let waypoints: NavWaypoint[] = [];
  try {
    waypoints = offlineOnly ? [] : getNavWaypointsForSpot(spotKey);
  } catch {
    waypoints = [];
  }
  // Online: Cache sofort zeigen — darf den Start nicht blockieren
  let cachedRoute: Awaited<ReturnType<typeof getCachedRoute>> = null;
  cachedRoute = cachedRouteSettled;""",
    "navParallelAwait",
    "cachedRouteSettled",
)

print("done")
