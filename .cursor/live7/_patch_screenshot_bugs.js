const fs = require('fs');
const path = require('path');

function read(p) {
  return fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
}
function write(p, s) {
  const abs = path.resolve(p);
  const tmp = abs + '.tmpwrite';
  fs.writeFileSync(tmp, s, 'utf8');
  fs.renameSync(tmp, abs);
}

// 1) hardMatchVerify: no mid-word … snips as bullets
{
  const p = 'src/module2/pitch/hardMatchVerify.ts';
  let s = read(p);
  const old = `        const idx = low.indexOf(hit);
        let snip = r.slice(Math.max(0, idx - 24), Math.min(r.length, idx + 72)).trim();
        if (idx > 24) snip = \`…\${snip}\`;
        if (idx + 72 < r.length) snip = \`\${snip}…\`;
        const label = praise
          ? snip.length > 12
            ? snip
            : \`\${w.text}: gelobt in Reviews\`
          : snip.length > 12
            ? snip
            : \`\${w.text} in Reviews\`;
        if (!dishEvidence.some((e) => e.toLowerCase().includes(hit))) {
          dishEvidence.push(label.slice(0, 96));
        }`;
  const neu = `        // Nie mittendrin mit „…“ anschneiden — Chip bleibt lesbar (max ~2 Zeilen).
        const label = praise
          ? \`\${w.text}: gelobt\`
          : \`\${w.text} in Reviews\`;
        if (!dishEvidence.some((e) => e.toLowerCase().includes(hit))) {
          dishEvidence.push(label.slice(0, 48));
        }`;
  if (!s.includes(old)) {
    // try looser
    if (s.includes('if (idx > 24) snip = `…${snip}`')) {
      s = s.replace(
        /const idx = low\.indexOf\(hit\);[\s\S]*?dishEvidence\.push\(label\.slice\(0, 96\)\);/,
        `// Nie mittendrin mit „…“ anschneiden — Chip bleibt lesbar.
        const label = praise
          ? \`\${w.text}: gelobt\`
          : \`\${w.text} in Reviews\`;
        if (!dishEvidence.some((e) => e.toLowerCase().includes(hit))) {
          dishEvidence.push(label.slice(0, 48));
        }`,
      );
      write(p, s);
      console.log('hardMatchVerify: ok (regex)');
    } else console.log('hardMatchVerify: pattern missing');
  } else {
    write(p, s.replace(old, neu));
    console.log('hardMatchVerify: ok');
  }
}

// 2) call2Tail: kill ellipsis path for good
{
  const p = 'src/module2/reboot/pipeline/call2Tail.ts';
  let s = read(p);
  const bad = `  return clampVisualBullets(primary, {
    speechText: opts.speechText,
    allowAddress: Boolean(opts.allowAddress),
    surface: 'default',
  }).slice(0, 3).map((b) =>
    b.length > opts.bulletMaxChars ? b.slice(0, opts.bulletMaxChars - 1) + '…' : b,
  );`;
  const good = `  return clampVisualBullets(primary, {
    speechText: opts.speechText,
    allowAddress: Boolean(opts.allowAddress),
    surface: 'default',
    maxChars: opts.bulletMaxChars,
    maxCount: 3,
  })
    .map((b) => rewriteBulletToFit(b, opts.bulletMaxChars))
    .filter(Boolean)
    .slice(0, 3);`;
  if (s.includes(bad)) {
    if (!s.includes('rewriteBulletToFit')) {
      s = s.replace(
        `import { clampVisualBullets } from '../../../services/concierge/visualBullets';`,
        `import {\n  clampVisualBullets,\n  rewriteBulletToFit,\n} from '../../../services/concierge/visualBullets';`,
      );
    }
    write(p, s.replace(bad, good));
    console.log('call2Tail: fixed ellipsis');
  } else if (s.includes("b.slice(0, opts.bulletMaxChars - 1) + '…'")) {
    write(
      p,
      s.replace(
        /return clampVisualBullets\(primary, \{[\s\S]*?\}\)\.slice\(0, 3\)\.map\(\(b\) =>\s*b\.length > opts\.bulletMaxChars \? b\.slice\(0, opts\.bulletMaxChars - 1\) \+ '…' : b,\s*\);/,
        good,
      ),
    );
    console.log('call2Tail: fixed ellipsis regex');
  } else console.log('call2Tail: already clean?', !s.includes("'…'"));
}

