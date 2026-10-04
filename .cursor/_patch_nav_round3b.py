# -*- coding: utf-8 -*-
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
        raise SystemExit(f"{label}: old not found")
    write_text(p, t.replace(old, new, 1))
    print(f"{label}: OK")


# landmarks: weak → road cue instead of skip
patch_once(
    "src/services/navigation/handsFreeNav/landmarks.ts",
    """      try {
        const { isWeakVisualLandmark } = require('../visualLandmarkQuality') as {
          isWeakVisualLandmark: (l: string | null | undefined) => boolean;
        };
        if (isWeakVisualLandmark(landmark)) {
          // Schwache Outdoor-Marker (Briefkasten/Bank/…) → Straße/Allee statt Fake-Landmarke
          landmark = null;
        }
      } catch {
        /* soft */
      }
      if (!landmark) return;

      let bestIdx = -1;
      let bestD = 40;
      for (let d = 0; d < dense.length; d++) {
        const dist = distanceMeters(dense[d].lat, dense[d].lng, wp.lat, wp.lng);
        if (dist < bestD) {
          bestD = dist;
          bestIdx = d;
        }
      }
      if (bestIdx < 0) return;
      const turn = turnWord(wp.maneuver);
      const road = (wp.roadName || dense[bestIdx]?.roadName || '').trim() || null;
      const cue =
        turn !== 'geradeaus'
          ? scrubRoboticNavSpeak(
              buildLandmarkFirstCue({
                landmark,
                relation: {
                  side: 'front',
                  bearingRelDeg: 0,
                  sidePhrase: 'voraus',
                  shortPhrase: 'vor dir',
                },
                turn,
                // Straße nur wenn Landmarke allein zu schwach wäre — hier schon gefiltert
                roadName: road && /\\b(allee|straße|strasse|weg)\\b/iu.test(road) ? road : null,
              }),
            )
          : buildTurnWithoutLandmark(turn, road);
      dense[bestIdx] = {
        ...dense[bestIdx],
        landmark,
        visibleLandmark: landmark,
        cue,
      };""",
    """      try {
        const { isWeakVisualLandmark } = require('../visualLandmarkQuality') as {
          isWeakVisualLandmark: (l: string | null | undefined) => boolean;
        };
        if (isWeakVisualLandmark(landmark)) {
          // Schwache Outdoor-Marker (Briefkasten/Bank/Broschüren…) → Straße/Allee
          landmark = null;
        }
      } catch {
        /* soft */
      }

      let bestIdx = -1;
      let bestD = 40;
      for (let d = 0; d < dense.length; d++) {
        const dist = distanceMeters(dense[d].lat, dense[d].lng, wp.lat, wp.lng);
        if (dist < bestD) {
          bestD = dist;
          bestIdx = d;
        }
      }
      if (bestIdx < 0) return;
      const turn = turnWord(wp.maneuver);
      const road = (wp.roadName || dense[bestIdx]?.roadName || '').trim() || null;
      if (!landmark) {
        if (turn === 'geradeaus' || !road) return;
        dense[bestIdx] = {
          ...dense[bestIdx],
          landmark: null,
          visibleLandmark: null,
          cue: scrubRoboticNavSpeak(buildTurnWithoutLandmark(turn, road)),
        };
        return;
      }
      const cue =
        turn !== 'geradeaus'
          ? scrubRoboticNavSpeak(
              buildLandmarkFirstCue({
                landmark,
                relation: {
                  side: 'front',
                  bearingRelDeg: 0,
                  sidePhrase: 'voraus',
                  shortPhrase: 'vor dir',
                },
                turn,
                roadName: null,
              }),
            )
          : buildTurnWithoutLandmark(turn, road);
      dense[bestIdx] = {
        ...dense[bestIdx],
        landmark,
        visibleLandmark: landmark,
        cue,
      };""",
    "landmarksRoadFallback",
    "Broschüren",
)

