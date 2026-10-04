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

// --- planTimeOverlap: short default for transit points; adjacent transit only ---
{
  const p = 'src/module2/planning/planTimeOverlap.ts';
  write(
    p,
    `/**
 * Zeit-Überlappung in der Timeline. Kein RN.
 * Gleicher groupId (ÖPNV-Akkordeon, Flug) zählt nicht als Konflikt.
 */

import type { FuturePlanStop } from '../timeline/futurePlanState';

function isTransitLike(s: FuturePlanStop): boolean {
  if (s.transport === 'transit') return true;
  if (s.groupId === 'live_journey') return true;
  if (/^live_journey_/i.test(s.id) || /^live_nav_/i.test(s.id)) return true;
  if (/^\\d+\\s*·/.test(s.title)) return true;
  if (/\\b(RB|RE|S|U|Bus|Bahn|zu Fuß|END)\\b/i.test(s.title)) return true;
  return false;
}

/** Punkt-Stops (Umstieg/END) ohne Endzeit: nicht 45 Min blocken — sonst Fake-Konflikt mit Dinner. */
function intervalEndMs(s: FuturePlanStop): number {
  const a0 = s.plannedStartMs!;
  if (s.plannedEndMs != null && s.plannedEndMs > a0) return s.plannedEndMs;
  if (isTransitLike(s)) return a0 + 2 * 60_000;
  if (s.kind === 'nav_leg') return a0 + 5 * 60_000;
  return a0 + 45 * 60_000;
}

function intervalsOverlap(a: FuturePlanStop, b: FuturePlanStop): boolean {
  const a0 = a.plannedStartMs;
  const b0 = b.plannedStartMs;
  if (a0 == null || b0 == null) return false;
  const a1 = intervalEndMs(a);
  const b1 = intervalEndMs(b);
  return a0 < b1 && b0 < a1;
}

function isCalendarConflictCandidate(s: FuturePlanStop): boolean {
  if (s.kind === 'wish' || s.kind === 'nav_leg') return false;
  if (s.id.startsWith('choice_')) return false;
  if (s.plannedStartMs == null) return false;
  return true;
}

function samePlanGroup(a: FuturePlanStop, b: FuturePlanStop): boolean {
  const g = a.groupId?.trim();
  if (g && g === b.groupId) return true;
  // ÖPNV-Akkordeon ohne groupId: nur Kette (Überlapp oder ≤20 Min Lücke), nicht jede Bahn am Tag
  if (isTransitLike(a) && isTransitLike(b)) {
    const a0 = a.plannedStartMs!;
    const b0 = b.plannedStartMs!;
    const a1 = intervalEndMs(a);
    const b1 = intervalEndMs(b);
    if (a0 < b1 && b0 < a1) return true;
    const gap = Math.min(Math.abs(a1 - b0), Math.abs(b1 - a0));
    if (gap <= 20 * 60_000) return true;
  }
  return false;
}

export function planStopsOverlap(stops: FuturePlanStop[]): boolean {
  const timed = stops.filter(isCalendarConflictCandidate);
  for (let i = 0; i < timed.length; i++) {
    for (let j = i + 1; j < timed.length; j++) {
      const a = timed[i]!;
      const b = timed[j]!;
      if (samePlanGroup(a, b)) continue;
      if (intervalsOverlap(a, b)) return true;
    }
  }
  return false;
}

export function findPlanOverlapPair(
  stops: FuturePlanStop[],
): [FuturePlanStop, FuturePlanStop] | null {
  const timed = stops.filter(isCalendarConflictCandidate);
  for (let i = 0; i < timed.length; i++) {
    for (let j = i + 1; j < timed.length; j++) {
      const a = timed[i]!;
      const b = timed[j]!;
      if (samePlanGroup(a, b)) continue;
      if (intervalsOverlap(a, b)) return [a, b];
    }
  }
  return null;
}
`,
  );
  console.log('planTimeOverlap: rewritten');
}

