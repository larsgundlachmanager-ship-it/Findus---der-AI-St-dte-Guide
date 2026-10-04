# -*- coding: utf-8 -*-
from pathlib import Path

p = Path(r"c:\Users\larsf\Findus 2.0\src\services\alarms\timerService.ts")
text = p.read_text(encoding="utf-8")

old1 = """const TIMER_STORAGE_KEY = '@yorro/active_kitchen_timer_v1';

export type TimerFollowUp = {"""

new1 = """const TIMER_STORAGE_KEY = '@yorro/active_kitchen_timer_v1';

/** Nach „Dauer fehlt“: nächste kurze Dauer-Antwort („2 Minuten“) gilt als Timer. */
let pendingTimerDurationAskUntilMs = 0;

export type TimerFollowUp = {"""

if old1 not in text:
    raise SystemExit("block1 not found")
text = text.replace(old1, new1, 1)

old2 = """export function isTimerIntent(text: string): boolean {
  const t = text.replace(/\\s+/g, ' ').trim();
  if (TIMER_CANCEL.test(t)) return true;
  return TIMER_INTENT.test(t);
}"""

new2 = """export function markPendingTimerDurationAsk(ttlMs = 120_000): void {
  pendingTimerDurationAskUntilMs = Date.now() + Math.max(15_000, ttlMs);
}

export function clearPendingTimerDurationAsk(): void {
  pendingTimerDurationAskUntilMs = 0;
}

/** Kurze Antwort nur mit Dauer, nachdem Yorro nach der Timer-Zeit gefragt hat. */
export function isBareTimerDurationReply(text: string): boolean {
  if (Date.now() > pendingTimerDurationAskUntilMs) return false;
  const t = text.replace(/\\s+/g, ' ').trim();
  if (!t || t.length > 48) return false;
  if (
    /\\b(navi|navigation|route|fahr|geh(?:en)?|bring|restaurant|essen|wecker|flug|bahn)\\b/iu.test(
      t,
    )
  ) {
    return false;
  }
  return parseTimerDurationMs(t) != null;
}

export function isTimerIntent(text: string): boolean {
  const t = text.replace(/\\s+/g, ' ').trim();
  if (TIMER_CANCEL.test(t)) return true;
  if (TIMER_INTENT.test(t)) return true;
  return isBareTimerDurationReply(t);
}

/** Speech schon aus Native/Just-Do-It — nicht nochmal Background-Tasks. */
export function looksLikeNativeTimerSpeech(speech: string): boolean {
  const s = (speech || '').trim();
  if (!s) return false;
  if (/^Timer läuft/iu.test(s)) return true;
  if (/^Alles klar — Timer ist aus/iu.test(s)) return true;
  if (/^Gerade läuft kein Timer/iu.test(s)) return true;
  if (/sag mir die Dauer/iu.test(s) && /Timer|Eieruhr/iu.test(s)) return true;
  if (/Mitteilungs-Erlaubnis|Alarm-\\/Mitteilungs/iu.test(s)) return true;
  return false;
}"""

if old2 not in text:
    raise SystemExit("block2 not found")
text = text.replace(old2, new2, 1)

old3 = """function extractTimerLabel(text: string): string {
  if (/powernap|power\\s*nap|nickerchen|kurzschlaf/i.test(text)) {
    return 'Powernap';
  }
  const m = text.match(
    /\\b(?:für|fuer|wegen)\\s+([a-zäöüß0-9][\\wäöüß\\s-]{1,40}?)(?:\\.|$)/iu,
  );
  if (m) return m[1].trim().slice(0, 40);
  return 'Timer';
}"""

new3 = """function extractTimerLabel(text: string): string {
  if (/powernap|power\\s*nap|nickerchen|kurzschlaf/i.test(text)) {
    return 'Powernap';
  }
  const m = text.match(
    /\\b(?:für|fuer|wegen)\\s+([a-zäöüß0-9][\\wäöüß\\s-]{1,40}?)(?:\\.|$)/iu,
  );
  if (m) {
    const lab = m[1].trim().slice(0, 40);
    // „für 2 Minuten“ / „für zehn Minuten“ = Dauer, kein Label
    if (
      /^\\d{1,3}\\s*(?:minuten?|min\\.?|sekunden?|sek\\.?|stunden?|std\\.?|h|m|s)?$/iu.test(
        lab,
      ) ||
      /^(?:eine?|zwei|drei|vier|fünf|fuenf|zehn|fünfzehn|fuenfzehn|zwanzig|dreißig|dreissig)\\s*(?:minuten?|min\\.?|sekunden?|sek\\.?|stunden?|std\\.?|h|m|s)?$/iu.test(
        lab,
      )
    ) {
      return 'Timer';
    }
    return lab;
  }
  return 'Timer';
}"""

if old3 not in text:
    raise SystemExit("block3 not found")
text = text.replace(old3, new3, 1)

old4 = """  const durationMs = parseTimerDurationMs(t);
  if (durationMs == null) {
    return {
      speech:
        'Klar — sag mir die Dauer, z. B. „Timer 10 Minuten“ oder „Eieruhr 3 Minuten“.',
      bullets: ['Dauer fehlt'],
      quickActions: [],
      endsAtMs: 0,
      durationMs: 0,
      label: 'Timer',
    };
  }

  const label = extractTimerLabel(t);
  const started = await startFindusTimer({ durationMs, label });"""

new4 = """  const durationMs = parseTimerDurationMs(t);
  if (durationMs == null) {
    markPendingTimerDurationAsk();
    return {
      speech:
        'Klar — sag mir die Dauer, z. B. „Timer 10 Minuten“ oder „Eieruhr 3 Minuten“.',
      bullets: ['Dauer fehlt'],
      quickActions: [],
      endsAtMs: 0,
      durationMs: 0,
      label: 'Timer',
    };
  }

  clearPendingTimerDurationAsk();
  const label = extractTimerLabel(t);
  console.log('[timer] start', { durationMs, label, text: t.slice(0, 80) });
  const started = await startFindusTimer({ durationMs, label });"""

if old4 not in text:
    raise SystemExit("block4 not found")
text = text.replace(old4, new4, 1)

p.write_text(text, encoding="utf-8")
print("timerService patched ok")
