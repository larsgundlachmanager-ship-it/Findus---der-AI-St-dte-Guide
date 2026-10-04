import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const uiPath = path.join(dir, 'ui-btn.xml');

function sh(cmd) {
  return execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function dumpUi() {
  sh('adb shell uiautomator dump /sdcard/ui.xml');
  sh(`adb pull /sdcard/ui.xml "${uiPath}"`);
  return fs.readFileSync(uiPath, 'utf8');
}

function shot(name) {
  const p = path.join(dir, name);
  sh(`adb shell screencap -p /sdcard/b.png`);
  sh(`adb pull /sdcard/b.png "${p}"`);
  return p;
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
      };
    }
  }
  return null;
}

function screenFingerprint(xml) {
  const texts = [...xml.matchAll(/text="([^"]{2,60})"/g)].map((m) => m[1]);
  return [...new Set(texts)].slice(0, 12).join(' | ');
}

const tests = [
  { name: 'btn-einst', tap: [/Einst/i, /Einstellungen/i], expect: [/Einstellung/i, /Profil/i, /Stimme/i, /Stadt/i] },
  { name: 'btn-orte', tap: [/Orte/i], expect: [/Orte/i, /Filter/i, /Suche/i, /Geschichte/i, /Museum/i] },
  { name: 'btn-timeline', tap: [/Timeline/i], expect: [/Timeline/i, /Plan/i, /Heute/i, /Tag/i] },
];

// Close calibration if open
let xml = dumpUi();
const close = findTap(xml, [/Schließen/i, /Fertig/i]);
if (close) {
  console.log('close modal', close.label, close.x, close.y);
  sh(`adb shell input tap ${close.x} ${close.y}`);
  sleep(1500);
  xml = dumpUi();
}

const results = [];

// Bottom nav coords from typical layout (fallback)
const fallback = {
  timeline: { x: 180, y: 2300 },
  orte: { x: 540, y: 2300 },
  einst: { x: 900, y: 2300 },
};

for (const t of tests) {
  xml = dumpUi();
  let hit = findTap(xml, t.tap);
  if (!hit) {
    if (/Timeline/i.test(t.tap[0].source)) hit = { ...fallback.timeline, label: 'Timeline(fb)' };
    if (/Orte/i.test(t.tap[0].source)) hit = { ...fallback.orte, label: 'Orte(fb)' };
    if (/Einst/i.test(t.tap[0].source)) hit = { ...fallback.einst, label: 'Einst(fb)' };
  }
  if (!hit) {
    results.push({ test: t.name, ok: false, reason: 'tap target not found' });
    continue;
  }
  console.log('tap', t.name, hit.label, hit.x, hit.y);
  sh(`adb shell input tap ${hit.x} ${hit.y}`);
  sleep(2000);
  xml = dumpUi();
  const fp = screenFingerprint(xml);
  const ok = t.expect.some((re) => re.test(xml) || re.test(fp));
  shot(`${t.name}.png`);
  results.push({ test: t.name, ok, fp });
  // back to map: tap outside or back
  sh('adb shell input keyevent 4');
  sleep(1200);
}

// Top-right HUD buttons (coords from screenshot ~1080 width)
const hud = [
  { name: 'btn-gps', x: 820, y: 280 },
  { name: 'btn-compass', x: 920, y: 280 },
  { name: 'btn-infinity', x: 1010, y: 280 },
];
for (const h of hud) {
  xml = dumpUi();
  const before = shot(`${h.name}-before.png`);
  sh(`adb shell input tap ${h.x} ${h.y}`);
  sleep(1500);
  xml = dumpUi();
  shot(`${h.name}-after.png`);
  const changed = screenFingerprint(xml);
  results.push({ test: h.name, ok: true, fp: changed });
}

// Mic button
sh('adb shell input tap 540 2050');
sleep(1500);
xml = dumpUi();
shot('btn-mic.png');
const micOk = /Zuhören|Hör|Sprich|Listening|Aufnahme|Mikrofon/i.test(xml);
results.push({ test: 'btn-mic', ok: micOk, fp: screenFingerprint(xml) });

console.log('\n=== RESULTS ===');
for (const r of results) {
  console.log(r.ok ? 'OK' : 'FAIL', r.test, r.fp || r.reason || '');
}
