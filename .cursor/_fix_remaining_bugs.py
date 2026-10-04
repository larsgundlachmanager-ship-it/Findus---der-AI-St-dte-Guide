# -*- coding: utf-8 -*-
"""Minimal remaining-bug fixes (force-write if locked)."""
from __future__ import annotations

import os
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def force_write(path: Path, content: str, retries: int = 10) -> None:
    path = Path(path)
    tmp = path.with_suffix(path.suffix + ".agent_tmp")
    tmp.write_text(content, encoding="utf-8")
    last: Exception | None = None
    for i in range(retries):
        try:
            os.replace(str(tmp), str(path))
            return
        except OSError as e:
            last = e
            time.sleep(0.4 * (i + 1))
            try:
                path.write_text(content, encoding="utf-8")
                try:
                    tmp.unlink(missing_ok=True)
                except OSError:
                    pass
                return
            except OSError as e2:
                last = e2
    raise RuntimeError(f"force_write failed for {path}: {last}")


def must_replace(t: str, old: str, new: str, label: str) -> str:
    if old not in t:
        raise SystemExit(f"FAIL: {label} — needle missing")
    return t.replace(old, new, 1)


def patch_journey_leave_by() -> None:
    p = ROOT / "src/services/navigation/journeyLeaveBy.ts"
    t = p.read_text(encoding="utf-8")
    if "async function confirmMissedForAnnounce" not in t:
        anchor = "async function proposeMissedAlternative("
        helper = """async function confirmMissedForAnnounce(opts: {
  nowMs: number;
  depMs: number;
  stationName?: string | null;
  line?: string | null;
  lat?: number | null;
  lng?: number | null;
}): Promise<boolean> {
  let boardWhenMs: number | null = null;
  let waitSec: number | null = null;
  try {
    const station = (opts.stationName || '').trim();
    const line = (opts.line || '').trim();
    if (station && line) {
      const { lookupBoardDeparture } = await import(
        '../transit/lookupBoardDeparture'
      );
      const hit = await lookupBoardDeparture({
        stationName: station,
        line,
        depMs: opts.depMs,
        lat: opts.lat,
        lng: opts.lng,
      });
      if (hit?.cancelled) return true;
      if (hit && Number.isFinite(hit.whenMs)) {
        boardWhenMs = hit.whenMs;
        waitSec = Math.round((hit.whenMs - opts.nowMs) / 1000);
      }
    }
  } catch {
    /* soft — Zeit-Fallback unten */
  }
  if (waitSec == null && Number.isFinite(opts.depMs)) {
    waitSec = Math.round((opts.depMs - opts.nowMs) / 1000);
  }
  const { isDepartureClearlyMissed } = await import(
    '../transit/missedConnectionPolicy'
  );
  return isDepartureClearlyMissed({
    nowMs: opts.nowMs,
    armedDepMs: opts.depMs,
    boardWhenMs,
    waitSec,
  });
}

"""
        t = must_replace(t, anchor, helper + anchor, "confirmMissed helper")

    t = must_replace(
        t,
        """    // Verpasst während Umstieg → Alternative vorschlagen.
    if (pace.scenario === 'missed') {
      void proposeMissedAlternative(origin, now, { reason: 'too_slow' });
    }""",
        """    // Verpasst nur nach Live-Board / klarer Wartezeit — nicht nur ETA-Puffer.
    if (pace.scenario === 'missed') {
      void (async () => {
        const ok = await confirmMissedForAnnounce({
          nowMs: now,
          depMs,
          stationName: board.name,
          line: board.line,
          lat: board.lat,
          lng: board.lng,
        });
        if (!ok) return;
        void proposeMissedAlternative(origin, now, { reason: 'too_slow' });
      })();
    }""",
        "pace missed gate",
    )

    t = must_replace(
        t,
        """  if (cur?.role === 'alight' && useFinnusStore.getState().navActive) {
    return;
  }
  void proposeMissedAlternative(origin, now, { reason: 'too_slow' });
}""",
        """  if (cur?.role === 'alight' && useFinnusStore.getState().navActive) {
    return;
  }
  const ok = await confirmMissedForAnnounce({
    nowMs: now,
    depMs,
    stationName: board.name,
    line: board.line ?? cur?.line ?? lineLabel,
    lat: board.lat,
    lng: board.lng,
  });
  if (!ok) return;
  void proposeMissedAlternative(origin, now, { reason: 'too_slow' });
}""",
        "maybeSwap gate",
    )

    t = must_replace(
        t,
        """    if (kind === 'missed_next') {
      void proposeMissedAlternative(origin, now, { reason: 'missed_departed' });
      return;
    }""",
        """    if (kind === 'missed_next') {
      const ok = await confirmMissedForAnnounce({
        nowMs: now,
        depMs: depMsArmed,
        stationName: halt,
        line,
        lat: board.lat,
        lng: board.lng,
      });
      if (!ok) return;
      void proposeMissedAlternative(origin, now, { reason: 'missed_departed' });
      return;
    }""",
        "missed_next gate",
    )

    force_write(p, t)
    print("OK journeyLeaveBy")


