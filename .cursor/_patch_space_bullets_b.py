from pathlib import Path

# --- presentChatLane enrich ---
p = Path("src/module2/chat/presentChatLane.ts")
t = p.read_text(encoding="utf-8")
old = """  try {
    const { stripPermissionLookupAsks } = require('../../services/concierge/justDoItPolicy') as {
      stripPermissionLookupAsks: (s: string) => string;
    };
    speech = stripPermissionLookupAsks(speech);
  } catch {
    /* soft */
  }
  try {
    const { looksLikeOutfitOrWeatherUtterance } = require('../planning/planUtteranceGate') as {"""
new = """  try {
    const { stripPermissionLookupAsks } = require('../../services/concierge/justDoItPolicy') as {
      stripPermissionLookupAsks: (s: string) => string;
    };
    speech = stripPermissionLookupAsks(speech);
  } catch {
    /* soft */
  }
  try {
    const { ensureLetterDigitSpaces, normalizeTriviaFactBullets } = require('./instantFactFormat') as {
      ensureLetterDigitSpaces: (s: string) => string;
      normalizeTriviaFactBullets: (o: {
        userText?: string | null;
        speech?: string | null;
        bullets?: string[] | null;
      }) => string[];
    };
    speech = ensureLetterDigitSpaces(speech);
    bullets = normalizeTriviaFactBullets({
      userText,
      speech,
      bullets,
    });
  } catch {
    /* soft */
  }
  try {
    const { looksLikeOutfitOrWeatherUtterance } = require('../planning/planUtteranceGate') as {"""
if old not in t:
    raise SystemExit("present enrich missing")
tmp = Path("src/module2/chat/_present.tmp.ts")
tmp.write_text(t.replace(old, new, 1), encoding="utf-8")
p.unlink(missing_ok=True)
tmp.rename(p)
print("present ok")

# --- spickzettel Rechenaufgabe ---
p = Path("src/services/concierge/spickzettelTitle.ts")
t = p.read_text(encoding="utf-8")
marker = "  // Trivia/Wer-ist/Wie-heißt — nur ohne Wetter-Signal"
extra = """  // Kopfrechnung — nicht Bullet als Titel
  if (\\b\\d+\\s*(?:\\+|plus|minus|-|\\*|mal|x|/|:|geteilt)\\s*\\d+\\b/iu.test(u) || /\\bquadratwurzel\\b/iu.test(u)) {
    return 'Rechenaufgabe';
  }

"""
# fix - need proper JS in the file
extra = """  // Kopfrechnung — nicht Bullet als Titel
  if (/\\b\\d+\\s*(?:\\+|plus|minus|-|\\*|mal|x|\\/|:|geteilt)\\s*\\d+\\b/iu.test(u) || /\\bquadratwurzel\\b/iu.test(u)) {
    return 'Rechenaufgabe';
  }

"""
if "Rechenaufgabe" not in t:
    if marker not in t:
        raise SystemExit("spick marker missing")
    t = t.replace(marker, extra + marker, 1)
    tmp = Path("src/services/concierge/_spick.tmp.ts")
    tmp.write_text(t, encoding="utf-8")
    p.unlink(missing_ok=True)
    tmp.rename(p)
print("spick ok", "Rechenaufgabe" in p.read_text(encoding="utf-8"))

# --- handoffs: no pack-clarify for activity / how-to ---
p = Path("src/module2/router/handoffs.ts")
t = p.read_text(encoding="utf-8")
old = """    if (!hit) {
      return {
        speech:
          'Von hier erkenne ich den Ort im Datensatz noch nicht sicher. Zeig etwas deutlicher hin oder beschreib kurz — dann hol ich mehr dazu.',
        poiId: null,
        placeName: null,
        askMore: false,
      };
    }"""
new = """    if (!hit) {
      const ask = (opts.userText || '').replace(/\\s+/g, ' ').trim();
      // Aktivität / Darf-man / Wo-kann-man → Web-Recherche, kein Pack-Klär-Stopp
      if (
        /\\b(darf|kann|wo\\s+kann|verleih|ausleihen|stand.?up|sup|paddle|surf|boot|rudern|segeln)\\b/iu.test(
          ask,
        )
      ) {
        return {
          speech: '',
          poiId: null,
          placeName: null,
          askMore: false,
        };
      }
      return {
        speech:
          'Von hier erkenne ich den Ort im Datensatz noch nicht sicher. Zeig etwas deutlicher hin oder beschreib kurz — dann hol ich mehr dazu.',
        poiId: null,
        placeName: null,
        askMore: false,
      };
    }"""
