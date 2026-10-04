# -*- coding: utf-8 -*-
from __future__ import annotations

import os
import shutil
import time
from pathlib import Path

ROOT = Path(r"c:\Users\larsf\Findus 2.0")


def force_write(path: Path, content: str) -> None:
    path = Path(path)
    tmp = path.with_suffix(path.suffix + f".tmp{os.getpid()}")
    bak = path.with_suffix(path.suffix + ".bak_mp")
    tmp.write_text(content, encoding="utf-8")
    for i in range(10):
        try:
            if path.exists():
                try:
                    if bak.exists():
                        bak.unlink()
                except OSError:
                    pass
                try:
                    path.replace(bak)
                except OSError:
                    shutil.copy2(path, bak)
                    path.unlink(missing_ok=True)
            os.replace(tmp, path)
            try:
                if bak.exists():
                    bak.unlink()
            except OSError:
                pass
            print(f"OK {path.relative_to(ROOT)}")
            return
        except OSError as e:
            print(f"  retry {i+1} {path.name}: {e}")
            time.sleep(0.35)
    raise SystemExit(f"FAILED {path}")


def patch(rel: str, old: str, new: str) -> None:
    path = ROOT / rel
    t = path.read_text(encoding="utf-8")
    if old not in t:
        if new[:50] in t or "already" in rel:
            print(f"SKIP {rel}")
            return
        raise SystemExit(f"OLD not found in {rel}\n---\n{old[:200]}")
    force_write(path, t.replace(old, new, 1))


# 5) Schau nach links/rechts raus
patch(
    "src/services/navigation/spatialOrientation.ts",
    """  if (kind === 'complex' && turn !== 'geradeaus' && !land) {
    return scrubRoboticNavSpeak(
      `Unübersichtliche Kreuzung — ${turn} halten.`,
    );
  }

  if (land && turn !== 'geradeaus') {
    const open = look
      ? `Schau nach ${look}. `
      : turn.includes('links')
        ? 'Schau nach links. '
        : turn.includes('rechts')
          ? 'Schau nach rechts. '
          : 'Schau nach vorne. ';
    return scrubRoboticNavSpeak(
      `${open}An ${land} ${turn} abbiegen.`.replace(/\\s+/g, ' ').trim(),
    );
  }
  if (land) {
    return scrubRoboticNavSpeak(
      `Weiter geradeaus — halte ${land} im Blick.`,
    );
  }
  try {
    const { navTurnPhrase } = require('../tts/offlinePhraseBank') as {
      navTurnPhrase: (t: string, look?: string | null) => string;
    };
    return scrubRoboticNavSpeak(navTurnPhrase(turn, look || null));
  } catch {
    const open = look
      ? `Schau nach ${look}. `
      : turn.includes('links')
        ? 'Schau nach links. '
        : turn.includes('rechts')
          ? 'Schau nach rechts. '
          : 'Schau nach vorne. ';
    if (turn !== 'geradeaus') {
      return scrubRoboticNavSpeak(`${open}Gleich ${turn} abbiegen.`);
    }
    return scrubRoboticNavSpeak(`${open}Weiter geradeaus — du bist richtig.`);
  }
}""",
    """  if (kind === 'complex' && turn !== 'geradeaus' && !land) {
    // Kein „unübersichtlich“ / „schau nach …“ — knapper Richtungstipp.
    return scrubRoboticNavSpeak(`Gleich ${turn} abbiegen.`);
  }

  if (land && turn !== 'geradeaus') {
    return scrubRoboticNavSpeak(
      `An ${land} ${turn} abbiegen.`.replace(/\\s+/g, ' ').trim(),
    );
  }
  if (land) {
    return scrubRoboticNavSpeak(
      `Weiter geradeaus — halte ${land} im Blick.`,
    );
  }
  try {
    const { navTurnPhrase } = require('../tts/offlinePhraseBank') as {
      navTurnPhrase: (t: string, look?: string | null) => string;
    };
    // look-Prefix („Schau nach …“) bewusst weglassen.
    return scrubRoboticNavSpeak(navTurnPhrase(turn, null));
  } catch {
    if (turn !== 'geradeaus') {
      return scrubRoboticNavSpeak(`Gleich ${turn} abbiegen.`);
    }
    return scrubRoboticNavSpeak(`Weiter geradeaus — du bist richtig.`);
  }
}""",
)

# 7) Zoom ≠ detach follow
patch(
    "src/components/homeMap/NativeHomeMapView.tsx",
    """              const zD = Math.abs(zoom - userViewCamRef.current.zoom);
              const centerMoved = gestureMovedEnough(midLat, midLng, zoom);
              const positionMoved = centerMoved || zD >= 0.03;
              if (positionMoved) noteUserGesture('position');""",
    """              // Zoom allein löst Follow NICHT — nur echtes Pan (Zentrum).
              const centerMoved = gestureMovedEnough(midLat, midLng, zoom);
              const o = gestureOriginCam.current ?? userViewCamRef.current;
              const panOnly =
                Math.abs(midLat - o.lat) > 0.00007 ||
                Math.abs(midLng - o.lng) > 0.00007;
              if (panOnly || (centerMoved && panOnly)) {
                noteUserGesture('position');
              }""",
)

