/**
 * Erkennt geklebte Bridge-Sätze (User-Fragment + Floskel).
 * Rein — kein RN.
 *
 * Prinzip: Call-1-Bridge nie wegen „Wartefloskel“ verwerfen → Stille.
 * Nur Parser-Müll / Fake-Ignoranz / interne Denk-Anweisungen raus; alles andere bleibt.
 */

const WEATHER_IGNORANCE_RE =
  /\b(wissen\s+(?:wir\s+)?nicht|keine\s+ahnung|kann\s+ich\s+(?:dir\s+)?(?:gerade\s+)?nicht\s+sagen|hab(?:e|)\s+ich\s+gerade\s+nicht|steht\s+mir\s+nicht\s+zur\s+verfügung)\b/iu;

/** Call-1 Denkrahmen / work[] / JSON-Checks — nie vorlesen. */
const INTERNAL_BRIDGE_RE =
  /\b(ZIELZUSTAND|L[ÜU]CKEN|DENKRAHMEN|call2Brief|keine_venues_in_call1|Autonomie|work\s*\[|execution\s*=|selectedGoldKeys|bridgeComplete|JSON\s*schreib|intern(?:e|er|en)?\s+(?:Anweisung|Denk|Auftrag)|Bricks?\b|RECHERCHE\s*[—\-]|Gel[äa]nder\s*\()/iu;

/**
 * Alleinige 0815-Floskel ohne Bezug zum Wunsch — laut Bridge-SSOT verboten.
 * Inhaltliche Zusagen („guck kurz nach dem Wetter“) bleiben.
 */
const SOLE_VAGUE_FILLER_RE =
  /^(?:yo[,!]?\s*)?(?:alles\s+klar|passt|ok(?:ay)?|mega(?:\s+plan)?|gute\s+frage|klingt\s+(?:gut|super|toll)|genau\s+das\s+klären\s+wir\s+jetzt|ich\s+(?:schau|guck|check(?:e)?)\s+mal(?:\s+kurz)?|wissen\s+kommt\s+gleich|ich\s+hol(?:e)?\s+(?:dir\s+)?(?:das\s+)?(?:sauber|nützliche\s+fakten)|ich\s+gehe?\s+an\s+dein\s+anliegen\s+ran|passende\s+orte\s+(?:zum\s+essen\s+)?kommen\s+gleich)[.!…]?\s*$/iu;

export function looksLikeSoleVagueFillerBridge(text: string): boolean {
  const t = (text || '').replace(/\s+/g, ' ').trim();
  if (!t) return false;
  if (t.split(/\s+/).length > 14) return false;
  if (
    /\b(wetter|regen|fahrrad|rad|route|navig|steak|restaurant|essen|flug|taxi|alster|sup|paddle|all\s*you\s*can|buffet|theater|kino|hotel|michel|papst|einwohner|quadrat)\b/iu.test(
      t,
    )
  ) {
    return false;
  }
  return SOLE_VAGUE_FILLER_RE.test(t);
}

/**
 * Kurzer Job-Anker aus der User-Frage — Struktur, kein Dialog-Skript.
 * Für Cover wenn Call-1 nur 0815 geliefert hat.
 */
export function extractBridgeAskAnchor(userText: string): string | null {
  const t = (userText || '').replace(/\s+/g, ' ').trim();
  if (!t) return null;
  if (/\ball[\s-]*(?:you|xou|jou)[\s-]*can[\s-]*eat\b|\bayce\b|\bbuffet\b/iu.test(t)) {
    return 'All-you-can-eat';
  }
  if (/\b(steak|angus|döner|doener|pizza|sushi|pannfisch)\b/iu.test(t)) {
    const m = t.match(/\b(steak|angus|döner|doener|pizza|sushi|pannfisch)\b/iu);
    return m?.[1] ? m[1] : 'Essen';
  }
  if (
    /\b(sup\b|stand[-\s]?up|paddle|paddel|stell[\s-]*appell|center[\s-]*panel)\b/iu.test(
      t,
    ) ||
    (/\bsub\b/iu.test(t) &&
      /\b(verleih|alster|paddel|fahren)\b/iu.test(t))
  ) {
    return 'Stand-up-Paddeln';
  }
  if (/\b(fahrrad|rad)\b/iu.test(t) && /\b(fahr|route|hin|nav|kirche|dahin)\b/iu.test(t)) {
    return 'die Rad-Route';
  }
  if (/\b(wetter|regnet|regen|schauer|temperatur)\b/iu.test(t)) return 'das Wetter';
  if (/\b(wie\s+alt|wer\s+ist|wie\s+heißt|wie\s+heisst|einwohner|quadratmeter|fläche|flaeche|höhe|hoehe)\b/iu.test(t)) {
    return 'die Antwort';
  }
  if (/\b(reservier|tisch)\b/iu.test(t)) return 'die Reservierung';
  if (/\b(flug|fliegen|taxi|uber)\b/iu.test(t)) return 'Flug und Transfer';
  if (/\b(restaurant|essen|frühstück|fruehstueck|café|cafe)\b/iu.test(t)) {
    return 'passende Orte';
  }
  return null;
}

/**
 * @deprecated Keine Notbremse mehr — Call-1-Bridge unverändert durchreichen.
 * Bleibt exportiert für alte Imports; ersetzt nichts.
 */
export function ensureBridgeAnchoredToAsk(
  bridge: string | null | undefined,
  _userText?: string,
): string | null {
  const raw = (bridge || '').replace(/\s+/g, ' ').trim();
  return raw || null;
}

/**
 * Bridge behalten — Lexikon/Wait-Floskeln sind Call-1-Inhalt, kein Kill.
 * Keine 0815-Notbremse / kein Ersetzen durch Anker-Zusage — Call-1 liefert die Speech.
 * Nur leerer String, Slot-Kleber, Fake-„weiß ich nicht“ und interne Regie raus.
 */
export function sanitizeBridgeText(text: string | null | undefined): string | null {
  let t = (text || '').replace(/\s+/g, ' ').trim();
  if (!t) return null;
  if (WEATHER_IGNORANCE_RE.test(t)) return null;
  if (looksLikeSlotGluedBridge(t)) return null;
  if (INTERNAL_BRIDGE_RE.test(t)) {
    // Ganze Bridge = Denkprotokoll → still (Cover kommt später / Soft-Ack)
    const sentences = t.split(/(?<=[.!?…])\s+/).filter(Boolean);
    const kept = sentences.filter((s) => !INTERNAL_BRIDGE_RE.test(s));
    t = kept.join(' ').replace(/\s+/g, ' ').trim();
    if (!t || INTERNAL_BRIDGE_RE.test(t)) return null;
  }
  return t;
}

/**
 * Meta-Lob / Recherche-Theater in Call-1 — verwerfen (kein Code-Ersatz).
 */
export function scrubMetaPraiseBridge(opts: {
  bridge: string;
  userText: string;
}): string | null {
  const bridge = (opts.bridge || '').replace(/\s+/g, ' ').trim();
  if (!bridge) return null;
  const meta =
    /\b(spannende|tolle|gute|interessante)\s+frage\b/iu.test(bridge) ||
    /\b(der|die|das)\s+ich\s+jetzt\s+(direkt\s+)?f[uü]r\s+dich\s+nachgeh/iu.test(bridge) ||
    /\bich\s+(schau|gehe|geh)\s+(dir\s+)?(jetzt\s+)?(direkt\s+)?nach\b/iu.test(bridge) ||
    /\bverrate\s+es\s+dir\b/iu.test(bridge) ||
    /\bmathematische\s+grundlagen\b/iu.test(bridge) ||
    /\bkein\s+hexenwerk\b/iu.test(bridge) ||
    /\bich\s+rechne\s+(dir\s+)?(das\s+)?(kurz\s+)?(f[uü]r\s+dich\s+)?nach\b/iu.test(bridge);
  if (!meta) return bridge;
  // Meta verwerfen — Bridge kommt vom Call-1-LLM, kein Code-Ersatz
  return null;
}

export function looksLikeSlotGluedBridge(text: string): boolean {
  const t = (text || '').replace(/\s+/g, ' ').trim();
  if (!t) return false;
  if (/\bklingt richtig gut\b/iu.test(t)) return true;
  if (
    t.split(/\s+/).length <= 14 &&
    /\bnach\s+[A-Za-zÄÖÜäöüß][\wÄÖÜäöüß'-]*\s+muss(?:t)?\b/iu.test(t)
  ) {
    return true;
  }
  return false;
}

function normCityKey(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '');
}

function cityMentioned(hay: string, city: string): boolean {
  const c = city.replace(/\s+/g, ' ').trim();
  if (c.length < 3) return false;
  const re = new RegExp(
    `\\b${c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`,
    'iu',
  );
  if (re.test(hay)) return true;
  const h = normCityKey(hay);
  const n = normCityKey(c);
  if (n.length < 6) return h.includes(n);
  if (h.includes(n)) return true;
  const pref = n.slice(0, Math.min(5, n.length));
  return pref.length >= 4 && h.includes(pref);
}

/** Ort aus Statistik-/Faktenfrage („Einwohner hat X“, „in X“). */
export function extractBridgeUserPlace(userText: string): string | null {
  const t = (userText || '').replace(/\s+/g, ' ').trim();
  if (!t) return null;
  const m =
    t.match(
      /\b(?:wie\s+viele\s+einwohner\s+hat)\s+([A-ZÄÖÜ][\p{L}'\-]{2,}(?:\s+[A-ZÄÖÜ][\p{L}'\-]{2,}){0,2})/iu,
    ) ||
    t.match(
      /\b(?:einwohner|einwohnerzahl|fläche|flaeche|höhe|hoehe)\s+(?:hat|haben|von|in)\s+([A-ZÄÖÜ][\p{L}'\-]{2,}(?:\s+[A-ZÄÖÜ][\p{L}'\-]{2,}){0,2})/iu,
    ) ||
    t.match(
      /\b(?:hat|haben)\s+([A-ZÄÖÜ][\p{L}'\-]{2,}(?:\s+[A-ZÄÖÜ][\p{L}'\-]{2,}){0,2})\s+(?:einwohner|einwohnerzahl)/iu,
    ) ||
    t.match(
      /\b(?:in|nach|für|fuer|von)\s+([A-ZÄÖÜ][\p{L}'\-]{2,}(?:\s+[A-ZÄÖÜ][\p{L}'\-]{2,}){0,2})\b/u,
    );
  const raw = m?.[1]?.replace(/\?+$/, '').trim() || null;
  if (!raw) return null;
  if (
    /^(Der|Die|Das|Ein|Eine|Heute|Morgen|Abend|Wetter|Jahre?|Leute)$/u.test(raw)
  ) {
    return null;
  }
  return raw;
}

