const fs = require('fs');
const t = fs.readFileSync('src/module2/chat/instantFactFormat.ts', 'utf8');
const idx = t.indexOf('Fläche / Größe');
console.log('slice', JSON.stringify(t.slice(idx, idx + 280)));
const line = t.split(/\n/).find((l) => l.includes('gro['));
console.log('line', JSON.stringify(line));
if (line) {
  const hi = [];
  for (const c of line) {
    if (c.charCodeAt(0) > 127) hi.push(c + ':' + c.codePointAt(0).toString(16));
  }
  console.log('hi', hi);
}
const smoke = fs.readFileSync('src/module2/chat/instantFactFormat.smoke.test.ts', 'utf8');
const m = smoke.match(/Wie .{1,8} ist die Alster/);
console.log('smoke phrase', JSON.stringify(m && m[0]));
if (m) {
  const hi2 = [];
  for (const c of m[0]) {
    if (c.charCodeAt(0) > 127) hi2.push(c + ':' + c.codePointAt(0).toString(16));
  }
  console.log('smoke hi', hi2);
}
