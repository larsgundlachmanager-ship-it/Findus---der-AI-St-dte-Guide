import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const uiPath = path.join(dir, 'ui-now.xml');

function sh(cmd) {
  return execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
}

function dumpUi() {
  sh('adb shell uiautomator dump /sdcard/ui.xml');
  sh(`adb pull /sdcard/ui.xml "${uiPath}"`);
  return fs.readFileSync(uiPath, 'utf8');
}

function findTap(xml, patterns) {
  for (const pat of patterns) {
    const re = new RegExp(
      `(?:text|content-desc)="(${pat.source})[^"]*"[^>]*bounds="\\[(\\d+),(\\d+)\\]\\[(\\d+),(\\d+)\\]"`,
      'i',
    );
    const m = re.exec(xml);
    if (m) {
      return {
        label: m[1],
        x: Math.round((+m[2] + +m[4]) / 2),
        y: Math.round((+m[3] + +m[5]) / 2),
        isName: /vorname/i.test(m[1]),
      };
    }
  }
  return null;
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function isMap(xml) {
  return /von \d+ Orte|Orte anzeigen|extract-roads|HomePresenceMap/i.test(xml);
}

const tapOrder = [
  /Als Gast weiter/,
  /Express starten/,
  /Weiter mit Deutsch/,
  /Vorname/i,
  /Keine Angabe/,
  /Keine$/,
  /Weiter/,
  /Überspringen/,
  /Fertig/,
  /Los geht/,
  /Prisdorf/i,
  /Verstanden/,
  /Nicht jetzt/,
];

sh('adb shell input tap 540 1121');
sleep(2000);

for (let step = 0; step < 35; step++) {
  const shot = path.join(dir, `maptry-${String(step).padStart(2, '0')}.png`);
  sh(`adb shell screencap -p /sdcard/onb.png`);
  sh(`adb pull /sdcard/onb.png "${shot}"`);
  const xml = dumpUi();
  if (isMap(xml)) {
    console.log('MAP_REACHED', step, shot);
    process.exit(0);
  }
  const hit = findTap(xml, tapOrder);
  if (!hit) {
    console.log('STUCK', step, shot);
    const all = [...xml.matchAll(/text="([^"]{3,80})"/g)].map((m) => m[1]);
    console.log('visible:', [...new Set(all)].join(' | '));
    process.exit(1);
  }
  console.log('tap', hit.label, hit.x, hit.y);
  sh(`adb shell input tap ${hit.x} ${hit.y}`);
  if (hit.isName) {
    sleep(500);
    sh('adb shell input text Test');
  }
  sleep(2500);
}
console.log('TIMEOUT');
process.exit(1);
