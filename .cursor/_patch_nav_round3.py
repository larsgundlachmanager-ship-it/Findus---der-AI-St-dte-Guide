# -*- coding: utf-8 -*-
"""Round-3 nav feedback patches — write via temp+os.replace (OneDrive-safe)."""
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


# --- 1 cueScheduler: no post-turn confirm speech ---
patch_once(
    "src/services/navigation/handsFreeNav/cueScheduler.ts",
    """  // Confirm after passing turn
  if (
    confirmedTurnIndex !== turnIdx &&
    dist < 8 &&
    lastSpokenPhaseKey?.startsWith('final:')
  ) {
    const key = phaseKey('confirm', turnIdx);
    if (lastSpokenPhaseKey !== key) {
      confirmedTurnIndex = turnIdx;
      const text = buildConfirmText();
      lastSpokenPhaseKey = key;
      lastSpokenAtMs = now;
      return {
        phase: 'confirm',
        waypointIndex: turnIdx,
        text,
        speakStartDistanceM: 8,
        speechSec: estimateSpeechSec(text),
      };
    }
  }""",
    """  // Nach Abbiegung: nur still markieren — kein \"du bist richtig\" (erst nach ~5 Min Stille).
  if (
    confirmedTurnIndex !== turnIdx &&
    dist < 8 &&
    lastSpokenPhaseKey?.startsWith('final:')
  ) {
    confirmedTurnIndex = turnIdx;
    lastSpokenPhaseKey = phaseKey('confirm', turnIdx);
  }""",
    "cueScheduler",
    "erst nach ~5 Min",
)

# --- 2 earlier turn speak ---
patch_once(
    "src/services/navigation/speakStartDistance.ts",
    """export const FINISH_BEFORE_TURN_SEC = 2.5;
export const FINAL_FLOOR_M = 8;
/** Zu Fuß früher ansagen — genug Zeit zum Hören + reagieren. */
export const FINAL_CEILING_WALK_M = 120;
export const FINAL_CEILING_BIKE_M = 220;""",
    """export const FINISH_BEFORE_TURN_SEC = 4.0;
export const FINAL_FLOOR_M = 12;
/** Zu Fuß früher ansagen — genug Zeit zum Hören + reagieren. */
export const FINAL_CEILING_WALK_M = 160;
export const FINAL_CEILING_BIKE_M = 280;""",
    "speakStartDistance",
    "FINISH_BEFORE_TURN_SEC = 4.0",
)

# --- 3 early warn distances larger ---
patch_once(
    "src/services/navigation/handsFreeNav/cueScheduler.ts",
    """    const earlyM =
      opts.transportMode === 'bicycle'
        ? Math.max(startM + 55, 95)
        : Math.max(startM + 40, 55);""",
    """    const earlyM =
      opts.transportMode === 'bicycle'
        ? Math.max(startM + 80, 130)
        : Math.max(startM + 55, 85);""",
    "earlyWarn",
    "startM + 80",
)

# --- 4 arrivalSoon: never fake Schild from dest name ---
patch_once(
    "src/services/navigation/handsFreeNav/tickCoach.ts",
    """    const sign =
      session.destinationName.trim().length >= 3
        ? session.destinationName.trim()
        : null;
    void speak(
      buildArrivalSoonCue(
        session.destinationName,
        relateFromRelativeBearing(tick.bearingRelDeg),
        { visualSign: sign },
      ),
    );""",
    """    void speak(
      buildArrivalSoonCue(
        session.destinationName,
        relateFromRelativeBearing(tick.bearingRelDeg),
        { visualSign: null },
      ),
    );""",
    "arrivalSoon",
    "visualSign: null",
)

