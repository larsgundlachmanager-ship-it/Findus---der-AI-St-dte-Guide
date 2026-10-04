# -*- coding: utf-8 -*-
from pathlib import Path

p = Path(r"c:\Users\larsf\Findus 2.0\src\services\alarms\timerService.ts")
t = p.read_text(encoding="utf-8")

old = '''/** Parse relative Dauer → ms (max 12h, min 5s). */
export function parseTimerDurationMs(text: string): number | null {
  const t = text.replace(/\\s+/g, ' ').trim().toLowerCase();

  if (/\\b(?:eine?\\s+)?halbe\\s+stunde\\b/.test(t)) return 30 * 60_000;
  if (/\\b(?:eine?\\s+)?viertel\\s*stunde\\b/.test(t)) return 15 * 60_000;
  if (/\\b(?:eine?\\s+)?dreiviertel\\s*stunde\\b/.test(t)) return 45 * 60_000;

  const combo = t.match(
    /\\b(\\d{1,2})\\s*(?:stunden?|std|h)\\s*(?:und\\s*)?(\\d{1,2})\\s*(?:min(?:uten)?|min)?\\b/,
  );
  if (combo) {
    const h = Number(combo[1]);
    const m = Number(combo[2]);
    if (h >= 0 && h <= 12 && m >= 0 && m < 60) {
      return (h * 60 + m) * 60_000;
    }
  }

  const hours = t.match(
    /\\b(\\d{1,2}|eine?|zwei|drei|vier|fünf|fuenf|sechs)\\s*(?:stunden?|std\\.?|h)\\b/,
  );
  if (hours) {
    const n = /^\\d+$/.test(hours[1]) ? Number(hours[1]) : wordNumber(hours[1]);
    if (n != null && n >= 1 && n <= 12) return n * 60 * 60_000;
  }

  const mins = t.match(
    /\\b(\\d{1,3}|eine?|zwei|drei|vier|fünf|fuenf|zehn|fünfzehn|fuenfzehn|zwanzig|dreißig|dreissig)\\s*(?:minuten?|min\\.?|m)\\b/,
  );
  if (mins) {
    const n = /^\\d+$/.test(mins[1]) ? Number(mins[1]) : wordNumber(mins[1]);
    if (n != null && n >= 1 && n <= 12 * 60) return n * 60_000;
  }

  const secs = t.match(/\\b(\\d{1,3})\\s*(?:sekunden?|sek\\.?|s)\\b/);
  if (secs) {
    const n = Number(secs[1]);
    if (n >= 5 && n <= 3600) return n * 1000;
  }

  // „in 10“ nach Timer-Keyword → Minuten
  if (TIMER_INTENT.test(t)) {
    const bare = t.match(/\\b(?:in|auf|für|fuer)\\s+(\\d{1,3})\\b/);
    if (bare) {
      const n = Number(bare[1]);
      if (n >= 1 && n <= 180) return n * 60_000;
    }
  }

  return null;
}'''

