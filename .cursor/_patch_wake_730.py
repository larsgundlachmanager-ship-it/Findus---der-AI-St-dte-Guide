from pathlib import Path
import os, tempfile

def write(path: str, text: str):
    p = Path(path)
    fd, tmp = tempfile.mkstemp(suffix=".tmp", dir=str(p.parent))
    os.close(fd)
    Path(tmp).write_text(text, encoding="utf-8", newline="\n")
    os.replace(tmp, p)
    print("wrote", path)

def replace(path: str, old: str, new: str, label: str):
    p = Path(path)
    text = p.read_text(encoding="utf-8")
    if old not in text:
        raise SystemExit(f"FAIL {label}: needle not found")
    if text.count(old) != 1:
        raise SystemExit(f"FAIL {label}: hits={text.count(old)}")
    text = text.replace(old, new)
    fd, tmp = tempfile.mkstemp(suffix=".tmp", dir=str(p.parent))
    os.close(fd)
    Path(tmp).write_text(text, encoding="utf-8", newline="\n")
    os.replace(tmp, p)
    print("OK", label)

# --- temporalGerman: parseGermanClockHm ---
old_resolve = '''/**
 * Kombiniert relatives Datum + Uhrzeit „HH:MM“ / „um 8“ / „8 Uhr“.
 * Wenn Uhrzeit in der Vergangenheit am Zieltag → bleibt am Zieltag (kein Extra-Roll außer explizit).
 */
export function resolveDateTimeMs(opts: {
  text: string;
  now?: Date;
  defaultHour?: number;
  defaultMinute?: number;
}): number | null {
  const now = opts.now ?? new Date();
  const kw = detectRelativeDayKeyword(opts.text);
  const day = kw ? resolveRelativeDay(kw, now) : startOfLocalDay(now);

  const hm =
    opts.text.match(/\\b(?:um\\s*)?(\\d{1,2})(?::(\\d{2}))?\\s*uhr\\b/iu) ||
    opts.text.match(/\\b(\\d{1,2})[:.,](\\d{2})\\b/);

  let hour = opts.defaultHour ?? 8;
  let minute = opts.defaultMinute ?? 0;
  if (hm) {
    hour = Math.min(23, Math.max(0, parseInt(hm[1], 10)));
    minute = hm[2] ? Math.min(59, parseInt(hm[2], 10)) : 0;
  } else if (!kw && !/\\bheute|morgen|übermorgen|uebermorgen\\b/iu.test(opts.text)) {
    return null;
  }
  // Nie defaultHour behalten, wenn eine andere Uhrzeit im Text steht und nicht gematcht wurde
  if (
    !hm &&
    /\\b(\\d{1,2})\\s*(?:uhr)?\\b/iu.test(opts.text) &&
    opts.defaultHour != null
  ) {
    const loose = opts.text.match(/\\b(?:um\\s+)?(\\d{1,2})(?:[:.,](\\d{2}))?\\b/i);
    if (loose) {
      hour = Math.min(23, Math.max(0, parseInt(loose[1], 10)));
      minute = loose[2] ? Math.min(59, parseInt(loose[2], 10)) : 0;
    }
  }

  const out = new Date(day);
  out.setHours(hour, minute, 0, 0);
  return out.getTime();
}
'''

