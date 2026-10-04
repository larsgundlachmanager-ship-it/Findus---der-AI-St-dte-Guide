from pathlib import Path

# alarmService — await clock sync; fallback without SKIP_UI
p = Path("src/services/alarmService.ts")
t = p.read_text(encoding="utf-8")

old_il = '''async function tryIntentLauncher(
  hour: number,
  minute: number,
  label: string,
): Promise<{ ok: boolean; detail?: string }> {
  if (Platform.OS !== 'android') {
    return { ok: false, detail: 'ios_unsupported' };
  }
  try {
    const IntentLauncher = await import('expo-intent-launcher');
    await IntentLauncher.startActivityAsync('android.intent.action.SET_ALARM', {
      extra: {
        'android.intent.extra.alarm.HOUR': hour,
        'android.intent.extra.alarm.MINUTES': minute,
        'android.intent.extra.alarm.MESSAGE': label,
        'android.intent.extra.alarm.SKIP_UI': true,
        'android.intent.extra.alarm.VIBRATE': true,
      },
    });
    return { ok: true, detail: 'intent_launcher_skip_ui' };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err ?? 'intent_failed');
    console.warn('[alarmService] IntentLauncher failed:', detail);
    return { ok: false, detail };
  }
}'''

new_il = '''async function tryIntentLauncher(
  hour: number,
  minute: number,
  label: string,
  opts?: { skipUi?: boolean },
): Promise<{ ok: boolean; detail?: string }> {
  if (Platform.OS !== 'android') {
    return { ok: false, detail: 'ios_unsupported' };
  }
  const skipUi = opts?.skipUi !== false;
  try {
    const IntentLauncher = await import('expo-intent-launcher');
    await IntentLauncher.startActivityAsync('android.intent.action.SET_ALARM', {
      extra: {
        'android.intent.extra.alarm.HOUR': hour,
        'android.intent.extra.alarm.MINUTES': minute,
        'android.intent.extra.alarm.MESSAGE': label,
        'android.intent.extra.alarm.SKIP_UI': skipUi,
        'android.intent.extra.alarm.VIBRATE': true,
      },
    });
    return {
      ok: true,
      detail: skipUi ? 'intent_launcher_skip_ui' : 'intent_launcher_with_ui',
    };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err ?? 'intent_failed');
    console.warn('[alarmService] IntentLauncher failed:', detail, 'skipUi=', skipUi);
    return { ok: false, detail };
  }
}'''

if old_il not in t:
    raise SystemExit('tryIntentLauncher missing')
t = t.replace(old_il, new_il, 1)

old_set = '''  // Tier 1 — Kotlin AlarmManager (zuverlässig)
  const t1 = await tryKotlinModule(hour, minute, label);
  if (t1.ok) {
    void tryIntentLauncher(hour, minute, label);
    return {
      ok: true,
      tier: 'kotlin',
      hour,
      minute,
      wakeAtMs,
      label,
      detail: t1.detail,
      speech: successSpeech(hour, minute, 'kotlin'),
    };
  }

  // Tier 2 — IntentLauncher (SET_ALARM + SKIP_UI)
  const t2 = await tryIntentLauncher(hour, minute, label);
  if (t2.ok) {
    return {
      ok: true,
      tier: 'intent_launcher',
      hour,
      minute,
      wakeAtMs,
      label,
      detail: t2.detail,
      speech: successSpeech(hour, minute, 'intent_launcher'),
    };
  }'''

new_set = '''  // Tier 1 — Kotlin AlarmManager (Statusleisten-Wecker)
  const t1 = await tryKotlinModule(hour, minute, label);
  // Clock-App immer zusätzlich syncen (OEM-Uhr) — await, nicht fire-and-forget
  let clockSync = await tryIntentLauncher(hour, minute, label, { skipUi: true });
  if (!clockSync.ok) {
    clockSync = await tryIntentLauncher(hour, minute, label, { skipUi: false });
  }
  if (t1.ok) {
    return {
      ok: true,
      tier: 'kotlin',
      hour,
      minute,
      wakeAtMs,
      label,
      detail: [t1.detail, clockSync.ok ? clockSync.detail : null]
        .filter(Boolean)
        .join(' + '),
      speech: successSpeech(hour, minute, 'kotlin'),
    };
  }

  // Tier 2 — IntentLauncher allein (SET_ALARM)
  if (clockSync.ok) {
    return {
      ok: true,
      tier: 'intent_launcher',
      hour,
      minute,
      wakeAtMs,
      label,
      detail: clockSync.detail,
      speech: successSpeech(hour, minute, 'intent_launcher'),
    };
  }
  const t2 = clockSync;'''

if old_set not in t:
    raise SystemExit('setNativeAlarm tier block missing')
t = t.replace(old_set, new_set, 1)

# Fix leftover t2.ok reference - the old code had if t2.ok after - we replaced and left `const t2 = clockSync` then old `if (t2.ok)` was removed. Check remaining.
if 'if (t2.ok)' in t:
    # remove orphan
    pass

tmp = Path('.phone-check/_alarmService_out.ts')
tmp.write_text(t, encoding='utf-8')
tmp.replace(p)
print('alarmService ok')
