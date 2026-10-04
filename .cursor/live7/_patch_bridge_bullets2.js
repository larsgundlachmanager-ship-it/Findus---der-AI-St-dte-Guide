const fs = require('fs');
const path = require('path');

function writeSafe(file, content) {
  const abs = path.resolve(file);
  const tmp = abs + '.tmpwrite';
  fs.writeFileSync(tmp, content, 'utf8');
  fs.renameSync(tmp, abs);
}

function patch(file, find, replace, label) {
  let s = fs.readFileSync(file, 'utf8');
  if (s.includes(replace.slice(0, Math.min(48, replace.length))) && !s.includes(find)) {
    console.log(label + ': already');
    return true;
  }
  if (!s.includes(find)) {
    console.log(label + ': FIND MISSING');
    return false;
  }
  writeSafe(file, s.split(find).join(replace));
  console.log(label + ': ok');
  return true;
}

patch(
  'src/module2/router/analyzeTurn.ts',
  '- bridge: Beat 1. DEFAULT = Verstanden + Zusagen (1–2 Sätze), keine Fakten spoilern. TRIVIA/RECHNUNG/Quick-Lookup: Antwort-EINLEITUNG nur (Person/Aufgabe ansteuern, halber Satz / Commit) — NIE Zahl, Alter, Name oder Einwohner als Fakt. Call-2 liefert den Wert. Kein „finde heraus“, keine Klärfrage bei Amtstiteln, keine leere Würdigung allein. Ja/Nein/„los“: null. Trivia nie null wenn es die Einleitung trägt, session=new.',
  '- bridge: Beat 1. DEFAULT = Verstanden + Zusagen MIT Bezug zur DIESEM Wunsch (1–2 Sätze) — Job nennen (AYCE/Steak/Rad-Route/Wetter/SUP/Reservierung/…), keine Venue-Namen/Preise/Minuten. VERBOTEN allein: 0815 („ich schau mal“, „gute Frage“, „wissen kommt gleich“, „genau das klären wir jetzt“, „ich hole nützliche Fakten“) ohne Wunsch-Anker. TRIVIA/RECHNUNG/Quick-Lookup: Antwort-EINLEITUNG nur (Person/Aufgabe ansteuern) — NIE Zahl/Alter/Name. Call-2 liefert den Wert. Kein „finde heraus“, keine Klärfrage bei Amtstiteln. Ja/Nein/„los“: null. Trivia nie null wenn es die Einleitung trägt, session=new.',
  'analyzeTurn live',
);

patch(
  'src/module2/router/analyzeTurn.ts',
  '- bridge: Beat 1. DEFAULT = Verstanden + Zusagen (Nav starten / Eventkalender / …). NICHT Call-2 spoilern. TRIVIA/RECHNUNG: nur Einleitung (kein Alter/keine Zahl/kein Name). Cover 2–3 Sätze nur bei langer Recherche. Trivia: keine Klärfrage bei Amtstiteln, kein Recherche-Theater. Bei continue/resume oft null. Kein Name. Wortlaut nie als Script.',
  '- bridge: Beat 1. DEFAULT = Verstanden + Zusagen MIT Bezug zum Wunsch (Nav/Event/Gastro/… Job nennen). NICHT Call-2 spoilern. VERBOTEN allein: leere 0815-Floskeln ohne Wunsch-Anker. TRIVIA/RECHNUNG: nur Einleitung (kein Alter/keine Zahl/kein Name). Cover 2–3 Sätze nur bei langer Recherche. Trivia: keine Klärfrage bei Amtstiteln, kein Recherche-Theater. Bei continue/resume oft null. Kein Name. Wortlaut nie als Script.',
  'analyzeTurn default',
);

patch(
  'src/services/persona/matrixSpeechStyle.ts',
  'Bridge-Stimme (Beat 1, 1–2 Sätze): Verstanden + Zusagen — mündlich, umgangssprachlich, keine Fakten/Orte/Preise. Ton:',
  'Bridge-Stimme (Beat 1, 1–2 Sätze): Verstanden + Zusagen MIT Bezug zum konkreten Wunsch (Job/Thema ansteuern) — mündlich, umgangssprachlich, keine Fakten/Orte/Preise. VERBOTEN allein: leere 0815-Floskeln ohne Wunsch-Anker. Ton:',
  'matrixSpeechStyle',
);

{
  const p = 'src/module2/router/call1Dispatch.ts';
  let s = fs.readFileSync(p, 'utf8');
  if (s.includes('Aktive Nav + Fahrrad/Fuß-Umschalten')) {
    console.log('call1Dispatch: already');
  } else {
    const needle = `export function finalizeCall1Execution(
  analysis: ManagerAnalysis,
  userText: string,
): Call1ExecutionBackend {
  // Taxi/Uber-Vorbestellung: nie Flight-Advisor / Leave-by.`;
    const insert = `export function finalizeCall1Execution(
  analysis: ManagerAnalysis,
  userText: string,
): Call1ExecutionBackend {
  // Aktive Nav + Fahrrad/Fuß-Umschalten: immer nav_execute (nie Pitch/Gastro).
  try {
    const {
      isActiveNavTravelModeSwitchIntent,
    } = require('../../services/navigation/switchActiveNavTravelMode') as {
      isActiveNavTravelModeSwitchIntent: (s: string) => 'foot' | 'bike' | null;
    };
    let navLive = false;
    try {
      const { useFinnusStore } = require('../../store/useFinnusStore') as {
        useFinnusStore: { getState: () => { navActive?: boolean } };
      };
      navLive = Boolean(useFinnusStore.getState().navActive);
    } catch {
      navLive = false;
    }
    if (navLive) {
      const mode = isActiveNavTravelModeSwitchIntent(userText);
      if (mode === 'foot' || mode === 'bike') {
        return 'nav_execute';
      }
    }
  } catch {
    /* soft */
  }
  // Tisch reservieren / sticky Venue-Task: kein neuer Pitch.
  try {
    const { isStickyVenueTaskIntent } = require('../pitch/shouldHandoffPitch') as {
      isStickyVenueTaskIntent: (s: string) => boolean;
    };
    if (
      isStickyVenueTaskIntent(userText) &&
      /\\b(reservier|tisch\\s+(?:anfrag|buch|vorbereiten|reserv)|speisekarte|menükarte|menuekarte)\\b/iu.test(
        userText,
      )
    ) {
      return 'chat_lane';
    }
  } catch {
    /* soft */
  }
  // Taxi/Uber-Vorbestellung: nie Flight-Advisor / Leave-by.`;
    if (!s.includes(needle)) throw new Error('call1Dispatch needle missing');
    writeSafe(p, s.replace(needle, insert));
    console.log('call1Dispatch: ok');
  }
}