new_resolve = '''const HOUR_WORDS: Record<string, number> = {
  eins: 1,
  ein: 1,
  zwei: 2,
  drei: 3,
  vier: 4,
  fuenf: 5,
  fünf: 5,
  sechs: 6,
  sieben: 7,
  acht: 8,
  neun: 9,
  zehn: 10,
  elf: 11,
  zwoelf: 12,
  zwölf: 12,
  zwo: 12,
};

const MINUTE_WORDS: Record<string, number> = {
  null: 0,
  zero: 0,
  fünf: 5,
  fuenf: 5,
  zehn: 10,
  fünfzehn: 15,
  fuenfzehn: 15,
  zwanzig: 20,
  fünfundzwanzig: 25,
  fuenfundzwanzig: 25,
  dreißig: 30,
  dreissig: 30,
  fünfunddreißig: 35,
  fuenfunddreissig: 35,
  fuenfunddreißig: 35,
  vierzig: 40,
  fünfundvierzig: 45,
  fuenfundvierzig: 45,
  fünfzig: 50,
  fuenfzig: 50,
  fünfundfünfzig: 55,
  fuenfundfuenfzig: 55,
};

function parseHourToken(raw: string): number | null {
  const s = raw.toLowerCase().replace('ä', 'ae');
  if (/^\\d{1,2}$/.test(s)) {
    const n = Number(s);
    return n >= 0 && n <= 23 ? n : null;
  }
  return HOUR_WORDS[s] ?? null;
}

function parseMinuteToken(raw: string): number | null {
  const s = raw.toLowerCase().replace('ä', 'ae');
  if (/^\\d{1,2}$/.test(s)) {
    const n = Number(s);
    return n >= 0 && n <= 59 ? n : null;
  }
  return MINUTE_WORDS[s] ?? null;
}

/**
 * Deutsche Weck-/Uhrzeiten aus Speech/STT.
 * Wichtig: „7 Uhr 30“ / „sieben Uhr dreißig“ / „halb acht“ — nicht nur „7 Uhr“ (= :00).
 */
export function parseGermanClockHm(
  text: string,
): { hour: number; minute: number } | null {
  const t = (text || '').replace(/\\s+/g, ' ').trim();
  if (!t) return null;

  const hm = t.match(/\\b(\\d{1,2})[:.,](\\d{2})\\b/);
  if (hm) {
    const hour = Number(hm[1]);
    const minute = Number(hm[2]);
    if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
      return { hour, minute };
    }
  }

  const halb = t.match(
    /\\b(?:um|gegen)?\\s*halb\\s+(eins|ein|zwei|drei|vier|fünf|fuenf|sechs|sieben|acht|neun|zehn|elf|zwölf|zwoelf|zwo|\\d{1,2})\\b/iu,
  );
  if (halb?.[1]) {
    const endH = parseHourToken(halb[1]);
    if (endH != null && endH >= 1 && endH <= 23) {
      const hour = endH === 1 ? 0 : endH - 1;
      return { hour, minute: 30 };
    }
  }

  const hourWord =
    'eins|ein|zwei|drei|vier|fünf|fuenf|sechs|sieben|acht|neun|zehn|elf|zwölf|zwoelf|zwo';
  const minWord =
    'null|fünf|fuenf|zehn|fünfzehn|fuenfzehn|zwanzig|fünfundzwanzig|fuenfundzwanzig|dreißig|dreissig|fünfunddreißig|fuenfunddreißig|fuenfunddreissig|vierzig|fünfundvierzig|fuenfundvierzig|fünfzig|fuenfzig';

  // „7 Uhr 30“ / „sieben Uhr dreißig“ — Minuten NACH uhr (STT oft so)
  const uhrMin = t.match(
    new RegExp(
      `\\\\b(?:um|gegen)?\\\\s*(${hourWord}|\\\\d{1,2})\\\\s*uhr\\\\s+(${minWord}|\\\\d{1,2})\\\\b`,
      'iu',
    ),
  );
  if (uhrMin) {
    const hour = parseHourToken(uhrMin[1]!);
    const minute = parseMinuteToken(uhrMin[2]!);
    if (hour != null && minute != null) return { hour, minute };
  }

  const uhrOnly = t.match(
    new RegExp(
      `\\\\b(?:um|gegen)?\\\\s*(${hourWord}|\\\\d{1,2})\\\\s*uhr\\\\b`,
      'iu',
    ),
  );
  if (uhrOnly) {
    const hour = parseHourToken(uhrOnly[1]!);
    if (hour != null) return { hour, minute: 0 };
  }

  const umHour = t.match(/\\b(?:um|gegen)\\s+(\\d{1,2})\\b(?!\\s*(?:min|minute|minuten|sek))/iu);
  if (umHour) {
    const hour = Number(umHour[1]);
    if (hour >= 0 && hour <= 23) return { hour, minute: 0 };
  }

  return null;
}

/**
 * Kombiniert relatives Datum + Uhrzeit „HH:MM“ / „um 8“ / „8 Uhr“ / „7 Uhr 30“.
 * Wenn Uhrzeit in der Vergangenheit am Zieltag → bleibt am Zieltag (kein Extra-Roll außer explizit).
 */
export function resolveDateTimeMs(opts: {
  text: string;
  now?: Date;
  defaultHour?: number;
  defaultMinute?: number;
}): number | null {
  const now = opts.now ?? new Date();
  const kw = detectRelativeDayKeyword(opts.text);
  const day = kw ? resolveRelativeDay(kw, now) : startOfLocalDay(now);

  const parsed = parseGermanClockHm(opts.text);
  let hour = opts.defaultHour ?? 8;
  let minute = opts.defaultMinute ?? 0;
  if (parsed) {
    hour = parsed.hour;
    minute = parsed.minute;
  } else if (!kw && !/\\bheute|morgen|übermorgen|uebermorgen\\b/iu.test(opts.text)) {
    return null;
  }

  const out = new Date(day);
  out.setHours(hour, minute, 0, 0);
  return out.getTime();
}
'''

