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

// 1) analyzeTurn: stop force-nulling continue/resume bridges
{
  const p = 'src/module2/router/analyzeTurn.ts';
  let s = read(p);
  const old = `    let bridge = typeof parsed.bridge === 'string' ? parsed.bridge.trim() : null;
    // Außerhalb Live-Chat: continue/resume ohne Bridge
    if (!live && (session === 'continue' || session === 'resume')) {
      bridge = null;
    }
    // Live-Chat Follow-up: keine zweite Bridge. Sonst Beat 1 behalten — kein Slow-Check.
    if (live && (session === 'continue' || session === 'resume')) {
      bridge = null;
    }
    bridge = stripNameSpam(bridge, false);`;
  const neu = `    let bridge = typeof parsed.bridge === 'string' ? parsed.bridge.trim() : null;
    // Call-1 ist SSOT für die Bridge — auch bei continue/resume.
    // Früher: continue/resume → bridge=null → User hörte keine Zusage (SUP/Rad/…).
    // Nur Call-1 selbst darf bridge=null setzen (Mikro-Ack / bridgeComplete-Klärfrage).
    bridge = stripNameSpam(bridge, false);`;
  if (!s.includes(old)) {
    // try without live blocks separately
    if (s.includes("if (!live && (session === 'continue' || session === 'resume'))")) {
      s = s.replace(
        /let bridge = typeof parsed\.bridge === 'string' \? parsed\.bridge\.trim\(\) : null;\n    \/\/ Außerhalb Live-Chat: continue\/resume ohne Bridge\n    if \(!live && \(session === 'continue' \|\| session === 'resume'\)\) \{\n      bridge = null;\n    \}\n    \/\/ Live-Chat Follow-up: keine zweite Bridge\. Sonst Beat 1 behalten — kein Slow-Check\.\n    if \(live && \(session === 'continue' \|\| session === 'resume'\)\) \{\n      bridge = null;\n    \}\n    bridge = stripNameSpam\(bridge, false\);/,
        neu.trim(),
      );
      write(p, s);
      console.log('analyzeTurn: regex ok');
    } else console.log('analyzeTurn: MISSING');
  } else {
    write(p, s.replace(old, neu));
    console.log('analyzeTurn: ok');
  }

  // strengthen bridge rule in prompt
  s = read(p);
  const oldRuleLive = `    ? '- bridge: Beat 1. DEFAULT = Verstanden + Zusagen MIT Bezug zur DIESEM Wunsch (1–2 Sätze) — Job nennen (AYCE/Steak/Rad-Route/Wetter/SUP/Reservierung/…), keine Venue-Namen/Preise/Minuten. VERBOTEN allein: 0815 („ich schau mal“, „gute Frage“, „wissen kommt gleich“, „genau das klären wir jetzt“, „ich hole nützliche Fakten“) ohne Wunsch-Anker. TRIVIA/RECHNUNG/Quick-Lookup: Antwort-EINLEITUNG nur (Person/Aufgabe ansteuern) — NIE Zahl/Alter/Name. Call-2 liefert den Wert. Kein „finde heraus“, keine Klärfrage bei Amtstiteln. Ja/Nein/„los“: null. Trivia nie null wenn es die Einleitung trägt, session=new.'
    : '- bridge: Beat 1. DEFAULT = Verstanden + Zusagen MIT Bezug zum Wunsch (Nav/Event/Gastro/… Job nennen). NICHT Call-2 spoilern. VERBOTEN allein: leere 0815-Floskeln ohne Wunsch-Anker. TRIVIA/RECHNUNG: nur Einleitung (kein Alter/keine Zahl/kein Name). Cover 2–3 Sätze nur bei langer Recherche. Trivia: keine Klärfrage bei Amtstiteln, kein Recherche-Theater. Bei continue/resume oft null. Kein Name. Wortlaut nie als Script.';`;
  const newRule = `    ? '- bridge: PFLICHT bei neuem Auftrag (session=new ODER continue mit neuem Sub-Wunsch: SUP nach Alster, Rad statt Fuß, Taxi vor Flug, Restaurant-Filter…). = Verstanden + Zusagen MIT Bezug ZU DIESEM Satz (1–2 Sätze, Job/Thema ansteuern). Keine Venue-Namen/Preise/Minuten. VERBOTEN allein: 0815 ohne Wunsch-Anker („ich schau mal“, „wissen kommt gleich“, „nützliche Fakten“, „genau das klären wir“). TRIVIA: nur Einleitung ohne Zahl/Name. Nur Mikro-Ack (ja/ok/los) oder reine Bestätigung → null. Wortlaut frei.'
    : '- bridge: PFLICHT bei neuem Auftrag (auch continue: Mode-Switch, Follow-up-Recherche, neuer Slot). = Verstanden + Zusagen MIT Wunsch-Bezug (Job nennen). NICHT Call-2 spoilern. VERBOTEN allein: 0815 ohne Anker. Trivia: nur Einleitung. Nur Mikro-Ack/„los“ → null — NICHT pauschal continue=null. Wortlaut frei, kein Script.';`;
  if (s.includes(oldRuleLive)) {
    write(p, s.replace(oldRuleLive, newRule));
    console.log('analyzeTurn prompt: ok');
  } else {
    console.log('analyzeTurn prompt: pattern miss — try softer');
    if (s.includes('Bei continue/resume oft null')) {
      s = s.replace(
        'Bei continue/resume oft null. Kein Name. Wortlaut nie als Script.',
        'Nur Mikro-Ack/„los“ → null — NICHT pauschal continue=null. Kein Name. Wortlaut frei.',
      );
      s = s.replace(
        'Ja/Nein/„los“: null. Trivia nie null wenn es die Einleitung trägt, session=new.',
        'Nur Mikro-Ack (ja/ok/los) → null. Neuer Sub-Wunsch bei continue (SUP/Rad/Filter…) → Bridge MIT Zusage. Trivia nie null wenn Einleitung nötig.',
      );
      write(p, s);
      console.log('analyzeTurn prompt: soft ok');
    }
  }
}

