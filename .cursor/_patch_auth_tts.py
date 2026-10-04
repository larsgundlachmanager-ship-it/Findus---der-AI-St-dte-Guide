from pathlib import Path

p = Path(r"C:\Users\larsf\Findus 2.0\src\services\account\findusAuth.ts")
t = p.read_text(encoding="utf-8")
old = """export function isAuthCallbackUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  const lower = url.toLowerCase();
  return (
    lower.startsWith(`${AUTH_SCHEME}://`) ||
    lower.includes('://auth/callback') ||
    lower.includes('://auth?') ||
    /[?&#](access_token|refresh_token|code)=/i.test(url)
  );
}"""
new = """export function isAuthCallbackUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  const lower = url.toLowerCase();
  // Nur echte Auth-Callbacks — nie findus://ask / voice / reisebuero schlucken.
  return (
    lower.startsWith(`${AUTH_SCHEME}://${AUTH_CALLBACK_PATH}`) ||
    lower.includes('://auth/callback') ||
    /[?&#](access_token|refresh_token)=/i.test(url) ||
    (/[?&#]code=/i.test(url) && /auth/i.test(lower))
  );
}"""
if old not in t:
    raise SystemExit("auth pattern missing")
p.write_text(t.replace(old, new, 1), encoding="utf-8")
print("auth fixed")

# TTS: recordingModeArmed vor Playback immer lösen
av = Path(r"C:\Users\larsf\Findus 2.0\src\services\AudioVoiceService.ts")
at = av.read_text(encoding="utf-8")
old2 = """async function applyTtsExclusiveAudioMode(): Promise<void> {
  restoreEpoch += 1;
  // Finish any in-flight restore so audio is re-enabled before we take focus again
  if (restoreAmbientPromise) {
    await restoreAmbientPromise.catch(() => undefined);
  }
  await Audio.setAudioModeAsync({
    allowsRecordingIOS: false,
    playsInSilentModeIOS: true,
    staysActiveInBackground: true,
    shouldDuckAndroid: true,
    interruptionModeAndroid: InterruptionModeAndroid.DoNotMix,
    interruptionModeIOS: InterruptionModeIOS.DoNotMix,
  });
}"""
new2 = """async function applyTtsExclusiveAudioMode(): Promise<void> {
  restoreEpoch += 1;
  // Mic/STT darf Playback nicht blockieren (sonst Call-2 stumm nach Mic-Release).
  recordingModeArmed = false;
  // Finish any in-flight restore so audio is re-enabled before we take focus again
  if (restoreAmbientPromise) {
    await restoreAmbientPromise.catch(() => undefined);
  }
  try {
    await Audio.setIsEnabledAsync(true);
  } catch {
    /* soft */
  }
  await Audio.setAudioModeAsync({
    allowsRecordingIOS: false,
    playsInSilentModeIOS: true,
    staysActiveInBackground: true,
    shouldDuckAndroid: true,
    interruptionModeAndroid: InterruptionModeAndroid.DoNotMix,
    interruptionModeIOS: InterruptionModeIOS.DoNotMix,
  });
}"""
if old2 not in at:
    raise SystemExit("audio pattern missing")
av.write_text(at.replace(old2, new2, 1), encoding="utf-8")
print("audio fixed")
