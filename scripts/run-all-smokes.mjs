/**
 * Run all src smoke/contract tests via tsx@4.19.4 (local tsx is broken).
 */
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function walk(dir, acc = []) {
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, ent.name);
    if (ent.isDirectory()) {
      if (ent.name === 'node_modules' || ent.name === 'android' || ent.name === 'ios') continue;
      walk(p, acc);
    } else if (
      ent.name.endsWith('.smoke.test.ts') ||
      ent.name.endsWith('.contract.test.ts')
    ) {
      acc.push(p);
    }
  }
  return acc;
}

const files = walk(join(root, 'src'));
const extra = [
  join(root, 'scripts', 'qa-overnight-gates.ts'),
  join(root, 'scripts', 'run-pitch-gate.ts'),
  join(root, 'scripts', 'run-tour-gate.ts'),
  join(root, 'scripts', 'run-luebeck-scenario-gate.ts'),
  join(root, 'scripts', 'run-city-chat-partition-gate.ts'),
  join(root, 'scripts', 'run-reboot-scenario-gate.ts'),
];
const all = [...files, ...extra];
const fail = [];
let ok = 0;
const temp = process.env.TEMP || process.env.TMP || root;

for (const f of all) {
  const rel = f.slice(root.length + 1);
  process.stdout.write(`\n=== ${rel} ===\n`);
  // cwd = repo: smokes that readFile via process.cwd() must see src/.
  // tsx still comes from npx@4.19.4, not the broken local binary.
  const r = spawnSync(
    `npx --yes --package tsx@4.19.4 tsx "${f}"`,
    { cwd: root, stdio: 'inherit', shell: true, windowsHide: true, env: { ...process.env, TEMP: temp, TMP: temp } },
  );
  if (r.status !== 0) fail.push(rel);
  else ok += 1;
}

console.log(`\nOK=${ok} FAIL=${fail.length}`);
for (const f of fail) console.log('FAIL', f);
process.exit(fail.length ? 1 : 0);