# --- 5 arrival: always speak arrived cue (even with POI story) ---
patch_once(
    "src/services/navigation/navigationService.ts",
    """          const { triggerPoiArrival } = await import('../../runtime/exploreModule');
          await triggerPoiArrival(storyPoiId, {
            force: true,
            skipWegweiser: true,
          });
        } else {
          const { buildArrivedCue } = await import('./spatialOrientation');
          await speakAssistantText(buildArrivedCue(destName));
        }""",
    """          const { buildArrivedCue } = await import('./spatialOrientation');
          await speakAssistantText(buildArrivedCue(destName));
          try {
            const { vibrateNavTurn } = await import('./navTurnHaptics') as {
              vibrateNavTurn: (s: 'arrive') => void;
            };
            vibrateNavTurn('arrive');
          } catch {
            /* soft */
          }
          const { triggerPoiArrival } = await import('../../runtime/exploreModule');
          await triggerPoiArrival(storyPoiId, {
            force: true,
            skipWegweiser: true,
          });
        } else {
          const { buildArrivedCue } = await import('./spatialOrientation');
          await speakAssistantText(buildArrivedCue(destName));
          try {
            const { vibrateNavTurn } = await import('./navTurnHaptics') as {
              vibrateNavTurn: (s: 'arrive') => void;
            };
            vibrateNavTurn('arrive');
          } catch {
            /* soft */
          }
        }""",
    "arrivalSpeech",
    "vibrateNavTurn('arrive')",
)

# --- 6 camera: recenter does NOT couple heading ---
patch_once(
    "src/components/homeMap/HomePresenceMap.tsx",
    """    // Pulse = einmal zentrieren. Lock = Karte folgt GPS (Punkt bleibt Mitte) + dreht mit.
    ignoreUserPanUntil.current = Date.now() + 700;
    if (next.action === 'lock') {
      // Google-Feel: Location-Lock koppelt Heading — Karte dreht mit.
      headingFollowRef.current = true;
      setHeadingFollow(true);
      noteHomeMapHudFollowPrefs({ locationFollow: true, headingFollow: true });
      mapRef.current?.reattachFollow();
      mapRef.current?.setHeadingFollow(true);
    } else {
      noteHomeMapHudFollowPrefs({ locationFollow: false });
    }
    snapGps(next.action === 'lock' ? 'lock' : 'pulse');
  }, [snapGps]);

  const onRecenterLock = useCallback(() => {
    locationFollowRef.current = true;
    lastGpsTapAt.current = Date.now();
    setLocationFollow(true);
    headingFollowRef.current = true;
    setHeadingFollow(true);
    noteHomeMapHudFollowPrefs({ locationFollow: true, headingFollow: true });
    ignoreUserPanUntil.current = Date.now() + 700;
    mapRef.current?.reattachFollow();
    mapRef.current?.setHeadingFollow(true);
    snapGps('lock');
  }, [snapGps]);""",
    """    // Pulse = einmal zentrieren. Lock = nur GPS-Follow — Kompass bleibt separat.
    ignoreUserPanUntil.current = Date.now() + 700;
    if (next.action === 'lock') {
      noteHomeMapHudFollowPrefs({
        locationFollow: true,
        headingFollow: headingFollowRef.current,
      });
      mapRef.current?.reattachFollow();
      // Heading nur wenn User den Kompass-Button schon aktiv hat.
      mapRef.current?.setHeadingFollow(headingFollowRef.current);
    } else {
      noteHomeMapHudFollowPrefs({ locationFollow: false });
    }
    snapGps(next.action === 'lock' ? 'lock' : 'pulse');
  }, [snapGps]);

  const onRecenterLock = useCallback(() => {
    locationFollowRef.current = true;
    lastGpsTapAt.current = Date.now();
    setLocationFollow(true);
    // Kein Kompass-Zwang — Location-Follow allein.
    noteHomeMapHudFollowPrefs({
      locationFollow: true,
      headingFollow: headingFollowRef.current,
    });
    ignoreUserPanUntil.current = Date.now() + 700;
    mapRef.current?.reattachFollow();
    mapRef.current?.setHeadingFollow(headingFollowRef.current);
    snapGps('lock');
  }, [snapGps]);""",
    "recenterDecouple",
    "Kompass bleibt separat",
)

# --- 7 applyFollowPrefs: location lock must not force heading ---
p = ROOT / "src/components/homeMap/HomePresenceMap.tsx"
t = p.read_text(encoding="utf-8")
old_couple = """        if (prefs.headingFollow !== false) {
          headingFollowRef.current = true;
          setHeadingFollow(true);
          mapRef.current?.setHeadingFollow(true);
"""
if old_couple in t:
    new_couple = """        if (prefs.headingFollow === true) {
          headingFollowRef.current = true;
          setHeadingFollow(true);
          mapRef.current?.setHeadingFollow(true);
"""
    write_text(p, t.replace(old_couple, new_couple, 1))
    print("applyFollowPrefs: OK")