// --- HomeMapPlacePopup: live-first for stations + fit bullets ---
{
  const p = 'src/components/homeMap/HomeMapPlacePopup.tsx';
  let s = read(p);
  if (!s.includes('rewriteBulletToFit')) {
    s = s.replace(
      `import { colors, spacing } from '../../constants/theme';`,
      `import { colors, spacing } from '../../constants/theme';\nimport {\n  rewriteBulletToFit,\n  stripLeadingEllipsisSnippet,\n  BULLET_SURFACE_MAX_CHARS,\n} from '../../services/concierge/visualBullets';`,
    );
  }
  const oldBlock = `  const packBullets = (place.bullets ?? []).slice(0, 3);
  const liveRoom = Math.max(0, 3 - packBullets.length);
  const liveShown = liveBullets.slice(0, liveRoom);
  const bullets = packBullets;`;
  const newBlock = `  const isTransitPlace = /\\b(bahnhof|haltepunkt|haltestelle|s-bahn|u-bahn|zug|öpnv|abfahrt)\\b/iu.test(
    \`\${place.name} \${place.category}\`,
  );
  const packRaw = (place.bullets ?? [])
    .map((b) =>
      rewriteBulletToFit(
        stripLeadingEllipsisSnippet(b),
        BULLET_SURFACE_MAX_CHARS.default,
      ),
    )
    .filter(Boolean);
  const liveRaw = liveBullets
    .map((b) =>
      rewriteBulletToFit(
        stripLeadingEllipsisSnippet(b),
        BULLET_SURFACE_MAX_CHARS.default,
      ),
    )
    .filter(Boolean);
  // Bahnhof: Live-Abfahrten vor Historie — gesamt max 3, nie abschneiden
  let bullets: string[];
  let liveShown: string[];
  if (isTransitPlace && liveRaw.length) {
    liveShown = liveRaw.slice(0, 3);
    bullets = packRaw.slice(0, Math.max(0, 3 - liveShown.length));
  } else {
    bullets = packRaw.slice(0, 3);
    liveShown = liveRaw.slice(0, Math.max(0, 3 - bullets.length));
  }`;
  if (s.includes(oldBlock)) {
    write(p, s.replace(oldBlock, newBlock));
    console.log('HomeMapPlacePopup: live-first');
  } else {
    console.log('HomeMapPlacePopup: block missing');
  }
}

// --- visualBullets: compact area + incomplete paren detect ---
{
  const p = 'src/services/concierge/visualBullets.ts';
  let s = read(p);
  if (!s.includes('compactAreaBullet')) {
    s = s.replace(
      'export function rewriteBulletToFit(raw: string, maxChars: number): string {',
      `/** Fläche: lieber „164 ha“ als abgeschnittene m²-Klammer. */
function compactAreaBullet(raw: string): string {
  let b = String(raw ?? '').replace(/\\s+/g, ' ').trim();
  if (!b) return '';
  const ha = b.match(/^(.{2,40}?):\\s*.*?\\b(\\d+[.,]?\\d*)\\s*ha\\b/iu);
  if (ha) return \`\${ha[1]!.trim()} · \${ha[2]} ha\`;
  const qm = b.match(
    /^(.{2,40}?):\\s*(?:rund|ca\\.?|etwa)?\\s*([\\d.]+)\\s*Quadratmeter\\b/iu,
  );
  if (qm) {
    const n = Number(String(qm[2]).replace(/\\./g, ''));
    if (Number.isFinite(n) && n >= 10_000) {
      const haN = Math.round(n / 10_000);
      return \`\${qm[1]!.trim()} · \${haN} ha\`;
    }
  }
  return b;
}

export function rewriteBulletToFit(raw: string, maxChars: number): string {`,
    );
    s = s.replace(
      `  let b = String(raw ?? '')
    .replace(/[\\r\\n]+/g, ' ')
    .replace(/\\s+/g, ' ')
    .replace(/^[\\s•\\-–—*]+/u, '')
    .replace(/\\s*(\\.\\.\\.|…)\\s*$/u, '')
    .replace(/^(?:\\u2026|\\.\\.\\.)+\\s*/u, '')
    .replace(/\\s*\\([^)]*$/u, '')`,
      `  let b = compactAreaBullet(
    String(raw ?? '')
      .replace(/[\\r\\n]+/g, ' ')
      .replace(/\\s+/g, ' ')
      .replace(/^[\\s•\\-–—*]+/u, '')
      .replace(/\\s*(\\.\\.\\.|…)\\s*$/u, '')
      .replace(/^(?:\\u2026|\\.\\.\\.)+\\s*/u, '')
      .replace(/\\s*\\([^)]*$/u, ''),
  )`,
    );
    write(p, s);
    console.log('visualBullets: compactArea');
  } else console.log('visualBullets: compact already');
}

