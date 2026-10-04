# -*- coding: utf-8 -*-
"""Fix Reisebüro boot race: remove cue restart, Strict-Mode-safe bootOnce."""
from pathlib import Path
import re

ROOT = Path(r"c:\Users\larsf\Findus 2.0")

# --- Fix encoding in reisebueroLiveMic.ts ---
mic = ROOT / "src/reisebuero/reisebueroLiveMic.ts"
t = mic.read_text(encoding="utf-8")
replacements = [
    ("Eigenes Brainstorming-Mikro ÔÇö nicht Home-Live-Chat, nicht Concierge.",
     "Eigenes Brainstorming-Mikro — nicht Home-Live-Chat, nicht Concierge."),
    ("Standard: immer zuh├Âren. Aus nur bei Modul-zu oder User-Mute.",
     "Standard: immer zuhören. Aus nur bei Modul-zu oder User-Mute."),
    ("/** Tastatur offen ÔÇö STT komplett aus, sonst blockiert Audio-Focus das Tippen. */",
     "/** Tastatur offen — STT komplett aus, sonst blockiert Audio-Focus das Tippen. */"),
    ("message: 'Mikrofon-Einwilligung fehlt ÔÇö bitte unter Einstellungen Sprache an aktivieren.',",
     "message: 'Mikrofon-Einwilligung fehlt — bitte unter Einstellungen Sprache an aktivieren.',"),
    ("/* STT pr├╝ft OS-Permission */",
     "/* STT prüft OS-Permission */"),
]
for a, b in replacements:
    if a in t:
        t = t.replace(a, b)
        print("fixed:", b[:40])
    else:
        print("skip missing:", a[:40])
mic.write_text(t, encoding="utf-8")

# --- Modal boot ---
modal = ROOT / "src/components/ReisebueroModal.tsx"
t = modal.read_text(encoding="utf-8")

# Drop cue import
t = t.replace(
    "import { playLiveChatStartCue } from '../services/handsFree/micStartCue';\n",
    "",
)

old_handlers = """  const micHandlers = useCallback(
    () => ({
      onUtterance: (text: string) => handleRef.current(text),
      onPartial: setPartial,
      onPhase: setMicPhase,
    }),
    [],
  );"""

new_handlers = """  const micHandlers = useCallback(
    () => ({
      onUtterance: (text: string) => handleRef.current(text),
      onPartial: setPartial,
      onPhase: setMicPhase,
      getAskContext: () => {
        const trip = useReisebueroStore.getState().trip;
        const turns = trip.chat.filter((c) => c.role === 'user').length;
        return {
          turnIndex: turns,
          lastAskOpen: turns < 2,
        };
      },
    }),
    [],
  );"""

if old_handlers in t:
    t = t.replace(old_handlers, new_handlers, 1)
    print("handlers patched")
else:
    print("handlers NOT found")

old_boot = """  const sessionCuePlayed = useRef(false);
  const micHandlersRef = useRef(micHandlers);
  micHandlersRef.current = micHandlers;
  const speakSafeRef = useRef(speakSafe);
  speakSafeRef.current = speakSafe;
  const syncReadyRef = useRef(syncSearchReadySticky);
  syncReadyRef.current = syncSearchReadySticky;


  // Ein Boot pro Open: Greeting → Speech idle → Mic rot „Ich höre zu“.
  useEffect(() => {
    if (!visible) {
      sessionCuePlayed.current = false;
      void stopReisebueroMic();
      return;
    }
    let alive = true;
    void (async () => {
      const snapshot = useReisebueroStore.getState().trip;
      const userTurns = snapshot.chat.filter((c) => c.role === 'user').length;
      const last = snapshot.chat[snapshot.chat.length - 1];
      setBusy(true);
      busyRef.current = true;
      try {
        if (userTurns === 0) {
          const existing = snapshot.chat.find((c) => c.role === 'assistant')?.text;
          const speech = existing?.trim() || (await runOpeningGreeting());
          if (!alive) return;
          await speakSafeRef.current(speech);
        } else if (last?.role === 'user') {
          const speech = await runBriefingReply();
          if (!alive) return;
          await speakSafeRef.current(speech);
          syncReadyRef.current();
        }
      } catch (e) {
        console.warn('[Reisebuero] opening speech failed', e);
      } finally {
        if (alive) {
          busyRef.current = false;
          setBusy(false);
        }
      }
      if (!alive) return;

      await waitReisebueroSpeechIdle({ postIdleMs: 150 });
      if (!alive) return;

      // Zuerst echtes Mic (Aufnahme-Modus) — Cue erst danach (sonst killt Playback den Mic).
      const res = await startReisebueroMic(micHandlersRef.current());
      if (!alive) {
        await stopReisebueroMic();
        return;
      }
      if (!res.ok) {
        console.warn('[Reisebuero] auto-mic:', res.message);
        await new Promise((r) => setTimeout(r, 500));
        if (!alive) return;
        const retry = await startReisebueroMic(micHandlersRef.current());
        if (!retry.ok && retry.message) Alert.alert('Mikrofon', retry.message);
        return;
      }
      if (!sessionCuePlayed.current) {
        sessionCuePlayed.current = true;
        void playLiveChatStartCue({ force: true })
          .catch(() => undefined)
          .finally(() => {
            // Nach Cue Aufnahme-Modus wieder hart setzen.
            void startReisebueroMic(micHandlersRef.current());
          });
      }
    })();
    return () => {
      alive = false;
      void stopReisebueroMic();
    };
  }, [visible]);"""