// 3) visualBullets: strip leading … / incomplete paren; reject mid-snip
{
  const p = 'src/services/concierge/visualBullets.ts';
  let s = read(p);
  if (!s.includes('stripLeadingEllipsisSnippet')) {
    const helper = `
/** Review-Snips die mit „…wort“ starten — unleserlich, droppen oder säubern. */
export function stripLeadingEllipsisSnippet(raw: string): string {
  let b = String(raw ?? '').replace(/\\s+/g, ' ').trim();
  if (!b) return '';
  // führende Ellipse + Wortrest → ab erstem Großbuchstaben/Wortanfang
  if (/^(?:\\u2026|\\.\\.\\.)/.test(b)) {
    b = b.replace(/^(?:\\u2026|\\.\\.\\.)+\\s*/u, '');
    // mittendrin angefangenes Wort (z. B. „n, Giant“) → bis Interpunktion/Wortgrenze
    if (/^[a-zäöüß]{1,3}[,:;]/u.test(b)) {
      b = b.replace(/^[a-zäöüß]{1,3}[,:;]\\s*/u, '');
    }
  }
  b = b.replace(/(?:\\u2026|\\.\\.\\.)$/u, '').trim();
  // unvollständige Klammer am Ende: „(164“ → ohne Klammerteil
  b = b.replace(/\\s*\\([^)]*$/u, '').trim();
  b = b.replace(/\\s*\\([^)]{0,12}$/u, '').trim();
  return b;
}

`;
    s = s.replace(
      'export function looksLikeProseBullet',
      helper + 'export function looksLikeProseBullet',
    );
    s = s.replace(
      `    let b = String(raw ?? '')
      .replace(/[\\r\\n]+/g, ' ')
      .replace(/\\s+/g, ' ')
      .replace(/^[\\s•\\-–—*]+/u, '')
      .replace(/\\s*(\\.\\.\\.|…)\\s*$/u, '')
      .trim();
    if (!b || isWeakOrMetaBullet(b)) continue;
    if (looksLikeProseBullet(b)) continue;`,
      `    let b = stripLeadingEllipsisSnippet(
      String(raw ?? '')
        .replace(/[\\r\\n]+/g, ' ')
        .replace(/\\s+/g, ' ')
        .replace(/^[\\s•\\-–—*]+/u, '')
        .trim(),
    );
    if (!b || isWeakOrMetaBullet(b)) continue;
    if (/^(?:\\u2026|\\.\\.\\.)/.test(String(raw ?? '').trim())) {
      // Roh-Snip mit führender Ellipse war Review-Müll — nach Clean trotzdem prüfen
      if (b.length < 8 || looksLikeProseBullet(b)) continue;
    }
    if (looksLikeProseBullet(b)) continue;`,
    );
    // also harden rewriteBulletToFit for open paren
    s = s.replace(
      `.replace(/\\s*(\\.\\.\\.|…)\\s*$/u, '')
    // Deutsche Tausender:`,
      `.replace(/\\s*(\\.\\.\\.|…)\\s*$/u, '')
    .replace(/^(?:\\u2026|\\.\\.\\.)+\\s*/u, '')
    .replace(/\\s*\\([^)]*$/u, '')
    // Deutsche Tausender:`,
    );
    write(p, s);
    console.log('visualBullets: ellipsis/paren harden');
  } else console.log('visualBullets: already');
}

// 4) HomeMapPlacePopup: max 3 total (pack + live)
{
  const p = 'src/components/homeMap/HomeMapPlacePopup.tsx';
  let s = read(p);
  s = s.replace('return merged.slice(0, 4);', 'return merged.slice(0, 3);');
  // when rendering, live bullets should not push past 3
  if (!s.includes('bulletsShown')) {
    s = s.replace(
      '  const bullets = (place.bullets ?? []).slice(0, 3);',
      `  const packBullets = (place.bullets ?? []).slice(0, 3);
  const liveRoom = Math.max(0, 3 - packBullets.length);
  const liveShown = liveBullets.slice(0, liveRoom);
  const bullets = packBullets;`,
    );
    s = s.replace(
      '{liveBullets.map((b, i) => (',
      '{liveShown.map((b, i) => (',
    );
  }
  write(p, s);
  console.log('HomeMapPlacePopup: max 3');
}

