# -*- coding: utf-8 -*-
from pathlib import Path

path = Path(r"c:\Users\larsf\Findus 2.0\src\services\speech\floskelEngine.ts")
text = path.read_text(encoding="utf-8")

old = """export function pickFloskelForUserText(userText: string): {
  category: string;
  phrase: string;
} {
  const decision = analyzeSmartRoute(userText);
  let category = detectFloskelCategory(userText);

  if (decision.intentDensity >= 2 || decision.mode === 'deep') {
    // Multi-Intent / Deep → oft „komplexe Planung“ oder multi_intent
    if (
      decision.intentDensity >= 2 &&
      !['compound_togo_sunset', 'complex_plan', 'events'].includes(category)
    ) {
      category = decision.wordCount > 15 ? 'complex_plan' : 'multi_intent';
    }
  } else if (decision.intents.length === 1) {
    const mapped = INTENT_TO_CATEGORY[decision.intents[0]!];
    if (mapped && category === 'generic') category = mapped;
  }

  if (!lib.categories[category]) category = 'generic';
  return { category, phrase: pickFloskelPhrase(category) };
}"""

new = """/** Ort/Ziel aus dem User-Satz spiegeln — nie GPS-Heimat unterschieben. */
function softEchoPlaceFromUtterance(userText: string): string | null {
  const m = userText.match(
    /\\b(?:in|nach|zum|zur|am)\\s+([A-ZÄÖÜ][\\wäöüß\\-]{2,}(?:\\s+[A-ZÄÖÜ][\\wäöüß\\-]{2,}){0,3})/u,
  );
  if (!m?.[1]) return null;
  const place = m[1].replace(/\\s+/g, ' ').trim();
  if (place.length < 3 || place.length > 48) return null;
  if (/^(Heute|Morgen|Freitag|Samstag|Sonntag|Abend|Nähe)\\b/u.test(place)) return null;
  return place;
}

function maybeAnchorFloskelPhrase(
  phrase: string,
  userText: string,
  category: string,
): string {
  const place = softEchoPlaceFromUtterance(userText);
  if (!place) return phrase;
  if (category === 'accommodation_search' || category === 'hotel') {
    return `Ich such dir in ${place} passende Hotels mit deinen Prefs raus.`;
  }
  if (category === 'nav') {
    return `Alles klar — ich navigiere dich zu ${place}.`;
  }
  if (category === 'transit') {
    return `Ich check die schnellste Verbindung zu ${place}.`;
  }
  return phrase;
}

export function pickFloskelForUserText(userText: string): {
  category: string;
  phrase: string;
} {
  const decision = analyzeSmartRoute(userText);
  let category = detectFloskelCategory(userText);

  if (decision.intentDensity >= 2 || decision.mode === 'deep') {
    // Multi-Intent / Deep → oft „komplexe Planung“ oder multi_intent
    if (
      decision.intentDensity >= 2 &&
      !['compound_togo_sunset', 'complex_plan', 'events', 'cinema', 'dining', 'food_allergy', 'safety', 'accommodation_search'].includes(category)
    ) {
      category = decision.wordCount > 15 ? 'complex_plan' : 'multi_intent';
    }
  } else if (decision.intents.length === 1) {
    const mapped = INTENT_TO_CATEGORY[decision.intents[0]!];
    if (mapped && category === 'generic') category = mapped;
  }

  if (!lib.categories[category]) category = 'generic';
  let phrase = pickFloskelPhrase(category);
  phrase = maybeAnchorFloskelPhrase(phrase, userText, category);

  // Lange Recherche: Cover etwas länger (2 Sätze), Nav bleibt knapp
  const coverLong =
    expectsSlowResponse(userText, decision) &&
    [
      'accommodation_search',
      'hotel',
      'events',
      'cinema',
      'dining',
      'food_allergy',
      'complex_plan',
      'flight',
      'safety',
      'research_web',
      'multi_intent',
    ].includes(category);
  if (coverLong) {
    const second = pickFloskelPhrase(category);
    if (second && second !== phrase && !phrase.includes(second.slice(0, 18))) {
      phrase = `${phrase} ${second}`;
    }
  }
  return { category, phrase };
}"""

if old not in text:
    raise SystemExit("pickFloskelForUserText block not found")
path.write_text(text.replace(old, new, 1), encoding="utf-8")
print("pickFloskelForUserText patched")
