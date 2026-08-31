/**
 * Feld-Playbook Preflight — was Code/APK prüfen können (kein GPS-Fußweg).
 * Run: npx --yes tsx scripts/run-luebeck-feld-preflight.ts
 *
 * Grün hier ≠ Feld-DoD. Feld-Checkboxen bleiben manuell in
 * data/liveQuality/luebeck-altstadt-feld-playbook.md
 *
 * APK-Alter: default Warnung (grün). Hart fail nur mit PREFLIGHT_STRICT_APK=1
 * oder fehlendem APK. Feld-Build: npm run build:android:release
 */

import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '..');

type Check = { id: string; ok: boolean; detail: string };

function exists(rel: string): boolean {
  return fs.existsSync(path.join(root, rel));
}

function read(rel: string): string {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

function fileHas(rel: string, re: RegExp): boolean {
  try {
    return re.test(read(rel));
  } catch {
    return false;
  }
}

const checks: Check[] = [];

function add(id: string, ok: boolean, detail: string) {
  checks.push({ id, ok, detail });
}

// APK
const apkRel =
  'android/app/build/outputs/apk/release/app-release.apk';
const apkOk = exists(apkRel);
let apkAgeH = Infinity;
if (apkOk) {
  const st = fs.statSync(path.join(root, apkRel));
  apkAgeH = (Date.now() - st.mtimeMs) / 3_600_000;
}
add(
  'apk_exists',
  apkOk,
  apkOk ? `APK da, Alter ~${apkAgeH.toFixed(1)} h` : 'APK fehlt — build:android:release',
);

const maxAgeH = Number(process.env.PREFLIGHT_APK_MAX_AGE_H || 24);
const strictApk = process.env.PREFLIGHT_STRICT_APK === '1';
const apkFresh = apkOk && apkAgeH < maxAgeH;
if (apkOk && !apkFresh) {
  const msg = `APK ${apkAgeH.toFixed(0)} h alt (Feld-Ziel < ${maxAgeH} h) — npm run build:android:release`;
  if (strictApk) {
    add('apk_fresh', false, msg);
  } else {
    add('apk_fresh', true, `WARN: ${msg}`);
    console.log(`WARN  apk_stale — ${msg}`);
  }
} else {
  add(
    'apk_fresh',
    apkOk ? apkFresh : false,
    apkOk
      ? apkFresh
        ? `APK < ${maxAgeH} h`
        : `kein APK`
      : 'kein APK',
  );
}

// Schicht 1 hart
add(
  'thread_cityKey',
  fileHas(
    'src/services/memory/conversationThreads.ts',
    /cityKey:\s*string/,
  ),
  'ConversationThread.cityKey Pflicht',
);
add(
  'm5_city_tag',
  fileHas(
    'src/module2/planning/planSessionState.ts',
    /parkPlanSessionOnCitySwitch/,
  ),
  'M5 parkPlanSessionOnCitySwitch',
);
add(
  'regelwerk',
  fileHas(
    'src/module2/context/cityChatRegelwerk.ts',
    /STADT-CHAT REGELWERK/,
  ) &&
    fileHas(
      'src/module2/router/analyzeTurn.ts',
      /buildCityChatRegelwerk/,
    ),
  'Regelwerk in Manager-Turn',
);
add(
  'scope_ssot',
  fileHas(
    'src/module2/context/cityChatScope.ts',
    /computeCityChatScope/,
  ),
  'cityChatScope SSOT',
);
add(
  'home_switch',
  fileHas(
    'src/screens/HomeScreen.tsx',
    /parkPlanSessionOnCitySwitch/,
  ) &&
    fileHas(
      'src/screens/HomeScreen.tsx',
      /parkForegroundOnCitySwitch/,
    ),
  'Home: Thread+M5 bei Stadtwechsel',
);

// Schicht 2 Marker (Playbook-relevant)
add(
  'nav_autostart',
  fileHas(
    'src/services/concierge/presentConcierge.ts',
    /commitHandsFreeNavStart/,
  ),
  'Nav Auto-Start Hook',
);
add(
  'bridge_sanitize',
  fileHas(
    'src/module2/chat/butlerOfferBus.ts',
    /sanitizeBridgeText/,
  ),
  'Bridge Meta-Sanitize',
);
add(
  'facing',
  fileHas(
    'src/module2/agents/facingSpeech.ts',
    /facing/,
  ) || fileHas('src/module2/agents/facingSpeech.ts', /Facing/),
  'Facing-Speech Modul',
);
add(
  'playbook_file',
  exists('data/liveQuality/luebeck-altstadt-feld-playbook.md'),
  'Feld-Playbook Datei',
);

const failed = checks.filter((c) => !c.ok);
for (const c of checks) {
  console.log(`${c.ok ? 'OK' : 'FAIL'}  ${c.id} — ${c.detail}`);
}
console.log('');
if (failed.length) {
  console.log(
    `Preflight: ${checks.length - failed.length}/${checks.length} — Feld-DoD noch manuell.`,
  );
  process.exitCode = 1;
} else {
  console.log(
    `Preflight: ${checks.length}/${checks.length} Code/APK-Checks grün.`,
  );
  console.log(
    'Feld-DoD: Checkboxen in luebeck-altstadt-feld-playbook.md noch zu Fuß abhaken.',
  );
}
