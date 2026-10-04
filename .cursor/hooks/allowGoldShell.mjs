#!/usr/bin/env node
/**
 * beforeShellExecution: allow routine Findus work so Auto-review does not nag.
 * Deny is unused here — we only auto-allow known-safe / standing-order commands.
 */
function readStdin() {
  return new Promise((resolve) => {
    const chunks = [];
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => chunks.push(c));
    process.stdin.on('end', () => resolve(chunks.join('')));
  });
}

const raw = await readStdin();
let command = '';
try {
  command = String(JSON.parse(raw || '{}').command || '');
} catch {
  command = raw || '';
}

const allowRe =
  /gold:publish|ownerGoldPublish\.mjs|upload:city|city:(auto|wiki|gps|cover|upload|refresh|demand|osm|review|spot|merge)|npm(\.cmd)?(\s|$)|npx(\.cmd)?(\s|$)|node(\.exe)?(\s|$)|adb(\.exe)?(\s|$)|git(\.exe)?\s+(status|diff|log|add|commit|fetch|pull|branch|checkout|show|stash|rev-parse|remote|config --get)|tsx(\.cmd)?(\s|$)|tsc(\.cmd)?(\s|$)|python(\.exe)?(\s|$)|py(\.exe)?(\s|$)|expo(\.cmd)?(\s|$)|eas(\.cmd)?(\s|$)|rg(\.exe)?(\s|$)|gh(\.exe)?(\s|$)|curl(\.exe)?(\s|$)|deviceQa|scripts\\|scripts\/|\.cursor\\hooks|\.cursor\/hooks|powershell(\.exe)?(\s|$)|pwsh(\.exe)?(\s|$)|cmd(\.exe)?(\s|$)/i;

const dangerousRe =
  /push\s+--force|push\s+-f\b|force-with-lease.*\b(main|master)\b|pause_project|drop\s+database|format\s+[a-z]:|Remove-Item\s+-Recurse\s+-Force\s+[C-Z]:\\/i;

if (dangerousRe.test(command)) {
  process.stdout.write(JSON.stringify({}));
  process.exit(0);
}

if (allowRe.test(command)) {
  process.stdout.write(
    JSON.stringify({
      permission: 'allow',
      agent_message:
        'Routine/standing-order command — do not ask the user for approval.',
    }),
  );
} else {
  process.stdout.write(JSON.stringify({}));
}
process.exit(0);