new_boot = """  const micHandlersRef = useRef(micHandlers);
  micHandlersRef.current = micHandlers;
  const speakSafeRef = useRef(speakSafe);
  speakSafeRef.current = speakSafe;
  const syncReadyRef = useRef(syncSearchReadySticky);
  syncReadyRef.current = syncSearchReadySticky;
  const bootOnce = useRef(false);

  // Ein Boot pro Open: Greeting → Speech idle → Mic rot (kein Cue — Cue killt Android-Aufnahme).
  useEffect(() => {
    if (!visible) {
      bootOnce.current = false;
      void stopReisebueroMic();
      return;
    }
    if (bootOnce.current) return;
    bootOnce.current = true;

    void (async () => {
      const snapshot = useReisebueroStore.getState().trip;
      const userTurns = snapshot.chat.filter((c) => c.role === 'user').length;
      const last = snapshot.chat[snapshot.chat.length - 1];
      setBusy(true);
      busyRef.current = true;
      try {
        if (userTurns === 0) {
          const existing = snapshot.chat.find((c) => c.role === 'assistant')?.text;
          const speech = existing?.trim() || (await runOpeningGreeting());
          await speakSafeRef.current(speech);
        } else if (last?.role === 'user') {
          const speech = await runBriefingReply();
          await speakSafeRef.current(speech);
          syncReadyRef.current();
        }
      } catch (e) {
        console.warn('[Reisebuero] opening speech failed', e);
      } finally {
        busyRef.current = false;
        setBusy(false);
      }

      if (!useReisebueroStore.getState().overlayOpen) return;
      await waitReisebueroSpeechIdle({ postIdleMs: 200 });
      if (!useReisebueroStore.getState().overlayOpen) return;

      const res = await startReisebueroMic(micHandlersRef.current());
      if (!res.ok) {
        console.warn('[Reisebuero] auto-mic:', res.message);
        await new Promise((r) => setTimeout(r, 500));
        if (!useReisebueroStore.getState().overlayOpen) return;
        const retry = await startReisebueroMic(micHandlersRef.current());
        if (!retry.ok && retry.message) Alert.alert('Mikrofon', retry.message);
      }
    })();
  }, [visible]);"""

if old_boot in t:
    t = t.replace(old_boot, new_boot, 1)
    print("boot patched")
else:
    print("boot NOT found — trying regex")
    m = re.search(
        r"  const sessionCuePlayed = useRef\(false\);.*?  \}, \[visible\]\);",
        t,
        flags=re.S,
    )
    if m:
        t = t[: m.start()] + new_boot + t[m.end() :]
        print("boot patched via regex")
    else:
        raise SystemExit("BOOT BLOCK NOT FOUND")

# Faster endpoint delays for conversation feel
ep = ROOT / "src/reisebuero/reisebueroEndpoint.ts"
ep.write_text(
    """/**
 * Reisebüro Endpoint — Gesprächstempo (~0.55–0.8s Stille).
 */

const SHORT_ACK =
  /^(ja|nein|nee|nö|ok|okay|klar|genau|passt|gut|vier|drei|zwei|eins|ein|eine|\\d{1,2})\\b/iu;

export function isShortClosedAnswer(text: string): boolean {
  const t = text.replace(/\\s+/g, ' ').trim();
  const words = t.split(/\\s+/).filter(Boolean).length;
  if (!t) return false;
  if (words <= 4 && SHORT_ACK.test(t)) return true;
  if (words <= 3 && /\\b(stück|leute|personen|mann|jungs)\\b/iu.test(t)) return true;
  return false;
}

export function reisebueroEndpointDelayMs(
  text: string,
  ctx: { turnIndex: number; lastAskOpen: boolean },
): number {
  const t = text.replace(/\\s+/g, ' ').trim();
  const words = t.split(/\\s+/).filter(Boolean).length;
  const short = isShortClosedAnswer(t);
  const hanging = /\\b(und|aber|oder|dass|weil|also|mit|vom|von|bis|zum)$/iu.test(t);

  if (hanging) return 900;
  if (short) return 550;
  if (words >= 12) return 800;
  if (ctx.turnIndex < 2 && ctx.lastAskOpen) return 750;
  return 650;
}

export function isOpenAskKey(key: string | null | undefined): boolean {
  if (!key) return false;
  return (
    key === 'purpose' ||
    key === 'mode' ||
    key === 'when' ||
    key === 'lodging' ||
    key === 'energy' ||
    key === 'driveTime' ||
    key === 'adults' ||
    key === 'budget' ||
    key === 'locationBias' ||
    key === 'lastTrip' ||
    key === 'highlight' ||
    key === 'dealbreaker' ||
    key === 'extraWishes' ||
    key === 'partyStyle' ||
    key === 'spaStyle' ||
    key === 'kidsStyle' ||
    key === 'tripShape' ||
    key === 'ideaHook' ||
    key === 'rentalCar' ||
    key === 'dest' ||
    key === 'weather' ||
    key === 'wrap_up' ||
    key === 'origin' ||
    key === 'directFlight' ||
    key === 'departWindow' ||
    key === 'partyGrain' ||
    key === 'ready_announce'
  );
}
""",
    encoding="utf-8",
)
print("endpoint rewritten")

modal.write_text(t, encoding="utf-8")
print("cue import left?", "playLiveChatStartCue" in t)
print("bootOnce?", "bootOnce" in t)
print("done")