elif "prefs.headingFollow === true" in t:
    print("applyFollowPrefs: already")
else:
    print("applyFollowPrefs: pattern missing — inspect manually")

# --- 8 tickCoach: haptics on turn + scheduled cues ---
patch_once(
    "src/services/navigation/handsFreeNav/tickCoach.ts",
    """  if (nearTurn && turnIdx >= 0 && session.lastSpokenTurnIdx !== turnIdx) {
    // Zweite enge Kurve mitabgedeckt → nicht nochmal einzeln ansagen.
    session.lastSpokenTurnIdx =
      chainThroughIdx != null ? chainThroughIdx : turnIdx;
    session.lastSpokenAt = now;
    const key = turnPrefetchKey(turnIdx, turnWp!.cue ?? draft);""",
    """  if (nearTurn && turnIdx >= 0 && session.lastSpokenTurnIdx !== turnIdx) {
    // Zweite enge Kurve mitabgedeckt → nicht nochmal einzeln ansagen.
    session.lastSpokenTurnIdx =
      chainThroughIdx != null ? chainThroughIdx : turnIdx;
    session.lastSpokenAt = now;
    try {
      const { vibrateNavTurnFromManeuver } = require('../navTurnHaptics') as {
        vibrateNavTurnFromManeuver: (m: string | null | undefined) => void;
      };
      vibrateNavTurnFromManeuver(turnWp?.maneuver);
    } catch {
      /* soft */
    }
    const key = turnPrefetchKey(turnIdx, turnWp!.cue ?? draft);""",
    "turnHaptic",
    "vibrateNavTurnFromManeuver",
)

patch_once(
    "src/services/navigation/handsFreeNav/tickCoach.ts",
    """  if (scheduled && scheduled.phase !== 'final') {
    // final handled above with prefetch
    session.lastSpokenAt = now;
    void speak(scheduled.text);
  }
}""",
    """  if (scheduled && scheduled.phase !== 'final') {
    // final handled above with prefetch
    session.lastSpokenAt = now;
    if (scheduled.phase === 'warn' || scheduled.phase === 'final') {
      try {
        const { vibrateNavTurnFromManeuver } = require('../navTurnHaptics') as {
          vibrateNavTurnFromManeuver: (m: string | null | undefined) => void;
        };
        vibrateNavTurnFromManeuver(turnWp?.maneuver);
      } catch {
        /* soft */
      }
    }
    void speak(scheduled.text);
  }
}""",
    "warnHaptic",
    "scheduled.phase === 'warn'",
)

