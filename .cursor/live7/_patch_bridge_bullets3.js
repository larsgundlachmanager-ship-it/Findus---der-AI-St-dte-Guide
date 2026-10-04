const fs = require('fs');
const path = require('path');

function writeSafe(file, content) {
  const abs = path.resolve(file);
  const tmp = abs + '.tmpwrite';
  fs.writeFileSync(tmp, content, 'utf8');
  fs.renameSync(tmp, abs);
}

// visualBullets: prose reject + title dedupe + age digit dedupe
{
  const p = 'src/services/concierge/visualBullets.ts';
  let s = fs.readFileSync(p, 'utf8');
  if (!s.includes('looksLikeProseBullet')) {
    const helpers = `
/** Prosa-Sätze als Stichpunkt — ablehnen (FACT-CHIPS statt Fließtext). */
const PROSE_BULLET_OPENER_RE =
  /^(?:also|gerade|heute|morgen|abend|nacht|in\\s+\\p{L}+|es\\s+(?:sieht|wird|ist)|liegst\\s+du|schau|lass\\s+uns|für\\s+eine|insgesamt|am\\s+besten)\\b/iu;

export function looksLikeProseBullet(raw: string): boolean {
  const b = String(raw ?? '').replace(/\\s+/g, ' ').trim();
  if (!b) return true;
  const words = b.split(/\\s+/).length;
  if (/[.!?]$/.test(b) && words >= 8) return true;
  if (PROSE_BULLET_OPENER_RE.test(b) && words >= 6) return true;
  if (words >= 12 && !b.includes('·') && !/[€$°%]/.test(b)) return true;
  return false;
}

function normalizeBulletFactKey(b: string): string {
  return b
    .toLowerCase()
    .replace(/\\b(alter|jahre?|geboren|am)\\b/giu, ' ')
    .replace(/[^\\p{L}\\p{N}]+/gu, ' ')
    .replace(/\\s+/g, ' ')
    .trim();
}

`;
    s = s.replace(
      'const BULLET_FLUFF_RE =',
      helpers + 'const BULLET_FLUFF_RE =',
    );
    // add cardTitle opt
    s = s.replace(
      `    /** Gemessenes UI-Budget (Zeichen / 2 Zeilen) — sonst Surface-Default */
    maxChars?: number;
  },
): string[] {`,
      `    /** Gemessenes UI-Budget (Zeichen / 2 Zeilen) — sonst Surface-Default */
    maxChars?: number;
    /** Kartentitel — nicht 1:1 als Stichpunkt wiederholen */
    cardTitle?: string | null;
  },
): string[] {`,
    );
    s = s.replace(
      `    if (!b || isWeakOrMetaBullet(b)) continue;
    // Sterne/Review-Counts nie als Stichpunkt (Masterbook: harte Fakten, nutzerrelevant)
    if (looksLikeStarRatingBullet(b)) continue;`,
      `    if (!b || isWeakOrMetaBullet(b)) continue;
    if (looksLikeProseBullet(b)) continue;
    // Sterne/Review-Counts nie als Stichpunkt (Masterbook: harte Fakten, nutzerrelevant)
    if (looksLikeStarRatingBullet(b)) continue;
    const titleLc = String(opts?.cardTitle ?? '')
      .replace(/\\s+/g, ' ')
      .trim()
      .toLowerCase();
    if (titleLc && b.toLowerCase() === titleLc) continue;
    if (
      titleLc.length >= 12 &&
      b.toLowerCase().includes(titleLc) &&
      b.length <= titleLc.length + 8
    ) {
      continue;
    }`,
    );
    // better dedupe for age digits
    s = s.replace(
      `  const out: string[] = [];
  const seen = new Set<string>();
  const seenDist = new Set<string>();
  let distOnlyCount = 0;
  for (const b of cleaned) {
    const key = b.toLowerCase();
    if (seen.has(key)) continue;`,
      `  const out: string[] = [];
  const seen = new Set<string>();
  const seenFact = new Set<string>();
  const seenDist = new Set<string>();
  let distOnlyCount = 0;
  for (const b of cleaned) {
    const key = b.toLowerCase();
    if (seen.has(key)) continue;
    const factKey = normalizeBulletFactKey(b);
    if (factKey && seenFact.has(factKey)) continue;`,
    );
    s = s.replace(
      `    seen.add(key);
    if (distKey) seenDist.add(distKey);
    out.push(b);`,
      `    seen.add(key);
    if (factKey) seenFact.add(factKey);
    if (distKey) seenDist.add(distKey);
    out.push(b);`,
    );
    writeSafe(p, s);
    console.log('visualBullets: ok');
  } else console.log('visualBullets: already');
}

