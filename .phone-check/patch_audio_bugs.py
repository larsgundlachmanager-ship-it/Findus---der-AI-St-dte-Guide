# -*- coding: utf-8 -*-
from pathlib import Path

# --- call1Dispatch cinema force ---
p = Path(r"c:\Users\larsf\Findus 2.0\src\module2\router\call1Dispatch.ts")
t = p.read_text(encoding="utf-8")
if "cinema_force" not in t:
    needle = "  // Reines Taxi-Hail — nur wenn Call-1 kein Backend gesetzt hat (sonst SSOT ehren)"
    insert = r"""  // Kino/Filme — nie Tour/Lauf-Tipp (Pack-FAQ „wie weit laufen“)
  if (
    /\b(kino|cinema|filmtheater|kinoprogramm|kinoticket)\b/iu.test(userText) ||
    /\bwelche\s+filme\b/iu.test(userText) ||
    (/\bfilme?\b/iu.test(userText) &&
      /\b(laufen|heute|abend|schauen|programm|ticket)\b/iu.test(userText))
  ) {
    analysis.blueprintId = 'cinema';
    analysis.blueprintStage = 'cinema_orient';
    if (baseline === 'tour_module' || baseline === 'chat_lane' || !explicit) {
      return apply('pitch_module', 'cinema_force', true);
    }
  }

  // Reines Taxi-Hail — nur wenn Call-1 kein Backend gesetzt hat (sonst SSOT ehren)"""
    if needle not in t:
        raise SystemExit("dispatch needle missing")
    p.write_text(t.replace(needle, insert, 1), encoding="utf-8")
    print("call1Dispatch ok")
else:
    print("call1Dispatch already")

# --- liveInventoryGate hotel retry ---
p = Path(r"c:\Users\larsf\Findus 2.0\src\module2\router\liveInventoryGate.ts")
t = p.read_text(encoding="utf-8")
if "HOTEL_RETRY_FOLLOW_RE" not in t:
    needle = """const HOTEL_VERIFY_FOLLOW_RE =
  /\\b(?:wirklich|tatsächlich|tatsaechlich|hab(?:en|t)\\s+(?:die|der|das))\\b.*\\b(?:pool|sauna|hotel|zimmer)\\b|\\b(?:pool|sauna)\\b.*\\b(?:wirklich|tatsächlich|tatsaechlich)\\b/iu;

/** Pitch-Follow-up: Ablehnung / mehr Optionen / Timing-Antwort nach Fork. */"""
    insert = """const HOTEL_VERIFY_FOLLOW_RE =
  /\\b(?:wirklich|tatsächlich|tatsaechlich|hab(?:en|t)\\s+(?:die|der|das))\\b.*\\b(?:pool|sauna|hotel|zimmer)\\b|\\b(?:pool|sauna)\\b.*\\b(?:wirklich|tatsächlich|tatsaechlich)\\b/iu;

/** Hotel-Retry am offenen Auftrag — Stadt (Amsterdam) behalten, kein GPS-Heimat. */
const HOTEL_RETRY_FOLLOW_RE =
  /\\b(?:nochmal|noch\\s*mal|erneut|wieder|nochmals|konkret)\\b[\\s\\S]{0,48}\\b(?:hotel|unterkunft|übernacht|uebernacht|pool|stay)\\b|\\b(?:hotel|unterkunft|pool)\\b[\\s\\S]{0,48}\\b(?:nochmal|noch\\s*mal|erneut|suchen|raussuchen)\\b/iu;

/** Pitch-Follow-up: Ablehnung / mehr Optionen / Timing-Antwort nach Fork. */"""
    if needle not in t:
        raise SystemExit("hotel verify needle missing")
    t = t.replace(needle, insert, 1)

old = """  if (
    pending?.kind === 'hotel' &&
    (HOTEL_ORDINAL_FOLLOW_RE.test(t) || HOTEL_VERIFY_FOLLOW_RE.test(t))
  ) {
    return true;
  }"""
