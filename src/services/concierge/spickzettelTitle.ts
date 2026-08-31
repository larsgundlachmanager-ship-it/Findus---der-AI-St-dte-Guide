/**
 * Spickzettel-Titel = Thema des Turns, nie „Yorro“.
 */

/** Zahlwörter / Wetter-Füllsel — nie als Stadt im Titel (z. B. „in Sechzehn Grad“). */
const CITY_TITLE_STOP =
  /^(null|ein|eins|eine|zwei|drei|vier|fünf|fuenf|sechs|sieben|acht|neun|zehn|elf|zwölf|zwoelf|dreizehn|vierzehn|fünfzehn|fuenfzehn|sechzehn|siebzehn|achtzehn|neunzehn|zwanzig|dreißig|dreissig|vierzig|fünfzig|fuenfzig|sechzig|siebzig|achtzig|neunzig|hundert|grad|graden|temperatur|regen|sonne|wolken|heute|morgen|abend|nacht|mittag)$/iu;

export function deriveSpickzettelTitle(opts: {
  userText?: string | null;
  speech?: string | null;
  bullets?: string[] | null;
  explicit?: string | null;
  cityHint?: string | null;
}): string {
  const explicit = (opts.explicit || '').replace(/\s+/g, ' ').trim();
  if (explicit && !/^yorro\b/i.test(explicit)) {
    return explicit.slice(0, 48);
  }

  const u = (opts.userText || '').replace(/\s+/g, ' ').trim();
  const s = (opts.speech || '').replace(/\s+/g, ' ').trim();
  const b0 = (opts.bullets?.[0] || '').trim();
  const blob = `${u} ${s} ${b0}`;

  // GPS/Pack-Hint schlägt Speech-Extraktion — Speech hat oft „in Sechzehn Grad“.
  const city = pickCityHint(opts.cityHint || '') || pickCityHint(blob);

  if (
    /\b(wetter|regen|schauer|regenschirm|bewölkt|bewoelkt|sonnig|wechselhaft|niederschlag|temperaturen?\b|\d+\s*°)/iu.test(
      blob,
    )
  ) {
    return city ? `Wetter in ${city}` : 'Wetter';
  }
  if (
    /\b(essen|restaurant|mittag|abendessen|frühstück|fruehstueck|hunger|gastro|speisekarte)\b/iu.test(
      blob,
    )
  ) {
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

  if (b0 && !/^yorro\b/i.test(b0) && b0.length <= 40) {
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
