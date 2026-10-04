import fs from 'node:fs';

const p = 'scripts/cityPack/polishMapBullets.mjs';
let s = fs.readFileSync(p, 'utf8');

const newHook = `function categoryHook(spot) {
  const name = String(spot.name || '').trim();
  const cat = String(spot.category || '').toLowerCase();
  const tags = (spot.tags || []).map((t) => String(t).toLowerCase()).join(' ');
  const blob = \`\${name} \${cat} \${tags}\`;
  if (!name) return null;
  const short = name.split(/[–—|]/)[0].trim().slice(0, 48);
  if (/hotel/.test(cat) || /hotel|gasthof|pension/i.test(name)) {
    return [\`\${short} — Übernachtung vor Ort\`];
  }
  if (
    /restaurant|cafe|café|bakerei|imbiss|bar|kneipe|gastro/i.test(cat) ||
    /café|cafe|bistro|restaurant|pizza|sushi|burger|bar\\\\b|pub\\\\b/i.test(name)
  ) {
    return [
      \`\${short} — Essen & Trinken\`,
      'Öffnungszeiten und Speisekarte über die Buttons',
    ];
  }
  if (/kirche|dom|kapelle/i.test(blob)) {
    return [\`\${short} — Kirche\`, 'Geschichte und Raum vor Ort'];
  }
  if (/museum|galerie/i.test(blob)) {
    return [\`\${short} — Museum\`, 'Ausstellung und Infos über die Buttons'];
  }
  if (/theater|kino|arena|halle/i.test(blob)) {
    return [\`\${short} — Veranstaltungsort\`, 'Programm über die Buttons'];
  }
  if (/schriftzug|foto|ahoi/i.test(blob)) {
    return ['Fotospot', 'Schönes Motiv — kurz stehen bleiben und schauen'];
  }
  if (/denkmal|ehrenmal|stolper/i.test(cat) || /denkmal|ehrenmal|stolper/i.test(name)) {
    return [\`\${short} — Gedenken vor Ort\`];
  }
  if (/hafen|bootshafen|förde|foerde/i.test(blob)) {
    return [\`\${short} — Hafen\`, 'Wasser, Schiffe und Spaziergang'];
  }
  if (/parkplatz|parking/i.test(cat) || /parkplatz|p\\\\+r/i.test(name)) {
    return [\`\${name} — Parken\`];
  }
  if (/spielplatz/i.test(cat) || /spielplatz/i.test(name)) {
    return [\`\${name} — Spielplatz für Kinder\`];
  }
  if (/toilette/i.test(cat) || /toilette|wc /i.test(name)) {
    return ['Öffentliche Toilette in der Nähe'];
  }
  if (/bahnhof|haltepunkt|haltestelle|hbf/i.test(blob)) {
    return [\`\${short} — ÖPNV\`, 'Live-Abfahrten über den Button'];
  }
  if (/tankstelle|fuel/i.test(blob)) {
    return [\`\${short} — Tankstelle\`, 'Tanken und Shop'];
  }
  if (/sport|tennis|kletter|schwimm/i.test(blob)) {
    return [\`\${short} — Sport & Freizeit\`, 'Aktivität vor Ort'];
  }
  if (/supermarket|supermarkt|drogerie|apotheke/i.test(blob)) {
    return [\`\${short} — Einkaufen\`, 'Alltag in der Nähe'];
  }
  return [\`\${short}\`, 'Route starten oder mehr über die Buttons'];
}

function asBulletList(next) {
  if (!next) return [];
  if (Array.isArray(next)) return next.filter(Boolean).slice(0, 3);
  return [String(next)];
}
`;

const start = s.indexOf('function categoryHook(spot)');
const end = s.indexOf('function pickFromFacts');
if (start < 0 || end < 0) throw new Error('hooks not found');
s = s.slice(0, start) + newHook + '\n' + s.slice(end);

const oldLoop = `  let changed = 0;
  for (const spot of pack.spots || []) {
    let next = OVERRIDES[spot.id] || null;
    if (!next && isJunkBullets(spot.bullets)) {
      next = pickFromFacts(spot, triggers.get(spot.id));
      if (!next || next.length === 0) {
        const hook = categoryHook(spot);
        next = hook ? [hook] : [];
      }
    }
    if (!next) continue;
    // Leere Liste = lieber Builder aus Fakten als Adress-Müll
    const prev = JSON.stringify(spot.bullets || []);
    const neu = JSON.stringify(next);
    if (prev === neu) continue;
    spot.bullets = next;
    changed += 1;
    console.log(\`POLISH \${spot.id}\\n  → \${next.join(' | ') || '(leer)'}\`);
  }`;

const newLoop = `  let changed = 0;
  for (const spot of pack.spots || []) {
    let next = OVERRIDES[spot.id] || null;
    if (!next && isJunkBullets(spot.bullets)) {
      next = pickFromFacts(spot, triggers.get(spot.id));
      if (!next || next.length === 0) next = asBulletList(categoryHook(spot));
    }
    if (!next || (Array.isArray(next) && next.length === 0)) {
      next = asBulletList(categoryHook(spot));
    }
    if (!next) continue;
    next = asBulletList(next);
    const prev = JSON.stringify(spot.bullets || []);
    const neu = JSON.stringify(next);
    if (prev === neu) continue;
    spot.bullets = next;
    changed += 1;
    console.log(\`POLISH \${spot.id}\\n  → \${next.join(' | ') || '(leer)'}\`);
  }`;

if (!s.includes(oldLoop)) {
  // try CRLF
  const oldCrlf = oldLoop.replace(/\n/g, '\r\n');
  const newCrlf = newLoop.replace(/\n/g, '\r\n');
  if (s.includes(oldCrlf)) s = s.replace(oldCrlf, newCrlf);
  else {
    console.error('loop not found');
    process.exit(1);
  }
} else {
  s = s.replace(oldLoop, newLoop);
}

fs.writeFileSync(p, s);
console.log('polish patched', s.includes('asBulletList'), s.includes('Fotospot'));
