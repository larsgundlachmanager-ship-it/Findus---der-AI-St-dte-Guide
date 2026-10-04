import { execSync } from 'child_process';
import fs from 'fs';

execSync('adb shell uiautomator dump /sdcard/ui-pan.xml', { stdio: 'inherit' });
execSync('adb pull /sdcard/ui-pan.xml .phone-check/ui-pan-now.xml', { stdio: 'inherit' });
const xml = fs.readFileSync('.phone-check/ui-pan-now.xml', 'utf8');
const all = [...xml.matchAll(/<node ([^>]+)\/>/g)].map((m) => m[1]);
function attr(s, k) {
  const m = s.match(new RegExp(k + '="([^"]*)"'));
  return m ? m[1] : '';
}
const cx = 540;
const cy = 1100;
const hits = [];
for (const s of all) {
  const b = attr(s, 'bounds');
  const m = b.match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/);
  if (!m) continue;
  const [x1, y1, x2, y2] = m.slice(1).map(Number);
  if (x1 <= cx && cx <= x2 && y1 <= cy && cy <= y2) {
    hits.push({
      cls: attr(s, 'class'),
      text: attr(s, 'text'),
      desc: attr(s, 'content-desc'),
      click: attr(s, 'clickable'),
      bounds: b,
      area: (x2 - x1) * (y2 - y1),
    });
  }
}
hits.sort((a, b) => a.area - b.area);
console.log('covering center', hits.length);
console.log(JSON.stringify(hits.slice(0, 20), null, 2));

// also list large clickable overlays
const big = [];
for (const s of all) {
  const b = attr(s, 'bounds');
  const m = b.match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/);
  if (!m) continue;
  const [x1, y1, x2, y2] = m.slice(1).map(Number);
  const area = (x2 - x1) * (y2 - y1);
  if (area > 800_000 && attr(s, 'clickable') === 'true') {
    big.push({ cls: attr(s, 'class'), desc: attr(s, 'content-desc'), text: attr(s, 'text'), bounds: b, area });
  }
}
console.log('big clickables', JSON.stringify(big, null, 2));
