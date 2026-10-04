import { execSync } from 'child_process';
import fs from 'fs';

execSync('adb shell uiautomator dump /sdcard/ui2.xml', { stdio: 'inherit' });
execSync('adb pull /sdcard/ui2.xml .phone-check/ui2.xml', { stdio: 'inherit' });
const xml = fs.readFileSync('.phone-check/ui2.xml', 'utf8');
const all = [...xml.matchAll(/<node ([^>]+)\/>/g)].map((m) => m[1]);
function attr(s, k) {
  const m = s.match(new RegExp(k + '="([^"]*)"'));
  return m ? m[1] : '';
}
console.log('--- clickables ---');
for (const s of all) {
  if (attr(s, 'clickable') !== 'true') continue;
  console.log(attr(s, 'bounds'), JSON.stringify(attr(s, 'text')), JSON.stringify(attr(s, 'content-desc')));
}
console.log('--- texts ---');
for (const s of all) {
  const t = attr(s, 'text');
  if (t) console.log(attr(s, 'bounds'), t);
}
