/**
 * Query Rewriter — konservativ. Kein blindes Ersetzen von „das“ (zerstört Sätze).
 */

export type RewriteContext = {
  lastPlaceName?: string | null;
  lastTopic?: string | null;
  recentUserLines?: string[];
};

export function rewriteQuery(
  raw: string,
  ctx: RewriteContext = {},
): { rewritten: string; changed: boolean } {
  const text = (raw || '').trim();
  if (!text) return { rewritten: text, changed: false };

  let rewritten = text;
  const place = ctx.lastPlaceName?.trim();
  const topic = ctx.lastTopic?.trim();

  // Nur klare Orts-Pronomen — nie „das/es/den“
  if (place && /\b(dort|da|davon|dazu)\b/i.test(text)) {
    rewritten = rewritten
      .replace(/\bdavon\b/gi, `von ${place}`)
      .replace(/\bdazu\b/gi, `zu ${place}`)
      .replace(/\b(dort|da)\b/gi, place);
  }

  // „Auf der Speisekarte empfehlen“ — nur explizit Speisekarte, nicht bare „Karte“ (Maps)
  if (
    place &&
    /\b(auf|von)\s+der\s+speisekarte\b/i.test(text) &&
    /\b(empfehl|wählen|waehlen|nehmen|bestellen|gericht|satt|scharf|sushi|explizit|konkret|tipp)\b/i.test(
      text,
    )
  ) {
    rewritten = `${rewritten} (Speisekarte ${place}: konkrete Gerichte empfehlen, keine anderen Restaurants)`;
  } else if (
    place &&
    /\b(was\s+(soll|kann)\s+ich\s+(nehmen|wählen|waehlen|essen|bestellen)|hilfe\s+bei\s+der\s+(auswahl|entscheidung)|große\s+speisekarte)\b/i.test(
      text,
    )
  ) {
    rewritten = `${rewritten} (Speisekarte ${place}: Gerichte passend zu Prefs)`;
  }

  if (
    topic &&
    /^(und|auch|mehr|weiter|erzähl|erzaehl|mehr dazu)\b/i.test(text)
  ) {
    rewritten = `${text} (Bezug: ${topic})`;
  }

  if (/^(hunger|durst|essen|trinken)\??$/i.test(text)) {
    rewritten =
      text.toLowerCase() === 'durst'
        ? 'Wo kann ich etwas trinken?'
        : 'Wo kann ich etwas essen?';
  }

  // UI-Action-Chips → echte Fragen
  if (/^suggest_food$/i.test(text) || /^essen finden$/i.test(text)) {
    rewritten = 'Wo kann ich heute Abend gut essen gehen?';
  }

  return {
    rewritten: rewritten.trim(),
    changed: rewritten.trim() !== text,
  };
}