// --- pitchSpeech: filter ellipsis/prose evidence ---
{
  const p = 'src/module2/pitch/pitchSpeech.ts';
  let s = read(p);
  if (!s.includes('stripLeadingEllipsisSnippet')) {
    s = s.replace(
      /^/,
      `import {\n  looksLikeProseBullet,\n  stripLeadingEllipsisSnippet,\n} from '../../services/concierge/visualBullets';\n`,
    );
    s = s.replace(
      `  const uniqueHooks = (c.hookNotes ?? [])
    .map((n) => String(n).trim())
    .filter((n) => n.length >= 8 && n.length <= 72)
    .filter((n) => !/cuisine\\s*:/i.test(n));`,
      `  const uniqueHooks = (c.hookNotes ?? [])
    .map((n) => stripLeadingEllipsisSnippet(String(n).trim()))
    .filter((n) => n.length >= 8 && n.length <= 72)
    .filter((n) => !/cuisine\\s*:/i.test(n))
    .filter((n) => !looksLikeProseBullet(n));`,
    );
    s = s.replace(
      `  const evidenceClean = (c.hardEvidence ?? [])
    .map((e) => String(e).trim())
    .filter((e) => e.length >= 4)`,
      `  const evidenceClean = (c.hardEvidence ?? [])
    .map((e) => stripLeadingEllipsisSnippet(String(e).trim()))
    .filter((e) => e.length >= 4)
    .filter((e) => !looksLikeProseBullet(e))
    .filter((e) => !/^(?:\\u2026|\\.\\.\\.)/.test(e))`,
    );
    // LLM path forced bits
    s = s.replace(
      `        const evidenceBits = (c.hardEvidence ?? [])
          .map((x) => String(x).trim())
          .filter((x) => x.length >= 4)
          .filter((x) => !/^cuisine\\s*:/i.test(x))
          .filter((x) => !/^(steak|angus|pizza|sushi|burger)$/i.test(x))
          .slice(0, 2);
        const hookBits = (c.hookNotes ?? [])
          .map((x) => String(x).trim())
          .filter((x) => x.length >= 8 && x.length <= 72)
          .slice(0, 2);`,
      `        const evidenceBits = (c.hardEvidence ?? [])
          .map((x) => stripLeadingEllipsisSnippet(String(x).trim()))
          .filter((x) => x.length >= 4)
          .filter((x) => !looksLikeProseBullet(x))
          .filter((x) => !/^cuisine\\s*:/i.test(x))
          .filter((x) => !/^(steak|angus|pizza|sushi|burger)$/i.test(x))
          .slice(0, 2);
        const hookBits = (c.hookNotes ?? [])
          .map((x) => stripLeadingEllipsisSnippet(String(x).trim()))
          .filter((x) => x.length >= 8 && x.length <= 72)
          .filter((x) => !looksLikeProseBullet(x))
          .slice(0, 2);`,
    );
    write(p, s);
    console.log('pitchSpeech: filter');
  } else console.log('pitchSpeech: already');
}

// --- smoke extras ---
{
  const p = 'src/services/concierge/visualBullets.smoke.test.ts';
  let s = read(p);
  if (!s.includes('stripLeadingEllipsisSnippet')) {
    s = s.replace(
      `  rewriteBulletToFit,
} from './visualBullets';`,
      `  rewriteBulletToFit,
  stripLeadingEllipsisSnippet,
} from './visualBullets';`,
    );
    s += `
{
  const cleaned = stripLeadingEllipsisSnippet('…n, Giant Burger und Hüftsteak. Wir sahsen …');
  assert(!/^(?:\\u2026|\\.\\.\\.)/.test(cleaned), 'leading ellipsis gone');
  assert(!/^n,/i.test(cleaned), 'mid-word crumb gone');
  const area = rewriteBulletToFit(
    'Außenalster: rund 1.640.000 Quadratmeter (164 ha)',
    48,
  );
  assert(/ha/i.test(area), \`area compact: \${area}\`);
  assert(!/\\(164\\s*$/i.test(area), 'no open paren cut');
  assert(!/…|\\.\\.\\./.test(area), 'no ellipsis on area');
}
console.log('visualBullets screenshot extras: OK');
`;
    write(p, s);
    console.log('smoke: extras');
  }
}

{
  const p = 'src/module2/planning/planConflictResolve.smoke.test.ts';
  let s = read(p);
  if (!s.includes('END ohne Endzeit')) {
    s += `
{
  // END-Punkt 18:46 ohne plannedEndMs darf Dinner 19:00 nicht als Konflikt zählen
  const end = {
    id: 'live_journey_l5',
    title: '5 · END',
    kind: 'stop',
    transport: 'transit',
    groupId: 'live_journey',
    plannedStartMs: Date.parse('2026-09-11T18:46:00+02:00'),
    plannedEndMs: null,
  };
  const dinner = {
    id: 'rio',
    title: 'Rio Grande',
    kind: 'stop',
    plannedStartMs: Date.parse('2026-09-11T19:00:00+02:00'),
    plannedEndMs: Date.parse('2026-09-11T20:15:00+02:00'),
  };
  assert(
    !planStopsOverlap([end as any, dinner as any]),
    'END + Dinner 14 Min Lücke ist kein Zeitkonflikt',
  );
}
console.log('planConflict END-gap: OK');
`;
    write(p, s);
    console.log('conflict smoke: END gap');
  }
}

// bump version 2.0.74 / 101
{
  for (const file of ['package.json', 'app.json']) {
    let s = read(file);
    s = s.replace(/"version": "2\\.0\\.73"/, '"version": "2.0.74"');
    write(file, s);
  }
  let gradle = read('android/app/build.gradle');
  gradle = gradle
    .replace(/versionCode 100/, 'versionCode 101')
    .replace(/versionName "2\\.0\\.73"/, 'versionName "2.0.74"');
  write('android/app/build.gradle', gradle);
  const notes = `releases/2.0.74/whatsnew-de-DE-v101.txt`;
  fs.mkdirSync(path.dirname(notes), { recursive: true });
  fs.writeFileSync(
    notes,
    `Stichpunkte nie mittendrin abschneiden · Pitch ohne Review-„…“ · Bahnhof max. 3 Fakten (Live zuerst) · Timeline: kein Fake-Zeitkonflikt nach ÖPNV · klareres Konflikt-Banner
`,
    'utf8',
  );
  console.log('version 2.0.74');
}

console.log('remain fixes done');
