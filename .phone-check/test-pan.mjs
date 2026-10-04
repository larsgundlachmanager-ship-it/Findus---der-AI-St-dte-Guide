import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const dir = path.dirname(fileURLToPath(import.meta.url));

function sh(cmd) {
  return execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function shot(name) {
  const p = path.join(dir, name);
  sh(`adb shell screencap -p /sdcard/pan.png`);
  sh(`adb pull /sdcard/pan.png "${p}"`);
  console.log('shot', name);
  return p;
}

// Ensure map is foreground
sh('adb shell am force-stop de.findus.app');
sleep(1500);
sh('adb shell monkey -p de.findus.app -c android.intent.category.LAUNCHER 1');
sleep(12000);

shot('pan-00-before.png');

// Pan map: swipe finger right = map moves left (see area to the east)
sh('adb shell input swipe 800 1200 280 1200 450');
sleep(800);
shot('pan-01-after-swipe-right.png');

// Pan up
sh('adb shell input swipe 540 1400 540 600 450');
sleep(800);
shot('pan-02-after-swipe-up.png');

// Wait — snap-back would happen here within ~1-2s
sleep(3500);
shot('pan-03-after-wait.png');

// Another pan diagonal
sh('adb shell input swipe 300 1000 780 1600 500');
sleep(800);
shot('pan-04-after-diagonal.png');

sleep(4000);
shot('pan-05-final-wait.png');

console.log('PAN_TEST_DONE');
