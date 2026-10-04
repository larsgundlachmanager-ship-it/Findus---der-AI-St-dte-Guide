const fs = require('fs');
const p = 'src/module2/reboot/pipeline/researchBudget.ts';
let s = fs.readFileSync(p, 'utf8');
const old = `  const baseSec = Math.max(tableBase, Math.min(paced, 22));`;
const neu = `  // Instant/nav floors (≤2s) nicht durch Pace-Default (instant≈3) aufblasen
  const baseSec =
    tableBase <= 2
      ? Math.min(2, Math.max(tableBase, Math.min(paced, 22)))
      : Math.max(tableBase, Math.min(paced, 22));`;
if (!s.includes(old)) {
  if (s.includes('tableBase <= 2')) {
    console.log('already patched');
    process.exit(0);
  }
  console.error('needle missing');
  process.exit(1);
}
fs.writeFileSync(p, s.replace(old, neu));
console.log('patched researchBudget');
