/**
 * Query Rewriter — konservativ. Kein blindes Ersetzen von „das“ (zerstört Sätze).
 */

export type RewriteContext = {
  lastPlaceName?: string | null;
  lastTopic?: string | null;
  /** Kurzer Ausschnitt der letzten Yorro-Antwort — für Rückfragen. */
  lastAssistantSnippet?: string | null;
  recentUserLines?: string[];
};

function isTaxiRideQuery(text: string): boolean {
  try {
    const { wantsTaxiRide } = require('../../services/mobility/taxiRideIntent') as {
      wantsTaxiRide: (s: string) => boolean;
    };
    return wantsTaxiRide(text);
  } catch {
    return false;
  }
}

function isDestCorrectionQuery(text: string): boolean {
  try {
    const { looksLikeSpokenCityCorrection } = require('../../services/navigation/navDestCityCorrection') as {
      looksLikeSpokenCityCorrection: (s: string) => boolean;
    };
    return looksLikeSpokenCityCorrection(text);
  } catch {
    return false;
  }
}

function isFollowUpProbe(text: string): boolean {
  const t = text.replace(/\s+/g, ' ').trim();
  if (isTaxiRideQuery(t)) return false;
  if (isDestCorrectionQuery(t)) return false;
  try {
    const { isSupermarketOfferQuery } = require('../../services/research/supermarketProspectGates') as {
      isSupermarketOfferQuery: (s: string) => boolean;
    };
    // Produkt/Prospekt = neuer Thread — nie an Flug/Pitch-Sticky kleben.
    if (isSupermarketOfferQuery(t)) return false;
  } catch {
    /* soft */
  }
  try {
    const { classifyUtteranceFamily } = require('../kernel/utteranceFamily') as {
      classifyUtteranceFamily: (s: string) => { family: string };
    };
    const fam = classifyUtteranceFamily(t).family;
    // Knowledge/Trivia / Wetter = neuer Thread — nie an Flug/Pitch kleben.
    if (
      fam === 'flight' ||
      fam === 'nav' ||
      fam === 'knowledge' ||
      fam === 'weather'
    ) {
      return false;
    }
  } catch {
    /* soft */
  }
  try {
    const { isQuickLookupQuery } = require('../../services/concierge/celestialSkyQuery') as {
      isQuickLookupQuery: (s: string) => boolean;
    };
    if (isQuickLookupQuery(t)) return false;
  } catch {
    /* soft */
  }
  try {
    const { looksLikeStreetAddress } = require('../../services/navigation/streetAddressQuery') as {
      looksLikeStreetAddress: (s: string) => boolean;
    };
    if (looksLikeStreetAddress(t)) return false;
  } catch {
    /* soft */
  }
  try {
    const { looksLikeExplicitNavOrAddress } = require('../kernel/turnKernel') as {
      looksLikeExplicitNavOrAddress: (s: string) => boolean;
    };
    if (looksLikeExplicitNavOrAddress(t)) return false;
  } catch {
    /* soft */
  }
  if (
    /\b(?:warum|wieso|weshalb|und\s+dann|was\s+noch|mehr\s+dazu|erzähl|erzaehl|geschlossen|wann|wie\s+(?:weit|lange|teuer|viel)|tickets?|davon|dazu|dahin|dorthin|öffnungszeiten|oeffnungszeiten|eintritt|dort|da|weiter|nochmal)\b/iu.test(
      t,
    )
  ) {
    return true;
  }
  if (/^(und|auch|mehr|weiter|erzähl|erzaehl|wann|wohin|wozu)\b/iu.test(t)) {
    return true;
  }
  return t.length > 0 && t.length <= 36;
}

export function rewriteQuery(
  raw: string,
  ctx: RewriteContext = {},
): { rewritten: string; changed: boolean } {
  const text = (raw || '').trim();
  if (!text) return { rewritten: text, changed: false };
  try {
    const { isBarePlanAck } = require('../planning/planConfirmAck') as {
      isBarePlanAck: (s: string) => boolean;
    };
    if (isBarePlanAck(text)) {
      const saidAsk = ctx.lastAssistantSnippet?.trim();
      if (saidAsk && /[?]/.test(saidAsk)) {
        return {
          rewritten: `${text} (gerade gefragt: ${saidAsk.slice(0, 140)})`,
          changed: true,
        };
      }
      return { rewritten: text, changed: false };
    }
  } catch {
    /* soft */
  }
  // Taxi/Uber oder neue Adresse = neues Thema, alten Flug-Thread nicht anhängen.
  if (isTaxiRideQuery(text)) return { rewritten: text, changed: false };
  if (isDestCorrectionQuery(text)) return { rewritten: text, changed: false };
  try {
    const { looksLikeStreetAddress } = require('../../services/navigation/streetAddressQuery') as {
      looksLikeStreetAddress: (s: string) => boolean;
    };
    if (looksLikeStreetAddress(text)) return { rewritten: text, changed: false };
  } catch {
    /* soft */
  }
  try {
    const { looksLikeExplicitNavOrAddress } = require('../kernel/turnKernel') as {
      looksLikeExplicitNavOrAddress: (s: string) => boolean;
    };
    const { looksLikeAddressAnaphor } = require('../../services/navigation/streetAddressQuery') as {
      looksLikeAddressAnaphor: (s: string) => boolean;
    };
    if (
      looksLikeExplicitNavOrAddress(text) &&
      !looksLikeAddressAnaphor(text)
    ) {
      return { rewritten: text, changed: false };
    }
  } catch {
    /* soft */
  }

  let rewritten = text;
  const place = ctx.lastPlaceName?.trim();
  const topic = ctx.lastTopic?.trim();
  const said = ctx.lastAssistantSnippet?.trim();

  // Nur klare Orts-Pronomen — nie „das/es/den“
  // „dahin / dorthin“ → zum zuletzt genannten Ort (Nav-Follow-up)
  if (place && /\b(dort|da|davon|dazu|dahin|dorthin|diese[rsn]?\s+adresse|die\s+adresse)\b/i.test(text)) {
    rewritten = rewritten
      .replace(/\bdavon\b/gi, `von ${place}`)
      .replace(/\bdazu\b/gi, `zu ${place}`)
      .replace(/\b(diese[rsn]?\s+adresse|die\s+adresse)\b/gi, place)
      .replace(/\b(dahin|dorthin|da\s+hin|dort\s+hin)\b/gi, `zum ${place}`)
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

  // Kurze Rückfrage: letzte Yorro-Frage schlägt totigen Ort/Thread
  if (isFollowUpProbe(text) && said && /[?]/.test(said)) {
    if (!/\(gerade gefragt:/i.test(rewritten)) {
      rewritten = `${rewritten} (gerade gefragt: ${said.slice(0, 140)})`;
    }
  } else if (isFollowUpProbe(text) && (place || topic || said)) {
    const bits: string[] = [];
    if (place) bits.push(`Ort: ${place}`);
    if (topic) bits.push(`Thema: ${topic}`);
    if (said) bits.push(`gerade besprochen: ${said.slice(0, 120)}`);
    if (bits.length && !/\(Bezug:|\(Ort:|\(gerade besprochen/i.test(rewritten)) {
      rewritten = `${rewritten} (${bits.join(' · ')})`;
    }
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

  const out = rewritten.trim();
  const changed = out !== text;
  return {
    rewritten: out,
    changed,
  };
}