{
  const p = 'src/module2/pitch/call1Criteria.ts';
  let s = fs.readFileSync(p, 'utf8');
  if (s.includes('negativeCuisineAvoidFromUserText')) {
    console.log('call1Criteria: already');
  } else {
    const add = `
/** „kein Asiatisch“ etc. aus User-Text — auch wenn Call-1 den Key vergisst. */
export function negativeCuisineAvoidFromUserText(userText: string): string[] {
  const t = String(userText || '').replace(/\\s+/g, ' ').trim();
  if (!t) return [];
  const out: string[] = [];
  if (
    /\\bkein[e]?n?\\s+asiatisch\\b|\\bnicht\\s+asiatisch\\b|\\bohne\\s+asiatisch\\b|\\bno\\s+asian\\b/iu.test(
      t,
    )
  ) {
    out.push(...avoidTokensFromNegativeCriterion('cuisine_not_asian'));
  }
  if (/\\bkein[e]?n?\\s+fleisch\\b|\\bkein\\s+fleisch\\b/iu.test(t)) {
    out.push('fleisch', 'steak', 'fleischerei');
  }
  return [...new Set(out)];
}

`;
    // Insert AFTER avoidTokensFromNegativeCriterion function definition ends - better before it but call it - so insert after the function
    const marker = '/** wifi/WLAN/Steckdose-Aliasse → kanonische Soft-Tags für Ranking. */';
    if (!s.includes(marker)) throw new Error('call1Criteria marker missing');
    writeSafe(p, s.replace(marker, add + marker));
    console.log('call1Criteria: ok');
  }
}

{
  const p = 'src/module2/pitch/searchBrief.ts';
  let s = fs.readFileSync(p, 'utf8');
  if (s.includes('negativeCuisineAvoidFromUserText')) {
    console.log('searchBrief: already');
  } else {
    s = s.replace(
      `  isNegativeCuisineCriterion,
  avoidTokensFromNegativeCriterion,`,
      `  isNegativeCuisineCriterion,
  avoidTokensFromNegativeCriterion,
  negativeCuisineAvoidFromUserText,`,
    );
    s = s.replace(
      `  const avoidFromCall1 = [
    ...new Set(
      [...rawMust, ...rawCriteria.map((c) => c.key)].flatMap((k) =>
        avoidTokensFromNegativeCriterion(String(k)),
      ),
    ),
  ];`,
      `  const avoidFromCall1 = [
    ...new Set([
      ...[...rawMust, ...rawCriteria.map((c) => c.key)].flatMap((k) =>
        avoidTokensFromNegativeCriterion(String(k)),
      ),
      ...negativeCuisineAvoidFromUserText(opts.userText),
    ]),
  ];`,
    );
    writeSafe(p, s);
    console.log('searchBrief: ok');
  }
}

{
  const p = 'src/module2/reboot/pipeline/call2Tail.ts';
  let s = fs.readFileSync(p, 'utf8');
  if (s.includes("maxChars: opts.bulletMaxChars")) {
    console.log('call2Tail: already');
  } else {
    if (!s.includes('rewriteBulletToFit')) {
      s = s.replace(
        `import { clampVisualBullets } from '../../../services/concierge/visualBullets';`,
        `import {
  clampVisualBullets,
  rewriteBulletToFit,
} from '../../../services/concierge/visualBullets';`,
      );
    }
    s = s.replace(
      `  return clampVisualBullets(primary, {
    speechText: opts.speechText,
    allowAddress: Boolean(opts.allowAddress),
    surface: 'default',
  }).slice(0, 3).map((b) =>
    b.length > opts.bulletMaxChars ? b.slice(0, opts.bulletMaxChars - 1) + '…' : b,
  );`,
      `  return clampVisualBullets(primary, {
    speechText: opts.speechText,
    allowAddress: Boolean(opts.allowAddress),
    surface: 'default',
    maxChars: opts.bulletMaxChars,
    maxCount: 3,
  })
    .slice(0, 3)
    .map((b) => rewriteBulletToFit(b, opts.bulletMaxChars))
    .filter(Boolean);`,
    );
    s = s.replace(
      `'Felder: bullets[] (max 3, je max bulletMaxChars, nur Fakten aus Speech),',`,
      `'Felder: bullets[] (1–3 FACT-CHIPS, je max bulletMaxChars / ~2 UI-Zeilen, nur Fakten aus Speech — keine Prosa-Sätze, nie mit … abschneiden, Titel nicht wiederholen),',`,
    );
    writeSafe(p, s);
    console.log('call2Tail: ok');
  }
}

console.log('batch1 done');
