from pathlib import Path

p = Path(r"c:\Users\larsf\Findus 2.0\src\services\navigation\modulePriorityPolicy.ts")
t = p.read_text(encoding="utf-8")

start = t.index("import { AppState")
end = t.index("/** Neutral-3min Event-Clock")
replacement = """import { useFinnusStore } from '../../store/useFinnusStore';
import {
  OPEN_QUIET_MS,
  bootstrapOpenQuietGate,
  getOpenQuietRemainingMs,
  isOpenQuietActive,
  noteAppOpenedQuiet,
  resetOpenQuietGateForTests,
} from './openQuietGate';

export {
  OPEN_QUIET_MS,
  bootstrapOpenQuietGate,
  getOpenQuietRemainingMs,
  isOpenQuietActive,
  noteAppOpenedQuiet,
  resetOpenQuietGateForTests,
};

/** Nach Modul-2-Ende bis Modul 4 (Wetter etc.) sprechen darf. */
export const MODULE4_AFTER_M2_MS = 60_000;
/** Nach Modul-2-Ende bis Modul 1 (Explore) wieder darf. */
export const MODULE1_AFTER_M2_MS = 60_000;
/** Nach Planungs-Session bis Modul 1 — gleich wie nach M2. */
export const MODULE1_AFTER_PLANNING_MS = 60_000;
/** Nach Modul-1- oder Nav-Sprechen: Fremd-Module (Regen, Presence) warten. */
export const MODULE1_AFTER_OWN_SPEECH_MS = 15_000;
/** Nach Busy (reden/denken) mindestens so lange Stille. */
export const BUSY_AFTER_MS = 10_000;
/** Zwei verschiedene M1-Orte hintereinander. */
export const MODULE1_BETWEEN_PLACES_MS = 10_000;
/** Mindestabstand zwischen zwei Wegweisern. */
export const WEGWEISER_GAP_MS = 45_000;
/** Nach Wegweiser → zugehöriger Hauptpunkt darf schneller folgen. */
export const WEGWEISER_TO_MAIN_MS = 5_000;
/** Wegweiser → anderer Hauptpunkt. */
export const WEGWEISER_TO_OTHER_MAIN_MS = 10_000;
/** Erinnerung: Approach gehört → 10 Min für Skip-Intro am Hauptpunkt. */
export const APPROACH_MEMORY_MS = 10 * 60_000;
/** Bundling: Wegweiser innerhalb dieses Radius gemeinsam erzählen. */
export const WEGWEISER_BUNDLE_M = 50;

/** Nav-Knoten Mute für Modul 1: zu Fuß — nur enges Abbiege-Fenster. */
export const MODULE1_NAV_MUTE_FOOT_M = 14;
/** Nav-Knoten Mute für Modul 1: Fahrrad. */
export const MODULE1_NAV_MUTE_BIKE_M = 35;

let module2SpeechEndedAtMs: number | null = null;
let planningEndedAtMs: number | null = null;
let lastOwnSpeechAtMs: number | null = null;
let lastWegweiserAtMs: number | null = null;
let lastWegweiserSpotKey: string | null = null;
let lastMainAtMs: number | null = null;
/** Letztes Modul-1-Event (Approach oder Main) — Neutral-3min-Gate. */
let lastModule1EventAtMs: number | null = null;
let lastBusyEndedAtMs: number | null = null;
let wasBusy = false;

"""

# Keep file header comment (lines before first import)
header = t[: start]
# But header currently ends before import - good
# Actually start is at AppState import; we need to keep the docstring at top
header = t[: t.index("import { AppState")]

# Also remove duplicate MODULE constants that were after OPEN_QUIET - the replacement includes them
# The old file had OPEN_QUIET then MODULE4... which we're replacing through Neutral-3min
# Wait - end is at Neutral-3min, and between AppState import and Neutral we have OPEN_QUIET + MODULE consts + state + open quiet funcs
# My replacement includes MODULE consts + state vars. Good.

out = header + replacement + t[end:]
p.write_text(out, encoding="utf-8")
print("rewrote header+state")
print("has AppState import", "from 'react-native'" in out)
print("has openQuietGate", "openQuietGate" in out)
print("dup OPEN_QUIET def", out.count("export const OPEN_QUIET_MS"))
