from pathlib import Path
p = Path("src/services/speech/answerLeadBridge.smoke.test.ts")
t = p.read_text(encoding="utf-8")
old = "assert.match(turn, /setTimeout\\(\\(\\) => resolve\\(null\\), 400\\)/, 'LLM max 400ms');"
new = "assert.match(turn, /Sofort Commit/, 'Beat-1 no LLM wait');"
if old not in t:
    if "Sofort Commit" in t and "LLM max 400ms" not in t:
        print("already ok")
    else:
        raise SystemExit("pattern missing")
else:
    t = t.replace(old, new, 1)
    tmp = Path("src/services/speech/_als2.tmp.ts")
    tmp.write_text(t, encoding="utf-8")
    p.unlink(missing_ok=True)
    tmp.rename(p)
    print("smoke assert ok")