# 12) HUD stations while in_transit even if mode dips to walk
patch(
    "src/services/navigation/navigationService.ts",
    """function computeRemainingStations(
  lat: number,
  lng: number,
  transportMode: TransportMode,
): number | null {
  if (!active || !isTransitMode(transportMode)) return null;""",
    """function computeRemainingStations(
  lat: number,
  lng: number,
  transportMode: TransportMode,
): number | null {
  if (!active) return null;
  // GPS-Tempo-Dip in Bahn (mode=walk) darf HUD-Stationen nicht killen.
  if (
    !isTransitMode(transportMode) &&
    getNavPhase() !== 'in_transit' &&
    !routeHasTransitLegs
  ) {
    return null;
  }""",
)

# Wrong-way suppress walk_to_stop
patch(
    "src/services/navigation/navigationService.ts",
    """        suppress:
          isTransitMode(tick.transportMode) || tick.navPhase === 'in_transit',""",
    """        suppress:
          isTransitMode(tick.transportMode) ||
          tick.navPhase === 'in_transit' ||
          tick.navPhase === 'walk_to_stop',""",
)

# BF expand in prepareAudioText
patch(
    "src/services/AudioVoiceService.ts",
    """  if (!t) return '';
  t = stripSpellTrapsAndMarkdownJunk(t);
  t = t.replace(/[·•]/g, ' ');""",
    """  if (!t) return '';
  t = stripSpellTrapsAndMarkdownJunk(t);
  t = t.replace(/[·•]/g, ' ');
  // Abkürzungen für Speech (Live: BF → Bahnhof)
  t = t.replace(/\\b[Hh][Bb][Ff]\\.\\b/g, 'Hauptbahnhof');
  t = t.replace(/\\b[Hh][Bb][Ff]\\b/g, 'Hauptbahnhof');
  t = t.replace(/\\b[Bb][Ff]\\.\\b/g, 'Bahnhof');
  t = t.replace(/\\b[Bb][Ff]\\b/g, 'Bahnhof');""",
)

# Nav cue ENOENT: check file exists
patch(
    "src/services/AudioVoiceService.ts",
    """  const display = prepareDisplayText(text);
  if (!display || !uri) return false;

  const maySpeak = await requestSpeechDelivery({
    text: display,
    voiceOptions,
    kind: 'nav',
  });
  if (!maySpeak) return false;""",
    """  const display = prepareDisplayText(text);
  if (!display || !uri) return false;

  try {
    const info = await FileSystem.getInfoAsync(uri);
    if (!info.exists) {
      if (__DEV__) console.warn('[voice] cached nav cue missing:', uri);
      return false;
    }
  } catch {
    return false;
  }

  const maySpeak = await requestSpeechDelivery({
    text: display,
    voiceOptions,
    kind: 'nav',
  });
  if (!maySpeak) return false;""",
)

# Prefetch: clear bad slot on fail
patch(
    "src/services/navigation/navTurnPrefetch.ts",
    """  try {
    const ok = await playCachedNavCueWav(slot.uri, slot.text);
    if (ok) {
      slot.played = true;
      return true;
    }
  } catch (err) {
    if (__DEV__) console.warn('[nav-prefetch] play failed:', err);
  }
  return false;
}""",
    """  try {
    const ok = await playCachedNavCueWav(slot.uri, slot.text);
    if (ok) {
      slot.played = true;
      return true;
    }
    // ENOENT / corrupt: Slot weg → Caller fällt auf Live-TTS zurück.
    await deleteUri(slot.uri);
    slots.delete(key);
  } catch (err) {
    if (__DEV__) console.warn('[nav-prefetch] play failed:', err);
    try {
      await deleteUri(slot.uri);
    } catch {
      /* soft */
    }
    slots.delete(key);
  }
  return false;
}""",
)

# Browse pack: skip during nav
patch(
    "src/components/homeMap/HomePresenceMap.tsx",
    """  const maybeEnsureBrowsePackAt = useCallback(
    (viewportLat: number, viewportLng: number) => {
      if (!isVectorBasemapEnabled()) return;
      try {""",
    """  const maybeEnsureBrowsePackAt = useCallback(
    (viewportLat: number, viewportLng: number) => {
      if (!isVectorBasemapEnabled()) return;
      // Live-Nav: kein Browse-Pack-Spam (uetersen/appen 400 → Lag).
      if (useFinnusStore.getState().navActive) return;
      try {""",
)

# Fog catchup: bypass idle freeze once after nav
patch(
    "src/services/homeMap/fogTrackEngine.ts",
    """    let prev = useFinnusStore.getState().navActive === true;
    useFinnusStore.subscribe((s) => {
      const now = s.navActive === true;
      if (prev && !now) {
        forceFogRecompute(useFogStore.getState().walkTrack);
      }
      prev = now;
    });""",
    """    let prev = useFinnusStore.getState().navActive === true;
    useFinnusStore.subscribe((s) => {
      const now = s.navActive === true;
      if (prev && !now) {
        // Nach Nav: Trail → Fläche, auch wenn Explore-Idle sonst Full friert.
        const track = useFogStore.getState().walkTrack;
        useFogStore.getState().setWalkTrack(track);
        const key = fogTrackCacheKey(track);
        runDeferredFullCompute(track, key);
      }
      prev = now;
    });""",
)

print("batch2 done")