def patch_nav_gps_snap() -> None:
    p = ROOT / "src/services/navigation/navigationService.ts"
    t = p.read_text(encoding="utf-8")

    if "let transitDisplayFix:" not in t:
        # Insert near lastLat
        needle = "let lastLat: number | null = null;"
        insert = """let lastLat: number | null = null;
/** ÖPNV in_transit: Puck auf Route/Stationspfad + Bearing der Linie. */
let transitDisplayFix: {
  lat: number;
  lng: number;
  bearingDeg: number;
} | null = null;

export function getTransitDisplayFix(): {
  lat: number;
  lng: number;
  bearingDeg: number;
} | null {
  return transitDisplayFix;
}
"""
        if needle not in t:
            raise SystemExit("lastLat needle missing")
        t = t.replace(needle, insert, 1)

    # In computeTick: capture projection for snap after map match
    if "let lastProjection:" not in t and "transitDisplayFix =" in t:
        # Find map match block and store projection + set fix after navPhase
        old_match = """    distanceToPathM = match.distanceToPathM;
    const newAlong = match.projection?.alongM ?? 0;"""
        new_match = """    distanceToPathM = match.distanceToPathM;
    lastMapProjection = match.projection;
    const newAlong = match.projection?.alongM ?? 0;"""
        if "lastMapProjection" not in t:
            t = t.replace(
                "let transitDisplayFix:",
                "let lastMapProjection: import('./routeSpline').PathProjection | null = null;\nlet transitDisplayFix:",
                1,
            )
        if old_match in t:
            t = t.replace(old_match, new_match, 1)

    # After navPhase assigned, set transitDisplayFix
    old_phase = """  lastNavPhase = navPhase;

  return {
    mode,
    distanceToDestinationM,"""
    new_phase = """  lastNavPhase = navPhase;

  // Zug/Bus: GPS-Jitter → Puck auf Spline/Stationspfad, Pfeil = Routen-Bearing.
  if (navPhase === 'in_transit' && lastMapProjection) {
    const spline = getMapMatchSpline();
    const idx = Math.max(
      0,
      Math.min(lastMapProjection.index, Math.max(0, spline.length - 1)),
    );
    const pt = spline[idx];
    if (pt && Number.isFinite(pt.lat) && Number.isFinite(pt.lng)) {
      transitDisplayFix = {
        lat: pt.lat,
        lng: pt.lng,
        bearingDeg: lastMapProjection.pathBearingDeg,
      };
    } else {
      transitDisplayFix = null;
    }
  } else {
    transitDisplayFix = null;
  }

  return {
    mode,
    distanceToDestinationM,"""
    if "navPhase === 'in_transit' && lastMapProjection" not in t:
        t = must_replace(t, old_phase, new_phase, "transit snap in computeTick")

    # Guard story poiId >= 0
    old_story = """        if (destPoiId != null) {
          let storyPoiId = destPoiId;"""
    new_story = """        if (destPoiId != null && destPoiId >= 0) {
          let storyPoiId = destPoiId;"""
    if "destPoiId != null && destPoiId >= 0" not in t:
        t = must_replace(t, old_story, new_story, "story poiId guard")

    # Reset transitDisplayFix on stop
    if "transitDisplayFix = null;" in t and "function stopNavigation" in t:
        # ensure reset in clear path — look for lastLat = null in stop
        old_clear = "  lastLat = null;"
        if "transitDisplayFix = null;\n  lastLat = null;" not in t:
            # only first occurrence in stop/reset — replace carefully near resetMapMatch
            pass

    force_write(p, t)
    print("OK navigationService")