if old not in t:
    raise SystemExit("handoff clarify missing")
tmp = Path("src/module2/router/_hand.tmp.ts")
tmp.write_text(t.replace(old, new, 1), encoding="utf-8")
p.unlink(missing_ok=True)
tmp.rename(p)
print("handoff ok")

# --- runChatLane: area speech not bullet dump; age bullets hint ---
p = Path("src/module2/chat/runChatLane.ts")
t = p.read_text(encoding="utf-8")
old = """      /\\d+\\s*(?:\\+|plus|minus|-)\\s*\\d+/iu.test(userText)
        ? 'Rechenfrage: nur die Ergebniszahl, kein Theater.'
        : /\\bwie\\s+alt\\s+ist\\b/iu.test(userText)
          ? 'Alter-Frage: nach Bridge-Lead NUR „N Jahre alt.“ — kein Geburtsdatum, keine Vereins-/Karriere-Bio, außer User fragt danach.'
          : '',"""
new = """      /\\d+\\s*(?:\\+|plus|minus|-)\\s*\\d+/iu.test(userText)
        ? 'Rechenfrage: nur die Ergebniszahl, kein Theater.'
        : /\\bwie\\s+alt\\s+ist\\b/iu.test(userText)
          ? 'Alter-Frage: Speech nur „N Jahre alt.“ Bullets separat: 1) Alter: N Jahre 2) Geboren: Datum — Speech liest Bullets nicht vor.'
          : /\\b(hektar|quadrat|fläche|flaeche|wie\\s+(?:groß|gross))\\b/iu.test(userText)
            ? 'Flächen-Frage: Speech = nur die gefragte Zahl/Ort in 1 Satz. Extra-Vergleiche nur in Bullets, nicht vorlesen.'
            : '',"""
if old not in t:
    # try find age tip
    if "Alter-Frage: nach Bridge-Lead" not in t:
        raise SystemExit("chatlane tip missing")
    t = t.replace(
        "'Alter-Frage: nach Bridge-Lead NUR „N Jahre alt.“ — kein Geburtsdatum, keine Vereins-/Karriere-Bio, außer User fragt danach.'",
        "'Alter-Frage: Speech nur „N Jahre alt.“ Bullets separat: 1) Alter: N Jahre 2) Geboren: Datum — Speech liest Bullets nicht vor.'",
    )
else:
    t = t.replace(old, new, 1)
tmp = Path("src/module2/chat/_lane2.tmp.ts")
tmp.write_text(t, encoding="utf-8")
p.unlink(missing_ok=True)
tmp.rename(p)
print("chatlane tips ok")

# Remove unused generateContextualBridge from beat1 destructure if still imported unused
p = Path("src/module2/router/runConciergeTurn.ts")
t = p.read_text(encoding="utf-8")
t2 = t.replace(
    """        const {
          peekAnswerLeadBridge,
          peekAnswerLeadBridgeOrCommit,
          generateContextualBridge,
        } = require('../../services/speech/contextualBridge') as {
          peekAnswerLeadBridge: (s: string) => string | null;
          peekAnswerLeadBridgeOrCommit: (s: string) => string;
          generateContextualBridge: (o: {
            userText: string;
          }) => Promise<string | null>;
        };""",
    """        const {
          peekAnswerLeadBridge,
          peekAnswerLeadBridgeOrCommit,
        } = require('../../services/speech/contextualBridge') as {
          peekAnswerLeadBridge: (s: string) => string | null;
          peekAnswerLeadBridgeOrCommit: (s: string) => string;
        };""",
    1,
)
tmp = Path("src/module2/router/_turn_clean.tmp.ts")
tmp.write_text(t2, encoding="utf-8")
p.unlink(missing_ok=True)
tmp.rename(p)
print("turn clean ok")