/**
 * GPS-/Heimatstadt darf nicht in der Bridge landen, wenn der User eine andere
 * Stadt genannt hat (Call-1 Leak — Call-2 war oft schon richtig).
 */
export function scrubBridgeCityLeak(opts: {
  bridge: string;
  userText: string;
  gpsCities?: Array<string | null | undefined> | null;
}): string {
  let bridge = (opts.bridge || '').replace(/\s+/g, ' ').trim();
  if (!bridge) return bridge;
  const user = (opts.userText || '').replace(/\s+/g, ' ').trim();
  const named = extractBridgeUserPlace(user);
  const gpsList = (opts.gpsCities || [])
    .map((c) => (c || '').replace(/\s+/g, ' ').trim())
    .filter((c) => c.length >= 3);

  for (const gps of gpsList) {
    if (cityMentioned(user, gps)) continue;
    if (!cityMentioned(bridge, gps)) continue;
    if (
      named &&
      !cityMentioned(named, gps) &&
      normCityKey(named) !== normCityKey(gps)
    ) {
      const re = new RegExp(
        `\\b${gps.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`,
        'giu',
      );
      bridge = bridge.replace(re, named);
      continue;
    }
    bridge = bridge
      .replace(
        new RegExp(
          `\\b(?:in|nach|für|fuer|von|bei)\\s+${gps.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`,
          'giu',
        ),
        '',
      )
      .replace(
        new RegExp(`\\b${gps.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'giu'),
        '',
      )
      .replace(/\s+/g, ' ')
      .trim();
  }

  if (named) {
    const leaked = bridge.match(
      /\b([A-ZÄÖÜ][\p{L}'\-]{3,}(?:\s+[A-ZÄÖÜ][\p{L}'\-]{2,}){0,1})\b/gu,
    );
    for (const tok of leaked ?? []) {
      if (cityMentioned(user, tok)) continue;
      if (normCityKey(tok) === normCityKey(named)) continue;
      if (
        !/\b(einwohner|einwohnerzahl|schau|guck|nach|ort|stadt|fläche|flaeche)\b/iu.test(
          bridge,
        )
      ) {
        continue;
      }
      if (
        /^(Ich|Mir|Dir|Wir|Ihr|Alles|Klar|Moment|Wetter|Jahre|Leute|Einwohner)$/u.test(
          tok,
        )
      ) {
        continue;
      }
      const re = new RegExp(
        `\\b${tok.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`,
        'gu',
      );
      bridge = bridge.replace(re, named);
    }
  }

  return bridge.replace(/\s+/g, ' ').trim();
}


function looksLikeTriviaOrStatAsk(userText: string): boolean {
  const user = (userText || '').replace(/\s+/g, ' ').trim();
  if (!user) return false;
  try {
    const { isQuickLookupQuery } = require('../../services/concierge/celestialSkyQuery') as {
      isQuickLookupQuery: (s: string) => boolean;
    };
    if (isQuickLookupQuery(user)) return true;
  } catch {
    /* soft */
  }
  return (
    /\b(wie\s+alt|wer\s+(?:ist|war)|wie\s+(?:heißt|heisst)|wie\s+viele|einwohner|fläche|flaeche|höhe|hoehe)\b/iu.test(
      user,
    ) || /\b\d+\s*(?:\+|plus|minus|-)\s*\d+\b/iu.test(user)
  );
}

/** Trivia-Klärfrage („wen meinst du?“) — nie sprechen; Call-2 sucht selbst. */
export function scrubTriviaClarifyBridge(opts: {
  bridge: string;
  userText: string;
}): string | null {
  let bridge = (opts.bridge || '').replace(/\s+/g, ' ').trim();
  if (!bridge) return null;
  const user = (opts.userText || '').replace(/\s+/g, ' ').trim();
  if (!looksLikeTriviaOrStatAsk(user)) return bridge;
  // Nachgestellte Rückfrage abschneiden, Lead behalten
  bridge = bridge
    .replace(
      /[—–-]?\s*(?:oder\s+)?(?:wen|was|welche[rnms]?)\s+(?:genau\s+)?(?:meinst|meintest|meinen)\s+(?:du|Sie)?\s*[.?!]?\s*$/iu,
      '',
    )
    .replace(
      /[—–-]?\s*(?:soll\s+ich\s+(?:noch\s+)?nachfragen|möchtest\s+du\s+mehr|willst\s+du\s+mehr)\b.*$/iu,
      '',
    )
    .replace(/\s+/g, ' ')
    .trim();
  if (
    /\b(wen|was|welche[rn]?)\s+(genau\s+)?meinst\b/iu.test(bridge) ||
    /\bwen\s+genau\b/iu.test(bridge) ||
    /\bwie\s+alt\s+ist\s+wer\b/iu.test(bridge) ||
    /\b(finde\s+(gerne\s+)?heraus|schau\s+mal\s+wer)\b/iu.test(bridge) ||
    /\bwelchen\s+papst\b/iu.test(bridge)
  ) {
    return null;
  }
  return bridge || null;
}

/**
 * Call-1 Trivia/Stats: nur Antwort-EINLEITUNG — nie Alter/Zahl/Name als Fakt.
 * Vorgezogene Call-2-Werte (Jahre, Einwohner, …) → Satz streichen oder Bridge still.
 */
export function scrubPrematureTriviaFacts(opts: {
  bridge: string;
  userText: string;
}): string | null {
  const raw = (opts.bridge || '').replace(/\s+/g, ' ').trim();
  if (!raw) return null;
  const user = (opts.userText || '').replace(/\s+/g, ' ').trim();
  if (!looksLikeTriviaOrStatAsk(user)) return raw;

  const sentenceHasFact = (t: string): boolean =>
    /\b(?:rund|etwa|ca\.?|circa|ungefähr|ungefaehr|so\s+um\s+die|knapp|gut)\s+\d{1,3}\s*(?:jahre?(?:\s+alt)?|%\b)\b/iu.test(
      t,
    ) ||
    /\b\d{1,3}\s*(?:[-–—]\s*\d{1,3}\s*)?jahre?(?:\s+alt)?\b/iu.test(t) ||
    /\bist\s+(?:rund|etwa|ca\.?|circa|ungefähr|ungefaehr)?\s*\d{1,3}\b/iu.test(t) ||
    /\b(?:einwohner(?:zahl)?|menschen|personen|einwohnern)\s*(?:von\s+)?(?:rund|etwa|ca\.?|circa|knapp)?\s*\d[\d.\s]{1,12}\b/iu.test(
      t,
    ) ||
    /\b(?:rund|etwa|ca\.?|circa|knapp)?\s*\d{2,6}(?:[.\s]\d{3})?\s*(?:einwohner|menschen|personen)\b/iu.test(
      t,
    ) ||
    (/\b(?:hat|haben)\s+(?:rund|etwa|ca\.?|circa|knapp)?\s*\d{2,6}\b/iu.test(t) &&
      /\b(?:einwohner|menschen|personen|flaeche|fläche|hoehe|höhe)\b/iu.test(t)) ||
    /\b(?:misst|hat|beträgt|betraegt|liegt\s+bei)\s+(?:rund|etwa|ca\.?)?\s*\d+[.,]?\d*\s*(?:m|km|ha|km²|km2|quadrat)\b/iu.test(
      t,
    ) ||
    /\b(?:geboren|geburtsjahr|geb\.?)\s*(?:am\s+)?\d/iu.test(t) ||
    /\b(?:heißt|heisst|nennt\s+sich)\s+[A-ZÄÖÜ][\p{L}'\-]+(?:\s+[A-ZÄÖÜIVX][\p{L}'\-.]*){0,3}\b/u.test(
      t,
    );

  if (!sentenceHasFact(raw)) return raw;

  const sentences = raw.split(/(?<=[.!?…])\s+/).filter(Boolean);
  const kept = sentences
    .map((s) => s.trim())
    .filter((t) => t && !sentenceHasFact(t));
  const bridge = kept.join(' ').replace(/\s+/g, ' ').trim();
  // Nur Einleitung übrig → ok; sonst still (Call-2 liefert den Fakt, kein Sticky-Falschwert)
  return bridge || null;
}

/**
 * Affiliate/Provision/Tracking nie vorlesen — still verlinken.
 */
export function scrubAffiliateMonetizationSpeech(
  text: string | null | undefined,
): string {
  let t = (text || '').replace(/\s+/g, ' ').trim();
  if (!t) return '';
  t = t
    .replace(
      /\b(?:affiliate(?:[\s-]?link)?|provision|tracking|partnerlink|partner[\s-]?link)\b/giu,
      '',
    )
    .replace(
      /\b(?:dafür|dafuer)\s+(?:bekommen|verdienen)\s+wir(?:\s+(?:geld|provision))?\b/giu,
      '',
    )
    .replace(
      /\b(?:unser(?:e|en)?\s+partner(?:n)?|von\s+unseren\s+partnern|partnersuche(?:\s+mit\s+tracking)?)\b/giu,
      '',
    )
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([,.!?])/g, '$1')
    .trim();
  return t;
}

