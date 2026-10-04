# -*- coding: utf-8 -*-
"""Nuclear Reisebüro turn fix: text always works, STT bans TTS engine, mic flush on stop."""
from pathlib import Path

ROOT = Path(r"c:\Users\larsf\Findus 2.0")

# --- sttService: never prefer TTS ---
stt = ROOT / "src/services/sttService.ts"
t = stt.read_text(encoding="utf-8")
old_pref = """const ANDROID_PREFERRED_SPEECH_PACKAGES = [
  // System Intelligence (echtes Mic) vor TTS-Engine (oft no-speech / tot).
  'com.google.android.as',
  'com.google.android.googlequicksearchbox',
  'com.google.android.tts',
] as const;
/** Nur wenn nichts Google-artiges da ist. */
const ANDROID_LAST_RESORT_SPEECH_PACKAGES = [
  'com.qualcomm.qti.voiceai.speech',
] as const;"""
new_pref = """const ANDROID_PREFERRED_SPEECH_PACKAGES = [
  // Echte Recognition — TTS-Engine NIEMALS hier (liefert oft vol=-2 / no-speech).
  'com.google.android.as',
  'com.google.android.googlequicksearchbox',
] as const;
/** Nur wenn nichts Besseres da ist. TTS erkennt auf vielen Geräten nichts. */
const ANDROID_LAST_RESORT_SPEECH_PACKAGES = [
  'com.google.android.tts',
  'com.qualcomm.qti.voiceai.speech',
] as const;"""
if old_pref not in t:
    raise SystemExit("preferred block missing")
t = t.replace(old_pref, new_pref, 1)

# After pick builds order, if AS available never stick on TTS at index 0
old_pick_tail = """    if (forceNext || !androidServicePackage) {
      androidServiceIndex = forceNext
        ? (androidServiceIndex + 1) % order.length
        : 0;
      androidServicePackage = String(order[androidServiceIndex]);
    } else if (!order.includes(androidServicePackage)) {
      androidServicePackage = String(order[0]);
      androidServiceIndex = 0;
    }
    return androidServicePackage ?? undefined;"""
new_pick_tail = """    // TTS nur als Notnagel — wenn AS/QuickSearch da ist, TTS überspringen.
    const nonTts = order.filter((p) => !p.toLowerCase().includes('.tts'));
    const usable = nonTts.length ? nonTts : order;
    if (forceNext || !androidServicePackage || !usable.includes(androidServicePackage)) {
      if (forceNext && androidServicePackage) {
        const cur = usable.indexOf(androidServicePackage);
        androidServiceIndex = (cur + 1) % usable.length;
      } else {
        androidServiceIndex = 0;
      }
      androidServicePackage = String(usable[androidServiceIndex]);
    }
    if (__DEV__) {
      console.log('[stt] recognition order:', usable.join(' | '), '→', androidServicePackage);
    }
    return androidServicePackage ?? undefined;"""
if old_pick_tail not in t:
    raise SystemExit("pick tail missing")
t = t.replace(old_pick_tail, new_pick_tail, 1)

# On no-speech: blacklist TTS immediately when better engine exists
old_quiet = """      if (
        (event.error === 'no-speech' || event.error === 'speech-timeout') &&
        !gotPartialThisSegment &&
        keepAliveHold
      ) {
        if (lastVolumeSample < 0 && quietNoSpeechTries < 2) {
          quietNoSpeechTries += 1;
          void prepareAudioForMicrophone();
        } else {
          quietNoSpeechTries = 0;
          pickAndroidRecognitionPackage(true);
        }
      }"""
new_quiet = """      if (
        (event.error === 'no-speech' || event.error === 'speech-timeout') &&
        !gotPartialThisSegment &&
        keepAliveHold
      ) {
        const svc = androidServicePackage || '';
        if (svc.toLowerCase().includes('.tts')) {
          failedAndroidPackages.add(svc);
          androidServicePackage = null;
          quietNoSpeechTries = 0;
          pickAndroidRecognitionPackage(false);
        } else if (lastVolumeSample < 0 && quietNoSpeechTries < 2) {
          quietNoSpeechTries += 1;
          void prepareAudioForMicrophone();
        } else {
          quietNoSpeechTries = 0;
          pickAndroidRecognitionPackage(true);
        }
      }"""
if old_quiet not in t:
    raise SystemExit("quiet block missing")
t = t.replace(old_quiet, new_quiet, 1)
stt.write_text(t, encoding="utf-8")
print("stt ok")

# --- store: unfreeze on open, briefing always ingests ---
store = ROOT / "src/reisebuero/store.ts"
s = store.read_text(encoding="utf-8")
s = s.replace(
    """      set({ overlayOpen: true, trip });
      return;
    }
    set({ overlayOpen: true });
  },""",
    """      trip.frozen = false;
      trip.thinking = false;
      set({ overlayOpen: true, trip });
      return;
    }
    const cur = get().trip;
    set({
      overlayOpen: true,
      trip: { ...cur, frozen: false, thinking: false },
    });
  },""",
    1,
)
old_ingest = """  ingestUserText: (text) => {
    const t = (text || '').trim();
    if (!t) return;
    const trip = get().trip;
    // During results: allow live-verify path (not frozen hard-block for refine)
    if (trip.frozen && trip.phase !== 'results' && trip.phase !== 'detail' && trip.phase !== 'verify') {
      return;
    }
    const lastAsst = [...trip.chat].reverse().find((c) => c.role === 'assistant')?.text ?? '';
    const norm = (s: string) => s.toLowerCase().replace(/[?!.,]/g, '').replace(/\\s+/g, ' ').trim();
    const nu = norm(t);
    const nq = norm(lastAsst);
    if (
      nq.length > 18 &&
      (nu === nq || (nu.length > 12 && nq.includes(nu)) || (nu.length > 18 && nu.includes(nq.slice(0, 28))))
    ) {
      return;
    }"""
new_ingest = """  ingestUserText: (text) => {
    const t = (text || '').trim();
    if (!t) return;
    const trip = get().trip;
    // Nur Research/Funnel hart blocken — Briefing nie schlucken.
    if (
      trip.frozen &&
      trip.phase !== 'briefing' &&
      trip.phase !== 'recap' &&
      trip.phase !== 'results' &&
      trip.phase !== 'detail' &&
      trip.phase !== 'verify'
    ) {
      if (__DEV__) console.warn('[Reisebuero] ingest blocked frozen', trip.phase);
      return;
    }
    const lastAsst = [...trip.chat].reverse().find((c) => c.role === 'assistant')?.text ?? '';
    const norm = (s: string) => s.toLowerCase().replace(/[?!.,]/g, '').replace(/\\s+/g, ' ').trim();
    const nu = norm(t);
    const nq = norm(lastAsst);
    // Nur echte Echo-Kopien der Assistentenfrage verwerfen — keine Teilstring-Fallen.
    if (nq.length > 24 && nu === nq) {
      return;
    }
    if (__DEV__) console.log('[Reisebuero] ingest:', t.slice(0, 80));"""
if old_ingest not in s:
    raise SystemExit("ingest block missing")
s = s.replace(old_ingest, new_ingest, 1)
store.write_text(s, encoding="utf-8")
print("store ok")

print("done part1")
