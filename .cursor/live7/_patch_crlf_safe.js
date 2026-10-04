const fs = require('fs');
const path = require('path');

function read(p) {
  return fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
}
function write(p, s) {
  const abs = path.resolve(p);
  const tmp = abs + '.tmpwrite';
  // keep LF; RN/TS fine with LF on Windows
  fs.writeFileSync(tmp, s, 'utf8');
  fs.renameSync(tmp, abs);
}

{
  const p = 'src/services/concierge/visualBullets.ts';
  let s = read(p);
  if (!s.includes('looksLikeProseBullet(b)')) {
    if (!s.includes('cardTitle?: string | null')) {
      s = s.replace(
        '    maxChars?: number;\n  },\n): string[] {',
        '    maxChars?: number;\n    /** Kartentitel — nicht 1:1 als Stichpunkt wiederholen */\n    cardTitle?: string | null;\n  },\n): string[] {',
      );
    }
    s = s.replace(
      '    if (!b || isWeakOrMetaBullet(b)) continue;\n    // Sterne/Review-Counts nie als Stichpunkt (Masterbook: harte Fakten, nutzerrelevant)\n    if (looksLikeStarRatingBullet(b)) continue;',
      `    if (!b || isWeakOrMetaBullet(b)) continue;
    if (looksLikeProseBullet(b)) continue;
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
    }
    // Sterne/Review-Counts nie als Stichpunkt (Masterbook: harte Fakten, nutzerrelevant)
    if (looksLikeStarRatingBullet(b)) continue;`,
    );
    if (!s.includes('seenFact')) {
      s = s.replace(
        '  const out: string[] = [];\n  const seen = new Set<string>();\n  const seenDist = new Set<string>();\n  let distOnlyCount = 0;\n  for (const b of cleaned) {\n    const key = b.toLowerCase();\n    if (seen.has(key)) continue;',
        '  const out: string[] = [];\n  const seen = new Set<string>();\n  const seenFact = new Set<string>();\n  const seenDist = new Set<string>();\n  let distOnlyCount = 0;\n  for (const b of cleaned) {\n    const key = b.toLowerCase();\n    if (seen.has(key)) continue;\n    const factKey = normalizeBulletFactKey(b);\n    if (factKey && seenFact.has(factKey)) continue;',
      );
      s = s.replace(
        '    seen.add(key);\n    if (distKey) seenDist.add(distKey);\n    out.push(b);',
        '    seen.add(key);\n    if (factKey) seenFact.add(factKey);\n    if (distKey) seenDist.add(distKey);\n    out.push(b);',
      );
    }
    write(p, s);
    console.log('visualBullets:', s.includes('looksLikeProseBullet(b)'), s.includes('seenFact'));
  } else console.log('visualBullets already');
}

{
  const p = 'src/components/PitchChoiceSlot.tsx';
  let s = read(p);
  s = s.replace(/MAX_PROGRAM_LIST_BULLETS/g, 'MAX_VISUAL_BULLETS');
  if (!s.includes("ellipsizeMode=\"clip\"")) {
    s = s.replace(
      '          style={styles.choiceBullet}\n          numberOfLines={2}\n        >',
      '          style={styles.choiceBullet}\n          numberOfLines={2}\n          ellipsizeMode="clip"\n        >',
    );
  }
  write(p, s);
  console.log(
    'PitchChoiceSlot:',
    (s.match(/MAX_VISUAL_BULLETS/g) || []).length,
    s.includes('ellipsizeMode="clip"'),
    s.includes('MAX_PROGRAM_LIST_BULLETS'),
  );
}

{
  const p = 'src/services/concierge/outfitWeatherPresent.ts';
  let s = read(p);
  if (!s.includes('outfitAskForChips')) {
    s = s.replace(
      '  if (!rainAsk) {\n    const outfitBits = text',
      `  const outfitAskForChips =
    /\\b(anziehen|outfit|kleidung|was\\s+soll\\s+ich\\s+an|was\\s+zieh)\\b/iu.test(
      String(opts?.userText ?? ''),
    );
  if (!rainAsk && outfitAskForChips) {
    const outfitBits = text`,
    );
  }
  if (!s.includes('outfitAsk || !OUTFIT_CLAUSE_RE')) {
    s = s.replace(
      `  const existingChips = (bullets ?? [])
    .map((b) => String(b ?? '').replace(/\\s+/g, ' ').trim())
    .filter((b) => looksLikeFactChip(b));`,
      `  const outfitAsk =
    /\\b(anziehen|outfit|kleidung|was\\s+soll\\s+ich\\s+an|was\\s+zieh)\\b/iu.test(
      String(opts?.userText ?? ''),
    );
  const existingChips = (bullets ?? [])
    .map((b) => String(b ?? '').replace(/\\s+/g, ' ').trim())
    .filter((b) => looksLikeFactChip(b))
    .filter((b) => outfitAsk || !OUTFIT_CLAUSE_RE.test(b));`,
    );
  }
  write(p, s);
  console.log(
    'outfit:',
    s.includes('outfitAskForChips'),
    s.includes('outfitAsk || !OUTFIT_CLAUSE_RE'),
  );
}

console.log('crlf-safe done');