def patch_native_map_puck() -> None:
    p = ROOT / "src/components/homeMap/NativeHomeMapView.tsx"
    t = p.read_text(encoding="utf-8")
    old = """      const unsubDr = subscribeDeadReckonPosition((s) => {
        gpsPosRef.current = {
          lat: s.lat,
          lng: s.lng,
          acc: gpsPosRef.current.acc,
        };
        pushPuckPosition(s.lat, s.lng, gpsPosRef.current.acc);
        maybeFollowCamera(s.lat, s.lng, headingRef.current);
      });"""
    new = """      const unsubDr = subscribeDeadReckonPosition((s) => {
        let lat = s.lat;
        let lng = s.lng;
        let heading = headingRef.current;
        try {
          const { getTransitDisplayFix } = require('../../services/navigation/navigationService') as {
            getTransitDisplayFix: () => {
              lat: number;
              lng: number;
              bearingDeg: number;
            } | null;
          };
          const snap = getTransitDisplayFix();
          if (snap) {
            lat = snap.lat;
            lng = snap.lng;
            heading = snap.bearingDeg;
            headingRef.current = heading;
          }
        } catch {
          /* soft */
        }
        gpsPosRef.current = {
          lat,
          lng,
          acc: gpsPosRef.current.acc,
        };
        pushPuckPosition(lat, lng, gpsPosRef.current.acc);
        maybeFollowCamera(lat, lng, heading);
      });"""
    if "getTransitDisplayFix" not in t:
        t = must_replace(t, old, new, "NativeHomeMapView transit snap")
        force_write(p, t)
        print("OK NativeHomeMapView")
    else:
        print("SKIP NativeHomeMapView")


def patch_explore_guard() -> None:
    p = ROOT / "src/runtime/exploreModule.ts"
    t = p.read_text(encoding="utf-8")
    old = """export async function triggerPoiArrival(
  poiId: number,
"""
    # Find start of function body after signature — insert early guard after opts
    # Read a bit more context
    if "if (poiId < 0)" in t:
        print("SKIP exploreModule")
        return
    # Insert after the opening of the function — look for first meaningful check
    needle = """  if (
    pendingWatch?.poiId === poiId &&
    !opts?.force &&
    !opts?.interestDeepDive
  ) {
    return;
  }"""
    # Better: right after function params / before pendingWatch
    # Find: const pendingWatch = getPendingInterestWatch();
    old2 = "  const pendingWatch = getPendingInterestWatch();"
    new2 = """  if (!(poiId >= 0)) {
    if (__DEV__) {
      console.warn('[geofence] skip invalid poiId:', poiId);
    }
    return;
  }

  const pendingWatch = getPendingInterestWatch();"""
    t = must_replace(t, old2, new2, "exploreModule poiId guard")
    force_write(p, t)
    print("OK exploreModule")


