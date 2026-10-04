import fs from 'fs';
const x = fs.readFileSync(new URL('./ui-now.xml', import.meta.url), 'utf8');
for (const label of ['Weiter', 'Express', 'Deutsch', 'Nicht jetzt', 'starten', 'Empfohlen', 'Gast', 'Überspringen', 'Fertig', 'Los']) {
  const re = new RegExp(
    `(?:text|content-desc)="${label}[^"]*"[^>]*bounds="\\[(\\d+),(\\d+)\\]\\[(\\d+),(\\d+)\\]"`,
    'gi',
  );
  let m;
  while ((m = re.exec(x))) {
    const cx = Math.round((+m[1] + +m[3]) / 2);
    const cy = Math.round((+m[2] + +m[4]) / 2);
    console.log(label, cx, cy, m[0].slice(0, 80));
  }
}
