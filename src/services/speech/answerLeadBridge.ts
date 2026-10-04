/**
 * Hörbares Call-1 Peek — Mini-Zusage sofort TTS, Worker parallel.
 * Call-1-LLM darf nur sprechen wenn Peek noch nicht gelaufen ist.
 * Siehe FINDUS_BRIDGE_CONTINUITY_BLOCK.
 */

export function peekAnswerLeadBridge(userText: string): string | null {
  const t = (userText || '').replace(/\s+/g, ' ').trim();
  if (t.length < 3) return null;

  // Solo-Flug A→B vor Plan/Nav-Peek — sonst „Klar, trag ich ein“ + ÖPNV-Titel
  try {
    const { isSoloFlightAbSearch, isFlightTripQuery } = require('../flights/flightTripIntent') as {
      isSoloFlightAbSearch: (s: string) => boolean;
      isFlightTripQuery: (s: string) => boolean;
    };
    if (isSoloFlightAbSearch(t) || isFlightTripQuery(t)) {
      return 'Klar, ich schau deinen Flug nach';
    }
  } catch {
    /* soft */
  }

  try {
    const { tryLocalArithmeticAnswer } = require('./localInstantAnswer') as {
      tryLocalArithmeticAnswer: (s: string) => { lead: string } | null;
    };
    const local = tryLocalArithmeticAnswer(t);
    if (local?.lead) return local.lead;
  } catch {
    /* soft */
  }

  try {
    const { looksLikeClockOrRangeNotMath } = require('./localInstantAnswer') as {
      looksLikeClockOrRangeNotMath: (s: string) => boolean;
    };
    if (!looksLikeClockOrRangeNotMath(t)) {
      const arith = t.match(
        /\b(\d{1,4})\s*(?:\+|plus|und|-|minus|\*|x|mal|\/|:)\s*(\d{1,4})\b/iu,
      );
      if (arith && !/\b(uhr|grad|°)\b/iu.test(t)) {
        const op = /minus|-/iu.test(arith[0])
          ? 'minus'
          : /\*|mal|x/iu.test(arith[0])
            ? 'mal'
            : /\/|:/iu.test(arith[0])
              ? 'geteilt durch'
              : 'plus';
        return `${arith[1]} ${op} ${arith[2]} ergibt`;
      }
    }
  } catch {
    /* soft */
  }

  const fx = t.match(
    /\b(\d{1,5}(?:[.,]\d{1,2})?)\s*(dollar|usd|euro|eur|pfund|gbp|yen)\s+(?:in|nach)\s+(dollar|usd|euro|eur|pfund|gbp|yen)\b/iu,
  );
  if (fx) {
    return `${fx[1]} ${fx[2]} in ${fx[3]} sind`;
  }

  const age = t.match(/\bwie\s+alt\s+ist\s+(.+?)[\?!.]*$/iu);
  if (age?.[1]) {
    let who = age[1]
      .replace(/^(denn|eigentlich|genau)\s+/iu, '')
      .replace(/\s+(heute|jetzt|gerade|genau)\s*$/iu, '')
      .replace(/\b(past|pabst)\b/giu, 'Papst')
      .trim();
    // Klarer Papst → kurzer Antwort-Einstieg (Antwort kommt schnell)
    if (/\b(papst|pope)\b/iu.test(who) || /\b(papst|pope)\b/iu.test(t)) {
      if (/\bleo\b/iu.test(t) && /\b(xiv|14|vierzehn)/iu.test(t)) {
        return 'Der Papst Leo der 14 ist';
      }
      return 'Der Papst ist';
    }
    if (/\b(?:älteste|aelteste)\b/iu.test(who) || /\b(?:älteste|aelteste)\b/iu.test(t)) {
      return 'Der derzeit älteste lebende Mensch der Welt ist';
    }
    if (who.length >= 2 && who.length <= 48) {
      return `${who} ist`;
    }
  }

  if (
    /\b(?:aktuell(?:e[rnms]?)?\s+papst|wer\s+(?:ist|war)\s+(?:der\s+)?(?:aktuelle\s+)?papst|oberhaupt\s+der\s+(?:katholischen\s+)?kirche)\b/iu.test(
      t,
    )
  ) {
    return 'Der aktuelle Papst ist';
  }

  const whoIs = t.match(/\bwer\s+ist\s+(?:der|die|das)?\s*(.+?)[\?!.]*$/iu);
  if (whoIs?.[1] && whoIs[1].trim().length >= 2) {
    return `${whoIs[1].trim()},`;
  }

  if (/\b(wie\s+lange|wieviel|wie\s+viel).{0,20}\bregen|noch\s+regnen|regnet\s+es\b/iu.test(t)) {
    return 'Klar, zum Regen';
  }
  if (/\b(wetter|wie\s+wird|regnet|regnen|temperatur)\b/iu.test(t)) {
    return 'Klar, ich schau kurz aufs Wetter';
  }
  if (
    /\b(was\s+geht|was\s+ist\s+los|was\s+läuft|events?|veranstaltung)\b/iu.test(t) &&
    /\b(heute|abend|nacht|morgen|wochenende)\b/iu.test(t)
  ) {
    return 'Klar, ich schau was heute so geht';
  }

  if (
    /\b(fahrrad|mit\s+dem\s+rad|per\s+rad)\b/iu.test(t) &&
    /\b(lang|minut|brauch|dauer|eta)\b/iu.test(t)
  ) {
    return 'Mit dem Rad brauchst du';
  }

  const nav = t.match(
    /\b(?:navigier\w*|bring\s+mich|führ\s+mich|fuehr\s+mich|route\s+(?:zu|nach|zum|zur))\s+(?:mich\s+)?(?:zum|zur|nach|zu)\s+(.+?)[\?!.]*$/iu,
  );
  if (nav?.[1]) {
    const dest = nav[1].replace(/\s+/g, ' ').trim().slice(0, 56);
    if (dest.length >= 2) {
      try {
        const { buildExplicitNavBridgeSpeech } = require('../navigation/navStartSpeech') as {
          buildExplicitNavBridgeSpeech: (n: string) => string;
        };
        return buildExplicitNavBridgeSpeech(dest);
      } catch {
        return `Alles klar — ich navigiere dich zu ${dest}.`;
      }
    }
  }

  // „zum Tennis Club“ / „ich möchte zum …“ ohne Navigier-Verb
  if (
    /\b(?:zum|zur|nach)\s+(.{3,56}?)[\?!.]*$/iu.test(t) &&
    /\b(tennis|club|navigier|bring|führ|fuehr|route|möchte|moechte|will)\b/iu.test(t)
  ) {
    try {
      const { detectHardNavOverride } = require('../navigation/hardNavOverride') as {
        detectHardNavOverride: (s: string) => string | null;
      };
      const dest =
        detectHardNavOverride(t)?.trim() ||
        t.match(/\b(?:zum|zur|nach)\s+(.+?)[\?!.]*$/iu)?.[1]?.trim();
      if (dest && dest.length >= 2) {
        const { buildExplicitNavBridgeSpeech } = require('../navigation/navStartSpeech') as {
          buildExplicitNavBridgeSpeech: (n: string) => string;
        };
        return buildExplicitNavBridgeSpeech(dest.slice(0, 56));
      }
    } catch {
      /* soft */
    }
  }

  if (
    /\b(wie\s+(?:groß|gross|viel)|wieviele|wie\s+viele|quadrat|hektar|fläche|flaeche|umfang)\b/iu.test(
      t,
    )
  ) {
    const named = t.match(
      /\b(?:wie\s+(?:groß|gross|viel)|wieviele|wie\s+viele).{0,40}?\b(?:die|der|das)?\s*([A-ZÄÖÜ][\p{L}'-]{2,40})/iu,
    );
    if (named?.[1]) return `${named[1]} misst`;
    return 'Die Fläche';
  }

  if (/\bquadratwurzel\b/iu.test(t)) {
    const n = t.match(/\b(?:aus|von)\s+(\d+(?:[.,]\d+)?)/iu)?.[1];
    return n ? `Die Quadratwurzel aus ${n} liegt bei` : 'Die Quadratwurzel liegt bei';
  }

  try {
    const { looksLikeNamedTriviaSubject } = require('../../module2/kernel/turnKernel') as {
      looksLikeNamedTriviaSubject: (s: string) => boolean;
    };
    const { isQuickLookupQuery } = require('../concierge/celestialSkyQuery') as {
      isQuickLookupQuery: (s: string) => boolean;
    };
    if (isQuickLookupQuery(t) || looksLikeNamedTriviaSubject(t)) {
      return 'Kurz nachgeschaut';
    }
  } catch {
    /* soft */
  }

  try {
    const { classifyUtteranceFamily } = require('../../module2/kernel/utteranceFamily') as {
      classifyUtteranceFamily: (s: string) => { family: string };
    };
    const fam = classifyUtteranceFamily(t).family;
    if (fam === 'weather') return 'Klar, ich schau kurz aufs Wetter';
    if (fam === 'flight') return 'Klar, ich schau deinen Flug nach';
    if (fam === 'nav') {
      try {
        const { detectHardNavOverride } = require('../navigation/hardNavOverride') as {
          detectHardNavOverride: (s: string) => string | null;
        };
        const dest = detectHardNavOverride(t)?.trim();
        if (dest && dest.length >= 2) {
          const { buildExplicitNavBridgeSpeech } = require('../navigation/navStartSpeech') as {
            buildExplicitNavBridgeSpeech: (n: string) => string;
          };
          return buildExplicitNavBridgeSpeech(dest.slice(0, 56));
        }
      } catch {
        /* soft */
      }
      return 'Alles klar — ich starte die Navigation.';
    }
    if (fam === 'knowledge') return 'Kurz nachgeschaut';
    if (fam === 'pitch') return 'Klar, ich such was Passendes';
    if (fam === 'clock') return 'Klar, stell ich';
    if (fam === 'plan') return 'Klar, trag ich ein';
    if (fam === 'travel_agency') return 'Klar, ich schau was passt';
  } catch {
    /* soft */
  }

  // Kein starker Lead → Peek-Commit spricht trotzdem (nie Stille bis Call 2).
  return null;
}

/** Hörbares Call-1 — nie Stille bis Call 2 (kein Meta-Lob). */
export function peekAnswerLeadBridgeOrCommit(userText: string): string {
  return peekAnswerLeadBridge(userText) || 'Alles klar';
}