// 2) shouldSuppressBridge: don't blanket kill continue
{
  const p = 'src/module2/reboot/managerTurn.ts';
  let s = read(p);
  const old = `/** Follow-up am selben Ort/Topic → keine neue Bridge. */
export function shouldSuppressBridge(opts: {
  topicMode: TopicRouteDecision['mode'] | null | undefined;
  jobId: string;
  userText: string;
}): boolean {
  // Live-Chat: Bridge ERLAUBT (kurz) — menschliches Gespräch
  // App-Steuerung / Hands-free: kein Bridge-Vorgeplänkel
  if (
    /\\b(shortcut|hands[-\\s]?free|sprechen[- ]?notification|live[-\\s]?chat|gesprächs?modus|taschenlampe|stimme\\s+(?:von|ändern)|einstellung)\\b/iu.test(
      opts.userText,
    )
  ) {
    return true;
  }
  const mode = opts.topicMode;
  // Gleicher Blaupausen-Chat außerhalb Live-Chat: keine neue Bridge
  let live = false;
  try {
    const { isLiveChatTurnActive } = require('../../services/handsFree/liveChatTurnContext') as {
      isLiveChatTurnActive: () => boolean;
    };
    live = isLiveChatTurnActive();
  } catch {
    live = false;
  }
  if (!live && (mode === 'continue' || mode === 'resume')) {
    return true;
  }
  // Button „Mehr Historie“ immer ohne Bridge — auch wenn Topic-Router „new“ sagt
  if (
    /\\berzähl\\s+mir\\s+noch\\s+mehr\\s+zu\\b/iu.test(opts.userText) ||
    /\\bmehr\\s+(zur\\s+)?(historie|geschichte)\\b/iu.test(opts.userText)
  ) {
    return true;
  }
  return false;
}`;
  const neu = `/**
 * Bridge nur unterdrücken wenn wirklich kein Beat-1 nötig.
 * Call-1 entscheidet den Text — continue/resume darf Zusage behalten
 * (SUP nach Alster, Rad-Umschalten, Filter…).
 */
export function shouldSuppressBridge(opts: {
  topicMode: TopicRouteDecision['mode'] | null | undefined;
  jobId: string;
  userText: string;
}): boolean {
  // App-Steuerung / Hands-free: kein Bridge-Vorgeplänkel
  if (
    /\\b(shortcut|hands[-\\s]?free|sprechen[- ]?notification|live[-\\s]?chat|gesprächs?modus|taschenlampe|stimme\\s+(?:von|ändern)|einstellung)\\b/iu.test(
      opts.userText,
    )
  ) {
    return true;
  }
  // Button „Mehr Historie“ immer ohne Bridge
  if (
    /\\berzähl\\s+mir\\s+noch\\s+mehr\\s+zu\\b/iu.test(opts.userText) ||
    /\\bmehr\\s+(zur\\s+)?(historie|geschichte)\\b/iu.test(opts.userText)
  ) {
    return true;
  }
  // Reine Mikro-Acks am Faden — keine zweite Bridge
  const t = (opts.userText || '').replace(/\\s+/g, ' ').trim();
  if (
    (opts.topicMode === 'continue' || opts.topicMode === 'resume') &&
    /^(ja|nein|ok|okay|passt|genau|mach\\s+das|los|klar|bitte|danke)[.!?]?$/iu.test(t)
  ) {
    return true;
  }
  return false;
}`;
  if (s.includes(old)) {
    write(p, s.replace(old, neu));
    console.log('managerTurn: ok');
  } else if (s.includes("if (!live && (mode === 'continue' || mode === 'resume'))")) {
    // softer replace of the live/continue block
    s = s.replace(
      /\/\*\* Follow-up am selben Ort\/Topic → keine neue Bridge\. \*\/[\s\S]*?return false;\n\}/,
      neu,
    );
    write(p, s);
    console.log('managerTurn: regex ok');
  } else console.log('managerTurn: MISSING');
}

