from pathlib import Path
p = Path("src/services/ui/weatherDayPlanSpeech.ts")
t = p.read_text(encoding="utf-8")
start = t.find("/**\n * Voller Wetterbericht für Voice")
end = t.find("/**\n * Wetter-Antwort: Speech = flüssig")
if start < 0 or end < 0:
    raise SystemExit(f"bounds {start} {end}")
new = Path(".cursor/_wx_voice_fn.ts").read_text(encoding="utf-8")
p.write_text(t[:start] + new + t[end:], encoding="utf-8")
print("ok", end - start, "->", len(new))
