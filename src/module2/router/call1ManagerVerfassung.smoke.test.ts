/**
 * Call-1 Manager-Verfassung — Source-Vertrag (kein Early-Bypass).
 * Run: npx --yes tsx src/module2/router/call1ManagerVerfassung.smoke.test.ts
 */

import { readFileSync } from 'fs';
import { join } from 'path';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

const turn = readFileSync(
  join(process.cwd(), 'src/module2/router/runConciergeTurn.ts'),
  'utf8',
);
const analyze = readFileSync(
  join(process.cwd(), 'src/module2/router/analyzeTurn.ts'),
  'utf8',
);
const think = readFileSync(
  join(process.cwd(), 'src/module2/router/call1ThinkFrame.ts'),
  'utf8',
);
const isolation = readFileSync(
  join(process.cwd(), 'src/module2/router/call1ManagerIsolation.ts'),
  'utf8',
);
const goldCat = readFileSync(
  join(process.cwd(), 'src/module2/router/call1OwnerGoldCatalog.ts'),
  'utf8',
);
const mapPrompt = readFileSync(
  join(process.cwd(), 'src/services/homeMap/mapPackPrompt.ts'),
  'utf8',
);
const synth = readFileSync(
  join(process.cwd(), 'src/module2/reboot/synthesizeReboot.ts'),
  'utf8',
);
const policy = readFileSync(
  join(process.cwd(), 'src/services/concierge/findusResponsePolicy.ts'),
  'utf8',
);
const goldPack = readFileSync(
  join(process.cwd(), 'src/module2/blueprints/ownerGold.pack.json'),
  'utf8',
);

// Phase A — keine Pre-Call-1 Bypasses
assert(
  !/fireEarlyFloskelBridge\s*\(/.test(turn),
  'kein fireEarlyFloskelBridge-Aufruf',
);
assert(
  turn.includes('KEIN Pre-Call-1 Bypass') ||
    turn.includes('Manager-Verfassung'),
  'Manager-Verfassung Kommentar',
);
assert(
  turn.includes('rawUserTextForCall1'),
  'Roh-UserText an Call 1',
);
assert(
  !turn.includes('rewriteQuery('),
  'kein rewriteQuery vor Call 1',
);
assert(
  turn.includes('analyzeManagerTurn({') &&
    turn.includes('userText: rawUserTextForCall1'),
  'analyzeManagerTurn bekommt Rohtext',
);
assert(
  turn.includes('call1 nav-stop') || turn.includes('isPureStopNavigationIntent'),
  'Nav-Stop nach Call 1 verdrahtet',
);
assert(
  turn.includes('hardOverrideNavigationTo') &&
    turn.includes("call1Execution === 'nav_execute'"),
  'Nav-Start (hardOverride) nach Call 1 verdrahtet',
);
assert(
  turn.includes('synthesizeRebootTurn') && turn.includes('synthesis.bullets'),
  'Call-2 Stichpunkte → UI',
);
assert(
  turn.includes("call1Execution === 'chat_lane'") &&
    turn.includes("call1Execution === 'pitch_module'"),
  'Recherche chat/pitch Lanes noch da',
);
assert(
  turn.includes('bridgeComplete'),
  'bridgeComplete Skip-Pfad',
);
assert(
  turn.includes('call1AllowsJustDoIt'),
  'earlyJustDoIt Call-1-gated',
);
assert(
  turn.includes("call1Execution === 'nav_execute'") &&
    !/forceExplicitNav = isExplicitNavIntent/.test(turn),
  'kein forceExplicitNav Keyword-Steal',
);

// Phase B — Gold Katalog
assert(goldCat.includes('formatOwnerGoldCatalogForCall1'), 'Gold-Katalog Call 1');
assert(goldCat.includes('formatSelectedGoldForCall2'), 'Gold gewählt Call 2');
assert(turn.includes('formatOwnerGoldCatalogForCall1'), 'Katalog im Turn');
assert(analyze.includes('selectedGoldKeys'), 'selectedGoldKeys Schema');
assert(analyze.includes('bridgeComplete'), 'bridgeComplete Schema');
assert(think.includes('KLÄRUNG ODER RECHERCHE') || think.includes('bridgeComplete'), 'Clarify before research');
assert(think.includes('Kontext-first') || think.includes('heiterem Himmel'), 'Context before clarify');
assert(analyze.includes('Klärfrage') || analyze.includes('Blocker-Slot'), 'Clarify in Call-1 schema');
assert(policy.includes('KLÄRFRAGE'), 'Clarify in bridge policy');
assert(goldPack.includes('missing_blocker_slot_clarify_v1'), 'Owner-Gold clarify blueprint');
assert(goldPack.includes('taxi_missing_destination_clarify_v1'), 'Owner-Gold taxi clarify');
assert(
  turn.includes('bridgeComplete === true') &&
    !/bridgeComplete === true && analysis\.bridgeSpokenEarly/.test(turn),
  'bridgeComplete skips Call 2 even before spoken',
);

// Phase C — Isolation
assert(isolation.includes('scrubStickyAfterCall1'), 'Isolation scrub');
assert(isolation.includes('clearLastMentionedCity'), 'Isolation clears city sticky');
assert(isolation.includes('clearIntentQueue'), 'Isolation clears intent queue');
assert(turn.includes('scrubStickyAfterCall1'), 'Isolation wired');
assert(turn.includes('short = getShortTerm()'), 'Short refreshed after scrub');
assert(
  require('fs').readFileSync(
    join(process.cwd(), 'src/module2/router/applySession.ts'),
    'utf8',
  ).includes('forceNew'),
  'applyManagerSession honors Call-1 new',
);

// Phase D — Pack Popup
assert(mapPrompt.includes('cityEnter'), 'Pack nur cityEnter');
assert(mapPrompt.includes('if (!input.cityEnter) return false'), 'cityEnter Gate');

// Phase E — Call 2 mitdenken
assert(synth.includes('Du darfst mitdenken'), 'Call 2 mitdenken');
assert(synth.includes('selectedGoldBlock'), 'selectedGold in Synth');
assert(synth.includes('call2Brief'), 'call2Brief in Synth');

// Phase G — Korrektur lernen
assert(turn.includes('runCorrectionLearningCapture'), 'Korrektur-Capture');

console.log('call1ManagerVerfassung.smoke.test.ts OK');