// 3) contracts comment
{
  const p = 'src/module2/reboot/contracts.ts';
  let s = read(p);
  if (s.includes('Follow-up / continue Thread → bridgeOneLiner muss null sein')) {
    s = s.replace(
      'Follow-up / continue Thread → bridgeOneLiner muss null sein.',
      'Nur Mikro-Ack / Mehr-Historie → Bridge optional null; neuer Sub-Auftrag darf Bridge behalten.',
    );
  }
  if (s.includes('suppressOnThreadContinue: true')) {
    s = s.replace('suppressOnThreadContinue: true', 'suppressOnThreadContinue: false');
  }
  write(p, s);
  console.log('contracts: ok');
}

// 4) Think frame harden
{
  const p = 'src/module2/router/call1ThinkFrame.ts';
  let s = read(p);
  if (!s.includes('Bridge PFLICHT bei neuem Auftrag')) {
    s = s.replace(
      '- Bridge = Verstehen + Zusagen MIT Wunsch-Bezug ODER (Trivia/Rechnung) Antwort-Einleitung OHNE Faktwert.',
      '- Bridge PFLICHT bei neuem Auftrag (auch continue: SUP/Rad/Filter/Taxi…) = Verstehen + Zusagen MIT Wunsch-Bezug ODER (Trivia/Rechnung) Antwort-Einleitung OHNE Faktwert. Nur Mikro-Ack → bridge null — nie pauschal continue=null.',
    );
    write(p, s);
    console.log('thinkFrame: ok');
  }
}

// 5) Owner gold summary
{
  const p = 'src/module2/blueprints/ownerGold.pack.json';
  let s = read(p);
  s = s.replace(
    '"summary": "Bridge (Call 1): Nur DIESE User-Nachricht — Wunsch-Art kurz ansteuern (Essen/AYCE/Rad-Route/Wetter/SUP/Reservierung/Trivia-Einleitung) + Zusage. Nie alleinige 0815-Floskel („ich schau mal“, „wissen kommt gleich“, „nützliche Fakten“, „genau das klären wir“) ohne Anker. Ausnahme: fehlender Blocker-Slot → kurze Gegenfrage, bridgeComplete, keine Recherche-Zusage. Nie Meta-Warte. Kurz 1–2 Sätze. Keine Venue-Namen/Preise/Minuten. Call 2 hängt flüssig an — außer bridgeComplete."',
    '"summary": "Bridge (Call 1): Bei jedem neuen Auftrag — auch Follow-up (SUP nach Alster, Rad statt Fuß, Filter) — Verstanden + Zusage mit Wunsch-Bezug. Nie pauschal continue=stumm. Nie alleinige 0815 ohne Anker. Blocker-Slot → kurze Gegenfrage + bridgeComplete. Mikro-Ack (ja/ok) → bridge null ok. Kurz 1–2 Sätze. Keine Venue-Namen/Preise/Minuten. Call 2 hängt flüssig an."',
  );
  write(p, s);
  console.log('gold: ok');
}

// 6) smoke for shouldSuppressBridge
{
  const p = 'src/module2/reboot/managerTurn.bridge.smoke.test.ts';
  write(
    p,
    `/**
 * Run: npx --yes --package tsx@4.19.4 tsx src/module2/reboot/managerTurn.bridge.smoke.test.ts
 */
import { shouldSuppressBridge } from './managerTurn';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(\`FAIL: \${msg}\`);
}

assert(
  shouldSuppressBridge({
    topicMode: 'continue',
    jobId: 'dining_open',
    userText: 'Kann man hier SUP ausleihen?',
  }) === false,
  'SUP follow-up darf Bridge behalten',
);
assert(
  shouldSuppressBridge({
    topicMode: 'continue',
    jobId: 'nav_route',
    userText: 'Stell die Route auf Fahrrad um',
  }) === false,
  'bike switch darf Bridge behalten',
);
assert(
  shouldSuppressBridge({
    topicMode: 'continue',
    jobId: 'dining_open',
    userText: 'ja',
  }) === true,
  'Mikro-Ack unterdrückt Bridge',
);
assert(
  shouldSuppressBridge({
    topicMode: 'new',
    jobId: 'dining_open',
    userText: 'All you can eat kein asiatisch',
  }) === false,
  'new wish behält Bridge',
);

console.log('managerTurn.bridge.smoke.test.ts OK');
`,
  );
  console.log('smoke written');
}

console.log('done');
