# -*- coding: utf-8 -*-
from pathlib import Path
import os

def atomic_write(path: Path, content: str) -> None:
    tmp = path.with_suffix(path.suffix + ".tmpwrite")
    tmp.write_text(content, encoding="utf-8")
    os.replace(str(tmp), str(path))

# call1Dispatch
p = Path(r"c:\Users\larsf\Findus 2.0\src\module2\router\call1Dispatch.ts")
t = p.read_text(encoding="utf-8")
if "cinema_force" not in t:
    needle = "  // Reines Taxi-Hail — nur wenn Call-1 kein Backend gesetzt hat (sonst SSOT ehren)"
    insert = Path(r"c:\Users\larsf\Findus 2.0\.phone-check\cinema_force_snip.txt").read_text(
        encoding="utf-8"
    ).rstrip() + "\n\n"
    if needle not in t:
        raise SystemExit("dispatch needle missing")
    atomic_write(p, t.replace(needle, insert + needle, 1))
    print("call1Dispatch ok")
else:
    print("call1Dispatch already")

# liveInventoryGate
p = Path(r"c:\Users\larsf\Findus 2.0\src\module2\router\liveInventoryGate.ts")
t = p.read_text(encoding="utf-8")
changed = False
if "HOTEL_RETRY_FOLLOW_RE" not in t:
    needle = (
        "const HOTEL_VERIFY_FOLLOW_RE =\n"
        "  /\\b(?:wirklich|tatsächlich|tatsaechlich|hab(?:en|t)\\s+(?:die|der|das))\\b.*\\b(?:pool|sauna|hotel|zimmer)\\b|"
        "\\b(?:pool|sauna)\\b.*\\b(?:wirklich|tatsächlich|tatsaechlich)\\b/iu;\n\n"
        "/** Pitch-Follow-up: Ablehnung / mehr Optionen / Timing-Antwort nach Fork. */"
    )
    insert = (
        "const HOTEL_VERIFY_FOLLOW_RE =\n"
        "  /\\b(?:wirklich|tatsächlich|tatsaechlich|hab(?:en|t)\\s+(?:die|der|das))\\b.*\\b(?:pool|sauna|hotel|zimmer)\\b|"
        "\\b(?:pool|sauna)\\b.*\\b(?:wirklich|tatsächlich|tatsaechlich)\\b/iu;\n\n"
        "/** Hotel-Retry am offenen Auftrag — Stadt (Amsterdam) behalten, kein GPS-Heimat. */\n"
        "const HOTEL_RETRY_FOLLOW_RE =\n"
        "  /\\b(?:nochmal|noch\\s*mal|erneut|wieder|nochmals|konkret)\\b[\\s\\S]{0,48}\\b(?:hotel|unterkunft|übernacht|uebernacht|pool|stay)\\b|"
        "\\b(?:hotel|unterkunft|pool)\\b[\\s\\S]{0,48}\\b(?:nochmal|noch\\s*mal|erneut|suchen|raussuchen)\\b/iu;\n\n"
        "/** Pitch-Follow-up: Ablehnung / mehr Optionen / Timing-Antwort nach Fork. */"
    )
    if needle not in t:
        # softer find
        idx = t.find("const HOTEL_VERIFY_FOLLOW_RE")
        if idx < 0:
            raise SystemExit("HOTEL_VERIFY missing")
        # find next Pitch-Follow-up comment
        j = t.find("/** Pitch-Follow-up:", idx)
        if j < 0:
            raise SystemExit("Pitch-Follow-up comment missing")
        block = t[idx:j]
        retry = (
            "const HOTEL_VERIFY_FOLLOW_RE =\n"
            + block.split("\n", 1)[1].split(";\n", 1)[0]
            + ";\n\n"
            "/** Hotel-Retry am offenen Auftrag — Stadt (Amsterdam) behalten, kein GPS-Heimat. */\n"
            "const HOTEL_RETRY_FOLLOW_RE =\n"
            "  /\\b(?:nochmal|noch\\s*mal|erneut|wieder|nochmals|konkret)\\b[\\s\\S]{0,48}\\b(?:hotel|unterkunft|übernacht|uebernacht|pool|stay)\\b|"
            "\\b(?:hotel|unterkunft|pool)\\b[\\s\\S]{0,48}\\b(?:nochmal|noch\\s*mal|erneut|suchen|raussuchen)\\b/iu;\n\n"
        )
        t = t[:idx] + retry + t[j:]
    else:
        t = t.replace(needle, insert, 1)
    changed = True