replace(r"src/services/time/temporalGerman.ts", old_resolve, new_resolve, "temporalGerman clock parse")

# --- wakeAlarmAdvisor: use parseGermanClockHm + default replace ---
replace(
    r"src/services/alarms/wakeAlarmAdvisor.ts",
    """import { resolveDateTimeMs, isPostMidnightWindow } from '../time/temporalGerman';
""",
    """import {
  resolveDateTimeMs,
  isPostMidnightWindow,
  parseGermanClockHm,
} from '../time/temporalGerman';
""",
    "wake import parseGermanClockHm",
)

replace(
    r"src/services/alarms/wakeAlarmAdvisor.ts",
    """  // Temporal SSOT: „morgen um 8“ / Post-Midnight
  const fromSsot = resolveDateTimeMs({ text: t, defaultHour: 8 });
  if (
    fromSsot != null &&
    (hasClockHint(t) ||
      /\\bmorgen\\b/i.test(t) ||
      /\\b(?:morgens|früh|frueh)\\b/i.test(t))
  ) {
    if (fromSsot >= Date.now() + 20_000) return fromSsot;
  }

  const clock =
    t.match(/\\b(\\d{1,2})[:.](\\d{2})\\b/) ||
    t.match(/\\b(?:um\\s+)?(\\d{1,2})(?::(\\d{2}))?\\s*(?:uhr)?\\b/i);
  if (!clock) return null;
  // Bei klarem Wake-Intent reicht die Zahl — sonst um/uhr/wecker
  if (
    !/\\bum\\b|\\buhr\\b|\\bauf\\s+\\d/i.test(t) &&
    !/:\\d{2}|\\.\\d{2}/.test(t) &&
    !detectWakeAlarmIntent(t)
  ) {
    if (!/\\bwecker|alarm\\b/i.test(t)) return null;
  }
  const h = Number(clock[1]);
  const m = Number(clock[2] ?? 0);
  if (h < 0 || h > 23 || m < 0 || m > 59) return null;
  const d = new Date();
  d.setSeconds(0, 0);
  d.setHours(h, m, 0, 0);
""",
    """  // Temporal SSOT: „morgen um 8“ / „7 Uhr 30“ / „halb acht“ / Post-Midnight
  const fromSsot = resolveDateTimeMs({ text: t, defaultHour: 8 });
  if (
    fromSsot != null &&
    (hasClockHint(t) ||
      parseGermanClockHm(t) != null ||
      /\\bmorgen\\b/i.test(t) ||
      /\\b(?:morgens|früh|frueh)\\b/i.test(t))
  ) {
    if (fromSsot >= Date.now() + 20_000) return fromSsot;
  }

  const parsed = parseGermanClockHm(t);
  if (!parsed) return null;
  // Bei klarem Wake-Intent reicht die Zahl — sonst um/uhr/wecker
  if (
    !/\\bum\\b|\\buhr\\b|\\bauf\\s+\\d|\\bhalb\\b/i.test(t) &&
    !/:\\d{2}|\\.\\d{2}/.test(t) &&
    !detectWakeAlarmIntent(t)
  ) {
    if (!/\\bwecker|alarm\\b/i.test(t)) return null;
  }
  const h = parsed.hour;
  const m = parsed.minute;
  const d = new Date();
  d.setSeconds(0, 0);
  d.setHours(h, m, 0, 0);
""",
    "wake parseExplicitWakeMs",
)