# buildFinalCueText: drop weak landmarks
patch_once(
    "src/services/navigation/handsFreeNav/cueScheduler.ts",
    """  const visualKind = visualKindOf({
    maneuver: opts.maneuver,
    roadName: opts.roadName,
    isComplexTurn: opts.isComplexTurn,
  });
  if (opts.landmark && turn !== 'geradeaus') {
    return scrubRoboticNavSpeak(
      buildLandmarkFirstCue({
        landmark: opts.landmark,
        relation: {
          side: 'front',
          bearingRelDeg: 0,
          sidePhrase: 'voraus',
          shortPhrase: 'vor dir',
        },
        turn,
        roadName: opts.roadName,
        visualKind,
      }),
    );
  }""",
    """  const visualKind = visualKindOf({
    maneuver: opts.maneuver,
    roadName: opts.roadName,
    isComplexTurn: opts.isComplexTurn,
  });
  let landmark = opts.landmark;
  try {
    const { isWeakVisualLandmark } = require('../visualLandmarkQuality') as {
      isWeakVisualLandmark: (l: string | null | undefined) => boolean;
    };
    if (isWeakVisualLandmark(landmark)) landmark = null;
  } catch {
    /* soft */
  }
  if (landmark && turn !== 'geradeaus') {
    return scrubRoboticNavSpeak(
      buildLandmarkFirstCue({
        landmark,
        relation: {
          side: 'front',
          bearingRelDeg: 0,
          sidePhrase: 'voraus',
          shortPhrase: 'vor dir',
        },
        turn,
        roadName: opts.roadName,
        visualKind,
      }),
    );
  }""",
    "finalCueWeak",
    "isWeakVisualLandmark(landmark)",
)

# tickCoach: filter landmark at speak time
patch_once(
    "src/services/navigation/handsFreeNav/tickCoach.ts",
    """  const landmark =
    turnWp?.visibleLandmark?.trim() || turnWp?.landmark?.trim() || null;""",
    """  let landmark =
    turnWp?.visibleLandmark?.trim() || turnWp?.landmark?.trim() || null;
  try {
    const { isWeakVisualLandmark } = require('../visualLandmarkQuality') as {
      isWeakVisualLandmark: (l: string | null | undefined) => boolean;
    };
    if (isWeakVisualLandmark(landmark)) landmark = null;
  } catch {
    /* soft */
  }""",
    "tickCoachWeak",
    "isWeakVisualLandmark(landmark)",
)

# applyHudFollowPrefs comment cleanup + don't leave heading stuck when location lock without heading
patch_once(
    "src/components/homeMap/HomePresenceMap.tsx",
    """        // Google: Location-Lock koppelt Heading.
        if (prefs.headingFollow === true) {
          headingFollowRef.current = true;
          setHeadingFollow(true);
          mapRef.current?.setHeadingFollow(true);
        }
        mapRef.current?.reattachFollow();""",
    """        // Location-Follow und Heading-Follow sind getrennt wählbar.
        if (prefs.headingFollow === true) {
          headingFollowRef.current = true;
          setHeadingFollow(true);
          mapRef.current?.setHeadingFollow(true);
        } else if (prefs.headingFollow === false) {
          // Recenter-Lock darf einen aktiven Kompass nicht anfassen —
          // nur explizit false vom Kompass-Button schaltet ab (siehe onNorthUp).
        }
        mapRef.current?.reattachFollow();""",
    "hudComment",
    "getrennt wählbar",
)