old = (
    "  if (\n"
    "    pending?.kind === 'hotel' &&\n"
    "    (HOTEL_ORDINAL_FOLLOW_RE.test(t) || HOTEL_VERIFY_FOLLOW_RE.test(t))\n"
    "  ) {\n"
    "    return true;\n"
    "  }"
)
new = (
    "  if (\n"
    "    pending?.kind === 'hotel' &&\n"
    "    (HOTEL_ORDINAL_FOLLOW_RE.test(t) ||\n"
    "      HOTEL_VERIFY_FOLLOW_RE.test(t) ||\n"
    "      HOTEL_RETRY_FOLLOW_RE.test(t))\n"
    "  ) {\n"
    "    return true;\n"
    "  }"
)
if old in t:
    t = t.replace(old, new, 1)
    changed = True

old2 = (
    "  if (\n"
    "    NEW_TOPIC_RE.test(t) &&\n"
    "    !PRICE_FOLLOW_RE.test(t) &&\n"
    "    !TIME_FOLLOW_RE.test(t) &&\n"
    "    !EVENT_DEEPEN_FOLLOW_RE.test(t) &&\n"
    "    !PITCH_FOLLOW_RE.test(t) &&\n"
    "    !BARE_CLOCK_FOLLOW_RE.test(t)\n"
    "  ) {\n"
    "    return false;\n"
    "  }\n"
    "  return (\n"
    "    PRICE_FOLLOW_RE.test(t) ||\n"
    "    TIME_FOLLOW_RE.test(t) ||\n"
    "    EVENT_DEEPEN_FOLLOW_RE.test(t) ||\n"
    "    (Boolean(pending) && PITCH_FOLLOW_RE.test(t)) ||\n"
    "    (Boolean(pending) && t.length <= 40 && BARE_CLOCK_FOLLOW_RE.test(t))\n"
    "  );\n"
    "}"
)
new2 = (
    "  if (\n"
    "    NEW_TOPIC_RE.test(t) &&\n"
    "    !PRICE_FOLLOW_RE.test(t) &&\n"
    "    !TIME_FOLLOW_RE.test(t) &&\n"
    "    !EVENT_DEEPEN_FOLLOW_RE.test(t) &&\n"
    "    !PITCH_FOLLOW_RE.test(t) &&\n"
    "    !BARE_CLOCK_FOLLOW_RE.test(t) &&\n"
    "    !(pending?.kind === 'hotel' && HOTEL_RETRY_FOLLOW_RE.test(t))\n"
    "  ) {\n"
    "    return false;\n"
    "  }\n"
    "  return (\n"
    "    PRICE_FOLLOW_RE.test(t) ||\n"
    "    TIME_FOLLOW_RE.test(t) ||\n"
    "    EVENT_DEEPEN_FOLLOW_RE.test(t) ||\n"
    "    (Boolean(pending) && PITCH_FOLLOW_RE.test(t)) ||\n"
    "    (pending?.kind === 'hotel' && HOTEL_RETRY_FOLLOW_RE.test(t)) ||\n"
    "    (Boolean(pending) && t.length <= 40 && BARE_CLOCK_FOLLOW_RE.test(t))\n"
    "  );\n"
    "}"
)
if old2 in t:
    t = t.replace(old2, new2, 1)
    changed = True

if changed:
    atomic_write(p, t)
    print("liveInventoryGate ok")
else:
    print("liveInventoryGate unchanged?", "HOTEL_RETRY_FOLLOW_RE" in open(p, encoding="utf-8").read())

# buildPitchRequest
p = Path(r"c:\Users\larsf\Findus 2.0\src\module2\pitch\buildPitchRequest.ts")
t = p.read_text(encoding="utf-8")
if "Hotel-Follow-up ohne neue Stadt" not in t:
    needle = (
        "  let searchModeOut = effectiveSearchMode;\n"
        "  let cityHintOut: string | null = call1City || explicitCity || cityHint;"
    )
    insert = (
        "  let searchModeOut = effectiveSearchMode;\n"
        "  let cityHintOut: string | null = call1City || explicitCity || cityHint;\n"
        "  // Hotel-Follow-up ohne neue Stadt: Sticky-Ziel (Amsterdam) schlägt GPS-Heimat\n"
        "  if (kind === 'hotel' && !explicitCity) {\n"
        "    const sticky =\n"
        "      call1City ||\n"
        "      short.lastMentionedCity ||\n"
        "      (cityHint && cityHint !== packCity ? cityHint : null);\n"
        "    if (sticky) {\n"
        "      cityHintOut = sticky;\n"
        "      if (searchModeOut === 'here_now') searchModeOut = 'city_best';\n"
        "    }\n"
        "  }"
    )
    if needle not in t:
        raise SystemExit("buildPitchRequest needle missing")
    atomic_write(p, t.replace(needle, insert, 1))
    print("buildPitchRequest ok")
else:
    print("buildPitchRequest already")

print("ALL DONE")