# --- 9 landmarks: skip weak outdoor markers; prefer road ---
patch_once(
    "src/services/navigation/handsFreeNav/landmarks.ts",
    """      if (!landmark) return;

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
                // Landmarke da → keine Straße vorlesen
                roadName: null,
              }),
            )
          : buildTurnWithoutLandmark(turn, null);
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
    "landmarksWeak",
    "isWeakVisualLandmark",
)

# --- 10 OSM: prefer unmistakable outdoor anchors ---
patch_once(
    "src/services/navigation/osmVisualLandmark.ts",
    """function labelForTags(tags: Record<string, string>): string | null {
  if (tags.amenity === 'post_box' || tags.amenity === 'mailbox') {
    return tags.colour || tags.color
      ? `${tags.colour || tags.color}er Briefkasten`
      : 'Briefkasten';
  }
  if (tags.highway === 'traffic_signals') return 'Ampel';
  if (tags.amenity === 'bench') return 'Bank';
  if (tags.amenity === 'waste_basket') return 'Mülleimer';
  if (tags.highway === 'crossing') return 'Fußgängerüberweg';
  if (tags.amenity === 'fountain') return 'Brunnen';""",
    """function labelForTags(tags: Record<string, string>): string | null {
  // Briefkasten/Bank/Müll — zu schwach für Hosentaschen-Navi (nicht ansagen)
  if (
    tags.amenity === 'post_box' ||
    tags.amenity === 'mailbox' ||
    tags.amenity === 'bench' ||
    tags.amenity === 'waste_basket'
  ) {
    return null;
  }
  if (tags.highway === 'traffic_signals') return 'Ampel';
  if (tags.highway === 'crossing') return 'Fußgängerüberweg';
  if (tags.amenity === 'fountain') return 'Brunnen';""",
    "osmDropWeak",
    "zu schwach für Hosentaschen",
)

patch_once(
    "src/services/navigation/osmVisualLandmark.ts",
    """(
  node(around:${radius},${opts.lat},${opts.lng})["amenity"~"post_box|mailbox|bench|waste_basket|fountain"];
  node(around:${radius},${opts.lat},${opts.lng})["highway"~"traffic_signals|crossing"];
  node(around:${radius},${opts.lat},${opts.lng})["shop"];
  node(around:${radius},${opts.lat},${opts.lng})["tourism"="artwork"];
  way(around:${radius},${opts.lat},${opts.lng})["bridge"];
  way(around:${radius},${opts.lat},${opts.lng})["man_made"="bridge"];
  way(around:${radius},${opts.lat},${opts.lng})["highway"~"footway|path|pedestrian"]["bridge"];
);""",
    """(
  node(around:${radius},${opts.lat},${opts.lng})["highway"~"traffic_signals|crossing"];
  node(around:${radius},${opts.lat},${opts.lng})["amenity"~"fountain|place_of_worship|school|library"];
  node(around:${radius},${opts.lat},${opts.lng})["building"~"church|chapel|school|university"]["name"];
  node(around:${radius},${opts.lat},${opts.lng})["tourism"="artwork"]["name"];
  node(around:${radius},${opts.lat},${opts.lng})["shop"]["name"];
  way(around:${radius},${opts.lat},${opts.lng})["bridge"];
  way(around:${radius},${opts.lat},${opts.lng})["man_made"="bridge"];
  way(around:${radius},${opts.lat},${opts.lng})["highway"~"footway|path|pedestrian"]["bridge"];
);""",
    "osmQuery",
    'amenity"~"fountain|place_of_worship',
)

# Prefer named buildings / Ampel over unnamed shop
patch_once(
    "src/services/navigation/osmVisualLandmark.ts",
    """  if (tags.shop) return tags.name || `Laden (${tags.shop})`;
  if (tags.tourism === 'artwork' && tags.name) return tags.name;
  if (tags.name) return tags.name;
  return null;
}""",
    """  if (tags.shop) return tags.name || null; // unnamed shop = nicht erkennbar
  if (tags.tourism === 'artwork' && tags.name) return tags.name;
  if (tags.amenity === 'place_of_worship' || tags.building === 'church') {
    return tags.name || 'Kirche';
  }
  if (tags.name) return tags.name;
  return null;
}""",
    "osmNamedOnly",
    "unnamed shop",
)

# Prefer Ampel/Brücke/Kirche in scoring
patch_once(
    "src/services/navigation/osmVisualLandmark.ts",
    """      // Fußgängerbrücke leicht bevorzugen gegenüber generischem Street-Furniture
      const prefer =
        label === 'Fußgängerbrücke' || /brücke$/i.test(label) ? -8 : 0;""",
    """      // Unmissverständliche Outdoor-Anker bevorzugen
      const prefer =
        label === 'Fußgängerbrücke' || /brücke$/i.test(label)
          ? -12
          : label === 'Ampel' || label === 'Kirche' || /kirche$/i.test(label)
            ? -10
            : label === 'Fußgängerüberweg'
              ? -4
              : 0;""",
    "osmPrefer",
    "Unmissverständliche Outdoor",
)

# --- 11 dest speech: keep house number for street addresses ---
patch_once(
    "src/services/navigation/navDestSpeechName.ts",
    """  // Straße + Nr. → nur Straßenname (ohne Hausnummer/PLZ)
  const m = s.match(STREET_PLUS_NR_RE);
  if (m?.[1]) return m[1].trim();
  s = s.replace(HOUSE_NR_TAIL_RE, '').trim();
  if (looksLikeNavAddressLabel(s) || !s) return '';
  return s.slice(0, 80);
}""",
    """  // Straße + Nr. behalten (HUD/Button: \"Heisterhoop 12\") — nur PLZ/Land weg
  const m = s.match(STREET_PLUS_NR_RE);
  if (m?.[0]) return m[0].trim().slice(0, 80);
  // Kein Street-Match: Hausnummer am Ende behalten wenn Query so war
  const house = s.match(/^([\\wÄÖÜäöüß.-]+)\\s+(\\d{1,4}[a-zA-Z]?)$/u);
  if (house) return `${house[1]} ${house[2]}`.slice(0, 80);
  if (looksLikeNavAddressLabel(s) || !s) return '';
  return s.slice(0, 80);
}""",
    "destHouseNr",
    "Heisterhoop 12",
)

# Prefer query when it already has street+nr
patch_once(
    "src/services/navigation/navDestSpeechName.ts",
  """  // Query ist klarer Ortsname → dem Geocode-Adress-Müll vorziehen
  if (query && !looksLikeNavAddressLabel(query) && query.length >= 3) {
    if (!geo || looksLikeNavAddressLabel(geo) || geo.includes(',')) {
      return query.slice(0, 80);
    }
  }""",
  """  // User tippte Straße+Nr. → HUD/Button behalten (\"Heisterhoop 12\")
  if (query && /\\b\\d{1,4}[a-zA-Z]?\\b/.test(query) && query.length >= 3 && query.length <= 48) {
    const qFirst = query.split(',')[0]?.trim() || query;
    if (!/,/.test(qFirst) && !/\\b\\d{4,5}\\b/.test(qFirst)) {
      return qFirst.slice(0, 80);
    }
  }

  // Query ist klarer Ortsname → dem Geocode-Adress-Müll vorziehen
  if (query && !looksLikeNavAddressLabel(query) && query.length >= 3) {
    if (!geo || looksLikeNavAddressLabel(geo) || geo.includes(',')) {
      return query.slice(0, 80);
    }
  }""",
    "destQueryHouse",
    "User tippte Straße+Nr",
)

# --- 12 action labels: allow longer street+nr; UI flex ---
patch_once(
    "src/services/concierge/actionLabelShorten.ts",
    """export const ACTION_LABEL_MAX_CHARS = 22;""",
    """export const ACTION_LABEL_MAX_CHARS = 22;