new = '''/** Parse relative Dauer → ms (max 12h, min 5s). */
export function parseTimerDurationMs(text: string): number | null {
  const t = String(text || '')
    .normalize('NFKC')
    .replace(/[\\u00A0\\u202F\\u2007\\uFEFF]/g, ' ')
    .replace(/\\s+/g, ' ')
    .trim()
    .toLowerCase();

  if (/\\b(?:eine?\\s+)?halbe\\s+stunde\\b/.test(t)) return 30 * 60_000;
  if (/\\b(?:eine?\\s+)?viertel\\s*stunde\\b/.test(t)) return 15 * 60_000;
  if (/\\b(?:eine?\\s+)?dreiviertel\\s*stunde\\b/.test(t)) return 45 * 60_000;

  const combo = t.match(
    /(\\d{1,2})\\s*(?:stunden?|std|h)\\s*(?:und\\s*)?(\\d{1,2})\\s*(?:min(?:uten)?|min)?\\b/,
  );
  if (combo) {
    const h = Number(combo[1]);
    const m = Number(combo[2]);
    if (h >= 0 && h <= 12 && m >= 0 && m < 60) {
      return (h * 60 + m) * 60_000;
    }
  }

  const hours = t.match(
    /(\\d{1,2}|eine?|zwei|drei|vier|fünf|fuenf|sechs)\\s*(?:stunden?|std\\.?|h)\\b/,
  );
  if (hours) {
    const n = /^\\d+$/.test(hours[1]!) ? Number(hours[1]) : wordNumber(hours[1]!);
    if (n != null && n >= 1 && n <= 12) return n * 60 * 60_000;
  }

  // Ziffern zuerst — ohne fragiles \\b vor der Zahl (Hermes/Unicode).
  const digMin = t.match(/(\\d{1,3})\\s*(?:minuten?|mins?|min\\.?)\\b/);
  if (digMin) {
    const n = Number(digMin[1]);
    if (n >= 1 && n <= 12 * 60) return n * 60_000;
  }

  const wordMin = t.match(
    /\\b(eine?|zwei|drei|vier|fünf|fuenf|zehn|fünfzehn|fuenfzehn|zwanzig|dreißig|dreissig)\\s*(?:minuten?|mins?|min\\.?)\\b/,
  );
  if (wordMin) {
    const n = wordNumber(wordMin[1]!);
    if (n != null && n >= 1 && n <= 12 * 60) return n * 60_000;
  }

  const secs = t.match(/(\\d{1,3})\\s*(?:sekunden?|sek\\.?|s)\\b/);
  if (secs) {
    const n = Number(secs[1]);
    if (n >= 5 && n <= 3600) return n * 1000;
  }

  // „Timer … 2 …“ / „in 10“ → Minuten
  if (TIMER_INTENT.test(t) || /\\btimer\\b/.test(t)) {
    const bare = t.match(/\\b(?:in|auf|für|fuer)\\s+(\\d{1,3})\\b/);
    if (bare) {
      const n = Number(bare[1]);
      if (n >= 1 && n <= 180) return n * 60_000;
    }
    const anyNum = t.match(/(\\d{1,3})/);
    if (anyNum) {
      const n = Number(anyNum[1]);
      if (n >= 1 && n <= 180) return n * 60_000;
    }
  }

  return null;
}'''

if old not in t:
    raise SystemExit('parse block not found')
t = t.replace(old, new, 1)

# stronger logging that survives release minify better
old2 = '''  clearPendingTimerDurationAsk();
  const label = extractTimerLabel(t);
  console.log('[timer] start', { durationMs, label, text: t.slice(0, 80) });
  const started = await startFindusTimer({ durationMs, label });'''

new2 = '''  clearPendingTimerDurationAsk();
  const label = extractTimerLabel(t);
  console.warn('[timer] start', durationMs, label, t.slice(0, 80));
  const started = await startFindusTimer({ durationMs, label });'''

if old2 in t:
    t = t.replace(old2, new2, 1)
else:
    print('warn: log line not updated')

old3 = '''  const durationMs = parseTimerDurationMs(t);
  if (durationMs == null) {
    markPendingTimerDurationAsk();
    return {
      speech:
        'Klar — sag mir die Dauer, z. B. „Timer 10 Minuten“ oder „Eieruhr 3 Minuten“.',
      bullets: ['Dauer fehlt'],'''

new3 = '''  const durationMs = parseTimerDurationMs(t);
  if (durationMs == null) {
    console.warn('[timer] duration missing for:', t.slice(0, 120));
    markPendingTimerDurationAsk();
    return {
      speech:
        'Klar — sag mir die Dauer, z. B. „Timer 10 Minuten“ oder „Eieruhr 3 Minuten“.',
      bullets: ['Dauer fehlt'],'''

if old3 not in t:
    raise SystemExit('duration null block not found')
t = t.replace(old3, new3, 1)

p.write_text(t, encoding='utf-8')
print('parse hardened ok')
