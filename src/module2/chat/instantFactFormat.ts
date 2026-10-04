/**
 * Instant-Fakten-Bullets + Speech-Glue für Call-1→Call-2.
 */

/** Leerzeichen zwischen Buchstabe und Ziffer (ist40 → ist 40). */
export function ensureLetterDigitSpaces(text: string): string {
  return (text || '')
    .replace(/([A-Za-zÄÖÜäöüß])(\d)/gu, '$1 $2')
    .replace(/(\d)([A-Za-zÄÖÜäöüß])/gu, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Call-2 an unvollständigen Bridge-Lead hängen. */
export function joinAnswerLeadContinuation(
  lead: string | null | undefined,
  continuation: string | null | undefined,
): string {
  const a = ensureLetterDigitSpaces((lead || '').replace(/\s+/g, ' ').trim());
  const b = ensureLetterDigitSpaces(
    (continuation || '').replace(/\s+/g, ' ').trim(),
  );
  if (!a) return b;
  if (!b) return a;
  if (b.toLowerCase().startsWith(a.toLowerCase())) return b;
  const needsSpace = !/[\s.,;:!?…–—-]$/u.test(a) && !/^[\s.,;:!?…–—-]/u.test(b);
  return ensureLetterDigitSpaces(needsSpace ? `${a} ${b}` : `${a}${b}`);
}

export function normalizeTriviaFactBullets(opts: {
  userText?: string | null;
  speech?: string | null;
  bullets?: string[] | null;
}): string[] {
  const user = (opts.userText || '').replace(/\s+/g, ' ').trim();
  const speech = (opts.speech || '').replace(/\s+/g, ' ').trim();
  const raw = (opts.bullets || []).map((b) => b.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const blob = `${speech} ${raw.join(' ')}`;

  if (/\bwie\s+alt\b/iu.test(user)) {
    const age =
      blob.match(
        /\b(\d{1,3})\s*(?:[-–—]\s*\d{1,3}\s*)?jahre?(?:\s+alt)?\b/iu,
      )?.[1] || null;
    const born =
      blob.match(
        /\bgeboren\s+(?:am\s+)?(\d{1,2}\.?\s*(?:januar|februar|märz|maerz|april|mai|juni|juli|august|september|oktober|november|dezember|\d{1,2}\.?)\s*\d{2,4}(?:\s+in\s+[A-ZÄÖÜ][\p{L}'-]{2,40})?)/iu,
      )?.[1]?.trim() ||
      blob.match(
        /\bam\s+(\d{1,2}\.\s*(?:januar|februar|märz|maerz|april|mai|juni|juli|august|september|oktober|november|dezember)\s+\d{4}(?:\s+in\s+[A-ZÄÖÜ][\p{L}'-]{2,40})?)/iu,
      )?.[1]?.trim() ||
      null;
    const out: string[] = [];
    if (age) out.push(`${age} Jahre alt`);
    if (born) out.push(`geboren am: ${born}`);
    // Optionaler Extra-Fakt (Fun) — nicht Alter/Geburt wiederholen
    for (const b of raw) {
      if (out.length >= 3) break;
      const key = b.toLowerCase().replace(/[^a-zäöüß0-9]/giu, '');
      if (!key) continue;
      if (/\bjahre?\b/iu.test(b) && age && b.includes(age)) continue;
      if (/^geboren\b/iu.test(b) || /^alter\b/iu.test(b)) continue;
      if (/^gr\u00f6\u00dfe\b|^alter vom\b/iu.test(b)) continue;
      if (out.some((d) => d.toLowerCase().replace(/[^a-zäöüß0-9]/giu, '') === key)) {
        continue;
      }
      out.push(b);
    }
    if (out.length) return out.slice(0, 3);
  }

  // Fläche / Größe (Alster, See, Platz …) — kein ß in /i-Klassen (JS case-fold quirk)
  if (
    /\bwie\s+gro/iu.test(user) ||
    /\b(flaeche|fl\u00e4che|quadrat|hektar|km\s*2|km2|tennis|maße|masse)\b/iu.test(user)
  ) {
    const out: string[] = [];
    const pushUnique = (line: string) => {
      const t = line.replace(/\s+/g, ' ').trim();
      if (!t || out.length >= 3) return;
      const key = t.toLowerCase().replace(/[^a-zäöüß0-9]/giu, '');
      if (out.some((d) => d.toLowerCase().replace(/[^a-zäöüß0-9]/giu, '') === key)) {
        return;
      }
      // Nie Titel-/Frage-Echo als Stichpunkt
      if (/^gr\u00f6\u00dfe\b/iu.test(t) && !/\d/.test(t)) return;
      out.push(t);
    };

    // Tennis: Doppel / Einzel als getrennte Fakten
    const dimPair =
      /(\d{1,2}(?:[.,]\d{1,2})?)\s*(?:[x×]|mal)\s*(\d{1,2}(?:[.,]\d{1,2})?)\s*(?:m|meter)?/iu;
    const doppel =
      blob.match(
        new RegExp(
          String.raw`\b(?:doppel(?:feld)?|doubles?)\b[^0-9]{0,28}${dimPair.source}`,
          'iu',
        ),
      ) ||
      blob.match(
        new RegExp(
          String.raw`${dimPair.source}[^.]{0,28}\b(?:doppel(?:feld)?|doubles?)\b`,
          'iu',
        ),
      );
    const einzel =
      blob.match(
        new RegExp(
          String.raw`\b(?:einzel(?:feld)?|singles?)\b[^0-9]{0,28}${dimPair.source}`,
          'iu',
        ),
      ) ||
      blob.match(
        new RegExp(
          String.raw`${dimPair.source}[^.]{0,28}\b(?:einzel(?:feld)?|singles?)\b`,
          'iu',
        ),
      );
    if (doppel) {
      pushUnique(
        `Doppelfeld: ${String(doppel[1]).replace('.', ',')}×${String(doppel[2]).replace('.', ',')} m`,
      );
    }
    if (einzel) {
      pushUnique(
        `Einzelfeld: ${String(einzel[1]).replace('.', ',')}×${String(einzel[2]).replace('.', ',')} m`,
      );
    }

    const fmtArea = (n: string, unitRaw: string) => {
      const unit = /ha|hektar/iu.test(unitRaw)
        ? 'ha'
        : /km/iu.test(unitRaw)
          ? 'km\u00b2'
          : unitRaw;
      return `${n} ${unit}`;
    };

    // Benannte Teilflächen (Alster: Außen-/Binnenalster) — Schema wie Alter-Bullets
    // Kein ß in /i-Klassen (JS case-fold quirk). Kein \b nach km² (² ist schon non-word).
    const partAreaRe =
      /\b((?:au(?:ss|\u00df)en|binnen|innen)alster)\b[^0-9]{0,56}(\d{1,4}(?:[.,]\d{1,3})?)\s*(km\s*[\u00b2]|km2|quadratkilometer|hektar|ha)(?=\s|[.,!?;:]|$)/giu;
    let partM: RegExpExecArray | null;
    const partsFound: string[] = [];
    while ((partM = partAreaRe.exec(blob))) {
      const rawName = partM[1] || '';
      const nice = /au(?:ss|\u00df)en/iu.test(rawName)
        ? 'Außenalster'
        : /binnen/iu.test(rawName)
          ? 'Binnenalster'
          : 'Innenalster';
      const line = `${nice}: ${fmtArea(partM[2]!, partM[3]!)}`;
      partsFound.push(line);
      pushUnique(line);
    }

    // Eine Gesamtfläche, wenn keine Teilflächen
    if (!partsFound.length) {
      const area = blob.match(
        /(\d{1,4}(?:[.,]\d{1,3})?)\s*(km\s*[\u00b2]|km2|quadratkilometer|hektar|ha)(?=\s|[.,!?;:]|$)/iu,
      );
      if (area) {
        pushUnique(fmtArea(area[1]!, area[2]!));
      }
    }

    // Generisches L×B wenn kein Doppel/Einzel
    if (!doppel && !einzel) {
      const dims = blob.match(
        /(\d{1,2}(?:[.,]\d{1,2})?)\s*[x×]\s*(\d{1,2}(?:[.,]\d{1,2})?)\s*(?:m|meter)\b/iu,
      );
      if (dims) {
        pushUnique(
          `Maße: ${String(dims[1]).replace('.', ',')}×${String(dims[2]).replace('.', ',')} m`,
        );
      }
    }

    for (const b of raw) {
      if (out.length >= 3) break;
      if (/\b(adresse|gps|lat|lng|koordinate)\b/iu.test(b)) continue;
      // Speech-Kopie / Titel-Echo raus
      if (speech && b.replace(/\s+/g, ' ').trim().toLowerCase() === speech.toLowerCase()) {
        continue;
      }
      // „Fläche: X“ → knapper Kern wenn schon Maß da
      const asArea = b.match(
        /^(?:fl\u00e4che|flaeche)\s*:\s*(.+)$/iu,
      );
      if (asArea) {
        pushUnique(asArea[1]!.trim());
        continue;
      }
      pushUnique(b);
    }
    if (out.length) return out.slice(0, 3);
  }

  // Rechnung: kein doppelter Titel=Bullet
  if (/\b\d+\s*(?:\+|plus|minus|-|\*|mal|x|\/|:|geteilt)\s*\d+/iu.test(user)) {
    const eq =
      blob.match(
        /(\d+(?:[.,]\d+)?)\s*(?:\+|plus|minus|-|\*|mal|x|\/|:|geteilt(?:\s+durch)?)\s*(\d+(?:[.,]\d+)?)\s*(?:=|ergibt|ist)\s*(\d+(?:[.,]\d+)?)/iu,
      ) ||
      raw[0]?.match(
        /(\d+(?:[.,]\d+)?)\s*(?:\+|plus|minus|-|\*|mal|\/)\s*(\d+(?:[.,]\d+)?)\s*=\s*(\d+(?:[.,]\d+)?)/iu,
      );
    if (eq) {
      return [`Ergebnis: ${eq[3]}`];
    }
  }

  // Dedup nahe Doppelungen
  const dedup: string[] = [];
  for (const b of raw) {
    const key = b.toLowerCase().replace(/[^a-zäöüß0-9]/giu, '');
    if (dedup.some((d) => d.toLowerCase().replace(/[^a-zäöüß0-9]/giu, '') === key)) {
      continue;
    }
    // „40 Jahre“ wenn schon „40 Jahre alt …“ existiert
    if (
      /^\d{1,3}\s*jahre?\.?$/iu.test(b) &&
      dedup.some((d) => /\b\d{1,3}\s*jahre?/iu.test(d))
    ) {
      continue;
    }
    dedup.push(b);
    if (dedup.length >= 3) break;
  }
  return dedup;
}
