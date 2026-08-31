/**
 * Adresse / GPS / Koordinaten — nie in Speech oder UI-Stichpunkten,
 * außer der User fragt **explizit** danach.
 */

/** Letzter User-Turn — für TTS-Scrub (Adressen nur bei expliziter Nachfrage). */
let lastUserTextForPrivacy = '';

export function noteUserTextForAddressPrivacy(text: string): void {
  const t = String(text ?? '').trim();
  if (t) lastUserTextForPrivacy = t.slice(0, 500);
}

export function getLastUserTextForAddressPrivacy(): string {
  return lastUserTextForPrivacy;
}

/**
 * Explizit Adresse / Anschrift / Straße+Nr. / GPS —
 * nicht schon bei beiläufigem „Straße“ im Satz.
 */
export function userAskedForAddressOrCoords(text: string): boolean {
  return /\b(adresse|anschrift|hausnummer|plz|postleitzahl|wo\s+genau|wo\s+liegt\s+(?:das|es|der|die|der\s+ort)|wo\s+sitzt|schick(?:\s+mir)?(?:\s+die)?\s+adresse|nenn(?:\s+mir)?(?:\s+die)?\s+adresse|wie\s+hei[ßs]t\s+die\s+adresse|welche\s+adresse|welche\s+stra[ßs]e|die\s+stra[ßs]e\s+(?:bitte|nenne|sag|und)|stra[ßs]e\s+und\s+(?:hausnummer|nummer)|voll(?:e|ständige)?\s+adresse|koordinaten?|gps(?:\s*[- ]?\s*koordinaten?)?|geo[- ]?lage|lat(?:itude)?\s*(?:und|,|\/)\s*long)\b/i.test(
    text,
  );
}

export function lastUserAskedForAddressOrCoords(): boolean {
  return userAskedForAddressOrCoords(lastUserTextForPrivacy);
}

/**
 * Volle Straßenadresse aus Speech (Straße + Nr. + optional Ort).
 * Nur für Stichpunkte wenn der User danach gefragt hat.
 */
export function extractSpokenAddresses(speech: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const re =
    /\b((?:[A-ZÄÖÜ][\wÄÖÜäöüß.-]*(?:straße|strasse|str\.|allee|weg|platz|gasse|ring|damm)|Am\s+[A-ZÄÖÜ][\wÄÖÜäöüß.-]+|An\s+der\s+[A-ZÄÖÜ][\wÄÖÜäöüß.-]+)\s+\d{1,4}[a-zA-Z]?(?:\s*,\s*\d{5})?(?:\s+(?:in|in\s+der)\s+[A-ZÄÖÜ][\wÄÖÜäöüß.-]+)?)\b/gu;
  let m: RegExpExecArray | null;
  while ((m = re.exec(speech))) {
    const raw = m[1]?.replace(/\s+/g, ' ').trim();
    if (!raw || raw.length < 5) continue;
    const key = raw.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(raw);
  }
  return out.slice(0, 3);
}

/**
 * True = Stichpunkt ist Adress-/Geo-Müll (rausfiltern).
 * Jahre, Distanzen („50 m“), Preise bleiben.
 */
export function looksLikeAddressOrCoordBullet(text: string): boolean {
  const t = text.trim();
  if (!t) return true;

  // Dezimal-Koordinaten-Paar oder einzelnes Lat/Lng-Token
  if (
    /\b-?\d{1,2}\.\d{2,}\s*[,;/\s]\s*-?\d{1,3}\.\d{2,}\b/.test(t) ||
    /\bort\s+bei\s+-?\d{1,3}\.\d{2,}/i.test(t) ||
    /\b(lat|lng|lon|latitude|longitude|koordinate|koordinaten|gps)\b/i.test(t)
  ) {
    return true;
  }
  // Grad-Minuten / N 53° …
  if (
    /\b[ns]\s*\d{1,2}\s*°/.test(t) ||
    /\b\d{1,3}\s*°\s*\d{1,2}(?:['′]\s*\d{0,2})?\s*[nsew]?\b/i.test(t)
  ) {
    return true;
  }
  // Reine Dezimalzahl die wie Koordinate wirkt (53.659812)
  if (/^-?\d{1,2}\.\d{4,}\s*$/.test(t) || /^-?\d{1,3}\.\d{4,}\s*$/.test(t)) {
    return true;
  }

  if (/\b(adresse|anschrift|hausnummer|standort\s*:)\b/i.test(t)) return true;
  if (/\b\d{5}\s+[A-ZÄÖÜa-zäöü]/.test(t)) return true; // PLZ + Ort
  // Nur PLZ als Bullet
  if (/^\d{5}$/.test(t)) return true;

  // Straße/Allee/Weg + Hausnummer
  if (
    /\b[\wÄÖÜäöüß.-]+(?:straße|strasse|str\.|allee|weg|platz|gasse|ring|damm)\s+\d{1,4}[a-zA-Z]?\b/i.test(
      t,
    )
  ) {
    return true;
  }

  // „Am Markt 3“, „An der Pinnau 12“ — Hausnummer ohne Straßen-Suffix
  if (
    /\b(?:am|an\s+der|an\s+dem|im|in\s+der)\s+[\wÄÖÜäöüß.-]+\s+\d{1,4}[a-zA-Z]?\b/i.test(
      t,
    ) &&
    !/\b(seit|jahr|€|euro|min|eintritt|preis|stufe|meter|höhe)\b/i.test(t)
  ) {
    return true;
  }

  // Reine Straßenzeile ohne Nutzen
  if (
    /^(?:[\wÄÖÜäöüß.-]+\s+){0,3}(?:straße|strasse|str\.|allee|weg|platz)\b/i.test(
      t,
    ) &&
    !/\b(seit|€|euro|min|wasserski|wake|sport|eintritt|preis|gebaut|denkmal)\b/i.test(
      t,
    )
  ) {
    return true;
  }

  return false;
}

/** Stichpunkte ohne Adresse/Koordinaten — außer User hat danach gefragt. */
export function filterAddressCoordBullets(
  bullets: string[],
  opts?: { userText?: string | null; allowAddress?: boolean },
): string[] {
  const allow =
    opts?.allowAddress === true ||
    (opts?.userText != null &&
      opts.userText.trim().length > 0 &&
      userAskedForAddressOrCoords(opts.userText));
  if (allow) return bullets.filter((b) => Boolean(b?.trim()));
  return bullets.filter(
    (b) => Boolean(b?.trim()) && !looksLikeAddressOrCoordBullet(b),
  );
}