# smoke test update
smoke = ROOT / "src/services/navigation/walkReassure.smoke.test.ts"
write_text(
    smoke,
    """/**
 * Run: npx --yes tsx src/services/navigation/walkReassure.smoke.test.ts
 */
import {
  bucketTeaserMeters,
  shouldFireWalkReassure,
  walkReassureGapMs,
  walkReassureSpeech,
  WALK_REASSURE_SILENCE_MS,
} from './walkReassure';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

assert(bucketTeaserMeters(470) === 500, 'Meter runden');
assert(bucketTeaserMeters(320) === 300, '300er Bucket');
assert(WALK_REASSURE_SILENCE_MS === 5 * 60_000, '5 Min Stille');

const firstGap = walkReassureGapMs({
  stretchM: 1000,
  speedMps: 1.25,
  transportMode: 'walk',
  isFirst: true,
});
const laterGap = walkReassureGapMs({
  stretchM: 1000,
  speedMps: 1.25,
  transportMode: 'walk',
  isFirst: false,
});
assert(firstGap >= WALK_REASSURE_SILENCE_MS, `Gap >= 5 Min (${firstGap})`);
assert(laterGap >= WALK_REASSURE_SILENCE_MS, `later Gap >= 5 Min (${laterGap})`);

const t1 = walkReassureSpeech({
  remainingRouteM: 1000,
  distanceToNextTurnM: 800,
});
assert(/800|richtig/i.test(t1), `Teaser mit Metern zur Gabelung: ${t1}`);

const t2 = walkReassureSpeech({
  remainingRouteM: 500,
  distanceToNextTurnM: null,
});
assert(/500/.test(t2), `kurzer Meter-Teaser: ${t2}`);

const now = 1_000_000;
assert(
  !shouldFireWalkReassure({
    stretchM: 1000,
    distanceToTurnM: 1000,
    turnSpeakStartM: 12,
    remainingRouteM: 1000,
    speedMps: 1.25,
    transportMode: 'walk',
    userMoving: true,
    nowMs: now + 90_000,
    lastReassureAtMs: 0,
    lastSpokenAtMs: now,
    stretchArmedAtMs: now,
  }),
  'nach 90s Stille noch kein Teaser',
);
assert(
  shouldFireWalkReassure({
    stretchM: 1000,
    distanceToTurnM: 900,
    turnSpeakStartM: 12,
    remainingRouteM: 1000,
    speedMps: 1.25,
    transportMode: 'walk',
    userMoving: true,
    nowMs: now + WALK_REASSURE_SILENCE_MS + 500,
    lastReassureAtMs: 0,
    lastSpokenAtMs: now,
    stretchArmedAtMs: now,
  }),
  'nach 5 Min Stille Teaser',
);
assert(
  !shouldFireWalkReassure({
    stretchM: 40,
    distanceToTurnM: 40,
    turnSpeakStartM: 12,
    remainingRouteM: 40,
    speedMps: 1.25,
    transportMode: 'walk',
    userMoving: true,
    nowMs: now + 400_000,
    lastReassureAtMs: now,
    lastSpokenAtMs: now,
    stretchArmedAtMs: now,
  }),
  'kurz vor der Gabelung kein Teaser',
);
assert(
  !shouldFireWalkReassure({
    stretchM: 1000,
    distanceToTurnM: 900,
    turnSpeakStartM: 12,
    remainingRouteM: 1000,
    speedMps: 1.25,
    transportMode: 'transit_bus',
    userMoving: true,
    nowMs: now + WALK_REASSURE_SILENCE_MS + 500,
    lastReassureAtMs: 0,
    lastSpokenAtMs: now,
    stretchArmedAtMs: now,
  }),
  'ÖPNV kein Reassure',
);

console.log('walkReassure.smoke.test.ts OK');
""",
)
print("smoke: OK")

# small visual landmark quality smoke
write_text(
    ROOT / "src/services/navigation/visualLandmarkQuality.smoke.test.ts",
    """/**
 * Run: npx --yes tsx src/services/navigation/visualLandmarkQuality.smoke.test.ts
 */
import {
  isWeakVisualLandmark,
  looksLikeStreetLandmark,
} from './visualLandmarkQuality';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

assert(isWeakVisualLandmark('Briefkasten'), 'briefkasten weak');
assert(isWeakVisualLandmark('Broschürenplatz'), 'broschuere weak');
assert(isWeakVisualLandmark('Laden (convenience)'), 'laden weak');
assert(!isWeakVisualLandmark('Ampel'), 'ampel ok');
assert(!isWeakVisualLandmark('Kirche St. Nikolai'), 'kirche ok');
assert(looksLikeStreetLandmark('Bahnhofstraße'), 'street');
assert(looksLikeStreetLandmark('Lindenallee'), 'allee');

console.log('visualLandmarkQuality.smoke.test.ts OK');
""",
)
print("visual smoke: OK")
print("DONE")
