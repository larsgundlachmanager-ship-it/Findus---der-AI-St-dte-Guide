/**
 * Fail fast before iOS/Android EAS store builds if critical EXPO_PUBLIC_*
 * vars are missing from the EAS production environment.
 *
 * Local .env is never uploaded (.easignore). Keys must live in EAS.
 *
 * Usage: node scripts/check-eas-production-env.mjs
 */
import { spawnSync } from 'node:child_process';

const REQUIRED = [
  'EXPO_PUBLIC_SUPABASE_URL',
  'EXPO_PUBLIC_SUPABASE_ANON_KEY',
  'EXPO_PUBLIC_GEMINI_API_KEY',
  'EXPO_PUBLIC_CARTESIA_API_KEY',
  'EXPO_PUBLIC_PROTOMAPS_API_KEY',
];

const RECOMMENDED = [
  'EXPO_PUBLIC_GOOGLE_MAPS_API_KEY',
  'EXPO_PUBLIC_MAP_VECTOR_TILES',
  'EXPO_PUBLIC_OPENWEATHER_API_KEY',
];

function listProductionEnvNames() {
  const r = spawnSync(
    'npx',
    ['eas-cli', 'env:list', '--environment', 'production'],
    { encoding: 'utf8', shell: true },
  );
  const out = `${r.stdout ?? ''}\n${r.stderr ?? ''}`;
  if (r.status !== 0 && !/Environment: production/i.test(out)) {
    console.error(out.trim() || 'eas env:list failed');
    process.exit(1);
  }
  const names = new Set();
  for (const line of out.split(/\r?\n/)) {
    const m = line.match(/^(EXPO_PUBLIC_[A-Z0-9_]+)=/);
    if (m) names.add(m[1]);
  }
  return names;
}

const present = listProductionEnvNames();
const missingRequired = REQUIRED.filter((k) => !present.has(k));
const missingRecommended = RECOMMENDED.filter((k) => !present.has(k));

console.log(
  `EAS production: ${present.size} EXPO_PUBLIC_* vars (${[...present].sort().join(', ') || 'none'})`,
);

if (missingRecommended.length) {
  console.warn(`Recommended (optional): missing ${missingRecommended.join(', ')}`);
}

if (missingRequired.length) {
  console.error(
    [
      'EAS production fehlt Pflicht-Env für Store/TestFlight-Builds:',
      ...missingRequired.map((k) => `  - ${k}`),
      '',
      'Setzen z.B.:',
      '  npx eas-cli env:set production --name EXPO_PUBLIC_… --value … --visibility sensitive --type string --non-interactive',
      'Dann neu bauen. Lokale .env wird nicht nach EAS hochgeladen.',
    ].join('\n'),
  );
  process.exit(1);
}

console.log('EAS production env check OK.');