new = """  if (
    pending?.kind === 'hotel' &&
    (HOTEL_ORDINAL_FOLLOW_RE.test(t) ||
      HOTEL_VERIFY_FOLLOW_RE.test(t) ||
      HOTEL_RETRY_FOLLOW_RE.test(t))
  ) {
    return true;
  }"""
if old in t:
    t = t.replace(old, new, 1)

old2 = """  if (
    NEW_TOPIC_RE.test(t) &&
    !PRICE_FOLLOW_RE.test(t) &&
    !TIME_FOLLOW_RE.test(t) &&
    !EVENT_DEEPEN_FOLLOW_RE.test(t) &&
    !PITCH_FOLLOW_RE.test(t) &&
    !BARE_CLOCK_FOLLOW_RE.test(t)
  ) {
    return false;
  }
  return (
    PRICE_FOLLOW_RE.test(t) ||
    TIME_FOLLOW_RE.test(t) ||
    EVENT_DEEPEN_FOLLOW_RE.test(t) ||
    (Boolean(pending) && PITCH_FOLLOW_RE.test(t)) ||
    (Boolean(pending) && t.length <= 40 && BARE_CLOCK_FOLLOW_RE.test(t))
  );
}"""
new2 = """  if (
    NEW_TOPIC_RE.test(t) &&
    !PRICE_FOLLOW_RE.test(t) &&
    !TIME_FOLLOW_RE.test(t) &&
    !EVENT_DEEPEN_FOLLOW_RE.test(t) &&
    !PITCH_FOLLOW_RE.test(t) &&
    !BARE_CLOCK_FOLLOW_RE.test(t) &&
    !(pending?.kind === 'hotel' && HOTEL_RETRY_FOLLOW_RE.test(t))
  ) {
    return false;
  }
  return (
    PRICE_FOLLOW_RE.test(t) ||
    TIME_FOLLOW_RE.test(t) ||
    EVENT_DEEPEN_FOLLOW_RE.test(t) ||
    (Boolean(pending) && PITCH_FOLLOW_RE.test(t)) ||
    (pending?.kind === 'hotel' && HOTEL_RETRY_FOLLOW_RE.test(t)) ||
    (Boolean(pending) && t.length <= 40 && BARE_CLOCK_FOLLOW_RE.test(t))
  );
}"""
if old2 in t:
    t = t.replace(old2, new2, 1)
p.write_text(t, encoding="utf-8")
print("liveInventoryGate ok", "HOTEL_RETRY" in t)

# --- buildPitchRequest hotel sticky ---
p = Path(r"c:\Users\larsf\Findus 2.0\src\module2\pitch\buildPitchRequest.ts")
t = p.read_text(encoding="utf-8")
if "hotel sticky dest" not in t and "Hotel sticky" not in t:
    needle = "  let searchModeOut = effectiveSearchMode;\n  let cityHintOut: string | null = call1City || explicitCity || cityHint;"
    insert = """  let searchModeOut = effectiveSearchMode;
  let cityHintOut: string | null = call1City || explicitCity || cityHint;
  // Hotel-Follow-up ohne neue Stadt: Sticky-Ziel (Amsterdam) schlägt GPS-Heimat
  if (kind === 'hotel' && !explicitCity) {
    const sticky =
      call1City ||
      short.lastMentionedCity ||
      (cityHint && cityHint !== packCity ? cityHint : null);
    if (sticky) {
      cityHintOut = sticky;
      if (searchModeOut === 'here_now') searchModeOut = 'city_best';
    }
  }"""
    if needle not in t:
        raise SystemExit("buildPitchRequest needle missing")
    p.write_text(t.replace(needle, insert, 1), encoding="utf-8")
    print("buildPitchRequest ok")
else:
    print("buildPitchRequest already")

print("done")