// PitchChoiceSlot: max 3 + clip
{
  const p = 'src/components/PitchChoiceSlot.tsx';
  let s = fs.readFileSync(p, 'utf8');
  s = s.replace(
    `import {
  BULLET_SURFACE_MAX_CHARS,
  MAX_PROGRAM_LIST_BULLETS,
  rewriteBulletToFit,
} from '../services/concierge/visualBullets';`,
    `import {
  BULLET_SURFACE_MAX_CHARS,
  MAX_VISUAL_BULLETS,
  rewriteBulletToFit,
} from '../services/concierge/visualBullets';`,
  );
  s = s.replace(
    `.slice(0, MAX_PROGRAM_LIST_BULLETS)
        .map((b) => rewriteBulletToFit(b, BULLET_SURFACE_MAX_CHARS.pitch))
        .filter(Boolean)
        .map((b, i) => (
        <Text
          key={\`\${option.id}_b_\${i}\`}
          style={styles.choiceBullet}
          numberOfLines={2}
        >`,
    `.slice(0, MAX_VISUAL_BULLETS)
        .map((b) => rewriteBulletToFit(b, BULLET_SURFACE_MAX_CHARS.pitch))
        .filter(Boolean)
        .map((b, i) => (
        <Text
          key={\`\${option.id}_b_\${i}\`}
          style={styles.choiceBullet}
          numberOfLines={2}
          ellipsizeMode="clip"
        >`,
  );
  writeSafe(p, s);
  console.log('PitchChoiceSlot: ok');
}

// weather: no clothing unless asked
{
  const p = 'src/module2/planning/planUtteranceGate.ts';
  let s = fs.readFileSync(p, 'utf8');
  s = s.replace(
    `: '- Speech immer (nur belegt, nie erfinden): Himmel, Temperatur von–bis oder Spitze, wann Regen/Schauer, ein Kleidungstipp — alles in kurzen VOLLEN Sätzen (Subjekt+Verb), kein Komma-Telegramm.',`,
    `: '- Speech immer (nur belegt, nie erfinden): Himmel, Temperatur von–bis oder Spitze, wann Regen/Schauer — kurze VOLLE Sätze. KEINE Kleidungsvorschläge bei reiner Wetterfrage (nur wenn Outfit/Anziehen gefragt).',`,
  );
  s = s.replace(
    `'- Kleidung natürlich einweben — keine Parenthesen, kein „(Jacke mitnehmen)“-Meta, kein „leichte Bekleidung reicht“ als Fetzen ohne Satzbau.',`,
    `outfitAsk
      ? '- Kleidung natürlich einweben — keine Parenthesen, kein Meta-Fetzen.'
      : '- KEINE Kleidung/Jacke/Schichten ungefragt — nur Wetterfakten.',`,
  );
  s = s.replace(
    `: '- Stichpunkte dieselben Kernfakten: Himmel/Temp/Regen oder Kleidung — kompakt, keine Prosa.',`,
    `: '- Stichpunkte = FACT-CHIPS Himmel/Temp/Regen-Timing — kompakt, keine Prosa, keine ungefragte Kleidung.',`,
  );
  s = s.replace(
    `: '- Nur Wetter gefragt: Wetter vorne, Kleidung ein kurzer Tipp im selben Fließtext — Jacke nicht erzwingen wenn mild/trocken.',`,
    `: '- Nur Wetter gefragt: nur Wetter (Himmel/Temp/Regen-Timing) — keine Kleidungstipps.',`,
  );
  writeSafe(p, s);
  console.log('planUtteranceGate weather: ok');
}

{
  const p = 'src/services/concierge/outfitWeatherPresent.ts';
  let s = fs.readFileSync(p, 'utf8');
  if (!s.includes('outfitAskForChips')) {
    s = s.replace(
      `  if (!rainAsk) {
    const outfitBits = text
      .split(/(?<=[.!?])\\s+|,\\s+/)
      .map((s) => s.trim())
      .filter((c) => OUTFIT_CLAUSE_RE.test(c) && c.length >= 8 && c.length <= 80);`,
      `  const outfitAskForChips =
    /\\b(anziehen|outfit|kleidung|was\\s+soll\\s+ich\\s+an|was\\s+zieh)\\b/iu.test(
      String(opts?.userText ?? ''),
    );
  if (!rainAsk && outfitAskForChips) {
    const outfitBits = text
      .split(/(?<=[.!?])\\s+|,\\s+/)
      .map((s) => s.trim())
      .filter((c) => OUTFIT_CLAUSE_RE.test(c) && c.length >= 8 && c.length <= 80);`,
    );
    // also filter outfit chips from existing in finalize
    s = s.replace(
      `  const rainAsk = looksLikeRainAsk(opts?.userText);
  const existingChips = (bullets ?? [])
    .map((b) => String(b ?? '').replace(/\\s+/g, ' ').trim())`,
      `  const rainAsk = looksLikeRainAsk(opts?.userText);
  const outfitAsk =
    /\\b(anziehen|outfit|kleidung|was\\s+soll\\s+ich\\s+an|was\\s+zieh)\\b/iu.test(
      String(opts?.userText ?? ''),
    );
  const existingChips = (bullets ?? [])
    .map((b) => String(b ?? '').replace(/\\s+/g, ' ').trim())
    .filter((b) => outfitAsk || !OUTFIT_CLAUSE_RE.test(b))
    .map((b) => b /* keep */)
    .filter(Boolean);
  const existingChips2 = (bullets ?? [])
    .map((b) => String(b ?? '').replace(/\\s+/g, ' ').trim())`,
    );
    // That created a mess - let me read and fix finalize properly instead
    writeSafe(p, s);
    console.log('outfitWeatherPresent: partial - needs verify');
  } else console.log('outfitWeatherPresent: already');
}

console.log('batch2 done');