// 5) PlanCalendarModal: conflict banner + subtitle chips
{
  const p = 'src/components/PlanCalendarModal.tsx';
  let s = read(p);
  s = s.replace(
    `{conflictCount + openConflictCount > 0
                ? \`\${conflictCount + openConflictCount} Zeitkonflikt\${
                    conflictCount + openConflictCount === 1 ? '' : 'e'
                  }\`
                : 'Zeitkonflikt'}{' '}
              — nach Regeln lösen (6 frei, 5 fragen, 4 nur schieben, 3 fragen,
              1–2 heilig).`,
    `{conflictCount + openConflictCount > 1
                ? \`\${conflictCount + openConflictCount} Zeitkonflikte\`
                : 'Zeitkonflikt'}{' '}
              — Termine überlappen. Tippe „Konflikt lösen“ oder schiebe einen Punkt.`,
  );
  // cardSub: never show review prose with …
  if (!s.includes('sanitizePlanSubtitle')) {
    s = s.replace(
      `import { hasTimeOverlap } from '../module2/planning/planConflictResolve';`,
      `import { hasTimeOverlap } from '../module2/planning/planConflictResolve';
function sanitizePlanSubtitle(raw: string | null | undefined): string {
  let t = String(raw ?? '').replace(/\\s+/g, ' ').trim();
  if (!t) return '';
  if (/^(?:\\u2026|\\.\\.\\.)/.test(t) || /(?:\\u2026|\\.\\.\\.)$/.test(t)) {
    t = t.replace(/^(?:\\u2026|\\.\\.\\.)+\\s*/u, '').replace(/(?:\\u2026|\\.\\.\\.)+$/u, '').trim();
    if (/^[a-zäöüß]{1,3}[,:;]/u.test(t)) t = t.replace(/^[a-zäöüß]{1,3}[,:;]\\s*/u, '');
  }
  // Review-Prosa → max eine kurze Zeile, sonst leer (Accordion zeigt Fakten)
  if (t.length > 90 || /\\b(wir|wurde|sahsen|saßen|extrawünsche)\\b/iu.test(t)) {
    return '';
  }
  return t;
}
`,
    );
    s = s.replace(
      `<Text style={styles.cardSub} numberOfLines={2}>
                        {node.subtitle}
                      </Text>`,
      `<Text style={styles.cardSub} numberOfLines={2}>
                        {sanitizePlanSubtitle(node.subtitle)}
                      </Text>`,
    );
  }
  write(p, s);
  console.log('PlanCalendarModal: conflict+subtitle');
}

// 6) planTimeOverlap: transit chain without groupId still soft-group by adjacency
{
  const p = 'src/module2/planning/planTimeOverlap.ts';
  let s = read(p);
  if (!s.includes('looksLikeTransitChain')) {
    s = s.replace(
      `function samePlanGroup(a: FuturePlanStop, b: FuturePlanStop): boolean {
  const g = a.groupId?.trim();
  return Boolean(g) && g === b.groupId;
}`,
      `function samePlanGroup(a: FuturePlanStop, b: FuturePlanStop): boolean {
  const g = a.groupId?.trim();
  if (g && g === b.groupId) return true;
  // ÖPNV-Akkordeon ohne groupId: aufeinanderfolgende Transit-Legs zählen als eine Fahrt
  const aTransit =
    a.transport === 'transit' ||
    /^\\d+\\s*·/.test(a.title) ||
    /\\b(RB|RE|S|U|Bus|Bahn)\\b/i.test(a.title);
  const bTransit =
    b.transport === 'transit' ||
    /^\\d+\\s*·/.test(b.title) ||
    /\\b(RB|RE|S|U|Bus|Bahn)\\b/i.test(b.title);
  if (aTransit && bTransit) return true;
  return false;
}`,
    );
    write(p, s);
    console.log('planTimeOverlap: transit chain');
  } else console.log('planTimeOverlap: already');
}

console.log('screenshot fixes done');
