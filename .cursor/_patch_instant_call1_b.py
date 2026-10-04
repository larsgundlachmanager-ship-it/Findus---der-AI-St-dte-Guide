from pathlib import Path
import re

# --- mic silence ---
p = Path("src/hooks/useVoiceInput.ts")
t = p.read_text(encoding="utf-8")
if "Hab dich nicht verstanden" in t:
    t2, n = re.subn(
        r"setIsGenerating\(false\);\s*try \{[\s\S]*?Hab dich nicht verstanden[\s\S]*?return;",
        "setIsGenerating(false);\n          // Leeres Mic: still — kein „Hab dich nicht verstanden“-Spam\n          return;",
        t,
        count=1,
    )
    if n != 1:
        raise SystemExit(f"mic re failed {n}")
    tmp = Path("src/hooks/_voice.tmp.ts")
    tmp.write_text(t2, encoding="utf-8")
    p.unlink(missing_ok=True)
    tmp.rename(p)
print("mic", "Hab dich nicht verstanden" not in p.read_text(encoding="utf-8"))

# --- ChatLane age/math prompt ---
p = Path("src/module2/chat/runChatLane.ts")
t = p.read_text(encoding="utf-8")
old = """      /\\d+\\s*(?:\\+|plus|minus|-)\\s*\\d+/iu.test(userText)
        ? 'Rechenfrage: nur die Ergebniszahl, kein Theater.'
        : '',"""
new = """      /\\d+\\s*(?:\\+|plus|minus|-)\\s*\\d+/iu.test(userText)
        ? 'Rechenfrage: nur die Ergebniszahl, kein Theater.'
        : /\\bwie\\s+alt\\s+ist\\b/iu.test(userText)
          ? 'Alter-Frage: nach Bridge-Lead NUR „N Jahre alt.“ — kein Geburtsdatum, keine Vereins-/Karriere-Bio, außer User fragt danach.'
          : '',"""
if old not in t:
    raise SystemExit("chatlane arith tip missing")
tmp = Path("src/module2/chat/_lane.tmp.ts")
tmp.write_text(t.replace(old, new, 1), encoding="utf-8")
p.unlink(missing_ok=True)
tmp.rename(p)
print("chatlane age tip ok")

# strengthen fastPrompt trivia line
t = p.read_text(encoding="utf-8")
old2 = "'Trivia/Fakten: ZUERST die direkte Zahl/Name (Alter/Name beantworten) in 1–2 flüssigen Sätzen im Persönlichkeits-Ton — DANACH optional 1 belegter Fun-Fact. Amtstitel (Papst, Königin …) und „wie heißt …?“ selbst auflösen, nie „wen meinst du?“. KEINE Regie/Stimm-Anweisungen im Text; Bridge nicht wiederholen. Stichpunkte: 3 kurze vollständige Fakten (Name/Zahl zuerst), kein abgeschnittener Krümel.',"
new2 = "'Trivia/Fakten: Bridge hat die Antwort schon eingeleitet — Call-2 hängt NUR den Kern an (Alter = „N Jahre alt.“; Rechnung = nur Zahl). Kein Meta, keine spannende Frage, keine Bio/Geburtsdatum außer gefragt. Amtstitel selbst auflösen. Bridge nicht wiederholen. Stichpunkte: 1–3 klare Fakten (Zahl zuerst).',"
if old2 not in t:
    # softer match
    if "Trivia/Fakten: ZUERST" not in t:
        raise SystemExit("trivia prompt missing")
    t = t.replace(
        "Trivia/Fakten: ZUERST die direkte Zahl/Name (Alter/Name beantworten) in 1–2 flüssigen Sätzen im Persönlichkeits-Ton — DANACH optional 1 belegter Fun-Fact. Amtstitel (Papst, Königin …) und „wie heißt …?“ selbst auflösen, nie „wen meinst du?“. KEINE Regie/Stimm-Anweisungen im Text; Bridge nicht wiederholen. Stichpunkte: 3 kurze vollständige Fakten (Name/Zahl zuerst), kein abgeschnittener Krümel.",
        "Trivia/Fakten: Bridge hat die Antwort schon eingeleitet — Call-2 hängt NUR den Kern an (Alter = „N Jahre alt.“; Rechnung = nur Zahl). Kein Meta, keine spannende Frage, keine Bio/Geburtsdatum außer gefragt. Amtstitel selbst auflösen. Bridge nicht wiederholen. Stichpunkte: 1–3 klare Fakten (Zahl zuerst).",
        1,
    )
else:
    t = t.replace(old2, new2, 1)
tmp.write_text(t, encoding="utf-8")
p.unlink(missing_ok=True)
tmp.rename(p)
print("trivia prompt ok")

# --- owner gold ---
p = Path("src/module2/blueprints/ownerGold.pack.json")
t = p.read_text(encoding="utf-8")
t = t.replace(
    '"summary": "Einfache Rechnung: Call-1 startet die Aufgabe knapp — keine Essay-Stichpunkte. Call-2 = nur die Ergebniszahl in einem knappen Satz. Stichpunkt optional = Rechnung + Ergebnis. Kein Theater."',
    '"summary": "Einfache Rechnung: Call-1 startet sofort mit dem Antwort-Einstieg (z. B. Aufgabe + ergibt) — nie spannende Frage, nie Recherche-Theater. Call-2 = nur die Ergebniszahl. Stichpunkt optional = Rechnung + Ergebnis."',
)
t = t.replace(
    '"summary": "Personen-Alter: Call-1 = eine knappe Zusage zur Person/Frage — NIE Zahl, NIE Todesdatum, nie wen-meinst-du, nie Essay. Call-2 = Alter zuerst in 1–2 Saetzen (nur belegt). Stichpunkte kurz aus Call-2. Kein Pitch."',
    '"summary": "Personen-Alter: Call-1 startet die Antwort (Person ist …) — nie spannende Frage, nie Recherche-Theater, NIE Zahl/Todesdatum in Call-1. Call-2 = nur Alter (N Jahre alt), keine Bio/Geburtsdatum außer gefragt. Stichpunkte kurz. Kein Pitch."',
)
tmp = Path("src/module2/blueprints/_gold.tmp.json")
tmp.write_text(t, encoding="utf-8")
p.unlink(missing_ok=True)
tmp.rename(p)
print("gold ok")