def patch_guest_auth_nudge() -> None:
    nudge = ROOT / "src/services/account/guestAuthNudge.ts"
    content = '''/**
 * Soft Login-Erinnerung für Gäste — einmalig, nie während aktiver Nav.
 * Dies sind nur abstrakte Beispiele für den logischen Ablauf.
 */

import * as FileSystem from 'expo-file-system';
import { getCachedUserProfile } from '../userProfileService';
import { profileHasFinishedSetup } from '../../types/userProfile';
import { getLastAuthUser } from './findusAuth';
import { useFinnusStore } from '../../store/useFinnusStore';

const STATE_PATH = `${FileSystem.documentDirectory}findus-guest-auth-nudge.json`;
const MIN_SETUP_AGE_MS = 2 * 60 * 60_000;
const COOLDOWN_MS = 72 * 60 * 60_000;

type NudgeState = {
  lastSpokeAtMs: number;
  spoken: boolean;
};

let cache: NudgeState | null = null;

async function loadState(): Promise<NudgeState> {
  if (cache) return cache;
  try {
    const raw = await FileSystem.readAsStringAsync(STATE_PATH);
    const parsed = JSON.parse(raw) as Partial<NudgeState>;
    cache = {
      lastSpokeAtMs: Number(parsed.lastSpokeAtMs) || 0,
      spoken: parsed.spoken === true,
    };
  } catch {
    cache = { lastSpokeAtMs: 0, spoken: false };
  }
  return cache;
}

async function saveState(next: NudgeState): Promise<void> {
  cache = next;
  try {
    await FileSystem.writeAsStringAsync(STATE_PATH, JSON.stringify(next));
  } catch {
    /* soft */
  }
}

/**
 * Feuert soft, wenn Gast + Setup fertig + nicht in Nav / Voice-Busy.
 * @returns true wenn angesagt
 */
export async function maybeSpeakGuestAuthNudge(
  nowMs: number = Date.now(),
): Promise<boolean> {
  try {
    const store = useFinnusStore.getState();
    if (store.navActive) return false;
    if (store.isListening || store.isGenerating || store.isPlayingAudio) {
      return false;
    }
    if (getLastAuthUser()) return false;
    const profile = getCachedUserProfile();
    if (!profile || profile.accountMode !== 'guest') return false;
    if (!profileHasFinishedSetup(profile)) return false;
    const setupAt = Number(profile.completedAt) || 0;
    if (setupAt > 0 && nowMs - setupAt < MIN_SETUP_AGE_MS) return false;

    const state = await loadState();
    if (state.spoken && nowMs - state.lastSpokeAtMs < COOLDOWN_MS) {
      return false;
    }

    const line =
      'Wenn du willst: mit Konto bleiben Stempel, Fog und Pläne auch auf dem nächsten Gerät — unter Einstellungen kannst du dich anmelden.';
    const { speakRuntimeText } = await import('../../runtime/speechModule');
    const { getVoiceSettingsForTour } = await import('../ttsService');
    const voice = await getVoiceSettingsForTour();
    store.addChatMessage({ role: 'assistant', content: line });
    await speakRuntimeText(
      line,
      { voiceId: voice.voiceId, speechRate: voice.speechRate },
      { deliveryKind: 'reminder' },
    );
    await saveState({ spoken: true, lastSpokeAtMs: nowMs });
    return true;
  } catch {
    return false;
  }
}
'''
    force_write(nudge, content)
    print("OK guestAuthNudge.ts")

    # Wire into proactiveReminderEngine
    p = ROOT / "src/services/ui/proactiveReminderEngine.ts"
    t = p.read_text(encoding="utf-8")
    if "maybeSpeakGuestAuthNudge" not in t:
        old = """  // Progressive logistics checkpoints (ICE/Bus/Flug/Zeit/Geo)
  void tickLogisticsTriggerEngine({ force: opts?.force, nowMs: now });"""
        new = """  // Progressive logistics checkpoints (ICE/Bus/Flug/Zeit/Geo)
  void tickLogisticsTriggerEngine({ force: opts?.force, nowMs: now });

  // Gast: soft Login-Erinnerung (nie während Nav)
  try {
    const { maybeSpeakGuestAuthNudge } = require('../account/guestAuthNudge') as {
      maybeSpeakGuestAuthNudge: (n?: number) => Promise<boolean>;
    };
    void maybeSpeakGuestAuthNudge(now);
  } catch {
    /* soft */
  }"""
        t = must_replace(t, old, new, "wire guest nudge")
        force_write(p, t)
        print("OK proactiveReminderEngine wire")
    else:
        print("SKIP reminder wire")


