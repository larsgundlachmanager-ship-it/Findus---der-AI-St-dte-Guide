/**
 * Slim Stadt-Welcome-Fakten aus dem Voll-Pack — für schnellen Stadtwechsel.
 * Enthält vorproduzierte Speech (vorlesen ohne Gemini-Wartezeit).
 */

/**
 * Vorproduzierte Welcome-Speech aus Historie + Highlights (Struktur-Blaupause, Wortlaut aus Fakten).
 * @param {{ name: string, history: string, highlights: string[], todayHint?: string }} facts
 */
function punct(s) {
  const t = String(s || '').trim();
  if (!t) return '';
  return /[.!?]$/.test(t) ? t : `${t}.`;
}

/** Lexikon-Zeile → gesprochener Einstieg (keine Jahres-Salve). */
function scenicOriginFromHistory(hist, name) {
  const raw = String(hist || '').replace(/\s+/g, ' ').trim();
  if (!raw) {
    return `Wir stehen mitten in ${name} — einer Stadt mit eigenem Charakter.`;
  }
  // Ersten inhaltlichen Block vor Semikolon/Pfeil, Jahres-Klammern dünnen
  let chunk = raw.split(/[;→]/)[0] || raw;
  chunk = chunk
    .replace(/\(\s*\d{3,4}[^)]*\)/g, '')
    .replace(/\b\d{4}\b/g, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+,/g, ',')
    .trim();
  if (chunk.length < 28) {
    chunk = raw.slice(0, 180).replace(/\s+\S*$/, '').trim();
  }
  // „Stadt (Name) wuchs…“ → szenischer Du-Einstieg
  chunk = chunk
    .replace(
      new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*`, 'i'),
      '',
    )
    .replace(/^wuchs\s+/i, '')
    .trim();
  if (/^um\s+/i.test(chunk) || /^an\s+/i.test(chunk)) {
    return `Hier ${chunk} — und daraus wurde ${name}.`;
  }
  if (chunk.length >= 24) {
    return `Stell dir vor: ${chunk.charAt(0).toLowerCase()}${chunk.slice(1)}`;
  }
  return `Wir stehen mitten in ${name} — nah genug zum Anfassen.`;
}

export function bakeWelcomeSpeech(facts) {
  const name = String(facts?.name || 'dieser Stadt').trim();
  const hist = String(facts?.history || '')
    .replace(/\s+/g, ' ')
    .trim();
  const highlights = Array.isArray(facts?.highlights)
    ? facts.highlights.map((h) => String(h || '').trim()).filter((h) => h.length >= 2)
    : [];
  const todayHint = String(facts?.todayHint || '').trim();

  const sentences = hist
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 28);
  const lexiconHeavy =
    /→/.test(hist.slice(0, 220)) ||
    (hist.slice(0, 220).match(/\b(?:1[0-9]{3}|20[0-9]{2})\b/g) || []).length >= 3;

  const origin = lexiconHeavy
    ? scenicOriginFromHistory(hist, name)
    : sentences[0] || hist.slice(0, 220);
  const turn = lexiconHeavy
    ? null
    : sentences.find((s, i) => i > 0 && !/^heute\b/i.test(s)) || sentences[1] || '';
  const todayFromHist = sentences.find((s) => /^heute\b/i.test(s));
  const today =
    todayHint ||
    todayFromHist ||
    `Heute prägt ${name} ihr eigenes Tempo — nah, greifbar, bereit für uns.`;

  const [a, b, c] = highlights;
  let tour = '';
  if (a && b && c) {
    tour = `Lass uns zuerst bei ${a} verlieren, dann den Kontrast bei ${b} spüren, und wenn es dämmert ${c} — Licht, Luft, Ankommen.`;
  } else if (a && b) {
    tour = `Lass uns ${a} entdecken und danach ${b}.`;
  } else if (a) {
    tour = `Lass uns bei ${a} starten.`;
  }

  return [punct(origin), turn ? punct(turn) : null, punct(today), tour || null, 'Was wollen wir als Erstes entdecken?']
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 1300);
}

/**
 * @param {Record<string, unknown>} pack
 */
export function buildCityWelcomeFacts(pack) {
  const cityId = String(pack?.city_id || pack?.cityId || '').toLowerCase();
  const name = String(pack?.city_name || pack?.name || cityId || 'Stadt').trim();
  const historyRaw = String(
    pack?._city_history || pack?.city_history || '',
  ).trim();
  const history = historyRaw.slice(0, 1800);

  const spots = Array.isArray(pack?.spots) ? pack.spots : [];
  const scored = [];
  for (const s of spots) {
    if (!s || typeof s !== 'object') continue;
    const id = String(s.id || '').toLowerCase();
    if (/city_history|stadtgeschichte|approach|sub_/.test(id)) continue;
    const tier = String(s.tier || '').toLowerCase();
    const kind = String(s.kind || s.category || '').toLowerCase();
    if (tier === 'directory' || kind === 'approach' || kind === 'sub') continue;
    const spotName = String(s.name || '').trim();
    if (spotName.length < 2) continue;
    const deep = String(
      s.deep_data_pool || s.general_info || s.summary || '',
    ).length;
    let score = deep;
    if (tier === 'must_have') score += 8000;
    else if (tier === 't1') score += 3000;
    if (s.story === 1 || s.story === true) score += 2000;
    if (/museum|schloss|dom|kirche|hafen|markt|platz|turm|brücke/i.test(spotName)) {
      score += 800;
    }
    scored.push({ name: spotName, score });
  }
  scored.sort((a, b) => b.score - a.score);
  const highlights = [];
  const seen = new Set();
  for (const row of scored) {
    const key = row.name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    highlights.push(row.name);
    if (highlights.length >= 3) break;
  }

  const todayHint = String(
    pack?._city_today_hint || pack?.city_today_hint || '',
  )
    .trim()
    .slice(0, 280);

  const curated = String(
    pack?._city_welcome_speech || pack?.city_welcome_speech || '',
  )
    .trim()
    .slice(0, 1350);

  const base = {
    v: 1,
    cityId,
    name,
    history,
    highlights,
    ...(todayHint ? { todayHint } : {}),
  };
  const speech =
    curated.length >= 60 ? curated : bakeWelcomeSpeech(base);
  return { ...base, speech };
}

export function welcomeFactsJson(pack) {
  return `${JSON.stringify(buildCityWelcomeFacts(pack))}\n`;
}