/** Straße + Hausnr. dürfen etwas länger bleiben (dynamische Button-Breite). */
export const ACTION_LABEL_MAX_STREET = 28;""",
    "actionMaxStreet",
    "ACTION_LABEL_MAX_STREET",
)

patch_once(
    "src/services/concierge/actionLabelShorten.ts",
    """export function shortenActionLabel(
  label: string,
  max = ACTION_LABEL_MAX_CHARS,
): string {
  let t = (label || '').trim().replace(/\\s+/g, ' ');
  if (!t) return t;""",
    """export function shortenActionLabel(
  label: string,
  max = ACTION_LABEL_MAX_CHARS,
): string {
  let t = (label || '').trim().replace(/\\s+/g, ' ');
  if (!t) return t;
  // \"🗺️ Heisterhoop 12\" — Hausnummer nicht wegstutzen
  if (/\\b\\d{1,4}[a-zA-Z]?\\b/.test(t) && charLen(t) <= ACTION_LABEL_MAX_STREET) {
    max = Math.max(max, ACTION_LABEL_MAX_STREET);
  }""",
    "actionKeepHouse",
    "Hausnummer nicht wegstutzen",
)

patch_once(
    "src/components/liveStage/ActionsSlot.tsx",
    """  actionBtn: {
    backgroundColor: 'rgba(196, 163, 90, 0.22)',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
    flexShrink: 0,
    minHeight: 34,
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(196, 163, 90, 0.45)',
  },""",
    """  actionBtn: {
    backgroundColor: 'rgba(196, 163, 90, 0.22)',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
    flexShrink: 0,
    alignSelf: 'flex-start',
    maxWidth: '92%',
    minHeight: 34,
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(196, 163, 90, 0.45)',
  },""",
    "actionBtnFlex",
    "maxWidth: '92%'",
)

# nav chip maxWidth a bit more dynamic for house nr
patch_once(
    "src/components/homeMap/NativeHomeMapView.tsx",
    """  navChip: {
    maxWidth: 240,
    minWidth: 88,""",
    """  navChip: {
    maxWidth: 280,
    minWidth: 72,""",
    "navChipWidth",
    "maxWidth: 280",
)

print("ALL PATCHES DONE")
