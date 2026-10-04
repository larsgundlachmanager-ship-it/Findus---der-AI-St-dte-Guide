/**
 * Spickzettel-Titel = Thema des Turns, nie „Yorro“.
 */

/** Zahlwörter / Wetter-Füllsel — nie als Stadt im Titel (z. B. „in Sechzehn Grad“). */
const CITY_TITLE_STOP =
  /^(null|ein|eins|eine|zwei|drei|vier|fünf|fuenf|sechs|sieben|acht|neun|zehn|elf|zwölf|zwoelf|dreizehn|vierzehn|fünfzehn|fuenfzehn|sechzehn|siebzehn|achtzehn|neunzehn|zwanzig|dreißig|dreissig|vierzig|fünfzig|fuenfzig|sechzig|siebzig|achtzig|neunzig|hundert|grad|graden|temperatur|regen|sonne|wolken|heute|morgen|abend|nacht|mittag)$/iu;

const WEATHER_BLOB_RE =
  /\b(wetter|regen|regnet|regnen|schauer|regenschirm|bewölkt|bewoelkt|sonnig|wechselhaft|niederschlag|temperaturen?\b|\d+\s*°|\d+\s*grad)\b/iu;

/** LLM-/Parse-Müll — nie als Kartentitel. */
export function sanitizeCardTitle(raw: string | null | undefined): string | null {
  const t = String(raw ?? '').replace(/\s+/g, ' ').trim();
  if (!t) return null;
  if (/^[\[\]{}]+$/u.test(t)) return null;
  if (/^yorro\b/i.test(t)) return null;
  if (t.length <= 2 && !/^\d/u.test(t)) return null;
  return t.slice(0, 48);
}