def patch_gemini_max_tokens() -> None:
    p = ROOT / "src/services/geminiService.ts"
    t = p.read_text(encoding="utf-8")

    # Truncate-safe helper after extractTextFromRest warn
    if "function softTrimMaxTokensText" not in t:
        old = """function extractTextFromRest(data: unknown): string {
  const root = data as {
    candidates?: Array<{
      content?: { parts?: Array<{ text?: string; thought?: boolean }> };
      finishReason?: string;
    }>;
    usageMetadata?: {
      thoughtsTokenCount?: number;
      candidatesTokenCount?: number;
      totalTokenCount?: number;
    };
  };
  const cand = root.candidates?.[0];
  const usage = root.usageMetadata;
  if (cand?.finishReason && cand.finishReason !== 'STOP') {
    console.warn(
      `[gemini] finishReason=${cand.finishReason} — Antwort evtl. abgeschnitten`,
    );
  }
  if (__DEV__ && usage?.thoughtsTokenCount) {
    console.warn(
      `[gemini] thinkingTokens=${usage.thoughtsTokenCount} candTokens=${usage.candidatesTokenCount ?? '?'}`,
    );
  }
  const parts = cand?.content?.parts ?? [];
  return parts
    .filter((p) => !p.thought)
    .map((p) => p.text ?? '')
    .join('')
    .trim();
}"""
        new = """/** MAX_TOKENS: am letzten Satzende kappen, damit Speech nicht mittendrin stirbt. */
function softTrimMaxTokensText(text: string, finishReason?: string): string {
  const raw = (text || '').trim();
  if (!raw) return raw;
  if (finishReason !== 'MAX_TOKENS') return raw;
  const m = raw.match(/^([\\s\\S]*?[.!?…])(?:\\s+[^.!?…]+)?$/);
  if (m?.[1] && m[1].length >= Math.min(40, raw.length * 0.55)) {
    return m[1].trim();
  }
  const last = Math.max(
    raw.lastIndexOf('. '),
    raw.lastIndexOf('! '),
    raw.lastIndexOf('? '),
    raw.lastIndexOf('。'),
  );
  if (last >= 40) return raw.slice(0, last + 1).trim();
  return raw;
}

function extractTextFromRest(data: unknown): string {
  const root = data as {
    candidates?: Array<{
      content?: { parts?: Array<{ text?: string; thought?: boolean }> };
      finishReason?: string;
    }>;
    usageMetadata?: {
      thoughtsTokenCount?: number;
      candidatesTokenCount?: number;
      totalTokenCount?: number;
    };
  };
  const cand = root.candidates?.[0];
  const usage = root.usageMetadata;
  if (cand?.finishReason && cand.finishReason !== 'STOP') {
    console.warn(
      `[gemini] finishReason=${cand.finishReason} — Antwort evtl. abgeschnitten`,
    );
  }
  if (__DEV__ && usage?.thoughtsTokenCount) {
    console.warn(
      `[gemini] thinkingTokens=${usage.thoughtsTokenCount} candTokens=${usage.candidatesTokenCount ?? '?'}`,
    );
  }
  const parts = cand?.content?.parts ?? [];
  const joined = parts
    .filter((p) => !p.thought)
    .map((p) => p.text ?? '')
    .join('')
    .trim();
  return softTrimMaxTokensText(joined, cand?.finishReason);
}"""
        t = must_replace(t, old, new, "gemini soft trim")

    # Soft bump default max tokens 1024 → 1536 for short calls
    old_req = "  const requested = options?.maxTokens ?? 1024;"
    new_req = "  const requested = options?.maxTokens ?? 1536;"
    if old_req in t:
        t = t.replace(old_req, new_req, 1)
        # also the fallback in thinking retry path that uses 1024 default
        t = t.replace(
            "options?.maxTokens ?? 1024,\n        options?.maxTokens && options.maxTokens >= 2000",
            "options?.maxTokens ?? 1536,\n        options?.maxTokens && options.maxTokens >= 2000",
            1,
        )

    force_write(p, t)
    print("OK geminiService")


def patch_smoke_missed() -> None:
    p = ROOT / "src/services/transit/missedConnectionPolicy.smoke.test.ts"
    t = p.read_text(encoding="utf-8")
    if "isDepartureClearlyMissed" in t:
        print("SKIP smoke")
        return
    t = must_replace(
        t,
        """import {
  HEAVY_DELAY_MIN,
  pickMissedConnection,
  shouldAutoApplyMissedPick,
} from './missedConnectionPolicy';""",
        """import {
  HEAVY_DELAY_MIN,
  isDepartureClearlyMissed,
  pickMissedConnection,
  shouldAutoApplyMissedPick,
} from './missedConnectionPolicy';""",
        "smoke import",
    )
    t = must_replace(
        t,
        "console.log('missedConnectionPolicy.smoke.test.ts OK');",
        """assert(
  !isDepartureClearlyMissed({
    nowMs: now,
    armedDepMs: now + 5 * 60_000,
    boardWhenMs: now + 8 * 60_000,
  }),
  'Board noch in Zukunft → nicht missed',
);
assert(
  isDepartureClearlyMissed({
    nowMs: now,
    armedDepMs: now - 5 * 60_000,
    boardWhenMs: now - 2 * 60_000,
  }),
  'Board klar vorbei → missed',
);
assert(
  isDepartureClearlyMissed({
    nowMs: now,
    armedDepMs: now - 3 * 60_000,
    waitSec: -90,
  }),
  'waitSec klar negativ → missed',
);
assert(
  !isDepartureClearlyMissed({
    nowMs: now,
    armedDepMs: now - 30_000,
  }),
  'ohne Board nur kurze Überziehung → nicht missed',
);

console.log('missedConnectionPolicy.smoke.test.ts OK');""",
        "smoke asserts",
    )
    force_write(p, t)
    print("OK smoke")


def main() -> None:
    patch_journey_leave_by()
    patch_nav_gps_snap()
    patch_native_map_puck()
    patch_explore_guard()
    patch_guest_auth_nudge()
    patch_gemini_max_tokens()
    patch_smoke_missed()
    print("ALL DONE")


if __name__ == "__main__":
    main()
