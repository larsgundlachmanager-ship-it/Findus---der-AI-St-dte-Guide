# -*- coding: utf-8 -*-
from pathlib import Path

p = Path(r"src/services/memory/correctionLearning.ts")
t = p.read_text(encoding="utf-8")

old_hint = (
    "const CORRECTION_HINT =\n"
    "  /\\b(?:nee+|nö+|noe+|nein|falsch|stimmt\\s+nicht|ich\\s+meinte|ich\\s+wollte|nicht\\s+das|doch\\s+nicht|eher\\s+so|nächstes?\\s+mal|stattdessen|besser|ohne\\s+(?:die\\s+)?historie|ohne\\s+geschichte|kürzer|konkreter|direkt|preise?|buchung|link|website|öffnungszeit|ticket)\\b/iu;"
)
new_hint = (
    "const CORRECTION_HINT =\n"
    "  /\\b(?:nee+|nö+|noe+|nein|falsch|stimmt\\s+nicht|ich\\s+meinte|ich\\s+wollte|nicht\\s+das|doch\\s+nicht|eher\\s+so|nächstes?\\s+mal|stattdessen|besser|ohne\\s+(?:die\\s+)?historie|ohne\\s+geschichte|kürzer|konkreter|direkt|preise?|buchung|link|website|öffnungszeit|ticket|lockerer|umgangssprachlich|zu\\s+steif|weniger\\s+also|zu\\s+lang|knapp|menschlicher|flüssiger)\\b/iu;"
)
if old_hint not in t:
    raise SystemExit("hint not found")
t = t.replace(old_hint, new_hint)
print("hint ok")

marker = "export function looksLikeAnswerCorrection(text: string): boolean {"
if "looksLikeSpeechStyleCorrection" in t:
    print("style helper already present")
else:
    idx = t.find(marker)
    if idx < 0:
        raise SystemExit("looksLikeAnswerCorrection not found")
    # find end of function (next export function after this one)
    end = t.find("\n/** Heuristik: Intent-Family", idx)
    if end < 0:
        end = t.find("\nexport function inferIntentFamily", idx)
    if end < 0:
        raise SystemExit("end of looksLike not found")
    new_block = r'''/** Style-only: kürzer / lockerer / weniger Also — Struktur, kein Script. */
export function looksLikeSpeechStyleCorrection(text: string): boolean {
  const t = (text || '').replace(/\s+/g, ' ').trim();
  if (t.length < 5) return false;
  return (
    /\b(?:kürzer|knapp(?:er)?|zu\s+lang|weniger\s+(?:reden|text|worte)|mach(?:e)?\s+(?:es\s+)?kürzer)\b/iu.test(
      t,
    ) ||
    /\b(?:lockerer|umgangssprachlich(?:er)?|menschlicher|flüssiger|zu\s+steif|zu\s+förmlich|weniger\s+steif)\b/iu.test(
      t,
    ) ||
    /\b(?:weniger\s+also|ohne\s+also|kein\s+also|weniger\s+(?:opener|vorgeplänkel|vorgeplaenkel))\b/iu.test(
      t,
    ) ||
    /\b(?:als\s+(?:ganzen?\s+)?(?:lockeren?\s+)?satz|keine\s+(?:stichpunkte|liste|telegramm))\b/iu.test(
      t,
    )
  );
}

export function looksLikeAnswerCorrection(text: string): boolean {
  const t = text.replace(/\s+/g, ' ').trim();
  if (t.length < 5) return false;
  // Blankes Nein / Stop — kein Lern-Signal
  if (/^(nee+|nö+|noe+|nein|falsch|doch\s+nicht)[.!?]*$/iu.test(t)) {
    return false;
  }
  // Reine Style-Hints nach Antwort (auch ohne „nee“)
  if (looksLikeSpeechStyleCorrection(t)) {
    const { lastAssistant } = getRecentTurnPair();
    if (lastAssistant) return true;
  }
  if (!CORRECTION_HINT.test(t)) return false;
  // Reine Prefs („nenn mich nicht Bro“) sind keine Antwort-Korrektur
  if (
    /\bnenn\s+mich\b/iu.test(t) &&
    !/\b(?:antwort|gesagt|erzähl|historie|geschichte|preis|buchung)\b/iu.test(t)
  ) {
    return false;
  }
  const { lastAssistant } = getRecentTurnPair();
  // Ohne vorherige Antwort nur bei starken Korrektur-Markern
  if (!lastAssistant) {
    return /\b(?:nächstes?\s+mal|ich\s+meinte|falsch|stimmt\s+nicht)\b/iu.test(
      t,
    );
  }
  // Braucht Substanz über das reine Nein hinaus
  const stripped = t
    .replace(/^(nee+|nö+|noe+|nein|falsch)[,.\s]*/iu, '')
    .trim();
  if (stripped.length < 5) return false;
  return true;
}

'''
    t = t[:idx] + new_block + t[end:]
    print("looks ok")

