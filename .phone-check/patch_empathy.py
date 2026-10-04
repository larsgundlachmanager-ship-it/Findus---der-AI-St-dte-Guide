# -*- coding: utf-8 -*-
from pathlib import Path

p = Path(r"c:\Users\larsf\Findus 2.0\src\services\speech\floskelEngine.ts")
t = p.read_text(encoding="utf-8")
old = """function maybeAnchorFloskelPhrase(
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
}"""

new = """function maybeAnchorFloskelPhrase(
  phrase: string,
  userText: string,
  category: string,
): string {
  if (
    category === 'safety' &&
    /\\b(gebrochen|zahnschmerzen?|unfall|notfall|rettung)\\b/iu.test(userText) &&
    !/\\b(übel|oh\\s+nee|schlimm|priorisier)\\b/iu.test(phrase)
  ) {
    phrase = `Oh nee, das klingt übel. ${phrase}`;
  }
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
}"""

if old not in t:
    raise SystemExit("maybeAnchor block not found")
p.write_text(t.replace(old, new, 1), encoding="utf-8")
print("empathy prefix ok")
