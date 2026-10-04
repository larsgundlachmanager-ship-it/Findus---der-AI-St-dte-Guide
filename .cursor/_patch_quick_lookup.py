from pathlib import Path

p = Path("src/services/concierge/celestialSkyQuery.ts")
t = p.read_text(encoding="utf-8")
needle = "was\\s+bedeutet|wer\\s+(?:ist|war|heißt|heisst)"
insert = "was\\s+bedeutet|was\\s+ist\\s+(?:die\\s+)?hauptstadt|hauptstadt\\s+(?:von|von\\s+der|von\\s+dem)|wer\\s+(?:ist|war|heißt|heisst)"
if needle not in t:
    raise SystemExit("needle missing")
if "hauptstadt" in t.split("QUICK_LOOKUP_RE", 1)[1][:400]:
    print("already patched")
else:
    t = t.replace(needle, insert, 1)
    t = t.replace(
        "Trivia-Maße/Identität/Bedeutung.",
        "Trivia-Maße/Identität/Bedeutung/Hauptstadt.",
        1,
    )
    p.write_text(t, encoding="utf-8")
    print("patched")