needle = "  if (/\\b(?:route|weg\\s+ dahin|bring\\s+mich)\\b/iu.test(t)) {\n    expect.push('route_button');\n  }\n\n  // Default soft: Korrektur ohne Stichworte → Antwort-first + konkret\n  if (!expect.length && !avoid.length) {\n    expect.push('answer_first', 'concrete_place');\n    avoid.push('vague_filler');\n  }"

if "brief_speech', 'answer_first', 'complete_sentences'" in t or "brief_speech', 'answer_first'" in t:
    print("extract style already")
elif needle not in t:
    raise SystemExit("default extract needle not found")
else:
    repl = r'''  if (/\b(?:route|weg\s+ dahin|bring\s+mich)\b/iu.test(t)) {
    expect.push('route_button');
  }

  // Speech-Style: kürzer / lockerer / weniger Also — vor Default
  let styleHit = false;
  if (
    /\b(?:kürzer|knapp(?:er)?|zu\s+lang|weniger\s+(?:reden|text|worte)|mach(?:e)?\s+(?:es\s+)?kürzer)\b/iu.test(
      t,
    )
  ) {
    expect.push('brief_speech', 'answer_first', 'complete_sentences');
    avoid.push('essay', 'vague_filler', 'dry_list');
    tags.push('brief_speech');
    styleHit = true;
  }
  if (
    /\b(?:lockerer|umgangssprachlich(?:er)?|menschlicher|flüssiger|zu\s+steif|zu\s+förmlich|weniger\s+steif)\b/iu.test(
      t,
    )
  ) {
    expect.push('casual_tone', 'complete_sentences');
    avoid.push('dry_list', 'vague_filler');
    tags.push('casual_tone');
    styleHit = true;
  }
  if (
    /\b(?:weniger\s+also|ohne\s+also|kein\s+also|weniger\s+(?:opener|vorgeplänkel|vorgeplaenkel)|kein\s+(?:app[- ]?)?opener)\b/iu.test(
      t,
    )
  ) {
    avoid.push('boilerplate_opener', 'vague_filler');
    expect.push('answer_first', 'casual_tone');
    tags.push('no_boilerplate');
    styleHit = true;
  }
  if (
    /\b(?:als\s+(?:ganzen?\s+)?(?:lockeren?\s+)?satz|keine\s+(?:stichpunkte|liste)|kein\s+telegramm)\b/iu.test(
      t,
    )
  ) {
    expect.push('complete_sentences', 'casual_tone');
    avoid.push('dry_list');
    tags.push('complete_sentences');
    styleHit = true;
  }

  // Default soft: Korrektur ohne Stichworte → Antwort-first + konkret
  // (Style-Hits überspringen — sonst concrete_place bei „kürzer“)
  if (!expect.length && !avoid.length && !styleHit) {
    expect.push('answer_first', 'concrete_place');
    avoid.push('vague_filler');
  }'''
    t = t.replace(needle, repl)
    print("extract ok")

old_llm_a = '"expect":["prices|duration|booking_url|website|life_now|short_history|answer_first|concrete_place|route_button|alternatives|times_hours|menu|tickets"]'
new_llm_a = '"expect":["prices|duration|booking_url|website|life_now|short_history|answer_first|concrete_place|route_button|alternatives|times_hours|menu|tickets|casual_tone|brief_speech|complete_sentences"]'
old_llm_b = '"avoid":["long_history|address_unless_asked|gps_coords|fake_promises|permission_questions|meta_app_pitch|vague_filler|nav_auto_start"]'
new_llm_b = '"avoid":["long_history|address_unless_asked|gps_coords|fake_promises|permission_questions|meta_app_pitch|vague_filler|nav_auto_start|dry_list|boilerplate_opener|essay"]'
if old_llm_a in t:
    t = t.replace(old_llm_a, new_llm_a)
    print("llm expect ok")
else:
    print("llm expect skip")
if old_llm_b in t:
    t = t.replace(old_llm_b, new_llm_b)
    print("llm avoid ok")
else:
    print("llm avoid skip")

style_line = "Style-Korrekturen: kürzer→brief_speech+complete_sentences/−essay; lockerer→casual_tone; weniger Also→−boilerplate_opener."
if style_line not in t:
    anchor = "'Regeln: Nur Constraints/Struktur, nie Dialog-Skript. Nichts erfinden. Max 6 expect, 4 avoid.',"
    if anchor in t:
        t = t.replace(
            anchor,
            anchor + "\n    '" + style_line + "',",
            1,
        )
        print("style llm line ok")
    else:
        print("style llm line skip")

out = Path(r".cursor/_corr_out.ts")
out.write_text(t, encoding="utf-8")
print("temp wrote", out)
import shutil
import time

time.sleep(0.2)
try:
    shutil.copyfile(out, p)
    print("copied to", p)
except OSError as e:
    print("copy failed", e)
    # retry once
    time.sleep(0.5)
    shutil.copyfile(out, p)
    print("copied retry", p)