replace(
    r"src/services/alarms/wakeAlarmAdvisor.ts",
    """    const forceReplace =
      /\\b(aktualisier|ersetz|änder|aender|verschieb)\\b/i.test(t);
    const forceAdd =
      /\\b(zweiten|zweiter|noch\\s+einen|zusätzlich|zusaetzlich|extra)\\b/i.test(t);
    const voiceStyle = parseWakeVoiceStyle(t);
    const { setWakeAlarmWithBridge } = await import('./nativeAlarmBridge');
    const result = await setWakeAlarmWithBridge({
      wakeAtMs: explicit,
      reasonLabel: 'Aufstehen',
      reminderKey: `explicit:${explicit}`,
      preferNative: true,
      wakeMode: forceReplace ? 'replace' : forceAdd ? 'add' : undefined,
      voiceStyle,
    });
""",
    """    // Just-Do-It: neue explizite Zeit = umstellen (nicht Choice-Quiz).
    // Nur „zweiten/extra“ hält den alten Wecker und addiert.
    const forceAdd =
      /\\b(zweiten|zweiter|noch\\s+einen|zusätzlich|zusaetzlich|extra)\\b/i.test(t);
    const voiceStyle = parseWakeVoiceStyle(t);
    const { setWakeAlarmWithBridge } = await import('./nativeAlarmBridge');
    const result = await setWakeAlarmWithBridge({
      wakeAtMs: explicit,
      reasonLabel: 'Aufstehen',
      reminderKey: `explicit:${explicit}`,
      preferNative: true,
      wakeMode: forceAdd ? 'add' : 'replace',
      voiceStyle,
    });
""",
    "wake default replace",
)

write(
    r"src/services/time/temporalGerman.clock.smoke.test.ts",
    """import assert from 'node:assert/strict';
import { parseGermanClockHm, resolveDateTimeMs } from './temporalGerman';

assert.deepEqual(parseGermanClockHm('Wecker auf 7:30'), { hour: 7, minute: 30 });
assert.deepEqual(parseGermanClockHm('stell den Wecker auf 7 Uhr 30'), {
  hour: 7,
  minute: 30,
});
assert.deepEqual(parseGermanClockHm('Wecker um sieben Uhr dreißig'), {
  hour: 7,
  minute: 30,
});
assert.deepEqual(parseGermanClockHm('halb acht Wecker'), { hour: 7, minute: 30 });
assert.deepEqual(parseGermanClockHm('Wecker um 7 Uhr'), { hour: 7, minute: 0 });

const now = new Date('2026-09-15T00:20:00+02:00');
const ms = resolveDateTimeMs({
  text: 'stell den Wecker auf 7 Uhr 30',
  now,
});
assert.ok(ms != null);
const d = new Date(ms!);
assert.equal(d.getHours(), 7);
assert.equal(d.getMinutes(), 30);

console.log('temporalGerman.clock.smoke.test.ts: ok');
""",
)

write(
    r"src/services/alarms/wakeExplicitReplace.smoke.test.ts",
    """import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const advisor = readFileSync(
  join(process.cwd(), 'src/services/alarms/wakeAlarmAdvisor.ts'),
  'utf8',
);
assert(advisor.includes("wakeMode: forceAdd ? 'add' : 'replace'"), 'explicit time replaces by default');
assert(advisor.includes('parseGermanClockHm'), 'wake uses German clock parser');
assert(!/wakeMode: forceReplace \\? 'replace' : forceAdd \\? 'add' : undefined/.test(advisor), 'no choice-default on explicit');

console.log('wakeExplicitReplace.smoke.test.ts: ok');
""",
)

print("all patches done")