export function deriveSpickzettelTitle(opts: {
  userText?: string | null;
  speech?: string | null;
  bullets?: string[] | null;
  explicit?: string | null;
  cityHint?: string | null;
}): string {
  const explicit = sanitizeCardTitle(opts.explicit) ?? '';
  const uEarly = (opts.userText || '').replace(/\s+/g, ' ').trim();
  const sEarly = (opts.speech || '').replace(/\s+/g, ' ').trim();
  const b0Early = (opts.bullets?.[0] || '').trim();
  const earlyBlob = `${uEarly} ${sEarly} ${b0Early}`;
  const earlyWeather = WEATHER_BLOB_RE.test(earlyBlob);
  const triviaAsk =
    /\b(?:wie\s+alt|wie\s+(?:heißt|heisst|nennt)|wer\s+(?:ist|war|heißt|heisst))\b/iu.test(
      uEarly,
    );
  // Sticky/LLM „Alter“ nie bei Wetter-Turn; Trivia nie sticky Wetter-Titel
  if (
    explicit &&
    !(triviaAsk && /^wetter\b/i.test(explicit)) &&
    !(earlyWeather && /^(alter|person)\b/i.test(explicit))
  ) {
    return explicit;
  }

  const u = uEarly;
  const s = sEarly;
  const b0 = b0Early;
  const blob = earlyBlob;

  // GPS/Pack-Hint schlägt Speech-Extraktion — Speech hat oft „in Sechzehn Grad“.
  const city = pickCityHint(opts.cityHint || '') || pickCityHint(blob);

  // Regen-Fokus vor allgemeinem Wetter — kein Outfit-/Essay-Titel
  if (
    /\b(regnet|regnen|regen|regnerisch|niederschlag|schauer)\b/iu.test(u) &&
    !/\b(anziehen|outfit|kleidung|was\s+soll\s+ich\s+an|wie\s+kalt|wie\s+warm)\b/iu.test(u)
  ) {
    return 'Regen';
  }

  // Wetter schlägt Alters-Trivia — STT mischt oft „wie alt“ + „Wetter“ → nie Titel „Alter“
  if (earlyWeather) {
    return city ? `Wetter in ${city}` : 'Wetter';
  }

  // Kopfrechnung — nicht Bullet als Titel
  if (/\b\d+\s*(?:\+|plus|minus|-|\*|mal|x|\/|:|geteilt)\s*\d+\b/iu.test(u) || /\bquadratwurzel\b/iu.test(u)) {
    return 'Rechenaufgabe';
  }

  // Trivia/Wer-ist/Wie-heißt — nur ohne Wetter-Signal
  if (/\bwie\s+alt\b/iu.test(u) || /\bwie\s+alt\b/iu.test(s)) {
    const blobAge = `${u} ${s} ${b0}`;
    const papstBlob = blobAge.replace(/\b(past|pabst)\b/giu, 'Papst');
    if (/\b(papst|pope)\b/iu.test(papstBlob)) {
      if (/\bleo\b/iu.test(papstBlob) && /\b(xiv|14|vierzehn)/iu.test(papstBlob)) {
        return 'Alter vom Papst Leo XIV';
      }
      // Leo oft erst in Speech/Bullets
      if (/\bleo\b/iu.test(s) || /\bxiv\b/iu.test(s) || /\bxiv\b/iu.test(b0)) {
        return 'Alter vom Papst Leo XIV';
      }
      return 'Alter vom Papst';
    }
    const who =
      u.match(
        /\bwie\s+alt\s+ist\s+(?:(?:der|die|das)\s+)?(.+?)(?:\s*\?|$)/iu,
      )?.[1]?.trim() || '';
    const person = who
      .replace(/\?+$/, '')
      .replace(/\b(past|pabst)\b/giu, 'Papst')
      .trim();
    if (
      person &&
      person.length >= 2 &&
      person.length <= 40 &&
      !/^namen$/iu.test(person) &&
      !/\bwetter\b/iu.test(person)
    ) {
      return `Alter von ${person}`.slice(0, 48);
    }
    return 'Alter';
  }

  // Größen-/Maß-Frage — Titel = Thema, nie Maß-Bullet als Überschrift
  // (kein ß in /i-\w — JS case-fold quirk)
  if (/\bwie\s+gro/iu.test(u) || /\b(flaeche|fläche|quadrat|hektar|maße|masse)\b/iu.test(u)) {
    const rawSubj =
      u.match(
        /\bwie\s+gro\S{0,8}?\s+(?:ist|sind)\s+(.+?)(?:\s*\?|$)/iu,
      )?.[1] ||
      u.match(
        /\b(?:flaeche|fläche|maße|masse)\s+(?:von|vom|der|des|eines|einer)?\s*(.+?)(?:\s*\?|$)/iu,
      )?.[1] ||
      '';
    let subj = rawSubj
      .replace(/^(denn|eigentlich|genau|ungefähr|ungefaehr)\s+/iu, '')
      .replace(/\?+$/, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (subj.length >= 2 && subj.length <= 42 && !/^(das|es|er|sie)$/iu.test(subj)) {
      // „ein Tennisplatz“ → „Größe eines Tennisplatzes“
      if (/^ein\s+/iu.test(subj)) {
        const noun = subj.replace(/^ein\s+/iu, '').trim();
        if (noun) {
          const gen =
            /platz$/iu.test(noun) && !/platzes$/iu.test(noun)
              ? `${noun}es`
              : /[^sß]$/iu.test(noun)
                ? `${noun}s`
                : noun;
          return `Größe eines ${gen}`.slice(0, 48);
        }
      }
      if (/^eine\s+/iu.test(subj)) {
        const noun = subj.replace(/^eine\s+/iu, '').trim();
        if (noun) return `Größe einer ${noun}`.slice(0, 48);
      }
      if (/^(der|die|das)\s+/iu.test(subj)) {
        return `Größe ${subj}`.slice(0, 48);
      }
      return `Größe: ${subj}`.slice(0, 48);
    }
    return 'Größe';
  }

  if (/\b(?:wie\s+(?:heißt|heisst|nennt)|wer\s+(?:ist|war|heißt|heisst))\b/iu.test(u)) {
    const topic =
      u
        .match(
          /\b(?:wie\s+(?:heißt|heisst|nennt(?:\s+man)?)|wer\s+(?:ist|war|heißt|heisst))\s+(?:(?:die|der|das)\s+)?(?:aktuelle[rn]?\s+|jetzige[rn]?\s+)?(.+?)(?:\s*\?|$)/iu,
        )?.[1]
        ?.replace(/\?+$/, '')
        .replace(/\s+/g, ' ')
        .trim() || '';
    if (topic.length >= 3 && topic.length <= 48 && !/^(das|es|er|sie)$/iu.test(topic)) {
      return topic.slice(0, 48);
    }
    return 'Person';
  }
  if (
    /\b(essen|restaurant|mittag|abendessen|frühstück|fruehstueck|hunger|gastro|speisekarte|vegan|vegetarisch|kein\s+fleisch)\b/iu.test(
      blob,
    )
  ) {
    if (/\b(vegan|vegetarisch|kein\s+fleisch|ohne\s+fleisch)\b/iu.test(u)) {
      return city ? `Vegan in ${city}` : 'Vegan';
    }
    return city ? `Essen in ${city}` : 'Essen';
  }
  if (/\b(flug|fliegen|gate|boarding|flughafen)\b/iu.test(blob)) {
    return 'Flug';
  }
  if (/\b(hotel|übernacht|uebernacht|unterkunft)\b/iu.test(blob)) {
    return city ? `Hotel in ${city}` : 'Hotel';
  }
  if (/\b(event|konzert|festival|kino|party|was\s+geht)\b/iu.test(blob)) {
    return city ? `Programm in ${city}` : 'Programm';
  }


  if (
    b0 &&
    !/^yorro\b/i.test(b0) &&
    !/^(namen|name|titel|ort|fakt)$/iu.test(b0) &&
    // Maß-/Dimension-Bullet nie als Titel (sonst Titel = Stichpunkt)
    !/\b(doppel|einzel|feld|×|x)\b/iu.test(b0) &&
    !/\d+\s*[x×]\s*\d+/iu.test(b0) &&
    !/^\s*(?:länge|breite|höhe|flaeche|fläche)\s*:/iu.test(b0) &&
    b0.length <= 40
  ) {
    return b0.replace(/[·|].*$/, '').trim().slice(0, 48) || 'Spickzettel';
  }
  return 'Spickzettel';
}

function pickCityHint(blob: string): string | null {
  const m = blob.match(
    /\b(?:in|nach|für|fuer)\s+([A-ZÄÖÜ][\p{L}'-]{2,24})\b/u,
  );
  const cand = m?.[1]?.trim() || null;
  if (
    cand &&
    !CITY_TITLE_STOP.test(cand) &&
    !/^(Morgen|Heute|Abend|Mittag|Wetter|Essen)$/u.test(cand) &&
    // „in Sechzehn Grad“ / „in Zwanzig Grad“ — Temperatur, keine Stadt
    !new RegExp(
      `\\b(?:in|nach|für|fuer)\\s+${cand}\\s*(?:grad|°|graden)\\b`,
      'iu',
    ).test(blob)
  ) {
    return cand;
  }
  const known = blob.match(
    /\b(Hamburg|Berlin|München|Muenchen|Köln|Koeln|Frankfurt|Prisdorf|Laboe|Wangerooge|Wien|Zürich|Zuerich|Amsterdam|Paris|Rom|Athen|London|Lissabon|Lübeck|Luebeck|Pinneberg)\b/u,
  );
  return known?.[1] ?? null;
}
