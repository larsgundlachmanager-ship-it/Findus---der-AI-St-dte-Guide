from pathlib import Path

p = Path(r"c:\Users\larsf\Findus 2.0\src\module2\reboot\pipeline\call2Tail.ts")
t = p.read_text(encoding="utf-8")
old = """  return [
    'Erzeuge NUR JSON (Call-2 Tail) nach dem gesprochenen Text.',
    'Felder: bullets[] (1–3 FACT-CHIPS, je max bulletMaxChars / ~2 UI-Zeilen, nur Fakten aus Speech — keine Prosa-Sätze, nie mit … abschneiden, Titel nicht wiederholen),',
    'optional memory_extract[], shortAnswers[] (Tap-Chips, echte Gabeln),',
    'optional followUp {needed,reason,delegateTo,promptSeed}, uiHints, background_tasks.',
    `bulletMaxChars=${opts.bulletMaxChars}`,
    `USER: ${opts.userText.slice(0, 400)}`,
    `SPEECH:\\n${opts.speechText.slice(0, 2400)}`,
    opts.agentBullets?.length
      ? `AGENT_BULLETS_FALLBACK: ${JSON.stringify(opts.agentBullets.slice(0, 3))}`
      : '',
  ]
    .filter(Boolean)
    .join('\\n');
}"""
new = """  return [
    'Erzeuge NUR JSON (Call-2 Tail) nach dem gesprochenen Text.',
    'Felder: bullets[] = FACT-CHIPS (Spickzettel fürs UI, parallel zur Speech — NIEMALS Speech paraphrasieren/zusammenfassen). 1–3 Chips, je max bulletMaxChars / ~2 UI-Zeilen, Telegramm ok, keine Prosa-Sätze, nie mit … abschneiden, Titel/Bridge nicht wiederholen.',
    'optional memory_extract[], shortAnswers[] (Tap-Chips, echte Gabeln),',
    'optional followUp {needed,reason,delegateTo,promptSeed}, uiHints, background_tasks.',
    `bulletMaxChars=${opts.bulletMaxChars}`,
    `USER: ${opts.userText.slice(0, 400)}`,
    `SPEECH (nur Evidence-Quelle, nicht als Bullet-Vorlage):\\n${opts.speechText.slice(0, 2400)}`,
    opts.agentBullets?.length
      ? `AGENT_BULLETS_FALLBACK: ${JSON.stringify(opts.agentBullets.slice(0, 3))}`
      : '',
  ]
    .filter(Boolean)
    .join('\\n');
}"""
# Fix: file uses real newlines in template - read actual and replace simpler
needle = "Felder: bullets[] (1–3 FACT-CHIPS, je max bulletMaxChars / ~2 UI-Zeilen, nur Fakten aus Speech — keine Prosa-Sätze, nie mit … abschneiden, Titel nicht wiederholen),"
repl = "Felder: bullets[] = FACT-CHIPS (Spickzettel fürs UI, parallel zur Speech — NIEMALS Speech paraphrasieren/zusammenfassen). 1–3 Chips, je max bulletMaxChars / ~2 UI-Zeilen, Telegramm ok, keine Prosa-Sätze, nie mit … abschneiden, Titel/Bridge nicht wiederholen,"
if needle not in t:
    raise SystemExit('needle1 missing')
t = t.replace(needle, repl, 1)
needle2 = "`SPEECH:\\n${opts.speechText.slice(0, 2400)}`"
# In file it's backtick SPEECH:\n
needle2 = "    `SPEECH:\\n${opts.speechText.slice(0, 2400)}`,"
# actual file content:
import re
m = re.search(r"`SPEECH:\\n\$\{opts\.speechText\.slice\(0, 2400\)\}`,", t)
# try without escaped
if "`SPEECH:\n${opts.speechText.slice(0, 2400)}`," in t:
    t = t.replace(
        "`SPEECH:\n${opts.speechText.slice(0, 2400)}`,",
        "`SPEECH (nur Evidence-Quelle, nicht als Bullet-Vorlage):\n${opts.speechText.slice(0, 2400)}`,",
        1,
    )
else:
    raise SystemExit('speech line missing')
tmp = p.with_suffix('.ts.new')
tmp.write_text(t, encoding='utf-8')
tmp.replace(p)
print('call2Tail ok')
